import { app } from '../app';
import { esc, gmapsDirUrl, MODE_ICON, photosUrl, naverBtn, naverRouteUrl, dayColor, naverLabel, googleLabel, dayDate } from '../util';
import { fmtDateTh, fmtDur, fmtHM, parseHM, seoulNow } from '../../core/time';
import { renderWeather } from './weather';
import { livePhase, type DaySchedule, type LegInfo, type StopTiming } from '../../core/schedule';
import { legTransitHint } from './transit';
import type { Day, Place } from '../../core/types';
import { mealName } from '../../core/meals';
import { legSummary, straightDist } from './leg';
import { effectiveMode } from '../../core/geo';

/**
 * หน้า "วันนี้" สำหรับระหว่างเดินทาง: ตอนนี้อยู่ไหน → ไปไหนต่อ ไปยังไง ใช้เวลาเท่าไร อยู่ได้อีกนานแค่ไหน
 * เช็กอิน "ถึงแล้ว/ออกแล้ว" → คำนวณเวลาที่เหลือทั้งวันใหม่จากเวลาจริง
 */

const travelText = (leg: LegInfo) =>
  leg.travelMin != null ? `${leg.source === 'auto' || leg.source === 'estimate' ? '≈ ' : ''}${fmtDur(leg.travelMin)}` : 'ไม่ทราบเวลาเดินทาง';

/** ไอคอนวิธีเดินทางที่ใช้จริง (ระยะใกล้ = เดิน) ให้ตรงกับหน้าสรุป */
const legIcon = (leg: LegInfo) => MODE_ICON[effectiveMode(leg.mode, leg.source, straightDist(leg.fromId, leg.toId))];

const stopName = (t: StopTiming) => {
  const p = app.getPlace(t.stop.placeId);
  return p?.nameTh ?? (t.stop.kind === 'dinner' ? `${mealName(t.stop)} (ยังไม่เลือกร้าน)` : t.stop.title ?? 'รายการ');
};

/** ป้ายมื้อ (เฉพาะมื้อที่เลือกร้านแล้ว — ยังไม่เลือกร้าน ชื่อบอกมื้ออยู่แล้ว) */
const mealTag = (t: StopTiming) => (t.stop.kind === 'dinner' && t.stop.placeId ? `<span class="pl-meal-tag">🍽 ${esc(mealName(t.stop))}</span> ` : '');

const shortName = (p: Place | undefined) => (p ? (p.id === 'hotel' ? 'โรงแรม' : p.nameTh) : '?');

/** ปุ่มนำทาง: Naver (รถเมล์/รถไฟ) เด่นสุด · Google · รูป */
function navRow(from: Place | undefined, to: Place | undefined, mode: LegInfo['mode']): string {
  if (!to) return '';
  return `<div class="nav-row">
    ${naverBtn(naverRouteUrl(null, to), naverLabel(), 'btn')}
    <a class="btn app-btn google" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(null, to, mode))}">${googleLabel('Google')}</a>
    ${to.category !== 'base' ? `<a class="btn" target="_blank" rel="noopener" href="${esc(photosUrl(to))}" aria-label="ดูรูป ${esc(to.nameTh)}">📷</a>` : ''}
  </div>${from && mode === 'TRANSIT' ? legTransitHint(from, to) : ''}`;
}

function locOf(day: Day, s: DaySchedule, idx: number): Place | undefined {
  // ตำแหน่งก่อนจุดที่ idx (จุดที่มีสถานที่ล่าสุด ไม่นับพัก/ร้านที่ยังไม่เลือก)
  for (let i = idx - 1; i >= 0; i--) {
    const t = s.stops[i];
    if (t.stop.skipped) continue;
    if ((t.stop.kind === 'place' || t.stop.kind === 'dinner') && t.stop.placeId) return app.getPlace(t.stop.placeId);
  }
  return app.getPlace(day.startPlaceId);
}

