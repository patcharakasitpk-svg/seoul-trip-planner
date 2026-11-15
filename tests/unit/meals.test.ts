import { describe, it, expect } from 'vitest';
import { MEALS, mealOf, mealName, newMeal, mealInsertIndex } from '../../src/core/meals';
import { newStop, newPlan } from '../../src/core/planOps';
import { computeSchedule } from '../../src/core/schedule';
import { validatePlan } from '../../src/storage/validate';
import { ctxWith, day } from './helpers';

describe('มื้ออาหาร', () => {
  it('4 แบบ: เช้า กลางวัน เย็น กินเล่น', () => {
    expect(Object.keys(MEALS)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(mealName(newMeal('breakfast'))).toBe('มื้อเช้า');
    expect(mealName(newMeal('snack'))).toBe('มื้อกินเล่น');
    expect(newMeal('snack').stayMin).toBeLessThan(newMeal('dinner').stayMin);
  });
  it('มื้อเก่าที่ไม่มีชนิด = มื้อเย็น', () => {
    expect(mealOf(newStop('dinner', null, 60))).toBe('dinner');
  });
  it('วางมื้อตามเวลา: เช้าก่อนจุดแรก · กลางวันก่อนจุดที่ถึงหลังเที่ยง · เย็นท้ายวัน', () => {
    const d = day([['a', 120], ['b', 120], ['c', 60]]); // ถึง a 09:30, b 12:00, c 14:30 (ตาราง 30 นาที)
    const s = computeSchedule(d, ctxWith({ 'hotel>a': 30, 'a>b': 30, 'b>c': 30, 'c>hotel': 30 }));
    expect(mealInsertIndex(d, s, 'breakfast')).toBe(0);
    expect(mealInsertIndex(d, s, 'lunch')).toBe(1);
    expect(mealInsertIndex(d, s, 'dinner')).toBe(3);
  });
  it('เก็บชนิดมื้อในแผน (ค่าแปลกถูกทิ้ง)', () => {
    const p = newPlan();
    p.days[0].stops = [newMeal('lunch'), { ...newMeal('snack'), meal: 'xx' as any }];
    const v = validatePlan(JSON.parse(JSON.stringify(p)));
    expect(v.ok && v.plan.days[0].stops.map((s) => s.meal)).toEqual(['lunch', undefined]);
  });
});

import { setMeal } from '../../src/core/meals';
describe('เลือกมื้อให้ร้านอาหาร', () => {
  it('ร้านอาหารที่ใส่ในแผน → ตั้งเป็นมื้อได้ และยกเลิกได้', () => {
    const st = newStop('place', 'myeongdong-kyoja', 60);
    const lunch = setMeal(st, 'lunch');
    expect(lunch).toMatchObject({ kind: 'dinner', meal: 'lunch', placeId: 'myeongdong-kyoja', stayMin: 60 });
    expect(mealName(lunch)).toBe('มื้อกลางวัน');
    const back = setMeal(lunch, null);
    expect(back).toMatchObject({ kind: 'place', placeId: 'myeongdong-kyoja' });
    expect(back.meal).toBeUndefined();
  });
  it('ช่องมื้อที่ยังไม่เลือกร้าน ยกเลิกมื้อไม่ได้ (เปลี่ยนชนิดได้อย่างเดียว)', () => {
    const slot = newMeal('dinner');
    expect(setMeal(slot, null)).toBe(slot);
    expect(setMeal(slot, 'breakfast').meal).toBe('breakfast');
  });
});
