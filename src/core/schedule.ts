import type { Day, Leg, Place, RouteResult, Stop } from './types';
import { parseHM } from './time';
import { closedOn } from './hours';

export type LegSource = 'user' | 'service' | 'estimate' | 'auto' | 'same' | 'none';

export interface LegInfo {
  fromId: string | null;
  toId: string | null;
  mode: Leg['mode'];
  travelMin: number | null;
  bufferMin: number;
  source: LegSource;
  reason: string | null;
  route: RouteResult | null;
  departMins: number | null;
}

export interface StopTiming {
  uid: string;
  stop: Stop;
  leg: LegInfo;
  arrive: number | null;
  wait: number;
  start: number | null;
  depart: number | null;
  /** true = เวลานี้เป็น "อย่างเร็ว" เพราะมีช่วงก่อนหน้าที่ไม่มีข้อมูล */
  lowerBound: boolean;
  lateMin: number | null; // > 0 = สายจากเวลานัด (แน่นอน)
  lateUnknown: boolean;
  warnings: string[];
  locationUnknown: boolean;
}

export interface DaySchedule {
  hasTime: boolean;
  hasDate: boolean;
  stops: StopTiming[];
  end: { leg: LegInfo; arrive: number | null; lowerBound: boolean; slackMin: number | null } | null;
  totalTravelMin: number | null;
  totalBufferMin: number;
  missingLegs: number;
  status: 'no-time' | 'incomplete' | 'late' | 'ok';
  messages: string[];
}

/** lookup ผลเส้นทาง: undefined = ยังไม่ได้ขอ/กำลังโหลด */
export type RouteLookup = (fromId: string, toId: string, mode: Leg['mode'], date: string | null, departMins: number | null) => RouteResult | undefined;

export interface ScheduleCtx {
  getPlace: (id: string) => Place | undefined;
  getRoute: RouteLookup;
  /**
   * โหมดเดินทางจริง (หน้า "วันนี้"): ใช้เวลาจริงที่เช็กอิน (day.actual) แทนแผน
   * now = เวลาตอนนี้ (นาที) ถ้าเป็นวันนี้ · null = ซ้อมดูวันอื่น (ไม่ใช้นาฬิกา)
   * estimate = เวลาเดินทางโดยประมาณจากระยะ เมื่อไม่มีข้อมูล (แสดงเป็น "≈")
   */
  live?: { now: number | null; estimate: (fromId: string, toId: string, mode: Leg['mode']) => number | null };
}

/** ตอนนี้อยู่ขั้นไหนของวัน (จากเวลาจริงที่เช็กอิน) */
export type LivePhase = { kind: 'ready' } | { kind: 'moving'; uid: string } | { kind: 'at'; uid: string } | { kind: 'returning' } | { kind: 'done' };

export function livePhase(day: Day): LivePhase {
  const act = day.actual ?? {};
  if (act.__end?.a) return { kind: 'done' };
  if (!act.__start?.d) return { kind: 'ready' };
  for (const s of day.stops) {
    if (s.skipped) continue;
    const a = act[s.uid];
    if (!a?.a) return { kind: 'moving', uid: s.uid };
    if (!a.d) return { kind: 'at', uid: s.uid };
  }
  return day.endPlaceId ? { kind: 'returning' } : { kind: 'done' };
}

/** เติมเวลาเดินทางโดยประมาณ (เฉพาะโหมดเดินทางจริง) เมื่อไม่มีข้อมูล */
function withEstimate(leg: LegInfo, ctx: ScheduleCtx): LegInfo {
  if (leg.source !== 'none' || !ctx.live || !leg.fromId || !leg.toId || leg.reason?.startsWith('ยังไม่ได้เลือกร้าน')) return leg;
  const est = ctx.live.estimate(leg.fromId, leg.toId, leg.mode);
  return est == null ? leg : { ...leg, travelMin: est, source: 'auto', reason: 'ประมาณจากระยะทาง' };
}

const STATUS_REASON: Record<string, string> = {
  unsupported: 'บริการไม่รองรับวิธีนี้ในพื้นที่',
  error: 'เรียกบริการเส้นทางไม่สำเร็จ',
  'no-key': 'ยังไม่ได้ตั้งค่า Google Maps API Key',
  'no-coords': 'สถานที่ยังไม่มีพิกัดที่ตรวจสอบแล้ว',
  offline: 'ออฟไลน์ — อัปเดตเส้นทางไม่ได้',
};