function heroMoving(day: Day, s: DaySchedule, t: StopTiming, live: boolean, eyebrow = 'กำลังไป'): string {
  const i = s.stops.indexOf(t);
  const to = app.getPlace(t.stop.placeId);
  const from = locOf(day, s, i);
  const isMove = t.stop.kind === 'place' || t.stop.kind === 'dinner';
  return `<section class="hero">
    <p class="eyebrow">${eyebrow}</p>
    <h2>${mealTag(t)}${esc(stopName(t))}</h2>
    <p class="hero-big">${t.arrive != null ? `ถึงประมาณ <b>${t.lowerBound ? '≥' : ''}${fmtHM(t.arrive)}</b>` : 'ยังไม่มีเวลา'}</p>
    <p class="hero-facts">${isMove ? `<span>${legIcon(t.leg)} เดินทาง <b>${travelText(t.leg)}</b></span>` : ''}<span>⏱ อยู่ <b>${fmtDur(t.stop.stayMin)}</b></span>${t.stop.lockedTime ? `<span>🔒 นัด <b>${esc(t.stop.lockedTime)}</b></span>` : ''}</p>
    ${t.stop.note ? `<p class="stop-note">${esc(t.stop.note)}</p>` : ''}
    ${isMove ? navRow(from, to, t.leg.mode) : ''}
    ${live ? `<button class="btn primary huge" data-act="live-arrive" data-stop="${t.uid}">✓ ถึงแล้ว</button>` : ''}
  </section>`;
}

function heroAt(day: Day, s: DaySchedule, t: StopTiming, now: number | null): string {
  const real = day.actual?.[t.uid];
  const arrived = parseHM(real?.a);
  const plannedOut = (t.start ?? arrived ?? 0) + t.stop.stayMin;
  const left = now != null ? plannedOut - now : null;
  const pct = arrived != null && now != null && t.stop.stayMin > 0 ? Math.min(100, Math.max(0, ((now - (t.start ?? arrived)) / t.stop.stayMin) * 100)) : 0;
  const i = s.stops.indexOf(t);
  const next = s.stops.slice(i + 1).find((x) => !x.stop.skipped);
  const nextTo = next ? app.getPlace(next.stop.placeId) : app.getPlace(day.endPlaceId);
  const here = app.getPlace(t.stop.placeId) ?? locOf(day, s, i);
  const nextLeg = next ? next.leg : s.end?.leg;
  return `<section class="hero">
    <p class="eyebrow">ตอนนี้อยู่ที่${arrived != null ? ` · ถึง ${fmtHM(arrived)}` : ''}</p>
    <h2>${mealTag(t)}${esc(stopName(t))}</h2>
    <p class="hero-big ${left != null && left < 0 ? 'bad' : ''}">${left == null ? `อยู่ ${fmtDur(t.stop.stayMin)}` : left >= 0 ? `อยู่ได้อีก <b>${fmtDur(left)}</b>` : `เกินเวลา <b>${fmtDur(-left)}</b>`}</p>
    <div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <p class="hero-facts"><span>ควรออก <b>${fmtHM(plannedOut)}</b></span>${t.stop.lockedTime ? `<span>🔒 ${esc(t.stop.lockedTime)}</span>` : ''}</p>
    ${t.stop.note ? `<p class="stop-note">${esc(t.stop.note)}</p>` : ''}
    <button class="btn primary huge" data-act="live-depart" data-stop="${t.uid}">✓ ออกจากที่นี่</button>
    ${
      nextTo && nextLeg
        ? `<div class="hero-next"><p class="eyebrow">ถัดไป</p>
      <p class="next-line"><b>${esc(next ? stopName(next) : `กลับ${shortName(nextTo)}`)}</b> · ${legIcon(nextLeg)} ${travelText(nextLeg)}${next?.arrive != null ? ` · ถึง ~${fmtHM(next.arrive)}` : ''}</p>
      ${navRow(here, nextTo, nextLeg.mode)}</div>`
        : ''
    }
  </section>`;
}

function heroReturn(day: Day, s: DaySchedule, live: boolean): string {
  const end = app.getPlace(day.endPlaceId);
  const e = s.end;
  if (!end || !e) return '';
  const last = [...s.stops].reverse().find((x) => !x.stop.skipped && (x.stop.kind === 'place' || x.stop.kind === 'dinner') && x.stop.placeId);
  const from = last ? app.getPlace(last.stop.placeId) : app.getPlace(day.startPlaceId);
  return `<section class="hero">
    <p class="eyebrow">ขากลับ</p>
    <h2>กลับ${esc(shortName(end))}</h2>
    <p class="hero-big">${e.arrive != null ? `ถึงประมาณ <b>${e.lowerBound ? '≥' : ''}${fmtHM(e.arrive)}</b>` : 'ยังไม่มีเวลา'}</p>
    <p class="hero-facts"><span>${legIcon(e.leg)} เดินทาง <b>${travelText(e.leg)}</b></span>${slackText(day, s)}</p>
    ${navRow(from, end, e.leg.mode)}
    ${live ? '<button class="btn primary huge" data-act="live-end">✓ ถึงที่พักแล้ว</button>' : ''}
  </section>`;
}

