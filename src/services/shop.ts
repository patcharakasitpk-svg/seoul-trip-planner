import { safeGet, safeSet } from '../storage/storage';
import { uid } from '../core/planOps';
import { parseAmount } from './fx';

/**
 * ของที่จะซื้อ — เก็บเฉพาะเครื่องนี้ (ไม่อยู่ในแผน ไม่แชร์ ไม่ซิงก์)
 * แต่ละรายการเทียบ ราคาไทย (บาท) กับราคาที่ถูกสุดในเกาหลี และเทียบระหว่างร้านในเกาหลี (วอน)
 */
export interface ShopPrice {
  id: string;
  store: string;
  krw: number;
}
export interface ShopItem {
  id: string;
  name: string;
  qty: number;
  /** ราคาไทยต่อชิ้น (บาท) */
  thb: number | null;
  /** ที่มาของราคาไทย เช่น Shopee */
  thbLabel: string;
  prices: ShopPrice[];
  bought: boolean;
  /** รหัสรูปใน IndexedDB (ดู shopPhotos.ts) */
  photo?: string | null;
}
export interface ShopStore {
  items: ShopItem[];
  /** ร้านล่าสุดที่ใส่ราคา — เติมให้อัตโนมัติตอนเดินอยู่ในร้าน */
  lastStore: string;
}

const KEY = 'stp.v1.shop';
export const SHOP_LIMITS = { items: 200, prices: 20, name: 80, store: 60, label: 30, qtyMax: 99 };

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const posNum = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= max ? x : null);

export function sanitizeShop(raw: unknown): ShopStore {
  const empty: ShopStore = { items: [], lastStore: '' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const r = raw as Record<string, unknown>;
  const items: ShopItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (items.length >= SHOP_LIMITS.items) break;
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const name = str(o.name, SHOP_LIMITS.name);
    if (!name) continue;
    const prices: ShopPrice[] = [];
    for (const pr of Array.isArray(o.prices) ? o.prices : []) {
      if (prices.length >= SHOP_LIMITS.prices) break;
      if (!pr || typeof pr !== 'object') continue;
      const q = pr as Record<string, unknown>;
      const krw = posNum(q.krw, 1e9);
      const store = str(q.store, SHOP_LIMITS.store);
      if (krw == null || !store) continue;
      prices.push({ id: str(q.id, 40) || uid('sp'), store, krw });
    }
    const qty = typeof o.qty === 'number' && Number.isFinite(o.qty) ? Math.min(SHOP_LIMITS.qtyMax, Math.max(1, Math.round(o.qty))) : 1;
    items.push({
      id: str(o.id, 40) || uid('si'),
      name,
      qty,
      thb: posNum(o.thb, 1e7),
      thbLabel: str(o.thbLabel, SHOP_LIMITS.label),
      prices,
      bought: o.bought === true,
      photo: typeof o.photo === 'string' && /^ph-[A-Za-z0-9_-]{1,40}$/.test(o.photo) ? o.photo : null,
    });
  }
  return { items, lastStore: str(r.lastStore, SHOP_LIMITS.store) };
}

export function loadShop(): ShopStore {
  try {
    return sanitizeShop(JSON.parse(safeGet(KEY) || 'null'));
  } catch {
    return { items: [], lastStore: '' };
  }
}

export function saveShop(s: ShopStore): void {
  safeSet(KEY, JSON.stringify(s));
}

/** ร้านที่ถูกที่สุด (ราคาเท่ากัน = ร้านที่ใส่ก่อน) */
export function cheapest(item: ShopItem): ShopPrice | null {
  let best: ShopPrice | null = null;
  for (const p of item.prices) if (!best || p.krw < best.krw) best = p;
  return best;
}

export interface Verdict {
  kind: 'korea' | 'thai' | 'same';
  /** ส่วนต่างต่อชิ้น (บาท, ค่าบวก) */
  diffThbPerUnit: number;
  /** ส่วนต่างเทียบกับราคาไทย (%) */
  pct: number;
  /** ส่วนต่างรวมตามจำนวนชิ้น (บาท) */
  totalThb: number;
}

/** เทียบไทยกับเกาหลี — ต้องมีราคาไทย ราคาเกาหลี และอัตราแลกเปลี่ยน ไม่งั้นไม่สรุป */
export function verdict(item: ShopItem, rate: number | null): Verdict | null {
  const best = cheapest(item);
  if (item.thb == null || !best || !rate) return null;
  const kr = best.krw / rate;
  const diff = item.thb - kr; // บวก = เกาหลีถูกกว่า
  const abs = Math.abs(diff);
  const kind = abs < 0.5 ? 'same' : diff > 0 ? 'korea' : 'thai';
  return { kind, diffThbPerUnit: abs, pct: (abs / item.thb) * 100, totalThb: abs * item.qty };
}

