import type { Day, Place, Plan } from './types';
import { validatePlan, customPlace } from '../storage/validate';

/**
 * แปลงแผน ⇄ เอกสารของทริปที่แชร์ (Firestore)
 * - ของที่แชร์: วัน (รวมเวลาเช็กอิน) · สถานที่ที่เพิ่มเอง · ค่าที่ปรับ (พิกัด/เวลาอยู่) · ลำดับวัน · ชื่อทริป
 * - ของส่วนตัว: สิ่งของที่ต้องใช้ · ระดับความหนาว · เช็กลิสต์เสื้อผ้า · ที่บันทึกไว้
 * เทียบการเปลี่ยนแปลงทีละเอกสาร เพื่อเขียนเฉพาะสิ่งที่เปลี่ยน (เพื่อนแก้คนละวันไม่ทับกัน)
 */

export interface TripDocs {
  name: string;
  dayOrder: string[];
  days: Record<string, Day>;
  places: Record<string, Place>;
  overrides: { coordOverrides: Plan['coordOverrides'] | null; stayOverrides: Plan['stayOverrides'] };
}

export interface PersonalDocs {
  packing: Plan['packing'] | null;
  prefs: { coldLevel: Plan['coldLevel']; checklist: Plan['checklist']; extraChecklist: Plan['extraChecklist']; saved: string[] };
}

export type TripOp =
  | { kind: 'name'; data: string }
  | { kind: 'order'; data: string[] }
  | { kind: 'overrides'; data: TripDocs['overrides'] }
  | { kind: 'day'; id: string; data: Day | null }
  | { kind: 'place'; id: string; data: Place | null };

/** ผ่านตัวตรวจเดียวกับข้อมูลจากภายนอก → เทียบกันได้ตรง ๆ ไม่ว่ามาจากเครื่องนี้หรือจากเพื่อน */
function normalized(plan: Plan): Plan {
  const v = validatePlan(JSON.parse(JSON.stringify(plan)));
  return v.ok ? v.plan : plan;
}

export function planToTripDocs(plan: Plan): TripDocs {
  const p = normalized(plan);
  const places: Record<string, Place> = {};
  for (const c of p.customPlaces) places[c.id] = c;
  return {
    name: p.name,
    dayOrder: p.days.map((d) => d.id),
    days: Object.fromEntries(p.days.map((d) => [d.id, d])),
    places,
    overrides: { coordOverrides: p.coordOverrides ?? null, stayOverrides: p.stayOverrides },
  };
}

export function planToPersonal(plan: Plan): PersonalDocs {
  return {
    packing: plan.packing ?? null,
    prefs: { coldLevel: plan.coldLevel, checklist: plan.checklist, extraChecklist: plan.extraChecklist, saved: plan.saved },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** สิ่งที่ต้องเขียน: เทียบของเดิม (ที่ซิงก์แล้ว) กับของใหม่ทีละเอกสาร */
export function diffTripDocs(prev: TripDocs | null, next: TripDocs): TripOp[] {
  const ops: TripOp[] = [];
  if (!prev || prev.name !== next.name) ops.push({ kind: 'name', data: next.name });
  if (!prev || !same(prev.dayOrder, next.dayOrder)) ops.push({ kind: 'order', data: next.dayOrder });
  if (!prev || !same(prev.overrides, next.overrides)) ops.push({ kind: 'overrides', data: next.overrides });
  for (const [id, d] of Object.entries(next.days)) if (!prev || !same(prev.days[id], d)) ops.push({ kind: 'day', id, data: d });
  if (prev) for (const id of Object.keys(prev.days)) if (!(id in next.days)) ops.push({ kind: 'day', id, data: null });
  for (const [id, pl] of Object.entries(next.places)) if (!prev || !same(prev.places[id], pl)) ops.push({ kind: 'place', id, data: pl });
  if (prev) for (const id of Object.keys(prev.places)) if (!(id in next.places)) ops.push({ kind: 'place', id, data: null });
  return ops;
}

export interface RemoteTrip {
  name?: unknown;
  dayOrder?: unknown;
  days: Record<string, unknown>; // doc id → { day }
  places: Record<string, unknown>; // doc id → place
  overrides?: unknown;
}

/**
 * ประกอบแผนจากเอกสารในทริป (ตรวจทุกอย่างเหมือนข้อมูลจากภายนอก) + ของส่วนตัวจากแผนในเครื่อง
 * วันที่ไม่อยู่ในลำดับ (เพิ่งเพิ่ม) ต่อท้ายตามวันที่
 */
export function tripDocsToPlan(id: string, remote: RemoteTrip, personal: PersonalDocs, base?: Plan): Plan | null {
  const order = Array.isArray(remote.dayOrder) ? remote.dayOrder.filter((x): x is string => typeof x === 'string') : [];
  const dayIds = Object.keys(remote.days);
  const ordered = [...order.filter((x) => dayIds.includes(x)), ...dayIds.filter((x) => !order.includes(x)).sort((a, b) => dayDate(remote.days[a]).localeCompare(dayDate(remote.days[b])))];
  const days = ordered.map((d) => ({ ...((remote.days[d] as { day?: object })?.day ?? {}), id: d }));
  if (!days.length) return null;
  const ov = (remote.overrides ?? {}) as Record<string, unknown>;
  const raw = {
    version: 1,
    id,
    name: typeof remote.name === 'string' ? remote.name : base?.name ?? 'แผนเที่ยวโซล',
    days,
    customPlaces: Object.entries(remote.places).map(([pid, v]) => ({ ...(v as object), id: pid })),
    coordOverrides: ov.coordOverrides ?? undefined,
    stayOverrides: ov.stayOverrides ?? {},
    saved: personal.prefs.saved,
    coldLevel: personal.prefs.coldLevel,
    checklist: personal.prefs.checklist,
    extraChecklist: personal.prefs.extraChecklist,
    packing: personal.packing ?? undefined,
    updatedAt: base?.updatedAt ?? new Date().toISOString(),
  };
  const v = validatePlan(raw);
  if (!v.ok) return null;
  // สถานที่จากเพื่อนที่ข้อมูลเสียถูกข้ามไปแล้วโดยตัวตรวจ · รักษา id ของสถานที่ตามเอกสาร
  v.plan.customPlaces = v.plan.customPlaces.filter((c) => customPlace(c));
  return v.plan;
}

const dayDate = (x: unknown) => {
  const d = (x as { day?: { date?: unknown } })?.day?.date;
  return typeof d === 'string' ? d : '9999';
};
