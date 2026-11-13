import { describe, it, expect } from 'vitest';
import { computeSchedule } from '../../src/core/schedule';
import { insertStop, moveStop, removeStop, updateStop, newStop, dinnerSlot } from '../../src/core/planOps';
import { ctxWith, day } from './helpers';

const T = { 'hotel>a': 10, 'a>b': 20, 'b>hotel': 30, 'a>hotel': 12, 'hotel>b': 25, 'b>a': 20, 'a>c': 40, 'c>b': 35 };

describe('schedule', () => {
  it('เปลี่ยนเวลาเริ่มแล้วตารางและช่วงกลับเปลี่ยนตาม', () => {
    const d = day([['a', 60], ['b', 30]]);
    const s1 = computeSchedule(d, ctxWith(T));
    expect(s1.stops[0].arrive).toBe(9 * 60 + 10);
    expect(s1.stops[1].arrive).toBe(9 * 60 + 10 + 60 + 20);
    expect(s1.end!.arrive).toBe(9 * 60 + 10 + 60 + 20 + 30 + 30);
    const s2 = computeSchedule({ ...d, startTime: '10:30' }, ctxWith(T));
    expect(s2.stops[0].arrive! - s1.stops[0].arrive!).toBe(90);
    expect(s2.end!.arrive! - s1.end!.arrive!).toBe(90);
    expect(s2.end!.slackMin).toBe(22 * 60 - s2.end!.arrive!);
  });

  it('เพิ่มเวลาแวะแล้วคำนวณช่วงที่เหลือใหม่', () => {
    const d = day([['a', 60], ['b', 30]]);
    const s1 = computeSchedule(d, ctxWith(T));
    const d2 = updateStop(d, d.stops[0].uid, { stayMin: 90 });
    const s2 = computeSchedule(d2, ctxWith(T));
    expect(s2.stops[1].arrive! - s1.stops[1].arrive!).toBe(30);
    expect(s2.end!.arrive! - s1.end!.arrive!).toBe(30);
  });

  it('สลับวิธีเดินทางแล้วใช้เวลาของวิธีใหม่', () => {
    const tbl = { ...T, 'a>b>TRANSIT': 20, 'a>b>WALKING': 50 };
    const d = day([['a', 60], ['b', 30]]);
    const s1 = computeSchedule(d, ctxWith(tbl));
    const d2 = { ...d, stops: d.stops.map((s, i) => (i === 1 ? { ...s, legIn: { ...s.legIn, mode: 'WALKING' as const } } : s)) };
    const s2 = computeSchedule(d2, ctxWith(tbl));
    expect(s2.stops[1].leg.travelMin).toBe(50);
    expect(s2.end!.arrive! - s1.end!.arrive!).toBe(30);
  });

  it('ลบหรือย้ายจุดแล้วเชื่อมช่วงเดินทางถูกต้อง', () => {
    const d = day([['a', 60], ['b', 30]]);
    const removed = computeSchedule(removeStop(d, d.stops[0].uid), ctxWith(T));
    expect(removed.stops[0].leg.fromId).toBe('hotel');
    expect(removed.stops[0].leg.toId).toBe('b');
    expect(removed.stops[0].leg.travelMin).toBe(25);
    const moved = computeSchedule(moveStop(d, d.stops[1].uid, -1), ctxWith(T));
    expect(moved.stops.map((s) => [s.leg.fromId, s.leg.toId])).toEqual([['hotel', 'b'], ['b', 'a']]);
    expect(moved.end!.leg.fromId).toBe('a');
  });

  it('เคารพเวลานัดที่ล็อก: มาก่อนรอ / มาช้าแสดงสาย ไม่เลื่อนเวลานัด', () => {
    const d = day([['a', 60], ['b', 30]]);
    const early = computeSchedule(updateStop(d, d.stops[1].uid, { lockedTime: '12:00' }), ctxWith(T));
    expect(early.stops[1].start).toBe(12 * 60);
    expect(early.stops[1].wait).toBe(12 * 60 - (9 * 60 + 10 + 60 + 20));
    const late = computeSchedule(updateStop(d, d.stops[1].uid, { lockedTime: '10:00' }), ctxWith(T));
    expect(late.stops[1].lateMin).toBe(30);
    expect(late.stops[1].start).toBe(10 * 60 + 30); // เริ่มเมื่อถึงจริง ไม่ย้อนเวลา
    expect(late.status).toBe('late');
  });

  it('ข้อมูลขาดไม่ถูกตีความเป็นศูนย์ และไม่สรุปว่าทัน', () => {
    const d = day([['a', 60], ['c', 30]]); // ไม่มี a>c และ c>hotel ในตารางบางส่วน
    const s = computeSchedule(d, ctxWith({ 'hotel>a': 10 }));
    expect(s.stops[1].leg.source).toBe('none');
    expect(s.stops[1].leg.travelMin).toBeNull();
    expect(s.stops[1].lowerBound).toBe(true);
    expect(s.end!.lowerBound).toBe(true);
    expect(s.end!.slackMin).toBeNull(); // ยังไม่สรุปว่าทัน
    expect(s.totalTravelMin).toBeNull();
    expect(s.status).toBe('incomplete');
    expect(s.missingLegs).toBe(2);
  });

  it('เวลาที่ผู้ใช้กรอกเองถูกใช้และติดสถานะ ผู้ใช้กำหนด', () => {
    const d = day([['a', 60], ['c', 30]]);
    const d2 = { ...d, stops: d.stops.map((s, i) => (i === 1 ? { ...s, legIn: { mode: 'TRANSIT' as const, manualMin: 45, manualKind: 'user' as const } } : s)) };
    const s = computeSchedule(d2, ctxWith({ 'hotel>a': 10, 'c>hotel': 40 }));
    expect(s.stops[1].leg.source).toBe('user');
    expect(s.stops[1].arrive).toBe(9 * 60 + 10 + 60 + 45);
    expect(s.status).toBe('ok');
  });

  it('คำนวณถึงจุดสิ้นสุดที่ผู้ใช้เลือกเสมอ (เช่น COEX)', () => {
    const d = day([['a', 30]], { endPlaceId: 'coex' });
    const s = computeSchedule(d, ctxWith({ 'hotel>a': 10, 'a>coex': 35 }));
    expect(s.end!.leg.toId).toBe('coex');
    expect(s.end!.arrive).toBe(9 * 60 + 10 + 30 + 35);
  });

  it('เวลาเผื่อแยกจากเวลาบริการ', () => {
    const d = day([['a', 30]], { bufferMin: 5 });
    const s = computeSchedule(d, ctxWith(T));
    expect(s.stops[0].leg.travelMin).toBe(10);
    expect(s.stops[0].leg.bufferMin).toBe(5);
    expect(s.stops[0].arrive).toBe(9 * 60 + 15);
    expect(s.totalTravelMin).toBe(22);
    expect(s.totalBufferMin).toBe(10);
  });

  it('ยังไม่กรอกเวลา: จัดรายการได้ แต่สถานะ no-time', () => {
    const d = day([['a', 30]], { startTime: null, date: null });
    const s = computeSchedule(d, ctxWith(T));
    expect(s.status).toBe('no-time');
    expect(s.stops[0].arrive).toBeNull();
    expect(s.messages.join()).toMatch(/ยังไม่เลือกวันที่/);
  });

  it('ช่องมื้อเย็นที่ยังไม่เลือกร้าน ไม่นับเวลาเดินทางเป็นศูนย์', () => {
    const d = day([['a', 30]]);
    const d2 = insertStop(d, 1, dinnerSlot());
    const s = computeSchedule(d2, ctxWith(T));
    expect(s.stops[1].leg.source).toBe('none');
    expect(s.stops[1].warnings).toContain('ยังไม่ได้เลือกร้าน');
    expect(s.end!.leg.source).toBe('none');
    expect(s.status).toBe('incomplete');
  });

  it('รายการพักไม่มีการเดินทาง และคำนวณต่อจากจุดเดิม', () => {
    const d = day([['a', 30]]);
    const d2 = insertStop(d, 1, newStop('break', null, 20));
    const s = computeSchedule(d2, ctxWith(T));
    expect(s.stops[1].leg.source).toBe('same');
    expect(s.end!.leg.fromId).toBe('a');
    expect(s.end!.arrive).toBe(9 * 60 + 10 + 30 + 20 + 12);
  });

  it('ส่งเวลาออกจริงของแต่ละช่วงให้บริการเส้นทาง', () => {
    const calls: string[] = [];
    computeSchedule(day([['a', 60], ['b', 30]]), ctxWith(T, calls));
    expect(calls).toEqual(['hotel>a>TRANSIT@540', 'a>b>TRANSIT@610', 'b>hotel>TRANSIT@660']);
  });

  it('เตือนเมื่อถึงก่อนเวลาเปิด', () => {
    const d = day([['shop', 30]], { startTime: '08:00' });
    const s = computeSchedule(d, ctxWith({ 'hotel>shop': 10, 'shop>hotel': 10 }));
    expect(s.stops[0].warnings.join()).toMatch(/ก่อนเวลาเปิด/);
  });
});
