import { describe, it, expect } from 'vitest';
import { diffDays, suggestOrder } from '../../src/core/compare';
import { insertStop, newStop, updateStop } from '../../src/core/planOps';
import { ctxWith, day, places } from './helpers';

const T = { 'hotel>a': 10, 'a>b': 20, 'b>hotel': 30, 'a>c': 40, 'c>b': 35 };

describe('insertion compare', () => {
  it('แทรกจุดแล้วแสดงผลก่อนยืนยัน โดยไม่แก้แผนเดิม', () => {
    const d = day([['a', 60], ['b', 30]]);
    const snapshot = JSON.stringify(d);
    const x = newStop('place', 'c', 45);
    const nd = insertStop(d, 1, x);
    const r = diffDays(d, nd, ctxWith(T), () => '');
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(r.travelDelta).toBe(40 + 35 - 20);
    expect(r.endDelta).toBe(40 + 35 - 20 + 45);
    expect(r.complete).toBe(true);
  });

  it('รายงานนัดที่ได้รับผลกระทบ', () => {
    const d0 = day([['a', 60], ['b', 30]]);
    const d = updateStop(d0, d0.stops[1].uid, { lockedTime: '10:40' });
    const nd = insertStop(d, 1, newStop('place', 'c', 45));
    const r = diffDays(d, nd, ctxWith(T), () => 'B');
    expect(r.affectedLocks[0].lateAfter).toBeGreaterThan(0);
  });

  it('ข้อมูลเส้นทางของจุดใหม่ยังไม่มี → ผลต่างยังสรุปไม่ได้', () => {
    const d = day([['a', 60], ['b', 30]]);
    const nd = insertStop(d, 1, newStop('place', 'c', 45));
    const r = diffDays(d, nd, ctxWith({ 'hotel>a': 10, 'a>b': 20, 'b>hotel': 30 }), () => '');
    expect(r.complete).toBe(false);
    expect(r.endDelta).toBeNull();
    expect(r.travelDelta).toBeNull();
  });
});

describe('suggestOrder', () => {
  it('ลดการย้อนเส้นทาง และไม่ย้ายจุดที่ล็อกเวลา', () => {
    // hotel → c (ตะวันตก) → b (ตะวันออก) → a (ใกล้โรงแรม) ... ย้อนไปมา
    const d = day([['b', 30], ['c', 30], ['a', 30]]);
    const r = suggestOrder(d, (id) => places[id]);
    expect(r.changed).toBe(true);
    expect(r.afterM).toBeLessThan(r.beforeM);
    const locked = updateStop(d, d.stops[1].uid, { lockedTime: '12:00' });
    const r2 = suggestOrder(locked, (id) => places[id]);
    expect(r2.order[1]).toBe(d.stops[1].uid);
  });
});
