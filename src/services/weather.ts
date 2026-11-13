import type { Forecast } from '../core/weather';
import { safeGet, safeSet } from '../storage/storage';

/** Open-Meteo Forecast API — ไม่ต้องใช้คีย์, ใช้ฟรีแบบไม่เชิงพาณิชย์, ข้อมูล CC BY 4.0 */
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 60 * 60 * 1000; // แคช 1 ชม.

const HOURLY = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'snowfall', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max', 'apparent_temperature_min', 'precipitation_probability_max', 'precipitation_sum', 'snowfall_sum', 'wind_speed_10m_max'];

export type WeatherState = { status: 'loading' } | { status: 'ok'; data: Forecast; stale: boolean } | { status: 'error'; message: string; data?: Forecast };

const mem = new Map<string, WeatherState>();
const inflight = new Map<string, Promise<void>>();
let listener: () => void = () => {};
export function onWeatherChange(fn: () => void) {
  listener = fn;
}

export function weatherKey(lat: number, lng: number) {
  return `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function buildUrl(lat: number, lng: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'Asia/Seoul',
    forecast_days: '16',
    wind_speed_unit: 'kmh',
  });
  return `${ENDPOINT}?${p}`;
}

/** อ่านสถานะ (ไม่เรียก API) */
export function getWeather(lat: number, lng: number): WeatherState | undefined {
  const k = weatherKey(lat, lng);
  const m = mem.get(k);
  if (m) return m;
  const raw = safeGet(k);
  if (raw) {
    try {
      const data = JSON.parse(raw) as Forecast;
      const st: WeatherState = { status: 'ok', data, stale: Date.now() - new Date(data.fetchedAt).getTime() > TTL_MS };
      mem.set(k, st);
      return st;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** เรียก API เมื่อไม่มีแคชหรือแคชหมดอายุ (หรือ force) */
export function ensureWeather(lat: number, lng: number, force = false, fetchImpl: typeof fetch = fetch): Promise<void> {
  const k = weatherKey(lat, lng);
  const cur = getWeather(lat, lng);
  if (!force && cur && (cur.status === 'loading' || (cur.status === 'ok' && !cur.stale))) return Promise.resolve();
  if (inflight.has(k)) return inflight.get(k)!;
  const prev = cur && cur.status === 'ok' ? cur.data : undefined;
  if (!prev) mem.set(k, { status: 'loading' });
  const p = (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('ออฟไลน์');
      const res = await fetchImpl(buildUrl(lat, lng));
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.reason || `HTTP ${res.status}`);
      if (json.utc_offset_seconds !== 32400) throw new Error('เขตเวลาที่ได้ไม่ใช่ Asia/Seoul');
      const data: Forecast = { fetchedAt: new Date().toISOString(), lat, lng, utcOffsetSeconds: json.utc_offset_seconds, hourly: json.hourly, daily: json.daily };
      mem.set(k, { status: 'ok', data, stale: false });
      safeSet(k, JSON.stringify(data));
    } catch (e) {
      mem.set(k, { status: 'error', message: (e as Error).message || 'โหลดพยากรณ์ไม่สำเร็จ', data: prev });
    } finally {
      inflight.delete(k);
      listener();
    }
  })();
  inflight.set(k, p);
  return p;
}
