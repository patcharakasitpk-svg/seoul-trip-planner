import { describe, it, expect } from 'vitest';
import { buildMapSpecs } from '../../src/ui/mapSpecs';
import { computeSchedule } from '../../src/core/schedule';
import { moveStop } from '../../src/core/planOps';
import { ctxWith, day, places } from './helpers';

const getPlace = (id: string | null | undefined) => (id ? places[id] : undefined);
const sched = (d: any) => computeSchedule(d, ctxWith({}));

describe('map specs', () => {
  const d1 = day([['a', 30], ['b', 30], ['nocoord', 30]]);
  const d2 = day([['b', 30], ['c', 30]]);
  it('หมุดตรงกับวันและลำดับในรายการ (ดูทุกวัน)', () => {
    const { markers } = buildMapSpecs({ days: [d1, d2], allDays: [d1, d2], mode: 'all', getPlace, schedule: sched, libraryPlaces: null });
    const byId = Object.fromEntries(markers.map((m) => [m.id, m]));
    expect(byId.a.badges.map((b) => b.text)).toEqual(['1-1']);
    expect(byId.b.badges.map((b) => b.text)).toEqual(['1-2', '2-1']); // หมุดเดียว หลายวัน
    expect(byId.b.badges[0].color).not.toBe(byId.b.badges[1].color);
    expect(byId.nocoord).toBeUndefined(); // ไม่ปักพิกัดที่ไม่มี
    expect(byId.hotel.kind).toBe('hotel');
    expect(byId.coex.kind).toBe('venue');
  });
  it('ย้ายลำดับแล้วหมายเลขหมุดเปลี่ยนตาม', () => {
    const moved = moveStop(d1, d1.stops[1].uid, -1);
    const { markers } = buildMapSpecs({ days: [moved], allDays: [moved, d2], mode: 'day', getPlace, schedule: sched, libraryPlaces: null });
    const byId = Object.fromEntries(markers.map((m) => [m.id, m]));
    expect(byId.b.badges[0].text).toBe('1');
    expect(byId.a.badges[0].text).toBe('2');
  });
  it('ไม่มีข้อมูลเส้นทาง → เส้นเชื่อมลำดับ (ไม่ใช่เส้นทางจริง)', () => {
    const { lines } = buildMapSpecs({ days: [d2], allDays: [d1, d2], mode: 'day', getPlace, schedule: sched, libraryPlaces: null });
    expect(lines.length).toBe(3); // hotel→b, b→c, c→hotel
    expect(lines.every((l) => !l.real)).toBe(true);
  });
});
