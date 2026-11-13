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
  const open = app.expanded.has(`wx:${day.id}`);
  const attribution = `<p class="attr">พยากรณ์จาก <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>)</p>`;
  const head = (extra = '') => `<div class="wx-head"><h3>อากาศ</h3>${extra}</div>`;
  if (!w || w.status === 'no-date') {
    const msg = !day.date ? 'เลือกวันที่เพื่อดูพยากรณ์อากาศ' : state?.status === 'error' ? `โหลดพยากรณ์ไม่สำเร็จ: ${esc(state.message)}` : 'กำลังโหลดพยากรณ์…';
    return `<section class="card wx">${head()}<p class="muted">${msg}</p>${day.date ? attribution : ''}</section>`;
  }
  if (w.status === 'past' || w.status === 'out-of-range') {
    return `<section class="card wx">${head()}<p>${w.status === 'past' ? 'วันนี้ผ่านไปแล้ว — ไม่มีพยากรณ์' : 'ยังไม่มีพยากรณ์สำหรับวันนี้ โปรดตรวจอีกครั้งใกล้วันเดินทาง'}</p>
      <p class="muted small">ตอนนี้มีพยากรณ์ถึง ${esc(fmtDateTh(w.lastDate))}</p>${attribution}</section>`;
  }
  const ok = w as Extract<DayWeather, { status: 'ok' }>;
  const d = ok.daily;
  const ic = wmo(d.code);
  const win = ok.window;
  const fetchedAt = state && state.status !== 'loading' && 'data' in state && state.data ? new Date(state.data.fetchedAt).toLocaleString('th-TH', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '?';
  const stale = state?.status === 'error' ? `<p class="warn-line">อัปเดตไม่ได้ — แสดงข้อมูลล่าสุดที่บันทึกไว้</p>` : '';
  let clothes = '';
  let bad = '';
  if (win) {
    const st = outdoorStats(day, s);
    const adv = clothingAdvice(win, { coldLevel: app.plan.coldLevel, walkMin: st.walkMin, outdoorMin: st.outdoorMin, windowLabel });
    const checks = app.plan.checklist[day.id] ?? {};
    const extras = app.plan.extraChecklist[day.id] ?? [];
    if (adv.badWeather) bad = `<div class="notice warn">อากาศอาจไม่เหมาะกับจุดกลางแจ้ง (${esc(adv.badWeather)}) <button class="link" data-act="indoor-options" data-day="${day.id}">ดูทางเลือกในร่ม</button></div>`;
    clothes = `
      <div class="clothes">
        <h4>แต่งตัววันนี้ <span class="muted small">· คำแนะนำจากระบบ</span></h4>
        <ul class="checklist">
          ${adv.items.map((it) => `<li><label title="${esc(it.why)}"><input type="checkbox" data-act-change="check-item" data-day="${day.id}" data-key="${esc(it.key)}" ${checks[it.key] ? 'checked' : ''}> <span>${esc(it.label)}</span></label>${open ? `<span class="muted small why">${esc(it.why)}</span>` : ''}</li>`).join('')}
          ${extras.map((x, i) => `<li><label><input type="checkbox" data-act-change="check-item" data-day="${day.id}" data-key="x:${esc(x)}" ${checks[`x:${x}`] ? 'checked' : ''}> <span>${esc(x)}</span></label><button class="icon-btn sm" data-act="remove-check" data-day="${day.id}" data-i="${i}" aria-label="ลบ">✕</button></li>`).join('')}
        </ul>
        ${open ? `<p class="muted small">${esc(adv.basis)}</p>
        <form class="add-check" data-form="add-check" data-day="${day.id}"><input class="inp sm" name="item" placeholder="เพิ่มของที่ต้องเตรียม" maxlength="80"><button class="btn sm">เพิ่ม</button></form>
        <label class="small">ระดับความขี้หนาว <select class="inp xs" data-act-change="cold-level"><option value="low" ${app.plan.coldLevel === 'low' ? 'selected' : ''}>ไม่ค่อยขี้หนาว</option><option value="normal" ${app.plan.coldLevel === 'normal' ? 'selected' : ''}>ปกติ</option><option value="high" ${app.plan.coldLevel === 'high' ? 'selected' : ''}>ขี้หนาวมาก</option></select></label>
        <p class="muted small">ไม่สรุปสภาพพื้นถนนจากอุณหภูมิ · หิมะแสดงเฉพาะเมื่อพยากรณ์ระบุ</p>` : ''}
      </div>`;
  }
  const refSel = `<label class="small">พยากรณ์ ณ <select class="inp xs" data-act-change="day-field" data-field="weatherRef" data-day="${day.id}">
      <option value="seoul" ${day.weatherRef === 'seoul' ? 'selected' : ''}>กลางกรุงโซล</option>
      ${[...new Set([day.startPlaceId, ...day.stops.map((x) => x.placeId), day.endPlaceId].filter(Boolean) as string[])]
        .map((id) => app.getPlace(id))
        .filter((p) => p && p.lat != null)
        .map((p) => `<option value="${esc(p!.id)}" ${day.weatherRef === p!.id ? 'selected' : ''}>${esc(p!.nameTh)}</option>`)
        .join('')}
    </select></label>`;
  return `<section class="card wx">
    ${head(`<button class="link small" data-act="toggle-wx" data-day="${day.id}" aria-expanded="${open}">${open ? 'ย่อ' : 'รายละเอียด'}</button>`)}
    <div class="wx-main">
      <span class="wx-ico" aria-hidden="true">${ic.icon}</span>
      <div>
        ${win ? `<div class="wx-window"><b>ช่วงที่ออกเที่ยว ${esc(windowLabel)}</b><br>รู้สึกจริง ${n(win.feelsMin, '°')} ถึง ${n(win.feelsMax, '°')}C · ฝน ${n(win.ppMax, '%')} · ลม ${n(win.windMax, '')} กม./ชม.${win.snowSum != null && win.snowSum > 0 ? ` · หิมะ ${win.snowSum} ซม.` : ''}${ok.windowPartial ? ' <span class="warn-line">(บางชั่วโมงอยู่นอกพยากรณ์)</span>' : ''}</div>` : `<div><b>${ic.th}</b> · ${n(d.tMin, '°')}–${n(d.tMax, '°')}C</div><div class="muted small">ตั้งเวลาออกเพื่อดูอากาศช่วงที่ออกเที่ยวจริง</div>`}
      </div>
    </div>
    ${bad}
    ${clothes}
    ${
      open
        ? `<div class="wx-more">
      <p class="small">ทั้งวัน: ${ic.th} · ${n(d.tMin, '°')}–${n(d.tMax, '°')}C · รู้สึกจริง ${n(d.feelsMin, '°')}–${n(d.feelsMax, '°')}C · ฝนสูงสุด ${n(d.ppMax, '%')} · ลมสูงสุด ${n(d.windMax, ' กม./ชม.')}${d.snowSum != null && d.snowSum > 0 ? ` · หิมะ ${d.snowSum} ซม.` : ''}</p>
      ${win ? `<p class="small">ช่วงเที่ยว: อุณหภูมิ ${n(win.tempMin, '°')}–${n(win.tempMax, '°')}C · ฝนรวม ${n(win.precipSum, ' มม.', 1)} · ลมกระโชก ${n(win.gustMax, ' กม./ชม.')}</p>` : ''}
      ${opts.full ? hourTable(ok.hours) : ''}
      <div class="row-btns">${opts.full ? refSel : ''}<button class="btn ghost xs" data-act="weather-refresh" data-day="${day.id}">⟳ รีเฟรช</button></div>
      <p class="muted small">ข้อมูล ณ ${esc(ref.name)} · อัปเดต ${esc(fetchedAt)} (เวลาเกาหลี)</p>
    </div>`
        : ''
    }
    ${stale}
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
