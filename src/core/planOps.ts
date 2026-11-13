import type { Day, Leg, Plan, Stop, TravelMode } from './types';

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
  return {
    version: 1,
    id: uid('p'),
    name,
    days: [newDay(), newDay(), newDay(), newDay()],
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
