import { describe, it, expect } from 'vitest';
import { newPlan, newStop } from '../../src/core/planOps';
import { buildShareUrl, decodeFragment, encodePlan, parseJsonPlan } from '../../src/storage/share';
import { validatePlan } from '../../src/storage/validate';

describe('share & import', () => {
  it('ลิงก์ส่งแผนที่ปรับแล้วไปด้วย และอ่านกลับได้ครบ', () => {
    const p = newPlan('ทดสอบ');
    p.days[0].date = '2026-11-20';
    p.days[0].startTime = '18:10';
    p.days[0].startPlaceId = 'coex';
    p.days[0].stops.unshift(newStop('place', 'library', 25, { lockedTime: '18:30', note: 'นัดลูกค้า' }));
    p.days[0].stops[0].legIn = { mode: 'WALKING', manualMin: 7, manualKind: 'user' };
    const r = buildShareUrl(p, 'https://example.com/app/#old');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith('https://example.com/app/#plan=')).toBe(true);
    const back = decodeFragment(new URL(r.url).hash)!;
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.plan.days[0].startPlaceId).toBe('coex');
    expect(back.plan.days[0].startTime).toBe('18:10');
    expect(back.plan.days[0].stops[0]).toMatchObject({ placeId: 'library', stayMin: 25, lockedTime: '18:30', note: 'นัดลูกค้า', legIn: { mode: 'WALKING', manualMin: 7 } });
  });
  it('ไม่ส่ง API key หรือฟิลด์แปลกปลอม', () => {
    const p: any = newPlan();
    p.apiKey = 'AIzaSECRET';
    p.days[0].routeCache = { x: 1 };
    const back = decodeFragment('#' + encodePlan(p))!;
    expect(back.ok && JSON.stringify(back.plan)).not.toMatch(/AIza|routeCache/);
  });
  it('ตรวจข้อมูลก่อนนำเข้า: ปฏิเสธข้อมูลผิดรูป', () => {
    expect(parseJsonPlan('{bad').ok).toBe(false);
    expect(validatePlan({ version: 2, days: [{}] }).ok).toBe(false);
    expect(validatePlan({ version: 1, days: [] }).ok).toBe(false);
    expect(decodeFragment('#plan=@@@')!.ok).toBe(false);
    const v = validatePlan({ version: 1, days: [{ date: 'xx', startTime: '99:99', stops: [{ kind: 'evil' }, { kind: 'place', placeId: 'a', stayMin: -5 }] }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.days[0].date).toBeNull();
    expect(v.plan.days[0].startTime).toBeNull();
    expect(v.plan.days[0].stops).toHaveLength(1);
    expect(v.plan.days[0].stops[0].stayMin).toBe(0);
  });
  it('แผนใหญ่เกินไปให้ใช้ JSON แทน', () => {
    const p = newPlan();
    for (const d of p.days) for (let i = 0; i < 40; i++) d.stops.push(newStop('place', `custom-${i}-${Math.random()}`, 30, { note: 'x'.repeat(200) + Math.random() }));
    expect(buildShareUrl(p, 'https://x.y/').ok).toBe(false);
  });
});

import { describe as d2, it as i2, expect as e2, beforeEach } from 'vitest';
import { loadPlans } from '../../src/storage/storage';
d2('ข้อมูลที่อ่านไม่ได้ ไม่ถูกทับทิ้ง', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
  });
  i2('อ่านไม่ได้ → เก็บสำเนาข้อมูลดิบไว้ในกุญแจสำรองก่อน', () => {
    store.set('stp.v1.plans', '{"plans":[{"version":99}]}');
    e2(loadPlans()).toBeNull();
    const backups = [...store.keys()].filter((k) => k.startsWith('stp.v1.plans.backup-'));
    e2(backups).toHaveLength(1);
    e2(store.get(backups[0])).toBe('{"plans":[{"version":99}]}');
  });
});
