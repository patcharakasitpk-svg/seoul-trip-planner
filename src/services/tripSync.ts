import type { Plan } from '../core/types';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import { app } from '../ui/app';
import { clone } from '../core/planOps';
import { planToTripDocs, planToPersonal, diffTripDocs, tripDocsToPlan, type TripDocs, type PersonalDocs, type RemoteTrip } from '../core/tripDocs';
import { cleanPacking, mergePackingDone, type PackItem } from '../core/packing';
import { firebaseApp, onAuth, authState, sendInviteLink, type AuthUser } from './auth';
import { placePhotos } from './shopPhotos';
import { loadShop, saveShop, sanitizeShop } from './shop';
import { loadFx } from './fx';
import { saveSettings, safeGet, safeSet } from '../storage/storage';
import { FIRESTORE_EMULATOR } from '../config';

/**
 * ทริปที่แชร์กับเพื่อน (Firestore)
 * แผนที่แอปใช้ = "แผนสำเนาของทริป" (id `trip-<tripId>`) ในเครื่อง · หลังบันทึกทุกครั้งเทียบกับที่ซิงก์ล่าสุดแล้วเขียนเฉพาะเอกสารที่เปลี่ยน
 * ของจากเพื่อนเข้ามา → ประกอบแผนใหม่ (ผ่านตัวตรวจ) แทนสำเนาในเครื่อง
 * Firestore เก็บสำเนาในเครื่อง (ใช้ออฟไลน์ได้) และส่งที่แก้เองเมื่อกลับมาออนไลน์
 */

export interface TripMember {
  uid: string;
  email: string;
  name: string;
}
export interface TripInfo {
  id: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  members: TripMember[];
  invites: string[];
}
export interface TripState {
  status: 'off' | 'loading' | 'live' | 'error';
  error: string;
  trip: TripInfo | null;
  /** ทริปที่ได้รับเชิญ (ยังไม่เข้าร่วม) */
  invited: { id: string; name: string; ownerEmail: string }[];
  /** มีทริปให้เลือกไหม (ใช้ตัดสินใจแสดงปุ่ม "สร้างทริปจากแผนในเครื่องนี้") */
  myTrips: { id: string; name: string }[];
  /** ใครแก้วันนั้นล่าสุด */
  dayMeta: Record<string, { name: string; at: number | null }>;
  pending: number;
  /** กำลังสร้าง/เข้าร่วม */
  busy: '' | 'create' | 'join' | 'invite';
}

const st: TripState = { status: 'off', error: '', trip: null, invited: [], myTrips: [], dayMeta: {}, pending: 0, busy: '' };
export const tripState = () => st;
export const mirrorId = (tripId: string) => `trip-${tripId}`;
export const inTrip = () => !!st.trip && app.plan.id === mirrorId(st.trip.id);
export const isTripOwner = () => !!st.trip && st.trip.ownerUid === user?.uid;

let fs: typeof import('firebase/firestore') | null = null;
let db: Firestore | null = null;
let user: AuthUser | null = null;
let unsubs: Unsubscribe[] = [];
let remote: RemoteTrip & { loaded: Set<string> } = { days: {}, places: {}, loaded: new Set() };
let remotePersonal: { packing?: unknown; prefs?: unknown; loaded: Set<string> } = { loaded: new Set() };
let lastSynced: TripDocs | null = null;
let lastPersonal: string | null = null;
let applying = false;
const photoDone = new Set<string>();
let onChange: () => void = () => {};
let onPersonalApplied: (kind: 'shop' | 'fx') => void = () => {};
let lastShopFx = { shop: '', fx: '' };

const changed = () => onChange();

