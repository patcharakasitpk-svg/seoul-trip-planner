import type { Day, Stop } from './types';
import type { DaySchedule } from './schedule';
import { newStop } from './planOps';
import { parseHM } from './time';

/** มื้ออาหาร 4 แบบ (Stop.kind = 'dinner' คือ "ช่องมื้ออาหาร" ทุกแบบ — ชื่อ kind คงไว้เพื่อให้แผนเก่าใช้ได้) */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: Record<Meal, { th: string; icon: string; stay: number; at: string | null }> = {
  breakfast: { th: 'มื้อเช้า', icon: '🍳', stay: 45, at: '08:00' },
  lunch: { th: 'มื้อกลางวัน', icon: '🍜', stay: 60, at: '12:00' },
  dinner: { th: 'มื้อเย็น', icon: '🍽️', stay: 75, at: '18:00' },
  snack: { th: 'มื้อกินเล่น', icon: '🧋', stay: 20, at: null },
};
export const isMeal = (x: unknown): x is Meal => typeof x === 'string' && x in MEALS;

export const mealOf = (s: Stop): Meal => (isMeal(s.meal) ? s.meal : 'dinner');
export const mealName = (s: Stop) => MEALS[mealOf(s)].th;
export const mealIcon = (s: Stop) => MEALS[mealOf(s)].icon;

export function newMeal(meal: Meal): Stop {
  return newStop('dinner', null, MEALS[meal].stay, { title: MEALS[meal].th, meal });
}

/** ตำแหน่งที่ควรวางมื้อ: ก่อนจุดแรกที่ถึงหลังเวลามื้อ (ระหว่างทาง = ก่อนช่องมื้ออื่นหรือท้ายสุด) */
export function mealInsertIndex(day: Day, s: DaySchedule, meal: Meal): number {
  const at = parseHM(MEALS[meal].at);
  if (at == null) {
    const i = day.stops.findIndex((x) => x.kind === 'dinner');
    return i >= 0 ? i : day.stops.length;
  }
  const i = s.stops.findIndex((t) => !t.stop.skipped && t.arrive != null && t.arrive >= at);
  if (i >= 0) return i;
  return meal === 'breakfast' ? 0 : day.stops.length;
}

/**
 * ตั้ง/ยกเลิกมื้อของจุดแวะ: ร้านที่ใส่ในแผน → เป็นช่องมื้อ (kind 'dinner') ที่มีร้านแล้ว
 * ยกเลิก (null) → กลับเป็นจุดแวะธรรมดา · ช่องมื้อที่ยังไม่มีร้านยกเลิกไม่ได้ (ไม่งั้นเหลือรายการว่าง)
 */
export function setMeal(s: Stop, meal: Meal | null): Stop {
  if (meal == null) {
    if (s.kind !== 'dinner' || !s.placeId) return s;
    const { meal: _m, ...rest } = s;
    return { ...rest, kind: 'place', title: undefined };
  }
  return { ...s, kind: 'dinner', meal, title: MEALS[meal].th };
}
