import { describe, it, expect } from 'vitest';
import { mergeRoomPlaces, PlacesRoom, placeKey } from '../../src/services/placesRoom';
import type { Place } from '../../src/core/types';

const P = (id: string, name: string, extra: Partial<Place> = {}): Place =>
  ({ id, nameTh: name, nameEn: name, category: 'food', area: 'x', lat: 37.5, lng: 127, coordStatus: 'user', reasonTh: 'เพิ่มเอง', suggestedStayMin: 45, indoor: true, sources: [], custom: true, ...extra }) as Place;

describe('แชร์สถานที่กับเพื่อน: รวมข้อมูล', () => {
  it('ของเพื่อนเข้ามา · ของที่เพื่อนแก้ใช้ฉบับในห้อง · ของเครื่องนี้ที่ยังไม่ส่งคงไว้', () => {
    const local = [P('custom-a', 'A'), P('custom-mine', 'ของฉันยังไม่ส่ง')];
    const remote = { 'custom-a': { ...P('custom-a', 'A (เพื่อนแก้)'), custom: undefined }, 'custom-f': P('custom-f', 'ร้านของเพื่อน', { addedBy: 'บี' }) };
    const out = mergeRoomPlaces(local, remote, new Set(['custom-a']), new Set());
    expect(out.map((p) => p.nameTh)).toEqual(['A (เพื่อนแก้)', 'ของฉันยังไม่ส่ง', 'ร้านของเพื่อน']);
    expect(out[2].addedBy).toBe('บี');
    expect(out.every((p) => p.custom)).toBe(true);
  });
  it('เพื่อนลบ → เอาออก แต่ถ้ายังอยู่ในแผนของเครื่องนี้ เก็บไว้', () => {
    const local = [P('custom-a', 'A'), P('custom-b', 'B')];
    const out = mergeRoomPlaces(local, {}, new Set(['custom-a', 'custom-b']), new Set(['custom-b']));
    expect(out.map((p) => p.id)).toEqual(['custom-b']);
  });
  it('ข้อมูลเสีย/รหัสแปลกจากห้องถูกข้าม · ลิงก์อันตรายถูกตัด', () => {
    const out = mergeRoomPlaces([], { 'bad id!': P('x', 'x'), 'custom-z': { nameTh: 'Z', links: ['javascript:alert(1)', 'https://ok.com'] }, 'custom-y': 5 }, new Set(), new Set());
    expect(out.map((p) => p.id)).toEqual(['custom-z']);
    expect(out[0].links).toEqual(['https://ok.com']);
  });
  it('ค่าเทียบเหมือนกันไม่ว่ามาจากเครื่องนี้หรือจากห้อง (ไม่ส่งซ้ำวนไปมา)', () => {
    const p = P('custom-a', 'A');
    const { custom: _c, ...body } = p;
    expect(placeKey({ ...body, id: 'custom-a' })).toBe(placeKey(p));
  });
});

class FakeES {
  static last: FakeES;
  listeners: Record<string, (e: MessageEvent) => void> = {};
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeES.last = this;
  }
  addEventListener(t: string, f: (e: MessageEvent) => void) {
    this.listeners[t] = f;
  }
  emit(t: string, data: unknown) {
    this.listeners[t]({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() {}
}

describe('ห้องสถานที่: รับการเปลี่ยนแปลงทีละแห่ง', () => {
  it('ข้อมูลทั้งห้อง → เพิ่มทีละแห่ง → ลบ · เขียนผ่าน PUT/DELETE ที่ path ของสถานที่นั้น', async () => {
    const calls: [string, string][] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', url]);
      return new Response('null', { status: 200 });
    }) as unknown as typeof fetch;
    let n = 0;
    const r = new PlacesRoom('https://db.example', 'R'.repeat(24), () => n++, () => {}, { fetch: fetchFn, EventSource: FakeES as unknown as typeof EventSource });
    r.start();
    expect(FakeES.last.url).toBe(`https://db.example/places/${'R'.repeat(24)}.json`);
    FakeES.last.emit('put', { path: '/', data: { 'custom-a': { nameTh: 'A' } } });
    FakeES.last.emit('put', { path: '/custom-b', data: { nameTh: 'B' } });
    expect(Object.keys(r.data)).toEqual(['custom-a', 'custom-b']);
    FakeES.last.emit('put', { path: '/custom-a', data: null });
    expect(Object.keys(r.data)).toEqual(['custom-b']);
    expect(r.ready).toBe(true);
    expect(n).toBe(3);
    await r.putPlace(P('custom-c', 'C'));
    await r.deletePlace('custom-b');
    expect(calls).toEqual([
      ['PUT', `https://db.example/places/${'R'.repeat(24)}/custom-c.json`],
      ['DELETE', `https://db.example/places/${'R'.repeat(24)}/custom-b.json`],
    ]);
    expect(Object.keys(r.data)).toEqual(['custom-c']);
  });
});
