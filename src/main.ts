import './style.css';
import QRCode from 'qrcode';
import { app, type Tab } from './ui/app';
import { renderLibraryControls, renderLibraryList } from './ui/views/library';
import { renderDayPanel, renderDayTabs } from './ui/views/day';
import { renderToday } from './ui/views/today';
import { renderModal } from './ui/views/modals';
import { esc, MODE_LABEL } from './ui/util';
import { loadGoogle, googleStatus, onGoogleStatus } from './services/google';
import { startOsm, switchToGoogle, onMapMarkerClick, mapViewReady, syncMapView, focusMapView, refreshMapSize, mapProvider } from './services/mapView';
import { buildMapSpecs } from './ui/mapSpecs';
import { onRoutesChange } from './services/routes';
import { onWeatherChange, ensureWeather } from './services/weather';
import { moveStopToDay, insertStop, moveStop, newDay, newStop, dinnerSlot, removeStop, updateStop, reorderStops, newPlan, clone, defaultInsertIndex, applyTripDates } from './core/planOps';
import type { Day, Place, Plan, Stop, TravelMode } from './core/types';
import { suggestOrder } from './core/compare';
import { decodeFragment, parseJsonPlan, buildShareUrl, exportablePlan } from './storage/share';
import { saveSettings, loadPlans } from './storage/storage';
import { TEMPLATES, templateDayStops, applyDatedTemplate, mergeDayStops } from './data/templates';
import { tplTargetDay } from './ui/views/modals';
import { fmtDateTh, fmtDur, fmtHM, parseHM, seoulNow } from './core/time';
import { stopLocationId } from './core/schedule';
import { searchPlaces, placeFromResult, findExisting } from './services/placeSearch';
import { SEARCH_PREFIX } from './ui/mapSpecs';
import { RoomSync, inviteUrl, newRoomId, roomFromHash, toRoomDoc, fromRoomDoc, shouldApplyRemote, type RoomDoc, type SyncState } from './services/sync';
import { SYNC_DB_URL } from './config';
import { loadFx, saveFx, needsRefresh, fetchRate, activeRate, parseAmount } from './services/fx';
import { renderFx, fxResult, formatTyping, type FxUi } from './ui/views/fx';
import { safeGet, safeSet } from './storage/storage';

const hadSavedPlans = loadPlans() != null;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

document.querySelector('#app')!.innerHTML = `
<header class="topbar">
  <div class="brand"><b>Seoul Trip</b><span class="plan-name" id="plan-name"></span></div>
  <nav class="top-actions">
    <div class="seg desk-only"><button data-act="tab" data-tab="today">วันนี้</button><button data-act="tab" data-tab="plan">แผน</button><button data-act="tab" data-tab="fx">₩→฿</button></div>
    <button class="btn ghost sm" data-act="open-templates" title="แม่แบบ">แม่แบบ</button>
    <button class="btn ghost sm" data-act="open-share" title="แชร์และบันทึก">แชร์</button>
    <button class="icon-btn" data-act="open-settings" aria-label="ตั้งค่า" title="ตั้งค่า">⚙︎</button>
  </nav>
</header>
<div id="status-bar" class="status-bar"></div>
<div id="day-tabs-wrap"></div>
<main class="layout" id="layout">
  <aside class="panel lib" id="library" aria-label="สถานที่"><div id="lib-controls"></div><div id="lib-list"></div></aside>
  <section class="panel mapp" id="map-panel" aria-label="แผนที่">
    <div class="map-tools" id="map-tools"></div>
    <div class="map-box"><div id="map"></div></div>
    <p class="map-legend">ตัวเลข = ลำดับในวัน · เส้นประ = ลำดับการเดินทาง ไม่ใช่เส้นทางจริง</p>
  </section>
  <section class="panel right" id="right" aria-live="polite"></section>
</main>
<section id="fx" class="fx" aria-label="แปลงสกุลเงิน"></section>
<nav class="bottom-nav" aria-label="เมนูหลัก">
  <button data-act="tab" data-tab="today"><span aria-hidden="true">◷</span>วันนี้</button>
  <button data-act="tab" data-tab="map"><span aria-hidden="true">⌖</span>แผนที่</button>
  <button data-act="tab" data-tab="places"><span aria-hidden="true">☰</span>สถานที่</button>
  <button data-act="tab" data-tab="plan"><span aria-hidden="true">▤</span>แผนของฉัน</button>
  <button data-act="tab" data-tab="fx"><span aria-hidden="true">₩</span>แปลงเงิน</button>
</nav>
<div id="modal-root"></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>`;

let lastLibControlsSig = '';

function render() {
  $('#plan-name').textContent = app.plan.name;
  document.body.dataset.tab = app.tab;
  document.querySelectorAll('[data-act="tab"]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === app.tab));
  // status
  const g = googleStatus();
  const st: string[] = [];
  if (!app.online) st.push('<span class="warn">ออฟไลน์ — ดูแผนที่บันทึกไว้ได้ แต่แผนที่ออนไลน์ เส้นทาง และอากาศยังอัปเดตไม่ได้</span>');
  if (g.status === 'error') st.push(`<span class="warn">Google Maps ใช้ไม่ได้ (${esc(g.error)}) — ใช้แผนที่ OpenStreetMap แทน</span>`);
  if (!app.storageOk) st.push('<span class="warn">บันทึกในเครื่องไม่ได้ — โปรด Export JSON ก่อนปิดหน้า</span>');
  else if (!app.saveOk) st.push('<span class="warn">บันทึกล่าสุดไม่สำเร็จ — โปรด Export JSON</span>');
  ensureSync();
  if (syncState.status === 'live') st.push(`<span class="sync ok">🔗 ซิงก์กับเพื่อน${syncState.lastAt ? ` · ล่าสุด ${esc(new Date(syncState.lastAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }))}` : ''}</span>`);
  else if (syncState.status === 'connecting') st.push('<span class="sync">🔗 กำลังเชื่อมต่อแผนร่วม…</span>');
  else if (syncState.status === 'pending') st.push('<span class="warn">🔗 ยังส่งการแก้ให้เพื่อนไม่ได้ (ออฟไลน์?) — จะส่งเองเมื่อออนไลน์</span>');
  else if (syncState.status === 'error') st.push(`<span class="warn">🔗 ซิงก์ไม่ได้: ${esc(syncState.message)}</span>`);
  $('#status-bar').innerHTML = st.join('');
  $('#day-tabs-wrap').innerHTML = renderDayTabs();

  const sig = JSON.stringify([app.expanded.has('filters'), app.filters.cat, app.filters.area, app.filters.budget, app.filters.stay, app.filters.zone, app.filters.fashion, app.refPoint, app.plan.customPlaces.length, app.activeDayId, app.day.stops.length]);
  if (sig !== lastLibControlsSig || !$('#lib-controls').innerHTML) {
    const active = document.activeElement as HTMLElement | null;
    const typing = active?.dataset?.filter === 'q';
    if (!typing) $('#lib-controls').innerHTML = renderLibraryControls();
    lastLibControlsSig = sig;
  }
  $('#lib-list').innerHTML = renderLibraryList();
  $('#right').innerHTML = app.tab === 'today' ? renderToday() : renderDayPanel(app.day);
  // คงตำแหน่งเลื่อนในหน้าต่าง (เช่นกด ＋ ในแม่แบบหลายครั้ง) ไม่ให้เด้งกลับบนสุด
  const prevModal = document.querySelector('#modal-root .modal-body') as HTMLElement | null;
  const keepScroll = prevModal && app.modal ? { type: app.modal.type, top: prevModal.scrollTop } : null;
  $('#modal-root').innerHTML = renderModal();
  const nextModal = document.querySelector('#modal-root .modal-body') as HTMLElement | null;
  if (keepScroll && nextModal && app.modal?.type === keepScroll.type) nextModal.scrollTop = keepScroll.top;
  document.body.classList.toggle('modal-open', !!app.modal);
  $('#toast').innerHTML = app.toast ? `${esc(app.toast.msg)}${app.toast.undo ? ' <button class="toast-undo" data-act="toast-undo">เลิกทำ</button>' : ''}` : '';
  $('#toast').classList.toggle('has-action', !!app.toast?.undo);
  $('#toast').classList.toggle('show', !!app.toast);
  renderFxPage();
  renderMapTools();
  syncMapNow();
  if (app.modal?.type === 'share') drawQr();
  app.flushRouteNeeds();
}
app.renderFn = render;