async function ensureDb(): Promise<boolean> {
  if (db) return true;
  const fbApp = firebaseApp();
  if (!fbApp) return false;
  fs = await import('firebase/firestore');
  try {
    db = fs.initializeFirestore(fbApp, { ignoreUndefinedProperties: true, localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(fbApp);
  }
  if (FIRESTORE_EMULATOR) {
    const [host, port] = FIRESTORE_EMULATOR.replace(/^https?:\/\//, '').split(':');
    try {
      fs.connectFirestoreEmulator(db, host, Number(port));
    } catch {
      /* ต่อไว้แล้ว */
    }
  }
  return true;
}

const myName = () => user?.name || user?.email?.split('@')[0] || 'ฉัน';
const myEmail = () => (user?.email ?? '').toLowerCase();

/** เริ่มทำงาน: ฟังสถานะเข้าสู่ระบบ */
export function initTripSync(opts: { onChange: () => void; onPersonalApplied: (kind: 'shop' | 'fx') => void }) {
  onChange = opts.onChange;
  onPersonalApplied = opts.onPersonalApplied;
  app.addPersistHook(() => {
    if (!applying) void push();
  });
  onAuth((s) => {
    if (s.status === 'signed-in') void signedIn(s.user);
    else if (s.status === 'signed-out') signedOut();
  });
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
}

async function signedIn(u: AuthUser) {
  if (user?.uid === u.uid && st.status !== 'off') return;
  user = u;
  if (!(await ensureDb())) return;
  st.status = 'loading';
  changed();
  await refreshLists();
  void syncShopFx();
  const want = app.settings.activeTrip;
  const pick = st.myTrips.find((t) => t.id === want) ?? (st.myTrips.length === 1 ? st.myTrips[0] : null);
  if (pick) activate(pick.id);
  else {
    st.status = 'off';
    changed();
  }
}

function signedOut() {
  stopListeners();
  user = null;
  st.trip = null;
  st.invited = [];
  st.myTrips = [];
  st.status = 'off';
  // กลับไปใช้แผนในเครื่อง (สำเนาทริปเก็บไว้ในเครื่อง แต่ไม่ใช้จนกว่าจะเข้าสู่ระบบอีกครั้ง)
  const local = app.store.plans.find((p) => !p.id.startsWith('trip-'));
  if (local && app.plan.id.startsWith('trip-')) {
    app.store.activeId = local.id;
    app.activeDayId = local.days[0].id;
    app.persist();
  }
  changed();
}

/** ทริปของฉัน + คำเชิญที่รออยู่ */
export async function refreshLists() {
  if (!fs || !db || !user) return;
  const { collection, query, where, getDocs } = fs;
  try {
    const mine = await getDocs(query(collection(db, 'trips'), where('memberUids', 'array-contains', user.uid)));
    st.myTrips = mine.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? 'ทริป') }));
    const email = myEmail();
    if (email) {
      const inv = await getDocs(query(collection(db, 'trips'), where('invites', 'array-contains', email)));
      st.invited = inv.docs.filter((d) => !st.myTrips.some((m) => m.id === d.id)).map((d) => ({ id: d.id, name: String(d.data().name ?? 'ทริป'), ownerEmail: String(d.data().ownerEmail ?? '') }));
    }
    st.error = '';
  } catch (e) {
    st.error = errText(e);
  }
  changed();
}

function errText(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code.includes('permission-denied')) return 'ไม่มีสิทธิ์ (ยังไม่ได้รับเชิญ หรือถูกเอาออกจากทริป)';
  if (code.includes('unavailable')) return 'ออฟไลน์ — จะซิงก์เมื่อมีสัญญาณ';
  return `ซิงก์ไม่สำเร็จ${code ? ` (${code})` : ''}`;
}

/* ---------------- สร้าง / เข้าร่วม / ออก ---------------- */

