import { esc } from '../util';
import { cheapest, sortItems, summary, verdict, type ShopItem, type ShopStore } from '../../services/shop';
import { fmtKrw, fmtThb } from '../../services/fx';

export interface ShopUi {
  /** เปิดฟอร์มเพิ่มของ */
  adding: boolean;
  /** id รายการที่กำลังแก้ (ชื่อ/จำนวน/ราคาไทย) */
  editItem: string | null;
  /** id รายการที่กำลังใส่ราคาร้าน */
  priceFor: string | null;
  /** id ราคาที่กำลังแก้ (null = เพิ่มใหม่) */
  editPrice: string | null;
}

const thb = (krw: number, rate: number | null) => (rate ? ` <span class="muted">≈ ฿${fmtThb(krw / rate)}</span>` : '');

function itemForm(it: ShopItem | null): string {
  return `<form data-form="shop-item" class="shop-form" ${it ? `data-item="${esc(it.id)}"` : ''}>
    <input class="inp" name="name" placeholder="ชื่อของ เช่น กันแดด Round Lab" maxlength="80" required value="${esc(it?.name ?? '')}" data-autofocus aria-label="ชื่อของ" enterkeyhint="done">
    <div class="shop-form-row">
      <label>🇹🇭 ราคาไทย ฿<input class="inp" name="thb" inputmode="decimal" placeholder="ไม่บังคับ" value="${it?.thb != null ? esc(String(it.thb)) : ''}" aria-label="ราคาไทย (บาท)" enterkeyhint="done"></label>
      <label>จาก<input class="inp" name="thbLabel" placeholder="Shopee" maxlength="30" value="${esc(it?.thbLabel ?? '')}" aria-label="ที่มาของราคาไทย" enterkeyhint="done"></label>
      <label>จำนวน<input class="inp qty" name="qty" type="number" min="1" max="99" value="${it?.qty ?? 1}" aria-label="จำนวนชิ้น" enterkeyhint="done"></label>
    </div>
    <div class="row-btns"><button class="btn sm primary">${it ? 'บันทึก' : 'เพิ่ม'}</button><button type="button" class="btn sm" data-act="shop-form-cancel">ยกเลิก</button></div>
  </form>`;
}

function priceForm(it: ShopItem, ui: ShopUi, lastStore: string): string {
  const p = ui.editPrice ? it.prices.find((x) => x.id === ui.editPrice) : undefined;
  return `<form data-form="shop-price" class="shop-form price" data-item="${esc(it.id)}" ${p ? `data-price="${esc(p.id)}"` : ''}>
    <div class="shop-form-row">
      <input class="inp" name="store" list="shop-stores" placeholder="ร้าน" maxlength="60" required value="${esc(p?.store ?? lastStore)}" aria-label="ชื่อร้าน" enterkeyhint="next" ${p || !lastStore ? 'data-autofocus' : ''}>
      <label class="krw">₩<input class="inp" name="krw" inputmode="decimal" placeholder="ราคา" required value="${p ? esc(p.krw.toLocaleString('en-US')) : ''}" aria-label="ราคา (วอน)" enterkeyhint="done" ${!p && lastStore ? 'data-autofocus' : ''}></label>
    </div>
    <div class="row-btns"><button class="btn sm primary">${p ? 'บันทึก' : 'เพิ่มราคา'}</button><button type="button" class="btn sm" data-act="shop-form-cancel">ยกเลิก</button>${p ? `<button type="button" class="btn sm danger" data-act="shop-price-del" data-item="${esc(it.id)}" data-price="${esc(p.id)}" aria-label="ลบราคานี้">🗑 ลบราคา</button>` : ''}</div>
  </form>`;
}

function verdictLine(it: ShopItem, rate: number | null): string {
  const v = verdict(it, rate);
  if (!v) return '';
  if (v.kind === 'same') return '<p class="shop-verdict">ราคาพอ ๆ กับที่ไทย</p>';
  if (v.kind === 'thai') return `<p class="shop-verdict thai">ไทยถูกกว่า ฿${fmtThb(v.diffThbPerUnit)}/ชิ้น</p>`;
  return `<p class="shop-verdict korea">ซื้อที่เกาหลีถูกกว่าไทย ฿${fmtThb(v.diffThbPerUnit)}/ชิ้น (${Math.round(v.pct)}%)${it.qty > 1 ? ` · ${it.qty} ชิ้นประหยัด ฿${fmtThb(v.totalThb)}` : ''}</p>`;
}

