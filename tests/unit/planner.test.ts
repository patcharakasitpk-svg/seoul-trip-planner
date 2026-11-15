import { describe, it, expect } from 'vitest';
import { roughEstimateMin } from '../../src/core/geo';
import { systemDayDefaults, recommendedStops } from '../../src/core/dayDefaults';

describe('เวลาเดินทางโดยประมาณ (ระยะไกล)', () => {
  it('สนามบินอินชอน → กลางโซล (~48 กม.) ด้วยรถไฟ ≈ 1–1.5 ชม. ไม่ใช่ 3 ชม.', () => {
    const m = roughEstimateMin(48000, 'TRANSIT');
    expect(m).toBeGreaterThanOrEqual(60);
    expect(m).toBeLessThanOrEqual(100);
  });
  it('ในเมือง 5 กม. ≈ 20–35 นาที', () => {
    const m = roughEstimateMin(5000, 'TRANSIT');
    expect(m).toBeGreaterThanOrEqual(20);
    expect(m).toBeLessThanOrEqual(35);
  });
});

describe('ค่าเริ่มต้นที่ระบบตั้งไว้ของแต่ละวัน', () => {
  it('วันแรก: ออกจากสนามบินตามเที่ยวบิน · จบที่โรงแรม', () => {
    expect(systemDayDefaults('2026-11-30')).toMatchObject({ startPlaceId: 'icn', startTime: '08:00', endPlaceId: 'hotel' });
  });
  it('คืน 5 ธ.ค. นอนซูวอน · วันกลับไปสนามบินภายใน 14:00', () => {
    expect(systemDayDefaults('2026-12-05')).toMatchObject({ startPlaceId: 'hotel', endPlaceId: 'novotel-suwon' });
    expect(systemDayDefaults('2026-12-06')).toMatchObject({ startPlaceId: 'novotel-suwon', endPlaceId: 'icn', endTime: '14:00' });
  });
  it('วันปกติ: โรงแรม 09:00–21:00', () => {
    expect(systemDayDefaults('2026-12-02')).toEqual({ startPlaceId: 'hotel', startTime: '09:00', endPlaceId: 'hotel', endTime: '21:00' });
  });
  it('แผนแนะนำของวัน: ตามแม่แบบ T (มีนัด COEX ที่ล็อกไว้)', () => {
    const stops = recommendedStops('2026-12-01');
    expect(stops.some((s) => s.placeId === 'coex' && s.lockedTime === '13:00')).toBe(true);
    expect(recommendedStops('2027-01-01')).toEqual([]);
  });
});
