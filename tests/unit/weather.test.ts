import { describe, it, expect } from 'vitest';
import { matchDayWeather, type Forecast } from '../../src/core/weather';
import { clothingAdvice } from '../../src/core/clothing';

function fc(days: string[], hourly: (date: string, h: number) => Partial<Record<string, number | null>>): Forecast {
  const time: string[] = [];
  const cols: Record<string, (number | null)[]> = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], snowfall: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [] };
  for (const d of days)
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      const v = hourly(d, h);
      for (const k of Object.keys(cols)) cols[k].push(k in v ? (v[k] as number | null) : 0);
    }
  const daily: any = { time: days };
  for (const k of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max', 'apparent_temperature_min', 'precipitation_probability_max', 'precipitation_sum', 'snowfall_sum', 'wind_speed_10m_max']) daily[k] = days.map(() => 1);
  daily.snowfall_sum = days.map(() => null);
  return { fetchedAt: new Date().toISOString(), lat: 37.5, lng: 127, utcOffsetSeconds: 32400, hourly: { time, ...cols } as any, daily };
}

// วันอุ่นตอนกลางวัน หนาวตอนเย็น (เวลาตามโซลในสตริง)
const F = fc(['2026-11-20', '2026-11-21'], (_d, h) => ({ temperature_2m: h >= 12 && h <= 15 ? 16 : 2, apparent_temperature: h >= 12 && h <= 15 ? 15 : -2 }));

describe('weather matching (Asia/Seoul)', () => {
  it('ไม่มีวันที่ → no-date', () => {
    expect(matchDayWeather(F, null, null)).toEqual({ status: 'no-date' });
  });
  it('วันนอกช่วงพยากรณ์ไม่สร้างข้อมูล', () => {
    const w = matchDayWeather(F, '2026-12-25', null)!;
    expect(w.status).toBe('out-of-range');
    expect('daily' in w).toBe(false);
  });
  it('วันที่ผ่านมาแล้ว → past', () => {
    expect(matchDayWeather(F, '2026-11-01', null)!.status).toBe('past');
  });
  it('จับคู่ชั่วโมงตามเวลาเกาหลี: ช่วงเย็น 18:00–22:00 ใช้ค่าตอนเย็น ไม่ใช่สูงสุดของวัน', () => {
    const w = matchDayWeather(F, '2026-11-20', { from: 18 * 60, to: 22 * 60 })!;
    if (w.status !== 'ok') throw new Error();
    expect(w.hours[0].label).toBe('18:00');
    expect(w.hours.length).toBe(5);
    expect(w.window!.feelsMin).toBe(-2);
    expect(w.window!.feelsMax).toBe(-2);
  });
  it('ช่วงข้ามเที่ยงคืนใช้ชั่วโมงของวันถัดไป', () => {
    const w = matchDayWeather(F, '2026-11-20', { from: 23 * 60, to: 25 * 60 })!;
    if (w.status !== 'ok') throw new Error();
    expect(w.hours.map((h) => h.label)).toEqual(['23:00', '00:00 (+1)', '01:00 (+1)']);
  });
  it('ค่า null แสดงเป็นไม่มีข้อมูล ไม่แปลงเป็นศูนย์', () => {
    const G = fc(['2026-11-20'], () => ({ precipitation_probability: null, apparent_temperature: null }));
    const w = matchDayWeather(G, '2026-11-20', { from: 600, to: 720 })!;
    if (w.status !== 'ok') throw new Error();
    expect(w.window!.ppMax).toBeNull();
    expect(w.window!.feelsMin).toBeNull();
    expect(w.daily.snowSum).toBeNull();
  });
});

describe('clothing rules', () => {
  const base = { feelsMin: null, feelsMax: null, tempMin: null, tempMax: null, ppMax: 0, precipSum: 0, snowSum: null, windMax: 5, gustMax: 10, worstCode: 0 };
  it('เที่ยวตอนเย็นหนาว → ชั้นในอุ่น โค้ท ถุงมือ (อิงช่วงเย็นจริง)', () => {
    const eve = matchDayWeather(F, '2026-11-20', { from: 18 * 60, to: 22 * 60 }) as any;
    const a = clothingAdvice(eve.window, { coldLevel: 'normal', walkMin: 20, outdoorMin: 0, windowLabel: '18:00–22:00' });
    const keys = a.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['base', 'mid', 'coat', 'scarf', 'gloves']));
    expect(a.basis).toMatch(/18:00–22:00/);
    const noon = matchDayWeather(F, '2026-11-20', { from: 12 * 60, to: 15 * 60 }) as any;
    const b = clothingAdvice(noon.window, { coldLevel: 'normal', walkMin: 20, outdoorMin: 0, windowLabel: '12–15' });
    expect(b.items.map((i) => i.key)).not.toContain('coat');
  });
  it('ไม่สรุปว่ามีหิมะเพียงเพราะอุณหภูมิต่ำ', () => {
    const a = clothingAdvice({ ...base, feelsMin: -8, feelsMax: -5 }, { coldLevel: 'normal', walkMin: 10, outdoorMin: 0, windowLabel: 'x' });
    expect(a.items.some((i) => /หิมะ/.test(i.why))).toBe(false);
    const b = clothingAdvice({ ...base, feelsMin: -8, feelsMax: -5, snowSum: 1.2 }, { coldLevel: 'normal', walkMin: 10, outdoorMin: 0, windowLabel: 'x' });
    expect(b.items.find((i) => i.key === 'wshoes')!.why).toMatch(/พยากรณ์ระบุหิมะ/);
  });
  it('ระดับขี้หนาวเลื่อนเกณฑ์', () => {
    const w = { ...base, feelsMin: 7, feelsMax: 9 };
    const normal = clothingAdvice(w, { coldLevel: 'normal', walkMin: 0, outdoorMin: 0, windowLabel: 'x' }).items.map((i) => i.key);
    const cold = clothingAdvice(w, { coldLevel: 'high', walkMin: 0, outdoorMin: 0, windowLabel: 'x' }).items.map((i) => i.key);
    expect(normal).not.toContain('coat');
    expect(cold).toContain('coat');
  });
  it('ฝน → ร่มและเสนอทางเลือกในร่ม', () => {
    const a = clothingAdvice({ ...base, feelsMin: 12, feelsMax: 14, ppMax: 80, precipSum: 6 }, { coldLevel: 'normal', walkMin: 0, outdoorMin: 0, windowLabel: 'x' });
    expect(a.items.map((i) => i.key)).toContain('umbrella');
    expect(a.badWeather).not.toBeNull();
  });
});
