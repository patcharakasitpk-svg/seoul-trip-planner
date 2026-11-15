/**
 * ตัวจัดแผนรายวันแบบขั้นตอน (ต้นแบบ — สำหรับคอม/iPad)
 * 1 ตั้งวัน · 2 เลือกสถานที่ (เลนแนะนำ | เลนช่องเวลา | แผนที่) · 3 การเดินทาง · 4 สรุปแล้วยืนยัน
 * แก้บน "ร่าง" ของวัน (สำเนา) — บันทึกลงแผนจริงเมื่อกดยืนยันเท่านั้น
 */
import L from 'leaflet';
import { app } from './app';
import { esc, dayColor, photosUrl } from './util';
import { clone, insertStop, newStop, removeStop, updateStop, moveStop } from '../core/planOps';
import { fmtDateTh, fmtDur, fmtHM, parseHM } from '../core/time';
import { TEMPLATES } from '../data/templates';
import { CATEGORY_LABEL } from '../data/places';
import { placeOptions } from './views/day';
import { travelText } from './views/leg';
import { mealName, mealOf, newMeal, MEALS, type Meal } from '../core/meals';
import { systemDayDefaults, recommendedStops } from '../core/dayDefaults';
import type { Day, Place, Stop, TravelMode } from '../core/types';
import type { DaySchedule } from '../core/schedule';
import { fmtDist, straightLineM } from '../core/geo';

type Step = 1 | 2 | 3 | 4;
interface PState {
  step: Step;
  dayId: string;
  draft: Day;
  lane: 'cards' | 'search';
  q: string;
  /** ตำแหน่งที่จะวางเมื่อกด ＋ (index ในรายการ) */
  slot: number | null;
  /** กลับมาหน้าสรุปหลังแก้ */
  backToSummary: boolean;
  /** วันตามที่อยู่ในแผนตอนเปิด (ใช้กับ "คืนค่าก่อนแก้") */
  orig: Day;
  /** สถานที่ที่กำลังดูหมุดแดงก่อนใส่ */
  preview: string | null;
}

let st: PState | null = null;
let root: HTMLElement | null = null;
let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;
let onDone: (dayId: string) => void = () => {};

const STAY_CHOICES = [15, 30, 45, 60, 90, 120, 180];
const STEPS: [Step, string][] = [
  [1, 'ตั้งวัน'],
  [2, 'เลือกสถานที่'],
  [3, 'การเดินทาง'],
  [4, 'สรุปและยืนยัน'],
];

