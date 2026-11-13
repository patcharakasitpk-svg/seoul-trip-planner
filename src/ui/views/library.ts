import type { Place } from '../../core/types';
import { app } from '../app';
import { CATEGORY_ICON, CATEGORY_LABEL, DINING_ZONE_LABEL } from '../../data/places';
import { esc, gmapsPlaceUrl } from '../util';
import { closedOn, shortHours, weekdayTh } from '../../core/hours';
import { fmtDateTh } from '../../core/time';
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
  if (!list.length) return `<p class="empty">ไม่พบสถานที่ตามตัวกรอง</p>`;
  const day = app.day;
  return `<p class="hint">แตะชื่อเพื่อเพิ่มเข้า <b>วัน ${app.dayIndex(day.id) + 1}</b>${day.date ? ` (${esc(fmtDateTh(day.date))})` : ''} · แตะอีกครั้งเพื่อเอาออก</p><div class="place-list">${list.map((p) => placeCard(p)).join('')}</div>`;
}

function inActiveDay(placeId: string): boolean {
  return app.day.stops.some((s) => s.placeId === placeId);
}

function otherDays(placeId: string): number[] {
  const out: number[] = [];
  app.plan.days.forEach((d, i) => {
    if (d.id !== app.activeDayId && d.stops.some((s) => s.placeId === placeId)) out.push(i + 1);
  });
  return out;
}

export function placeCard(p: Place, opts: { open?: boolean } = {}): string {
  const open = opts.open || app.expanded.has(`card:${p.id}`);
  const inDay = inActiveDay(p.id);
  const others = otherDays(p.id);
  const closed = closedOn(p, app.day.date);
  const hrs = shortHours(p);
  const meta = [esc(p.area), hrs ? `เปิด ${esc(hrs)}` : null].filter(Boolean).join(' · ');
  return `
  <article class="place ${open ? 'open' : ''} ${inDay ? 'in-day' : ''} ${app.focusPlaceId === p.id ? 'focus' : ''}" data-place-card="${esc(p.id)}">
    <div class="place-row">
      <button class="place-main" data-act="quick-toggle" data-place="${esc(p.id)}" aria-pressed="${inDay}">
        <span class="cat-ico" aria-hidden="true">${CATEGORY_ICON[p.category] ?? '📍'}</span>
        <span class="place-text">
          <span class="place-name">${esc(p.nameTh)}</span>
          <span class="place-meta">${meta}${closed ? ` · <span class="closed">${esc(closed)}</span>` : ''}${others.length ? ` · <span class="in-plan">วัน ${others.join(', ')}</span>` : ''}</span>
        </span>
      </button>
      <button class="icon-btn sm info" data-act="toggle-card" data-place="${esc(p.id)}" aria-expanded="${open}" aria-label="ข้อมูล ${esc(p.nameTh)}">ⓘ</button>
      <button class="add-btn ${inDay ? 'on' : ''}" data-act="quick-toggle" data-place="${esc(p.id)}" aria-label="${inDay ? 'เอาออกจากวันนี้' : 'เพิ่มเข้าวันนี้'}">${inDay ? '✓' : '＋'}</button>
    </div>
    ${open ? placeDetails(p) : ''}
  </article>`;
}

function placeDetails(p: Place): string {
  const h = p.hours;
  const src = p.sources[0];
  const th = [
    shortHours(p) || null,
    h?.closedWeekdays?.length ? `ปิดทุกวัน${h.closedWeekdays.map(weekdayTh).join('/')}` : h ? 'ไม่มีวันหยุดประจำสัปดาห์ที่ระบุ' : null,
    h?.lastOrder ? `สั่งรอบสุดท้าย ${h.lastOrder}` : null,
  ].filter(Boolean).join(' · ');
  const hoursLine = h ? `${esc(th || 'ดูรายละเอียดด้านล่าง')}<br><span class="muted">${esc(h.text)}</span>` : 'ไม่มีข้อมูล';
  const verify = h?.status === 'verified'
    ? `<span class="muted">ตรวจแล้ว${p.checkedAt ? ` ${esc(p.checkedAt)}` : ''}${src ? ` · <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.label)}</a>` : ''}</span>`
    : `<span class="closed">ยังไม่ยืนยัน</span> — <a href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">เช็กเวลาใน Google Maps ↗</a>`;
  return `
    <div class="place-details">
      <p>${esc(p.reasonTh)}</p>
      <p class="small"><b>เวลาเปิด</b> ${hoursLine}<br>${verify}</p>
      ${p.food?.menu?.length ? `<p class="small"><b>เมนู</b> ${p.food.menu.slice(0, 3).map(esc).join(', ')}</p>` : ''}
      ${p.budget && p.budget.textTh ? `<p class="small"><b>งบ</b> ${esc(p.budget.textTh)}${p.budget.status === 'estimate' ? ' (ประมาณ)' : ''}</p>` : ''}
      ${p.lat == null ? '<p class="small closed">ยังไม่มีพิกัด — ไม่ปักหมุด</p>' : p.coordStatus === 'area-center' ? '<p class="small muted">หมุดกลางย่าน/จุดรวมอาคาร — อาจต้องเดินต่อ</p>' : ''}
      <div class="row-btns">
        <a class="btn sm" href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">Google Maps ↗</a>
        ${p.lat != null ? `<button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}">ดูบนแผนที่</button>` : ''}
      </div>
    </div>`;
}

export { CATEGORY_LABEL };
