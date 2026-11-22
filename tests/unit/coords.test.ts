import { describe, it, expect } from 'vitest';
import { parseLatLng, coordError } from '../../src/core/coords';
import { newPlan } from '../../src/core/planOps';
import { validatePlan } from '../../src/storage/validate';

describe('อ่านพิกัดจาก Naver Map', () => {
  it('ลิงก์ Naver แบบเก่า/ที่อยู่: เมตร Web Mercator (c=x,y,… หรือ /address/x,y)', () => {
    const a = parseLatLng('https://map.naver.com/v5/entry/place/11591565?c=14135192.7838029,4518223.1245489,15,0,0,0,dh')!;
    expect(a.lat).toBeCloseTo(37.56548, 4);
    expect(a.lng).toBeCloseTo(126.9786, 4);
    const b = parseLatLng('https://map.naver.com/p/entry/address/14135192.7838029,4518223.1245489,%EC%84%9C%EC%9A%B8?c=15.00,0,0,0,adh')!;
    expect(b.lat).toBeCloseTo(37.56548, 4);
  });
  it('ลิงก์ Naver แบบใหม่ c=lng,lat (องศา) และ lat=&lng= (nmap:// / มือถือ)', () => {
    expect(parseLatLng('https://map.naver.com/p?c=127.0276368,37.4979502,15,0,0,0,dh')).toEqual({ lat: 37.4979502, lng: 127.0276368 });
    expect(parseLatLng('nmap://place?lat=37.4979502&lng=127.0276368&name=x&appname=y')).toEqual({ lat: 37.4979502, lng: 127.0276368 });
    expect(parseLatLng('https://m.map.naver.com/map.naver?lng=127.0276&lat=37.4979&level=2')).toEqual({ lat: 37.4979, lng: 127.0276 });
  });
  it('ตัวเลขสลับลำดับ "lng, lat" ก็อ่านได้ (ช่วงค่าในเกาหลีไม่ทับกัน)', () => {
    expect(parseLatLng('127.0557, 37.5438')).toEqual({ lat: 37.5438, lng: 127.0557 });
  });
  it('ลิงก์ Naver ที่ไม่มีพิกัด → null พร้อมบอกวิธี', () => {
    expect(parseLatLng('https://naver.me/5AbCdEfG')).toBeNull();
    expect(coordError('https://naver.me/5AbCdEfG')).toContain('naver.me');
    expect(parseLatLng('https://map.naver.com/p/search/%EC%B9%B4%ED%8E%98/place/1234?c=15.00,0,0,0,dh')).toBeNull();
    expect(coordError('https://map.naver.com/p/search/x/place/1234?c=15.00,0,0,0,dh')).toContain('Naver');
  });
});

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

describe('Plus Code ของ Google Maps', () => {
  it('รหัสแบบสั้น (มีชื่อเมืองต่อท้ายหรือไม่ก็ได้) → พิกัดใกล้โซล', () => {
    const a = parseLatLng('HX7M+HQ8 Seoul')!;
    expect(a.lat).toBeCloseTo(37.56391, 4);
    expect(a.lng).toBeCloseTo(126.98445, 4);
    expect(parseLatLng('HX7M+HQ8 โซล เกาหลีใต้')).toEqual(a);
    expect(parseLatLng('hx7m+hq8')).toEqual(a);
  });
  it('รหัสเต็ม', () => {
    const a = parseLatLng('8Q98HX7M+HQ8')!;
    expect(a.lat).toBeCloseTo(37.56391, 4);
    expect(a.lng).toBeCloseTo(126.98445, 4);
  });
  it('ลิงก์ Google Maps ที่มี Plus Code (ปลายทางของลิงก์ย่อ)', () => {
    const a = parseLatLng('https://www.google.com/maps/search/HX7M%2BHQ8+%E0%B9%82%E0%B8%8B%E0%B8%A5?entry=tts')!;
    expect(a.lat).toBeCloseTo(37.56391, 4);
  });
  it('รหัสที่ไม่ถูกต้อง → null', () => {
    expect(parseLatLng('ZZZZ+ZZ')).toBeNull();
  });
});
