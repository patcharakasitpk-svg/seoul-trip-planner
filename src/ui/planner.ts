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
import { coordFixForm } from './views/library';
import { buildOwnPlace, OWN_CATEGORY_LABEL, type OwnCategory } from '../core/ownPlace';
import { legSummary } from './views/leg';
import { mealName, mealOf, newMeal, setMeal, MEALS, type Meal } from '../core/meals';
import { systemDayDefaults, recommendedStops } from '../core/dayDefaults';
import type { Day, Place, Stop, TravelMode } from '../core/types';
import type { DaySchedule } from '../core/schedule';
import { fmtDist, straightLineM } from '../core/geo';
import { ZONES, zoneOf, type Zone } from '../core/zones';
import { searchPlaces, placeFromResult, findExisting, resultMapsUrl, type SearchResult } from '../services/placeSearch';
import { uid } from '../core/planOps';
import { safeGet, safeSet } from '../storage/storage';
import { validatePlan } from '../storage/validate';

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
  /** เปิดฟอร์มเพิ่มสถานที่เอง */
  ownOpen: boolean;
  /** มีร่างที่ยังไม่ยืนยันเก็บไว้ (จากครั้งก่อน) — ถามว่าจะใช้ต่อไหม */
  restore: { draft: Day; savedAt: string } | null;
  /** จุดที่กำลังเขียนโน้ต และข้อความที่พิมพ์อยู่ (ยังไม่บันทึก — ไม่หายเมื่อแก้อย่างอื่น) */
  noteEdit: string | null;
  noteDraft: string;
  /** ตัวกรองในแท็บค้นหา: หมวด และย่าน */
  cat: string;
  zone: string;
  /** ค้นหาบนแผนที่ (นอกรายการที่เตรียมไว้) */
  web: { q: string; status: 'loading' | 'done' | 'error'; results: SearchResult[]; note?: string } | null;
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
  st = { step: 1, dayId, draft: withDefaults(clone(day)), lane: 'cards', q: '', slot: null, backToSummary: false, orig: clone(day), preview: null, web: null, cat: '', zone: '', noteEdit: null, noteDraft: '', ownOpen: false, restore: loadDraft(dayId, day) };
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
    root.addEventListener('submit', onSubmit);
  }
  root.hidden = false;
  fittedKey = '';
  document.body.classList.add('planner-open');
  render(true);
}