export function openPlanner(dayId: string, done: (dayId: string) => void) {
  const day = app.findDay(dayId);
  if (!day) return;
  onDone = done;
  st = { step: 1, dayId, draft: withDefaults(clone(day)), lane: 'cards', q: '', slot: null, backToSummary: false, orig: clone(day), preview: null };
  if (!root) {
    root = document.createElement('div');
    root.id = 'planner';
    root.className = 'planner';
    document.body.append(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', (e) => (e.target as HTMLElement).closest('.drop')?.classList.remove('over'));
    root.addEventListener('drop', onDrop);
  }
  root.hidden = false;
  document.body.classList.add('planner-open');
  render(true);
}

/** ร่างเริ่มต้น: ยังไม่ตั้งเวลา → เติมค่าที่ใช้บ่อย (แก้ได้ในขั้นที่ 1) */
function withDefaults(d: Day): Day {
  const def = systemDayDefaults(d.date);
  return { ...d, startTime: d.startTime ?? def.startTime, endTime: d.endTime ?? def.endTime, startPlaceId: d.startPlaceId ?? def.startPlaceId, endPlaceId: d.endPlaceId ?? def.endPlaceId };
}

/** ปุ่ม ↺ คืนค่าที่ระบบตั้งไว้ (แสดงเฉพาะเมื่อค่าเปลี่ยนไปจากค่าเริ่มต้น) */
const resetBtn = (act: string, v: string, label = 'คืนค่าเริ่มต้น') => `<button class="reset" data-pl="${act}" data-v="${esc(v)}" title="${label}" aria-label="${label}">↺</button>`;

/** เวลาอยู่ที่เป็น "ค่าเริ่มต้น" ของรายการ: ในแผนตอนเปิด › ในแผนแนะนำของวัน › ที่แนะนำของสถานที่ */
function defaultStay(x: Stop): number | null {
  const o = st?.orig.stops.find((y) => y.uid === x.uid);
  if (o) return o.stayMin;
  const rec = x.placeId ? recommendedStops(st?.draft.date ?? null).find((y) => y.placeId === x.placeId) : undefined;
  if (rec) return rec.stayMin;
  return suggestedStay(x);
}

function suggestedStay(x: Stop): number | null {
  if (x.kind === 'dinner') return x.placeId ? (app.getPlace(x.placeId)?.suggestedStayMin || MEALS[mealOf(x)].stay) : MEALS[mealOf(x)].stay;
  if (x.kind === 'place') return app.getPlace(x.placeId)?.suggestedStayMin || 60;
  return null;
}

function close() {
  if (!root) return;
  root.hidden = true;
  document.body.classList.remove('planner-open');
  map?.remove();
  map = null;
  st = null;
}

const sched = (): DaySchedule => app.schedule(st!.draft);
const placeOf = (s: Stop) => app.getPlace(s.placeId);
const nameOf = (s: Stop) => (s.kind === 'dinner' ? (placeOf(s)?.nameTh ?? `${mealName(s)} (ยังไม่เลือกร้าน)`) : s.kind === 'break' || s.kind === 'buffer' ? (s.title ?? 'พัก') : (placeOf(s)?.nameTh ?? 'สถานที่'));
const shortName = (p: Place | undefined) => (p ? (p.id === 'hotel' ? 'โรงแรม' : p.nameTh) : '—');

/** เวลาที่มีทั้งวัน และที่ใช้ไป (อยู่ + เดินทาง) */
function budget(s: DaySchedule) {
  const d = st!.draft;
  const start = parseHM(d.startTime);
  const end = parseHM(d.endTime);
  const total = start != null && end != null ? end - start : null;
  const stay = d.stops.filter((x) => !x.skipped).reduce((a, x) => a + x.stayMin, 0);
  const travel = s.stops.reduce((a, t) => a + (t.stop.skipped ? 0 : (t.leg.travelMin ?? 0) + t.leg.bufferMin), 0) + (s.end ? (s.end.leg.travelMin ?? 0) + s.end.leg.bufferMin : 0);
  const wait = s.stops.reduce((a, t) => a + t.wait, 0);
  return { total, stay, travel, wait, used: stay + travel + wait, free: total != null ? total - (stay + travel + wait) : null };
}

function budgetBar(s: DaySchedule): string {
  const b = budget(s);
  if (b.total == null) return '<div class="pl-budget muted">ตั้งเวลาเริ่ม–จบในขั้นที่ 1 เพื่อดูเวลาที่เหลือ</div>';
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / b.total!) * 100))}%`;
  const over = b.free! < 0;
  return `<div class="pl-budget ${over ? 'over' : ''}">
    <div class="pl-budget-text"><b>${over ? `เกินเวลา ${fmtDur(-b.free!)}` : `เหลือ ${fmtDur(b.free!)}`}</b> <span class="muted">จาก ${fmtDur(b.total)} · อยู่ ${fmtDur(b.stay)} · เดินทาง ${fmtDur(b.travel)}${b.wait ? ` · รอนัด ${fmtDur(b.wait)}` : ''}</span></div>
    <div class="pl-bar"><i class="stay" style="width:${pct(b.stay)}"></i><i class="travel" style="width:${pct(b.travel)}"></i><i class="wait" style="width:${pct(b.wait)}"></i></div>
  </div>`;
}

/* ---------------- render ---------------- */
function render(resetMap = false) {
  if (!st || !root) return;
  const s = sched();
  const d = st.draft;
  const idx = app.dayIndex(st.dayId);
  // โครงคงที่ครั้งเดียว — แผนที่ไม่ถูกสร้างใหม่ทุกครั้งที่แก้ (ไม่กะพริบ)
  if (resetMap || !root.querySelector('#pl-map')) {
    map?.remove();
    map = null;
    root.innerHTML = `<header class="pl-head"></header><div class="pl-budget-wrap"></div>
      <div class="pl-body"><div class="pl-main"></div><div class="pl-mapcol"><div id="pl-map"></div><p class="muted small">ตัวเลขบนหมุด = ลำดับ · เส้นประ = ลำดับการเดินทาง (ไม่ใช่เส้นทางจริง)</p></div></div>
      <footer class="pl-foot"></footer>`;
  }
  const $ = (sel: string) => root!.querySelector(sel) as HTMLElement;
  $('.pl-head').innerHTML = `
      <div class="pl-title"><b style="color:${dayColor(idx)}">วัน ${idx + 1}</b> ${d.date ? esc(fmtDateTh(d.date)) : ''} <span class="muted small">· ร่าง ยังไม่บันทึก</span></div>
      <ol class="pl-steps">${STEPS.map(([n, t]) => `<li class="${st!.step === n ? 'on' : n < st!.step ? 'done' : ''}"><button data-pl="goto" data-v="${n}"><span>${n}</span>${t}</button></li>`).join('')}</ol>
      <button class="btn ghost sm" data-pl="cancel">ปิด (ไม่บันทึก)</button>`;
  $('.pl-budget-wrap').innerHTML = st.step === 2 || st.step === 3 ? budgetBar(s) : '';
  $('.pl-body').className = `pl-body step-${st.step}`;
  const main = $('.pl-main');
  const scroll = main.scrollTop;
  const laneScroll = (root.querySelector('.pl-lane-list') as HTMLElement | null)?.scrollTop ?? 0;
  main.innerHTML = st.step === 1 ? step1() : st.step === 2 ? step2(s) : st.step === 3 ? step3(s) : step4(s);
  main.scrollTop = scroll;
  const lane = root.querySelector('.pl-lane-list') as HTMLElement | null;
  if (lane) lane.scrollTop = laneScroll;
  $('.pl-foot').innerHTML = footer();
  drawMap(s);
  (root.querySelector('[data-autofocus]') as HTMLInputElement | null)?.focus();
}

function footer(): string {
  const n = st!.step;
  const back = n > 1 && !st!.backToSummary ? `<button class="pl-btn ghost" data-pl="goto" data-v="${n - 1}">← ${STEPS[n - 2][1]}</button>` : '<span></span>';
  const mid = `<span class="pl-foot-mid">ขั้นที่ ${n} จาก 4</span>`;
  if (st!.backToSummary && n !== 4) return `${back}${mid}<button class="pl-btn primary" data-pl="goto" data-v="4">กลับไปหน้าสรุป</button>`;
  return `${back}${mid}${n < 4 ? `<button class="pl-btn primary" data-pl="goto" data-v="${n + 1}">${STEPS[n][1]} →</button>` : '<button class="pl-btn primary confirm" data-pl="confirm">ยืนยันแผนวันนี้</button>'}`;
}

/* ---------- ขั้น 1: ตั้งวัน ---------- */
function step1(): string {
  const d = st!.draft;
  const def = systemDayDefaults(d.date);
  const start = parseHM(d.startTime);
  const end = parseHM(d.endTime);
  const locked = d.stops.filter((x) => x.lockedTime);
  const r = (field: keyof typeof def) => (d[field] !== def[field] ? resetBtn('reset-field', field) : '');
  const changed = (Object.keys(def) as (keyof typeof def)[]).some((k) => d[k] !== def[k]) || d.date !== st!.orig.date;
  return `<section class="pl-card">
    <div class="pl-card-head"><h2>วันนี้เริ่มกี่โมง จบกี่โมง</h2>${changed ? '<button class="pl-btn ghost sm" data-pl="reset-step" data-v="1">↺ คืนค่าเริ่มต้นทั้งหมด</button>' : ''}</div>
    <div class="pl-grid2">
      <label>วัน<select class="inp" data-pl-change="day">${app.plan.days.map((x, k) => `<option value="${x.id}" ${x.id === st!.dayId ? 'selected' : ''}>วัน ${k + 1}${x.date ? ` · ${esc(fmtDateTh(x.date))}` : ''}</option>`).join('')}</select></label>
      <label>วันที่<span class="pl-field"><input class="inp" type="date" value="${esc(d.date ?? '')}" data-pl-change="date">${d.date !== st!.orig.date ? resetBtn('reset-field', 'date') : ''}</span></label>
      <label>ออกจาก<span class="pl-field"><select class="inp" data-pl-change="startPlaceId">${placeOptions(d.startPlaceId)}</select>${r('startPlaceId')}</span></label>
      <label>เวลาออก<span class="pl-field"><input class="inp" type="time" value="${esc(d.startTime ?? '')}" data-pl-change="startTime">${r('startTime')}</span></label>
      <label>จบวันที่<span class="pl-field"><select class="inp" data-pl-change="endPlaceId">${placeOptions(d.endPlaceId)}</select>${r('endPlaceId')}</span></label>
      <label>ต้องถึงภายใน<span class="pl-field"><input class="inp" type="time" value="${esc(d.endTime ?? '')}" data-pl-change="endTime">${r('endTime')}</span></label>
    </div>
    <p class="pl-hours">${start != null && end != null ? `วันนี้มีเวลา <b>${fmtDur(end - start)}</b>` : 'ใส่เวลาออกและเวลาจบ เพื่อให้รู้ว่าวันนี้มีเวลาเท่าไร'}</p>
    <p class="muted small">↺ = กลับเป็นค่าที่ระบบตั้งไว้ตามทริป (เที่ยวบิน · ที่พัก · 09:00–21:00)</p>
    ${
      locked.length
        ? `<h3>นัดที่ล็อกไว้ในวันนี้</h3><ul class="pl-locked">${locked.map((x) => `<li><b>${esc(x.lockedTime!)}</b> ${esc(nameOf(x))} · ${fmtDur(x.stayMin)}</li>`).join('')}</ul><p class="muted small">นัดเหล่านี้จะอยู่ในแผนเสมอ เวลาอื่นจะจัดรอบนัด</p>`
        : ''
    }
  </section>`;
}

/* ---------- ขั้น 2: เลือกสถานที่ (2 เลน) ---------- */
/** ลิงก์ดูรูปสถานที่ (เปิดแท็บใหม่) — ชื่อแปลก ๆ จะได้นึกออกว่าหน้าตาเป็นยังไง */
const photoLink = (p: Place | undefined) => (p && p.category !== 'base' ? `<a class="pl-photo" href="${esc(photosUrl(p))}" target="_blank" rel="noopener" title="ดูรูป ${esc(p.nameTh)}">ดูรูป ↗</a>` : '');

/** จุดที่จะต่อจากช่องที่เลือก (หรือจุดสุดท้ายของวัน) — ใช้วัดระยะตอนดูหมุดแดง */
function anchorPlace(): Place | undefined {
  const d = st!.draft;
  const upto = st!.slot ?? d.stops.length;
  for (let i = upto - 1; i >= 0; i--) {
    const p = placeOf(d.stops[i]);
    if (p?.lat != null) return p;
  }
  return app.getPlace(d.startPlaceId);
}

function previewInfo(p: Place): string {
  const a = anchorPlace();
  if (!a || a.lat == null || p.lat == null || a.id === p.id) return '';
  const m = straightLineM({ lat: a.lat, lng: a.lng! }, { lat: p.lat, lng: p.lng! });
  const est = app.estimateMin(a.id, p.id, 'TRANSIT');
  return `<span class="pl-preview-info">ห่างจาก${esc(a.id === 'hotel' ? 'โรงแรม' : a.nameTh)} ${fmtDist(m)}${est != null ? ` · เดินทาง ≈ ${fmtDur(est)}` : ''}</span>`;
}

function laneItem(p: Place, _inDay: boolean): string {
  const on = st!.preview === p.id;
  const times = st!.draft.stops.filter((x) => x.placeId === p.id).length;
  return `<div class="pl-item ${times ? 'in' : ''} ${on ? 'preview' : ''}" draggable="true" data-drag-place="${esc(p.id)}">
    <button class="pl-item-text" data-pl="preview" data-place="${esc(p.id)}" aria-pressed="${on}" title="แตะเพื่อดูหมุดบนแผนที่"><b>${esc(p.nameTh)}</b><span class="muted small">${esc(CATEGORY_LABEL[p.category] ?? '')} · ${esc(p.area)}${p.suggestedStayMin ? ` · ราว ${fmtDur(p.suggestedStayMin)}` : ''}</span>${on ? previewInfo(p) : ''}</button>
    ${photoLink(p)}
    ${times ? `<span class="pl-in-tag">อยู่ในแผนแล้ว${times > 1 ? ` ${times} ครั้ง` : ''}</span>` : ''}
    <button class="btn sm" data-pl="add" data-place="${esc(p.id)}" aria-label="ใส่ ${esc(p.nameTh)} ในช่องที่เลือก${times ? ' (อีกครั้ง)' : ''}">＋</button>
  </div>`;
}

function step2(s: DaySchedule): string {
  const d = st!.draft;
  const inDay = new Set(d.stops.map((x) => x.placeId).filter(Boolean) as string[]);
  const menu = TEMPLATES.find((t) => t.pick)!;
  let laneBody = '';
  if (st!.lane === 'cards') {
    laneBody = menu.days
      .map(
        (td, i) => `<div class="pl-plan">
        <div class="pl-plan-head"><b>${esc(td.title)}</b><button class="btn ghost xs" data-pl="add-card" data-v="${i}">ใส่ทั้งการ์ด</button></div>
        <p class="muted small">${esc(td.note)}</p>
        ${td.stops.map((ts) => (ts.placeId ? app.getPlace(ts.placeId) : undefined)).filter((p): p is Place => !!p && p.category !== 'base').map((p) => laneItem(p, inDay.has(p.id))).join('')}
      </div>`,
      )
      .join('');
  } else {
    const q = st!.q.trim().toLowerCase();
    const list = app
      .places()
      .filter((p) => p.lat != null)
      .filter((p) => !q || [p.nameTh, p.nameEn, p.nameKo, p.area, ...(p.food?.menu ?? [])].join(' ').toLowerCase().includes(q));
    // ใกล้จุดในแผนก่อน
    const anchors = d.stops.map(placeOf).filter((p): p is Place => !!p && p.lat != null);
    const dist = (p: Place) => (anchors.length ? Math.min(...anchors.map((a) => straightLineM({ lat: a.lat!, lng: a.lng! }, { lat: p.lat!, lng: p.lng! }))) : 0);
    list.sort((a, b) => dist(a) - dist(b));
    const main = list.filter((p) => p.category === 'base');
    const others = list.filter((p) => p.category !== 'base');
    laneBody = list.length
      ? `${main.length ? `<p class="pl-group">สถานที่หลัก</p>${main.map((p) => laneItem(p, inDay.has(p.id))).join('')}` : ''}${others.length ? `<p class="pl-group">สถานที่อื่น ๆ <span class="muted">(ใกล้จุดในแผนก่อน)</span></p>${others.slice(0, 80).map((p) => laneItem(p, inDay.has(p.id))).join('')}` : ''}`
      : '<p class="muted">ไม่พบ — ลองคำอื่น</p>';
  }
  const slotLabel = st!.slot == null ? 'ท้ายวัน' : `ช่องที่ ${st!.slot + 1}`;
  return `<div class="pl-lanes">
    <section class="pl-lane left">
      <div class="seg pl-lane-tabs"><button class="${st!.lane === 'cards' ? 'on' : ''}" data-pl="lane" data-v="cards">แผนแนะนำ</button><button class="${st!.lane === 'search' ? 'on' : ''}" data-pl="lane" data-v="search">ค้นหาทั้งหมด</button></div>
      ${st!.lane === 'search' ? `<input class="inp" type="search" placeholder="ค้นหาร้าน ย่าน เมนู" value="${esc(st!.q)}" data-pl-input="q" data-autofocus>` : ''}
      <p class="muted small">ลากไปวางในช่องทางขวา หรือกด ＋ เพื่อใส่ <b>${slotLabel}</b> · มื้ออาหาร: ${(Object.keys(MEALS) as Meal[]).map((m) => `<button class="link" data-pl="add-meal" data-v="${m}">${MEALS[m].th.replace('มื้อ', '')}</button>`).join(' · ')}</p>
      <div class="pl-lane-list">${laneBody}</div>
    </section>
    <section class="pl-lane right">
      <div class="pl-card-head"><h3>ช่องเวลาของวัน</h3>
        <div class="pl-mini-actions">${recommendedStops(st!.draft.date).length ? '<button class="pl-btn ghost sm" data-pl="reset-step" data-v="2">↺ ใช้แผนแนะนำของวันนี้</button>' : ''}<button class="pl-btn ghost sm" data-pl="clear-stops">ล้างทั้งหมด</button></div></div>
      ${dayLane(s)}
    </section>
  </div>`;
}

/** เลนขวา: เวลาไหลต่อกัน · ช่องวาง (drop) ระหว่างทุกรายการ · ช่วงว่างแสดงเป็นช่องใหญ่ */
function dayLane(s: DaySchedule): string {
  const d = st!.draft;
  const rows: string[] = [];
  const drop = (i: number, label = '', big = false) =>
    `<div class="drop ${big ? 'big' : ''} ${st!.slot === i ? 'sel' : ''}" data-drop="${i}" data-pl="slot" data-v="${i}">${label || (st!.slot === i ? 'ช่องที่เลือก — กด ＋ ทางซ้าย' : '＋ วางที่นี่')}</div>`;
  rows.push(`<div class="pl-row edge"><span class="t">${esc(d.startTime ?? '--:--')}</span><span>ออกจาก <b>${esc(shortName(app.getPlace(d.startPlaceId)))}</b></span></div>`);
  s.stops.forEach((t, i) => {
    rows.push(t.wait > 0 ? drop(i, `ว่าง ${fmtDur(t.wait)} ก่อนนัด — วางสถานที่ที่นี่`, true) : drop(i));
    const x = t.stop;
    const isMove = x.kind === 'place' || x.kind === 'dinner';
    rows.push(`
      ${isMove && t.leg.fromId && t.leg.toId && t.leg.fromId !== t.leg.toId ? `<div class="pl-travel">เดินทาง ${travelText(t.leg)}</div>` : ''}
      <div class="pl-row stop ${x.lockedTime ? 'locked' : ''}" data-uid="${x.uid}">
        <span class="t">${t.start != null ? fmtHM(t.start) : '--:--'}</span>
        <div class="pl-row-main">
          <b>${esc(nameOf(x))}</b> ${photoLink(placeOf(x))}${x.lockedTime ? ` <span class="pill">นัด ${esc(x.lockedTime)}</span>` : ''}
          <div class="pl-stay">อยู่ <select class="inp xs" data-pl-change="stay" data-uid="${x.uid}" aria-label="อยู่นานเท่าไร">${[...new Set([...STAY_CHOICES, x.stayMin])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === x.stayMin ? 'selected' : ''}>${fmtDur(m)}</option>`).join('')}</select>
            ${defaultStay(x) != null && defaultStay(x) !== x.stayMin ? resetBtn('reset-stay', x.uid, `คืนเวลาที่แนะนำ (${fmtDur(defaultStay(x)!)})`) : ''}
            ${t.depart != null ? `<span class="muted small">ถึง ${fmtHM(t.depart)}</span>` : ''}
            ${t.lateMin ? `<span class="bad-text small">สาย ${fmtDur(t.lateMin)}</span>` : ''}
            ${t.warnings.find((w) => w.startsWith('ปิด')) ? `<span class="bad-text small">${esc(t.warnings.find((w) => w.startsWith('ปิด'))!)}</span>` : ''}</div>
        </div>
        <div class="pl-row-act">
          <button class="icon-btn sm" data-pl="up" data-uid="${x.uid}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
          <button class="icon-btn sm" data-pl="down" data-uid="${x.uid}" ${i === s.stops.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
          ${x.lockedTime ? '' : `<button class="icon-btn sm" data-pl="remove" data-uid="${x.uid}" aria-label="เอาออก">✕</button>`}
        </div>
      </div>`);
  });
  const b = budget(s);
  rows.push(drop(d.stops.length, b.free != null && b.free > 15 ? `ว่าง ${fmtDur(b.free)} ถึงเวลาจบ — วางสถานที่ที่นี่` : '', b.free != null && b.free > 15));
  if (s.end) {
    rows.push(`<div class="pl-travel">เดินทาง ${travelText(s.end.leg)}</div>`);
    rows.push(`<div class="pl-row edge"><span class="t">${s.end.arrive != null ? fmtHM(s.end.arrive) : '--:--'}</span><span>ถึง <b>${esc(shortName(app.getPlace(d.endPlaceId)))}</b>${s.end.slackMin != null && s.end.slackMin < 0 ? ` <span class="bad-text small">เกิน ${esc(d.endTime ?? '')} ${fmtDur(-s.end.slackMin)}</span>` : ''}</span></div>`);
  }
  return `<div class="pl-day">${rows.join('')}</div>`;
}

