import type { Day, Place, Stop } from '../../core/types';
import type { DaySchedule, StopTiming } from '../../core/schedule';
import { app } from '../app';
import { dayColor, esc, gmapsPlaceUrl, photosUrl, naverBtn, naverPlaceUrl } from '../util';
import { MEALS, mealIcon, mealName, mealOf, type Meal } from '../../core/meals';
import { fmtDateTh, fmtDur, fmtHM } from '../../core/time';
import { legRow } from './leg';
import { renderWeather } from './weather';
import { CATEGORY_ICON } from '../../data/places';
import { tripDates, tripSetupNeeded } from '../../core/planOps';

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

const shortName = (p: Place | undefined) => (p ? (p.id === 'hotel' ? 'โรงแรม' : p.id === 'coex' ? 'COEX' : p.id === 'novotel-suwon' ? 'Novotel ซูวอน' : p.id === 'icn' ? 'สนามบินอินชอน T1' : p.nameTh) : '?');

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
      ${app.getPlace('novotel-suwon') ? `<button class="chip" data-act="quick" data-field="endPlaceId" data-v="novotel-suwon" data-day="${day.id}">นอน Novotel ซูวอน</button><button class="chip" data-act="quick" data-field="startPlaceId" data-v="novotel-suwon" data-day="${day.id}">ออกจาก Novotel ซูวอน</button>` : ''}
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

function stopName(s: Stop, p: Place | undefined): string {
  if (s.kind === 'dinner') return p ? esc(p.nameTh) : `${mealName(s)} <span class="muted small">· ยังไม่เลือกร้าน</span>`;
  if (s.kind === 'break') return esc(s.title || 'พัก');
  if (s.kind === 'buffer') return esc(s.title || 'เวลาสำรอง');
  return esc(p?.nameTh ?? 'สถานที่ไม่ทราบ');
}

function stopIcon(s: Stop, p: Place | undefined): string {
  return s.kind === 'dinner' ? mealIcon(s) : s.kind === 'break' ? '☕' : s.kind === 'buffer' ? '⏳' : (CATEGORY_ICON[p?.category ?? 'base'] ?? '📍');
}

/** แถวจุดแวะแบบย่อ: ชื่อ · ช่วงเวลา · อยู่นานเท่าไร · คำเตือนสำคัญ — แก้ไขทั้งหมดใน ⓘ */
function stopRow(day: Day, t: StopTiming, i: number, _total: number, dayIdx: number): string {
  const s = t.stop;
  const p = app.getPlace(s.placeId);
  const unselected = s.kind === 'dinner' && !p;
  const warns = t.warnings.filter((w) => w !== 'ยังไม่ได้เลือกร้าน' && !w.startsWith('หมุดกลางย่าน'));
  const when = s.skipped
    ? 'ข้ามแล้ว'
    : t.start != null && t.depart != null
      ? `${t.lowerBound ? '≥' : ''}${fmtHM(t.arrive ?? t.start)}–${fmtHM(t.depart)} · อยู่ ${fmtDur(s.stayMin)}`
      : `อยู่ ${fmtDur(s.stayMin)}`;
  return `
  <div class="stop ${s.skipped ? 'skipped' : ''} ${t.lateMin ? 'late' : ''} ${unselected ? 'placeholder' : ''}" data-stop-card="${s.uid}">
    <div class="stop-line">
      <span class="num"><i style="--c:${dayColor(dayIdx)}">${i + 1}</i></span>
      <div class="stop-title">
        <div class="t">${stopIcon(s, p)} ${stopName(s, p)}</div>
        <div class="sub">${when}${s.lockedTime ? ` · 🔒 ${esc(s.lockedTime)}` : ''}${t.wait ? ` · รอ ${fmtDur(t.wait)}` : ''}</div>
        ${warns.length ? `<div class="warn-line">⚠ ${esc(warns[0])}</div>` : ''}
        ${s.note ? `<p class="stop-note">${esc(s.note)}</p>` : ''}
      </div>
      ${unselected && !s.skipped ? `<button class="btn sm primary" data-act="dinner-options" data-day="${day.id}" data-stop="${s.uid}">เลือกร้าน</button>` : ''}
      <button class="icon-btn info" data-act="stop-info" data-day="${day.id}" data-stop="${s.uid}" aria-label="รายละเอียด / แก้ไข ${stopName(s, p).replace(/<[^>]+>/g, '')}">ⓘ</button>
    </div>
  </div>`;
}

