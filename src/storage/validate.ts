import type { Category, Day, Leg, Place, Plan, Stop, TravelMode } from '../core/types';
import { isValidDate, parseHM } from '../core/time';
import { uid } from '../core/planOps';

/** ตรวจและสร้างแผนใหม่จากข้อมูลภายนอก (ลิงก์/JSON) — เก็บเฉพาะฟิลด์ที่รู้จัก */
export function validatePlan(input: unknown): { ok: true; plan: Plan; warnings: string[] } | { ok: false; error: string } {
  const warnings: string[] = [];
  if (!isObj(input)) return { ok: false, error: 'ไม่ใช่ข้อมูลแผนที่ถูกต้อง' };
  if (input.version !== 1) return { ok: false, error: 'เวอร์ชันข้อมูลแผนไม่รองรับ' };
  if (!Array.isArray(input.days) || input.days.length === 0) return { ok: false, error: 'ไม่มีรายการวัน' };
  if (input.days.length > 30) return { ok: false, error: 'จำนวนวันมากเกินไป (สูงสุด 30)' };
  const days: Day[] = [];
  for (const d of input.days) {
    if (!isObj(d)) return { ok: false, error: 'ข้อมูลวันไม่ถูกต้อง' };
    const stops: Stop[] = [];
    for (const s of Array.isArray(d.stops) ? d.stops.slice(0, 60) : []) {
      if (!isObj(s)) continue;
      const kind = (['place', 'dinner', 'break', 'buffer'] as const).find((k) => k === s.kind);
      if (!kind) {
        warnings.push('ข้ามรายการที่ไม่รู้จักประเภท');
        continue;
      }
      stops.push({
        uid: str(s.uid, 40) || uid(),
        kind,
        placeId: str(s.placeId, 80) || null,
        title: str(s.title, 80) || undefined,
        stayMin: clampNum(s.stayMin, 0, 24 * 60, 30),
        lockedTime: hm(s.lockedTime),
        note: str(s.note, 500),
        legIn: leg(s.legIn),
        skipped: s.skipped === true || undefined,
      });
    }
    days.push({
      id: str(d.id, 40) || uid('d'),
      date: isValidDate(d.date) ? d.date : null,
      startPlaceId: str(d.startPlaceId, 80) || null,
      startTime: hm(d.startTime),
      endPlaceId: str(d.endPlaceId, 80) || null,
      endTime: hm(d.endTime),
      bufferMin: clampNum(d.bufferMin, 0, 120, 0),
      prefs: {
        lessWalking: isObj(d.prefs) && d.prefs.lessWalking === true,
        fewerTransfers: isObj(d.prefs) && d.prefs.fewerTransfers === true,
        fastest: isObj(d.prefs) ? d.prefs.fastest !== false : true,
      },
      afterBooth: d.afterBooth === true,
      stops,
      endLeg: leg(d.endLeg),
      weatherRef: str(d.weatherRef, 80) || 'seoul',
    });
  }
  const customPlaces: Place[] = [];
  for (const p of Array.isArray(input.customPlaces) ? input.customPlaces.slice(0, 100) : []) {
    const cp = customPlace(p);
    if (cp) customPlaces.push(cp);
    else warnings.push('ข้ามสถานที่ที่เพิ่มเองซึ่งข้อมูลไม่ครบ');
  }
  const stayOverrides: Record<string, number> = {};
  if (isObj(input.stayOverrides)) for (const [k, v] of Object.entries(input.stayOverrides).slice(0, 300)) if (typeof v === 'number') stayOverrides[k.slice(0, 80)] = clampNum(v, 0, 1440, 30);
  const checklist: Plan['checklist'] = {};
  if (isObj(input.checklist)) for (const [k, v] of Object.entries(input.checklist).slice(0, 30)) if (isObj(v)) checklist[k.slice(0, 40)] = Object.fromEntries(Object.entries(v).slice(0, 40).map(([a, b]) => [a.slice(0, 60), b === true]));
  const extraChecklist: Plan['extraChecklist'] = {};
  if (isObj(input.extraChecklist)) for (const [k, v] of Object.entries(input.extraChecklist).slice(0, 30)) if (Array.isArray(v)) extraChecklist[k.slice(0, 40)] = v.slice(0, 20).map((x) => str(x, 80)).filter(Boolean);
  return {
    ok: true,
    warnings,
    plan: {
      version: 1,
      id: str(input.id, 40) || uid('p'),
      name: str(input.name, 80) || 'แผนเที่ยวโซล',
      days,
      customPlaces,
      stayOverrides,
      saved: Array.isArray(input.saved) ? input.saved.slice(0, 300).map((x) => str(x, 80)).filter(Boolean) : [],
      coldLevel: input.coldLevel === 'low' || input.coldLevel === 'high' ? input.coldLevel : 'normal',
      checklist,
      extraChecklist,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt.slice(0, 40) : new Date().toISOString(),
    },
  };
}

function customPlace(p: unknown): Place | null {
  if (!isObj(p)) return null;
  const name = str(p.nameTh, 120) || str(p.nameEn, 120);
  if (!name) return null;
  const lat = typeof p.lat === 'number' && p.lat >= 33 && p.lat <= 39 ? p.lat : null;
  const lng = typeof p.lng === 'number' && p.lng >= 124 && p.lng <= 132 ? p.lng : null;
  const cats: Category[] = ['food', 'fashion', 'beauty', 'market', 'sight'];
  return {
    id: str(p.id, 80).startsWith('custom-') ? str(p.id, 80) : `custom-${uid('c')}`,
    nameTh: name,
    nameEn: str(p.nameEn, 120) || name,
    category: cats.find((c) => c === p.category) ?? 'sight',
    area: str(p.area, 60) || 'เพิ่มเอง',
    address: str(p.address, 200) || null,
    lat: lat != null && lng != null ? lat : null,
    lng: lat != null && lng != null ? lng : null,
    coordStatus: lat != null && lng != null ? 'user' : 'unverified',
    reasonTh: str(p.reasonTh, 300) || 'ผู้ใช้เพิ่มเอง',
    suggestedStayMin: clampNum(p.suggestedStayMin, 0, 1440, 60),
    indoor: p.indoor === true,
    sources: [],
    custom: true,
  };
}

function leg(l: unknown): Leg {
  const modes: TravelMode[] = ['TRANSIT', 'WALKING', 'DRIVING'];
  if (!isObj(l)) return { mode: 'TRANSIT', manualMin: null };
  const manual = typeof l.manualMin === 'number' && l.manualMin >= 0 && l.manualMin <= 1440 ? Math.round(l.manualMin) : null;
  return {
    mode: modes.find((m) => m === l.mode) ?? 'TRANSIT',
    manualMin: manual,
    manualKind: manual != null ? (l.manualKind === 'estimate' ? 'estimate' : 'user') : undefined,
  };
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const hm = (x: unknown) => (typeof x === 'string' && parseHM(x) != null && parseHM(x)! < 1440 ? x : null);
function clampNum(x: unknown, lo: number, hi: number, def: number) {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def;
}
