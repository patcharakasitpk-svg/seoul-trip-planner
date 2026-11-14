import { describe, it, expect } from 'vitest';
import { parseAmount, krwToThb, thbToKrw, fmtThb, fmtKrw, activeRate, needsRefresh } from '../../src/services/fx';
import { fxResult, formatTyping } from '../../src/ui/views/fx';

const store = { ref: 40, refDate: '2026-11-13', fetchedAt: Date.now(), source: 'x', custom: null };

describe('แปลงเงิน', () => {
  it('อ่านตัวเลขที่พิมพ์ (จุลภาค, k)', () => {
    expect(parseAmount('12,500')).toBe(12500);
    expect(parseAmount('₩ 5,000')).toBe(5000);
    expect(parseAmount('1.5k')).toBe(1500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('คำนวณและแสดงผล', () => {
    expect(krwToThb(10000, 40)).toBe(250);
    expect(thbToKrw(100, 40)).toBe(4000);
    expect(fmtThb(250)).toBe('250');
    expect(fmtThb(2.5)).toBe('2.50');
    expect(fmtKrw(40000)).toBe('40,000');
    expect(fxResult({ dir: 'krw2thb', amount: '12,000', editingRate: false, loading: false }, store)).toBe('300');
    expect(fxResult({ dir: 'thb2krw', amount: '500', editingRate: false, loading: false }, store)).toBe('20,000');
  });
  it('อัตราที่ตั้งเองใช้แทนอัตราอ้างอิง', () => {
    expect(activeRate({ ...store, custom: 38.5 })).toBe(38.5);
    expect(activeRate(store)).toBe(40);
  });
  it('ยังไม่มีอัตรา → แสดง 0 ไม่เดาตัวเลข', () => {
    expect(fxResult({ dir: 'krw2thb', amount: '10000', editingRate: false, loading: false }, { ...store, ref: null })).toBe('0');
  });
  it('จัดรูปแบบระหว่างพิมพ์', () => {
    expect(formatTyping('12500')).toBe('12,500');
    expect(formatTyping('1234.567')).toBe('1,234.56');
    expect(formatTyping('12a3')).toBe('123');
    expect(formatTyping('')).toBe('');
  });
  it('อัปเดตอัตราเมื่อเก่าเกิน 6 ชม.', () => {
    expect(needsRefresh(store)).toBe(false);
    expect(needsRefresh({ ...store, fetchedAt: Date.now() - 7 * 3600e3 })).toBe(true);
    expect(needsRefresh({ ...store, ref: null })).toBe(true);
  });
});
