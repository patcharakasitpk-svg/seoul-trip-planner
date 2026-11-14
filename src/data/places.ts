import type { Place } from '../core/types';
import { BASE_PLACES } from './basePlaces';
import research from './places.json';
import transitExtra from './transit.json';

/** ข้อมูลจากการค้นคว้า (ตรวจสอบเมื่อ checkedAt) — ฟิลด์ที่ตรวจไม่ได้เป็น null */
const RESEARCH = research as unknown as Place[];
/** สถานีใกล้สุดของสถานที่เดิม (ค้นคว้าแยก) — ใช้เมื่อสถานที่ยังไม่มีข้อมูล transit ของตัวเอง */
const TRANSIT = transitExtra as unknown as Record<string, NonNullable<Place['transit']>>;

/** รวมข้อมูลตั้งต้น + ผลค้นคว้า: สถานที่ตั้งต้นใช้พิกัดที่ผู้ใช้กำหนดเสมอ */
export function buildPublicPlaces(): Place[] {
  const out = new Map<string, Place>();
  for (const b of BASE_PLACES) out.set(b.id, { ...b });
  for (const r of RESEARCH) {
    const base = out.get(r.id);
    if (base) {
      out.set(r.id, {
        ...base,
        nameKo: base.nameKo ?? r.nameKo,
        address: base.address ?? r.address,
        hours: r.hours ?? base.hours,
        openTime: r.openTime ?? base.openTime,
        closeTime: r.closeTime ?? base.closeTime,
        budget: r.budget ?? base.budget,
        sources: [...base.sources, ...(r.sources ?? [])],
        checkedAt: r.checkedAt ?? base.checkedAt,
        notes: r.notes ?? base.notes,
        food: r.food ?? base.food,
        transit: r.transit ?? base.transit,
        fashionTypes: base.fashionTypes ?? r.fashionTypes,
        reasonTh: base.reasonTh,
      });
    } else {
      const coordsOk = r.lat != null && r.lng != null && r.coordStatus !== 'unverified';
      out.set(r.id, { ...r, lat: coordsOk ? r.lat : null, lng: coordsOk ? r.lng : null, coordStatus: coordsOk ? r.coordStatus : 'unverified', kind: r.kind ?? 'place' });
    }
  }
  return [...out.values()].map((p) => (p.transit || !TRANSIT[p.id] ? p : { ...p, transit: TRANSIT[p.id] }));
}

export const PUBLIC_PLACES = buildPublicPlaces();

export const CATEGORY_LABEL: Record<string, string> = {
  base: 'จุดหลัก',
  food: 'ร้านอาหารและมื้อเย็น',
  fashion: 'เสื้อผ้าและแฟชั่น',
  beauty: 'เครื่องสำอางและสกินแคร์',
  market: 'ตลาดและ Street Food',
  sight: 'พิพิธภัณฑ์และจุดเที่ยว',
};

export const CATEGORY_ICON: Record<string, string> = { base: '📍', food: '🍜', fashion: '👕', beauty: '💄', market: '🍢', sight: '🏛️' };

export const DINING_ZONE_LABEL: Record<string, string> = { 'near-coex': 'ใกล้ COEX', 'near-hotel': 'ใกล้โรงแรม', between: 'ระหว่าง COEX–โรงแรม', other: 'ย่านอื่น' };
export const FOOD_TYPE_LABEL: Record<string, string> = { 'one-dish': 'จานเดียว', noodle: 'อาหารเส้น', bbq: 'ปิ้งย่าง', market: 'อาหารตลาด' };

export const COORD_LABEL: Record<string, string> = {
  given: 'พิกัดตั้งต้น',
  verified: 'พิกัดตรวจสอบแล้ว',
  'area-center': 'หมุดกลางย่าน — อาจต้องเดินต่อถึงร้านจริง',
  user: 'พิกัดที่ผู้ใช้กรอก',
  unverified: 'ยังไม่ตรวจสอบพิกัด — ยังไม่ปักหมุด',
};