export function resolveLeg(
  leg: Leg,
  fromId: string | null,
  toId: string | null,
  day: Day,
  departMins: number | null,
  ctx: ScheduleCtx,
  unknownLocation: boolean,
): LegInfo {
  const base = { fromId, toId, mode: leg.mode, route: null as RouteResult | null, departMins };
  if (unknownLocation || !fromId || !toId) {
    return { ...base, travelMin: null, bufferMin: 0, source: 'none', reason: unknownLocation ? 'ยังไม่ได้เลือกร้าน — ยังไม่รวมเวลาเดินทาง' : 'ยังไม่ได้เลือกจุด' };
  }
  if (fromId === toId) return { ...base, travelMin: 0, bufferMin: 0, source: 'same', reason: null };
  const buffer = Math.max(0, day.bufferMin || 0);
  if (leg.manualMin != null && leg.manualKind !== 'estimate') {
    return { ...base, travelMin: leg.manualMin, bufferMin: buffer, source: 'user', reason: null };
  }
  const r = day.date ? ctx.getRoute(fromId, toId, leg.mode, day.date, departMins) : undefined;
  if (r && r.status === 'ok') return { ...base, route: r, travelMin: r.durationMin, bufferMin: buffer, source: 'service', reason: null };
  if (leg.manualMin != null && leg.manualKind === 'estimate') {
    return { ...base, route: r ?? null, travelMin: leg.manualMin, bufferMin: buffer, source: 'estimate', reason: 'ค่าประมาณจากระยะเส้นตรง' };
  }
  let reason = 'ยังไม่มีข้อมูลเวลาเดินทาง';
  if (!day.date) reason = 'ยังไม่เลือกวันที่ — ขอเส้นทางจากบริการไม่ได้ (กรอกเวลาเองได้)';
  else if (r) reason = (STATUS_REASON[r.status] ?? reason) + ('message' in r && r.message ? ` (${r.message})` : '');
  else reason = 'กำลังโหลด/ยังไม่ได้ขอข้อมูลเส้นทาง';
  return { ...base, route: r ?? null, travelMin: null, bufferMin: buffer, source: 'none', reason };
}

export function stopLocationId(stop: Stop): string | null {
  if (stop.kind === 'place' || stop.kind === 'dinner') return stop.placeId;
  return null; // พัก/เวลาสำรอง อยู่ที่จุดเดิม
}