export function summary(items: ShopItem[], rate: number | null): { toBuyKrw: number; toBuyThb: number | null; savedThb: number | null; bought: number; total: number } {
  let toBuyKrw = 0;
  let saved = 0;
  for (const it of items) {
    if (it.bought) continue;
    const best = cheapest(it);
    if (best) toBuyKrw += best.krw * it.qty;
    const v = verdict(it, rate);
    if (v?.kind === 'korea') saved += v.totalThb;
  }
  return {
    toBuyKrw,
    toBuyThb: rate ? toBuyKrw / rate : null,
    savedThb: rate ? saved : null,
    bought: items.filter((i) => i.bought).length,
    total: items.length,
  };
}

/** ที่ยังไม่ซื้อขึ้นก่อน (คงลำดับที่เพิ่ม) */
export function sortItems(items: ShopItem[]): ShopItem[] {
  return [...items.filter((i) => !i.bought), ...items.filter((i) => i.bought)];
}

const MAX_THB = 1e7;
const MAX_KRW = 1e9;

/** ตรวจราคาร้านที่พิมพ์ — ไม่ผ่าน = แจ้งผู้ใช้ (ไม่บันทึกค่าที่โหลดกลับมาแล้วจะหาย) */
export function parsePriceInput(storeText: string, krwText: string): { ok: true; store: string; krw: number } | { ok: false; error: string } {
  const store = storeText.trim().slice(0, SHOP_LIMITS.store);
  const krw = parseAmount(krwText);
  if (!store) return { ok: false, error: 'ใส่ชื่อร้าน' };
  if (krw == null || krw <= 0) return { ok: false, error: 'ใส่ราคาวอนเป็นตัวเลข เช่น 18000' };
  if (krw > MAX_KRW) return { ok: false, error: 'ราคาวอนมากเกินไป — ตรวจจำนวนศูนย์' };
  return { ok: true, store, krw };
}

/** ตรวจรายการที่พิมพ์ — ราคาไทยว่างได้ แต่ถ้าพิมพ์แล้วอ่านไม่ได้/เกินช่วงต้องแจ้ง */
export function parseItemInput(f: { name: string; thb: string; thbLabel: string; qty: string }):
  | { ok: true; name: string; thb: number | null; thbLabel: string; qty: number }
  | { ok: false; error: string } {
  const name = f.name.trim().slice(0, SHOP_LIMITS.name);
  if (!name) return { ok: false, error: 'ใส่ชื่อของ' };
  let thb: number | null = null;
  if (f.thb.trim()) {
    const v = parseAmount(f.thb);
    if (v == null || v <= 0) return { ok: false, error: 'ราคาไทยต้องเป็นตัวเลข เช่น 580 (หรือเว้นว่าง)' };
    if (v > MAX_THB) return { ok: false, error: 'ราคาไทยมากเกินไป — ตรวจจำนวนศูนย์' };
    thb = v;
  }
  const q = Math.round(Number(f.qty));
  const qty = Number.isFinite(q) ? Math.min(SHOP_LIMITS.qtyMax, Math.max(1, q)) : 1;
  return { ok: true, name, thb, thbLabel: f.thbLabel.trim().slice(0, SHOP_LIMITS.label), qty };
}

/** เลิกทำการลบรายการ: ใส่คืนเฉพาะรายการนั้น ณ ตำแหน่งเดิม (ไม่ทับการแก้อื่นที่เกิดหลังลบ) */
export function restoreItem(s: ShopStore, item: ShopItem, index: number): ShopStore {
  if (s.items.some((x) => x.id === item.id)) return s;
  const items = [...s.items];
  items.splice(Math.min(index, items.length), 0, item);
  return { ...s, items };
}

/** เลิกทำการลบราคา: ใส่คืนเฉพาะราคานั้นในรายการเดิม */
export function restorePrice(s: ShopStore, itemId: string, price: ShopPrice, index: number): ShopStore {
  return {
    ...s,
    items: s.items.map((it) => {
      if (it.id !== itemId || it.prices.some((x) => x.id === price.id)) return it;
      const prices = [...it.prices];
      prices.splice(Math.min(index, prices.length), 0, price);
      return { ...it, prices };
    }),
  };
}

/** รูปที่เก็บไว้แต่ไม่มีรายการไหนใช้แล้ว (ลบทิ้งได้) */
export function unusedPhotoIds(s: ShopStore, stored: string[]): string[] {
  const used = new Set(s.items.map((i) => i.photo).filter(Boolean));
  return stored.filter((id) => !used.has(id));
}
