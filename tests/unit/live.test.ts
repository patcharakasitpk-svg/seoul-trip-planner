import { describe, it, expect } from 'vitest';
import { computeSchedule, livePhase } from '../../src/core/schedule';
import { validatePlan } from '../../src/storage/validate';
import { newPlan } from '../../src/core/planOps';
import { ctxWith, day } from './helpers';

const H = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
// ทุกช่วงเดินทาง 30 นาที: hotel→a→b→hotel
const ctx = ctxWith({ 'hotel>a': 30, 'a>b': 30, 'b>hotel': 30 });
const live = (now: string, est: number | null = null) => ({ ...ctx, live: { now: H(now), estimate: () => est } });

describe('โหมดเดินทางจริง (เช็กอิน)', () => {
  it('ไม่มีเวลาจริง = เหมือนแผน', () => {
    const d = day([['a', 60], ['b', 60]]);
    const s = computeSchedule(d, live('08:00'));
    expect(s.stops.map((t) => t.arrive)).toEqual([H('09:30'), H('11:00')]);
  });

  it('ออกจริงช้า 20 นาที → ทั้งวันเลื่อนตาม', () => {
    const d = day([['a', 60], ['b', 60]], { actual: { __start: { d: '09:20' } } });
    const s = computeSchedule(d, live('09:25'));
    expect(s.stops[0].arrive).toBe(H('09:50'));
    expect(s.stops[1].arrive).toBe(H('11:20'));
  });

  it('ถึงจริงแล้วยังไม่ออก แต่อยู่นานกว่าแผน → เวลาออกใช้ "ตอนนี้" และจุดถัดไปเลื่อน', () => {
    const d = day([['a', 60], ['b', 60]]);
    d.actual = { __start: { d: '09:00' }, [d.stops[0].uid]: { a: '09:30' } };
    const s = computeSchedule(d, live('10:50')); // แผนออก 10:30 แต่ยังอยู่
    expect(s.stops[0].arrive).toBe(H('09:30'));
    expect(s.stops[0].depart).toBe(H('10:50'));
    expect(s.stops[1].arrive).toBe(H('11:20'));
  });

  it('ออกจริงแล้ว ใช้เวลาออกจริง', () => {
    const d = day([['a', 60], ['b', 60]]);
    d.actual = { __start: { d: '09:00' }, [d.stops[0].uid]: { a: '09:30', d: '10:05' } };
    const s = computeSchedule(d, live('10:06'));
    expect(s.stops[0].depart).toBe(H('10:05'));
    expect(s.stops[1].arrive).toBe(H('10:35'));
  });

  it('ไม่มีข้อมูลเดินทาง → ใช้ค่าประมาณจากระยะ (source auto) เฉพาะโหมดเดินทางจริง', () => {
    const d = day([['a', 60], ['c', 30]]); // a→c ไม่มีในตาราง
    const plan = computeSchedule(d, ctx);
    expect(plan.stops[1].leg.source).toBe('none');
    const s = computeSchedule(d, live('08:00', 25));
    expect(s.stops[1].leg).toMatchObject({ source: 'auto', travelMin: 25 });
    expect(s.stops[1].lowerBound).toBe(false);
  });

  it('เวลาจริงทำให้ "ไม่แน่ใจ" หายไป', () => {
    const d = day([['a', 60], ['c', 30]]); // a→c ไม่มีข้อมูล
    d.actual = { __start: { d: '09:00' }, [d.stops[0].uid]: { a: '09:30', d: '10:30' }, [d.stops[1].uid]: { a: '11:10' } };
    const s = computeSchedule(d, live('11:15'));
    expect(s.stops[1].arrive).toBe(H('11:10'));
    expect(s.stops[1].lowerBound).toBe(false);
  });

  it('จะไม่ทันนัดที่ล็อกไว้ → สาย', () => {
    const d = day([['a', 60], ['b', 60]]);
    d.stops[1].lockedTime = '11:00';
    d.actual = { __start: { d: '09:00' }, [d.stops[0].uid]: { a: '09:30' } };
    const s = computeSchedule(d, live('10:45')); // ยังอยู่ a → ถึง b 11:15
    expect(s.stops[1].lateMin).toBe(15);
  });
});

describe('สถานะตอนนี้ (phase)', () => {
  const d = day([['a', 60], ['b', 60]]);
  const [u1, u2] = d.stops.map((s) => s.uid);
  it('ยังไม่ออก → ready', () => expect(livePhase({ ...d, actual: {} })).toEqual({ kind: 'ready' }));
  it('ออกแล้ว ยังไม่ถึงจุดแรก → moving ไปจุดแรก', () => expect(livePhase({ ...d, actual: { __start: { d: '09:00' } } })).toEqual({ kind: 'moving', uid: u1 }));
  it('ถึงแล้วยังไม่ออก → at', () => expect(livePhase({ ...d, actual: { __start: { d: '09:00' }, [u1]: { a: '09:30' } } })).toEqual({ kind: 'at', uid: u1 }));
  it('ออกจากจุดสุดท้าย → returning', () =>
    expect(livePhase({ ...d, actual: { __start: { d: '09:00' }, [u1]: { a: '09:30', d: '10:30' }, [u2]: { a: '11:00', d: '12:00' } } })).toEqual({ kind: 'returning' }));
  it('ถึงที่พัก → done', () => expect(livePhase({ ...d, actual: { __start: { d: '09:00' }, __end: { a: '13:00' } } })).toEqual({ kind: 'done' }));
  it('ข้ามรายการ = ไม่ต้องไป', () => {
    const d2 = { ...d, stops: [{ ...d.stops[0], skipped: true }, d.stops[1]], actual: { __start: { d: '09:00' } } };
    expect(livePhase(d2)).toEqual({ kind: 'moving', uid: u2 });
  });
});

describe('เก็บเวลาจริงในแผน', () => {
  it('ผ่านการตรวจ เก็บเฉพาะรูปแบบ HH:MM', () => {
    const p = newPlan();
    const uid = 'abc';
    p.days[0].actual = { __start: { d: '09:05' }, [uid]: { a: '10:00', d: 'zz' } } as any;
    const v = validatePlan(JSON.parse(JSON.stringify(p)));
    expect(v.ok && v.plan.days[0].actual).toEqual({ __start: { d: '09:05' }, [uid]: { a: '10:00' } });
  });
});

import { liveEstimateMin } from '../../src/core/geo';
describe('เวลาเดินทางโดยประมาณ (หน้า วันนี้)', () => {
  it('ระยะใกล้ใช้เวลาเดิน แม้ตั้งเป็นรถสาธารณะ', () => {
    expect(liveEstimateMin(200, 'TRANSIT')).toBeLessThanOrEqual(4); // ในอาคารเดียวกัน
    expect(liveEstimateMin(1000, 'TRANSIT')).toBeLessThanOrEqual(18);
    expect(liveEstimateMin(1000, 'TRANSIT')).toBe(liveEstimateMin(1000, 'WALKING'));
  });
  it('ระยะไกลใช้รถสาธารณะ', () => {
    expect(liveEstimateMin(8000, 'TRANSIT')).toBeLessThan(liveEstimateMin(8000, 'WALKING'));
  });
});
