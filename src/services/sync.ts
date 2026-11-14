import type { Plan } from '../core/types';
import { validatePlan } from '../storage/validate';
import { exportablePlan } from '../storage/share';

/**
 * ซิงก์แผนสดระหว่างเครื่องผ่าน Firebase Realtime Database (REST + EventSource — ไม่ต้องใช้ SDK)
 * ห้อง = rooms/<roomId> เก็บ { plan: JSON string, updatedAt, by } · ใครบันทึกทีหลังชนะ (ทั้งแผน)
 */
export interface RoomDoc {
  plan: string;
  updatedAt: string;
  by: string;
}

export type SyncState =
  | { status: 'off' }
  | { status: 'connecting'; roomId: string }
  | { status: 'live'; roomId: string; lastAt: string | null }
  | { status: 'pending'; roomId: string; lastAt: string | null } // มีการแก้ที่ยังส่งไม่ได้ (ออฟไลน์)
  | { status: 'error'; roomId: string; message: string };

const ROOM_RE = /^[A-Za-z0-9]{20,40}$/;
export const isRoomId = (s: unknown): s is string => typeof s === 'string' && ROOM_RE.test(s);

export function newRoomId(len = 24): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => abc[n % abc.length]).join('');
}

export function roomUrl(dbUrl: string, roomId: string): string {
  return `${dbUrl.replace(/\/+$/, '')}/rooms/${roomId}.json`;
}

/** ลิงก์ชวนเพื่อนเข้าห้อง */
export function inviteUrl(baseUrl: string, roomId: string): string {
  return `${baseUrl.split('#')[0]}#room=${roomId}`;
}

export function roomFromHash(hash: string): string | null {
  const m = /^#?room=([A-Za-z0-9]+)$/.exec(hash);
  return m && isRoomId(m[1]) ? m[1] : null;
}

/** ข้อมูลที่ส่งขึ้นห้อง (ไม่รวมรหัสห้อง/รหัสแผนของเครื่อง) */
export function toRoomDoc(plan: Plan, by: string): RoomDoc {
  const { id: _id, ...rest } = exportablePlan(plan);
  return { plan: JSON.stringify(rest), updatedAt: plan.updatedAt, by };
}

/** แปลงข้อมูลจากห้อง → แผนที่ผ่านการตรวจ (ข้อมูลจากภายนอก ต้องตรวจทุกครั้ง) */
export function fromRoomDoc(doc: unknown, local: { id: string; roomId: string }): Plan | null {
  if (!doc || typeof doc !== 'object') return null;
  const d = doc as Partial<RoomDoc>;
  if (typeof d.plan !== 'string' || d.plan.length > 400_000) return null;
  try {
    const v = validatePlan({ ...JSON.parse(d.plan), id: local.id });
    if (!v.ok) return null;
    return { ...v.plan, id: local.id, roomId: local.roomId, updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : v.plan.updatedAt };
  } catch {
    return null;
  }
}

/** ควรใช้ข้อมูลจากห้องแทนของในเครื่องไหม: ไม่ใช่ของที่เครื่องนี้เพิ่งส่ง และเนื้อหาต่างจากในเครื่อง */
export function shouldApplyRemote(doc: RoomDoc | null, clientId: string, localDocPlan: string): boolean {
  if (!doc || typeof doc.plan !== 'string') return false;
  if (doc.by === clientId && doc.plan === localDocPlan) return false;
  return doc.plan !== localDocPlan;
}

export interface SyncDeps {
  fetch: typeof fetch;
  EventSource: typeof EventSource;
}

/** ตัวจัดการห้องเดียว: ฟังการเปลี่ยนแปลง + ส่งแผนแบบหน่วงเวลา (debounce) + ส่งซ้ำเมื่อกลับมาออนไลน์ */
export class RoomSync {
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private pending: RoomDoc | null = null;
  /** ได้ข้อมูลจากห้องครั้งแรกแล้ว — ก่อนหน้านี้ห้ามส่ง (กันแผนว่างของเครื่องที่เพิ่งเข้าห้องไปเขียนทับแผนเพื่อน) */
  ready = false;
  lastSent = '';
  state: SyncState;

  constructor(
    private dbUrl: string,
    readonly roomId: string,
    readonly clientId: string,
    private onRemote: (doc: RoomDoc | null) => void,
    private onState: (s: SyncState) => void,
    private deps: SyncDeps = { fetch: (...a) => fetch(...a), EventSource },
    private debounceMs = 700,
  ) {
    this.state = { status: 'connecting', roomId };
  }

  private set(s: SyncState) {
    this.state = s;
    this.onState(s);
  }

  start() {
    this.set({ status: 'connecting', roomId: this.roomId });
    const es = new this.deps.EventSource(roomUrl(this.dbUrl, this.roomId));
    this.es = es;
    const onPut = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data) as { path: string; data: unknown };
        const first = !this.ready;
        this.ready = true;
        if (msg.path === '/') this.onRemote((msg.data as RoomDoc) ?? null);
        else this.refetch(); // อัปเดตบางส่วน (ไม่ควรเกิดเพราะเราเขียนทั้งก้อน) → โหลดใหม่ทั้งห้อง
        if (first && this.pending) void this.flush();
        if (this.state.status === 'connecting' || this.state.status === 'error') this.set({ status: 'live', roomId: this.roomId, lastAt: (msg.data as RoomDoc | null)?.updatedAt ?? null });
      } catch {
        /* ข้อความเสีย — ข้าม */
      }
    };
    es.addEventListener('put', onPut as EventListener);
    es.addEventListener('patch', onPut as EventListener);
    es.addEventListener('cancel', () => this.set({ status: 'error', roomId: this.roomId, message: 'ฐานข้อมูลไม่อนุญาต (ตรวจ Rules)' }));
    es.onerror = () => {
      if (this.state.status === 'live') this.set({ status: 'connecting', roomId: this.roomId }); // EventSource ต่อใหม่เอง
    };
    this.retry = setInterval(() => this.flush(), 15000);
  }

  private async refetch() {
    try {
      const r = await this.deps.fetch(roomUrl(this.dbUrl, this.roomId));
      if (r.ok) this.onRemote(await r.json());
    } catch {
      /* ออฟไลน์ */
    }
  }

  /** แผนในเครื่องเปลี่ยน → ส่งขึ้นห้องหลังหยุดแก้สักครู่ */
  push(doc: RoomDoc) {
    if (doc.plan === this.lastSent) return;
    this.pending = doc;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const doc = this.pending;
    if (!doc || !this.ready) return;
    try {
      const r = await this.deps.fetch(roomUrl(this.dbUrl, this.roomId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
      if (!r.ok) throw new Error(String(r.status));
      if (this.pending === doc) this.pending = null;
      this.lastSent = doc.plan;
      this.set({ status: 'live', roomId: this.roomId, lastAt: doc.updatedAt });
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline || !(e instanceof Error) || !/^\d+$/.test(e.message)) this.set({ status: 'pending', roomId: this.roomId, lastAt: null });
      else this.set({ status: 'error', roomId: this.roomId, message: e.message === '401' || e.message === '403' ? 'ฐานข้อมูลไม่อนุญาต (ตรวจ Rules)' : `ส่งไม่สำเร็จ (${e.message})` });
    }
  }

  hasPending() {
    return !!this.pending;
  }

  clearPending() {
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stop() {
    this.es?.close();
    this.es = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearInterval(this.retry);
  }
}
