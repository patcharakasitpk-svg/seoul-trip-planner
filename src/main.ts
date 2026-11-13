import './style.css';
import QRCode from 'qrcode';
import { app, type Tab } from './ui/app';
import { renderLibraryControls, renderLibraryList } from './ui/views/library';
import { renderDayPanel, renderDayTabs } from './ui/views/day';
import { renderToday } from './ui/views/today';
import { renderModal } from './ui/views/modals';
import { esc, dayColor, gmapsPlaceUrl, MODE_LABEL } from './ui/util';
import { loadGoogle, googleStatus, onGoogleStatus } from './services/google';
import { initMap, mapReady, onMarkerClick, syncMap, focusOn } from './services/map';
import { buildMapSpecs } from './ui/mapSpecs';
import { onRoutesChange } from './services/routes';
import { onWeatherChange, ensureWeather } from './services/weather';
import { insertStop, moveStop, newDay, newStop, dinnerSlot, removeStop, updateStop, reorderStops, newPlan, clone } from './core/planOps';
import type { Day, Place, Plan, Stop, TravelMode } from './core/types';
import { suggestOrder } from './core/compare';
import { decodeFragment, parseJsonPlan, buildShareUrl, exportablePlan } from './storage/share';
import { saveSettings, loadPlans } from './storage/storage';
import { TEMPLATES, templateDayStops } from './data/templates';
import { fmtDateTh, fmtDur, fmtHM, parseHM } from './core/time';
import { stopLocationId } from './core/schedule';

const hadSavedPlans = loadPlans() != null;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

