import { describe, it, expect } from 'vitest';
import { cleanPacking, defaultPacking, mergePackingDone, packGroups } from '../../src/core/packing';
import { validatePlan } from '../../src/storage/validate';
import { newPlan } from '../../src/core/planOps';
import { decodeFragment, encodePlan, keepLocalCheckins } from '../../src/storage/share';

let n = 0;
const id = () => `k${++n}`;

describe('สิ่งของที่ต้องใช้', () => {
  it('รายการแนะนำมีหมวดเอกสาร/งาน COEX/กันหนาว และเรียงหมวดตามลำดับ', () => {
    const items = defaultPacking(id);
    const groups = packGroups(items).map((g) => g.name);
    expect(groups[0]).toBe('เอกสารและเงิน');
    expect(groups).toContain('งานที่ COEX');
    expect(groups).toContain('เสื้อผ้ากันหนาว');
    expect(items.every((i) => !i.done)).toBe(true);
  });
  it('ตรวจข้อมูล: ตัดของว่าง/id ซ้ำ · หมวดว่าง = อื่น ๆ · done ต้องเป็น true เท่านั้น', () => {
    const out = cleanPacking([{ id: 'a', text: ' พาสปอร์ต ', group: 'เอกสาร', done: true }, { id: 'a', text: 'ซ้ำ' }, { id: 'b', text: '' }, { id: 'c', text: 'ร่ม', done: 'yes' }, 5]);
    expect(out).toEqual([{ id: 'a', text: 'พาสปอร์ต', group: 'เอกสาร', done: true }, { id: 'c', text: 'ร่ม', group: 'อื่น ๆ', done: false }]);
    expect(cleanPacking('x')).toBeUndefined();
  });
  it('เก็บในแผน ส่งผ่านลิงก์ได้', () => {
    const p = newPlan();
    p.packing = [{ id: 'a', text: 'พาสปอร์ต', group: 'เอกสาร', done: true }];
    const back = decodeFragment('#' + encodePlan(p))!;
    expect(back.ok && back.plan.packing).toEqual(p.packing);
    expect(validatePlan(JSON.parse(JSON.stringify(newPlan()))).ok && 'packing' in (validatePlan(JSON.parse(JSON.stringify(newPlan()))) as any).plan).toBe(false);
  });
  it('รับแผนใหม่: ของที่ติ๊กในเครื่องนี้ยังติ๊กอยู่ · อีกเครื่องยังไม่มีรายการ = คงของเครื่องนี้', () => {
    const local = [{ id: 'a', text: 'A', group: 'g', done: true }, { id: 'b', text: 'B', group: 'g', done: false }];
    const incoming = [{ id: 'a', text: 'A', group: 'g', done: false }, { id: 'b', text: 'B', group: 'g', done: true }, { id: 'c', text: 'C', group: 'g', done: false }];
    expect(mergePackingDone(incoming, local)!.map((i) => i.done)).toEqual([true, true, false]);
    expect(mergePackingDone(undefined, local)).toBe(local);
    const lp = newPlan();
    lp.packing = local;
    const ip = { ...newPlan(), id: lp.id };
    expect(keepLocalCheckins(ip, lp).packing).toBe(local);
  });
});
