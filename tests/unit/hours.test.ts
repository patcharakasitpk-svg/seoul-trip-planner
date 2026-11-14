import { describe, it, expect } from 'vitest';
import { closedOn, weekdayOf } from '../../src/core/hours';
import { computeSchedule } from '../../src/core/schedule';
import { tripDates, newPlan, applyTripDates, newDay, newStop, dinnerSlot, moveStopToDay, tripSetupNeeded } from '../../src/core/planOps';
import { PUBLIC_PLACES } from '../../src/data/places';
import { ctxWith, day, places, P } from './helpers';

describe('trip dates & closed days', () => {
  it('ช่วงวันเที่ยว 30 พ.ย. – 6 ธ.ค. 2026 = 7 วัน', () => {
    const d = tripDates();
    expect(d).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
    expect(weekdayOf('2026-11-30')).toBe(1); // จันทร์
    expect(weekdayOf('2026-12-06')).toBe(0); // อาทิตย์
    expect(newPlan().days.map((x) => x.date)).toEqual(d);
  });
  it('ตั้งวันที่ให้แผนเดิมโดยไม่ลบรายการ', () => {
    const p = newPlan();
    p.days = [newDay(), newDay()];
    p.days[0].stops = [];
    applyTripDates(p);
    expect(p.days).toHaveLength(7);
    expect(p.days[0].stops).toEqual([]);
    expect(p.days[6].date).toBe('2026-12-06');
  });
  it('แผนเดิมที่มีวันที่แล้ว — ของที่จัดไว้ไม่เลื่อนวัน และเติมวันที่ขาดตามลำดับ', () => {
    const p = newPlan();
    p.days = ['2026-12-01', '2026-11-30'].map((date) => ({ ...newDay(), date }));
    p.days[1].stops = [newStop('place', 'gwangjang', 60)];
    applyTripDates(p);
    expect(p.days.map((x) => x.date)).toEqual(tripDates());
    expect(p.days[0].date).toBe('2026-11-30');
    expect(p.days[0].stops[0].placeId).toBe('gwangjang');
  });
  it('วันแรกเริ่มที่สนามบิน 08:00 · คืน 5 ธ.ค. นอนซูวอน · วันสุดท้ายถึงสนามบิน 14:00', () => {
    const p = newPlan();
    const by = (date: string) => p.days.find((x) => x.date === date)!;
    expect(by('2026-11-30')).toMatchObject({ startPlaceId: 'icn', startTime: '08:00', endPlaceId: 'hotel' });
    expect(by('2026-12-05').endPlaceId).toBe('novotel-suwon');
    expect(by('2026-12-06')).toMatchObject({ startPlaceId: 'novotel-suwon', endPlaceId: 'icn', endTime: '14:00' });
    expect(tripSetupNeeded(p)).toBe(false);
    by('2026-12-06').endPlaceId = 'hotel';
    expect(tripSetupNeeded(p)).toBe(true);
  });
  it('ย้ายจุดแวะไปวันอื่น (วางก่อนมื้อเย็น และล้างเวลานัด)', () => {
    const p = newPlan();
    const [a, b] = p.days;
    a.stops = [{ ...newStop('place', 'gwangjang', 60), lockedTime: '10:00' }];
    b.stops = [dinnerSlot()];
    const q = moveStopToDay(p, a.id, a.stops[0].uid, b.id);
    expect(q.days[0].stops).toHaveLength(0);
    expect(q.days[1].stops.map((s) => s.kind)).toEqual(['place', 'dinner']);
    expect(q.days[1].stops[0].lockedTime).toBeNull();
    expect(p.days[0].stops).toHaveLength(1); // ไม่แก้แผนเดิม
  });
  it('เตือนเมื่อสถานที่ปิดในวันที่เลือก', () => {
    const gb = PUBLIC_PLACES.find((x) => x.id === 'gyeongbokgung')!;
    expect(closedOn(gb, '2026-12-01')).toBe('ปิดทุกวันอังคาร');
    expect(closedOn(gb, '2026-12-02')).toBeNull();
    places.closedmon = P('closedmon', 37.56, 126.98, { hours: { text: '', closedDays: 'Mon', lastOrder: null, status: 'verified', closedWeekdays: [1] } });
    const s = computeSchedule(day([['closedmon', 30]], { date: '2026-11-30' }), ctxWith({ 'hotel>closedmon': 5, 'closedmon>hotel': 5 }));
    expect(s.stops[0].warnings[0]).toBe('ปิดทุกวันจันทร์');
  });
});