/* ---------- ขั้น 3: การเดินทาง ---------- */
function step3(s: DaySchedule): string {
  const d = st!.draft;
  const legs: { target: string; from: Place | undefined; to: Place | undefined; leg: (typeof s.stops)[number]['leg'] }[] = [];
  s.stops.forEach((t) => {
    if (t.stop.skipped || !(t.stop.kind === 'place' || t.stop.kind === 'dinner')) return;
    if (!t.leg.fromId || !t.leg.toId || t.leg.fromId === t.leg.toId) return;
    legs.push({ target: t.uid, from: app.getPlace(t.leg.fromId), to: app.getPlace(t.leg.toId), leg: t.leg });
  });
  if (s.end && s.end.leg.fromId && s.end.leg.toId && s.end.leg.fromId !== s.end.leg.toId) legs.push({ target: '__end', from: app.getPlace(s.end.leg.fromId), to: app.getPlace(s.end.leg.toId), leg: s.end.leg });
  const mode = (target: string) => (target === '__end' ? d.endLeg : d.stops.find((x) => x.uid === target)!.legIn);
  return `<section class="pl-card">
    <div class="pl-card-head"><h2>เดินทางระหว่างจุด ใช้เวลาประมาณเท่าไร</h2>${legs.some((l) => mode(l.target).manualMin != null || mode(l.target).mode !== 'TRANSIT') ? '<button class="pl-btn ghost sm" data-pl="reset-step" data-v="3">↺ ใช้เวลาประมาณทั้งหมด</button>' : ''}</div>
    <p class="muted small">ระบบใส่เวลาประมาณจากระยะทางไว้ให้ (≈) — แก้เป็นเวลาที่คิดว่าใช้จริงได้เลย</p>
    <table class="pl-legs"><tbody>${legs
      .map(
        (l) => `<tr>
        <td>${esc(shortName(l.from))} → <b>${esc(shortName(l.to))}</b></td>
        <td><select class="inp xs" data-pl-change="mode" data-target="${l.target}">${(['TRANSIT', 'WALKING', 'DRIVING'] as TravelMode[]).map((m) => `<option value="${m}" ${mode(l.target).mode === m ? 'selected' : ''}>${{ TRANSIT: 'รถไฟฟ้า/รถเมล์', WALKING: 'เดิน', DRIVING: 'แท็กซี่' }[m]}</option>`).join('')}</select></td>
        <td class="num"><input class="inp xs" type="number" min="0" value="${l.leg.travelMin ?? ''}" data-pl-change="travel" data-target="${l.target}" aria-label="นาที"> นาที ${l.leg.source === 'auto' ? '<span class="muted small">(ประมาณ)</span>' : ''}${mode(l.target).manualMin != null || mode(l.target).mode !== 'TRANSIT' ? resetBtn('reset-leg', l.target, 'กลับเป็นเวลาประมาณ') : ''}</td>
      </tr>`,
      )
      .join('')}</tbody></table>
    ${legs.length ? '' : '<p class="muted">ยังไม่มีการเดินทาง — เลือกสถานที่ในขั้นที่ 2 ก่อน</p>'}
  </section>`;
}

