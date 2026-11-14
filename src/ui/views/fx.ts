import { esc } from '../util';
import { activeRate, fmtKrw, fmtThb, krwToThb, parseAmount, thbToKrw, type FxStore } from '../../services/fx';
import { fmtDateTh } from '../../core/time';

export type FxDir = 'krw2thb' | 'thb2krw';
export interface FxUi {
  dir: FxDir;
  amount: string;
  editingRate: boolean;
  loading: boolean;
}

const QUICK: Record<FxDir, number[]> = {
  krw2thb: [1000, 5000, 10000, 30000, 50000, 100000],
  thb2krw: [100, 500, 1000, 2000, 5000, 10000],
};
const REF_ROWS = [1000, 5000, 10000, 20000, 50000, 100000];

/** ผลแปลงของจำนวนที่พิมพ์ (ข้อความพร้อมแสดง) */
export function fxResult(ui: FxUi, s: FxStore): string {
  const rate = activeRate(s);
  const n = parseAmount(ui.amount);
  if (!rate || n == null) return '0';
  return ui.dir === 'krw2thb' ? fmtThb(krwToThb(n, rate)) : fmtKrw(thbToKrw(n, rate));
}

/** จัดรูปแบบตัวเลขในช่องกรอกด้วยจุลภาค (คงทศนิยมที่กำลังพิมพ์) */
export function formatTyping(text: string): string {
  const t = text.replace(/[^\d.]/g, '');
  const [int, ...rest] = t.split('.');
  const intFmt = int ? Number(int).toLocaleString('en-US') : rest.length ? '0' : '';
  return rest.length ? `${intFmt}.${rest.join('').slice(0, 2)}` : intFmt;
}

export function renderFx(ui: FxUi, s: FxStore, online: boolean): string {
  const rate = activeRate(s);
  const from = ui.dir === 'krw2thb' ? { sym: '₩', name: 'วอน' } : { sym: '฿', name: 'บาท' };
  const to = ui.dir === 'krw2thb' ? { sym: '฿', name: 'บาท' } : { sym: '₩', name: 'วอน' };
  const rateLine = rate
    ? `1 บาท = <b>${rate.toFixed(2)}</b> วอน · ${s.custom ? 'อัตราที่ตั้งเอง' : `อัตราอ้างอิง${s.refDate ? ` ${esc(fmtDateTh(s.refDate))}` : ''}${s.source ? ` (${esc(s.source)})` : ''}`}`
    : ui.loading
      ? 'กำลังโหลดอัตราแลกเปลี่ยน…'
      : `ยังไม่มีอัตราแลกเปลี่ยน${online ? '' : ' (ออฟไลน์)'} — กด “ตั้งอัตราเอง”`;
  return `
  <div class="fx-wrap">
    <div class="fx-card">
      <label class="fx-row from">
        <span class="fx-sym">${from.sym}</span>
        <input id="fx-in" class="fx-in" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="${esc(ui.amount)}" aria-label="จำนวน${from.name}">
        <span class="fx-name">${from.name}</span>
      </label>
      <button class="fx-swap" data-act="fx-swap" aria-label="สลับ ${to.name} → ${from.name}">⇅</button>
      <div class="fx-row to" aria-live="polite">
        <span class="fx-sym">${to.sym}</span>
        <output id="fx-out" class="fx-out">${fxResult(ui, s)}</output>
        <span class="fx-name">${to.name}</span>
      </div>
    </div>

    <div class="fx-quick">
      ${QUICK[ui.dir].map((v) => `<button class="chip" data-act="fx-set" data-v="${v}">${from.sym}${v.toLocaleString('en-US')}</button>`).join('')}
      <button class="chip ghost" data-act="fx-set" data-v="">ล้าง</button>
    </div>

    ${
      rate
        ? `<div class="fx-table" aria-label="ตารางเทียบราคา">${REF_ROWS.map((k) => `<div><span>₩${fmtKrw(k)}</span><b>฿${fmtThb(krwToThb(k, rate))}</b></div>`).join('')}</div>`
        : ''
    }

    <div class="fx-rate">
      <p class="small">${rateLine}</p>
      ${
        ui.editingRate
          ? `<form data-form="fx-rate" class="fx-rate-form">
          <label class="small">1 บาท = <input class="inp xs" name="rate" inputmode="decimal" value="${rate ? rate.toFixed(2) : ''}" aria-label="วอนต่อ 1 บาท"> วอน</label>
          <button class="btn sm primary">ใช้อัตรานี้</button>
          ${s.custom ? '<button type="button" class="btn sm" data-act="fx-auto">กลับไปใช้อัตราอัตโนมัติ</button>' : ''}
        </form>
        <p class="muted small">ใส่อัตราจากป้ายร้านแลกเงิน หรือบัตรที่ใช้จ่ายจริง · อัตราอ้างอิงมักต่างจากที่ร้าน/บัตรให้ราว 1–3%</p>`
          : `<div class="row-btns"><button class="btn ghost sm" data-act="fx-edit">ตั้งอัตราเอง</button><button class="btn ghost sm" data-act="fx-refresh" ${online ? '' : 'disabled'}>⟳ อัปเดตอัตรา</button></div>`
      }
    </div>
  </div>`;
}
