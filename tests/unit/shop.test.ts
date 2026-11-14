import { describe, it, expect } from 'vitest';
import { cheapest, verdict, summary, sanitizeShop, sortItems, type ShopItem } from '../../src/services/shop';

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: 'i1',
  name: 'กันแดด',
  qty: 1,
  thb: null,
  thbLabel: '',
  prices: [],
  bought: false,
  ...over,
});
const p = (id: string, store: string, krw: number) => ({ id, store, krw });

describe('ของที่จะซื้อ: คำนวณ', () => {
  it('หาร้านที่ถูกที่สุด (เท่ากัน = ร้านที่ใส่ก่อน)', () => {
    expect(cheapest(item({ prices: [p('a', 'Daiso', 21000), p('b', 'Olive Young', 18000)] }))?.store).toBe('Olive Young');
    expect(cheapest(item({ prices: [p('a', 'A', 1000), p('b', 'B', 1000)] }))?.id).toBe('a');
    expect(cheapest(item())).toBeNull();
  });

  it('เกาหลีถูกกว่าไทย: ส่วนต่างต่อชิ้น เปอร์เซ็นต์ และรวมตามจำนวน', () => {
    const v = verdict(item({ thb: 580, qty: 2, prices: [p('a', 'Olive Young', 18000), p('b', 'Daiso', 21000)] }), 40)!;
    expect(v.kind).toBe('korea');
    expect(v.diffThbPerUnit).toBeCloseTo(130);
    expect(v.pct).toBeCloseTo(22.41, 1);
    expect(v.totalThb).toBeCloseTo(260);
  });

  it('ไทยถูกกว่า / เท่ากัน', () => {
    expect(verdict(item({ thb: 300, prices: [p('a', 'X', 18000)] }), 40)!.kind).toBe('thai');
    expect(verdict(item({ thb: 450, prices: [p('a', 'X', 18000)] }), 40)!.kind).toBe('same');
  });

  it('ข้อมูลไม่ครบหรือไม่มีอัตรา → ไม่สรุป (ไม่เดา)', () => {
    expect(verdict(item({ prices: [p('a', 'X', 18000)] }), 40)).toBeNull();
    expect(verdict(item({ thb: 580 }), 40)).toBeNull();
    expect(verdict(item({ thb: 580, prices: [p('a', 'X', 18000)] }), null)).toBeNull();
  });

  it('สรุป: ยอดที่ยังต้องซื้อไม่นับของที่ซื้อแล้ว · ประหยัดรวมเฉพาะรายการที่เกาหลีถูกกว่า', () => {
    const items = [
      item({ id: '1', thb: 580, qty: 2, prices: [p('a', 'OY', 18000)] }), // ประหยัด 260
      item({ id: '2', thb: 300, prices: [p('a', 'X', 18000)] }), // ไทยถูกกว่า
      item({ id: '3', prices: [p('a', 'X', 5000)], bought: true }),
      item({ id: '4' }), // ยังไม่มีราคา
    ];
    const s = summary(items, 40);
    expect(s.toBuyKrw).toBe(18000 * 2 + 18000);
    expect(s.toBuyThb).toBeCloseTo(1350);
    expect(s.savedThb).toBeCloseTo(260);
    expect(s.bought).toBe(1);
    expect(s.total).toBe(4);
    const noRate = summary(items, null);
    expect(noRate.toBuyThb).toBeNull();
    expect(noRate.savedThb).toBeNull();
    expect(noRate.toBuyKrw).toBe(54000);
  });

  it('เรียง: ที่ยังไม่ซื้อก่อน ตามลำดับที่เพิ่ม', () => {
    const out = sortItems([item({ id: 'a', bought: true }), item({ id: 'b' }), item({ id: 'c', bought: true }), item({ id: 'd' })]);
    expect(out.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('ของที่จะซื้อ: ตรวจข้อมูลที่เก็บในเครื่อง', () => {
  it('ทิ้งรายการเสีย จำนวนอย่างน้อย 1 ราคาต้องเป็นบวก', () => {
    const s = sanitizeShop({ items: [{ name: '', qty: 1 }, 'x', { name: 'A', qty: 0, prices: [{ store: 'S', krw: -5 }, { store: 'T', krw: 1000 }] }], lastStore: 'T' });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ name: 'A', qty: 1, bought: false, thb: null });
    expect(s.items[0].prices.map((x) => x.store)).toEqual(['T']);
    expect(s.items[0].id).toBeTruthy();
    expect(s.lastStore).toBe('T');
  });
  it('จำกัดจำนวน: 200 รายการ · 20 ราคา/รายการ · จำนวน ≤ 99 · ความยาวข้อความ', () => {
    const many = sanitizeShop({ items: Array.from({ length: 250 }, (_, i) => ({ name: `x${i}`, qty: 500, prices: Array.from({ length: 30 }, () => ({ store: 's'.repeat(100), krw: 1 })) })) });
    expect(many.items).toHaveLength(200);
    expect(many.items[0].prices).toHaveLength(20);
    expect(many.items[0].qty).toBe(99);
    expect(many.items[0].prices[0].store).toHaveLength(60);
  });
  it('ข้อมูลพัง → รายการว่าง ไม่ error', () => {
    expect(sanitizeShop('garbage')).toEqual({ items: [], lastStore: '' });
    expect(sanitizeShop(null)).toEqual({ items: [], lastStore: '' });
  });
});