document.querySelector('#app')!.innerHTML = `
<header class="topbar">
  <div class="brand"><span class="logo" aria-hidden="true">🗺️</span><div><b>Seoul Trip Planner</b><div class="small muted" id="plan-name"></div></div></div>
  <nav class="top-actions">
    <button class="btn ghost desk-only" data-act="tab" data-tab="today">📅 วันนี้</button>
    <button class="btn ghost desk-only" data-act="tab" data-tab="plan">🗓️ แผน</button>
    <button class="btn ghost" data-act="open-templates">📚 แม่แบบ</button>
    <button class="btn ghost" data-act="open-share">📤 แชร์/บันทึก</button>
    <button class="btn ghost" data-act="open-settings" aria-label="ตั้งค่า">⚙️</button>
  </nav>
</header>
<div id="status-bar" class="status-bar"></div>
<div id="day-tabs-wrap"></div>
<main class="layout" id="layout">
  <aside class="panel lib" id="library" aria-label="คลังสถานที่"><div id="lib-controls"></div><div id="lib-list"></div></aside>
  <section class="panel mapp" id="map-panel" aria-label="แผนที่">
    <div class="map-tools" id="map-tools"></div>
    <div class="map-box"><div id="map"></div><div id="map-fallback" class="map-fallback"></div></div>
    <p class="map-legend small">หมุด: 🏨 โรงแรม · 🏢 COEX · ตัวเลข = ลำดับในวัน (สีประจำวัน) · จุดเทา = สถานที่ในคลัง<br>เส้นทึบ = เส้นทางจริงจากบริการ · <b>เส้นประ = เส้นเชื่อมลำดับ ไม่ใช่เส้นทางจริง</b></p>
  </section>
  <section class="panel right" id="right" aria-live="polite"></section>
</main>
<nav class="bottom-nav" aria-label="เมนูหลัก">
  <button data-act="tab" data-tab="today"><span>📅</span>วันนี้</button>
  <button data-act="tab" data-tab="map"><span>🗺️</span>แผนที่</button>
  <button data-act="tab" data-tab="places"><span>📍</span>สถานที่</button>
  <button data-act="tab" data-tab="plan"><span>🗓️</span>แผนของฉัน</button>
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
  if (g.status === 'no-key') st.push('<span>ยังไม่ได้ตั้งค่า Google Maps API Key — จัดแผนและกรอกเวลาเดินทางเองได้ <button class="link" data-act="open-settings">ตั้งค่า</button></span>');
  if (g.status === 'error') st.push(`<span class="warn">Google Maps: ${esc(g.error)} — ส่วนจัดแผนยังใช้ได้</span>`);
  if (!app.storageOk) st.push('<span class="warn">บันทึกในเครื่องไม่ได้ — โปรด Export JSON ก่อนปิดหน้า</span>');
  else if (!app.saveOk) st.push('<span class="warn">บันทึกล่าสุดไม่สำเร็จ — โปรด Export JSON</span>');
  $('#status-bar').innerHTML = st.join('');
  $('#day-tabs-wrap').innerHTML = renderDayTabs();

  const sig = JSON.stringify([app.filters.cat, app.filters.area, app.filters.budget, app.filters.stay, app.filters.zone, app.filters.fashion, app.refPoint, app.plan.customPlaces.length, app.activeDayId, app.day.stops.length]);
  if (sig !== lastLibControlsSig || !$('#lib-controls').innerHTML) {
    const active = document.activeElement as HTMLElement | null;
    const typing = active?.dataset?.filter === 'q';
    if (!typing) $('#lib-controls').innerHTML = renderLibraryControls();
    lastLibControlsSig = sig;
  }
  $('#lib-list').innerHTML = renderLibraryList();
  $('#right').innerHTML = app.tab === 'today' ? renderToday() : renderDayPanel(app.day);
  $('#modal-root').innerHTML = renderModal();
  document.body.classList.toggle('modal-open', !!app.modal);
  $('#toast').innerHTML = app.toast ? esc(app.toast.msg) : '';
  $('#toast').classList.toggle('show', !!app.toast);
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
    <label class="small"><input type="checkbox" data-act-change="lib-pins" ${app.showLibPins ? 'checked' : ''}> สถานที่ในคลัง</label>
    <button class="btn ghost xs" data-act="map-fit">พอดีจอ</button>`;
  const fb = $('#map-fallback');
  if (mapReady()) {
    fb.innerHTML = '';
    fb.hidden = true;
    return;
  }
  fb.hidden = false;
  const g = googleStatus();
  const days = app.mapFilter === 'all' ? app.plan.days : [app.day];
  fb.innerHTML = `<div class="fb-inner"><p><b>${g.status === 'loading' ? 'กำลังโหลด Google Maps…' : g.status === 'error' ? 'แผนที่ไม่พร้อมใช้งาน' : 'ยังไม่มี Google Maps API Key'}</b></p>
    <p class="small muted">${g.status === 'error' ? esc(g.error) : 'แผนและเวลายังใช้งานได้ — เปิดตำแหน่งแต่ละจุดใน Google Maps ได้จากรายการนี้'}</p>
    ${days
      .map((d) => {
        const i = app.dayIndex(d.id);
        return `<h4 style="color:${dayColor(i)}">วัน ${i + 1}</h4><ol>${d.stops
          .map((s) => app.getPlace(s.placeId))
          .map((p) => (p ? `<li><a target="_blank" rel="noopener" href="${esc(gmapsPlaceUrl(p))}">${esc(p.nameTh)} ↗</a></li>` : '<li class="muted">รายการที่ไม่มีสถานที่</li>'))
          .join('')}</ol>`;
      })
      .join('')}</div>`;
}

function syncMapNow() {
  if (!mapReady()) return;
  const { markers, lines } = buildMapSpecs({
    days: app.mapFilter === 'all' ? app.plan.days : [app.day],
    allDays: app.plan.days,
    mode: app.mapFilter,
    getPlace: app.getPlace,
    schedule: (d) => app.schedule(d),
    libraryPlaces: app.showLibPins ? app.places() : null,
  });
  syncMap(markers, lines, app.fitNext);
  app.fitNext = false;
}

onMarkerClick((id) => {
  app.focusPlaceId = id;
  app.modal = { type: 'place', placeId: id };
  app.requestRender();
});

