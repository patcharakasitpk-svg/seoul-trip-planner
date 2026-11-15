import { describe, it, expect } from 'vitest';
import { parseLatLng } from '../../src/core/coords';
import { newPlan } from '../../src/core/planOps';
import { validatePlan } from '../../src/storage/validate';

describe('อ่านพิกัดที่วางมา', () => {
  it('ตัวเลข "lat, lng" ที่คัดลอกจาก Google Maps', () => {
    expect(parseLatLng('37.5438, 127.0557')).toEqual({ lat: 37.5438, lng: 127.0557 });
    expect(parseLatLng(' 37.5438,127.0557 ')).toEqual({ lat: 37.5438, lng: 127.0557 });
  });
  it('ลิงก์ Google Maps แบบยาว (@lat,lng หรือ !3d…!4d…) และ q=lat,lng', () => {
    expect(parseLatLng('https://www.google.com/maps/place/29CM/@37.5441234,127.0551234,17z/data=!3m1')).toEqual({ lat: 37.5441234, lng: 127.0551234 });
    expect(parseLatLng('https://www.google.com/maps/place/x/data=!4m6!3m5!1s0x0:0x0!8m2!3d37.5442!4d127.0553!16s')).toEqual({ lat: 37.5442, lng: 127.0553 });
    expect(parseLatLng('https://maps.google.com/?q=37.55,126.92')).toEqual({ lat: 37.55, lng: 126.92 });
  });
  it('นอกเกาหลี / อ่านไม่ได้ / ลิงก์ย่อ → null', () => {
    expect(parseLatLng('13.75, 100.5')).toBeNull();
    expect(parseLatLng('hello')).toBeNull();
    expect(parseLatLng('https://maps.app.goo.gl/AbCdEf')).toBeNull();
  });
});

describe('พิกัดที่ผู้ใช้ตั้งเอง', () => {
  it('เก็บในแผน ผ่านการตรวจ (ทิ้งค่าที่อยู่นอกเกาหลี)', () => {
    const p = { ...newPlan(), coordOverrides: { '29cm-home-seongsu': { lat: 37.544, lng: 127.055 }, bad: { lat: 1, lng: 2 } } };
    const v = validatePlan(JSON.parse(JSON.stringify(p)));
    expect(v.ok && v.plan.coordOverrides).toEqual({ '29cm-home-seongsu': { lat: 37.544, lng: 127.055 } });
  });
});
