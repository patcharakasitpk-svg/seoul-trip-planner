import { describe, it, expect } from 'vitest';
import { findExisting, guessCategory, parseNominatim, placeFromResult, resultMapsUrl, type SearchResult } from '../../src/services/placeSearch';
import { buildMapSpecs } from '../../src/ui/mapSpecs';
import { validatePlan } from '../../src/storage/validate';
import { newPlan } from '../../src/core/planOps';

const r: SearchResult = { name: 'Tosokchon', address: '5 Jahamun-ro 5-gil, Seoul', lat: 37.5779, lng: 126.9714, category: 'food', provider: 'google', googleId: 'ChIJabc' };

describe('ค้นหาสถานที่', () => {
  it('เดาหมวดจากประเภทของ Google/OSM', () => {
    expect(guessCategory(['korean_restaurant', 'food'])).toBe('food');
    expect(guessCategory(['amenity', 'cafe'])).toBe('food');
    expect(guessCategory(['clothing_store'])).toBe('fashion');
    expect(guessCategory(['shop', 'cosmetics'])).toBe('beauty');
    expect(guessCategory(['tourist_attraction'])).toBe('sight');
  });

  it('แปลงผล Nominatim และตัดจุดที่อยู่นอกเกาหลี', () => {
    const out = parseNominatim([
      { lat: '37.5796', lon: '126.9770', name: 'Gyeongbokgung', display_name: 'Gyeongbokgung, Seoul', category: 'tourism', type: 'attraction' },
      { lat: '13.75', lon: '100.5', name: 'Bangkok', display_name: 'Bangkok' },
      { lat: 'x', lon: '1' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Gyeongbokgung', provider: 'osm', category: 'sight' });
    expect(parseNominatim('nope')).toEqual([]);
  });

  it('สร้างสถานที่เพิ่มเองพร้อมพิกัดและลิงก์ Google Maps', () => {
    const p = placeFromResult(r, 'custom-1');
    expect(p).toMatchObject({ id: 'custom-1', nameTh: 'Tosokchon', lat: 37.5779, lng: 126.9714, coordStatus: 'user', custom: true, category: 'food' });
    expect(resultMapsUrl(r)).toContain('query_place_id=ChIJabc');
    expect(p.sources[0].url).toBe(resultMapsUrl(r));
  });

  it('ไม่เพิ่มซ้ำถ้าชื่อและตำแหน่งเดียวกัน', () => {
    const p = placeFromResult(r, 'custom-1');
    expect(findExisting([p], { ...r, lat: r.lat + 0.0001 })?.id).toBe('custom-1');
    expect(findExisting([p], { ...r, lat: r.lat + 0.01 })).toBeUndefined();
  });

  it('ลิงก์แหล่งข้อมูลยังอยู่หลังผ่านการตรวจแผน (เช่นเปิดจากลิงก์แชร์)', () => {
    const plan = { ...newPlan(), customPlaces: [placeFromResult(r, 'custom-1'), { ...placeFromResult(r, 'custom-2'), sources: [{ label: 'x', url: 'javascript:alert(1)' }] }] };
    const v = validatePlan(JSON.parse(JSON.stringify(plan)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.customPlaces[0].sources[0].url).toContain('google.com/maps');
    expect(v.plan.customPlaces[1].sources).toEqual([]);
  });

  it('ผลค้นหาแสดงเป็นหมุดชั่วคราว และซูมพอดีเฉพาะผลค้นหา', () => {
    const plan = newPlan();
    const { markers } = buildMapSpecs({
      days: [plan.days[0]],
      allDays: plan.days,
      mode: 'day',
      getPlace: () => undefined,
      schedule: () => ({ stops: [], end: null }) as any,
      libraryPlaces: null,
      searchResults: [r],
      focusSearch: true,
    });
    const s = markers.find((m) => m.id === 'search:0');
    expect(s).toMatchObject({ kind: 'search', focus: true, title: 'Tosokchon' });
    expect(markers.filter((m) => m.focus)).toHaveLength(1);
  });
});
