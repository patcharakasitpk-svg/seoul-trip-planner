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
    const rnd = () => Array.from({ length: 480 }, () => String.fromCharCode(0x0e01 + Math.floor(Math.random() * 46))).join('');
    for (const d of p.days) for (let i = 0; i < 40; i++) d.stops.push(newStop('place', `custom-${i}-${Math.random()}`, 30, { note: rnd() }));
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

import { TEMPLATES, applyDatedTemplate } from '../../src/data/templates';
import { newPlan as np2 } from '../../src/core/planOps';
import { MAX_QR_URL } from '../../src/storage/share';
d2('ส่งแผนทั้งทริปไปมือถือ', () => {
  const fullTrip = () => {
    const p = np2();
    applyDatedTemplate(p, TEMPLATES.find((t) => t.days.some((d) => d.date))!);
    for (const d of p.days) for (const s of d.stops) s.note = 'ซื้อของฝาก ลองชิมเมนูเด็ด';
    p.days[1].prefs = { lessWalking: true, fewerTransfers: false, fastest: false };
    p.days[1].stops[0].legIn = { mode: 'WALKING', manualMin: 9, manualKind: 'user' };
    p.days[2].actual = { __start: { d: '09:10' } };
    return p;
  };
  i2('ลิงก์แบบย่อเปิดกลับได้เหมือนเดิมทุกค่า', () => {
    const p = fullTrip();
    const back = decodeFragment('#' + encodePlan(p))!;
    const direct = validatePlan(JSON.parse(JSON.stringify(p)));
    e2(back.ok && direct.ok).toBe(true);
    if (!back.ok || !direct.ok) return;
    e2({ ...back.plan, updatedAt: '' }).toEqual({ ...direct.plan, updatedAt: '' });
  });
  i2('แผนทั้งทริปส่งเป็นลิงก์ได้เสมอ · QR เฉพาะเมื่อสั้นพอ', () => {
    const base = 'https://patcharakasitpk-svg.github.io/seoul-trip-planner/';
    const big = buildShareUrl(fullTrip(), base);
    e2(big.ok).toBe(true);
    if (big.ok) e2(big.qr).toBe(big.url.length <= MAX_QR_URL);
    const small = buildShareUrl(np2(), base);
    e2(small.ok && small.qr).toBe(true);
  });
});

import { keepLocalCheckins } from '../../src/storage/share';
d2('รับแผนใหม่ในมือถือ', () => {
  i2('เวลาเช็กอินในเครื่องนี้ไม่หาย · ถ้าแผนที่ส่งมามีเช็กอินแล้วใช้ของที่ส่งมา', () => {
    const local = np2();
    local.days[0].actual = { __start: { d: '08:05' } };
    local.days[1].actual = { __start: { d: '09:00' } };
    const incoming = JSON.parse(JSON.stringify(local));
    delete incoming.days[0].actual;
    incoming.days[1].actual = { __start: { d: '09:30' } };
    const out = keepLocalCheckins(incoming, local);
    e2(out.days[0].actual).toEqual({ __start: { d: '08:05' } });
    e2(out.days[1].actual).toEqual({ __start: { d: '09:30' } });
  });
});

import { cleanLinks } from '../../src/storage/validate';
d2('สถานที่ของฉัน: ลิงก์ รูป และชื่อวัน', () => {
  i2('เก็บเฉพาะลิงก์ http(s) · id รูปที่ปลอดภัย · ชื่อวันไม่เกิน 60 ตัว · ส่งผ่านลิงก์แผนได้', () => {
    expect(cleanLinks(['https://a.com/x', 'javascript:alert(1)', 'ftp://x', ' http://b.com '])).toEqual(['https://a.com/x', 'http://b.com']);
    expect(cleanLinks([])).toBeNull();
    const p = np2();
    p.days[0].title = 'เมียงดง · นัมแดมุน';
    p.customPlaces = [{ id: 'custom-a', nameTh: 'Onion', nameEn: 'Onion', category: 'food', area: 'x', lat: 37.5, lng: 127, coordStatus: 'user', reasonTh: '', suggestedStayMin: 45, indoor: true, sources: [], custom: true, notes: 'โน้ต', links: ['https://ig.com/a', 'javascript:x'], photos: ['ph-abc', '<bad>'] } as any];
    const back = decodeFragment('#' + encodePlan(p))!;
    e2(back.ok).toBe(true);
    if (!back.ok) return;
    e2(back.plan.days[0].title).toBe('เมียงดง · นัมแดมุน');
    e2(back.plan.customPlaces[0]).toMatchObject({ notes: 'โน้ต', links: ['https://ig.com/a'], photos: ['ph-abc'] });
    const long = validatePlan({ version: 1, days: [{ title: 'ก'.repeat(100), stops: [] }] });
    e2(long.ok && long.plan.days[0].title!.length).toBe(60);
  });
});
