import type { Day, Leg, Plan, Stop, TravelMode } from './types';
import { TRIP_DATES, TRIP_STAYS } from '../config';
import { addDays, diffDays } from './time';

let counter = 0;
export function uid(prefix = 's'): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${counter}`;
}

export function newLeg(mode: TravelMode = 'TRANSIT'): Leg {
  return { mode, manualMin: null };
}

export function newStop(kind: Stop['kind'], placeId: string | null, stayMin: number, extra: Partial<Stop> = {}): Stop {
  return { uid: uid(), kind, placeId, stayMin, lockedTime: null, note: '', legIn: newLeg(), ...extra };
}

export function dinnerSlot(): Stop {
  return newStop('dinner', null, 60, { title: 'มื้อเย็น' });
}

export function newDay(partial: Partial<Day> = {}): Day {
  return {
    id: uid('d'),
    date: null,
    startPlaceId: 'hotel',
    startTime: null,
    endPlaceId: 'hotel',
    endTime: null,
    bufferMin: 5,
    prefs: { lessWalking: false, fewerTransfers: false, fastest: true },
    afterBooth: false,
    stops: [dinnerSlot()],
    endLeg: newLeg(),
    weatherRef: 'seoul',
    ...partial,
  };
}

export function newPlan(name = 'แผนเที่ยวโซล'): Plan {
  const p = basePlan(name);
  applyStays(p);
  return p;
}

function basePlan(name: string): Plan {
  return {
    version: 1,
    id: uid('p'),
    name,
    days: tripDates().map((date) => newDay({ date })),
    customPlaces: [],
    stayOverrides: {},
    saved: [],
    coldLevel: 'normal',
    checklist: {},
    extraChecklist: {},
    updatedAt: new Date().toISOString(),
  };
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** การแก้ไขทั้งหมดคืนค่า Day ใหม่ (immutable) */
export function insertStop(day: Day, index: number, stop: Stop): Day {
  const stops = [...day.stops];
  const i = Math.max(0, Math.min(index, stops.length));
  stops.splice(i, 0, stop);
  return { ...day, stops };
}

export function removeStop(day: Day, uidToRemove: string): Day {
  return { ...day, stops: day.stops.filter((s) => s.uid !== uidToRemove) };
}

export function moveStop(day: Day, uidToMove: string, delta: number): Day {
  const i = day.stops.findIndex((s) => s.uid === uidToMove);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= day.stops.length) return day;
  const stops = [...day.stops];
  const [s] = stops.splice(i, 1);
  stops.splice(j, 0, s);
  return { ...day, stops };
}

export function updateStop(day: Day, uidToUpdate: string, patch: Partial<Stop>): Day {
  return { ...day, stops: day.stops.map((s) => (s.uid === uidToUpdate ? { ...s, ...patch } : s)) };
}

export function reorderStops(day: Day, order: string[]): Day {
  const map = new Map(day.stops.map((s) => [s.uid, s]));
  const stops = order.map((u) => map.get(u)).filter((s): s is Stop => !!s);
  if (stops.length !== day.stops.length) return day;
  return { ...day, stops };
}

/** ดัชนีจุดแทรกที่ดี: ก่อนช่องมื้อเย็นที่ยังไม่เลือกร้าน หรือท้ายสุด */
export function defaultInsertIndex(day: Day): number {
  const i = day.stops.findIndex((s) => s.kind === 'dinner');
  return i >= 0 ? i : day.stops.length;
}

/** รายการวันที่ตามช่วงวันเที่ยวใน config */
export function tripDates(start = TRIP_DATES.start, end = TRIP_DATES.end): string[] {
  const n = Math.max(0, diffDays(start, end)) + 1;
  return Array.from({ length: Math.min(n, 30) }, (_, i) => addDays(start, i));
}

/** ใส่วันที่ตามช่วงวันเที่ยวให้แผน (คงรายการเดิมในแต่ละวัน) */
export function applyTripDates(plan: Plan, dates: string[] = tripDates()): void {
  dates.forEach((date, i) => {
    if (!plan.days[i]) plan.days.push(newDay());
    plan.days[i].date = date;
  });
  applyStays(plan);
}

/** ตั้งที่พักนอกโซล (เช่น ซูวอนคืนวันเสาร์): จบวันที่โรงแรมนั้น และเริ่มวันถัดไปจากที่นั่น */
export function applyStays(plan: Plan): void {
  for (const st of TRIP_STAYS) {
    const i = plan.days.findIndex((d) => d.date === st.date);
    if (i < 0) continue;
    plan.days[i].endPlaceId = st.hotelId;
    plan.days[i].weatherRef = st.hotelId;
    if (plan.days[i + 1]) {
      plan.days[i + 1].startPlaceId = st.hotelId;
      plan.days[i + 1].weatherRef = st.hotelId;
    }
  }
}

/** แผนยังไม่ตรงกับช่วงวันเที่ยว/ที่พักใน config หรือไม่ */
export function tripSetupNeeded(plan: Plan): boolean {
  if (tripDates().some((t) => !plan.days.some((d) => d.date === t))) return true;
  return TRIP_STAYS.some((st) => {
    const i = plan.days.findIndex((d) => d.date === st.date);
    return i >= 0 && (plan.days[i].endPlaceId !== st.hotelId || (plan.days[i + 1] && plan.days[i + 1].startPlaceId !== st.hotelId));
  });
}
