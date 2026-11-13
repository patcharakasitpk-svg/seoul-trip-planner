import { diffDays } from './time';

/** รูปแบบข้อมูลที่ได้จาก Open-Meteo (timezone=Asia/Seoul) */
export interface Forecast {
  fetchedAt: string; // ISO
  lat: number;
  lng: number;
  utcOffsetSeconds: number;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    weather_code: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
  };
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    apparent_temperature_max: (number | null)[];
    apparent_temperature_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    wind_speed_10m_max: (number | null)[];
  };
}

export interface HourRow {
  label: string; // HH:00 (+1)
  mins: number; // นาทีเทียบเที่ยงคืนของวันเที่ยว
  temp: number | null;
  feels: number | null;
  pp: number | null;
  precip: number | null;
  snow: number | null;
  code: number | null;
  wind: number | null;
  gust: number | null;
}

export interface WindowSummary {
  feelsMin: number | null;
  feelsMax: number | null;
  tempMin: number | null;
  tempMax: number | null;
  ppMax: number | null;
  precipSum: number | null;
  snowSum: number | null;
  windMax: number | null;
  gustMax: number | null;
  worstCode: number | null;
}

export type DayWeather =
  | { status: 'no-date' }
  | { status: 'past' | 'out-of-range'; firstDate: string | null; lastDate: string | null }
  | {
      status: 'ok';
      daily: {
        code: number | null;
        tMax: number | null;
        tMin: number | null;
        feelsMax: number | null;
        feelsMin: number | null;
        ppMax: number | null;
        precipSum: number | null;
        snowSum: number | null;
        windMax: number | null;
      };
      hours: HourRow[];
      window: WindowSummary | null;
      windowPartial: boolean; // ช่วงเที่ยวบางชั่วโมงอยู่นอกข้อมูล
    };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function matchDayWeather(fc: Forecast | null, date: string | null, window: { from: number; to: number } | null): DayWeather | null {
  if (!date) return { status: 'no-date' };
  if (!fc) return null;
  const di = fc.daily.time.indexOf(date);
  const first = fc.daily.time[0] ?? null;
  const last = fc.daily.time[fc.daily.time.length - 1] ?? null;
  if (di < 0) {
    return { status: first && date < first ? 'past' : 'out-of-range', firstDate: first, lastDate: last };
  }
  const d = fc.daily;
  const hours: HourRow[] = [];
  fc.hourly.time.forEach((t, i) => {
    const [dpart, hpart] = t.split('T');
    const mins = diffDays(date, dpart) * 1440 + Number(hpart.slice(0, 2)) * 60 + Number(hpart.slice(3, 5));
    if (mins < 0 || mins >= 1440 + 6 * 60) return;
    const h = fc.hourly;
    hours.push({
      label: `${hpart.slice(0, 5)}${mins >= 1440 ? ' (+1)' : ''}`,
      mins,
      temp: num(h.temperature_2m[i]),
      feels: num(h.apparent_temperature[i]),
      pp: num(h.precipitation_probability[i]),
      precip: num(h.precipitation[i]),
      snow: num(h.snowfall[i]),
      code: num(h.weather_code[i]),
      wind: num(h.wind_speed_10m[i]),
      gust: num(h.wind_gusts_10m[i]),
    });
  });
  let win: WindowSummary | null = null;
  let partial = false;
  let windowHours = hours.filter((h) => h.mins < 1440);
  if (window) {
    const fromH = Math.floor(window.from / 60) * 60;
    windowHours = hours.filter((h) => h.mins >= fromH && h.mins <= window.to);
    const expected = Math.floor(window.to / 60) - Math.floor(window.from / 60) + 1;
    partial = windowHours.length < expected;
    win = summarize(windowHours);
  }
  return {
    status: 'ok',
    daily: {
      code: num(d.weather_code[di]),
      tMax: num(d.temperature_2m_max[di]),
      tMin: num(d.temperature_2m_min[di]),
      feelsMax: num(d.apparent_temperature_max[di]),
      feelsMin: num(d.apparent_temperature_min[di]),
      ppMax: num(d.precipitation_probability_max[di]),
      precipSum: num(d.precipitation_sum[di]),
      snowSum: num(d.snowfall_sum[di]),
      windMax: num(d.wind_speed_10m_max[di]),
    },
    hours: window ? hours.filter((h) => h.mins >= Math.floor(window.from / 60) * 60 && h.mins <= window.to) : hours.filter((h) => h.mins < 1440),
    window: win,
    windowPartial: partial,
  };
}

function summarize(rows: HourRow[]): WindowSummary | null {
  if (!rows.length) return null;
  const vals = (k: keyof HourRow) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const min = (a: number[]) => (a.length ? Math.min(...a) : null);
  const max = (a: number[]) => (a.length ? Math.max(...a) : null);
  const sum = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) * 10) / 10 : null);
  const codes = vals('code');
  return {
    feelsMin: min(vals('feels')),
    feelsMax: max(vals('feels')),
    tempMin: min(vals('temp')),
    tempMax: max(vals('temp')),
    ppMax: max(vals('pp')),
    precipSum: sum(vals('precip')),
    snowSum: sum(vals('snow')),
    windMax: max(vals('wind')),
    gustMax: max(vals('gust')),
    worstCode: codes.length ? Math.max(...codes) : null,
  };
}

/** WMO weather code → ไทย + ไอคอน (ตามตาราง Open-Meteo) */
export function wmo(code: number | null): { th: string; icon: string } {
  if (code == null) return { th: 'ไม่มีข้อมูล', icon: '❔' };
  if (code === 0) return { th: 'ท้องฟ้าแจ่มใส', icon: '☀️' };
  if (code === 1) return { th: 'แจ่มใสเป็นส่วนใหญ่', icon: '🌤️' };
  if (code === 2) return { th: 'มีเมฆบางส่วน', icon: '⛅' };
  if (code === 3) return { th: 'เมฆมาก', icon: '☁️' };
  if (code === 45 || code === 48) return { th: 'หมอก', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { th: 'ฝนปรอย', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { th: 'ฝน', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { th: 'หิมะ (ตามพยากรณ์)', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { th: 'ฝนซู่', icon: '🌧️' };
  if (code === 85 || code === 86) return { th: 'หิมะโปรย (ตามพยากรณ์)', icon: '🌨️' };
  if (code >= 95) return { th: 'พายุฝนฟ้าคะนอง', icon: '⛈️' };
  return { th: `รหัส ${code}`, icon: '❔' };
}