/** หน้าต่าง ⓘ ของจุดแวะ: แก้เวลาอยู่ นัด มื้อ โน้ต ย้ายวัน ลำดับ ลบ และเปิดแผนที่ */
export function stopInfoBody(day: Day, t: StopTiming, i: number, total: number): string {
  const s = t.stop;
  const p = app.getPlace(s.placeId);
  const isShop = p && (p.category === 'fashion' || p.category === 'beauty' || p.category === 'market');
  const isFood = p && (p.category === 'food' || s.kind === 'dinner');
  return `
    <p class="sub">${t.start != null && t.depart != null ? `${t.lowerBound ? '≥' : ''}${fmtHM(t.arrive ?? t.start)} ถึง · ออก ${fmtHM(t.depart)}` : 'ยังไม่มีเวลา'}</p>
    ${t.warnings.length ? `<ul class="warns">${t.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${
      s.kind === 'dinner'
        ? `<div class="seg meal-seg" role="radiogroup" aria-label="มื้อ">${(Object.keys(MEALS) as Meal[]).map((m) => `<button class="${mealOf(s) === m ? 'on' : ''}" data-act="meal-set" data-day="${day.id}" data-stop="${s.uid}" data-v="${m}" role="radio" aria-checked="${mealOf(s) === m}">${MEALS[m].icon} ${MEALS[m].th.replace('มื้อ', '')}</button>`).join('')}</div>
           <div class="row-btns"><button class="btn sm primary" data-act="dinner-options" data-day="${day.id}" data-stop="${s.uid}">${p ? 'เปลี่ยนร้าน' : 'เลือกร้าน'}</button><button class="btn sm" data-act="stop-skip" data-day="${day.id}" data-stop="${s.uid}">${s.skipped ? 'ไม่ข้าม' : 'ข้ามมื้อนี้'}</button></div>`
        : ''
    }
    <div class="field-row">
      <label>อยู่ <input class="inp xs" type="number" min="0" step="5" value="${s.stayMin}" data-act-change="stop-field" data-field="stayMin" data-day="${day.id}" data-stop="${s.uid}" aria-label="ระยะเวลาแวะ (นาที)"> นาที</label>
      <label>นัดเวลา 🔒 <input class="inp xs" type="time" value="${esc(s.lockedTime ?? '')}" data-act-change="stop-field" data-field="lockedTime" data-day="${day.id}" data-stop="${s.uid}" aria-label="เวลานัดที่ล็อก"></label>
    </div>
    ${p?.coordStatus === 'area-center' ? '<p class="muted small">หมุดกลางย่าน/จุดรวมอาคาร — อาจต้องเดินต่อถึงร้านจริง</p>' : p?.coordStatus === 'approx' ? '<p class="muted small">พิกัดจากแหล่งเดียว (หมุดเส้นประ) — เช็กใน Google Maps ก่อนไป</p>' : ''}
    <form class="note-form" data-form="stop-note" data-day="${day.id}" data-stop="${s.uid}">
      <label class="block small">โน้ต: จะไปทำอะไรที่นี่<textarea class="inp" name="note" rows="3" maxlength="500" placeholder="เช่น ซื้อ… / กินเมนู… / ถ่ายรูปที่…">${esc(s.note)}</textarea></label>
      <button class="btn sm primary">บันทึกโน้ต</button>
    </form>
    ${s.kind === 'break' || s.kind === 'buffer' ? `<label class="block small">ชื่อรายการ <input class="inp" value="${esc(s.title ?? '')}" maxlength="80" data-act-change="stop-field" data-field="title" data-day="${day.id}" data-stop="${s.uid}"></label>` : ''}
    ${p ? `<div class="nav-row">${naverBtn(naverPlaceUrl(p), '🟢 Naver', 'btn')}<a class="btn" target="_blank" rel="noopener" href="${esc(gmapsPlaceUrl(p))}">🧭 Google</a><a class="btn" target="_blank" rel="noopener" href="${esc(photosUrl(p))}" aria-label="ดูรูป">📷</a></div>` : ''}
    <div class="row-btns">
      <button class="btn sm" data-act="stop-up" data-day="${day.id}" data-stop="${s.uid}" ${i === 0 ? 'disabled' : ''}>↑ ขึ้น</button>
      <button class="btn sm" data-act="stop-down" data-day="${day.id}" data-stop="${s.uid}" ${i === total - 1 ? 'disabled' : ''}>↓ ลง</button>
      <select class="inp sm" data-act-change="stop-move-day" data-day="${day.id}" data-stop="${s.uid}" aria-label="ย้ายไปวันอื่น"><option value="">ย้ายไปวัน…</option>${app.plan.days.map((dd, k) => (dd.id === day.id ? '' : `<option value="${dd.id}">วัน ${k + 1}${dd.date ? ` · ${esc(fmtDateTh(dd.date))}` : ''}</option>`)).join('')}</select>
      ${isFood && p ? `<button class="btn sm" data-act="nearby" data-want="shop" data-day="${day.id}" data-stop="${s.uid}">ช็อปใกล้ ๆ</button>` : ''}
      ${isShop ? `<button class="btn sm" data-act="nearby" data-want="eat" data-day="${day.id}" data-stop="${s.uid}">กินใกล้ ๆ</button>` : ''}
    </div>
    <div class="modal-actions"><button class="btn danger" data-act="stop-remove" data-day="${day.id}" data-stop="${s.uid}">ลบออกจากวันนี้</button><button class="btn primary" data-act="modal-close">เสร็จ</button></div>`;
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
  const noDates = tripSetupNeeded(app.plan);
  return `
  ${noDates ? `<div class="notice trip">ทริป ${esc(fmtDateTh(trip[0]))} – ${esc(fmtDateTh(trip[trip.length - 1]))} (${trip.length} วัน) · ถึงอินชอน T1 30 พ.ย. 06:55 · คืน 5 ธ.ค. นอน Novotel ซูวอน · บินกลับ 6 ธ.ค. 17:00 <button class="btn sm primary" data-act="apply-trip-dates">ตั้งวันเที่ยวให้ครบ</button></div>` : ''}
  <button class="btn primary planner-open-btn" data-act="open-planner" data-day="${day.id}">จัดแผนวันนี้แบบขั้นตอน</button>
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
