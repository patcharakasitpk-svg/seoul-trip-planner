import type { Place } from '../../core/types';
import { app } from '../app';
import { CATEGORY_ICON, CATEGORY_LABEL, COORD_LABEL, DINING_ZONE_LABEL, FOOD_TYPE_LABEL } from '../../data/places';
import { esc, fmtKrw, gmapsPlaceUrl } from '../util';
import { fmtDist, straightLineM } from '../../core/geo';
import { stopLocationId } from '../../core/schedule';

const CATS = ['', 'food', 'fashion', 'beauty', 'market', 'sight', 'saved'];

export function refPointOptions(): { id: string; label: string; placeId: string | null }[] {
  const day = app.day;
  const opts: { id: string; label: string; placeId: string | null }[] = [
    { id: 'hotel', label: 'โรงแรม', placeId: 'hotel' },
    { id: 'coex', label: 'COEX', placeId: 'coex' },
  ];
  // จุดที่กำลังจะแทรก: จุดก่อนช่องมื้อเย็น/ท้ายวันของวันที่เลือก
  const idx = day.stops.findIndex((s) => s.kind === 'dinner');
  const before = (idx >= 0 ? day.stops.slice(0, idx) : day.stops).map(stopLocationId).filter(Boolean) as string[];
  const insertAt = before[before.length - 1] ?? day.startPlaceId;
  if (insertAt) opts.push({ id: 'insert', label: `จุดแทรกถัดไป (${app.getPlace(insertAt)?.nameTh ?? '?'})`, placeId: insertAt });
  return opts;
}

export function currentRef(): { label: string; place: Place | undefined } {
  const o = refPointOptions().find((x) => x.id === app.refPoint) ?? refPointOptions()[0];
  return { label: o.label, place: app.getPlace(o.placeId) };
}

