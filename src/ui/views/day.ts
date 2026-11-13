import type { Day, Place } from '../../core/types';
import type { DaySchedule, StopTiming } from '../../core/schedule';
import { app } from '../app';
import { dayColor, esc, gmapsPlaceUrl } from '../util';
import { fmtDateTh, fmtDur, fmtHM } from '../../core/time';
import { legRow } from './leg';
import { renderWeather } from './weather';
import { CATEGORY_ICON } from '../../data/places';

export function renderDayTabs(): string {
  return `<div class="day-tabs" role="tablist">
    ${app.plan.days
      .map(
        (d, i) => `<button role="tab" class="day-tab ${d.id === app.activeDayId ? 'on' : ''}" style="--c:${dayColor(i)}" data-act="select-day" data-day="${d.id}" aria-selected="${d.id === app.activeDayId}">
        <b>วัน ${i + 1}</b><span>${d.date ? esc(fmtDateTh(d.date).replace(/ \d{4}$/, '')) : 'ยังไม่เลือกวัน'}</span></button>`,
      )
      .join('')}
    <button class="day-tab add" data-act="add-day" aria-label="เพิ่มวัน">＋ วัน</button>
  </div>`;
}

export function placeOptions(selected: string | null, allowNone = true): string {
  const ps = app.places().filter((p) => p.lat != null);
  const group = (label: string, list: Place[]) => (list.length ? `<optgroup label="${label}">${list.map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? 'selected' : ''}>${esc(p.nameTh)}</option>`).join('')}</optgroup>` : '');
  return `${allowNone ? `<option value="" ${!selected ? 'selected' : ''}>— ยังไม่เลือก —</option>` : ''}
    ${group('จุดหลัก', ps.filter((p) => p.kind === 'hotel' || p.kind === 'venue'))}
    ${group('สถานที่อื่น', ps.filter((p) => !(p.kind === 'hotel' || p.kind === 'venue')))}`;
}

function statusBanner(s: DaySchedule, day: Day): string {
  const end = s.end;
  let main = '';
  if (s.status === 'no-time') main = '<b>ยังประเมินเวลาไม่ได้</b> — กรอกเวลาออกเพื่อคำนวณตาราง';
  else if (end && end.arrive != null) {
    const arr = `${end.lowerBound ? 'อย่างเร็ว ' : ''}${fmtHM(end.arrive)}`;
    if (end.slackMin != null) main = end.slackMin >= 0 ? `ถึง${esc(app.getPlace(day.endPlaceId)?.nameTh ?? 'จุดสิ้นสุด')} ${arr} · <b class="ok-text">เหลือเวลา ${fmtDur(end.slackMin)}</b>` : `ถึง ${arr} · <b class="bad-text">เกินเวลาที่ต้องการ ${fmtDur(-end.slackMin)}</b>`;
    else main = `ถึง${esc(app.getPlace(day.endPlaceId)?.nameTh ?? 'จุดสิ้นสุด')} ${arr}${end.lowerBound ? ' · <b class="warn-text">ยังสรุปไม่ได้ว่าทัน</b>' : day.endTime ? '' : ' (ยังไม่กำหนดเวลาที่ต้องการถึง)'}`;
  }
  const cls = s.status === 'ok' ? 'ok' : s.status === 'late' ? 'bad' : 'warn';
  return `<div class="banner ${cls}" role="status">${main ? `<div>${main}</div>` : ''}
    ${s.totalTravelMin != null ? `<div class="small">เดินทางรวม ${fmtDur(s.totalTravelMin)} + เวลาเผื่อ ${fmtDur(s.totalBufferMin)}</div>` : ''}
    ${s.messages.map((m) => `<div class="small">• ${esc(m)}</div>`).join('')}</div>`;
}

function timeCell(t: number | null, lower: boolean) {
  return t == null ? '<span class="muted">--:--</span>' : `${lower ? '<span class="lb" title="อย่างเร็ว — มีช่วงก่อนหน้าที่ไม่มีข้อมูล">≥</span>' : ''}${fmtHM(t)}`;
}

function stopCard(day: Day, t: StopTiming, i: number, total: number, dayIdx: number): string {
  const s = t.stop;
  const p = app.getPlace(s.placeId);
  const expanded = app.expanded.has(s.uid);
  const title =
    s.kind === 'dinner'
      ? p
        ? `🍽️ มื้อเย็น — ${esc(p.nameTh)}`
        : '🍽️ มื้อเย็น — <span class="muted">ยังไม่ได้เลือกร้าน</span>'
      : s.kind === 'break'
        ? `☕ ${esc(s.title || 'พัก')}`
        : s.kind === 'buffer'
          ? `⏳ ${esc(s.title || 'เวลาสำรอง')}`
          : `${CATEGORY_ICON[p?.category ?? 'base'] ?? '📍'} ${esc(p?.nameTh ?? 'สถานที่ไม่ทราบ')}`;
  const isShop = p && (p.category === 'fashion' || p.category === 'beauty' || p.category === 'market');
  const isFood = p && (p.category === 'food' || s.kind === 'dinner');
  return `
  <div class="stop ${s.skipped ? 'skipped' : ''} ${t.lateMin ? 'late' : ''}" data-stop-card="${s.uid}">
    <div class="stop-head">
      <span class="num" style="background:${dayColor(dayIdx)}">${i + 1}</span>
      <div class="stop-title">
        <div class="t">${title}</div>
        <div class="times small">${s.skipped ? 'ข้ามแล้ว' : `ถึง ${timeCell(t.arrive, t.lowerBound)}${t.wait ? ` · รอ ${fmtDur(t.wait)}` : ''} · อยู่ ${timeCell(t.start, t.lowerBound)}–${timeCell(t.depart, t.lowerBound)}`}${s.lockedTime ? ` · 🔒 นัด ${esc(s.lockedTime)}` : ''}</div>
      </div>
      <div class="stop-move">
        <button class="icon-btn" data-act="stop-up" data-day="${day.id}" data-stop="${s.uid}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
        <button class="icon-btn" data-act="stop-down" data-day="${day.id}" data-stop="${s.uid}" ${i === total - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
      </div>
    </div>
    ${t.warnings.length ? `<ul class="warns">${t.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="stop-quick">
      <label>แวะ <input class="inp xs" type="number" min="0" step="5" value="${s.stayMin}" data-act-change="stop-field" data-field="stayMin" data-day="${day.id}" data-stop="${s.uid}" aria-label="ระยะเวลาแวะ (นาที)"> นาที</label>
      <label>นัด 🔒 <input class="inp xs" type="time" value="${esc(s.lockedTime ?? '')}" data-act-change="stop-field" data-field="lockedTime" data-day="${day.id}" data-stop="${s.uid}" aria-label="เวลานัดที่ล็อก"></label>
      <button class="btn ghost xs" data-act="toggle-expand" data-stop="${s.uid}" aria-expanded="${expanded}">${expanded ? 'ซ่อน' : 'เพิ่มเติม'}</button>
    </div>
    ${s.kind === 'dinner' ? `<div class="stop-actions"><button class="btn sm primary" data-act="dinner-options" data-day="${day.id}" data-stop="${s.uid}">${p ? 'เปลี่ยนร้าน' : 'เลือกร้าน'}</button><button class="btn sm" data-act="stop-skip" data-day="${day.id}" data-stop="${s.uid}">${s.skipped ? 'ยกเลิกการข้าม' : 'ข้ามมื้อนี้'}</button></div>` : ''}
    ${
      expanded
        ? `<div class="stop-more">
      <label class="block small">หมายเหตุ <textarea class="inp" rows="2" maxlength="500" data-act-change="stop-field" data-field="note" data-day="${day.id}" data-stop="${s.uid}">${esc(s.note)}</textarea></label>
      ${s.kind === 'break' || s.kind === 'buffer' ? `<label class="block small">ชื่อรายการ <input class="inp" value="${esc(s.title ?? '')}" maxlength="80" data-act-change="stop-field" data-field="title" data-day="${day.id}" data-stop="${s.uid}"></label>` : ''}
      <div class="stop-actions">
        ${p ? `<button class="btn sm" data-act="focus-place" data-place="${esc(p.id)}">📍 หมุด</button><a class="btn sm" target="_blank" rel="noopener" href="${esc(gmapsPlaceUrl(p))}">Google Maps ↗</a>` : ''}
        ${isFood && p ? `<button class="btn sm" data-act="nearby" data-want="shop" data-day="${day.id}" data-stop="${s.uid}">🛍️ ช็อปใกล้ร้านนี้</button>` : ''}
        ${isShop ? `<button class="btn sm" data-act="nearby" data-want="eat" data-day="${day.id}" data-stop="${s.uid}">🍜 กินใกล้จุดนี้</button>` : ''}
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
  const rows: string[] = [];
  rows.push(`<div class="endpoint start"><span class="dot" style="background:${dayColor(idx)}">▶</span><div><b>ออกจาก ${esc(start?.nameTh ?? 'ยังไม่เลือกจุดเริ่ม')}</b><div class="small">${day.startTime ? `เวลา ${esc(day.startTime)}` : '<span class="warn-text">ยังไม่กำหนดเวลาออก</span>'}</div></div></div>`);
  s.stops.forEach((t, i) => {
    if (!t.stop.skipped && (t.stop.kind === 'place' || t.stop.kind === 'dinner')) rows.push(legRow(day.id, t.leg, t.uid));
    rows.push(stopCard(day, t, i, s.stops.length, idx));
  });
  if (s.end) rows.push(legRow(day.id, s.end.leg, '__end'));
  rows.push(`<div class="endpoint end"><span class="dot" style="background:${dayColor(idx)}">■</span><div><b>สิ้นสุดที่ ${esc(end?.nameTh ?? 'ยังไม่เลือกจุดสิ้นสุด')}</b><div class="small">ถึง ${s.end ? timeCell(s.end.arrive, s.end.lowerBound) : '--:--'}${day.endTime ? ` · ต้องการถึง ${esc(day.endTime)}` : ''}</div></div></div>`);

  return `
  <section class="card day-settings" aria-label="ตั้งค่าวัน">
    <div class="ds-head"><h2 style="--c:${dayColor(idx)}">วัน ${idx + 1}</h2>
      <button class="btn ghost xs danger" data-act="remove-day" data-day="${day.id}" ${app.plan.days.length <= 1 ? 'disabled' : ''}>ลบวันนี้</button></div>
    <div class="grid2">
      <label>วันที่ <input class="inp" type="date" value="${esc(day.date ?? '')}" data-act-change="day-field" data-field="date" data-day="${day.id}"></label>
      <label>เวลาเผื่อต่อช่วง (นาที) <input class="inp" type="number" min="0" max="120" step="1" value="${day.bufferMin}" data-act-change="day-field" data-field="bufferMin" data-day="${day.id}"></label>
      <label>จุดเริ่ม <select class="inp" data-act-change="day-field" data-field="startPlaceId" data-day="${day.id}">${placeOptions(day.startPlaceId)}</select></label>
      <label>เวลาออก <input class="inp" type="time" value="${esc(day.startTime ?? '')}" data-act-change="day-field" data-field="startTime" data-day="${day.id}"></label>
      <label>จุดสิ้นสุด <select class="inp" data-act-change="day-field" data-field="endPlaceId" data-day="${day.id}">${placeOptions(day.endPlaceId)}</select></label>
      <label>ต้องการถึงภายใน <input class="inp" type="time" value="${esc(day.endTime ?? '')}" data-act-change="day-field" data-field="endTime" data-day="${day.id}"></label>
    </div>
    <div class="quick">
      <span class="small muted">ตัวเลือกด่วน:</span>
      <button class="chip" data-act="quick" data-field="startPlaceId" data-v="hotel" data-day="${day.id}">เริ่มโรงแรม</button>
      <button class="chip" data-act="quick" data-field="startPlaceId" data-v="coex" data-day="${day.id}">เริ่ม COEX</button>
      <button class="chip" data-act="quick" data-field="endPlaceId" data-v="hotel" data-day="${day.id}">จบโรงแรม</button>
      <button class="chip" data-act="quick" data-field="endPlaceId" data-v="coex" data-day="${day.id}">จบ COEX</button>
    </div>
    <div class="prefs">
      <label><input type="checkbox" data-act-change="day-pref" data-field="lessWalking" data-day="${day.id}" ${day.prefs.lessWalking ? 'checked' : ''}> เดินน้อย</label>
      <label><input type="checkbox" data-act-change="day-pref" data-field="fewerTransfers" data-day="${day.id}" ${day.prefs.fewerTransfers ? 'checked' : ''}> เปลี่ยนสายน้อย</label>
      <label><input type="checkbox" data-act-change="day-pref" data-field="fastest" data-day="${day.id}" ${day.prefs.fastest ? 'checked' : ''}> ถึงเร็ว</label>
      <label><input type="checkbox" data-act-change="day-field" data-field="afterBooth" data-day="${day.id}" ${day.afterBooth ? 'checked' : ''}> เพิ่งเลิกออกบูธ</label>
    </div>
  </section>
  ${statusBanner(s, day)}
  <section class="card timeline" aria-label="ตารางเวลา">
    <div class="tl-head"><h3>ตารางเวลา</h3><button class="btn sm" data-act="suggest-order" data-day="${day.id}">แนะนำลำดับเดินทาง</button></div>
    ${rows.join('')}
    <div class="add-row">
      <button class="btn sm" data-act="go-places">＋ สถานที่</button>
      <button class="btn sm" data-act="add-item" data-kind="break" data-day="${day.id}">＋ พัก</button>
      <button class="btn sm" data-act="add-item" data-kind="dinner" data-day="${day.id}">＋ มื้ออาหาร</button>
      <button class="btn sm" data-act="add-item" data-kind="buffer" data-day="${day.id}">＋ เวลาสำรอง</button>
    </div>
    <p class="muted small legend-src">สถานะเวลาเดินทาง: <span class="pill src service">จากบริการ</span> <span class="pill src user">ผู้ใช้กำหนด</span> <span class="pill src estimate">ประมาณการ</span> <span class="pill src none">ยังไม่มีข้อมูล</span> · ≥ = อย่างเร็ว (มีช่วงที่ไม่มีข้อมูล)</p>
  </section>
  ${renderWeather(day, s, { full: true })}`;
}
