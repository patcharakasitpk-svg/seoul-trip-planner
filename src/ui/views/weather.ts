import type { Day } from '../../core/types';
import type { DaySchedule } from '../../core/schedule';
import { app } from '../app';
import { esc } from '../util';
import { wmo, type HourRow, type DayWeather } from '../../core/weather';
import { clothingAdvice } from '../../core/clothing';
import { fmtDateTh } from '../../core/time';

const n = (v: number | null, unit: string, digits = 0) => (v == null ? '<span class="muted">ไม่มีข้อมูล</span>' : `${v.toFixed(digits)}${unit}`);

export function outdoorStats(day: Day, s: DaySchedule): { walkMin: number | null; outdoorMin: number } {
  let walk = 0;
  let known = true;
  let outdoor = 0;
  const legs = [...s.stops.map((t) => t.leg), ...(s.end ? [s.end.leg] : [])];
  for (const l of legs) {
    if (l.source === 'same') continue;
    if (l.mode === 'WALKING' && l.travelMin != null) walk += l.travelMin;
    else if (l.route && l.route.status === 'ok' && l.route.walkMin != null) walk += l.route.walkMin;
    else known = false;
  }
  for (const t of s.stops) {
    const p = app.getPlace(t.stop.placeId);
    if (p && !p.indoor && !t.stop.skipped) outdoor += t.stop.stayMin;
  }
  void day;
  return { walkMin: known ? walk : null, outdoorMin: outdoor };
}

