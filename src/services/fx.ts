import { safeGet, safeSet } from '../storage/storage';

/**
 * อัตราแลกเปลี่ยน วอน ↔ บาท
 * - ดึงอัตราอ้างอิง (Frankfurter/ECB; สำรอง open.er-api.com) แล้วจำไว้ในเครื่อง ใช้ได้ตอนออฟไลน์
 * - ผู้ใช้ตั้งอัตราเองได้ (เช่นจากร้านแลกเงิน/บัตร) — ใช้แทนอัตราอ้างอิงจนกว่าจะกดกลับเป็นอัตโนมัติ
 * เก็บเป็น "วอนต่อ 1 บาท" (รูปแบบเดียวกับป้ายร้านแลกเงิน)
 */
export interface FxStore {
  /** อัตราอ้างอิงล่าสุด: วอนต่อ 1 บาท */
  ref: number | null;
  refDate: string | null; // วันที่ของอัตรา (YYYY-MM-DD)
  fetchedAt: number | null; // ms
  source: string | null;
  /** อัตราที่ผู้ใช้ตั้งเอง (วอนต่อ 1 บาท) */
  custom: number | null;
}

const KEY = 'stp.v1.fx';
const MAX_AGE_MS = 6 * 3600 * 1000;

export function loadFx(): FxStore {
  try {
    const v = JSON.parse(safeGet(KEY) || '{}');
    const num = (x: unknown) => (typeof x === 'number' && x > 1 && x < 200 ? x : null);
    return {
      ref: num(v.ref),
      refDate: typeof v.refDate === 'string' ? v.refDate.slice(0, 10) : null,
      fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : null,
      source: typeof v.source === 'string' ? v.source.slice(0, 40) : null,
      custom: num(v.custom),
    };
  } catch {
    return { ref: null, refDate: null, fetchedAt: null, source: null, custom: null };
  }
}

export function saveFx(s: FxStore): void {
  safeSet(KEY, JSON.stringify(s));
}

/** อัตราที่ใช้คำนวณ (วอนต่อ 1 บาท) */
export const activeRate = (s: FxStore): number | null => s.custom ?? s.ref;

export const needsRefresh = (s: FxStore, now = Date.now()) => !s.ref || !s.fetchedAt || now - s.fetchedAt > MAX_AGE_MS;

/** แปลงข้อความตัวเลข เช่น "12,500" "1.5k" → number (ไม่ใช่ตัวเลข = null) */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s₩฿]/g, '').toLowerCase();
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1);
  return Number.isFinite(n) ? n : null;
}

export const krwToThb = (krw: number, rate: number) => krw / rate;
export const thbToKrw = (thb: number, rate: number) => thb * rate;

/** บาท: น้อยกว่า 100 แสดงทศนิยม 2 ตำแหน่ง นอกนั้นปัดเป็นจำนวนเต็ม */
export function fmtThb(n: number): string {
  return n < 100 ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('th-TH');
}
export function fmtKrw(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/** ดึงอัตราอ้างอิงใหม่ (คืน null ถ้าดึงไม่ได้ทุกแหล่ง) */
export async function fetchRate(signal?: AbortSignal): Promise<Pick<FxStore, 'ref' | 'refDate' | 'source'> | null> {
  try {
    const j = await fetchJson('https://api.frankfurter.dev/v1/latest?from=THB&to=KRW', signal);
    const r = j?.rates?.KRW;
    if (typeof r === 'number' && r > 1 && r < 200) return { ref: r, refDate: String(j.date ?? '').slice(0, 10) || null, source: 'Frankfurter (ECB)' };
  } catch {
    /* ลองแหล่งสำรอง */
  }
  try {
    const j = await fetchJson('https://open.er-api.com/v6/latest/THB', signal);
    const r = j?.rates?.KRW;
    if (typeof r === 'number' && r > 1 && r < 200) {
      const d = typeof j.time_last_update_unix === 'number' ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : null;
      return { ref: r, refDate: d, source: 'ExchangeRate-API' };
    }
  } catch {
    /* ออฟไลน์ */
  }
  return null;
}
