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

import { parseItemInput, parsePriceInput, restoreItem, restorePrice } from '../../src/services/shop';
import { parseAmount } from '../../src/services/fx';

describe('ของที่จะซื้อ: ตรวจสิ่งที่พิมพ์ (ไม่ให้หายเงียบ)', () => {
  it('อ่านราคาที่มีหน่วยติดมา', () => {
    expect(parseAmount('18,000원')).toBe(18000);
    expect(parseAmount('580บาท')).toBe(580);
    expect(parseAmount('580 บาท')).toBe(580);
  });
  it('ราคาร้าน: ต้องมีร้าน และราคาอยู่ในช่วงที่บันทึกได้', () => {
    expect(parsePriceInput('Daiso', '18,000')).toEqual({ ok: true, store: 'Daiso', krw: 18000 });
    expect(parsePriceInput('', '18000').ok).toBe(false);
    expect(parsePriceInput('X', 'abc').ok).toBe(false);
    expect(parsePriceInput('X', '99999999999').ok).toBe(false);
  });
  it('รายการ: ราคาไทยพิมพ์ผิด/เกินช่วง → แจ้ง ไม่บันทึกเป็น "ไม่มีราคา" เงียบ ๆ', () => {
    expect(parseItemInput({ name: 'กันแดด', thb: '580', thbLabel: 'Shopee', qty: '2' })).toEqual({ ok: true, name: 'กันแดด', thb: 580, thbLabel: 'Shopee', qty: 2 });
    expect(parseItemInput({ name: 'กันแดด', thb: '', thbLabel: '', qty: '' })).toMatchObject({ ok: true, thb: null, qty: 1 });
    expect(parseItemInput({ name: 'กันแดด', thb: 'ห้าร้อย', thbLabel: '', qty: '1' }).ok).toBe(false);
    expect(parseItemInput({ name: 'กันแดด', thb: '99999999', thbLabel: '', qty: '1' }).ok).toBe(false);
    expect(parseItemInput({ name: '  ', thb: '', thbLabel: '', qty: '1' }).ok).toBe(false);
  });
  it('เลิกทำการลบ: คืนเฉพาะที่ลบ ไม่ทับการแก้อื่นที่ทำหลังจากนั้น', () => {
    const a = item({ id: 'a', name: 'A' });
    const b = item({ id: 'b', name: 'B' });
    const now = { items: [{ ...b, bought: true }], lastStore: 'X' }; // ลบ A แล้วไปติ๊ก B
    const back = restoreItem(now, a, 0);
    expect(back.items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(back.items[1].bought).toBe(true);
    expect(restoreItem(back, a, 0).items).toHaveLength(2); // ไม่ซ้ำ
    const withPrice = { items: [item({ id: 'a', prices: [p('p2', 'Y', 2)] })], lastStore: '' };
    const back2 = restorePrice(withPrice, 'a', p('p1', 'X', 1), 0);
    expect(back2.items[0].prices.map((x) => x.id)).toEqual(['p1', 'p2']);
  });
});

describe('ของที่จะซื้อ: รูป', () => {
  it('เก็บรหัสรูปที่ถูกรูปแบบ ทิ้งค่าที่แปลก', () => {
    const s = sanitizeShop({ items: [{ name: 'A', photo: 'ph-abc123' }, { name: 'B', photo: '../../x' }, { name: 'C' }] });
    expect(s.items.map((i) => i.photo)).toEqual(['ph-abc123', null, null]);
  });
});

import { unusedPhotoIds } from '../../src/services/shop';
describe('ของที่จะซื้อ: ล้างรูปที่ไม่ใช้', () => {
  it('รูปที่ไม่มีรายการไหนอ้างถึง = ลบได้', () => {
    const s = sanitizeShop({ items: [{ name: 'A', photo: 'ph-1' }] });
    expect(unusedPhotoIds(s, ['ph-1', 'ph-2', 'ph-3'])).toEqual(['ph-2', 'ph-3']);
  });
});

import { fitSize } from '../../src/services/shopPhotos';
describe('ย่อรูป', () => {
  it('ด้านยาวไม่เกิน 640 คงสัดส่วน และไม่ขยายรูปเล็ก', () => {
    expect(fitSize(4032, 3024)).toEqual({ w: 640, h: 480 });
    expect(fitSize(3024, 4032)).toEqual({ w: 480, h: 640 });
    expect(fitSize(300, 200)).toEqual({ w: 300, h: 200 });
  });
});
