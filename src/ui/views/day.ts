import type { Day, Place } from '../../core/types';
import type { DaySchedule, StopTiming } from '../../core/schedule';
import { app } from '../app';
import { dayColor, esc, gmapsPlaceUrl } from '../util';
import { fmtDateTh, fmtDur, fmtHM } from '../../core/time';
import { legRow } from './leg';
import { renderWeather } from './weather';
import { CATEGORY_ICON } from '../../data/places';
import { tripDates } from '../../core/planOps';

export function renderDayTabs(): string {
  return `<div class="day-tabs" role="tablist">
    ${app.plan.days
      .map(
        (d, i) => `<button role="tab" class="day-tab ${d.id === app.activeDayId ? 'on' : ''}" style="--c:${dayColor(i)}" data-act="select-day" data-day="${d.id}" aria-selected="${d.id === app.activeDayId}">
        <b>วัน ${i + 1}</b><span>${d.date ? esc(fmtDateTh(d.date).replace(/ \d{4}$/, '')) : 'ยังไม่ตั้งวันที่'}</span></button>`,
      )
      .join('')}
    <button class="day-tab add" data-act="add-day" aria-label="เพิ่มวัน">＋</button>
  </div>`;
}

export function placeOptions(selected: string | null, allowNone = true): string {
  const ps = app.places().filter((p) => p.lat != null);
  const group = (label: string, list: Place[]) => (list.length ? `<optgroup label="${label}">${list.map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? 'selected' : ''}>${esc(p.nameTh)}</option>`).join('')}</optgroup>` : '');
  return `${allowNone ? `<option value="" ${!selected ? 'selected' : ''}>— เลือก —</option>` : ''}
    ${group('จุดหลัก', ps.filter((p) => p.kind === 'hotel' || p.kind === 'venue'))}
    ${group('สถานที่อื่น', ps.filter((p) => !(p.kind === 'hotel' || p.kind === 'venue')))}`;
}

const shortName = (p: Place | undefined) => (p ? (p.id === 'hotel' ? 'โรงแรม' : p.id === 'coex' ? 'COEX' : p.nameTh) : '?');

function timeCell(t: number | null, lower: boolean) {
  return t == null ? '--:--' : `${lower ? '<span class="lb" title="อย่างเร็ว — มีช่วงที่ยังไม่มีข้อมูล">≥</span>' : ''}${fmtHM(t)}`;
}

/** สรุปสถานะวันเป็นบรรทัดเดียว */
function statusLine(s: DaySchedule, day: Day): { cls: string; text: string } {
  if (!day.date || !day.startTime) return { cls: 'warn', text: `ตั้ง${!day.date ? 'วันที่' : ''}${!day.date && !day.startTime ? 'และ' : ''}${!day.startTime ? 'เวลาออก' : ''}เพื่อคำนวณตาราง` };
  const end = s.end;
  if (!end) return { cls: 'warn', text: 'เลือกจุดสิ้นสุดของวัน' };
  const name = shortName(app.getPlace(day.endPlaceId));
  if (end.arrive == null) return { cls: 'warn', text: 'ยังคำนวณไม่ได้' };
  if (end.slackMin != null && end.slackMin < 0) return { cls: 'bad', text: `ถึง${name} ${fmtHM(end.arrive)} · เกินเวลา ${fmtDur(-end.slackMin)}` };
  if (s.missingLegs) return { cls: 'warn', text: `ถึง${name} ≥ ${fmtHM(end.arrive)} · กรอกเวลาเดินทางอีก ${s.missingLegs} ช่วง — ยังสรุปไม่ได้ว่าทัน` };
  if (end.slackMin != null) return { cls: 'ok', text: `ถึง${name} ${fmtHM(end.arrive)} · เหลือเวลา ${fmtDur(end.slackMin)}` };
  return { cls: 'ok', text: `ถึง${name} ${fmtHM(end.arrive)}` };
}

function settingsCard(day: Day, idx: number): string {
  const missingCore = !day.date || !day.startTime || !day.startPlaceId || !day.endPlaceId;
  const open = missingCore || app.expanded.has(`set:${day.id}`);
  const start = app.getPlace(day.startPlaceId);
  const end = app.getPlace(day.endPlaceId);
  const lbl = (text: string, v: unknown, hint = '') => `<span class="lbl"><span>${text}</span>${v ? (hint ? `<span class="hint-tag">${hint}</span>` : '') : '<span class="need-tag">ยังไม่ตั้ง</span>'}</span>`;
  const cls = (v: unknown) => (v ? '' : 'need');
  if (!open) {
    return `<button class="day-summary" data-act="toggle-settings" data-day="${day.id}" aria-expanded="false">
      <span><b>${esc(fmtDateTh(day.date))}</b><br><span class="muted">${esc(shortName(start))} ${esc(day.startTime ?? '')} → ${esc(shortName(end))}${day.endTime ? ` (ภายใน ${esc(day.endTime)})` : ''}</span></span>
      <span class="edit-link">แก้ไข</span></button>`;
  }
  const more = app.expanded.has(`setmore:${day.id}`);
  return `
  <section class="settings" aria-label="ตั้งค่าวัน ${idx + 1}">
    <div class="field-grid">
      <label class="full ${cls(day.date)}">${lbl('วันที่', day.date)}<input class="inp" type="date" value="${esc(day.date ?? '')}" data-act-change="day-field" data-field="date" data-day="${day.id}"></label>
      <label class="${cls(day.startPlaceId)}">${lbl('ออกจาก', day.startPlaceId)}<select class="inp" data-act-change="day-field" data-field="startPlaceId" data-day="${day.id}">${placeOptions(day.startPlaceId)}</select></label>
      <label class="${cls(day.startTime)}">${lbl('เวลาออก', day.startTime)}<input class="inp" type="time" value="${esc(day.startTime ?? '')}" data-act-change="day-field" data-field="startTime" data-day="${day.id}"></label>
      <label class="${cls(day.endPlaceId)}">${lbl('กลับไปที่', day.endPlaceId)}<select class="inp" data-act-change="day-field" data-field="endPlaceId" data-day="${day.id}">${placeOptions(day.endPlaceId)}</select></label>
      <label>${lbl('ถึงภายใน', true, 'ไม่บังคับ')}<input class="inp" type="time" value="${esc(day.endTime ?? '')}" data-act-change="day-field" data-field="endTime" data-day="${day.id}"></label>
    </div>
    <div class="quick">
      <button class="chip" data-act="quick" data-field="startPlaceId" data-v="hotel" data-day="${day.id}">ออกจากโรงแรม</button>
      <button class="chip" data-act="quick" data-field="startPlaceId" data-v="coex" data-day="${day.id}">ออกจาก COEX</button>
      <button class="chip" data-act="quick" data-field="endPlaceId" data-v="hotel" data-day="${day.id}">กลับโรงแรม</button>
    </div>
    ${
      more
        ? `<div class="more-settings">
      <div class="set-row"><span>เวลาเผื่อต่อช่วง</span><span><input class="inp xs" type="number" min="0" max="120" value="${day.bufferMin}" data-act-change="day-field" data-field="bufferMin" data-day="${day.id}"> นาที</span></div>
      <div class="prefs">
        <label><input type="checkbox" data-act-change="day-pref" data-field="lessWalking" data-day="${day.id}" ${day.prefs.lessWalking ? 'checked' : ''}> เดินน้อย</label>
        <label><input type="checkbox" data-act-change="day-pref" data-field="fewerTransfers" data-day="${day.id}" ${day.prefs.fewerTransfers ? 'checked' : ''}> เปลี่ยนสายน้อย</label>
        <label><input type="checkbox" data-act-change="day-field" data-field="afterBooth" data-day="${day.id}" ${day.afterBooth ? 'checked' : ''}> เพิ่งเลิกออกบูธ</label>
      </div>
    </div>`
        : ''
    }
    <div class="settings-foot">
      <button class="link small" data-act="toggle-setmore" data-day="${day.id}">${more ? 'ซ่อนตัวเลือก' : 'ตัวเลือกเพิ่มเติม'}</button>
      <span class="foot-right">
        ${more ? `<button class="btn ghost sm danger" data-act="remove-day" data-day="${day.id}" ${app.plan.days.length <= 1 ? 'disabled' : ''}>ลบวันนี้</button>` : ''}
        ${missingCore ? '' : `<button class="btn sm primary" data-act="toggle-settings" data-day="${day.id}">เสร็จ</button>`}
      </span>
    </div>
  </section>`;
}

function stopRow(day: Day, t: StopTiming, i: number, total: number, dayIdx: number): string {
  const s = t.stop;
  const p = app.getPlace(s.placeId);
  const open = app.expanded.has(s.uid);
  const unselectedDinner = s.kind === 'dinner' && !p;
  const name =
    s.kind === 'dinner'
      ? p ? `${esc(p.nameTh)}` : 'มื้อเย็น'
      : s.kind === 'break'
        ? esc(s.title || 'พัก')
        : s.kind === 'buffer'
          ? esc(s.title || 'เวลาสำรอง')
          : esc(p?.nameTh ?? 'สถานที่ไม่ทราบ');
  const icon = s.kind === 'dinner' ? '🍽️' : s.kind === 'break' ? '☕' : s.kind === 'buffer' ? '⏳' : (CATEGORY_ICON[p?.category ?? 'base'] ?? '📍');
  const warns = t.warnings.filter((w) => w !== 'ยังไม่ได้เลือกร้าน' && !w.startsWith('หมุดกลางย่าน'));
  const isShop = p && (p.category === 'fashion' || p.category === 'beauty' || p.category === 'market');
  const isFood = p && (p.category === 'food' || s.kind === 'dinner');
  const sub = s.skipped
    ? 'ข้ามแล้ว'
    : `ถึง ${timeCell(t.arrive, t.lowerBound)}${t.wait ? ` · รอ ${fmtDur(t.wait)}` : ''} · อยู่ ${fmtDur(s.stayMin)} ถึง ${timeCell(t.depart, t.lowerBound)}${s.lockedTime ? ` · 🔒 ${esc(s.lockedTime)}` : ''}`;
  return `
  <div class="stop ${s.skipped ? 'skipped' : ''} ${t.lateMin ? 'late' : ''} ${unselectedDinner ? 'placeholder' : ''}" data-stop-card="${s.uid}">
    <div class="stop-line">
      <span class="num"><i style="--c:${dayColor(dayIdx)}">${i + 1}</i></span>
      <div class="stop-title">
        <div class="t">${icon} ${name}</div>
        <div class="sub">${sub}</div>
        ${warns.length ? `<div class="warn-line">⚠ ${esc(warns[0])}${warns.length > 1 ? ` (+${warns.length - 1})` : ''}</div>` : ''}
      </div>
      ${unselectedDinner && !s.skipped ? `<button class="btn sm primary" data-act="dinner-options" data-day="${day.id}" data-stop="${s.uid}">เลือกร้าน</button>` : ''}
      <button class="icon-btn" data-act="toggle-expand" data-stop="${s.uid}" aria-expanded="${open}" aria-label="แก้ไขรายการ">${open ? '▴' : '⋯'}</button>
    </div>
    ${
      open
        ? `<div class="stop-more">
      <div class="field-row">
        <label>อยู่ <input class="inp xs" type="number" min="0" step="5" value="${s.stayMin}" data-act-change="stop-field" data-field="stayMin" data-day="${day.id}" data-stop="${s.uid}" aria-label="ระยะเวลาแวะ (นาที)"> นาที</label>
        <label>นัดเวลา 🔒 <input class="inp xs" type="time" value="${esc(s.lockedTime ?? '')}" data-act-change="stop-field" data-field="lockedTime" data-day="${day.id}" data-stop="${s.uid}" aria-label="เวลานัดที่ล็อก"></label>
      </div>
      ${warns.length > 1 ? `<ul class="warns">${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${p?.coordStatus === 'area-center' ? '<p class="muted small">หมุดกลางย่าน/จุดรวมอาคาร — อาจต้องเดินต่อถึงร้านจริง</p>' : ''}
      <label class="block small">หมายเหตุ <textarea class="inp" rows="2" maxlength="500" data-act-change="stop-field" data-field="note" data-day="${day.id}" data-stop="${s.uid}">${esc(s.note)}</textarea></label>
      ${s.kind === 'break' || s.kind === 'buffer' ? `<label class="block small">ชื่อรายการ <input class="inp" value="${esc(s.title ?? '')}" maxlength="80" data-act-change="stop-field" data-field="title" data-day="${day.id}" data-stop="${s.uid}"></label>` : ''}
      <div class="row-btns">
        <button class="btn sm" data-act="stop-up" data-day="${day.id}" data-stop="${s.uid}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑ ขึ้น</button>
        <button class="btn sm" data-act="stop-down" data-day="${day.id}" data-stop="${s.uid}" ${i === total - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓ ลง</button>
        ${s.kind === 'dinner' ? `<button class="btn sm" data-act="dinner-options" data-day="${day.id}" data-stop="${s.uid}">${p ? 'เปลี่ยนร้าน' : 'เลือกร้าน'}</button><button class="btn sm" data-act="stop-skip" data-day="${day.id}" data-stop="${s.uid}">${s.skipped ? 'ไม่ข้าม' : 'ข้ามมื้อนี้'}</button>` : ''}
        ${isFood && p ? `<button class="btn sm" data-act="nearby" data-want="shop" data-day="${day.id}" data-stop="${s.uid}">ช็อปใกล้ร้านนี้</button>` : ''}
        ${isShop ? `<button class="btn sm" data-act="nearby" data-want="eat" data-day="${day.id}" data-stop="${s.uid}">กินใกล้จุดนี้</button>` : ''}
        ${p ? `<button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}">แผนที่</button><a class="btn sm" target="_blank" rel="noopener" href="${esc(gmapsPlaceUrl(p))}">Google Maps ↗</a>` : ''}
        <button class="btn sm danger" data-act="stop-remove" data-day="${day.id}" data-stop="${s.uid}">ลบ</button>
      </div>
    </div>`
        : ''
    }
  </div>`;
}

export function renderDayPanel(day: Day): string {
  const s = app.schedule(day);
  const idx = app.dayIndex(day.id);
  const start = app.getPlace(day.startPlaceId);
  const end = app.getPlace(day.endPlaceId);
  const st = statusLine(s, day);
  const rows: string[] = [];
  rows.push(`<div class="endpoint"><span class="time">${day.startTime ? esc(day.startTime) : '--:--'}</span><span class="ep-dot" style="--c:${dayColor(idx)}"></span><span>ออกจาก <b>${esc(shortName(start))}</b></span></div>`);
  s.stops.forEach((t, i) => {
    if (!t.stop.skipped && (t.stop.kind === 'place' || t.stop.kind === 'dinner')) rows.push(legRow(day.id, t.leg, t.uid));
    rows.push(stopRow(day, t, i, s.stops.length, idx));
  });
  if (s.end) rows.push(legRow(day.id, s.end.leg, '__end'));
  rows.push(`<div class="endpoint"><span class="time">${s.end ? timeCell(s.end.arrive, s.end.lowerBound) : '--:--'}</span><span class="ep-dot end" style="--c:${dayColor(idx)}"></span><span>ถึง <b>${esc(shortName(end))}</b>${day.endTime ? ` <span class="muted small">(ต้องถึงภายใน ${esc(day.endTime)})</span>` : ''}</span></div>`);

  const trip = tripDates();
  const noDates = trip.some((t) => !app.plan.days.some((d) => d.date === t));
  return `
  ${noDates ? `<div class="notice trip">ทริป ${esc(fmtDateTh(trip[0]))} – ${esc(fmtDateTh(trip[trip.length - 1]))} (${trip.length} วัน) <button class="btn sm primary" data-act="apply-trip-dates">ตั้งวันเที่ยวให้ครบ</button></div>` : ''}
  <div class="day-head">
    <h2 style="--c:${dayColor(idx)}">วัน ${idx + 1}</h2>
  </div>
  ${settingsCard(day, idx)}
  <div class="banner ${st.cls}" role="status">${esc(st.text)}</div>
  <section class="timeline" aria-label="ตารางเวลา">
    ${rows.join('')}
  </section>
  <div class="add-row">
    <button class="btn sm primary" data-act="go-places">＋ เพิ่มสถานที่</button>
    <button class="btn sm" data-act="add-item" data-kind="break" data-day="${day.id}">＋ พัก</button>
    <button class="btn sm" data-act="add-item" data-kind="dinner" data-day="${day.id}">＋ มื้ออาหาร</button>
    <button class="btn sm" data-act="add-item" data-kind="buffer" data-day="${day.id}">＋ เวลาสำรอง</button>
    <button class="btn ghost sm" data-act="suggest-order" data-day="${day.id}">แนะนำลำดับ</button>
  </div>
  ${renderWeather(day, s, { full: true })}`;
}
