import { describe, it, expect } from 'vitest';
import { closedOn, weekdayOf } from '../../src/core/hours';
import { computeSchedule } from '../../src/core/schedule';
import { tripDates, newPlan, applyTripDates, newDay } from '../../src/core/planOps';
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
  it('เตือนเมื่อสถานที่ปิดในวันที่เลือก', () => {
    const gb = PUBLIC_PLACES.find((x) => x.id === 'gyeongbokgung')!;
    expect(closedOn(gb, '2026-12-01')).toBe('ปิดทุกวันอังคาร');
    expect(closedOn(gb, '2026-12-02')).toBeNull();
    places.closedmon = P('closedmon', 37.56, 126.98, { hours: { text: '', closedDays: 'Mon', lastOrder: null, status: 'verified', closedWeekdays: [1] } });
    const s = computeSchedule(day([['closedmon', 30]], { date: '2026-11-30' }), ctxWith({ 'hotel>closedmon': 5, 'closedmon>hotel': 5 }));
    expect(s.stops[0].warnings[0]).toBe('ปิดทุกวันจันทร์');
  });
});
