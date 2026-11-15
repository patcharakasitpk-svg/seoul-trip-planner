import type { Place } from '../../core/types';
import { app } from '../app';
import { CATEGORY_ICON, CATEGORY_LABEL, DINING_ZONE_LABEL } from '../../data/places';
import { esc, gmapsPlaceUrl, photosUrl, naverBtn, naverPlaceUrl } from '../util';
import { closedOn, shortHours, weekdayTh } from '../../core/hours';
import { stationBlock } from './transit';
import { fmtDateTh } from '../../core/time';
import { stopLocationId } from '../../core/schedule';
import { findExisting, resultMapsUrl } from '../../services/placeSearch';
import { isGoogleReady } from '../../services/google';

const CATS: [string, string][] = [
  ['', 'ทั้งหมด'],
  ['food', '🍜 ร้านอาหาร'],
  ['cafe', '☕ คาเฟ่'],
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
      <input type="search" class="inp" placeholder="ค้นหาร้าน ย่าน เมนู หรือชื่อสถานที่ใดก็ได้" data-filter="q" value="${esc(f.q)}" aria-label="ค้นหา" enterkeyhint="search">
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
    } else if (f.cat === 'cafe') {
      if (p.food?.type !== 'cafe') return false;
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
      const hay = [p.nameTh, p.thaiName, p.nameEn, p.nameKo, p.branch, p.area, p.address, p.reasonTh, ...(p.food?.menu ?? [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function renderLibraryList(): string {
  const list = filteredPlaces();
  const web = renderWebSearch();
  if (!list.length) return `${web}<p class="empty">ไม่พบสถานที่ในรายการแนะนำ${app.filters.q.trim() ? ' — ลองค้นหาบนแผนที่ด้านบน' : 'ตามตัวกรอง'}</p>`;
  const day = app.day;
  return `${web}<p class="hint">แตะชื่อเพื่อเพิ่มเข้า <b>วัน ${app.dayIndex(day.id) + 1}</b>${day.date ? ` (${esc(fmtDateTh(day.date))})` : ''} · แตะอีกครั้งเพื่อเอาออก</p><div class="place-list">${list.map((p) => placeCard(p)).join('')}</div>`;
}

/** ค้นหาสถานที่ใดก็ได้จาก Google Maps / OpenStreetMap */
export function renderWebSearch(): string {
  const q = app.filters.q.trim();
  const s = app.search;
  const src = isGoogleReady() ? 'Google Maps' : 'OpenStreetMap';
  const btn = q ? `<button class="btn sm web-search-btn" data-act="web-search">🔎 ค้นหา “${esc(q)}” บน ${src}</button>` : '';
  if (!s) return btn ? `<div class="web-search">${btn}</div>` : '';
  const head = `<div class="web-search-head"><b>ผลค้นหา “${esc(s.q)}”</b>${s.provider ? ` <span class="muted small">จาก ${s.provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}</span>` : ''}<button class="btn ghost xs" data-act="web-search-clear">ปิด</button></div>`;
  const again = q && q !== s.q ? btn : '';
  let body = '';
  if (s.status === 'loading') body = '<p class="muted small">กำลังค้นหา…</p>';
  else if (s.status === 'error') body = `<p class="closed small">${esc(s.note ?? 'ค้นหาไม่สำเร็จ')}</p>`;
  else if (!s.results.length) body = '<p class="muted small">ไม่พบสถานที่ — ลองพิมพ์ชื่อภาษาอังกฤษหรือเกาหลี หรือเติมชื่อย่าน</p>';
  else {
    const n = app.dayIndex(app.day.id) + 1;
    body = `${s.note ? `<p class="warn-text small">${esc(s.note)}</p>` : ''}<div class="place-list">${s.results
      .map((r, i) => {
        const ex = findExisting(app.plan.customPlaces, r);
        const inDay = !!ex && app.day.stops.some((st) => st.placeId === ex.id);
        return `<article class="place search-result ${s.focus === i ? 'focus' : ''}" data-search-card="${i}">
        <div class="place-row">
          <button class="place-main" data-act="web-search-focus" data-i="${i}">
            <span class="cat-ico" aria-hidden="true">📍</span>
            <span class="place-text"><span class="place-name">${esc(r.name)}</span><span class="place-meta">${esc(r.address ?? '')}</span></span>
          </button>
          <a class="icon-btn sm info" href="${esc(resultMapsUrl(r))}" target="_blank" rel="noopener" aria-label="เปิด ${esc(r.name)} ใน Google Maps" title="เปิดใน Google Maps">↗</a>
          <button class="add-btn ${inDay ? 'on' : ''}" data-act="web-search-add" data-i="${i}" aria-label="${inDay ? 'อยู่ในวันนี้แล้ว' : `เพิ่มเข้าวัน ${n}`}">${inDay ? '✓' : '＋'}</button>
        </div>
      </article>`;
      })
      .join('')}</div><p class="muted small">＋ = เพิ่มเข้าวัน ${n} (บันทึกเป็น "สถานที่ที่เพิ่มเอง") · แตะชื่อเพื่อดูหมุด</p>`;
  }
  return `<div class="web-search">${head}${again}${body}</div>`;
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
      ${p.thaiName || p.nameKo ? `<p class="small muted">${p.thaiName && p.thaiName !== p.nameTh ? `ไทย: ${esc(p.thaiName)}` : ''}${p.thaiName && p.nameKo ? ' · ' : ''}${p.nameKo ? `เกาหลี: <span lang="ko">${esc(p.nameKo)}</span>` : ''}</p>` : ''}
      <p>${esc(p.reasonTh)}</p>
      <p class="small"><b>เวลาเปิด</b> ${hoursLine}<br>${verify}</p>
      ${stationBlock(p, app.getPlace(app.day.startPlaceId) ?? app.getPlace('hotel'))}
      ${p.food?.menu?.length ? `<p class="small"><b>เมนู</b> ${p.food.menu.slice(0, 3).map(esc).join(', ')}</p>` : ''}
      ${p.budget && p.budget.textTh ? `<p class="small"><b>งบ</b> ${esc(p.budget.textTh)}${p.budget.status === 'estimate' ? ' (ประมาณ)' : ''}</p>` : ''}
      ${p.lat == null ? coordFixForm(p) : p.coordStatus === 'area-center' ? '<p class="small muted">หมุดกลางย่าน/จุดรวมอาคาร — อาจต้องเดินต่อ</p>' : p.coordStatus === 'approx' ? `<p class="small muted">หมุดเส้นประ = พิกัดจากแหล่งเดียว${p.coordSource ? ` (${esc(p.coordSource)})` : ''} — เช็กใน Google Maps ก่อนไป</p>` : ''}
      <div class="row-btns">
        <a class="btn sm" href="${esc(photosUrl(p))}" target="_blank" rel="noopener">📷 ดูรูป</a>
        <a class="btn sm" href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">Google Maps ↗</a>
        ${naverBtn(naverPlaceUrl(p))}
        ${p.lat != null ? `<button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}">ดูบนแผนที่</button>` : ''}
      </div>
    </div>`;
}

/** สถานที่ที่ยังไม่มีพิกัด: เปิดดูใน Google Maps แล้ววางพิกัด/ลิงก์ เพื่อปักหมุดเอง */
export function coordFixForm(p: Place): string {
  return `<form class="coord-fix" data-form="coord" data-place="${esc(p.id)}">
    <p class="small"><b class="closed">ยังไม่มีพิกัด จึงปักหมุดไม่ได้</b> · <a href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">เปิดใน Google Maps ↗</a></p>
    <div class="coord-row"><input class="inp sm" name="coord" placeholder="วางพิกัด เช่น 37.5438, 127.0557 หรือลิงก์ Google Maps" aria-label="พิกัดหรือลิงก์ Google Maps"><button class="btn sm primary">บันทึกพิกัด</button></div>
    <p class="muted small">บนคอม: คลิกขวาที่ร้านใน Google Maps → กดตัวเลขพิกัดบรรทัดแรกเพื่อคัดลอก แล้ววางที่นี่</p>
  </form>`;
}

export { CATEGORY_LABEL };