/* ---------- ขั้น 4: สรุป ---------- */
function step4(s: DaySchedule): string {
  const d = st!.draft;
  const b = budget(s);
  const edit = (step: Step) => `<button class="link small" data-pl="edit" data-v="${step}">แก้</button>`;
  const rows: string[] = [];
  rows.push(`<li class="sum-edge"><span class="t">${esc(d.startTime ?? '--:--')}</span><span>ออกจาก <b>${esc(shortName(app.getPlace(d.startPlaceId)))}</b></span>${edit(1)}</li>`);
  for (const t of s.stops) {
    if (t.stop.skipped) continue;
    const isMove = t.stop.kind === 'place' || t.stop.kind === 'dinner';
    if (isMove && t.leg.fromId !== t.leg.toId && t.leg.travelMin != null) rows.push(`<li class="sum-leg"><span></span><span>เดินทาง ${travelText(t.leg)}</span>${edit(3)}</li>`);
    rows.push(`<li class="sum-stop"><span class="t">${t.start != null ? fmtHM(t.start) : '--:--'}</span><span><b>${esc(nameOf(t.stop))}</b> ${photoLink(placeOf(t.stop))} · ${fmtDur(t.stop.stayMin)}${t.stop.lockedTime ? ' · นัด' : ''}${t.lateMin ? ` <span class="bad-text">สาย ${fmtDur(t.lateMin)}</span>` : ''}</span>${edit(2)}</li>`);
  }
  if (s.end) {
    rows.push(`<li class="sum-leg"><span></span><span>เดินทาง ${travelText(s.end.leg)}</span>${edit(3)}</li>`);
    rows.push(`<li class="sum-edge"><span class="t">${s.end.arrive != null ? fmtHM(s.end.arrive) : '--:--'}</span><span>ถึง <b>${esc(shortName(app.getPlace(d.endPlaceId)))}</b></span>${edit(1)}</li>`);
  }
  const ok = b.free != null && b.free >= 0 && !s.stops.some((t) => t.lateMin);
  return `<section class="pl-card">
    <h2>สรุปแผน ${d.date ? esc(fmtDateTh(d.date)) : ''} · ${esc(d.startTime ?? '--:--')}–${esc(d.endTime ?? '--:--')}</h2>
    <p class="pl-verdict ${ok ? 'ok' : 'bad'}">${b.total == null ? 'ยังไม่ได้ตั้งเวลาเริ่ม–จบ' : ok ? `ทันเวลา · เหลือ ${fmtDur(b.free!)}` : b.free! < 0 ? `เกินเวลา ${fmtDur(-b.free!)} — ลดเวลาบางจุด หรือเอาบางที่ออก` : 'มีนัดที่ไปไม่ทัน — ปรับลำดับหรือลดเวลา'}</p>
    <ol class="pl-sum">${rows.join('')}</ol>
  </section>`;
}

