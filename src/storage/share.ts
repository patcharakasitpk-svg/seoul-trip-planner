import LZString from 'lz-string';
import type { Plan } from '../core/types';
import { validatePlan } from './validate';

/** ความยาว fragment สูงสุดที่ยอมสร้างลิงก์/QR (เกินนี้ให้ใช้ JSON) */
export const MAX_FRAGMENT = 4000;
const PREFIX = 'plan=';

/** แผนที่จะส่งออก: ไม่มี API Key / ผลบริการ (แผนเก็บเฉพาะข้อมูลผู้ใช้อยู่แล้ว) */
export function exportablePlan(plan: Plan): Plan {
  const { ...p } = plan;
  return JSON.parse(JSON.stringify(p));
}

export function encodePlan(plan: Plan): string {
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(exportablePlan(plan)));
}

export function buildShareUrl(plan: Plan, baseUrl: string): { ok: true; url: string; length: number } | { ok: false; length: number } {
  const frag = encodePlan(plan);
  if (frag.length > MAX_FRAGMENT) return { ok: false, length: frag.length };
  const base = baseUrl.split('#')[0];
  return { ok: true, url: `${base}#${frag}`, length: frag.length };
}

export function decodeFragment(hash: string): ReturnType<typeof validatePlan> | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith(PREFIX)) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(h.slice(PREFIX.length));
    if (!json) return { ok: false, error: 'ลิงก์เสียหรือไม่ครบ' };
    return validatePlan(JSON.parse(json));
  } catch {
    return { ok: false, error: 'อ่านข้อมูลจากลิงก์ไม่ได้' };
  }
}

export function parseJsonPlan(text: string): ReturnType<typeof validatePlan> {
  try {
    return validatePlan(JSON.parse(text));
  } catch {
    return { ok: false, error: 'ไฟล์ JSON ไม่ถูกต้อง' };
  }
}
