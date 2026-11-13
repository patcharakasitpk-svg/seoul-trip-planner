import type { Place } from '../../core/types';
import { app } from '../app';
import { CATEGORY_ICON, CATEGORY_LABEL, COORD_LABEL, DINING_ZONE_LABEL, FOOD_TYPE_LABEL } from '../../data/places';
import { esc, fmtKrw, gmapsPlaceUrl } from '../util';
import { fmtDist, straightLineM } from '../../core/geo';
import { stopLocationId } from '../../core/schedule';

const CATS: [string, string][] = [
  ['', 'ทั้งหมด'],
  ['food', '🍜 ร้านอาหาร'],
  ['fashion', '👕 เสื้อผ้า'],
  ['beauty', '💄 ความงาม'],
  ['market', '🍢 ตลาด'],
  ['sight', '🏛️ เที่ยว'],
  ['saved', '★ บันทึกไว้'],
];

export function refPointOptions(): { id: string; label: string; placeId: string | null }[] {
  const day = app.day;
  const opts: { id: string; label: string; placeId: string | null }[] = [
    { id: 'hotel', label: 'โรงแรม', placeId: 'hotel' },
    { id: 'coex', label: 'COEX', placeId: 'coex' },
  ];
  const idx = day.stops.findIndex((s) => s.kind === 'dinner');
  const before = (idx >= 0 ? day.stops.slice(0, idx) : day.stops).map(stopLocationId).filter(Boolean) as string[];
  const insertAt = before[before.length - 1] ?? day.startPlaceId;
  if (insertAt) opts.push({ id: 'insert', label: `จุดล่าสุดในแผน (${app.getPlace(insertAt)?.nameTh ?? '?'})`, placeId: insertAt });
  return opts;
}

export function currentRef(): { label: string; place: Place | undefined } {
  const o = refPointOptions().find((x) => x.id === app.refPoint) ?? refPointOptions()[0];
  return { label: o.label, place: app.getPlace(o.placeId) };
}

function activeFilterCount(): number {
  const f = app.filters;
  return [f.area, f.budget, f.stay, f.zone, f.fashion].filter(Boolean).length;
}