/* ---------------- แผนที่ ---------------- */
function renderMapTools() {
  $('#map-tools').innerHTML = `
    <div class="seg"><button class="${app.mapFilter === 'day' ? 'on' : ''}" data-act="map-filter" data-v="day">วันที่เลือก</button><button class="${app.mapFilter === 'all' ? 'on' : ''}" data-act="map-filter" data-v="all">ทุกวัน</button></div>
    <label class="small"><input type="checkbox" data-act-change="lib-pins" ${app.showLibPins ? 'checked' : ''}> แสดงสถานที่ทั้งหมด</label>
    <button class="btn ghost xs" data-act="map-fit">พอดีจอ</button>
    <span class="muted small map-src">${mapProvider() === 'google' ? 'Google Maps' : 'OpenStreetMap (ฟรี)'}</span>`;
}

function syncMapNow() {
  if (!mapViewReady()) return;
  const { markers, lines } = buildMapSpecs({
    days: app.mapFilter === 'all' ? app.plan.days : [app.day],
    allDays: app.plan.days,
    mode: app.mapFilter,
    getPlace: app.getPlace,
    schedule: (d) => app.schedule(d),
    libraryPlaces: app.showLibPins ? app.places() : null,
    searchResults: app.search?.results ?? null,
    focusSearch: app.fitSearch,
  });
  syncMapView(markers, lines, app.fitNext || app.fitSearch);
  app.fitNext = false;
  app.fitSearch = false;
}

onMapMarkerClick((id) => {
  if (id.startsWith(SEARCH_PREFIX)) {
    showSearchResult(Number(id.slice(SEARCH_PREFIX.length)));
    return;
  }
  app.focusPlaceId = id;
  app.modal = { type: 'place', placeId: id };
  app.requestRender();
});

/* ---------------- ค้นหาสถานที่ใดก็ได้ (Google / OSM) ---------------- */
let searchAbort: AbortController | null = null;
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

async function runWebSearch() {
  const q = app.filters.q.trim();
  if (!q) return;
  searchAbort?.abort();
  const ctl = new AbortController();
  searchAbort = ctl;
  app.search = { q, status: 'loading', results: [], focus: null };
  app.requestRender();
  try {
    const r = await searchPlaces(q, ctl.signal);
    if (ctl.signal.aborted) return;
    app.search = { q, status: 'done', provider: r.provider, results: r.results, note: r.note, focus: null };
    app.fitSearch = r.results.length > 0;
    if (r.results.length && isDesktop()) setTimeout(refreshMapSize, 0);
  } catch (e) {
    if (ctl.signal.aborted) return;
    console.warn('place search failed', e);
    app.search = { q, status: 'error', results: [], focus: null, note: app.online ? 'ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง' : 'ออฟไลน์ — ค้นหาไม่ได้' };
  }
  app.requestRender();
}

