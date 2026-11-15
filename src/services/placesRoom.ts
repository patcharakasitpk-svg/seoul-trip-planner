import type { Place } from '../core/types';
import { customPlace } from '../storage/validate';

/**
 * แชร์ "สถานที่ที่เพิ่มเอง" กับเพื่อน ผ่าน Firebase Realtime Database (REST + EventSource)
 * places/<room>/<placeId> = สถานที่ 1 แห่ง (แยกกันทีละแห่ง → เพิ่มพร้อมกันไม่ทับกัน)
 * photos/<room>/<photoId> = { d: base64 JPEG }
 * ไม่มีระบบล็อกอิน: ใครมีลิงก์ชวน (รหัสห้องสุ่ม 24 ตัว) เพิ่ม/แก้ได้
 */

export type PlacesRoomState = { status: 'off' } | { status: 'connecting' } | { status: 'live'; lastAt: number } | { status: 'error'; message: string };

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** ค่าที่ใช้เทียบว่าสถานที่เหมือนกันไหม (ผ่านตัวตรวจเดียวกันทั้งของเครื่องนี้และจากห้อง) */
export function placeKey(p: unknown): string {
  const c = customPlace(p);
  return c ? JSON.stringify(c) : '';
}

/** รวมสถานที่จากห้องเข้ากับของในเครื่อง
 * - ของในห้อง = ฉบับจริง (แก้/เพิ่มจากเพื่อนเข้ามา)
 * - ของเครื่องนี้ที่ไม่อยู่ในห้อง: ถ้าเคยส่งขึ้นแล้ว = เพื่อนลบ → เอาออก (ยกเว้นยังอยู่ในแผน) · ยังไม่เคยส่ง = เก็บไว้ (รอส่ง)
 */
export function mergeRoomPlaces(local: Place[], remote: Record<string, unknown>, pushed: Set<string>, used: Set<string>): Place[] {
  const fromRoom = new Map<string, Place>();
  for (const [id, raw] of Object.entries(remote)) {
    if (!ID_RE.test(id)) continue;
    const c = customPlace({ ...(raw as object), id });
    if (c && c.id === id) fromRoom.set(id, c);
  }
  const out: Place[] = [];
  for (const p of local) {
    const r = fromRoom.get(p.id);
    if (r) {
      out.push(r);
      fromRoom.delete(p.id);
    } else if (!pushed.has(p.id) || used.has(p.id)) out.push(p);
  }
  return [...out, ...fromRoom.values()];
}

export interface RoomDeps {
  fetch: typeof fetch;
  EventSource: typeof EventSource;
}

export class PlacesRoom {
  private es: EventSource | null = null;
  /** ข้อมูลในห้อง (สะท้อนการเขียนของเครื่องนี้ทันที) */
  data: Record<string, unknown> = {};
  ready = false;
  state: PlacesRoomState = { status: 'connecting' };

  constructor(
    private db: string,
    readonly room: string,
    private onData: () => void,
    private onState: (s: PlacesRoomState) => void,
    private deps: RoomDeps = { fetch: (...a) => fetch(...a), EventSource },
  ) {}

  private url(path: string) {
    return `${this.db.replace(/\/+$/, '')}/${path}.json`;
  }

  private set(s: PlacesRoomState) {
    this.state = s;
    this.onState(s);
  }

  start() {
    this.set({ status: 'connecting' });
    const es = new this.deps.EventSource(this.url(`places/${this.room}`));
    this.es = es;
    const handle = (kind: 'put' | 'patch') => (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data) as { path: string; data: unknown };
        const parts = msg.path.split('/').filter(Boolean);
        if (!parts.length) {
          if (kind === 'put') this.data = msg.data && typeof msg.data === 'object' ? { ...(msg.data as object) } : {};
          else Object.assign(this.data, msg.data);
          for (const k of Object.keys(this.data)) if (this.data[k] == null) delete this.data[k];
        } else if (parts.length === 1) {
          if (msg.data == null) delete this.data[parts[0]];
          else this.data[parts[0]] = kind === 'patch' ? { ...(this.data[parts[0]] as object), ...(msg.data as object) } : msg.data;
        } else {
          // แก้ฟิลด์ย่อย → โหลดสถานที่นั้นใหม่ทั้งก้อน
          void this.refetch(parts[0]);
          return;
        }
        this.ready = true;
        this.set({ status: 'live', lastAt: Date.now() });
        this.onData();
      } catch {
        /* ข้อความเสีย — ข้าม */
      }
    };
    es.addEventListener('put', handle('put') as EventListener);
    es.addEventListener('patch', handle('patch') as EventListener);
    es.addEventListener('cancel', () => this.set({ status: 'error', message: 'ฐานข้อมูลไม่อนุญาต (ตรวจ Rules)' }));
    es.onerror = () => {
      if (this.state.status === 'live') this.set({ status: 'connecting' });
    };
  }

  private async refetch(id: string) {
    try {
      const r = await this.deps.fetch(this.url(`places/${this.room}/${id}`));
      if (!r.ok) return;
      const v = await r.json();
      if (v == null) delete this.data[id];
      else this.data[id] = v;
      this.onData();
    } catch {
      /* ออฟไลน์ */
    }
  }

  async putPlace(p: Place): Promise<boolean> {
    const { custom: _c, ...body } = p;
    this.data[p.id] = body;
    return this.write(`places/${this.room}/${p.id}`, 'PUT', body);
  }

  async deletePlace(id: string): Promise<boolean> {
    delete this.data[id];
    return this.write(`places/${this.room}/${id}`, 'DELETE');
  }

  async putPhoto(id: string, base64: string): Promise<boolean> {
    return this.write(`photos/${this.room}/${id}`, 'PUT', { d: base64 });
  }

  /** ห้องมีรูปนี้แล้วหรือยัง (shallow = ไม่ดาวน์โหลดตัวรูป) */
  async hasPhoto(id: string): Promise<boolean> {
    try {
      const r = await this.deps.fetch(`${this.url(`photos/${this.room}/${id}`)}?shallow=true`);
      return r.ok && (await r.json()) != null;
    } catch {
      return false;
    }
  }

  async getPhoto(id: string): Promise<string | null> {
    try {
      const r = await this.deps.fetch(this.url(`photos/${this.room}/${id}`));
      if (!r.ok) return null;
      const v = (await r.json()) as { d?: unknown } | null;
      return v && typeof v.d === 'string' && v.d.length < 3_000_000 ? v.d : null;
    } catch {
      return null;
    }
  }

  private async write(path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<boolean> {
    try {
      const r = await this.deps.fetch(this.url(path), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.status === 401 || r.status === 403) this.set({ status: 'error', message: 'ฐานข้อมูลไม่อนุญาต (ตรวจ Rules)' });
      return r.ok;
    } catch {
      return false;
    }
  }

  stop() {
    this.es?.close();
    this.es = null;
  }
}