export function renderLibraryControls(): string {
  const f = app.filters;
  const open = app.expanded.has('filters');
  const areas = [...new Set(app.places().filter((p) => p.category !== 'base').map((p) => p.area))].sort();
  const fashionTypes = [...new Set(app.places().flatMap((p) => p.fashionTypes ?? []))].sort();
  const n = activeFilterCount();
  return `
  <div class="lib-head">
    <div class="search-row">
      <input type="search" class="inp" placeholder="ค้นหาร้าน ย่าน เมนู" data-filter="q" value="${esc(f.q)}" aria-label="ค้นหา">
      <button class="btn ghost sm ${n ? 'on' : ''}" data-act="toggle-filters" aria-expanded="${open}">ตัวกรอง${n ? ` (${n})` : ''}</button>
    </div>
    <div class="chips" role="tablist">
      ${CATS.map(([c, label]) => `<button class="chip ${f.cat === c ? 'on' : ''}" data-act="filter-cat" data-v="${c}">${label}</button>`).join('')}
    </div>
    ${
      open
        ? `<div class="filter-panel">
      <select class="inp sm" data-filter="area" aria-label="ย่าน"><option value="">ทุกย่าน</option>${areas.map((a) => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select class="inp sm" data-filter="budget" aria-label="งบ"><option value="">ทุกงบ</option><option value="low" ${f.budget === 'low' ? 'selected' : ''}>≤ ₩15,000</option><option value="mid" ${f.budget === 'mid' ? 'selected' : ''}>₩15,000–40,000</option><option value="high" ${f.budget === 'high' ? 'selected' : ''}>> ₩40,000</option></select>
      <select class="inp sm" data-filter="stay" aria-label="เวลาแวะ"><option value="">ทุกเวลาแวะ</option><option value="short" ${f.stay === 'short' ? 'selected' : ''}>≤ 45 นาที</option><option value="mid" ${f.stay === 'mid' ? 'selected' : ''}>46–90 นาที</option><option value="long" ${f.stay === 'long' ? 'selected' : ''}>> 90 นาที</option></select>
      <select class="inp sm" data-filter="zone" aria-label="โซนร้าน"><option value="">ทุกโซนร้าน</option>${Object.entries(DINING_ZONE_LABEL).map(([k, v]) => `<option value="${k}" ${f.zone === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${fashionTypes.length ? `<select class="inp sm" data-filter="fashion" aria-label="ประเภทเสื้อผ้า"><option value="">ทุกประเภทเสื้อผ้า</option>${fashionTypes.map((t) => `<option ${f.fashion === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
      <label class="small muted">วัดระยะจาก <select class="inp sm" data-act-change="ref-point" aria-label="จุดอ้างอิง">${refPointOptions().map((o) => `<option value="${o.id}" ${app.refPoint === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <div class="row-btns">${n ? '<button class="btn ghost xs" data-act="clear-filters">ล้างตัวกรอง</button>' : ''}<button class="btn ghost xs" data-act="open-custom">＋ เพิ่มสถานที่เอง</button></div>
    </div>`
        : ''
    }
  </div>`;
}

export function filteredPlaces(): Place[] {
  const f = app.filters;
  const q = f.q.trim().toLowerCase();
  return app.places().filter((p) => {
    if (f.cat === 'saved') {
      if (!app.plan.saved.includes(p.id)) return false;
    } else if (f.cat && p.category !== f.cat) return false;
    if (!f.cat && p.category === 'base' && p.kind) return false;
    if (f.area && p.area !== f.area) return false;
    if (f.zone && p.food?.diningZone !== f.zone) return false;
    if (f.fashion && !(p.fashionTypes ?? []).includes(f.fashion)) return false;
    const stay = app.stayFor(p.id);
    if (f.stay === 'short' && stay > 45) return false;
    if (f.stay === 'mid' && (stay <= 45 || stay > 90)) return false;
    if (f.stay === 'long' && stay <= 90) return false;
    if (f.budget) {
      const max = p.budget?.krwMax ?? p.budget?.krwMin;
      if (max == null) return false;
      if (f.budget === 'low' && max > 15000) return false;
      if (f.budget === 'mid' && (max <= 15000 || max > 40000)) return false;
      if (f.budget === 'high' && max <= 40000) return false;
    }
    if (q) {
      const hay = [p.nameTh, p.nameEn, p.nameKo, p.branch, p.area, p.address, p.reasonTh, ...(p.food?.menu ?? [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function renderLibraryList(): string {
  const list = filteredPlaces();
  const ref = currentRef();
  if (!list.length) return `<p class="empty">ไม่พบสถานที่ตามตัวกรอง</p>`;
  return `<p class="hint">${list.length} แห่ง · ระยะ = เส้นตรงจาก${esc(ref.label)}</p><div class="place-list">${list.map((p) => placeCard(p, ref.place)).join('')}</div>`;
}

function inPlanDays(placeId: string): number[] {
  const out: number[] = [];
  app.plan.days.forEach((d, i) => {
    if (d.stops.some((s) => s.placeId === placeId)) out.push(i + 1);
  });
  return out;
}

export function placeCard(p: Place, ref: Place | undefined, opts: { open?: boolean } = {}): string {
  const saved = app.plan.saved.includes(p.id);
  const open = opts.open || app.expanded.has(`card:${p.id}`);
  const dist = ref && ref.lat != null && p.lat != null && ref.id !== p.id ? straightLineM({ lat: ref.lat, lng: ref.lng! }, { lat: p.lat, lng: p.lng! }) : null;
  const days = inPlanDays(p.id);
  const noPin = p.lat == null || p.lng == null;
  const meta = [esc(p.area), dist != null ? `${fmtDist(dist)}` : null, `${app.stayFor(p.id)} นาที`].filter(Boolean).join(' · ');
  return `
  <article class="place ${open ? 'open' : ''} ${app.focusPlaceId === p.id ? 'focus' : ''}" data-place-card="${esc(p.id)}">
    <div class="place-row">
      <button class="place-main" data-act="toggle-card" data-place="${esc(p.id)}" aria-expanded="${open}">
        <span class="cat-ico" aria-hidden="true">${CATEGORY_ICON[p.category] ?? '📍'}</span>
        <span class="place-text">
          <span class="place-name">${esc(p.nameTh)}${saved ? ' <span class="star">★</span>' : ''}</span>
          <span class="place-meta">${meta}${days.length ? ` · <span class="in-plan">อยู่ในวัน ${days.join(', ')}</span>` : ''}</span>
        </span>
      </button>
      <button class="add-btn" data-act="add-to-day" data-place="${esc(p.id)}" aria-label="เพิ่ม ${esc(p.nameTh)} เข้าแผน" title="เพิ่มเข้าแผน">＋</button>
    </div>
    ${open ? placeDetails(p, saved, noPin) : ''}
  </article>`;
}

function placeDetails(p: Place, saved: boolean, noPin: boolean): string {
  const names = [p.nameEn, p.nameKo, p.branch ? `สาขา ${p.branch}` : null].filter(Boolean).join(' · ');
  const budget = p.budget
    ? `${esc(p.budget.textTh)}${p.budget.krwMin != null || p.budget.krwMax != null ? ` (${fmtKrw(p.budget.krwMin)}–${fmtKrw(p.budget.krwMax)})` : ''} <span class="tag ${p.budget.status === 'source' ? '' : 'warn'}">${p.budget.status === 'source' ? 'จากแหล่งข้อมูล' : p.budget.status === 'estimate' ? 'ประมาณการ' : 'ไม่ทราบ'}</span>`
    : '<span class="muted">ไม่มีข้อมูล</span>';
  const hours = p.hours
    ? `${esc(p.hours.text)}${p.hours.closedDays ? ` · หยุด ${esc(p.hours.closedDays)}` : ''}${p.hours.lastOrder ? ` · สั่งรอบสุดท้าย ${esc(p.hours.lastOrder)}` : ''}${p.hours.status === 'verified' ? '' : ' <span class="tag warn">ยังไม่ยืนยัน</span>'}`
    : '<span class="muted">ไม่มีข้อมูล — ตรวจก่อนไป</span>';
  return `
    <div class="place-details">
      <p class="muted small">${esc(names)}</p>
      <p>${esc(p.reasonTh)}</p>
      <dl class="dl">
        ${p.food ? `<dt>ประเภท</dt><dd>${FOOD_TYPE_LABEL[p.food.type] ?? ''} · ${DINING_ZONE_LABEL[p.food.diningZone] ?? ''}</dd>` : ''}
        ${p.food?.menu?.length ? `<dt>เมนู</dt><dd>${p.food.menu.map(esc).join(', ')}${p.food.minOrder ? ` · ขั้นต่ำ ${esc(p.food.minOrder)}` : ''}</dd>` : ''}
        <dt>เปิด–ปิด</dt><dd>${hours}</dd>
        <dt>งบ</dt><dd>${budget}</dd>
        <dt>เวลาแวะ</dt><dd><input class="inp xs" type="number" min="0" step="5" value="${app.stayFor(p.id)}" data-act-change="stay-override" data-place="${esc(p.id)}" aria-label="เวลาแวะ (นาที)"> นาที</dd>
        <dt>ที่อยู่</dt><dd>${esc(p.address ?? 'ไม่ทราบ')}</dd>
        <dt>พิกัด</dt><dd>${p.coordStatus === 'verified' || p.coordStatus === 'given' ? '<span class="muted">ตรวจแล้ว</span>' : `<span class="tag warn">${COORD_LABEL[p.coordStatus]}</span>`}</dd>
        <dt>แหล่งข้อมูล</dt><dd class="small">${p.sources.length ? p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ') : p.custom ? 'ผู้ใช้เพิ่มเอง' : 'พิกัดตั้งต้นจากผู้ใช้'}${p.checkedAt ? ` · ตรวจ ${esc(p.checkedAt)}` : ''}</dd>
      </dl>
      ${p.notes ? `<details class="small muted"><summary>บันทึกการตรวจสอบข้อมูล</summary>${esc(p.notes)}</details>` : ''}
      <div class="row-btns">
        <button class="btn primary sm" data-act="add-to-day" data-place="${esc(p.id)}">＋ เพิ่มเข้าแผน</button>
        <button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}" ${noPin ? 'disabled title="ยังไม่มีพิกัด"' : ''}>ดูบนแผนที่</button>
        <button class="btn sm" data-act="route-info" data-place="${esc(p.id)}" ${noPin ? 'disabled' : ''}>เส้นทาง</button>
        <a class="btn sm" href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">Google Maps ↗</a>
        <button class="btn ghost sm" data-act="toggle-save" data-place="${esc(p.id)}">${saved ? '★ เลิกบันทึก' : '☆ บันทึก'}</button>
      </div>
    </div>`;
}

export { CATEGORY_LABEL };
