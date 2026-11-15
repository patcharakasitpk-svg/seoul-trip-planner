import type { Plan } from '../core/types';
import { validatePlan } from './validate';

const KEY = 'stp.v1.plans';
const SETTINGS_KEY = 'stp.v1.settings';

export interface StoredData {
  activeId: string;
  plans: Plan[];
}

export interface Settings {
  /** คีย์ที่ผู้ใช้กรอกในเครื่องนี้ — ไม่ส่งออก/ไม่แชร์ */
  apiKey?: string;
  mapId?: string;
  /** ทริปที่แชร์ที่เปิดใช้อยู่ในเครื่องนี้ */
  activeTrip?: string;
}

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** ข้อมูลเดิมอ่านไม่ได้ → เก็บสำเนาไว้ก่อน (แอปจะสร้างแผนใหม่ทับกุญแจหลัก) */
function backupRaw(raw: string) {
  safeSet(`${KEY}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`, raw);
}

export function loadPlans(): StoredData | null {
  const raw = safeGet(KEY);
  if (!raw) return null;
  const result = parsePlans(raw);
  if (!result) backupRaw(raw);
  return result;
}

function parsePlans(raw: string): StoredData | null {
  try {
    const data = JSON.parse(raw);
    const plans: Plan[] = [];
    for (const p of Array.isArray(data.plans) ? data.plans : []) {
      const v = validatePlan(p);
      if (v.ok) plans.push(v.plan);
    }
    if (!plans.length) return null;
    const activeId = plans.some((p) => p.id === data.activeId) ? data.activeId : plans[0].id;
    return { activeId, plans };
  } catch {
    return null;
  }
}

export function savePlans(data: StoredData): boolean {
  return safeSet(KEY, JSON.stringify(data));
}

export function loadSettings(): Settings {
  try {
    return JSON.parse(safeGet(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings): boolean {
  return safeSet(SETTINGS_KEY, JSON.stringify(s));
}

/** ทดสอบว่าเขียน localStorage ได้หรือไม่ */
export function storageAvailable(): boolean {
  try {
    const k = '__stp_test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}