function slackText(day: Day, s: DaySchedule): string {
  const e = s.end;
  if (!e || !day.endTime) return '';
  if (e.slackMin == null) return `<span>ต้องถึง ${esc(day.endTime)}</span>`;
  return e.slackMin >= 0 ? `<span class="ok-text">ทันเวลา ${esc(day.endTime)} ✓</span>` : `<span class="bad-text">เกิน ${esc(day.endTime)} ${fmtDur(-e.slackMin)}</span>`;
}

/** รายการทั้งวันแบบย่อ: เวลา · สถานะ · ชื่อ · อยู่นานเท่าไร · เวลาเดินทางก่อนถึง */
function timeline(day: Day, s: DaySchedule, current: string | null): string {
  const act = day.actual ?? {};
  const rows: string[] = [];
  const start = app.getPlace(day.startPlaceId);
  const startReal = parseHM(act.__start?.d);
  rows.push(`<li class="tl ${startReal != null ? 'done' : ''}"><span class="tl-t">${startReal != null ? fmtHM(startReal) : esc(day.startTime ?? '--:--')}</span><span class="tl-dot">${startReal != null ? '✓' : ''}</span><span class="tl-n">ออกจาก ${esc(shortName(start))}</span></li>`);
  for (const t of s.stops) {
    if (t.stop.skipped) continue;
    const real = act[t.uid];
    const done = !!real?.d;
    const now = current === t.uid;
    const isMove = t.stop.kind === 'place' || t.stop.kind === 'dinner';
    if (isMove) rows.push(`<li class="tl-leg">${legSummary(t.leg)}</li>`);
    const warn = t.lateMin ? `<span class="bad-text">สาย ${fmtDur(t.lateMin)}</span>` : t.warnings.find((w) => w.startsWith('ปิด')) ? `<span class="bad-text">${esc(t.warnings.find((w) => w.startsWith('ปิด'))!)}</span>` : '';
    rows.push(`<li class="tl ${done ? 'done' : ''} ${now ? 'now' : ''}">
      <span class="tl-t">${t.arrive != null ? `${t.lowerBound ? '≥' : ''}${fmtHM(t.arrive)}` : '--:--'}</span>
      <span class="tl-dot">${done ? '✓' : now ? '●' : ''}</span>
      <span class="tl-n">${t.stop.lockedTime ? '🔒 ' : ''}${mealTag(t)}${esc(stopName(t))}<small>อยู่ ${fmtDur(t.stop.stayMin)}${t.stop.lockedTime ? ` · นัด ${esc(t.stop.lockedTime)}` : ''} ${warn}</small></span>
    </li>`);
  }
  if (s.end && day.endPlaceId) {
    const endReal = parseHM(act.__end?.a);
    rows.push(`<li class="tl-leg">${legSummary(s.end.leg)}</li>`);
    rows.push(`<li class="tl ${endReal != null ? 'done' : ''} ${current === '__end' ? 'now' : ''}"><span class="tl-t">${s.end.arrive != null ? `${s.end.lowerBound ? '≥' : ''}${fmtHM(s.end.arrive)}` : '--:--'}</span><span class="tl-dot">${endReal != null ? '✓' : ''}</span><span class="tl-n">กลับ${esc(shortName(app.getPlace(day.endPlaceId)))}<small>${slackText(day, s)}</small></span></li>`);
  }
  return `<ol class="tl-list">${rows.join('')}</ol>`;
}

export function todayDay(): { day: Day; isToday: boolean } {
  const now = seoulNow();
  const real = app.plan.days.find((d) => d.date === now.date);
  const chosen = app.todayDayId ? app.findDay(app.todayDayId) : undefined;
  const day = chosen ?? real ?? app.day;
  return { day, isToday: day.date === now.date };
}