/* ---------------- QR ---------------- */
function drawQr() {
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
      if (app.tab === 'map') app.fitNext = true;
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
      setTimeout(() => focusOn(p.lat!, p.lng!), 60);
      return;
    }
    case 'add-to-day':
      app.modal = { type: 'add', placeId: d.place!, dayId: app.activeDayId, index: null };
      break;
    case 'add-at': {
      const m = app.modal;
      if (m?.type !== 'add') return;
      const target = app.findDay(m.dayId)!;
      const st = stopForPlace(m.placeId);
      openCompare(m.dayId, insertStop(target, Number(d.i), st), `ผลก่อนเพิ่ม ${app.getPlace(m.placeId)?.nameTh ?? ''}`, st.uid);
      return;
    }
    case 'add-as-dinner': {
      const m = app.modal;
      if (m?.type !== 'add') return;
      const target = app.findDay(m.dayId)!;
      openCompare(m.dayId, updateStop(target, d.stop!, { placeId: m.placeId, stayMin: app.stayFor(m.placeId), skipped: false }), 'ผลก่อนเลือกร้านมื้อเย็น', d.stop);
      return;
    }
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
      openCompare(m.dayId, nd, d.shop ? 'ผลก่อนเลือก: กิน + ช็อปอีกหนึ่งจุด' : 'ผลก่อนเลือกร้านมื้อเย็น', m.stopUid);
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
      openCompare(m.dayId, insertStop(target, idx + 1, st), `ผลก่อนเพิ่ม ${app.getPlace(d.place)?.nameTh ?? ''}`, st.uid);
      return;
    }
    case 'indoor-options':
      app.modal = { type: 'indoor', dayId };
      break;
    case 'indoor-replace': {
      const m = app.modal;
      if (m?.type !== 'indoor') return;
      const target = app.findDay(m.dayId)!;
      openCompare(m.dayId, updateStop(target, d.stop!, { placeId: d.place!, stayMin: app.stayFor(d.place!) }), `ผลถ้าแทนด้วย ${app.getPlace(d.place)?.nameTh ?? ''}`, d.stop);
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
      app.modal = { type: 'templates', tplId: d.v! };
      break;
    case 'tpl-apply-all': {
      const tpl = TEMPLATES.find((t) => t.id === d.tpl)!;
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
      const tpl = TEMPLATES.find((t) => t.id === d.tpl)!;
      const td = tpl.days[Number(d.i)];
      const sel = document.querySelector(`[data-tpl-target="${d.i}"]`) as HTMLSelectElement;
      const targetId = sel?.value ?? app.activeDayId;
      const targetIdx = app.dayIndex(targetId);
      const doIt = () =>
        app.commit((p) => {
          const t = p.days.find((x) => x.id === targetId)!;
          const stops = templateDayStops(td, (id) => app.stayFor(id));
          if (d.mode === 'replace') t.stops = stops;
          else {
            const extra = stops.filter((s) => s.kind !== 'dinner' || !t.stops.some((x) => x.kind === 'dinner'));
            const di = t.stops.findIndex((x) => x.kind === 'dinner');
            t.stops.splice(di >= 0 ? di : t.stops.length, 0, ...extra);
          }
          app.activeDayId = targetId;
        }, `คัดลอกกลุ่มสถานที่ไปวัน ${targetIdx + 1} แล้ว`);
      if (d.mode === 'replace') confirmThen(`แทนที่รายการทั้งหมดในวัน ${targetIdx + 1}?`, 'แทนที่', doIt);
      else {
        app.modal = null;
        doIt();
      }
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
      let v: unknown = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'bufferMin') v = Math.max(0, Math.min(120, Number(el.value) || 0));
      if (v === '') v = null;
      app.updateDay(dayId, (x) => ({ ...x, [f]: v }));
      return;
    }
    case 'day-pref':
      app.updateDay(dayId, (x) => ({ ...x, prefs: { ...x.prefs, [d.field!]: el.checked } }));
      return;
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
  } else if (kind === 'settings') {
    const apiKey = String(fd.get('apiKey') ?? '').trim();
    const mapId = String(fd.get('mapId') ?? '').trim();
    saveSettings({ apiKey: apiKey || undefined, mapId: mapId || undefined });
    location.reload();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && app.modal) closeModal();
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

if (window.matchMedia('(max-width: 1023px)').matches) app.tab = 'today';
handleHash();
render();
if (!hadSavedPlans) app.persist();

const apiKey = app.settings.apiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);
const mapId = app.settings.mapId || (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID';
loadGoogle(apiKey).then(async (ok) => {
  if (ok) {
    try {
      await initMap(document.getElementById('map')!, mapId);
      app.fitNext = true;
    } catch (e) {
      console.warn('map init failed', e);
    }
  }
  app.requestRender();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
