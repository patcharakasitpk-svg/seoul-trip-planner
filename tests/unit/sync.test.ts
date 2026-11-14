import { describe, it, expect, vi } from 'vitest';
import { RoomSync, fromRoomDoc, inviteUrl, isRoomId, newRoomId, roomFromHash, shouldApplyRemote, toRoomDoc, type RoomDoc } from '../../src/services/sync';
import { newPlan } from '../../src/core/planOps';
import { validatePlan } from '../../src/storage/validate';
import { exportablePlan } from '../../src/storage/share';

/** Firebase จำลอง: เก็บห้องในหน่วยความจำ · EventSource ได้ 'put' ตอนต่อ และทุกครั้งที่มีคนเขียน */
function fakeFirebase() {
  const rooms = new Map<string, unknown>();
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const key = (url: string) => url.replace(/^.*\/rooms\//, '').replace(/\.json$/, '');
  const emit = (k: string) => listeners.get(k)?.forEach((f) => f(rooms.get(k) ?? null));
  class ES {
    private fns: Record<string, ((ev: MessageEvent) => void)[]> = {};
    onerror: (() => void) | null = null;
    private k: string;
    private sub = (d: unknown) => this.fns.put?.forEach((f) => f({ data: JSON.stringify({ path: '/', data: d }) } as MessageEvent));
    constructor(url: string) {
      this.k = key(url);
      if (!listeners.has(this.k)) listeners.set(this.k, new Set());
      listeners.get(this.k)!.add(this.sub);
      queueMicrotask(() => this.sub(rooms.get(this.k) ?? null)); // ข้อมูลแรกตอนต่อ
    }
    addEventListener(t: string, f: (ev: MessageEvent) => void) {
      (this.fns[t] ??= []).push(f);
    }
    close() {
      listeners.get(this.k)?.delete(this.sub);
    }
  }
  const puts: string[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const k = key(url);
    if (init?.method === 'PUT') {
      rooms.set(k, JSON.parse(String(init.body)));
      puts.push(k);
      queueMicrotask(() => emit(k));
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(rooms.get(k) ?? null), { status: 200 });
  });
  return { rooms, puts, deps: { fetch: f as unknown as typeof fetch, EventSource: ES as unknown as typeof EventSource } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('ซิงก์สด: รูปแบบข้อมูล', () => {
  it('รหัสห้องสุ่ม 24 ตัว และอ่านจากลิงก์ชวนได้', () => {
    const id = newRoomId();
    expect(isRoomId(id)).toBe(true);
    expect(newRoomId()).not.toBe(id);
    const url = inviteUrl('https://x.github.io/seoul-trip-planner/#plan=abc', id);
    expect(url).toBe(`https://x.github.io/seoul-trip-planner/#room=${id}`);
    expect(roomFromHash(new URL(url).hash)).toBe(id);
    expect(roomFromHash('#room=short')).toBeNull();
    expect(roomFromHash('#plan=xyz')).toBeNull();
  });

  it('ลิงก์สำเนา/JSON ไม่พารหัสห้องไปด้วย แต่แผนในเครื่องเก็บรหัสห้องไว้', () => {
    const p = { ...newPlan(), roomId: newRoomId() };
    expect(exportablePlan(p).roomId).toBeUndefined();
    const v = validatePlan(JSON.parse(JSON.stringify(p)));
    expect(v.ok && v.plan.roomId).toBe(p.roomId);
    const bad = validatePlan({ ...JSON.parse(JSON.stringify(p)), roomId: '../../etc' });
    expect(bad.ok && bad.plan.roomId).toBeNull();
  });

  it('ข้อมูลจากห้องต้องผ่านการตรวจ และใช้รหัสแผน/ห้องของเครื่องนี้', () => {
    const p = newPlan('ทริปเพื่อน');
    const doc = toRoomDoc(p, 'A');
    const got = fromRoomDoc(doc, { id: 'local-id', roomId: 'R'.repeat(24) })!;
    expect(got.name).toBe('ทริปเพื่อน');
    expect(got.id).toBe('local-id');
    expect(got.roomId).toBe('R'.repeat(24));
    expect(fromRoomDoc({ plan: '{"version":2}' }, { id: 'x', roomId: 'R'.repeat(24) })).toBeNull();
    expect(fromRoomDoc({ plan: 'not json' }, { id: 'x', roomId: 'R'.repeat(24) })).toBeNull();
    expect(fromRoomDoc('evil', { id: 'x', roomId: 'R'.repeat(24) })).toBeNull();
  });

  it('ไม่ใช้ข้อมูลที่เครื่องตัวเองเพิ่งส่ง (ไม่วนลูป)', () => {
    const p = newPlan();
    const doc = toRoomDoc(p, 'A');
    expect(shouldApplyRemote(doc, 'A', doc.plan)).toBe(false);
    expect(shouldApplyRemote(doc, 'B', doc.plan)).toBe(false); // เนื้อหาเหมือนกันแล้ว
    expect(shouldApplyRemote({ ...doc, plan: doc.plan.replace('แผนเที่ยวโซล', 'แผนใหม่') }, 'B', doc.plan)).toBe(true);
  });
});

describe('ซิงก์สด: สองเครื่อง', () => {
  it('เพื่อนกดลิงก์เข้าห้อง → ไม่ส่งแผนว่างทับ และได้แผนของเจ้าของ', async () => {
    const fb = fakeFirebase();
    const room = newRoomId();
    const owner = newPlan('ทริปโซลของเรา');
    // เจ้าของเริ่มแชร์
    const a = new RoomSync('https://db', room, 'A', () => {}, () => {}, fb.deps, 0);
    a.push(toRoomDoc(owner, 'A'));
    a.start();
    await tick();
    expect(JSON.parse((fb.rooms.get(room) as RoomDoc).plan).name).toBe('ทริปโซลของเรา');

    // เพื่อนเข้าห้อง: มีแผนว่างในเครื่องที่ "ค้างส่ง" ก่อนได้ข้อมูลห้อง
    const got: (RoomDoc | null)[] = [];
    const b = new RoomSync('https://db', room, 'B', (d) => { got.push(d); b.clearPending(); }, () => {}, fb.deps, 0);
    b.push(toRoomDoc(newPlan('แผนว่าง'), 'B'));
    await b.flush(); // ยังไม่ ready → ต้องไม่ส่ง
    expect(fb.puts.filter((k) => k === room)).toHaveLength(1);
    b.start();
    await tick();
    expect(JSON.parse((fb.rooms.get(room) as RoomDoc).plan).name).toBe('ทริปโซลของเรา'); // ไม่ถูกทับ
    expect(JSON.parse(got[0]!.plan).name).toBe('ทริปโซลของเรา');
    a.stop();
    b.stop();
  });

  it('เครื่องหนึ่งแก้ → อีกเครื่องได้รับ', async () => {
    const fb = fakeFirebase();
    const room = newRoomId();
    const plan = newPlan('ทริป');
    const a = new RoomSync('https://db', room, 'A', () => {}, () => {}, fb.deps, 0);
    a.push(toRoomDoc(plan, 'A'));
    a.start();
    const seenByB: RoomDoc[] = [];
    const b = new RoomSync('https://db', room, 'B', (d) => d && seenByB.push(d), () => {}, fb.deps, 0);
    b.start();
    await tick();
    a.push(toRoomDoc({ ...plan, name: 'ทริป (แก้แล้ว)', updatedAt: new Date().toISOString() }, 'A'));
    await tick();
    expect(JSON.parse(seenByB[seenByB.length - 1].plan).name).toBe('ทริป (แก้แล้ว)');
    expect(seenByB[seenByB.length - 1].by).toBe('A');
    a.stop();
    b.stop();
  });

  it('ส่งไม่ได้ (ออฟไลน์) → เก็บไว้ส่งใหม่', async () => {
    const fb = fakeFirebase();
    const room = newRoomId();
    let online = false;
    const deps = { ...fb.deps, fetch: (async (u: string, i?: RequestInit) => { if (!online) throw new TypeError('offline'); return fb.deps.fetch(u, i); }) as typeof fetch };
    const states: string[] = [];
    const a = new RoomSync('https://db', room, 'A', () => {}, (s) => states.push(s.status), deps, 0);
    a.start();
    await tick();
    a.push(toRoomDoc(newPlan('x'), 'A'));
    await tick();
    expect(a.hasPending()).toBe(true);
    expect(states).toContain('pending');
    online = true;
    await a.flush();
    expect(a.hasPending()).toBe(false);
    expect(fb.rooms.has(room)).toBe(true);
    a.stop();
  });
});
