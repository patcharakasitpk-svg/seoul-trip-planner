import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/storage/validate';
import { newPlan } from '../../src/core/planOps';
import { TEMPLATES, applyDatedTemplate } from '../../src/data/templates';
import { planToTripDocs, planToPersonal, diffTripDocs, tripDocsToPlan, type RemoteTrip } from '../../src/core/tripDocs';
import type { Plan } from '../../src/core/types';

/** แผนตัวอย่างทั้งทริป (แม่แบบ) + สถานที่ที่เพิ่มเอง 4 แห่ง — ไม่ใช้ข้อมูลจริงของผู้ใช้ */
const real = (): Plan => {
  const base = newPlan();
  applyDatedTemplate(base, TEMPLATES.find((t) => t.days.some((d) => d.date))!);
  base.days[0].stops[0].note = 'ฝากกระเป๋า';
  const place = (id: string, name: string, lat: number, lng: number) => ({ id, nameTh: name, nameEn: name, category: 'sight', area: 'เพิ่มเอง', lat, lng, coordStatus: 'user', reasonTh: 'เพิ่มเอง', suggestedStayMin: 45, indoor: false, sources: [], custom: true });
  (base as any).customPlaces = [place('custom-a1', 'ร้านไก่ทอด', 37.554, 126.935), place('custom-cmwhi6v9m4k7a2209', 'Lotte Christmas', 37.512, 127.099), place('custom-c3', 'คลอง', 37.569, 126.978), place('custom-d4', 'สถานี', 37.57, 126.992)];
  base.coordOverrides = { 'h-coffee-roasters-seongsu': { lat: 37.54, lng: 127.05 } };
  const v = validatePlan(JSON.parse(JSON.stringify(base)));
  if (!v.ok) throw new Error(v.error);
  v.plan.packing = [{ id: 'k1', text: 'พาสปอร์ต', group: 'เอกสาร', done: true }];
  v.plan.coldLevel = 'high';
  return v.plan;
};

/** จำลองสิ่งที่อยู่ใน Firestore หลังเขียนเอกสารทั้งหมด */
function asRemote(plan: Plan): RemoteTrip {
  const d = planToTripDocs(plan);
  return {
    name: d.name,
    dayOrder: d.dayOrder,
    days: Object.fromEntries(Object.entries(d.days).map(([k, v]) => [k, { day: v, by: { uid: 'x' } }])),
    places: Object.fromEntries(Object.entries(d.places).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    overrides: d.overrides,
  };
}

describe('แผน ⇄ เอกสารทริปที่แชร์', () => {
  it('แผนจริง (7 วัน · 4 สถานที่) แปลงไปแล้วกลับมาได้เหมือนเดิมทุกค่า ยกเว้นของส่วนตัวที่มาจากเครื่องนี้', () => {
    const p = real();
    const back = tripDocsToPlan(p.id, asRemote(p), planToPersonal(p), p)!;
    expect(back).not.toBeNull();
    expect({ ...back, updatedAt: '' }).toEqual({ ...p, updatedAt: '' });
  });
  it('ของส่วนตัวไม่อยู่ในเอกสารทริป', () => {
    const json = JSON.stringify(planToTripDocs(real()));
    expect(json).not.toContain('พาสปอร์ต');
    expect(json).not.toContain('coldLevel');
  });
  it('แก้วันเดียว → เขียนแค่วันนั้น · เพิ่ม/ลบสถานที่ → เขียน/ลบเฉพาะแห่งนั้น', () => {
    const p = real();
    const before = planToTripDocs(p);
    p.days[2].title = 'COEX ทั้งวัน';
    p.customPlaces = p.customPlaces.filter((c) => !c.nameTh.startsWith('Lotte'));
    const ops = diffTripDocs(before, planToTripDocs(p));
    expect(ops.map((o) => `${o.kind}:${'id' in o ? o.id : ''}:${'data' in o && o.data === null ? 'del' : 'set'}`)).toEqual([`day:${p.days[2].id}:set`, 'place:custom-cmwhi6v9m4k7a2209:del']);
  });
  it('ไม่มีอะไรเปลี่ยน = ไม่เขียนอะไร (ไม่วนส่งซ้ำ)', () => {
    const p = real();
    const remote = tripDocsToPlan(p.id, asRemote(p), planToPersonal(p), p)!;
    expect(diffTripDocs(planToTripDocs(p), planToTripDocs(remote))).toEqual([]);
  });
  it('ข้อมูลจากเพื่อนที่ผิดรูป/อันตรายถูกตรวจทิ้ง · วันที่ไม่มีในลำดับต่อท้ายตามวันที่', () => {
    const p = real();
    const r = asRemote(p);
    r.days['dNew'] = { day: { date: '2026-12-07', stops: [{ kind: 'evil' }, { kind: 'place', placeId: 'coex', stayMin: 60 }] } };
    r.places['custom-bad'] = { nameTh: 'x', links: ['javascript:alert(1)'] };
    r.places['not-custom'] = 5;
    const back = tripDocsToPlan(p.id, r, planToPersonal(p), p)!;
    expect(back.days.at(-1)!.id).toBe('dNew');
    expect(back.days.at(-1)!.stops).toHaveLength(1);
    expect(back.customPlaces.find((c) => c.id === 'custom-bad')!.links).toBeNull();
  });
  it('ยังไม่มีวันในทริป = ยังประกอบแผนไม่ได้', () => {
    const p = real();
    expect(tripDocsToPlan(p.id, { days: {}, places: {} }, planToPersonal(p))).toBeNull();
  });
});