export function renderWeather(day: Day, s: DaySchedule, opts: { full: boolean }): string {
  const { w, ref, state, windowLabel } = app.dayWeather(day, s);
  const head = `<div class="wx-head"><h3>อากาศ ${esc(fmtDateTh(day.date))}</h3>
    <button class="btn ghost xs" data-act="weather-refresh" data-day="${day.id}" ${!day.date ? 'disabled' : ''}>⟳ รีเฟรช</button></div>`;
  const refSel = `<label class="small">จุดอ้างอิง <select class="inp xs" data-act-change="day-field" data-field="weatherRef" data-day="${day.id}">
      <option value="seoul" ${day.weatherRef === 'seoul' ? 'selected' : ''}>กลางกรุงโซล</option>
      ${[...new Set([day.startPlaceId, ...day.stops.map((x) => x.placeId), day.endPlaceId].filter(Boolean) as string[])]
        .map((id) => app.getPlace(id))
        .filter((p) => p && p.lat != null)
        .map((p) => `<option value="${esc(p!.id)}" ${day.weatherRef === p!.id ? 'selected' : ''}>${esc(p!.nameTh)}</option>`)
        .join('')}
    </select></label>`;
  const attribution = `<p class="attr small muted">ข้อมูลพยากรณ์: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>) · แปลงหน่วย/สรุปช่วงเวลาโดยแอปนี้</p>`;
  if (!w || w.status === 'no-date') {
    return `<section class="card wx">${head}<p class="notice">${!day.date ? 'เลือกวันที่เพื่อดูพยากรณ์อากาศ' : state?.status === 'error' ? `โหลดพยากรณ์ไม่สำเร็จ: ${esc(state.message)}` : 'กำลังโหลดพยากรณ์…'}</p>${attribution}</section>`;
  }
  if (w.status === 'past' || w.status === 'out-of-range') {
    return `<section class="card wx">${head}<p class="notice">${w.status === 'past' ? 'วันนี้ผ่านไปแล้ว — ไม่มีพยากรณ์' : 'ยังไม่มีพยากรณ์สำหรับวันนี้ โปรดตรวจอีกครั้งใกล้วันเดินทาง'}</p>
      <p class="muted small">ช่วงพยากรณ์ที่มีตอนนี้: ${esc(w.firstDate ?? '?')} ถึง ${esc(w.lastDate ?? '?')} (เวลาเกาหลี)</p>${attribution}</section>`;
  }
  const ok = w as Extract<DayWeather, { status: 'ok' }>;
  const d = ok.daily;
  const ic = wmo(d.code);
  const fetchedAt = state && state.status !== 'loading' && 'data' in state && state.data ? new Date(state.data.fetchedAt).toLocaleString('th-TH', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '?';
  const staleNote = state?.status === 'error' ? `<p class="warn-text small">อัปเดตไม่ได้ (${esc(state.message)}) — แสดงข้อมูลที่บันทึกไว้ล่าสุด</p>` : state?.status === 'ok' && state.stale ? '<p class="muted small">ข้อมูลเก่ากว่า 1 ชม. กำลังอัปเดต…</p>' : '';
  const win = ok.window;
  const hoursTable = opts.full && ok.hours.length ? hourTable(ok.hours) : '';
  let clothes = '';
  if (win) {
    const st = outdoorStats(day, s);
    const adv = clothingAdvice(win, { coldLevel: app.plan.coldLevel, walkMin: st.walkMin, outdoorMin: st.outdoorMin, windowLabel });
    const checks = app.plan.checklist[day.id] ?? {};
    const extras = app.plan.extraChecklist[day.id] ?? [];
    clothes = `
      <div class="clothes">
        <h4>👕 แต่งตัวอย่างไรวันนี้ <span class="pill warn">คำแนะนำที่ระบบอนุมาน</span></h4>
        <p class="muted small">${esc(adv.basis)}</p>
        <label class="small">ระดับความขี้หนาว
          <select class="inp xs" data-act-change="cold-level"><option value="low" ${app.plan.coldLevel === 'low' ? 'selected' : ''}>ไม่ค่อยขี้หนาว</option><option value="normal" ${app.plan.coldLevel === 'normal' ? 'selected' : ''}>ปกติ</option><option value="high" ${app.plan.coldLevel === 'high' ? 'selected' : ''}>ขี้หนาวมาก</option></select>
        </label>
        <ul class="checklist">
          ${adv.items.map((it) => `<li><label><input type="checkbox" data-act-change="check-item" data-day="${day.id}" data-key="${esc(it.key)}" ${checks[it.key] ? 'checked' : ''}> <span>${esc(it.label)}</span></label><span class="muted small">${esc(it.why)}</span></li>`).join('')}
          ${extras.map((x, i) => `<li><label><input type="checkbox" data-act-change="check-item" data-day="${day.id}" data-key="x:${esc(x)}" ${checks[`x:${x}`] ? 'checked' : ''}> <span>${esc(x)}</span></label><button class="icon-btn xs" data-act="remove-check" data-day="${day.id}" data-i="${i}" aria-label="ลบ">✕</button></li>`).join('')}
        </ul>
        <form class="add-check" data-form="add-check" data-day="${day.id}"><input class="inp sm" name="item" placeholder="เพิ่มรายการเอง เช่น พาวเวอร์แบงก์" maxlength="80"><button class="btn sm">เพิ่ม</button></form>
        ${adv.badWeather ? `<div class="notice warn">อากาศอาจไม่เหมาะกับจุดกลางแจ้ง (${esc(adv.badWeather)}) <button class="btn sm" data-act="indoor-options" data-day="${day.id}">ดูทางเลือกในร่ม</button></div>` : ''}
        <p class="muted small">ไม่สรุปสภาพพื้นถนนจากอุณหภูมิ · หิมะแสดงเฉพาะเมื่อพยากรณ์ระบุ</p>
      </div>`;
  }
  return `<section class="card wx">${head}
    <div class="wx-main">
      <span class="wx-ico" aria-hidden="true">${ic.icon}</span>
      <div>
        <div><b>${ic.th}</b> · สูงสุด–ต่ำสุด ${n(d.tMax, '°')} / ${n(d.tMin, '°')}C</div>
        <div class="small">รู้สึกจริง ${n(d.feelsMax, '°')} / ${n(d.feelsMin, '°')}C · โอกาสฝน ${n(d.ppMax, '%')} · ลมสูงสุด ${n(d.windMax, ' กม./ชม.')}${d.snowSum != null && d.snowSum > 0 ? ` · หิมะ ${d.snowSum} ซม.` : ''}</div>
      </div>
    </div>
    ${win ? `<div class="wx-window"><b>ช่วงที่ออกเที่ยว ${esc(windowLabel)}</b>: รู้สึกจริง ${n(win.feelsMin, '°')} ถึง ${n(win.feelsMax, '°')}C · อุณหภูมิ ${n(win.tempMin, '°')}–${n(win.tempMax, '°')}C · โอกาสฝนสูงสุด ${n(win.ppMax, '%')} · ฝนรวม ${n(win.precipSum, ' มม.', 1)} · ลม ${n(win.windMax, '')}/กระโชก ${n(win.gustMax, ' กม./ชม.')}${win.snowSum != null && win.snowSum > 0 ? ` · หิมะ ${win.snowSum} ซม.` : ''}${ok.windowPartial ? '<br><span class="warn-text small">บางชั่วโมงของช่วงเที่ยวอยู่นอกข้อมูลพยากรณ์</span>' : ''}</div>` : `<p class="muted small">กำหนดเวลาออกเพื่อดูอากาศช่วงที่ออกเที่ยวจริง</p>`}
    ${opts.full ? refSel : ''}
    ${hoursTable}
    <p class="muted small">ข้อมูลพยากรณ์ ณ ${esc(ref.name)} · ผู้ให้บริการ Open-Meteo · อัปเดต ${esc(fetchedAt)} (เวลาเกาหลี)</p>
    ${staleNote}
    ${clothes}
    ${attribution}
  </section>`;
}

function hourTable(hours: HourRow[]): string {
  return `<div class="hours" role="table" aria-label="พยากรณ์รายชั่วโมง">${hours
    .map(
      (h) => `<div class="hr" role="row"><span>${esc(h.label)}</span><span>${wmo(h.code).icon}</span><span>${h.temp == null ? '–' : Math.round(h.temp) + '°'}</span><span class="muted">รู้สึก ${h.feels == null ? '–' : Math.round(h.feels) + '°'}</span><span>☔ ${h.pp == null ? '–' : h.pp + '%'}</span><span class="muted">💨 ${h.wind == null ? '–' : Math.round(h.wind)}</span></div>`,
    )
    .join('')}</div>`;
}