/** แตะหมุดผลค้นหาบนแผนที่ → ไปที่การ์ดในรายการ */
function showSearchResult(i: number) {
  if (!app.search?.results[i]) return;
  app.search.focus = i;
  if (!isDesktop()) app.tab = 'places';
  app.requestRender();
  setTimeout(() => document.querySelector(`[data-search-card="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
}

function addSearchResult(i: number) {
  const r = app.search?.results[i];
  if (!r) return;
  let place = findExisting(app.plan.customPlaces, r);
  if (!place) {
    const created = placeFromResult(r, `custom-${app.newUid('c')}`);
    app.commit((p) => p.customPlaces.push(created));
    place = created;
  }
  quickToggle(place.id);
}

/* ---------------- แปลงเงิน วอน ↔ บาท ---------------- */
let fxStore = loadFx();
const fxUi: FxUi = { dir: 'krw2thb', amount: '', editingRate: false, loading: false };
let fxSig = '';

function renderFxPage() {
  if (app.tab !== 'fx') {
    fxSig = '';
    return;
  }
  if (needsRefresh(fxStore) && app.online && !fxUi.loading) void refreshFx();
  // วาดใหม่เฉพาะเมื่อโครงเปลี่ยน — ระหว่างพิมพ์อัปเดตแค่ผลลัพธ์ (แป้นพิมพ์มือถือไม่หุบ)
  const sig = JSON.stringify([fxUi.dir, fxUi.editingRate, fxUi.loading, fxStore, app.online]);
  if (sig === fxSig) return;
  fxSig = sig;
  $('#fx').innerHTML = renderFx(fxUi, fxStore, app.online);
}

async function refreshFx(manual = false) {
  fxUi.loading = true;
  app.requestRender();
  const r = await fetchRate();
  fxUi.loading = false;
  if (r) {
    fxStore = { ...fxStore, ...r, fetchedAt: Date.now() };
    saveFx(fxStore);
    if (manual) app.showToast('อัปเดตอัตราแลกเปลี่ยนแล้ว');
  } else if (manual) app.showToast('อัปเดตอัตราไม่ได้ — ใช้อัตราล่าสุดที่จำไว้');
  app.requestRender();
}

function setFxAmount(v: string) {
  fxUi.amount = v;
  const inp = document.getElementById('fx-in') as HTMLInputElement | null;
  if (inp && inp.value !== v) inp.value = v;
  const out = document.getElementById('fx-out');
  if (out) out.textContent = fxResult(fxUi, fxStore);
}

/* ---------------- ซิงก์สดกับเพื่อน ---------------- */
const clientId = (() => {
  const k = 'stp.v1.client';
  const v = safeGet(k);
  if (v) return v;
  const n = newRoomId(16);
  safeSet(k, n);
  return n;
})();
let sync: RoomSync | null = null;
export let syncState: SyncState = { status: 'off' };
/** ห้องที่เพิ่งกดลิงก์เข้ามา — แผนในเครื่องเป็นแผนว่างชั่วคราว ต้องรับจากห้องเท่านั้น */
let joiningRoom: string | null = null;
let lastRemoteToast = 0;

function ensureSync() {
  const roomId = SYNC_DB_URL ? app.plan.roomId ?? null : null;
  if (sync && sync.roomId === roomId) return;
  sync?.stop();
  sync = null;
  syncState = { status: 'off' };
  if (!roomId) return;
  sync = new RoomSync(SYNC_DB_URL, roomId, clientId, onRemote, (s) => {
    syncState = s;
    app.requestRender();
  });
  sync.start();
  sync.push(toRoomDoc(app.plan, clientId)); // ส่งเมื่อห้องพร้อม (ถ้าห้องมีแผนอยู่แล้ว จะรับของห้องก่อน)
}

function onRemote(doc: RoomDoc | null) {
  const s = sync;
  if (!s) return;
  const plan = app.plan;
  if (!doc) {
    if (joiningRoom === s.roomId) {
      // ลิงก์เก่า/ห้องว่าง → ไม่สร้างห้องจากแผนว่าง: ยกเลิกการซิงก์ของแผนชั่วคราวนี้
      joiningRoom = null;
      s.clearPending();
      app.commit((p) => {
        p.roomId = null;
      }, 'ไม่พบแผนในลิงก์นี้ — ให้เพื่อนกด “เริ่มแชร์แผนนี้กับเพื่อน” แล้วส่งลิงก์ใหม่');
    }
    return; // ห้องว่าง: แผนในเครื่องจะถูกส่งขึ้นไป (pending)
  }
  const joining = joiningRoom === s.roomId;
  // ในเครื่องมีการแก้ที่ยังไม่ได้ส่ง → ของเราเป็น "ตัวล่าสุด" จะส่งทับ (ยกเว้นเพิ่งเข้าห้อง)
  if (!joining && s.hasPending()) return;
  const localDoc = toRoomDoc(plan, clientId).plan;
  if (!joining && !shouldApplyRemote(doc, clientId, localDoc)) return;
  const next = fromRoomDoc(doc, { id: plan.id, roomId: s.roomId });
  if (!next) {
    app.showToast('ข้อมูลแผนจากเพื่อนอ่านไม่ได้ — ข้ามไป');
    return;
  }
  if (joining) s.clearPending(); // ทิ้งแผนว่างชั่วคราวที่ค้างส่ง
  s.lastSent = toRoomDoc(next, clientId).plan;
  const keepDay = next.days.some((d) => d.id === app.activeDayId) ? app.activeDayId : next.days[0].id;
  app.store.plans = app.store.plans.map((x) => (x.id === plan.id ? next : x));
  app.activeDayId = keepDay;
  app.persist();
  if (joining) {
    joiningRoom = null;
    app.fitNext = true;
    app.showToast(`เข้าร่วมแผน “${next.name}” แล้ว — แก้ได้ทั้งคู่ อัปเดตสด`);
  } else if (Date.now() - lastRemoteToast > 4000) {
    lastRemoteToast = Date.now();
    app.showToast('เพื่อนแก้แผน — อัปเดตแล้ว');
  }
  app.requestRender();
}

app.onPersist = () => {
  if (!sync || app.plan.roomId !== sync.roomId) return;
  if (joiningRoom === sync.roomId) return; // ห้ามส่งแผนว่างชั่วคราว
  sync.push(toRoomDoc(app.plan, clientId));
};

function startSharing() {
  if (!SYNC_DB_URL) return;
  const roomId = newRoomId();
  app.commit((p) => {
    p.roomId = roomId;
  });
}

function stopSharing() {
  app.commit((p) => {
    p.roomId = null;
  }, 'หยุดซิงก์ในเครื่องนี้แล้ว (แผนยังอยู่ครบ)');
}

function joinRoom(roomId: string) {
  const existing = app.store.plans.find((p) => p.roomId === roomId);
  if (existing) {
    app.store.activeId = existing.id;
    app.activeDayId = existing.days[0].id;
    app.persist();
    app.showToast('เปิดแผนร่วมกับเพื่อนแล้ว');
    return;
  }
  if (!SYNC_DB_URL) {
    app.showToast('เว็บนี้ยังไม่ได้ตั้งค่าซิงก์ — เปิดลิงก์ร่วมแผนไม่ได้');
    return;
  }
  joiningRoom = roomId;
  const p = newPlan('แผนร่วมกับเพื่อน');
  p.roomId = roomId;
  app.addPlan(p);
  app.showToast('กำลังโหลดแผนของเพื่อน…');
}

window.addEventListener('online', () => void sync?.flush());

/* ---------------- QR ---------------- */
function drawQr() {
  const ci = document.getElementById('qr-invite') as HTMLCanvasElement | null;
  if (ci && app.plan.roomId) QRCode.toCanvas(ci, inviteUrl(location.href, app.plan.roomId), { width: 200, margin: 1, errorCorrectionLevel: 'M' }).catch(() => {});
  const c = document.getElementById('qr') as HTMLCanvasElement | null;
  if (!c) return;
  const r = buildShareUrl(app.plan, location.href);
  if (r.ok) QRCode.toCanvas(c, r.url, { width: 232, margin: 1, errorCorrectionLevel: 'L' }).catch(() => {});
}

/* ---------------- การเปรียบเทียบก่อนยืนยัน ---------------- */
function openCompare(dayId: string, newDayValue: Day, title: string, focusUid?: string, note?: string) {
  const old = app.findDay(dayId);
  if (!old) return;
  app.modal = { type: 'compare', title, dayId, oldDay: clone(old), newDay: newDayValue, afterConfirm: focusUid, note };
  app.requestRender();
}

/** เปลี่ยนแผนทันที พร้อมปุ่มเลิกทำ */
function applyWithUndo(dayId: string, nd: Day, msg: string) {
  const before = clone(app.findDay(dayId)!);
  app.modal = null;
  app.setDay(dayId, nd);
  app.fitNext = true;
  app.showToast(msg, () => app.setDay(dayId, before, 'เลิกทำแล้ว'));
}

/** แตะสถานที่ = เพิ่มเข้าวันที่เลือก (หรือเอาออกถ้ามีอยู่แล้ว) — ไม่ต้องยืนยัน มีปุ่มเลิกทำ */
function quickToggle(placeId: string) {
  const day = app.day;
  const n = app.dayIndex(day.id) + 1;
  const p = app.getPlace(placeId);
  if (!p) return;
  const existing = day.stops.find((s) => s.placeId === placeId);
  if (existing) {
    const nd = existing.kind === 'dinner' ? updateStop(day, existing.uid, { placeId: null, stayMin: 60 }) : removeStop(day, existing.uid);
    applyWithUndo(day.id, nd, `เอา ${p.nameTh} ออกจากวัน ${n}`);
    return;
  }
  const emptyDinner = p.food ? day.stops.find((s) => s.kind === 'dinner' && !s.placeId && !s.skipped) : undefined;
  const nd = emptyDinner
    ? updateStop(day, emptyDinner.uid, { placeId, stayMin: app.stayFor(placeId) })
    : insertStop(day, defaultInsertIndex(day), stopForPlace(placeId));
  app.focusPlaceId = placeId;
  applyWithUndo(day.id, nd, emptyDinner ? `ตั้ง ${p.nameTh} เป็นมื้อเย็นวัน ${n}` : `เพิ่ม ${p.nameTh} เข้าวัน ${n}`);
}

function stopForPlace(placeId: string, kind: Stop['kind'] = 'place'): Stop {
  return newStop(kind, placeId, app.stayFor(placeId));
}

/* ---------------- ข้อความแผน ---------------- */
function planAsText(plan: Plan): string {
  const lines = [`แผนเที่ยวโซล — ${plan.name}`, '(เวลาทั้งหมดเป็นเวลาเกาหลี Asia/Seoul)', ''];
  plan.days.forEach((d, i) => {
    const s = app.schedule(d);
    lines.push(`วัน ${i + 1} · ${fmtDateTh(d.date)}`);
    lines.push(`  ออกจาก ${app.getPlace(d.startPlaceId)?.nameTh ?? '?'} ${d.startTime ?? '(ยังไม่กำหนดเวลา)'}`);
    s.stops.forEach((t, j) => {
      const p = app.getPlace(t.stop.placeId);
      const name = p?.nameTh ?? t.stop.title ?? (t.stop.kind === 'dinner' ? 'มื้อเย็น (ยังไม่เลือกร้าน)' : t.stop.kind);
      const tm = t.start != null ? `${t.lowerBound ? '≥' : ''}${fmtHM(t.start)}–${fmtHM(t.depart)}` : '--:--';
      const leg = t.leg.source === 'same' ? '' : ` [${MODE_LABEL[t.leg.mode]} ${t.leg.travelMin != null ? fmtDur(t.leg.travelMin) : 'ไม่ทราบ'}]`;
      lines.push(`  ${j + 1}. ${tm} ${name}${t.stop.skipped ? ' (ข้าม)' : ''}${leg}${t.stop.lockedTime ? ` 🔒${t.stop.lockedTime}` : ''}${t.stop.note ? ` — ${t.stop.note}` : ''}`);
    });
    if (s.end) lines.push(`  ถึง ${app.getPlace(d.endPlaceId)?.nameTh ?? '?'} ${s.end.arrive != null ? (s.end.lowerBound ? '≥' : '') + fmtHM(s.end.arrive) : '--:--'}${d.endTime ? ` (ต้องการถึง ${d.endTime})` : ''}`);
    lines.push('');
  });
  return lines.join('\n');
}

async function copy(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    app.showToast(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    app.showToast(ok ? okMsg : 'คัดลอกไม่สำเร็จ — กดค้างที่ข้อความเพื่อคัดลอกเอง');
  }
  app.requestRender();
}

/* ---------------- Events ---------------- */
function confirmThen(message: string, okLabel: string, action: () => void) {
  app.modal = { type: 'confirm', message, okLabel, action };
  app.requestRender();
}

document.addEventListener('pointerdown', () => (app.pointerDown = true), true);
const release = () => setTimeout(() => app.releasePointer(), 0);
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  const act = el.dataset.act!;
  const d = el.dataset;
  if (act === 'modal-backdrop') {
    if (ev.target === el) closeModal();
    return;
  }
  const dayId = d.day ?? app.activeDayId;
  const day = app.findDay(dayId);
  switch (act) {
    case 'tab':
      app.tab = d.tab as Tab;
      if (app.tab === 'map') {
        app.fitNext = true;
        setTimeout(() => {
          refreshMapSize();
          app.fitNext = true;
          app.requestRender();
        }, 50);
      }
      window.scrollTo({ top: 0 });
      break;
    case 'select-day':
      app.activeDayId = d.day!;
      app.fitNext = true;
      if (app.tab === 'today') app.tab = 'plan';
      break;
    case 'add-day':
      app.commit((p) => {
        const last = p.days[p.days.length - 1];
        const nd = newDay({ startPlaceId: last?.endPlaceId ?? 'hotel', endPlaceId: last?.endPlaceId ?? 'hotel' });
        p.days.push(nd);
        app.activeDayId = nd.id;
      }, 'เพิ่มวันแล้ว');
      return;
    case 'remove-day':
      if (app.plan.days.length <= 1) return;
      confirmThen(`ลบวัน ${app.dayIndex(dayId) + 1} และรายการทั้งหมดในวันนั้น?`, 'ลบวัน', () => app.commit((p) => (p.days = p.days.filter((x) => x.id !== dayId)), 'ลบวันแล้ว'));
      return;
    case 'quick':
      if (day) app.updateDay(dayId, (x) => ({ ...x, [d.field!]: d.v }));
      return;
    case 'stop-up':
    case 'stop-down':
      if (day) app.updateDay(dayId, (x) => moveStop(x, d.stop!, act === 'stop-up' ? -1 : 1));
      return;
    case 'stop-remove':
      if (day) app.updateDay(dayId, (x) => removeStop(x, d.stop!), 'ลบรายการแล้ว — ช่วงเดินทางเชื่อมใหม่อัตโนมัติ');
      return;
    case 'stop-skip':
      if (day) app.updateDay(dayId, (x) => updateStop(x, d.stop!, { skipped: !x.stops.find((s) => s.uid === d.stop)?.skipped }));
      return;
    case 'toggle-filters':
    case 'toggle-card':
    case 'toggle-leg':
    case 'toggle-settings':
    case 'toggle-setmore':
    case 'toggle-wx': {
      const key = act === 'toggle-filters' ? 'filters' : act === 'toggle-card' ? `card:${d.place}` : act === 'toggle-leg' ? `leg:${d.stop}` : act === 'toggle-settings' ? `set:${d.day}` : act === 'toggle-setmore' ? `setmore:${d.day}` : `wx:${d.day}`;
      app.expanded.has(key) ? app.expanded.delete(key) : app.expanded.add(key);
      if (act === 'toggle-filters') lastLibControlsSig = '';
      break;
    }
    case 'clear-filters':
      Object.assign(app.filters, { area: '', budget: '', stay: '', zone: '', fashion: '' });
      lastLibControlsSig = '';
      break;
    case 'toggle-expand':
      app.expanded.has(d.stop!) ? app.expanded.delete(d.stop!) : app.expanded.add(d.stop!);
      break;
    case 'add-item': {
      if (!day) return;
      const kind = d.kind as Stop['kind'];
      const st = kind === 'dinner' ? dinnerSlot() : newStop(kind, null, kind === 'break' ? 30 : 15, { title: kind === 'break' ? 'พัก' : 'เวลาสำรอง' });
      app.updateDay(dayId, (x) => insertStop(x, x.stops.length, st), 'เพิ่มรายการแล้ว');
      return;
    }
    case 'leg-clear':
      setLeg(dayId, d.stop!, { manualMin: null, manualKind: undefined });
      return;
    case 'leg-estimate':
      setLeg(dayId, d.stop!, { manualMin: Number(d.v), manualKind: 'estimate' });
      return;
    case 'leg-detail': {
      if (!day) return;
      const s = app.schedule(day);
      const leg = d.stop === '__end' ? s.end?.leg : s.stops.find((t) => t.uid === d.stop)?.leg;
      if (!leg?.fromId || !leg.toId) return;
      app.modal = { type: 'route', fromId: leg.fromId, toId: leg.toId, date: day.date, departMins: leg.departMins, dayId, stopUid: d.stop! };
      break;
    }
    case 'route-info': {
      const ref = app.refPoint === 'insert' ? null : app.refPoint;
      const day0 = app.day;
      const fromId = ref ?? (document.querySelector('[data-act-change="ref-point"] option:checked') ? refPlaceId() : 'hotel');
      if (!fromId || fromId === d.place) {
        app.showToast('จุดอ้างอิงเป็นจุดเดียวกับสถานที่นี้');
        break;
      }
      app.modal = { type: 'route', fromId, toId: d.place!, date: day0.date, departMins: parseHM(day0.startTime), dayId: day0.id, stopUid: null };
      break;
    }
    case 'route-use-mode': {
      const m = app.modal;
      if (m?.type === 'route' && m.stopUid) {
        setLeg(m.dayId, m.stopUid, { mode: d.v as TravelMode });
        app.modal = null;
      }
      return;
    }
    case 'suggest-order': {
      if (!day) return;
      const r = suggestOrder(day, app.getPlace);
      if (!r.changed) {
        app.showToast('ลำดับปัจจุบันระยะรวมสั้นที่สุดแล้ว (เทียบระยะเส้นตรง โดยคงจุดที่ล็อก/มื้ออาหาร/พักไว้)');
        break;
      }
      openCompare(dayId, reorderStops(day, r.order), 'แนะนำลำดับเดินทาง', undefined, `จัดลำดับใหม่ลดการย้อนเส้นทาง (ระยะเส้นตรงรวม ${(r.beforeM / 1000).toFixed(1)} → ${(r.afterM / 1000).toFixed(1)} กม.) โดยคงเวลานัดที่ล็อก มื้ออาหาร และช่วงพักไว้ที่เดิม — เวลาจริงดูจากตารางด้านล่าง`);
      return;
    }
    case 'go-places':
      app.tab = window.matchMedia('(min-width: 1024px)').matches ? app.tab : 'places';
      (document.querySelector('[data-filter="q"]') as HTMLInputElement | null)?.focus();
      break;
    case 'filter-cat':
      app.filters.cat = d.v ?? '';
      break;
    case 'toggle-save':
      app.commit((p) => {
        p.saved = p.saved.includes(d.place!) ? p.saved.filter((x) => x !== d.place) : [...p.saved, d.place!];
      });
      return;
    case 'focus-place': {
      const p = app.getPlace(d.place);
      if (!p || p.lat == null) return;
      app.focusPlaceId = p.id;
      if (!window.matchMedia('(min-width: 1024px)').matches) app.tab = 'map';
      if (app.modal?.type === 'place') app.modal = null;
      app.requestRender();
      setTimeout(() => {
        refreshMapSize();
        focusMapView(p.lat!, p.lng!);
      }, 60);
      return;
    }
    case 'web-search':
      runWebSearch();
      return;
    case 'web-search-clear':
      searchAbort?.abort();
      app.search = null;
      break;
    case 'web-search-focus': {
      const i = Number(d.i);
      const r = app.search?.results[i];
      if (!r || !app.search) return;
      app.search.focus = i;
      if (!isDesktop()) app.tab = 'map';
      app.requestRender();
      setTimeout(() => {
        refreshMapSize();
        focusMapView(r.lat, r.lng);
      }, 60);
      return;
    }
    case 'web-search-add':
      addSearchResult(Number(d.i));
      return;
    case 'add-to-day':
    case 'quick-toggle':
      quickToggle(d.place!);
      return;
    case 'toast-undo': {
      const u = app.toast?.undo;
      app.toast = null;
      u?.();
      app.requestRender();
      return;
    }
    case 'apply-trip-dates':
      app.commit((p) => applyTripDates(p), 'ตั้งวันเที่ยวแล้ว');
      return;
    case 'dinner-options':
      app.modal = { type: 'dinner', dayId, stopUid: d.stop!, zone: null };
      break;
    case 'dinner-zone':
      if (app.modal?.type === 'dinner') app.modal = { ...app.modal, zone: d.v! };
      break;
    case 'dinner-pick': {
      const m = app.modal;
      if (m?.type !== 'dinner') return;
      const target = app.findDay(m.dayId)!;
      let nd = updateStop(target, m.stopUid, { placeId: d.place!, stayMin: app.stayFor(d.place!), skipped: false });
      if (d.shop) {
        const idx = nd.stops.findIndex((s) => s.uid === m.stopUid);
        nd = insertStop(nd, idx + 1, stopForPlace(d.shop));
      }
      applyWithUndo(m.dayId, nd, `เลือก ${app.getPlace(d.place)?.nameTh ?? ''} เป็นมื้อเย็นแล้ว${d.shop ? ' + ช็อปอีกหนึ่งจุด' : ''}`);
      return;
    }
    case 'nearby':
      app.modal = { type: 'nearby', dayId, stopUid: d.stop!, want: d.want as 'shop' | 'eat' };
      break;
    case 'nearby-pick': {
      const m = app.modal;
      if (m?.type !== 'nearby') return;
      const target = app.findDay(m.dayId)!;
      const idx = target.stops.findIndex((s) => s.uid === m.stopUid);
      const st = stopForPlace(d.place!);
      applyWithUndo(m.dayId, insertStop(target, idx + 1, st), `เพิ่ม ${app.getPlace(d.place)?.nameTh ?? ''} แล้ว`);
      return;
    }
    case 'indoor-options':
      app.modal = { type: 'indoor', dayId };
      break;
    case 'indoor-replace': {
      const m = app.modal;
      if (m?.type !== 'indoor') return;
      const target = app.findDay(m.dayId)!;
      applyWithUndo(m.dayId, updateStop(target, d.stop!, { placeId: d.place!, stayMin: app.stayFor(d.place!) }), `แทนด้วย ${app.getPlace(d.place)?.nameTh ?? ''} แล้ว`);
      return;
    }
    case 'compare-confirm': {
      const m = app.modal;
      if (m?.type !== 'compare') return;
      app.modal = null;
      app.setDay(m.dayId, m.newDay, 'อัปเดตแผนแล้ว');
      return;
    }
    case 'confirm-ok': {
      const m = app.modal;
      app.modal = null;
      if (m?.type === 'confirm') m.action();
      break;
    }
    case 'modal-close':
      closeModal();
      return;
    case 'open-templates':
      app.modal = { type: 'templates', tplId: TEMPLATES[0].id };
      break;
    case 'tpl-tab':
      app.modal = { type: 'templates', tplId: d.v! }; // เปลี่ยนแท็บ = ล้างวันปลายทางที่เลือกไว้
      break;
    case 'tpl-apply-all': {
      const tpl = TEMPLATES.find((t) => t.id === d.tpl)!;
      if (tpl.dated) {
        confirmThen(`แทนที่รายการทุกวันด้วย “${tpl.name}”? (ตั้งวันที่ จุดเริ่ม/จบ และนัดหมายตามแม่แบบ · กดเลิกทำได้ทันทีหลังใช้)`, 'ใช้แม่แบบ', () => {
          const before = clone(app.plan);
          app.commit((p) => applyDatedTemplate(p, tpl));
          app.activeDayId = app.plan.days[0].id;
          app.showToast('ใช้แม่แบบแล้ว', () => app.commit((p) => Object.assign(p, { days: before.days }), 'เลิกทำแล้ว'));
        });
        return;
      }
      confirmThen(`แทนที่รายการในวัน 1–${tpl.days.length} ด้วยแม่แบบ “${tpl.name}”? (วันที่ เวลา และจุดเริ่ม/จบที่ตั้งไว้จะคงเดิม)`, 'ใช้แม่แบบ', () =>
        app.commit((p) => {
          tpl.days.forEach((td, i) => {
            if (!p.days[i]) p.days.push(newDay());
            p.days[i] = { ...p.days[i], stops: templateDayStops(td, (id) => app.stayFor(id)) };
          });
        }, 'ใช้แม่แบบแล้ว'),
      );
      return;
    }
    case 'tpl-copy-day': {
      const m = app.modal;
      if (m?.type !== 'templates') return;
      const tpl = TEMPLATES.find((t) => t.id === d.tpl)!;
      const i = Number(d.i);
      const targetId = tplTargetDay(m, tpl, i);
      const n = app.dayIndex(targetId) + 1;
      const target = app.findDay(targetId)!;
      const mode = d.mode === 'replace' ? 'replace' : 'append';
      const nd = { ...target, stops: mergeDayStops(target.stops, templateDayStops(tpl.days[i], (id) => app.stayFor(id)), mode) };
      app.activeDayId = targetId;
      applyWithUndo(targetId, nd, mode === 'replace' ? `ใช้ “${tpl.days[i].title}” เป็นวัน ${n} แล้ว` : `เพิ่ม “${tpl.days[i].title}” ต่อท้ายวัน ${n} แล้ว`);
      return;
    }
    case 'tpl-add-place': {
      const m = app.modal;
      if (m?.type !== 'templates') return;
      const tpl = TEMPLATES.find((t) => t.id === d.tpl)!;
      const targetId = tplTargetDay(m, tpl, Number(d.i));
      const target = app.findDay(targetId)!;
      const p = app.getPlace(d.place);
      if (!p) return;
      const n = app.dayIndex(targetId) + 1;
      const existing = target.stops.find((s) => s.placeId === p.id);
      const before = clone(target);
      app.setDay(targetId, existing ? removeStop(target, existing.uid) : insertStop(target, defaultInsertIndex(target), stopForPlace(p.id)));
      app.showToast(existing ? `เอา ${p.nameTh} ออกจากวัน ${n}` : `เพิ่ม ${p.nameTh} เข้าวัน ${n}`, () => app.setDay(targetId, before, 'เลิกทำแล้ว'));
      return;
    }
    case 'tpl-blank':
      confirmThen('สร้างแผนว่างใหม่ 4 วัน? (แผนปัจจุบันยังเก็บไว้ สลับกลับได้ในเมนูแชร์/บันทึก)', 'สร้างแผนว่าง', () => {
        const p = newPlan(`แผนใหม่ ${app.store.plans.length + 1}`);
        app.addPlan(p);
      });
      return;
    case 'open-share':
      app.modal = { type: 'share' };
      break;
    case 'fx-swap': {
      // สลับทิศ: ผลลัพธ์เดิมกลายเป็นจำนวนตั้งต้น
      const rate = activeRate(fxStore);
      const n = parseAmount(fxUi.amount);
      const raw = rate && n != null ? (fxUi.dir === 'krw2thb' ? n / rate : n * rate) : null;
      fxUi.dir = fxUi.dir === 'krw2thb' ? 'thb2krw' : 'krw2thb';
      // ใช้ค่าละเอียด (บาททศนิยม 2 ตำแหน่ง) สลับไปกลับแล้วไม่เพี้ยน
      fxUi.amount = raw != null ? formatTyping(fxUi.dir === 'thb2krw' ? raw.toFixed(2).replace(/\.00$/, '') : String(Math.round(raw))) : '';
      break;
    }
    case 'fx-set':
      setFxAmount(d.v ? formatTyping(d.v) : '');
      (document.getElementById('fx-in') as HTMLInputElement | null)?.blur();
      return;
    case 'fx-edit':
      fxUi.editingRate = true;
      break;
    case 'fx-auto':
      fxStore = { ...fxStore, custom: null };
      saveFx(fxStore);
      fxUi.editingRate = false;
      app.showToast('ใช้อัตราอัตโนมัติแล้ว');
      break;
    case 'fx-refresh':
      void refreshFx(true);
      return;
    case 'sync-start':
      startSharing();
      return;
    case 'sync-stop':
      confirmThen('หยุดซิงก์แผนนี้ในเครื่องนี้? (แผนในเครื่องยังอยู่ครบ เพื่อนยังใช้แผนในห้องต่อได้)', 'หยุดซิงก์', stopSharing);
      return;
    case 'copy-invite': {
      const v = (document.getElementById('invite-url') as HTMLInputElement | null)?.value;
      if (v) navigator.clipboard?.writeText(v).then(() => app.showToast('คัดลอกลิงก์ชวนเพื่อนแล้ว'), () => app.showToast('คัดลอกไม่ได้ — กดค้างที่ลิงก์เพื่อคัดลอก'));
      return;
    }
    case 'copy-link': {
      const r = buildShareUrl(app.plan, location.href);
      if (r.ok) copy(r.url, 'คัดลอกลิงก์แล้ว (สำเนาแผน ณ ตอนนี้)');
      return;
    }
    case 'copy-text':
      copy(planAsText(app.plan), 'คัดลอกแผนเป็นข้อความแล้ว');
      return;
    case 'export-json': {
      const blob = new Blob([JSON.stringify(exportablePlan(app.plan), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `seoul-plan-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    case 'import-copy': {
      const m = app.modal;
      if (m?.type !== 'import') return;
      app.modal = null;
      const p = m.plan;
      p.id = app.newUid('p');
      p.name = `${p.name} (สำเนา)`;
      app.addPlan(p);
      app.showToast('เปิดแผนเป็นสำเนาแล้ว');
      return;
    }
    case 'import-replace': {
      const m = app.modal;
      if (m?.type !== 'import') return;
      confirmThen('แทนที่แผนปัจจุบันด้วยแผนที่นำเข้า? แผนเดิมจะหายไป', 'แทนที่', () => {
        app.replaceActivePlan(m.plan);
        app.showToast('แทนที่แผนแล้ว');
      });
      return;
    }
    case 'switch-plan':
      app.store.activeId = d.v!;
      app.activeDayId = app.plan.days[0].id;
      app.persist();
      app.fitNext = true;
      break;
    case 'delete-plan':
      confirmThen('ลบแผนนี้ออกจากเครื่อง?', 'ลบแผน', () => {
        app.store.plans = app.store.plans.filter((p) => p.id !== d.v);
        if (app.store.activeId === d.v) {
          app.store.activeId = app.store.plans[0].id;
          app.activeDayId = app.plan.days[0].id;
        }
        app.persist();
        app.modal = { type: 'share' };
        app.requestRender();
      });
      return;
    case 'open-settings':
      app.modal = { type: 'settings' };
      break;
    case 'open-custom':
      app.modal = { type: 'custom' };
      break;
    case 'weather-refresh': {
      if (!day) return;
      const ref = app.weatherRefPoint(day);
      ensureWeather(ref.lat, ref.lng, true);
      app.showToast('กำลังรีเฟรชพยากรณ์…');
      break;
    }
    case 'remove-check':
      app.commit((p) => {
        p.extraChecklist[dayId] = (p.extraChecklist[dayId] ?? []).filter((_, i) => i !== Number(d.i));
      });
      return;
    case 'map-filter':
      app.mapFilter = d.v as 'all' | 'day';
      app.fitNext = true;
      break;
    case 'map-fit':
      app.fitNext = true;
      syncMapForce();
      return;
  }
  app.requestRender();
});

