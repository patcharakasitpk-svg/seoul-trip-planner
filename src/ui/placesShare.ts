import { app } from './app';
import { esc } from './util';
import { SYNC_DB_URL } from '../config';
import { saveSettings } from '../storage/storage';
import { PlacesRoom, mergeRoomPlaces, placeKey, type PlacesRoomState } from '../services/placesRoom';
import { newRoomId, isRoomId } from '../services/sync';
import { placePhotos } from '../services/shopPhotos';

/**
 * ตัวเชื่อม "กลุ่มแชร์สถานที่" กับแผนในเครื่อง:
 * - ของจากห้อง → รวมเข้า customPlaces ของแผนที่เปิดอยู่
 * - ของที่แก้ในเครื่องนี้ (หน้าเพิ่มสถานที่ / ตัวจัดแผน) → ส่งขึ้นห้องอัตโนมัติ (เทียบกับที่ส่งล่าสุด)
 * - รูป: อัปโหลดรูปของเครื่องนี้ · ดาวน์โหลดรูปของเพื่อนเก็บใน IndexedDB
 */

let room: PlacesRoom | null = null;
let state: PlacesRoomState = { status: 'off' };
/** สถานที่ที่ส่งขึ้น/เห็นในห้องแล้ว (id → ค่าเทียบ) */
const pushed = new Map<string, string>();
const photoDone = new Set<string>();

export const placesShareAvailable = () => !!SYNC_DB_URL;
export const placesShareState = () => state;
export const inPlacesRoom = () => !!room;

export function inviteLink(): string | null {
  return app.settings.placesRoom ? `${location.href.split('#')[0]}#places=${app.settings.placesRoom}` : null;
}

export function placesRoomFromHash(hash: string): string | null {
  const m = /^#?places=([A-Za-z0-9]+)$/.exec(hash);
  return m && isRoomId(m[1]) ? m[1] : null;
}

function usedIds(): Set<string> {
  return new Set(app.plan.days.flatMap((d) => [d.startPlaceId, d.endPlaceId, ...d.stops.map((s) => s.placeId)]).filter((x): x is string => !!x));
}

function onData() {
  if (!room) return;
  const local = app.plan.customPlaces;
  // ครั้งแรกที่เข้าห้อง: ส่งของเครื่องนี้ที่ห้องยังไม่มีขึ้นไป (รวมของสองฝั่ง)
  const merged = mergeRoomPlaces(local, room.data, new Set(pushed.keys()), usedIds());
  for (const id of Object.keys(room.data)) pushed.set(id, placeKey({ ...(room.data[id] as object), id }));
  for (const id of [...pushed.keys()]) if (!(id in room.data) && !merged.some((p) => p.id === id)) pushed.delete(id);
  const changed = JSON.stringify(merged.map(placeKey)) !== JSON.stringify(local.map(placeKey));
  if (changed) app.commit((p) => (p.customPlaces = merged));
  else app.requestRender();
}

export function startPlacesShare() {
  const id = app.settings.placesRoom;
  if (!SYNC_DB_URL || !id || !isRoomId(id) || room?.room === id) return;
  room?.stop();
  pushed.clear();
  photoDone.clear();
  room = new PlacesRoom(SYNC_DB_URL, id, onData, (s) => {
    state = s;
    app.requestRender();
  });
  room.start();
}

export function joinPlacesRoom(id: string) {
  app.settings = { ...app.settings, placesRoom: id };
  saveSettings(app.settings);
  startPlacesShare();
}

export function createPlacesRoom() {
  joinPlacesRoom(newRoomId(24));
}

export function leavePlacesRoom() {
  room?.stop();
  room = null;
  state = { status: 'off' };
  pushed.clear();
  const { placesRoom: _r, ...rest } = app.settings;
  app.settings = rest;
  saveSettings(app.settings);
}

export function setMyName(name: string) {
  app.settings = { ...app.settings, myName: name.trim().slice(0, 30) || undefined };
  saveSettings(app.settings);
}

/** เรียกทุกครั้งหลังวาดหน้า: ส่งสิ่งที่แก้ในเครื่องนี้ขึ้นห้อง + จัดการรูป */
export function syncPlacesShare() {
  if (!room || !room.ready) return;
  const local = app.plan.customPlaces;
  const ids = new Set(local.map((p) => p.id));
  for (const p of local) {
    const k = placeKey(p);
    if (!k || pushed.get(p.id) === k) continue;
    pushed.set(p.id, k);
    void room.putPlace(p);
  }
  for (const id of [...pushed.keys()]) {
    if (ids.has(id)) continue;
    pushed.delete(id);
    if (id in room.data) void room.deletePlace(id);
  }
  for (const p of local) for (const ph of p.photos ?? []) if (!photoDone.has(ph)) void syncPhoto(ph);
}

async function syncPhoto(id: string) {
  photoDone.add(id);
  const r = room;
  if (!r) return;
  const mine = await placePhotos.photoBlob(id);
  if (mine) {
    // มีในเครื่องนี้ → ส่งขึ้นห้อง ถ้าห้องยังไม่มี
    if (!(await r.hasPhoto(id))) await r.putPhoto(id, await toBase64(mine));
    return;
  }
  const b64 = await r.getPhoto(id);
  if (!b64) {
    photoDone.delete(id); // ยังไม่มีในห้อง (เพื่อนกำลังอัปโหลด) → ลองใหม่รอบหน้า
    return;
  }
  await placePhotos.putPhoto(id, fromBase64(b64));
  app.requestRender();
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

/** การ์ดบนหน้าเพิ่มสถานที่ */
export function shareCardHtml(): string {
  if (!SYNC_DB_URL) return '';
  const name = app.settings.myName ?? '';
  const nameField = `<label class="pp-myname">ชื่อของคุณ (เพื่อนเห็น)<input class="inp sm" data-pp-name value="${esc(name)}" maxlength="30" placeholder="เช่น ต้อม" enterkeyhint="done"></label>`;
  if (!app.settings.placesRoom)
    return `<div class="pp-share card"><b>แชร์สถานที่กับเพื่อน</b><p class="muted small">เพื่อนเพิ่มสถานที่ได้ และเห็นของกันและกันทันที (รวมรูป) · ใครมีลิงก์ชวนเพิ่ม/แก้ได้ ส่งเฉพาะคนที่ไปด้วย</p>${nameField}<button class="btn sm primary" data-pp="share-start">เริ่มแชร์</button></div>`;
  const st = state;
  const status =
    st.status === 'live'
      ? `<span class="ok-text">● แชร์กับเพื่อนอยู่</span> <span class="muted small">อัปเดต ${new Date(st.lastAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>`
      : st.status === 'error'
        ? `<span class="bad-text">แชร์ไม่ได้: ${esc(st.message)}</span>`
        : '<span class="muted">กำลังเชื่อมต่อ…</span>';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return `<div class="pp-share card on">
    <div class="pp-share-row">${status}</div>
    <div class="row-btns">${canShare ? '<button class="btn sm primary" data-pp="share-send">ส่งลิงก์ชวนเพื่อน</button>' : ''}<button class="btn sm ${canShare ? '' : 'primary'}" data-pp="share-copy">คัดลอกลิงก์ชวน</button><button class="btn sm ghost" data-pp="share-stop">หยุดแชร์ในเครื่องนี้</button></div>
    ${nameField}
  </div>`;
}