export function computeSchedule(day: Day, ctx: ScheduleCtx): DaySchedule {
  const startMins = parseHM(day.startTime);
  const hasTime = startMins != null;
  const messages: string[] = [];
  if (!day.date) messages.push('ยังไม่เลือกวันที่ — ข้อมูลตามวัน (เส้นทางตามเวลา, อากาศ, วันหยุด) ยังไม่ครบ');
  if (!hasTime) messages.push('ยังไม่กำหนดเวลาออก — ยังประเมินเวลาไม่ได้');
  if (!day.startPlaceId) messages.push('ยังไม่เลือกจุดเริ่ม');
  if (!day.endPlaceId) messages.push('ยังไม่เลือกจุดสิ้นสุด');

  const act = ctx.live ? day.actual ?? {} : {};
  const started = !!act.__start?.d;
  const now = ctx.live?.now ?? null;
  let cur: number | null = parseHM(act.__start?.d) ?? startMins;
  let lowerBound = false;
  let loc: string | null = day.startPlaceId;
  let locUnknown = false;
  let totalTravel = 0;
  let totalBuffer = 0;
  let missing = 0;
  let anyLate = false;
  let anyUnknownLate = false;
  const stops: StopTiming[] = [];

  for (const stop of day.stops) {
    if (stop.skipped) {
      stops.push({ uid: stop.uid, stop, leg: emptyLeg(stop.legIn), arrive: null, wait: 0, start: null, depart: null, lowerBound, lateMin: null, lateUnknown: false, warnings: ['ข้ามรายการนี้'], locationUnknown: false });
      continue;
    }
    const target = stopLocationId(stop);
    const isMove = stop.kind === 'place' || stop.kind === 'dinner';
    const unselected = stop.kind === 'dinner' && !stop.placeId;
    let leg: LegInfo;
    if (!isMove) {
      leg = { fromId: loc, toId: loc, mode: stop.legIn.mode, travelMin: 0, bufferMin: 0, source: 'same', reason: null, route: null, departMins: cur };
    } else {
      leg = withEstimate(resolveLeg(stop.legIn, loc, target, day, cur, ctx, unselected || locUnknown), ctx);
    }
    const real = act[stop.uid];
    const realArrive = parseHM(real?.a);
    const realDepart = parseHM(real?.d);
    const warnings: string[] = [];
    if (leg.source === 'none') {
      missing++;
      lowerBound = true;
    } else {
      totalTravel += leg.travelMin ?? 0;
      totalBuffer += leg.bufferMin;
    }
    let arrive: number | null = cur == null ? null : cur + (leg.travelMin ?? 0) + leg.bufferMin;
    if (realArrive != null) {
      arrive = realArrive;
      lowerBound = false; // รู้เวลาจริงแล้ว
    } else if (started && now != null && arrive != null && arrive < now) {
      arrive = now; // ยังไม่ถึงทั้งที่ควรถึงแล้ว → ถึงอย่างเร็วตอนนี้
    }
    let wait = 0;
    let start = arrive;
    let lateMin: number | null = null;
    let lateUnknown = false;
    const locked = parseHM(stop.lockedTime);
    if (locked != null && arrive != null) {
      if (arrive <= locked) {
        if (lowerBound) {
          // ไม่ทราบแน่ว่าทันหรือไม่ แต่เริ่มกิจกรรมไม่ก่อนเวลานัด
          lateUnknown = true;
          anyUnknownLate = true;
          warnings.push('ยังไม่แน่ใจว่าทันเวลานัด (มีช่วงที่ไม่มีข้อมูล)');
        } else {
          wait = locked - arrive;
        }
        start = locked;
      } else {
        lateMin = arrive - locked;
        anyLate = true;
        warnings.push(`สายจากเวลานัด ${lateMin} นาที${lowerBound ? ' อย่างน้อย' : ''}`);
      }
    }
    const place = stop.placeId ? ctx.getPlace(stop.placeId) : undefined;
    let depart = start == null ? null : start + Math.max(0, stop.stayMin);
    if (realDepart != null) depart = realDepart;
    else if (realArrive != null && now != null && depart != null && depart < now) depart = now; // ยังอยู่เกินแผน
    if (place && start != null && !lowerBound) {
      const open = parseHM(place.openTime);
      const close = parseHM(place.closeTime);
      const lo = parseHM(place.hours?.lastOrder);
      if (open != null && start < open) warnings.push(`ถึงก่อนเวลาเปิด (${place.openTime})`);
      if (close != null && depart != null && depart > close && close > (open ?? 0)) warnings.push(`อยู่เลยเวลาปิด (${place.closeTime})`);
      if (lo != null && start > lo && lo > (open ?? 0)) warnings.push(`ถึงหลังเวลารับออร์เดอร์สุดท้าย (${place.hours?.lastOrder})`);
    }
    const closed = closedOn(place, day.date);
    if (closed) warnings.unshift(closed);
    if (place && (place.coordStatus === 'area-center')) warnings.push('หมุดกลางย่าน — อาจต้องเดินต่อถึงร้านจริง');
    if (unselected) warnings.push('ยังไม่ได้เลือกร้าน');
    stops.push({ uid: stop.uid, stop, leg, arrive, wait, start, depart, lowerBound, lateMin, lateUnknown, warnings, locationUnknown: unselected || locUnknown });
    cur = depart;
    if (isMove) {
      if (unselected) locUnknown = true;
      else if (target) {
        loc = target;
        locUnknown = false;
      }
    }
  }

  let end: DaySchedule['end'] = null;
  if (day.endPlaceId) {
    const leg = withEstimate(resolveLeg(day.endLeg, loc, day.endPlaceId, day, cur, ctx, locUnknown), ctx);
    if (leg.source === 'none') {
      missing++;
      lowerBound = true;
    } else {
      totalTravel += leg.travelMin ?? 0;
      totalBuffer += leg.bufferMin;
    }
    let arrive = cur == null ? null : cur + (leg.travelMin ?? 0) + leg.bufferMin;
    const realEnd = parseHM(act.__end?.a);
    if (realEnd != null) {
      arrive = realEnd;
      lowerBound = false;
    } else if (started && now != null && arrive != null && arrive < now) arrive = now;
    const target = parseHM(day.endTime);
    let slack: number | null = null;
    if (arrive != null && target != null) {
      slack = target - arrive;
      if (slack < 0) anyLate = true;
      else if (lowerBound) slack = null; // ไม่สรุปว่าทัน
    }
    end = { leg, arrive, lowerBound, slackMin: slack };
  }

  if (missing) messages.push(`มี ${missing} ช่วงที่ยังไม่มีข้อมูลเวลาเดินทาง — เวลาหลังจากนั้นเป็น "อย่างเร็ว" ยังสรุปไม่ได้ว่าทัน`);
  let status: DaySchedule['status'];
  if (!hasTime) status = 'no-time';
  else if (anyLate) status = 'late';
  else if (missing || anyUnknownLate || !day.date || !day.endPlaceId) status = 'incomplete';
  else status = 'ok';

  return {
    hasTime,
    hasDate: !!day.date,
    stops,
    end,
    totalTravelMin: missing ? null : totalTravel,
    totalBufferMin: totalBuffer,
    missingLegs: missing,
    status,
    messages,
  };
}

function emptyLeg(leg: Leg): LegInfo {
  return { fromId: null, toId: null, mode: leg.mode, travelMin: null, bufferMin: 0, source: 'same', reason: null, route: null, departMins: null };
}

/** ช่วงเวลาเที่ยวจริง (สำหรับอากาศ): [เวลาออก, เวลาถึงจุดสิ้นสุด/ออกจากจุดสุดท้าย] */
export function tripWindow(day: Day, s: DaySchedule): { from: number; to: number } | null {
  const from = parseHM(day.startTime);
  if (from == null) return null;
  let to = s.end?.arrive ?? null;
  if (to == null) {
    const last = [...s.stops].reverse().find((x) => x.depart != null);
    to = last?.depart ?? null;
  }
  const endT = parseHM(day.endTime);
  if (to == null) to = endT ?? from + 60;
  return { from, to: Math.max(to, from + 60) };
}