function refPlaceId(): string | null {
  if (app.refPoint !== 'insert') return app.refPoint;
  const day = app.day;
  const idx = day.stops.findIndex((s) => s.kind === 'dinner');
  const before = (idx >= 0 ? day.stops.slice(0, idx) : day.stops).map(stopLocationId).filter(Boolean) as string[];
  return before[before.length - 1] ?? day.startPlaceId;
}

function syncMapForce() {
  app.fitNext = true;
  // เปลี่ยนลายเซ็นเพื่อบังคับ fit
  app.requestRender();
}

function closeModal() {
  app.modal = null;
  app.requestRender();
}

function setLeg(dayId: string, target: string, patch: Partial<Stop['legIn']>) {
  app.updateDay(dayId, (x) => {
    if (target === '__end') return { ...x, endLeg: { ...x.endLeg, ...patch } };
    return { ...x, stops: x.stops.map((s) => (s.uid === target ? { ...s, legIn: { ...s.legIn, ...patch } } : s)) };
  });
}

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.filter) {
    if (el.dataset.filter === 'q') return; // จัดการโดย input event แล้ว
    (app.filters as any)[el.dataset.filter] = el.value;
    app.requestRender();
    return;
  }
  const act = el.dataset.act;
  const actc = el.dataset.actChange;
  if (!actc && !act) return;
  const d = el.dataset;
  const dayId = d.day ?? app.activeDayId;
  switch (actc) {
    case 'day-field': {
      const f = d.field!;
      if (f !== 'weatherRef') app.expanded.add(`set:${dayId}`);
      let v: unknown = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'bufferMin') v = Math.max(0, Math.min(120, Number(el.value) || 0));
      if (v === '') v = null;
      app.updateDay(dayId, (x) => ({ ...x, [f]: v }));
      return;
    }
    case 'day-pref':
      app.updateDay(dayId, (x) => ({ ...x, prefs: { ...x.prefs, [d.field!]: el.checked } }));
      return;
    case 'tpl-target': {
      const m = app.modal;
      if (m?.type !== 'templates') return;
      app.modal = { ...m, targets: { ...(m.targets ?? {}), [Number(d.i)]: el.value } };
      app.requestRender();
      return;
    }
    case 'stop-move-day': {
      const to = el.value;
      if (!to) return;
      const before = clone(app.plan);
      const name = (() => {
        const st = app.findDay(dayId)?.stops.find((x) => x.uid === d.stop);
        return st ? (app.getPlace(st.placeId)?.nameTh ?? st.title ?? 'รายการ') : 'รายการ';
      })();
      app.commit((p) => Object.assign(p, moveStopToDay(p, dayId, d.stop!, to)));
      app.showToast(`ย้าย ${name} ไปวัน ${app.dayIndex(to) + 1} แล้ว`, () => app.commit((p) => Object.assign(p, { days: before.days }), 'เลิกทำแล้ว'));
      return;
    }
    case 'stop-field': {
      const f = d.field!;
      let v: unknown = el.value;
      if (f === 'stayMin') v = Math.max(0, Math.min(1440, Number(el.value) || 0));
      if (f === 'lockedTime') v = el.value || null;
      app.updateDay(dayId, (x) => updateStop(x, d.stop!, { [f]: v } as Partial<Stop>));
      return;
    }
    case 'leg-mode':
      setLeg(dayId, d.stop!, { mode: el.value as TravelMode });
      return;
    case 'leg-manual': {
      const n = el.value === '' ? null : Math.max(0, Math.min(1440, Math.round(Number(el.value))));
      setLeg(dayId, d.stop!, { manualMin: n, manualKind: n == null ? undefined : 'user' });
      return;
    }
    case 'stay-override': {
      const n = Math.max(0, Math.min(1440, Math.round(Number(el.value) || 0)));
      app.commit((p) => (p.stayOverrides[d.place!] = n), 'บันทึกเวลาแวะแล้ว (ใช้กับการเพิ่มครั้งต่อไป)');
      return;
    }
    case 'ref-point':
      app.refPoint = el.value;
      break;
    case 'lib-pins':
      app.showLibPins = el.checked;
      break;
    case 'cold-level':
      app.commit((p) => (p.coldLevel = el.value as Plan['coldLevel']));
      return;
    case 'check-item':
      app.commit((p) => {
        p.checklist[dayId] = { ...(p.checklist[dayId] ?? {}), [d.key!]: el.checked };
      });
      return;
    case 'add-day-select':
      if (app.modal?.type === 'add') app.modal = { ...app.modal, dayId: el.value };
      break;
    case 'route-depart':
      if (app.modal?.type === 'route') app.modal = { ...app.modal, departMins: parseHM(el.value) };
      break;
    case 'plan-name':
      app.commit((p) => (p.name = el.value.slice(0, 80) || 'แผนเที่ยวโซล'));
      return;
    case 'import-file': {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 1_000_000) {
        app.showToast('ไฟล์ใหญ่เกินไป');
        return;
      }
      file.text().then((t) => {
        const r = parseJsonPlan(t);
        if (!r.ok) app.showToast(r.error);
        else app.modal = { type: 'import', plan: r.plan, warnings: r.warnings, source: 'json' };
        app.requestRender();
      });
      return;
    }
  }
  app.requestRender();
});