function card(it: ShopItem, store: ShopStore, rate: number | null, ui: ShopUi): string {
  if (ui.editItem === it.id) return `<article class="shop-item editing" data-shop-item="${esc(it.id)}">${itemForm(it)}</article>`;
  const best = cheapest(it);
  const multi = it.prices.length > 1;
  return `<article class="shop-item ${it.bought ? 'bought' : ''}" data-shop-item="${esc(it.id)}">
    <div class="shop-head">
      <button class="shop-check ${it.bought ? 'on' : ''}" data-act="shop-bought" data-item="${esc(it.id)}" aria-pressed="${it.bought}" aria-label="${it.bought ? 'ยังไม่ได้ซื้อ' : 'ซื้อแล้ว'}">${it.bought ? '✓' : ''}</button>
      <button class="shop-name" data-act="shop-edit" data-item="${esc(it.id)}" aria-label="แก้ ${esc(it.name)}">${esc(it.name)}${it.qty > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}</button>
      <button class="icon-btn sm" data-act="shop-del" data-item="${esc(it.id)}" aria-label="ลบ ${esc(it.name)}">🗑</button>
    </div>
    ${
      it.thb != null
        ? `<button class="shop-price thai" data-act="shop-edit" data-item="${esc(it.id)}"><span>🇹🇭 ไทย${it.thbLabel ? ` (${esc(it.thbLabel)})` : ''}</span><b>฿${fmtThb(it.thb)}</b></button>`
        : `<button class="shop-add-thai" data-act="shop-edit" data-item="${esc(it.id)}">＋ ราคาไทย</button>`
    }
    ${it.prices
      .map((p) => {
        const isBest = multi && best?.id === p.id;
        return `<button class="shop-price ${isBest ? 'best' : ''}" data-act="shop-price-edit" data-item="${esc(it.id)}" data-price="${esc(p.id)}"><span>${isBest ? '🏆 ' : ''}${esc(p.store)}</span><b>₩${fmtKrw(p.krw)}${thb(p.krw, rate)}</b></button>`;
      })
      .join('')}
    ${ui.priceFor === it.id ? priceForm(it, ui, store.lastStore) : `<button class="shop-add-price" data-act="shop-price-add" data-item="${esc(it.id)}">＋ ราคาร้าน${it.prices.length ? 'อื่น' : 'ในเกาหลี'}</button>`}
    ${verdictLine(it, rate)}
  </article>`;
}

export function storeSuggestions(store: ShopStore, placeNames: string[]): string[] {
  const used = store.items.flatMap((i) => i.prices.map((p) => p.store));
  return [...new Set([...used.reverse(), ...placeNames])].slice(0, 80);
}

export function renderShop(store: ShopStore, rate: number | null, ui: ShopUi, suggestions: string[]): string {
  const s = summary(store.items, rate);
  const items = sortItems(store.items);
  const sumLine = s.total
    ? `<div class="shop-sum">
        <div><span class="muted small">ยังต้องซื้อ (ร้านที่ถูกสุด)</span><b>₩${fmtKrw(s.toBuyKrw)}${s.toBuyThb != null ? ` <span class="muted">≈ ฿${fmtThb(s.toBuyThb)}</span>` : ''}</b></div>
        ${s.savedThb ? `<div><span class="muted small">ประหยัดกว่าไทย</span><b class="good">฿${fmtThb(s.savedThb)}</b></div>` : ''}
        <div><span class="muted small">ซื้อแล้ว</span><b>${s.bought}/${s.total}</b></div>
      </div>`
    : '';
  return `
  <div class="shop-wrap">
    ${sumLine}
    ${ui.adding ? itemForm(null) : '<button class="btn primary shop-add" data-act="shop-add">＋ เพิ่มของที่จะซื้อ</button>'}
    ${items.length ? items.map((it) => card(it, store, rate, ui)).join('') : ui.adding ? '' : '<p class="empty">ยังไม่มีรายการ — กด “＋ เพิ่มของที่จะซื้อ” แล้วใส่ราคาไทย/ราคาร้านในเกาหลีเพื่อเทียบ</p>'}
    ${s.bought ? '<button class="btn ghost sm" data-act="shop-clear-bought">ลบรายการที่ซื้อแล้ว</button>' : ''}
    ${rate ? '' : '<p class="muted small">ยังไม่มีอัตราแลกเปลี่ยน — แสดงราคาวอนอย่างเดียว (ตั้งได้ในหน้าแปลงเงิน)</p>'}
    <p class="muted small">รายการนี้เก็บเฉพาะในเครื่องนี้ ไม่ปนกับแผนและไม่แชร์</p>
    <datalist id="shop-stores">${suggestions.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
  </div>`;
}