export function renderLibraryControls(): string {
  const f = app.filters;
  const areas = [...new Set(app.places().filter((p) => p.category !== 'base').map((p) => p.area))].sort();
  const fashionTypes = [...new Set(app.places().flatMap((p) => p.fashionTypes ?? []))].sort();
  return `
  <div class="lib-head">
    <input type="search" class="inp" placeholder="ค้นหาสถานที่ ร้าน ย่าน เมนู…" data-filter="q" value="${esc(f.q)}" aria-label="ค้นหา">
    <div class="chips" role="tablist">
      ${CATS.map((c) => `<button class="chip ${f.cat === c ? 'on' : ''}" data-act="filter-cat" data-v="${c}">${c === '' ? 'ทั้งหมด' : c === 'saved' ? '★ บันทึกไว้' : `${CATEGORY_ICON[c]} ${CATEGORY_LABEL[c]}`}</button>`).join('')}
    </div>
    <div class="filter-row">
      <select class="inp sm" data-filter="area" aria-label="ย่าน"><option value="">ทุกย่าน</option>${areas.map((a) => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select class="inp sm" data-filter="budget" aria-label="งบ"><option value="">ทุกงบ</option><option value="low" ${f.budget === 'low' ? 'selected' : ''}>≤ ₩15,000</option><option value="mid" ${f.budget === 'mid' ? 'selected' : ''}>₩15,000–40,000</option><option value="high" ${f.budget === 'high' ? 'selected' : ''}>> ₩40,000</option></select>
      <select class="inp sm" data-filter="stay" aria-label="เวลาแวะ"><option value="">ทุกเวลาแวะ</option><option value="short" ${f.stay === 'short' ? 'selected' : ''}>≤ 45 นาที</option><option value="mid" ${f.stay === 'mid' ? 'selected' : ''}>46–90 นาที</option><option value="long" ${f.stay === 'long' ? 'selected' : ''}>> 90 นาที</option></select>
      ${f.cat === 'food' || f.cat === '' ? `<select class="inp sm" data-filter="zone" aria-label="โซนมื้อเย็น"><option value="">ทุกโซนร้าน</option>${Object.entries(DINING_ZONE_LABEL).map(([k, v]) => `<option value="${k}" ${f.zone === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}
      ${f.cat === 'fashion' && fashionTypes.length ? `<select class="inp sm" data-filter="fashion" aria-label="ประเภทเสื้อผ้า"><option value="">ทุกประเภท</option>${fashionTypes.map((t) => `<option ${f.fashion === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="filter-row ref-row">
      <label class="muted small">ระยะเส้นตรงจาก</label>
      <select class="inp sm" data-act-change="ref-point" aria-label="จุดอ้างอิง">${refPointOptions().map((o) => `<option value="${o.id}" ${app.refPoint === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <button class="btn ghost sm" data-act="open-custom">＋ เพิ่มสถานที่เอง</button>
    </div>
  </div>`;
}

export function filteredPlaces(): Place[] {
  const f = app.filters;
  const q = f.q.trim().toLowerCase();
  return app
    .places()
    .filter((p) => {
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
  return `<p class="muted small">${list.length} รายการ · ระยะที่แสดงเป็น<b>ระยะเส้นตรง</b>จาก${esc(ref.label)} ไม่ใช่ระยะเดินจริง — กด “ดูเส้นทาง” เพื่อดูเวลาเดินทางจริง</p>` + list.map((p) => placeCard(p, ref.place)).join('');
}

function inPlanBadges(placeId: string): string {
  const out: string[] = [];
  app.plan.days.forEach((d, i) => {
    d.stops.forEach((s, j) => {
      if (s.placeId === placeId) out.push(`<span class="pill day-pill" style="--c:var(--d${i % 8})">วัน ${i + 1} · ลำดับ ${j + 1}</span>`);
    });
  });
  return out.join('');
}

export function placeCard(p: Place, ref: Place | undefined, opts: { compact?: boolean } = {}): string {
  const saved = app.plan.saved.includes(p.id);
  const dist = ref && ref.lat != null && p.lat != null && ref.id !== p.id ? straightLineM({ lat: ref.lat, lng: ref.lng! }, { lat: p.lat, lng: p.lng! }) : null;
  const names = [p.nameEn, p.nameKo].filter(Boolean).join(' · ');
  const budget = p.budget
    ? `${esc(p.budget.textTh)}${p.budget.krwMin != null || p.budget.krwMax != null ? ` (${fmtKrw(p.budget.krwMin)}–${fmtKrw(p.budget.krwMax)})` : ''} <span class="pill ${p.budget.status === 'source' ? 'ok' : 'warn'}">${p.budget.status === 'source' ? 'จากแหล่งข้อมูล' : p.budget.status === 'estimate' ? 'ประมาณการ' : 'ไม่ทราบ'}</span>`
    : '<span class="muted">ยังไม่มีข้อมูลงบ</span>';
  const hours = p.hours
    ? `${esc(p.hours.text)}${p.hours.closedDays ? ` · หยุด ${esc(p.hours.closedDays)}` : ''}${p.hours.lastOrder ? ` · L.O. ${esc(p.hours.lastOrder)}` : ''} <span class="pill ${p.hours.status === 'verified' ? 'ok' : 'warn'}">${p.hours.status === 'verified' ? 'ตรวจแล้ว' : 'ยังไม่ยืนยัน'}</span>`
    : '<span class="muted">ยังไม่มีข้อมูลเวลาเปิดปิด — ตรวจสอบก่อนไป</span>';
  const noPin = p.lat == null || p.lng == null;
  return `
  <article class="card place ${app.focusPlaceId === p.id ? 'focus' : ''}" data-place-card="${esc(p.id)}">
    <div class="pc-top">
      <span class="cat-ico" aria-hidden="true">${CATEGORY_ICON[p.category] ?? '📍'}</span>
      <div class="pc-names">
        <h3>${esc(p.nameTh)}${p.branch ? ` <span class="branch">สาขา ${esc(p.branch)}</span>` : ''}</h3>
        <div class="muted small">${esc(names)}</div>
      </div>
      <button class="icon-btn" data-act="toggle-save" data-place="${esc(p.id)}" aria-label="${saved ? 'เลิกบันทึก' : 'บันทึก'}" title="${saved ? 'เลิกบันทึก' : 'บันทึก'}">${saved ? '★' : '☆'}</button>
    </div>
    <div class="pc-meta">
      <span class="pill">${esc(CATEGORY_LABEL[p.category])}</span>
      <span class="pill">${esc(p.area)}</span>
      ${p.food ? `<span class="pill mint">${FOOD_TYPE_LABEL[p.food.type] ?? ''}</span><span class="pill mint">${DINING_ZONE_LABEL[p.food.diningZone] ?? ''}</span>` : ''}
      ${p.indoor ? '<span class="pill">ในร่ม</span>' : '<span class="pill">กลางแจ้ง/กึ่งกลางแจ้ง</span>'}
      ${dist != null ? `<span class="pill blue" title="ระยะเส้นตรง">↔ ${fmtDist(dist)} (เส้นตรง)</span>` : ''}
      ${inPlanBadges(p.id)}
    </div>
    <p class="reason">${esc(p.reasonTh)}</p>
    ${opts.compact ? '' : `
    <dl class="pc-dl">
      ${p.food?.menu?.length ? `<dt>เมนูเด่น</dt><dd>${p.food.menu.map(esc).join(', ')}${p.food.minOrder ? ` · สั่งขั้นต่ำ: ${esc(p.food.minOrder)}` : ''}</dd>` : ''}
      <dt>เวลาแวะ</dt><dd><input class="inp xs" type="number" min="0" step="5" value="${app.stayFor(p.id)}" data-act-change="stay-override" data-place="${esc(p.id)}" aria-label="เวลาแวะ (นาที)"> นาที ${p.food ? `(รวมเวลาทานอาหาร)` : ''}</dd>
      <dt>งบประมาณ</dt><dd>${budget}</dd>
      <dt>เปิด–ปิด</dt><dd>${hours}</dd>
      <dt>ที่อยู่</dt><dd>${esc(p.address ?? 'ไม่ทราบ')}</dd>
      <dt>พิกัด</dt><dd>${noPin ? '' : `${p.lat!.toFixed(5)}, ${p.lng!.toFixed(5)} · `}<span class="pill ${p.coordStatus === 'verified' || p.coordStatus === 'given' ? 'ok' : 'warn'}">${COORD_LABEL[p.coordStatus]}</span></dd>
      <dt>แหล่งข้อมูล</dt><dd>${p.sources.length ? p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ') : p.custom ? 'ผู้ใช้เพิ่มเอง' : 'พิกัดตั้งต้นจากผู้ใช้'}${p.checkedAt ? ` · ตรวจ ${esc(p.checkedAt)}` : ''}</dd>
      ${p.notes ? `<dt>หมายเหตุ</dt><dd class="small">${esc(p.notes)}</dd>` : ''}
    </dl>`}
    <div class="pc-actions">
      <button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}" ${noPin ? 'disabled title="ยังไม่มีพิกัดที่ตรวจสอบ"' : ''}>📍 ดูหมุด</button>
      <button class="btn sm" data-act="route-info" data-place="${esc(p.id)}" ${noPin ? 'disabled' : ''}>🧭 ดูเส้นทาง</button>
      <button class="btn primary sm" data-act="add-to-day" data-place="${esc(p.id)}">＋ เพิ่มเข้าวัน</button>
      <a class="btn sm" href="${esc(gmapsPlaceUrl(p))}" target="_blank" rel="noopener">Google Maps ↗</a>
    </div>
  </article>`;
}