document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === 'fx-in') {
    const f = formatTyping(el.value);
    if (f !== el.value) el.value = f;
    setFxAmount(f);
    return;
  }
  if (el.dataset.filter === 'q') {
    app.filters.q = el.value;
    $('#lib-list').innerHTML = renderLibraryList();
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  const fd = new FormData(form);
  if (kind === 'add-check') {
    const item = String(fd.get('item') ?? '').trim().slice(0, 80);
    const dayId = form.dataset.day!;
    if (item) app.commit((p) => (p.extraChecklist[dayId] = [...(p.extraChecklist[dayId] ?? []), item]));
  } else if (kind === 'custom') {
    const name = String(fd.get('name') ?? '').trim();
    const lat = parseFloat(String(fd.get('lat') ?? ''));
    const lng = parseFloat(String(fd.get('lng') ?? ''));
    const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
    if (hasCoord && (lat < 33 || lat > 39 || lng < 124 || lng > 132)) {
      app.showToast('พิกัดไม่อยู่ในเกาหลีใต้ — ตรวจลำดับ lat/lng');
      app.requestRender();
      return;
    }
    const place: Place = {
      id: `custom-${app.newUid('c')}`,
      nameTh: name,
      nameEn: name,
      category: (String(fd.get('category')) as Place['category']) || 'sight',
      area: 'เพิ่มเอง',
      address: String(fd.get('address') ?? '').trim() || null,
      lat: hasCoord ? lat : null,
      lng: hasCoord ? lng : null,
      coordStatus: hasCoord ? 'user' : 'unverified',
      reasonTh: 'ผู้ใช้เพิ่มเอง',
      suggestedStayMin: Math.max(0, Number(fd.get('stay')) || 60),
      indoor: fd.get('indoor') === 'on',
      sources: [],
      custom: true,
    };
    app.modal = null;
    app.commit((p) => p.customPlaces.push(place), 'เพิ่มสถานที่แล้ว');
  } else if (kind === 'fx-rate') {
    const v = parseFloat(String(fd.get('rate') ?? '').replace(/,/g, ''));
    if (!(v > 1 && v < 200)) {
      app.showToast('อัตราไม่ถูกต้อง — ใส่จำนวนวอนต่อ 1 บาท เช่น 39.5');
      return;
    }
    fxStore = { ...fxStore, custom: v };
    saveFx(fxStore);
    fxUi.editingRate = false;
    app.showToast(`ใช้อัตรา 1 บาท = ${v} วอน`);
    app.requestRender();
  } else if (kind === 'settings') {
    const apiKey = String(fd.get('apiKey') ?? '').trim();
    const mapId = String(fd.get('mapId') ?? '').trim();
    saveSettings({ apiKey: apiKey || undefined, mapId: mapId || undefined });
    location.reload();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && app.modal) closeModal();
  const el = ev.target as HTMLElement;
  if (ev.key === 'Enter' && el?.dataset?.filter === 'q' && !ev.isComposing) {
    ev.preventDefault();
    runWebSearch();
  }
});

