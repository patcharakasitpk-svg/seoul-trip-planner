import type { Place } from './types';
import { coordError, parseLatLng } from './coords';
import { straightLineM } from './geo';

export type OwnCategory = 'food' | 'cafe' | 'fashion' | 'beauty' | 'market' | 'sight';
export const OWN_CATEGORY_LABEL: Record<OwnCategory, string> = { food: 'อาหาร', cafe: 'คาเฟ่', fashion: 'เสื้อผ้า', beauty: 'ความงาม/ของใช้', market: 'ตลาด', sight: 'เที่ยว' };

/**
 * สร้างสถานที่ที่ผู้ใช้เพิ่มเอง (ชื่อ + พิกัดที่วางมา) — ย่านเดาจากสถานที่ที่ใกล้ที่สุด (≤ 2 กม.) ไม่งั้น "เพิ่มเอง"
 * พิกัดว่างได้ (ยังจัดในแผนได้ แต่ไม่ปักหมุด) · พิกัดที่อ่านไม่ได้ = error
 */
export function buildOwnPlace(
  input: { id: string; name: string; category: string; coord: string; stay: number },
  known: Place[],
): { ok: true; place: Place } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: 'ใส่ชื่อสถานที่' };
  const cat = (Object.keys(OWN_CATEGORY_LABEL) as OwnCategory[]).find((c) => c === input.category) ?? 'sight';
  let lat: number | null = null;
  let lng: number | null = null;
  if (input.coord.trim()) {
    const c = parseLatLng(input.coord);
    if (!c) return { ok: false, error: coordError(input.coord) };
    ({ lat, lng } = c);
  }
  let area = 'เพิ่มเอง';
  if (lat != null && lng != null) {
    let best = Infinity;
    for (const k of known) {
      if (k.lat == null || k.lng == null || k.custom) continue;
      const d = straightLineM({ lat, lng }, { lat: k.lat, lng: k.lng });
      if (d < best && d <= 2000) {
        best = d;
        area = k.area;
      }
    }
  }
  const stay = Math.max(5, Math.min(600, Math.round(input.stay) || 45));
  return {
    ok: true,
    place: {
      id: input.id,
      nameTh: name,
      nameEn: name,
      category: cat === 'cafe' ? 'food' : cat,
      area,
      address: null,
      lat,
      lng,
      coordStatus: lat != null ? 'user' : 'unverified',
      reasonTh: 'เพิ่มเอง',
      suggestedStayMin: stay,
      indoor: cat !== 'sight' && cat !== 'market',
      food: cat === 'cafe' || cat === 'food' ? { type: cat === 'cafe' ? 'cafe' : 'one-dish', menu: [], mealMin: 30, minOrder: null, diningZone: 'other' } : null,
      sources: [],
      custom: true,
    },
  };
}
