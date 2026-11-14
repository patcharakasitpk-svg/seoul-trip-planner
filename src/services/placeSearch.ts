import type { Category, Place } from '../core/types';
import { isGoogleReady } from './google';

/**
 * ค้นหาสถานที่ใดก็ได้ด้วยชื่อ (นอกเหนือจากคลังที่คัดไว้)
 * - มี Google Maps: ใช้ Place.searchByText ของ Places API (New) — ต้องเปิด "Places API (New)" ในคีย์
 * - ไม่มีคีย์ / Google ใช้ไม่ได้: ใช้ Nominatim ของ OpenStreetMap (ฟรี ค้นเมื่อกดค้นหาเท่านั้น ตามนโยบายการใช้งาน)
 */
export interface SearchResult {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: Exclude<Category, 'base'>;
  provider: 'google' | 'osm';
  /** Google place id (ถ้ามี) ใช้ทำลิงก์เปิดใน Google Maps */
  googleId?: string | null;
}

export interface SearchOutcome {
  provider: 'google' | 'osm';
  results: SearchResult[];
  /** ข้อความแจ้ง เช่น Google ใช้ไม่ได้จึงสลับมาใช้ OSM */
  note?: string;
}

const SEOUL = { lat: 37.5663, lng: 126.9779 };
const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

/** เดาหมวดจากประเภทสถานที่ของ Google / OSM */
export function guessCategory(types: string[]): SearchResult['category'] {
  const t = types.map((x) => x.toLowerCase());
  const has = (...k: string[]) => t.some((x) => k.some((y) => x === y || x.endsWith(`_${y}`) || x.startsWith(`${y}_`)));
  if (has('restaurant', 'cafe', 'bakery', 'bar', 'food', 'coffee_shop', 'fast_food', 'pub', 'meal_takeaway', 'ice_cream')) return 'food';
  if (has('market', 'marketplace', 'supermarket', 'grocery_store')) return 'market';
  if (has('beauty', 'cosmetics', 'drugstore', 'pharmacy', 'perfume', 'hairdresser', 'beauty_salon', 'spa')) return 'beauty';
  if (has('clothing_store', 'clothes', 'shoe_store', 'shoes', 'fashion', 'boutique', 'department_store', 'shopping_mall', 'mall', 'jewelry_store')) return 'fashion';
  return 'sight';
}

/** แปลงผลลัพธ์จาก Nominatim (format=jsonv2) */
export function parseNominatim(rows: unknown): SearchResult[] {
  if (!Array.isArray(rows)) return [];
  const out: SearchResult[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const lat = parseFloat((r as any).lat);
    const lng = parseFloat((r as any).lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) continue;
    const display = String((r as any).display_name ?? '');
    const name = String((r as any).name || display.split(',')[0] || '').trim();
    if (!name) continue;
    out.push({
      name,
      address: display || null,
      lat,
      lng,
      category: guessCategory([String((r as any).category ?? ''), String((r as any).type ?? '')]),
      provider: 'osm',
      googleId: null,
    });
  }
  return out;
}

async function searchOsm(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    countrycodes: 'kr',
    limit: '8',
    'accept-language': 'th,en,ko',
    viewbox: '126.6,37.8,127.4,37.2', // โซลและปริมณฑล (ใช้จัดอันดับ ไม่ได้จำกัดผล)
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  return parseNominatim(await res.json());
}

async function searchGoogle(q: string): Promise<SearchResult[]> {
  const g = (window as any).google;
  const { Place } = await g.maps.importLibrary('places');
  const { places } = await Place.searchByText({
    textQuery: q,
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'types'],
    language: 'th',
    region: 'kr',
    locationBias: { center: SEOUL, radius: 50000 },
    maxResultCount: 8,
  });
  const out: SearchResult[] = [];
  for (const pl of places ?? []) {
    const lat = pl.location?.lat();
    const lng = pl.location?.lng();
    if (lat == null || lng == null || !inKorea(lat, lng)) continue;
    out.push({
      name: pl.displayName ?? q,
      address: pl.formattedAddress ?? null,
      lat,
      lng,
      category: guessCategory(pl.types ?? []),
      provider: 'google',
      googleId: pl.id ?? null,
    });
  }
  return out;
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const query = q.trim().slice(0, 120);
  if (!query) return { provider: isGoogleReady() ? 'google' : 'osm', results: [] };
  if (isGoogleReady()) {
    try {
      return { provider: 'google', results: await searchGoogle(query) };
    } catch (e) {
      console.warn('Google Places search failed', e);
      const results = await searchOsm(query, signal);
      return { provider: 'osm', results, note: 'ค้นด้วย Google ไม่ได้ (ตรวจว่าเปิด Places API (New) ในคีย์แล้ว) — ใช้ OpenStreetMap แทน' };
    }
  }
  return { provider: 'osm', results: await searchOsm(query, signal) };
}

/** ลิงก์เปิดสถานที่จากผลค้นหาใน Google Maps */
export function resultMapsUrl(r: SearchResult): string {
  const p = new URLSearchParams({ api: '1', query: `${r.name} ${r.address ?? ''}`.trim() });
  if (r.googleId) p.set('query_place_id', r.googleId);
  return `https://www.google.com/maps/search/?${p}`;
}

/** สร้างสถานที่ "เพิ่มเอง" จากผลค้นหา */
export function placeFromResult(r: SearchResult, id: string): Place {
  return {
    id,
    nameTh: r.name,
    nameEn: r.name,
    category: r.category,
    area: 'เพิ่มเอง',
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    coordStatus: 'user',
    reasonTh: r.provider === 'google' ? 'เพิ่มจากการค้นหา Google Maps' : 'เพิ่มจากการค้นหา OpenStreetMap',
    suggestedStayMin: 60,
    indoor: r.category !== 'sight' && r.category !== 'market',
    sources: [{ label: r.provider === 'google' ? 'Google Maps' : 'OpenStreetMap', url: resultMapsUrl(r) }],
    custom: true,
  };
}

/** หาสถานที่ที่เพิ่มไว้แล้ว (ชื่อเดียวกันและห่างกันไม่เกิน ~50 ม.) เพื่อไม่ให้ซ้ำ */
export function findExisting(custom: Place[], r: SearchResult): Place | undefined {
  return custom.find((p) => p.nameTh === r.name && p.lat != null && p.lng != null && Math.abs(p.lat - r.lat) < 0.0005 && Math.abs(p.lng - r.lng) < 0.0006);
}