export function renderToday(): string {
  const now = seoulNow();
  const { day, isToday } = todayDay();
  const idx = app.dayIndex(day.id);
  const s = app.liveSchedule(day, isToday ? now.mins : null);
  const phase = livePhase(day);
  const active = s.stops.filter((t) => !t.stop.skipped);
  const byUid = (u: string) => s.stops.find((t) => t.uid === u)!;

  let hero = '';
  let current: string | null = null;
  if (!isToday) {
    // ดูล่วงหน้า: แสดงจุดแรกแบบตัวอย่าง (เช็กอินได้เฉพาะวันเดินทางจริง)
    hero = active[0] ? heroMoving(day, s, active[0], false, 'จุดแรกของวัน') : '<p class="empty">วันนี้ยังไม่มีจุดแวะ</p>';
  } else if (phase.kind === 'ready') {
    const first = active[0];
    const start = app.getPlace(day.startPlaceId);
    const plan = parseHM(day.startTime);
    const lateBy = plan != null ? now.mins - plan : null;
    hero = `<section class="hero">
      <p class="eyebrow">เริ่มวัน</p>
      <h2>ออกจาก${esc(shortName(start))}</h2>
      <p class="hero-big">ตามแผน <b>${esc(day.startTime ?? '--:--')}</b>${lateBy != null && lateBy > 5 ? ` <span class="bad-text small">ช้ากว่าแผน ${fmtDur(lateBy)}</span>` : ''}</p>
      ${first ? `<p class="hero-facts"><span>จุดแรก <b>${esc(stopName(first))}</b></span><span>${legIcon(first.leg)} ${travelText(first.leg)}</span></p>` : ''}
      <button class="btn primary huge" data-act="live-start">▶ ออกเดินทางตอนนี้</button>
    </section>`;
  } else if (phase.kind === 'moving') {
    current = phase.uid;
    hero = heroMoving(day, s, byUid(phase.uid), true);
  } else if (phase.kind === 'at') {
    current = phase.uid;
    hero = heroAt(day, s, byUid(phase.uid), now.mins);
  } else if (phase.kind === 'returning') {
    current = '__end';
    hero = heroReturn(day, s, true);
  } else {
    hero = `<section class="hero done"><p class="eyebrow">จบวันนี้ 🎉</p><h2>ถึง${esc(shortName(app.getPlace(day.endPlaceId)))}แล้ว</h2><p class="hero-facts"><span>ถึง ${esc(day.actual?.__end?.a ?? '')}</span></p></section>`;
  }

  // นัดที่ล็อกไว้ข้างหน้าที่จะไม่ทัน
  const late = active.find((t) => t.lateMin && !day.actual?.[t.uid]?.a);
  const alert = late ? `<div class="alert-late">⚠ จะไม่ทัน <b>${esc(stopName(late))}</b> นัด ${esc(late.stop.lockedTime ?? '')} (สาย ${fmtDur(late.lateMin!)}) — ลดเวลาที่จุดก่อนหน้า หรือข้ามบางจุด</div>` : '';
  const hasActual = !!day.actual && Object.keys(day.actual).length > 0;

  return `
    <div class="today-head">
      <div>
        <h2>${esc(fmtDateTh(day.date ?? now.date))}</h2>${day.title ? `<p class="today-title">${esc(day.title)}</p>` : ''}
        <p class="muted small">${isToday ? `ตอนนี้ ${fmtHM(now.mins)} (เวลาโซล)` : 'ดูล่วงหน้า — ปุ่มเช็กอินใช้ได้ในวันเดินทางจริง'}</p>
      </div>
      <select class="inp sm day-pick" data-act-change="today-day" aria-label="เลือกวัน" style="--c:${dayColor(idx)}">
        ${app.plan.days.map((d, k) => `<option value="${d.id}" ${d.id === day.id ? 'selected' : ''}>${esc(dayDate(d, k))}${d.date === now.date ? ' · วันนี้' : ''}${d.title ? ` · ${esc(d.title)}` : ''}</option>`).join('')}
      </select>
    </div>
    ${!app.online ? '<p class="notice warn">ออฟไลน์ — แสดงแผนที่บันทึกไว้ ปุ่มเช็กอินยังใช้ได้</p>' : ''}
    ${alert}
    ${hero}
    <section class="card tl-card"><p class="eyebrow">ทั้งวัน${s.stops.some((t) => t.leg.source === 'auto') ? ' · ≈ = เวลาประมาณจากระยะทาง' : ''}</p>${timeline(day, s, current)}</section>
    ${renderWeather(day, app.schedule(day), { full: false })}
    <div class="row-btns today-foot"><button class="btn" data-act="tab" data-tab="plan">แก้แผนวันนี้</button>${isToday && hasActual ? `<button class="btn ghost sm" data-act="live-reset" data-day="${day.id}">ล้างเวลาจริงวันนี้</button>` : ''}</div>`;
}