/** สร้างทริปจากแผนที่เปิดอยู่ (เจ้าของ) — แผนเดิมยังอยู่ในเครื่องเป็นสำรอง */
export async function createTripFromLocal(): Promise<string> {
  if (!fs || !db || !user) return 'ยังไม่ได้เข้าสู่ระบบ';
  const { doc, collection, setDoc, writeBatch, serverTimestamp } = fs;
  const local = clone(app.plan);
  st.busy = 'create';
  changed();
  try {
    const ref = doc(collection(db, 'trips'));
    await setDoc(ref, {
      name: local.name,
      ownerUid: user.uid,
      ownerEmail: myEmail(),
      memberUids: [user.uid],
      members: { [user.uid]: { email: myEmail(), name: myName() } },
      invites: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const docs = planToTripDocs(local);
    const batch = writeBatch(db);
    batch.set(doc(db, `trips/${ref.id}/meta/order`), { dayOrder: docs.dayOrder });
    batch.set(doc(db, `trips/${ref.id}/meta/overrides`), docs.overrides);
    for (const [id, d] of Object.entries(docs.days)) batch.set(doc(db, `trips/${ref.id}/days/${id}`), { day: d, by: { uid: user.uid, name: myName() }, at: serverTimestamp() });
    for (const [id, p] of Object.entries(docs.places)) batch.set(doc(db, `trips/${ref.id}/places/${id}`), placeBody(p));
    await batch.commit();
    // สำเนาทริปในเครื่อง
    const mirror: Plan = { ...local, id: mirrorId(ref.id), roomId: null };
    app.store.plans = [...app.store.plans.filter((p) => p.id !== mirror.id), mirror];
    lastSynced = docs;
    await writePersonal(planToPersonal(mirror));
    st.myTrips = [...st.myTrips, { id: ref.id, name: local.name }];
    activate(ref.id);
    return '';
  } catch (e) {
    return errText(e);
  } finally {
    st.busy = '';
    changed();
  }
}

export async function joinTrip(id: string): Promise<string> {
  if (!fs || !db || !user) return 'ยังไม่ได้เข้าสู่ระบบ';
  const { doc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } = fs;
  st.busy = 'join';
  changed();
  try {
    await updateDoc(doc(db, `trips/${id}`), {
      memberUids: arrayUnion(user.uid),
      [`members.${user.uid}`]: { email: myEmail(), name: myName() },
      invites: arrayRemove(myEmail()),
      updatedAt: serverTimestamp(),
    });
    st.invited = st.invited.filter((t) => t.id !== id);
    await refreshLists();
    activate(id);
    return '';
  } catch (e) {
    return errText(e);
  } finally {
    st.busy = '';
    changed();
  }
}

/** เจ้าของ: เพิ่มอีเมลเชิญ (และส่งอีเมลลิงก์เข้าสู่ระบบถ้าเลือก) */
export async function invite(email: string, sendMail: boolean): Promise<string> {
  if (!fs || !db || !st.trip) return 'ยังไม่มีทริป';
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'อีเมลไม่ถูกต้อง';
  if (st.trip.members.some((m) => m.email === e)) return 'อีเมลนี้อยู่ในทริปแล้ว';
  const { doc, updateDoc, arrayUnion, serverTimestamp } = fs;
  st.busy = 'invite';
  changed();
  try {
    await updateDoc(doc(db, `trips/${st.trip.id}`), { invites: arrayUnion(e), updatedAt: serverTimestamp() });
    if (sendMail) {
      const err = await sendInviteLink(e);
      if (err) return `เชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ: ${err} — ส่งลิงก์เว็บให้เพื่อนเองได้`;
    }
    return '';
  } catch (err) {
    return errText(err);
  } finally {
    st.busy = '';
    changed();
  }
}

export async function uninvite(email: string): Promise<string> {
  if (!fs || !db || !st.trip) return '';
  const { doc, updateDoc, arrayRemove } = fs;
  try {
    await updateDoc(doc(db, `trips/${st.trip.id}`), { invites: arrayRemove(email) });
    return '';
  } catch (e) {
    return errText(e);
  }
}

/** เจ้าของเอาสมาชิกออก หรือ สมาชิกออกจากทริปเอง (uid = ตัวเอง) */
export async function removeMember(uid: string): Promise<string> {
  if (!fs || !db || !st.trip || !user) return '';
  const { doc, updateDoc, arrayRemove, deleteField, serverTimestamp } = fs;
  const tripId = st.trip.id;
  try {
    await updateDoc(doc(db, `trips/${tripId}`), { memberUids: arrayRemove(uid), [`members.${uid}`]: deleteField(), updatedAt: serverTimestamp() });
    if (uid === user.uid) {
      stopListeners();
      st.trip = null;
      st.myTrips = st.myTrips.filter((t) => t.id !== tripId);
      setActiveTrip(undefined);
      signedOutLocal();
    }
    return '';
  } catch (e) {
    return errText(e);
  } finally {
    changed();
  }
}

/** กลับไปใช้แผนในเครื่อง */
function signedOutLocal() {
  const local = app.store.plans.find((p) => !p.id.startsWith('trip-'));
  if (local) {
    app.store.activeId = local.id;
    app.activeDayId = local.days[0].id;
    app.persist();
  }
}

function setActiveTrip(id: string | undefined) {
  app.settings = { ...app.settings, activeTrip: id };
  saveSettings(app.settings);
}

/* ---------------- ฟังข้อมูลทริป ---------------- */

function stopListeners() {
  unsubs.forEach((u) => u());
  unsubs = [];
  remote = { days: {}, places: {}, loaded: new Set() };
  remotePersonal = { loaded: new Set() };
  lastSynced = null;
  lastPersonal = null;
  st.dayMeta = {};
}

export function activate(id: string) {
  if (!fs || !db || !user) return;
  if (st.trip?.id === id && unsubs.length) return;
  stopListeners();
  setActiveTrip(id);
  st.status = 'loading';
  // ใช้สำเนาในเครื่องทันที (ออฟไลน์ก็เปิดได้)
  const mirror = app.store.plans.find((p) => p.id === mirrorId(id));
  if (mirror) {
    app.store.activeId = mirror.id;
    if (!mirror.days.some((d) => d.id === app.activeDayId)) app.activeDayId = mirror.days[0].id;
    lastSynced ??= planToTripDocs(mirror);
  }
  const { doc, collection, onSnapshot } = fs;
  const base = `trips/${id}`;
  const fail = (e: unknown) => {
    st.status = 'error';
    st.error = errText(e);
    changed();
  };
  unsubs.push(
    onSnapshot(doc(db, base), (s) => {
      const d = s.data();
      if (!d) return;
      const members = Object.entries((d.members ?? {}) as Record<string, { email?: string; name?: string }>).map(([uid, m]) => ({ uid, email: String(m?.email ?? ''), name: String(m?.name ?? m?.email ?? '') }));
      st.trip = { id, name: String(d.name ?? 'ทริป'), ownerUid: String(d.ownerUid ?? ''), ownerEmail: String(d.ownerEmail ?? ''), members, invites: Array.isArray(d.invites) ? d.invites.map(String) : [] };
      remote.name = d.name;
      remote.loaded.add('trip');
      applyRemote();
    }, fail),
    onSnapshot(collection(db, `${base}/days`), (s) => {
      remote.days = {};
      for (const d of s.docs) {
        const v = d.data();
        remote.days[d.id] = v;
        const at = v.at && typeof v.at.toMillis === 'function' ? v.at.toMillis() : null;
        st.dayMeta[d.id] = { name: String(v.by?.name ?? ''), at };
      }
      remote.loaded.add('days');
      applyRemote();
    }, fail),
    onSnapshot(collection(db, `${base}/places`), (s) => {
      remote.places = Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
      remote.loaded.add('places');
      applyRemote();
    }, fail),
    onSnapshot(collection(db, `${base}/meta`), (s) => {
      for (const d of s.docs) {
        if (d.id === 'order') remote.dayOrder = d.data().dayOrder;
        if (d.id === 'overrides') remote.overrides = d.data();
      }
      remote.loaded.add('meta');
      applyRemote();
    }, fail),
    onSnapshot(doc(db, `users/${user.uid}/private/packing`), (s) => {
      remotePersonal.packing = s.exists() ? s.data().items : undefined;
      remotePersonal.loaded.add('packing');
      applyRemote();
    }, fail),
    onSnapshot(doc(db, `users/${user.uid}/private/prefs`), (s) => {
      remotePersonal.prefs = s.exists() ? s.data() : undefined;
      remotePersonal.loaded.add('prefs');
      applyRemote();
    }, fail),
  );
  changed();
}

/** ของส่วนตัวที่จะใช้กับสำเนาทริป: จากบัญชี (ถ้ามี) ไม่งั้นจากสำเนา/แผนในเครื่อง */
function personalFor(fallback: Plan | undefined): PersonalDocs {
  const local = fallback ?? app.store.plans.find((p) => !p.id.startsWith('trip-')) ?? app.plan;
  const lp = planToPersonal(local);
  const rp = (remotePersonal.prefs ?? null) as Partial<PersonalDocs['prefs']> | null;
  let packing: PackItem[] | null = remotePersonal.packing !== undefined ? cleanPacking(remotePersonal.packing) ?? null : lp.packing ?? null;
  // ครั้งแรกในเครื่องนี้ของบัญชีนี้: รวมรายการในเครื่องเข้าไปด้วย (ไม่ซ้ำชื่อในหมวดเดียวกัน · ติ๊กไว้ที่ไหนก็ยังติ๊ก)
  const flag = `stp.v1.personalMerged.${user?.uid}`;
  if (remotePersonal.packing !== undefined && packing && lp.packing?.length && !safeGet(flag)) {
    const key = (i: PackItem) => `${i.group}|${i.text}`;
    const local = lp.packing;
    const byKey = new Map(local.map((i) => [key(i), i]));
    const merged = mergePackingDone(packing, local)!.map((i) => (byKey.get(key(i))?.done && !i.done ? { ...i, done: true } : i));
    const have = new Set(merged.map(key));
    packing = [...merged, ...local.filter((i) => !have.has(key(i)))];
    safeSet(flag, '1');
    lastPersonal = null; // ให้ส่งรายการที่รวมแล้วขึ้นบัญชี
  }
  return {
    packing,
    prefs: rp ? { coldLevel: rp.coldLevel ?? lp.prefs.coldLevel, checklist: rp.checklist ?? lp.prefs.checklist, extraChecklist: rp.extraChecklist ?? lp.prefs.extraChecklist, saved: rp.saved ?? lp.prefs.saved } : lp.prefs,
  };
}

function applyRemote() {
  if (!st.trip || !user) return;
  if (!['trip', 'days', 'places', 'meta'].every((k) => remote.loaded.has(k))) return;
  if (!remotePersonal.loaded.has('packing') || !remotePersonal.loaded.has('prefs')) return;
  const id = mirrorId(st.trip.id);
  const current = app.store.plans.find((p) => p.id === id);
  const personal = personalFor(current);
  const plan = tripDocsToPlan(id, remote, personal, current);
  st.status = 'live';
  st.error = '';
  if (!plan) {
    changed();
    return;
  }
  const sameTrip = current && JSON.stringify(planToTripDocs(current)) === JSON.stringify(planToTripDocs(plan));
  const samePersonal = current && JSON.stringify(planToPersonal(current)) === JSON.stringify(planToPersonal(plan));
  lastSynced = planToTripDocs(plan);
  // ของส่วนตัวยังไม่เคยขึ้นบัญชี → ส่งของในเครื่องขึ้น (ครั้งแรกในบัญชีนี้)
  if (remotePersonal.packing === undefined || remotePersonal.prefs === undefined || lastPersonal === null && JSON.stringify(personal.packing) !== JSON.stringify(cleanPacking(remotePersonal.packing) ?? null)) void writePersonal(personal);
  else lastPersonal = JSON.stringify(personal);
  if (!sameTrip || !samePersonal) {
    applying = true;
    try {
      app.store.plans = current ? app.store.plans.map((p) => (p.id === id ? plan : p)) : [...app.store.plans, plan];
      if (app.store.activeId !== id) {
        app.store.activeId = id;
        app.activeDayId = plan.days[0].id;
      }
      if (!plan.days.some((d) => d.id === app.activeDayId)) app.activeDayId = plan.days[0].id;
      app.persist();
    } finally {
      applying = false;
    }
  } else if (app.store.activeId !== id) {
    app.store.activeId = id;
    app.persist();
  }
  void syncPhotos();
  app.requestRender();
  changed();
}

/* ---------------- ส่งที่แก้ในเครื่อง ---------------- */

function placeBody(p: TripDocs['places'][string]) {
  const { custom: _c, ...body } = JSON.parse(JSON.stringify(p));
  return body;
}

async function track<T>(pr: Promise<T>): Promise<T | undefined> {
  st.pending++;
  changed();
  try {
    return await pr;
  } catch (e) {
    st.status = 'error';
    st.error = errText(e);
    return undefined;
  } finally {
    st.pending--;
    changed();
  }
}

async function push() {
  if (!fs || !db || !user || !st.trip || app.plan.id !== mirrorId(st.trip.id) || !lastSynced) return;
  const { doc, setDoc, deleteDoc, updateDoc, serverTimestamp } = fs;
  const t = st.trip;
  const base = `trips/${t.id}`;
  const next = planToTripDocs(app.plan);
  const ops = diffTripDocs(lastSynced, next);
  lastSynced = next;
  const owner = t.ownerUid === user.uid;
  for (const op of ops) {
    if (op.kind === 'name') void track(updateDoc(doc(db, base), { name: op.data, updatedAt: serverTimestamp() }));
    else if (op.kind === 'order') {
      if (owner) void track(setDoc(doc(db, `${base}/meta/order`), { dayOrder: op.data }));
    } else if (op.kind === 'overrides') void track(setDoc(doc(db, `${base}/meta/overrides`), op.data));
    else if (op.kind === 'day') {
      if (op.data) void track(setDoc(doc(db, `${base}/days/${op.id}`), { day: op.data, by: { uid: user.uid, name: myName() }, at: serverTimestamp() }));
      else if (owner) void track(deleteDoc(doc(db, `${base}/days/${op.id}`)));
    } else if (op.kind === 'place') {
      if (op.data) void track(setDoc(doc(db, `${base}/places/${op.id}`), placeBody(op.data)));
      else void track(deleteDoc(doc(db, `${base}/places/${op.id}`)));
    }
  }
  const personal = planToPersonal(app.plan);
  if (JSON.stringify(personal) !== lastPersonal) await writePersonal(personal);
  void syncPhotos();
}

async function writePersonal(p: PersonalDocs) {
  if (!fs || !db || !user) return;
  const { doc, setDoc } = fs;
  lastPersonal = JSON.stringify(p);
  await Promise.all([
    track(setDoc(doc(db, `users/${user.uid}/private/packing`), { items: p.packing ?? null })),
    track(setDoc(doc(db, `users/${user.uid}/private/prefs`), JSON.parse(JSON.stringify(p.prefs)))),
  ]);
}

/* ---------------- รูปของสถานที่ ---------------- */

async function syncPhotos() {
  if (!st.trip) return;
  for (const p of app.plan.customPlaces) for (const ph of p.photos ?? []) if (!photoDone.has(ph)) void syncPhoto(st.trip.id, ph);
}

async function syncPhoto(tripId: string, id: string) {
  if (!fs || !db) return;
  photoDone.add(id);
  const { doc, getDoc, setDoc } = fs;
  const ref = doc(db, `trips/${tripId}/photos/${id}`);
  const mine = await placePhotos.photoBlob(id);
  try {
    if (mine) {
      const s = await getDoc(ref);
      if (!s.exists()) await track(setDoc(ref, { d: await toBase64(mine) }));
      return;
    }
    const s = await getDoc(ref);
    const d = s.exists() ? s.data().d : null;
    if (typeof d !== 'string') {
      photoDone.delete(id); // เพื่อนยังอัปโหลดไม่เสร็จ → ลองใหม่รอบหน้า
      return;
    }
    await placePhotos.putPhoto(id, fromBase64(d));
    app.requestRender();
  } catch {
    photoDone.delete(id);
  }
}

function toBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(b);
  });
}