/* ---------------- แผนที่ ---------------- */
function drawMap(s: DaySchedule) {
  const el = root?.querySelector('#pl-map') as HTMLElement | null;
  if (!el) return;
  if (!map) {
    map = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  layer!.clearLayers();
  if (!layer) return;
  const d = st!.draft;
  const pts: { p: Place; label: string }[] = [];
  const start = app.getPlace(d.startPlaceId);
  if (start?.lat != null) pts.push({ p: start, label: 'เริ่ม' });
  let n = 0;
  for (const t of s.stops) {
    if (t.stop.skipped) continue;
    const p = placeOf(t.stop);
    if (p?.lat != null) pts.push({ p, label: String(++n) });
  }
  const end = app.getPlace(d.endPlaceId);
  if (end?.lat != null) pts.push({ p: end, label: 'จบ' });
  const color = dayColor(app.dayIndex(st!.dayId));
  const path = pts.map((x) => [x.p.lat!, x.p.lng!] as [number, number]);
  if (path.length > 1) L.polyline(path, { color, weight: 3, dashArray: '6 8' }).addTo(layer!);
  // ที่เดียวกันหลายครั้ง (เช่นแวะกลับโรงแรม) = หมุดเดียว บอกหลายลำดับ
  const byPlace = new Map<string, { p: Place; labels: string[] }>();
  for (const x of pts) {
    const g = byPlace.get(x.p.id) ?? { p: x.p, labels: [] };
    if (!g.labels.includes(x.label)) g.labels.push(x.label);
    byPlace.set(x.p.id, g);
  }
  for (const g of byPlace.values()) {
    L.marker([g.p.lat!, g.p.lng!], { icon: L.divIcon({ className: 'pl-pin', html: `<span style="--c:${color}">${esc(g.labels.join(', '))}</span>`, iconSize: [0, 0] }), title: g.p.nameTh }).addTo(layer!);
  }
  // หมุดแดง: สถานที่ที่กำลังดูก่อนใส่ + เส้นจากจุดที่จะต่อ
  const pv = st!.step === 2 && st!.preview ? app.getPlace(st!.preview) : undefined;
  let focus = path;
  if (pv?.lat != null) {
    const a = anchorPlace();
    const pp: [number, number] = [pv.lat, pv.lng!];
    if (a?.lat != null) {
      L.polyline([[a.lat, a.lng!], pp], { color: '#e03131', weight: 4, opacity: 0.85, dashArray: '8 8' }).addTo(layer!);
      focus = [[a.lat, a.lng!], pp];
    } else focus = [pp];
    L.marker(pp, { icon: L.divIcon({ className: 'pl-pin preview', html: `<span>${esc(pv.nameTh)}</span>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(layer!);
  }
  const fit = () => {
    if (!map) return;
    map.invalidateSize(); // กล่องแผนที่ขยายหลังสร้าง → คำนวณขนาดใหม่ ไม่ให้แผนที่โหลดแค่บางส่วน
    if (focus.length) map.fitBounds(L.latLngBounds(focus), { padding: [48, 48], maxZoom: 15 });
    else map.setView([37.5665, 126.978], 12);
  };
  fit();
  requestAnimationFrame(fit);
}

/* ---------------- การแก้ร่าง ---------------- */
function edit(fn: (d: Day) => Day) {
  st!.draft = fn(st!.draft);
  render();
}

function addPlace(placeId: string, at: number | null) {
  const p = app.getPlace(placeId);
  if (!p) return;
  const d = st!.draft;
  const i = at ?? d.stops.length;
  // ร้านอาหาร → เติมช่องมื้อที่ยังว่างก่อน
  const emptyMeal = p.category === 'food' ? d.stops.find((x) => x.kind === 'dinner' && !x.placeId) : undefined;
  if (emptyMeal && at == null) edit((x) => updateStop(x, emptyMeal.uid, { placeId }));
  else edit((x) => insertStop(x, i, newStop('place', placeId, p.suggestedStayMin || 60)));
  st!.slot = null;
  st!.preview = null;
  render();
}

/* ---------------- events ---------------- */
function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-pl]') as HTMLElement | null;
  if (!el || !st) return;
  const v = el.dataset.v;
  switch (el.dataset.pl) {
    case 'cancel':
      close();
      return;
    case 'goto':
      st.step = Number(v) as Step;
      if (st.step === 4) st.backToSummary = false;
      break;
    case 'edit':
      st.step = Number(v) as Step;
      st.backToSummary = true;
      break;
    case 'reset-field': {
      const def = systemDayDefaults(st.draft.date);
      const f = v as keyof typeof def | 'date';
      st.draft = f === 'date' ? { ...st.draft, date: st.orig.date } : { ...st.draft, [f]: def[f] };
      break;
    }
    case 'reset-step': {
      if (v === '1') {
        const def = systemDayDefaults(st.orig.date);
        st.draft = { ...st.draft, date: st.orig.date, ...def };
      } else if (v === '2') {
        const rec = recommendedStops(st.draft.date);
        if (rec.length) st.draft = { ...st.draft, stops: rec };
      } else if (v === '3') {
        const clear = <T extends { manualMin: number | null; manualKind?: 'user' | 'estimate'; mode: TravelMode }>(l: T): T => ({ ...l, manualMin: null, manualKind: undefined, mode: 'TRANSIT' });
        st.draft = { ...st.draft, endLeg: clear(st.draft.endLeg), stops: st.draft.stops.map((x) => ({ ...x, legIn: clear(x.legIn) })) };
      }
      break;
    }
    case 'clear-stops':
      st.draft = { ...st.draft, stops: st.draft.stops.filter((x) => x.lockedTime) };
      st.slot = null;
      break;
    case 'reset-stay': {
      const x = st.draft.stops.find((y) => y.uid === v);
      const m = x ? defaultStay(x) : null;
      if (x && m != null) st.draft = updateStop(st.draft, x.uid, { stayMin: m });
      break;
    }
    case 'reset-leg': {
      const clear = { manualMin: null, manualKind: undefined, mode: 'TRANSIT' as TravelMode };
      st.draft = v === '__end' ? { ...st.draft, endLeg: { ...st.draft.endLeg, ...clear } } : updateStop(st.draft, v!, { legIn: { ...st.draft.stops.find((y) => y.uid === v)!.legIn, ...clear } });
      break;
    }
    case 'preview':
      st.preview = st.preview === el.dataset.place ? null : el.dataset.place!;
      break;
    case 'lane':
      st.lane = v === 'search' ? 'search' : 'cards';
      break;
    case 'slot':
      st.slot = st.slot === Number(v) ? null : Number(v);
      break;
    case 'add':
      addPlace(el.dataset.place!, st.slot);
      return;
    case 'add-card': {
      const td = TEMPLATES.find((t) => t.pick)!.days[Number(v)];
      let at = st.slot ?? st.draft.stops.length;
      for (const ts of td.stops) {
        const p = ts.placeId ? app.getPlace(ts.placeId) : undefined;
        if (!p || p.category === 'base' || st.draft.stops.some((x) => x.placeId === p.id)) continue;
        st.draft = insertStop(st.draft, at++, newStop('place', p.id, ts.stayMin));
      }
      st.slot = null;
      break;
    }
    case 'add-meal':
      st.draft = insertStop(st.draft, st.slot ?? st.draft.stops.length, newMeal(v as Meal));
      st.slot = null;
      break;
    case 'up':
    case 'down':
      st.draft = moveStop(st.draft, el.dataset.uid!, el.dataset.pl === 'up' ? -1 : 1);
      break;
    case 'remove':
      st.draft = removeStop(st.draft, el.dataset.uid!);
      break;
    case 'confirm': {
      const dayId = st.dayId;
      const before = clone(app.findDay(dayId)!);
      app.setDay(dayId, st.draft);
      app.showToast('บันทึกแผนวันนี้แล้ว', () => app.setDay(dayId, before, 'เลิกทำแล้ว'));
      close();
      onDone(dayId);
      return;
    }
    default:
      return;
  }
  render();
}

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.plChange;
  if (!k || !st) return;
  const d = st.draft;
  switch (k) {
    case 'day': {
      const day = app.findDay(el.value);
      if (day) Object.assign(st, { dayId: day.id, draft: withDefaults(clone(day)), orig: clone(day), slot: null });
      render(true);
      return;
    }
    case 'date':
    case 'startTime':
    case 'endTime':
    case 'startPlaceId':
    case 'endPlaceId':
      st.draft = { ...d, [k]: el.value || null };
      break;
    case 'stay':
      st.draft = updateStop(d, el.dataset.uid!, { stayMin: Number(el.value) });
      break;
    case 'mode': {
      const t = el.dataset.target!;
      const m = el.value as TravelMode;
      st.draft = t === '__end' ? { ...d, endLeg: { ...d.endLeg, mode: m, manualMin: null } } : updateStop(d, t, { legIn: { ...d.stops.find((x) => x.uid === t)!.legIn, mode: m, manualMin: null } });
      break;
    }
    case 'travel': {
      const t = el.dataset.target!;
      const v = el.value === '' ? null : Math.max(0, Math.min(600, Math.round(Number(el.value))));
      const leg = { manualMin: v, manualKind: v == null ? undefined : ('user' as const) };
      st.draft = t === '__end' ? { ...d, endLeg: { ...d.endLeg, ...leg } } : updateStop(d, t, { legIn: { ...d.stops.find((x) => x.uid === t)!.legIn, ...leg } });
      break;
    }
    default:
      return;
  }
  render();
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.plInput !== 'q' || !st) return;
  st.q = el.value;
  // อัปเดตเฉพาะรายการในเลนซ้าย (ช่องค้นหาไม่เสียโฟกัส แผนที่ไม่ขยับ)
  const tmp = document.createElement('div');
  tmp.innerHTML = step2(sched());
  const fresh = tmp.querySelector('.pl-lane-list');
  const cur = root?.querySelector('.pl-lane-list');
  if (fresh && cur) cur.innerHTML = fresh.innerHTML;
}

function onDragStart(e: DragEvent) {
  const el = (e.target as HTMLElement).closest('[data-drag-place]') as HTMLElement | null;
  if (!el || !e.dataTransfer) return;
  e.dataTransfer.setData('text/plain', el.dataset.dragPlace!);
  e.dataTransfer.effectAllowed = 'copy';
  root?.classList.add('dragging');
}
function onDragOver(e: DragEvent) {
  const z = (e.target as HTMLElement).closest('.drop');
  if (!z) return;
  e.preventDefault();
  z.classList.add('over');
}
function onDrop(e: DragEvent) {
  root?.classList.remove('dragging');
  const z = (e.target as HTMLElement).closest('[data-drop]') as HTMLElement | null;
  const id = e.dataTransfer?.getData('text/plain');
  if (!z || !id) return;
  e.preventDefault();
  addPlace(id, Number(z.dataset.drop));
}
