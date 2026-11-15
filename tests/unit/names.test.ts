import { describe, it, expect } from 'vitest';
import { PUBLIC_PLACES } from '../../src/data/places';

const by = (id: string) => PUBLIC_PLACES.find((p) => p.id === id)!;

describe('ชื่อสถานที่แสดงเป็นภาษาอังกฤษมาตรฐาน (ค้นใน Google ได้)', () => {
  it('ชื่อหลัก = ชื่ออังกฤษ ไม่มีคำอธิบายพ่วง', () => {
    expect(by('yennaljip-hongdae').nameTh).toBe('Yennaljip Hongdae');
    expect(by('myeongdong').nameTh).toBe('Myeongdong Shopping Street');
    expect(by('myeongdong-kyoja').nameTh).toBe('Myeongdong Kyoja Main');
    expect(by('gwangjang').nameTh).toBe('Gwangjang Market');
    expect(by('hotel').nameTh).toContain('Sotetsu');
  });
  it('ทุกชื่อหลักเป็นตัวอักษรละติน ไม่มี " – คำอธิบาย"', () => {
    for (const p of PUBLIC_PLACES) {
      expect(p.nameTh, p.id).not.toMatch(/[฀-๿]/);
      expect(p.nameTh, p.id).not.toMatch(/ – /);
    }
  });
  it('ยังเก็บชื่อไทยไว้ (ใช้ค้นหา/แสดงในรายละเอียด)', () => {
    expect(by('gwangjang').thaiName).toMatch(/ตลาด/);
    expect(by('hotel').thaiName).toMatch(/โรงแรม/);
  });
});