function fromBase64(s: string): Blob {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: 'image/jpeg' });
}

/* ---------------- ของที่จะซื้อ + แปลงเงิน (ของส่วนตัว) ---------------- */

/** ครั้งแรกในเครื่องนี้: รวมของในเครื่องกับของในบัญชี แล้วฟังการเปลี่ยนแปลง */
async function syncShopFx() {
  if (!fs || !db || !user) return;
  const { doc, onSnapshot, setDoc } = fs;
  const uid = user.uid;
  unsubShopFx.forEach((u) => u());
  unsubShopFx = [
    onSnapshot(doc(db, `users/${uid}/private/shop`), (s) => {
      const local = loadShop();
      if (!s.exists()) {
        lastShopFx.shop = JSON.stringify(local);
        void track(setDoc(doc(db!, `users/${uid}/private/shop`), JSON.parse(lastShopFx.shop)));
        return;
      }
      const remoteShop = sanitizeShop(s.data());
      // รวมรายการ (id เดียวกัน = ใช้ของในบัญชี)
      const ids = new Set(remoteShop.items.map((i) => i.id));
      const merged = { ...remoteShop, items: [...remoteShop.items, ...local.items.filter((i) => !ids.has(i.id) && !seenShopIds.has(i.id))] };
      remoteShop.items.forEach((i) => seenShopIds.add(i.id));
      const json = JSON.stringify(merged);
      if (json !== JSON.stringify(local)) {
        saveShop(merged);
        onPersonalApplied('shop');
      }
      lastShopFx.shop = json;
      if (merged.items.length !== remoteShop.items.length) void track(setDoc(doc(db!, `users/${uid}/private/shop`), JSON.parse(json)));
    }),
    onSnapshot(doc(db, `users/${uid}/private/fx`), (s) => {
      const before = JSON.stringify(loadFx());
      if (!s.exists()) {
        lastShopFx.fx = before;
        void track(setDoc(doc(db!, `users/${uid}/private/fx`), JSON.parse(before)));
        return;
      }
      safeSet('stp.v1.fx', JSON.stringify(s.data()));
      const after = JSON.stringify(loadFx());
      if (after !== before) onPersonalApplied('fx');
      lastShopFx.fx = after;
    }),
  ];
}
let unsubShopFx: Unsubscribe[] = [];
/** id ของที่เคยเห็นในบัญชี — ถูกลบในเครื่องอื่นแล้วไม่ดึงกลับมาจากเครื่องนี้ */
const seenShopIds = new Set<string>();

/** เรียกหลังบันทึกของที่จะซื้อ/อัตราแลกเงินในเครื่องนี้ */
export function personalStoreChanged() {
  if (!fs || !db || !user) return;
  const { doc, setDoc } = fs;
  const shop = JSON.stringify(loadShop());
  const fx = JSON.stringify(loadFx());
  if (shop !== lastShopFx.shop) {
    lastShopFx.shop = shop;
    void track(setDoc(doc(db, `users/${user.uid}/private/shop`), JSON.parse(shop)));
  }
  if (fx !== lastShopFx.fx) {
    lastShopFx.fx = fx;
    void track(setDoc(doc(db, `users/${user.uid}/private/fx`), JSON.parse(fx)));
  }
}

export const signedInUser = () => (authState().status === 'signed-in' ? user : null);
