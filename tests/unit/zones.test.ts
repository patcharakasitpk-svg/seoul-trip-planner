import { describe, it, expect } from 'vitest';
import { zoneOf, ZONES } from '../../src/core/zones';
import { PUBLIC_PLACES } from '../../src/data/places';

describe('ย่าน', () => {
  it('รวมชื่อย่านที่เขียนต่างกันเป็นย่านเดียว', () => {
    expect(zoneOf('COEX/Samseong')).toBe(zoneOf('COEX / Samseong'));
    expect(zoneOf('Hongdae/Yeonnam')).toBe('hongdae');
    expect(zoneOf('Yeonnam-dong / Hongdae')).toBe('hongdae');
    expect(zoneOf('Mangwon')).toBe('hongdae');
    expect(zoneOf('Myeongdong / Hoehyeon')).toBe('myeongdong');
    expect(zoneOf('Namdaemun')).toBe('myeongdong');
    expect(zoneOf('Ikseon-dong / Jongno')).toBe('jongno');
    expect(zoneOf('Sinsa / Garosu-gil')).toBe('gangnam');
    expect(zoneOf('Itaewon')).toBe('yongsan');
    expect(zoneOf('Yeongdeungpo (Yangpyeong-dong / Dangsan)')).toBe('yeouido');
  });
  it('ทุกสถานที่ในข้อมูลมีย่าน (ไม่ตกไป "อื่น ๆ")', () => {
    const other = PUBLIC_PLACES.filter((p) => zoneOf(p.area) === 'other').map((p) => `${p.id}:${p.area}`);
    expect(other).toEqual([]);
  });
  it('ทุกย่านมีชื่อไทย', () => {
    for (const z of Object.values(ZONES)) expect(z.th.length).toBeGreaterThan(1);
  });
});

import { ZONES as Z2, ZONE_AREA, zoneOf as zo2, type Zone } from '../../src/core/zones';
import { describe as d3, it as i3, expect as e3 } from 'vitest';
d3('ย่านที่เลือกเองตอนเพิ่มสถานที่', () => {
  i3('ทุกย่านที่เลือกได้ กรองในตัวจัดแผนเจอย่านเดิม', () => {
    for (const z of Object.keys(Z2) as Zone[]) e3(zo2(ZONE_AREA[z])).toBe(z);
  });
  i3('ล็อตเต้เวิลด์/จัมซิลเป็นย่านของตัวเอง', () => {
    e3(zo2('Jamsil / Songpa')).toBe('jamsil');
  });
});
