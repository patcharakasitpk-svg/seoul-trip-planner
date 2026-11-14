import { describe, it, expect } from 'vitest';
import { photosUrl } from '../../src/ui/util';
import { PUBLIC_PLACES } from '../../src/data/places';
import { placeFromResult } from '../../src/services/placeSearch';

describe('ลิงก์ดูรูปสถานที่', () => {
  it('ใช้ชื่อเกาหลีค้นใน Google รูปภาพ (ตัดวงเล็บออก)', () => {
    const p = { ...PUBLIC_PLACES.find((x) => x.id === 'myeongdong-kyoja')!, nameKo: '명동교자 (본점)' };
    const u = new URL(photosUrl(p));
    expect(u.hostname).toBe('www.google.com');
    expect(u.searchParams.get('tbm')).toBe('isch');
    expect(u.searchParams.get('q')).toBe('명동교자');
  });
  it('ไม่มีชื่อเกาหลี → ชื่ออังกฤษ + ย่าน + Seoul', () => {
    const p = { ...PUBLIC_PLACES[0], nameKo: null, nameEn: 'Test Cafe', area: 'Seongsu' };
    expect(new URL(photosUrl(p)).searchParams.get('q')).toBe('Test Cafe Seongsu Seoul');
  });
  it('สถานที่ที่เพิ่มจากการค้นหา Google → เปิดหน้าสถานที่ใน Google Maps (มีรูป)', () => {
    const p = placeFromResult({ name: 'X', address: null, lat: 37.5, lng: 127, category: 'food', provider: 'google', googleId: 'ChIJx' }, 'custom-1');
    expect(photosUrl(p)).toContain('query_place_id=ChIJx');
  });
  it('ทุกสถานที่มีลิงก์รูป', () => {
    for (const p of PUBLIC_PLACES) expect(new URL(photosUrl(p)).searchParams.get('q')?.length).toBeGreaterThan(1);
  });
});

describe('พิกัดจากแหล่งเดียว', () => {
  it('ร้านที่มีพิกัดจากแหล่งจริงแหล่งเดียว → ปักหมุดแบบ approx (ไม่ทิ้งพิกัด)', () => {
    const o = PUBLIC_PLACES.find((x) => x.id === 'odarijip-myeongdong')!;
    expect(o.coordStatus).toBe('approx');
    expect(o.lat).not.toBeNull();
  });
  it('ไม่มีสถานที่ไหนเหลือแบบไม่มีหมุด ยกเว้นข้อมูลที่ไม่มีพิกัดจริง', () => {
    const noPin = PUBLIC_PLACES.filter((p) => p.lat == null).map((p) => p.id);
    expect(noPin).not.toContain('hanam-pig-myeongdong');
  });
});

import { naverRouteUrl, naverPlaceUrl } from '../../src/ui/util';

describe('Naver Map', () => {
  const hotel = PUBLIC_PLACES.find((x) => x.id === 'hotel')!;
  const kyoja = PUBLIC_PLACES.find((x) => x.id === 'myeongdong-kyoja')!;
  it('เส้นทางขนส่งสาธารณะ: ต้นทาง/ปลายทาง พิกัด ชื่อเกาหลี และ appname', () => {
    const u = naverRouteUrl(hotel, kyoja)!;
    expect(u.startsWith('nmap://route/public?')).toBe(true);
    const q = new URLSearchParams(u.split('?')[1]);
    expect(Number(q.get('slat'))).toBeCloseTo(hotel.lat!);
    expect(Number(q.get('dlng'))).toBeCloseTo(kyoja.lng!);
    expect(q.get('dname')).toContain('명동교자');
    expect(q.get('appname')).toBeTruthy();
  });
  it('ไม่มีต้นทาง = ใช้ตำแหน่งปัจจุบันในแอป · ปลายทางไม่มีพิกัด = ไม่มีปุ่ม', () => {
    const q = new URLSearchParams(naverRouteUrl(null, kyoja)!.split('?')[1]);
    expect(q.has('slat')).toBe(false);
    expect(naverRouteUrl(hotel, { ...kyoja, lat: null, lng: null })).toBeNull();
    expect(naverPlaceUrl({ ...kyoja, lat: null })).toBeNull();
    expect(naverPlaceUrl(kyoja)!.startsWith('nmap://place?')).toBe(true);
  });
});
