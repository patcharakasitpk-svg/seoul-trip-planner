import type { Day, Place } from './types';
import { computeSchedule, stopLocationId, type DaySchedule, type ScheduleCtx } from './schedule';
import { straightLineM } from './geo';

export interface DayDiff {
  before: DaySchedule;
  after: DaySchedule;
  travelDelta: number | null; // เวลาเดินทางรวมที่เพิ่ม/ลด
  endBefore: number | null;
  endAfter: number | null;
  endDelta: number | null;
  slackAfter: number | null;
  /** นัดที่ได้รับผลกระทบ */
  affectedLocks: { uid: string; title: string; before: number | null; after: number | null; lateAfter: number | null; unknown: boolean }[];
  complete: boolean;
}

export function diffDays(oldDay: Day, newDay: Day, ctx: ScheduleCtx, titleOf: (uid: string) => string): DayDiff {
  const before = computeSchedule(oldDay, ctx);
  const after = computeSchedule(newDay, ctx);
  const tb = before.totalTravelMin;
  const ta = after.totalTravelMin;
  const endBefore = before.end?.arrive ?? null;
  const endAfter = after.end?.arrive ?? null;
  const affected: DayDiff['affectedLocks'] = [];
  for (const sa of after.stops) {
    if (!sa.stop.lockedTime) continue;
    const sb = before.stops.find((x) => x.uid === sa.uid);
    affected.push({
      uid: sa.uid,
      title: titleOf(sa.uid),
      before: sb?.arrive ?? null,
      after: sa.arrive,
      lateAfter: sa.lateMin,
      unknown: sa.lateUnknown,
    });
  }
  const complete = !after.missingLegs && !before.missingLegs && after.hasTime;
  return {
    before,
    after,
    travelDelta: tb != null && ta != null ? ta + after.totalBufferMin - (tb + before.totalBufferMin) : null,
    endBefore,
    endAfter,
    endDelta: endBefore != null && endAfter != null && complete ? endAfter - endBefore : null,
    slackAfter: after.end?.slackMin ?? null,
    affectedLocks: affected,
    complete,
  };
}

/**
 * แนะนำลำดับ: จุดยึด (นัดล็อก / มื้อเย็น / พัก / เวลาสำรอง) อยู่ตำแหน่งเดิม
 * จัดเฉพาะจุดอิสระในแต่ละช่วงระหว่างจุดยึด ให้ระยะเส้นตรงรวมน้อยที่สุด
 * (ใช้ระยะเส้นตรงเป็นตัวจัดเรียงเท่านั้น ผลเวลาจริงต้องดูจากตารางเปรียบเทียบ)
 */
export function suggestOrder(day: Day, getPlace: (id: string) => Place | undefined): { order: string[]; changed: boolean; beforeM: number; afterM: number } {
  const coordOf = (id: string | null) => {
    if (!id) return null;
    const p = getPlace(id);
    return p && p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
  };
  const isAnchor = (i: number) => {
    const s = day.stops[i];
    return !!s.lockedTime || s.kind !== 'place' || !coordOf(s.placeId);
  };
  const order = day.stops.map((s) => s.uid);
  let segStart = 0;
  let prevLoc = coordOf(day.startPlaceId);
  for (let i = 0; i <= day.stops.length; i++) {
    if (i === day.stops.length || isAnchor(i)) {
      const seg = day.stops.slice(segStart, i);
      if (seg.length > 1) {
        let nextLoc = i < day.stops.length ? coordOf(stopLocationId(day.stops[i])) : coordOf(day.endPlaceId);
        if (i < day.stops.length && !nextLoc) nextLoc = null;
        const best = bestPermutation(seg.map((s) => ({ uid: s.uid, c: coordOf(s.placeId)! })), prevLoc, nextLoc);
        order.splice(segStart, seg.length, ...best);
      }
      if (i < day.stops.length) {
        const c = coordOf(stopLocationId(day.stops[i]));
        if (c) prevLoc = c;
        else if (seg.length) {
          const lastUid = order[i - 1];
          prevLoc = coordOf(day.stops.find((s) => s.uid === lastUid)?.placeId ?? null) ?? prevLoc;
        }
      }
      segStart = i + 1;
    }
  }
  const lenOf = (uids: string[]) => {
    const pts = [coordOf(day.startPlaceId), ...uids.map((u) => coordOf(stopLocationId(day.stops.find((s) => s.uid === u)!))), coordOf(day.endPlaceId)].filter(Boolean) as { lat: number; lng: number }[];
    let t = 0;
    for (let k = 1; k < pts.length; k++) t += straightLineM(pts[k - 1], pts[k]);
    return t;
  };
  const beforeM = lenOf(day.stops.map((s) => s.uid));
  const afterM = lenOf(order);
  const changed = afterM < beforeM - 1 && order.some((u, k) => u !== day.stops[k].uid);
  return { order: changed ? order : day.stops.map((s) => s.uid), changed, beforeM, afterM: changed ? afterM : beforeM };
}

function bestPermutation(items: { uid: string; c: { lat: number; lng: number } }[], from: { lat: number; lng: number } | null, to: { lat: number; lng: number } | null): string[] {
  const cost = (arr: typeof items) => {
    let t = 0;
    if (from) t += straightLineM(from, arr[0].c);
    for (let k = 1; k < arr.length; k++) t += straightLineM(arr[k - 1].c, arr[k].c);
    if (to) t += straightLineM(arr[arr.length - 1].c, to);
    return t;
  };
  if (items.length <= 7) {
    let best = items;
    let bestCost = cost(items);
    const permute = (arr: typeof items, k: number) => {
      if (k === arr.length) {
        const c = cost(arr);
        if (c < bestCost - 0.5) {
          bestCost = c;
          best = [...arr];
        }
        return;
      }
      for (let j = k; j < arr.length; j++) {
        [arr[k], arr[j]] = [arr[j], arr[k]];
        permute(arr, k + 1);
        [arr[k], arr[j]] = [arr[j], arr[k]];
      }
    };
    permute([...items], 0);
    return best.map((x) => x.uid);
  }
  // 2-opt สำหรับรายการยาว
  let arr = [...items];
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < arr.length - 1; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const cand = [...arr.slice(0, a), ...arr.slice(a, b + 1).reverse(), ...arr.slice(b + 1)];
        if (cost(cand) < cost(arr) - 0.5) {
          arr = cand;
          improved = true;
        }
      }
    }
  }
  return arr.map((x) => x.uid);
}

/** สถานที่ใกล้จุด (ระยะเส้นตรง) */
export function nearby(center: { lat: number; lng: number }, places: Place[], filter: (p: Place) => boolean, maxM = 1500, limit = 6): { place: Place; distM: number }[] {
  return places
    .filter((p) => p.lat != null && p.lng != null && filter(p))
    .map((p) => ({ place: p, distM: straightLineM(center, { lat: p.lat!, lng: p.lng! }) }))
    .filter((x) => x.distM <= maxM && x.distM > 1)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, limit);
}