/* ---------- ร่างที่ยังไม่ยืนยัน: เก็บในเครื่องอัตโนมัติ (รีเฟรช/ปิดแท็บแล้วกู้คืนได้) ---------- */
const DRAFT_KEY = 'stp.v1.plannerDrafts';
type SavedDrafts = Record<string, { draft: Day; savedAt: string }>;
const draftKey = (dayId: string) => `${app.plan.id}:${dayId}`;
function readDrafts(): SavedDrafts {
  try {
    const v = JSON.parse(safeGet(DRAFT_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeDrafts(d: SavedDrafts) {
  safeSet(DRAFT_KEY, JSON.stringify(d));
}
const sameDay = (a: Day, b: Day) => JSON.stringify(a) === JSON.stringify(b);

/** ร่างที่เก็บไว้ของวันนี้ (ผ่านการตรวจแบบเดียวกับนำเข้าแผน) — ไม่มี/เหมือนแผนจริง = null */
function loadDraft(dayId: string, day: Day): { draft: Day; savedAt: string } | null {
  const s = readDrafts()[draftKey(dayId)];
  if (!s) return null;
  const v = validatePlan({ version: 1, id: 'draft', name: 'draft', days: [s.draft], customPlaces: [] });
  if (!v.ok || !v.plan.days[0]) return null;
  const draft = { ...v.plan.days[0], id: dayId };
  return sameDay(draft, withDefaults(clone(day))) ? null : { draft, savedAt: String(s.savedAt ?? '') };
}

/** เรียกทุกครั้งที่วาด: ร่างต่างจากแผนจริง → เก็บ · เหมือนกัน → ลบ */
function autosaveDraft() {
  if (!st || st.restore) return; // ยังไม่ได้ตอบว่าจะใช้ร่างเก่าไหม — อย่าเขียนทับ
  const all = readDrafts();
  const key = draftKey(st.dayId);
  if (sameDay(st.draft, withDefaults(clone(st.orig)))) delete all[key];
  else all[key] = { draft: st.draft, savedAt: new Date().toISOString() };
  writeDrafts(all);
}
function clearDraft(dayId: string) {
  const all = readDrafts();
  delete all[draftKey(dayId)];
  writeDrafts(all);
}
const hasUnsaved = () => !!st && !st.restore && !sameDay(st.draft, withDefaults(clone(st.orig)));
window.addEventListener('beforeunload', (e) => {
  if (root && !root.hidden && hasUnsaved()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

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

/** หลังบันทึกพิกัดเอง (ฟอร์มส่งไปที่ main) → วาดตัวจัดแผนใหม่ให้หมุดแดงขึ้น */
export function refreshPlanner() {
  if (st && root && !root.hidden) render();
}

function close() {
  endPick();
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
      <div class="pl-body"><div class="pl-main"></div><div class="pl-mapcol"><div class="pl-mapwrap"><div id="pl-map"></div><button class="pl-btn sm pl-mapfit" data-pl="map-fit" title="ซูมให้เห็นทุกจุดของวัน">พอดีจอ</button></div><p class="muted small">ตัวเลขบนหมุด = ลำดับ · เส้นประ = ลำดับการเดินทาง (ไม่ใช่เส้นทางจริง)</p></div></div>
      <footer class="pl-foot"></footer>`;
  }
  const $ = (sel: string) => root!.querySelector(sel) as HTMLElement;
  $('.pl-head').innerHTML = `
      <div class="pl-title"><b style="color:${dayColor(idx)}">วัน ${idx + 1}</b> ${d.date ? esc(fmtDateTh(d.date)) : ''} <span class="muted small">· ${hasUnsaved() ? 'ร่างเก็บในเครื่องแล้ว · กด “ยืนยันแผนวันนี้” เพื่อบันทึกลงแผน' : 'ยังไม่มีการแก้'}</span></div>
      <ol class="pl-steps">${STEPS.map(([n, t]) => `<li class="${st!.step === n ? 'on' : n < st!.step ? 'done' : ''}"><button data-pl="goto" data-v="${n}"><span>${n}</span>${t}</button></li>`).join('')}</ol>
      <button class="btn ghost sm" data-pl="cancel" title="ร่างจะเก็บไว้ในเครื่อง เปิดใหม่แล้วใช้ต่อได้">ปิด (ยังไม่ยืนยัน)</button>`;
  $('.pl-budget-wrap').innerHTML = st.step === 2 || st.step === 3 ? budgetBar(s) : '';
  $('.pl-body').className = `pl-body step-${st.step}`;
  const main = $('.pl-main');
  // คงตำแหน่งเลื่อนของทุกกล่อง (รายการแนะนำ + ช่องเวลาของวัน) — แก้แล้วไม่เด้งกลับไปจุดที่ 1
  const SCROLLERS = ['.pl-main', '.pl-lane-list', '.pl-day', '.pl-card'];
  const keep = SCROLLERS.map((sel) => (root!.querySelector(sel) as HTMLElement | null)?.scrollTop ?? 0);
  const sameStep = main.dataset.step === String(st.step);
  const banner = st.restore
    ? `<div class="pl-restore" role="alert"><b>มีร่างที่ยังไม่ยืนยันของวันนี้</b> (แก้ล่าสุด ${esc(st.restore.savedAt ? new Date(st.restore.savedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-')}) <button class="pl-btn primary sm" data-pl="draft-restore">ใช้ร่างนี้ต่อ</button><button class="pl-btn ghost sm" data-pl="draft-discard">ทิ้งร่าง</button></div>`
    : '';
  main.innerHTML = banner + (st.step === 1 ? step1() : st.step === 2 ? step2(s) : st.step === 3 ? step3(s) : step4(s));
  main.dataset.step = String(st.step);
  if (sameStep)
    SCROLLERS.forEach((sel, i) => {
      const el = root!.querySelector(sel) as HTMLElement | null;
      if (el) el.scrollTop = keep[i];
    });
  $('.pl-foot').innerHTML = footer();
  autosaveDraft();
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
/** เลขลำดับของแต่ละจุด (นับเฉพาะที่ไม่ข้าม) — ตรงกับตัวเลขบนหมุดแผนที่ */
function stopNumbers(d: Day): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const x of d.stops) if (!x.skipped) m.set(x.uid, ++n);
  return m;
}
const numBadge = (n: number | undefined, label?: string) => `<span class="pl-num" style="--c:${dayColor(app.dayIndex(st!.dayId))}">${label ?? n ?? ''}</span>`;

/** ชื่อสถานที่ = ลิงก์ดูรูปจริง (แท็บใหม่) · พัก/มื้อที่ยังไม่เลือกร้าน = ข้อความธรรมดา */
function nameLink(x: Stop): string {
  const p = placeOf(x);
  return p ? `<a class="pl-name" href="${esc(photosUrl(p))}" target="_blank" rel="noopener" title="ดูรูป ${esc(p.nameTh)}">${esc(nameOf(x))}<span class="pl-name-ico" aria-hidden="true">↗</span></a>` : `<b>${esc(nameOf(x))}</b>`;
}

/** ลิงก์ดูรูปสถานที่ (เปิดแท็บใหม่) — ชื่อแปลก ๆ จะได้นึกออกว่าหน้าตาเป็นยังไง */
const photoLink = (p: Place | undefined) => (p && p.category !== 'base' ? `<a class="pl-photo" href="${esc(photosUrl(p))}" target="_blank" rel="noopener" title="ดูรูป ${esc(p.nameTh)}">ดูรูป ↗</a>` : '');

const CATS: [string, string][] = [
  ['', 'ทั้งหมด'],
  ['food', 'อาหาร'],
  ['cafe', 'คาเฟ่'],
  ['fashion', 'เสื้อผ้า'],
  ['beauty', 'ความงาม/ของใช้'],
  ['market', 'ตลาด'],
  ['sight', 'เที่ยว'],
  ['base', 'จุดหลัก'],
];

const matchCat = (p: Place, cat: string) =>
  !cat || (cat === 'cafe' ? p.food?.type === 'cafe' : cat === 'food' ? p.category === 'food' && p.food?.type !== 'cafe' : p.category === cat);

function searchFilters(): string {
  const used = new Set(app.places().map((p) => zoneOf(p.area)));
  return `<div class="pl-filters">
    <div class="chips pl-cats">${CATS.map(([v, t]) => `<button class="chip ${st!.cat === v ? 'on' : ''}" data-pl="cat" data-v="${v}">${t}</button>`).join('')}</div>
    <label class="pl-zone">ย่าน <select class="inp sm" data-pl-change="zone"><option value="">ทุกย่าน</option>${(Object.keys(ZONES) as Zone[]).filter((z) => used.has(z)).map((z) => `<option value="${z}" ${st!.zone === z ? 'selected' : ''}>${esc(ZONES[z].th)}</option>`).join('')}</select></label>
  </div>`;
}

const distM = (a: Place, b: Place) => (a.lat == null || b.lat == null ? Infinity : straightLineM({ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! }));

/** ผลค้นหา: "ใกล้ <จุดก่อนช่องที่เลือก>" ก่อน แล้วแบ่งหัวข้อตามย่าน (ย่านที่ใกล้แผนวันนั้นขึ้นก่อน) */
function searchLane(): string {
  const q = st!.q.trim().toLowerCase();
  const list = app
    .places()
    .filter((p) => !q || [p.nameTh, p.thaiName, p.nameEn, p.nameKo, p.area, ...(p.food?.menu ?? [])].join(' ').toLowerCase().includes(q))
    .filter((p) => matchCat(p, st!.cat))
    .filter((p) => !st!.zone || zoneOf(p.area) === st!.zone);
  if (!list.length) return '<p class="muted">ไม่พบในรายการที่เตรียมไว้</p>';
  const anchor = anchorPlace();
  const dayPlaces = st!.draft.stops.map(placeOf).filter((p): p is Place => !!p && p.lat != null);
  const toDay = (p: Place) => (dayPlaces.length ? Math.min(...dayPlaces.map((a) => distM(a, p))) : anchor ? distM(anchor, p) : 0);
  const item = (p: Place) => laneItem(p, false);
  let html = '';
  // ใกล้จุดที่จะต่อ (เดินถึง ~1.2 กม.)
  if (anchor && anchor.lat != null) {
    const near = list
      .filter((p) => p.id !== anchor.id && p.category !== 'base' && !st!.draft.stops.some((x) => x.placeId === p.id))
      .map((p) => ({ p, d: distM(anchor, p) }))
      .filter((x) => x.d <= 1200)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    if (near.length)
      html += `<p class="pl-group near">ใกล้ ${esc(anchor.id === 'hotel' ? 'โรงแรม' : anchor.nameTh)} <span class="muted">(${st!.slot == null ? 'จุดสุดท้ายของวัน' : 'จุดก่อนช่องที่เลือก'} · เดินถึง)</span></p>${near.map((x) => item(x.p).replace('<span class="muted small">', `<span class="muted small"><b class="pl-dist">${fmtDist(x.d)}</b> · `)).join('')}`;
  }
  // แบ่งตามย่าน
  const groups = new Map<Zone, Place[]>();
  for (const p of list) {
    const z = zoneOf(p.area);
    groups.set(z, [...(groups.get(z) ?? []), p]);
  }
  const zoneDist = (ps: Place[]) => Math.min(...ps.map(toDay));
  const ordered = [...groups.entries()].sort((a, b) => zoneDist(a[1]) - zoneDist(b[1]));
  for (const [z, ps] of ordered) {
    ps.sort((a, b) => (a.category === 'base' ? -1 : 0) - (b.category === 'base' ? -1 : 0) || toDay(a) - toDay(b));
    html += `<p class="pl-group">${esc(ZONES[z].th)} <span class="muted">(${ps.length})</span></p>${ps.map(item).join('')}`;
  }
  return html;
}

/** ค้นหาบนแผนที่ (OSM/Google) เมื่อไม่เจอในรายการ — เลือกแล้วเพิ่มเป็นสถานที่ของแผน */
/** ฟอร์มเพิ่มสถานที่เอง: ชื่อ + หมวด + วางพิกัด/ลิงก์ Google Maps */
function ownBlock(): string {
  if (!st!.ownOpen) return `<div class="pl-web pl-own-wrap"><button class="pl-btn sm web" data-pl="own-open">＋ เพิ่มสถานที่เอง (ชื่อ + พิกัด)</button></div>`;
  const q = st!.q.trim();
  const gm = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${q || 'Seoul'} Seoul`)}`;
  return `<form class="pl-own" data-form="own-place">
    <p class="pl-group">เพิ่มสถานที่เอง</p>
    <label>ชื่อ<input class="inp" name="name" maxlength="120" required value="${esc(q)}" placeholder="ชื่อร้าน/สถานที่" data-autofocus></label>
    <label>หมวด<select class="inp" name="category">${(Object.keys(OWN_CATEGORY_LABEL) as OwnCategory[]).map((c) => `<option value="${c}">${OWN_CATEGORY_LABEL[c]}</option>`).join('')}</select></label>
    <label>พิกัด <a class="pl-photo" href="${esc(gm)}" target="_blank" rel="noopener">ดูตำแหน่งใน Google Maps ↗</a><input class="inp" name="coord" placeholder="วางรหัส เช่น HX7M+HQ8 หรือ 37.5438, 127.0557 (ไม่บังคับ)"></label>
    <button type="button" class="pl-btn sm web" data-pl="pick-map" data-target="own">เลือกตำแหน่งบนแผนที่ (แตะตรงร้าน)</button>
    <p class="muted small"><b>ง่ายสุด:</b> เปิดร้านใน Google Maps → หาบรรทัดรหัสแบบ <b>HX7M+HQ8 Seoul</b> (ไอคอนจุดตาราง) → กดค้าง/คัดลอก → วางในช่องด้านบน · หรือกดปุ่มแล้วแตะตรงร้านบนแผนที่ทางขวา · ลิงก์ย่อ maps.app.goo.gl ใช้ไม่ได้</p>
    <label>อยู่ประมาณ<span class="pl-field"><input class="inp xs" type="number" name="stay" min="5" max="600" value="45"> นาที</span></label>
    <div class="pl-note-actions"><button class="pl-btn primary sm" value="add">บันทึกแล้วใส่${st!.slot == null ? 'ท้ายวัน' : `ช่องที่ ${st!.slot + 1}`}</button><button class="pl-btn sm" value="save">บันทึกอย่างเดียว</button><button type="button" class="pl-btn ghost sm" data-pl="own-close">ยกเลิก</button></div>
  </form>`;
}

function webBlock(): string {
  const q = st!.q.trim();
  if (!q) return ownBlock();
  const w = st!.web && st!.web.q === q ? st!.web : null;
  const btn = `<button class="pl-btn sm web" data-pl="web-search">ค้นหา “${esc(q)}” บนแผนที่</button>`;
  if (!w) return `<div class="pl-web">${btn}<p class="muted small">ใช้เมื่อไม่เจอร้านที่ต้องการในรายการด้านบน</p></div>${ownBlock()}`;
  if (w.status === 'loading') return '<div class="pl-web"><p class="muted small">กำลังค้นหา…</p></div>';
  if (w.status === 'error') return `<div class="pl-web"><p class="bad-text small">${esc(w.note ?? 'ค้นหาไม่สำเร็จ')}</p>${btn}</div>`;
  if (!w.results.length) return '<div class="pl-web"><p class="muted small">ไม่พบบนแผนที่ — ลองชื่อภาษาอังกฤษหรือเกาหลี หรือเติมชื่อย่าน</p></div>';
  return `<div class="pl-web"><p class="pl-group">จากการค้นหาบนแผนที่${w.note ? ` <span class="muted">· ${esc(w.note)}</span>` : ''}</p>${w.results
    .map(
      (r, i) => `<div class="pl-item">
        <div class="pl-item-text"><b>${esc(r.name)}</b><span class="muted small">${esc(r.address ?? '')}</span></div>
        <a class="pl-photo" href="${esc(resultMapsUrl(r))}" target="_blank" rel="noopener">ดูใน Google Maps ↗</a>
        <button class="btn sm" data-pl="web-add" data-v="${i}" aria-label="ใส่ ${esc(r.name)}">＋</button>
      </div>`,
    )
    .join('')}</div>${ownBlock()}`;
}

async function runWebSearch() {
  const q = st!.q.trim();
  if (!q) return;
  st!.web = { q, status: 'loading', results: [] };
  render();
  try {
    const r = await searchPlaces(q);
    if (!st || st.q.trim() !== q) return;
    st.web = { q, status: 'done', results: r.results, note: r.note };
  } catch {
    if (!st) return;
    st.web = { q, status: 'error', results: [], note: app.online ? 'ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง' : 'ออฟไลน์ — ค้นหาไม่ได้' };
  }
  render();
}

function addWebResult(i: number) {
  const r = st!.web?.results[i];
  if (!r) return;
  let place = findExisting(app.plan.customPlaces, r);
  if (!place) {
    const created = placeFromResult(r, `custom-${uid('c')}`);
    app.commit((p) => p.customPlaces.push(created)); // สถานที่ที่เพิ่มเองของแผน (ใช้ได้ทุกวัน)
    place = created;
  }
  addPlace(place.id, st!.slot);
}

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
  return laneItemRow(p, on) + (on && p.lat == null ? `<div class="pl-nocoord">${coordFixForm(p).replace('</form>', `<button type="button" class="pl-btn sm web" data-pl="pick-map" data-target="${esc(p.id)}">เลือกตำแหน่งบนแผนที่ (แตะตรงร้าน)</button></form>`)}</div>` : '');
}

function laneItemRow(p: Place, on: boolean): string {
  const times = st!.draft.stops.filter((x) => x.placeId === p.id).length;
  return `<div class="pl-item ${times ? 'in' : ''} ${on ? 'preview' : ''}" draggable="true" data-drag-place="${esc(p.id)}">
    <button class="pl-item-text" data-pl="preview" data-place="${esc(p.id)}" aria-pressed="${on}" title="แตะเพื่อดูหมุดบนแผนที่"><b>${esc(p.nameTh)}</b><span class="muted small">${esc(CATEGORY_LABEL[p.category] ?? '')} · ${esc(p.area)}${p.suggestedStayMin ? ` · ราว ${fmtDur(p.suggestedStayMin)}` : ''}</span>${on ? previewInfo(p) : ''}</button>
    ${photoLink(p)}
    ${p.lat == null ? '<span class="pl-in-tag muted">ยังไม่มีพิกัด</span>' : ''}
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
    laneBody = searchLane() + webBlock();
  }
  const slotLabel = st!.slot == null ? 'ท้ายวัน' : `ช่องที่ ${st!.slot + 1}`;
  return `<div class="pl-lanes">
    <section class="pl-lane left">
      <div class="seg pl-lane-tabs"><button class="${st!.lane === 'cards' ? 'on' : ''}" data-pl="lane" data-v="cards">แผนแนะนำ</button><button class="${st!.lane === 'search' ? 'on' : ''}" data-pl="lane" data-v="search">ค้นหาทั้งหมด</button></div>
      ${st!.lane === 'search' ? `<input class="inp" type="search" placeholder="ค้นหาร้าน ย่าน เมนู (ไทย/อังกฤษ/เกาหลี)" value="${esc(st!.q)}" data-pl-input="q" data-autofocus>${searchFilters()}` : ''}
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

/** ร้านอาหาร/คาเฟ่/ตลาด/ช่องมื้อ: เลือกมื้อแบบ dropdown (แสดงสถานะในตัว) */
const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];
function mealSelect(x: Stop): string {
  const p = placeOf(x);
  if (!(x.kind === 'dinner' || p?.category === 'food' || p?.category === 'market')) return '';
  const cur = x.kind === 'dinner' ? mealOf(x) : '';
  const none = x.kind === 'dinner' && !x.placeId ? '' : `<option value="" ${cur === '' ? 'selected' : ''}>ไม่ใช่มื้ออาหาร</option>`;
  return `<span class="pl-meal">มื้อ <select class="inp xs ${cur ? 'on' : ''}" data-pl-change="meal" data-uid="${x.uid}" aria-label="มื้อ">${none}${MEAL_ORDER.map((m) => `<option value="${m}" ${cur === m ? 'selected' : ''}>${MEALS[m].th.replace('มื้อ', '')}</option>`).join('')}</select></span>`;
}

/** โน้ต "จะไปทำอะไรที่นี่": แสดง / แก้ไข (กดบันทึก) */
function noteBlock(x: Stop): string {
  if (st!.noteEdit === x.uid)
    return `<div class="pl-note-edit"><textarea class="inp" rows="2" maxlength="500" placeholder="จะไปทำอะไรที่นี่ เช่น ซื้อ… / กินเมนู… / ถ่ายรูปที่…" data-pl-input="note" data-autofocus>${esc(st!.noteDraft)}</textarea>
      <div class="pl-note-actions"><button class="pl-btn primary sm" data-pl="note-save" data-uid="${x.uid}">บันทึก</button><button class="pl-btn ghost sm" data-pl="note-cancel">ยกเลิก</button></div></div>`;
  return x.note
    ? `<div class="pl-note"><span>${esc(x.note)}</span><button class="link small" data-pl="note-edit" data-uid="${x.uid}">แก้</button></div>`
    : `<button class="link small pl-note-add" data-pl="note-edit" data-uid="${x.uid}">＋ โน้ต (จะไปทำอะไร)</button>`;
}

/** เลนขวา: เวลาไหลต่อกัน · ช่องวาง (drop) ระหว่างทุกรายการ · ช่วงว่างแสดงเป็นช่องใหญ่ */
function dayLane(s: DaySchedule): string {
  const d = st!.draft;
  const rows: string[] = [];
  const drop = (i: number, label = '', big = false) =>
    `<div class="drop ${big ? 'big' : ''} ${st!.slot === i ? 'sel' : ''}" data-drop="${i}" data-pl="slot" data-v="${i}">${label || (st!.slot === i ? 'ช่องที่เลือก — กด ＋ ทางซ้าย' : '＋ วางที่นี่')}</div>`;
  const nums = stopNumbers(d);
  rows.push(`<div class="pl-row edge"><span class="t">${esc(d.startTime ?? '--:--')}</span><span>${numBadge(undefined, 'เริ่ม')} ออกจาก <b>${esc(shortName(app.getPlace(d.startPlaceId)))}</b></span></div>`);
  s.stops.forEach((t, i) => {
    rows.push(t.wait > 0 ? drop(i, `ว่าง ${fmtDur(t.wait)} ก่อนนัด — วางสถานที่ที่นี่`, true) : drop(i));
    const x = t.stop;
    const isMove = x.kind === 'place' || x.kind === 'dinner';
    rows.push(`
      ${isMove && t.leg.fromId && t.leg.toId && t.leg.fromId !== t.leg.toId ? `<div class="pl-travel">${legSummary(t.leg)}</div>` : ''}
      <div class="pl-row stop ${x.lockedTime ? 'locked' : ''}" data-uid="${x.uid}">
        <span class="t">${t.start != null ? fmtHM(t.start) : '--:--'}</span>
        <div class="pl-row-main">
          ${numBadge(nums.get(x.uid))} ${nameLink(x)}${x.lockedTime ? ` <span class="pill">นัด ${esc(x.lockedTime)}</span>` : ''}
          <div class="pl-stay">อยู่ <select class="inp xs" data-pl-change="stay" data-uid="${x.uid}" aria-label="อยู่นานเท่าไร">${[...new Set([...STAY_CHOICES, x.stayMin])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === x.stayMin ? 'selected' : ''}>${fmtDur(m)}</option>`).join('')}</select>
            ${defaultStay(x) != null && defaultStay(x) !== x.stayMin ? resetBtn('reset-stay', x.uid, `คืนเวลาที่แนะนำ (${fmtDur(defaultStay(x)!)})`) : ''}
            ${t.depart != null ? `<span class="muted small">ถึง ${fmtHM(t.depart)}</span>` : ''}
            ${mealSelect(x)}
            ${t.lateMin ? `<span class="bad-text small">สาย ${fmtDur(t.lateMin)}</span>` : ''}
            ${t.warnings.find((w) => w.startsWith('ปิด')) ? `<span class="bad-text small">${esc(t.warnings.find((w) => w.startsWith('ปิด'))!)}</span>` : ''}</div>
          ${noteBlock(x)}
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
    rows.push(`<div class="pl-travel">${legSummary(s.end.leg)}</div>`);
    rows.push(`<div class="pl-row edge"><span class="t">${s.end.arrive != null ? fmtHM(s.end.arrive) : '--:--'}</span><span>${numBadge(undefined, 'จบ')} ถึง <b>${esc(shortName(app.getPlace(d.endPlaceId)))}</b>${s.end.slackMin != null && s.end.slackMin < 0 ? ` <span class="bad-text small">เกิน ${esc(d.endTime ?? '')} ${fmtDur(-s.end.slackMin)}</span>` : ''}</span></div>`);
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
        <td>${esc(shortName(l.from))} → <b>${esc(shortName(l.to))}</b><br><span class="muted small">${legSummary(l.leg)}</span></td>
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
  const nums = stopNumbers(d);
  rows.push(`<li class="sum-edge"><span class="t">${esc(d.startTime ?? '--:--')}</span><span>${numBadge(undefined, 'เริ่ม')} ออกจาก <b>${esc(shortName(app.getPlace(d.startPlaceId)))}</b></span>${edit(1)}</li>`);
  for (const t of s.stops) {
    if (t.stop.skipped) continue;
    const isMove = t.stop.kind === 'place' || t.stop.kind === 'dinner';
    if (isMove && t.leg.fromId !== t.leg.toId && t.leg.travelMin != null) rows.push(`<li class="sum-leg"><span></span><span>${legSummary(t.leg)}</span>${edit(3)}</li>`);
    rows.push(`<li class="sum-stop"><span class="t">${t.start != null ? fmtHM(t.start) : '--:--'}</span><span class="sum-body">
      <span class="sum-name">${numBadge(nums.get(t.stop.uid))} ${nameLink(t.stop)}${t.stop.kind === 'dinner' && t.stop.placeId ? ` <span class="pl-meal-tag">${esc(mealName(t.stop))}</span>` : ''}</span>
      <span class="sum-meta">อยู่ ${fmtDur(t.stop.stayMin)}${t.depart != null ? ` · ถึง ${fmtHM(t.depart)}` : ''}${t.stop.lockedTime ? ` · นัด ${esc(t.stop.lockedTime)}` : ''}${t.lateMin ? ` · <span class="bad-text">สาย ${fmtDur(t.lateMin)}</span>` : ''}</span>
      ${t.stop.note ? `<span class="pl-note sum">${esc(t.stop.note)}</span>` : ''}
    </span>${edit(2)}</li>`);
  }
  if (s.end) {
    rows.push(`<li class="sum-leg"><span></span><span>${legSummary(s.end.leg)}</span>${edit(3)}</li>`);
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
    map.on('click', (e: L.LeafletMouseEvent) => onMapPick(e.latlng.lat, e.latlng.lng));
  }
  layer!.clearLayers();
  pickMarker?.remove();
  pickMarker = null;
  if (!layer) return;
  const d = st!.draft;
  const pts: { p: Place; label: string }[] = [];
  const start = app.getPlace(d.startPlaceId);
  if (start?.lat != null) pts.push({ p: start, label: 'เริ่ม' });
  const nums = stopNumbers(d);
  for (const t of s.stops) {
    if (t.stop.skipped) continue;
    const p = placeOf(t.stop);
    if (p?.lat != null) pts.push({ p, label: String(nums.get(t.stop.uid)) });
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
  let pvPoint: [number, number] | null = null;
  if (pv?.lat != null) {
    const a = anchorPlace();
    pvPoint = [pv.lat, pv.lng!];
    if (a?.lat != null) L.polyline([[a.lat, a.lng!], pvPoint], { color: '#e03131', weight: 4, opacity: 0.85, dashArray: '8 8' }).addTo(layer!);
    L.marker(pvPoint, { icon: L.divIcon({ className: 'pl-pin preview', html: `<span>${esc(pv.nameTh)}</span>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(layer!);
  }
  // ซูมอัตโนมัติเฉพาะตอนเปิด/เปลี่ยนวัน/เปลี่ยนขั้น หรือกด "พอดีจอ" — แก้/เพิ่มแล้วแผนที่ค้างที่เดิม (ไม่เด้งออกไปมุมกว้าง)
  // ซูมให้พอดีจุดแวะของวัน (ไม่รวมจุดเริ่ม/จบที่อยู่ไกล เช่นสนามบิน)
  const stopPts = pts.filter((x) => x.label !== 'เริ่ม' && x.label !== 'จบ').map((x) => [x.p.lat!, x.p.lng!] as [number, number]);
  const focus = stopPts.length ? stopPts : path;
  const key = `${st!.dayId}|${st!.step}`;
  const doFit = forceFit || fittedKey !== key;
  forceFit = false;
  const fit = () => {
    if (!map) return;
    map.invalidateSize(); // กล่องแผนที่ขยายหลังสร้าง → คำนวณขนาดใหม่ ไม่ให้แผนที่โหลดแค่บางส่วน
    if (doFit) {
      if (focus.length) map.fitBounds(L.latLngBounds(focus), { padding: [48, 48], maxZoom: 16 });
      else map.setView([37.5665, 126.978], 12);
    } else if (pvPoint && !map.getBounds().pad(-0.1).contains(pvPoint)) {
      map.panTo(pvPoint); // หมุดแดงอยู่นอกจอ → เลื่อนไปหา โดยไม่เปลี่ยนระดับซูม
    }
  };
  fittedKey = key;
  fit();
  requestAnimationFrame(fit);
}
let fittedKey = '';
let forceFit = false;

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
  const emptyMeal = p.category === 'food' ? d.stops.find((x) => x.kind === 'dinner' && !x.placeId && (p.food?.type !== 'cafe' || mealOf(x) === 'snack')) : undefined;
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
      close(); // ร่างยังเก็บไว้ — เปิดใหม่จะถามว่าจะใช้ต่อไหม
      return;
    case 'draft-restore':
      if (st.restore) st.draft = st.restore.draft;
      st.restore = null;
      break;
    case 'draft-discard':
      st.restore = null;
      clearDraft(st.dayId);
      break;
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
    case 'pick-map':
      startPick(el.dataset.target ?? 'own');
      return;
    case 'pick-cancel':
      endPick();
      return;
    case 'map-fit':
      forceFit = true;
      if (st) drawMap(sched());
      return;
    case 'own-open':
      st.ownOpen = true;
      break;
    case 'own-close':
      st.ownOpen = false;
      break;
    case 'note-edit':
      st.noteEdit = el.dataset.uid ?? null;
      st.noteDraft = st.draft.stops.find((y) => y.uid === st!.noteEdit)?.note ?? '';
      break;
    case 'note-cancel':
      st.noteEdit = null;
      break;
    case 'note-save': {
      const ta = el.closest('.pl-note-edit')?.querySelector('textarea') as HTMLTextAreaElement | null;
      st.draft = updateStop(st.draft, el.dataset.uid!, { note: (ta?.value ?? '').trim().slice(0, 500) });
      st.noteEdit = null;
      break;
    }
    case 'cat':
      st.cat = v ?? '';
      break;
    case 'web-search':
      void runWebSearch();
      return;
    case 'web-add':
      addWebResult(Number(v));
      return;
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
      clearDraft(dayId);
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

/** ข้อความผิดพลาดค้างใต้ฟอร์ม (ไม่วาดใหม่ทั้งหน้า สิ่งที่พิมพ์ไว้ไม่หาย) */
function showFormError(form: HTMLElement, msg: string) {
  let el = form.querySelector('.pl-own-error') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'pl-own-error';
    el.setAttribute('role', 'alert');
    form.querySelector('[name="coord"]')?.insertAdjacentElement('afterend', el) ?? form.append(el);
  }
  el.textContent = msg;
}

/* ---------- เลือกตำแหน่งด้วยการแตะบนแผนที่ ---------- */
let pickFor: string | null = null; // 'own' = ฟอร์มเพิ่มสถานที่เอง · อื่น ๆ = placeId ของกรอบ "ยังไม่มีพิกัด"
let pickMarker: L.Marker | null = null;

function startPick(target: string) {
  pickFor = target;
  root?.classList.add('picking');
  const wrap = root?.querySelector('.pl-mapwrap');
  if (wrap && !wrap.querySelector('.pl-pick-hint'))
    wrap.insertAdjacentHTML('beforeend', '<div class="pl-pick-hint">แตะบนแผนที่ตรงตำแหน่งร้าน <button class="pl-btn ghost sm" data-pl="pick-cancel">ยกเลิก</button></div>');
}

function endPick() {
  pickFor = null;
  root?.classList.remove('picking');
  root?.querySelector('.pl-pick-hint')?.remove();
}

function onMapPick(lat: number, lng: number) {
  if (!pickFor || !root) return;
  const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const form = (pickFor === 'own' ? root.querySelector('form[data-form="own-place"]') : root.querySelector(`.pl-nocoord form[data-place="${CSS.escape(pickFor)}"]`)) as HTMLFormElement | null;
  const inp = form?.querySelector('[name="coord"]') as HTMLInputElement | null;
  if (inp) inp.value = text;
  form?.querySelector('.pl-own-error')?.remove();
  pickMarker?.remove();
  if (map) pickMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'pl-pin preview', html: '<span>ตำแหน่งที่เลือก</span>', iconSize: [0, 0] }), zIndexOffset: 1200 }).addTo(map);
  endPick();
}

/** ฟอร์มเพิ่มสถานที่เอง (จัดการในตัวจัดแผน ไม่ส่งต่อให้หน้าหลัก) */
function onSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  if (form.dataset.form !== 'own-place' || !st) return;
  e.preventDefault();
  e.stopPropagation();
  const fd = new FormData(form);
  const r = buildOwnPlace(
    { id: `custom-${uid('c')}`, name: String(fd.get('name') ?? ''), category: String(fd.get('category') ?? ''), coord: String(fd.get('coord') ?? ''), stay: Number(fd.get('stay')) },
    app.places(),
  );
  if (!r.ok) {
    showFormError(form, r.error);
    return;
  }
  app.commit((p) => void p.customPlaces.push(r.place));
  st.ownOpen = false;
  const add = (e.submitter as HTMLButtonElement | null)?.value === 'add';
  app.showToast(add ? `เพิ่ม ${r.place.nameTh} ลงแผนแล้ว` : `บันทึก ${r.place.nameTh} แล้ว — ค้นหาแล้วกด ＋ เพื่อใส่`);
  if (add) addPlace(r.place.id, st.slot);
  else render();
}

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.plChange;
  if (!k || !st) return;
  const d = st.draft;
  switch (k) {
    case 'day': {
      const day = app.findDay(el.value);
      if (day) Object.assign(st, { dayId: day.id, draft: withDefaults(clone(day)), orig: clone(day), slot: null, restore: loadDraft(day.id, day) });
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
    case 'zone':
      st.zone = el.value;
      break;
    case 'meal': {
      const x = d.stops.find((y) => y.uid === el.dataset.uid);
      if (!x) return;
      const next = setMeal(x, (el.value || null) as Meal | null);
      st.draft = { ...d, stops: d.stops.map((y) => (y.uid === x.uid ? next : y)) };
      break;
    }
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
  if (el.dataset.plInput === 'note' && st) {
    st.noteDraft = el.value;
    return;
  }
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