window.addEventListener('online', () => {
  app.online = true;
  app.requestRender();
});
window.addEventListener('offline', () => {
  app.online = false;
  app.requestRender();
});

/* ---------------- เริ่มต้น ---------------- */
onRoutesChange(() => app.requestRender());
onWeatherChange(() => app.requestRender());
onGoogleStatus(() => app.requestRender());

function handleHash() {
  const room = roomFromHash(location.hash);
  if (room) {
    history.replaceState(null, '', location.pathname + location.search);
    joinRoom(room);
    return;
  }
  const r = decodeFragment(location.hash);
  if (!r) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!r.ok) {
    app.showToast(`เปิดลิงก์แผนไม่ได้: ${r.error}`);
    return;
  }
  if (!hadSavedPlans) {
    app.replaceActivePlan(r.plan);
    app.showToast('เปิดแผนจากลิงก์แล้ว (สำเนา ณ เวลาที่แชร์)');
  } else {
    app.modal = { type: 'import', plan: r.plan, warnings: r.warnings, source: 'link' };
  }
}
window.addEventListener('hashchange', () => {
  handleHash();
  app.requestRender();
});

if (window.matchMedia('(max-width: 1023px)').matches) app.tab = app.plan.days.some((d) => d.date === seoulNow().date) ? 'today' : 'plan';
handleHash();
render();
if (!hadSavedPlans) app.persist();

const apiKey = app.settings.apiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);
const mapId = app.settings.mapId || (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID';
try {
  startOsm(document.getElementById('map')!);
  app.fitNext = true;
} catch (e) {
  console.warn('OSM init failed', e);
}
app.requestRender();
loadGoogle(apiKey).then(async (ok) => {
  if (ok && (await switchToGoogle(document.getElementById('map')!, mapId))) app.fitNext = true;
  app.requestRender();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
