import LZString from 'lz-string';
import type { Plan } from '../core/types';
import { validatePlan } from './validate';
import { mergePackingDone } from '../core/packing';

/** ความยาว fragment สูงสุดที่ยอมสร้างลิงก์ (ส่งผ่าน AirDrop/LINE/คัดลอก — เบราว์เซอร์รับได้สบาย) */
export const MAX_FRAGMENT = 60000;
/** ความยาวลิงก์ทั้งหมดที่ยังทำ QR ได้ (QR ใหญ่สุด ~2,950 ตัวอักษร · เผื่อไว้ให้สแกนติดง่าย) */
export const MAX_QR_URL = 2900;
const PREFIX = 'plan=';

/** แผนที่จะส่งออก: ไม่มี API Key / ผลบริการ (แผนเก็บเฉพาะข้อมูลผู้ใช้อยู่แล้ว) */
export function exportablePlan(plan: Plan): Plan {
  // ลิงก์/JSON เป็นสำเนา → ไม่พารหัสห้องซิงก์ติดไป (กันสำเนาไปเขียนทับห้องของเพื่อน)
  const { roomId: _room, ...p } = plan;
  return JSON.parse(JSON.stringify(p));
}

/**
 * ตัดค่าที่เป็นค่าเริ่มต้นออกก่อนใส่ลิงก์ (ว่าง/null/ไม่ได้ตั้ง) — validatePlan เติมกลับเป็นค่าเดิมตอนเปิด
 * ทำให้แผนทั้งทริปสั้นพอใส่ QR ได้
 */
export function compactPlan(plan: Plan): unknown {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x)) {
        const c = strip(v);
        if (c === null || c === undefined || c === '') continue;
        if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c as object).length === 0) continue;
        if (Array.isArray(c) && c.length === 0) continue;
        out[k] = c;
      }
      return out;
    }
    return x;
  };
  const p = exportablePlan(plan);
  const days = p.days.map((d) => {
    const { prefs, weatherRef, bufferMin, afterBooth, endLeg, ...rest } = d;
    const defPrefs = !prefs.lessWalking && !prefs.fewerTransfers && prefs.fastest;
    return {
      ...rest,
      ...(defPrefs ? {} : { prefs }),
      ...(weatherRef && weatherRef !== 'seoul' ? { weatherRef } : {}),
      ...(bufferMin ? { bufferMin } : {}),
      ...(afterBooth ? { afterBooth } : {}),
      ...(isDefaultLeg(endLeg) ? {} : { endLeg }),
      stops: d.stops.map(({ legIn, ...s }) => ({ ...s, ...(isDefaultLeg(legIn) ? {} : { legIn }) })),
    };
  });
  // ของส่วนตัว (สิ่งของที่ต้องใช้ · ระดับความหนาว · เช็กลิสต์เสื้อผ้า · ที่บันทึกไว้) ไม่ส่งไปกับลิงก์แผน
  // — คนที่เปิดลิงก์เริ่มจากค่าตั้งต้นของตัวเอง (ไฟล์ JSON สำรองยังเก็บครบ)
  const { coldLevel: _c, packing: _p, checklist: _k, extraChecklist: _e, saved: _s, ...rest } = p;
  return strip({ ...rest, days });
}

const isDefaultLeg = (l: Plan['days'][number]['endLeg'] | undefined) => !l || (l.mode === 'TRANSIT' && l.manualMin == null);

export function encodePlan(plan: Plan): string {
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(compactPlan(plan)));
}

export function buildShareUrl(plan: Plan, baseUrl: string): { ok: true; url: string; length: number; qr: boolean } | { ok: false; length: number } {
  const frag = encodePlan(plan);
  if (frag.length > MAX_FRAGMENT) return { ok: false, length: frag.length };
  const base = baseUrl.split('#')[0];
  const url = `${base}#${frag}`;
  return { ok: true, url, length: frag.length, qr: url.length <= MAX_QR_URL };
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

/**
 * รับแผนจากเครื่องอื่นมาแทนที่ แต่เก็บเวลาที่เช็กอินในเครื่องนี้ไว้ (วันเดียวกัน = id เดียวกัน)
 * ถ้าแผนที่ส่งมามีเวลาเช็กอินของวันนั้นแล้ว ใช้ของที่ส่งมา
 */
export function keepLocalCheckins(incoming: Plan, local: Plan | undefined): Plan {
  if (!local) return incoming;
  const byId = new Map(local.days.map((d) => [d.id, d]));
  return {
    ...incoming,
    packing: mergePackingDone(incoming.packing, local.packing),
    days: incoming.days.map((d) => {
      const mine = byId.get(d.id)?.actual;
      return d.actual && Object.keys(d.actual).length ? d : mine ? { ...d, actual: mine } : d;
    }),
  };
}

export function parseJsonPlan(text: string): ReturnType<typeof validatePlan> {
  try {
    return validatePlan(JSON.parse(text));
  } catch {
    return { ok: false, error: 'ไฟล์ JSON ไม่ถูกต้อง' };
  }
}
