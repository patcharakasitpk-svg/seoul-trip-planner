import type { Day, Place, TravelMode } from '../../core/types';
import { app, type Modal } from '../app';
import { esc, dayColor, MODE_ICON, MODE_LABEL, gmapsDirUrl, kakaoToUrl, photosUrl, naverBtn, naverRouteUrl, naverLabel, dayDate } from '../util';
import { diffDays as diffSchedules } from '../../core/compare';
import { fmtDur, fmtHM, fmtDateTh, parseHM } from '../../core/time';
import { routeSummary, stepsText, straightDist } from './leg';
import { fmtDist } from '../../core/geo';
import { nearby } from '../../core/compare';
import { stopLocationId, type LegInfo } from '../../core/schedule';
import { DINING_ZONE_LABEL, FOOD_TYPE_LABEL, CATEGORY_ICON } from '../../data/places';
import { TEMPLATES, nearbyForTemplateDay, type Template } from '../../data/templates';
import { legInfoBody } from './leg';
import { stopInfoBody } from './day';
import { MEALS, mealName, type Meal } from '../../core/meals';
import { OWN_CATEGORY_LABEL, type OwnCategory } from '../../core/ownPlace';
import { placeCard } from './library';
import { buildShareUrl } from '../../storage/share';
import { googleStatus } from '../../services/google';
import { inviteUrl } from '../../services/sync';
import { SYNC_DB_URL } from '../../config';
import { peekRoute, routeKey } from '../../services/routes';

export function renderModal(): string {
  const m = app.modal;
  if (!m) return '';
  let title = '';
  let body = '';
  switch (m.type) {
    case 'compare':
      [title, body] = [m.title, compareBody(m)];
      break;
    case 'add':
      [title, body] = ['เพิ่มเข้าวัน', addBody(m)];
      break;
    case 'templates':
      [title, body] = ['แม่แบบแผนเที่ยว', templatesBody(m)];
      break;
    case 'share':
      [title, body] = ['ส่งไปมือถือ / แชร์ / สำรอง', shareBody()];
      break;
    case 'import':
      [title, body] = ['นำเข้าแผน', importBody(m)];
      break;
    case 'confirm':
      [title, body] = ['ยืนยัน', `<p>${esc(m.message)}</p><div class="modal-actions"><button class="btn" data-act="modal-close">ยกเลิก</button><button class="btn primary" data-act="confirm-ok">${esc(m.okLabel)}</button></div>`];
      break;
    case 'dinner': {
      const st = app.findDay(m.dayId)?.stops.find((x) => x.uid === m.stopUid);
      [title, body] = [`เลือกร้าน${st ? mealName(st) : 'อาหาร'}`, dinnerBody(m)];
      break;
    }
    case 'nearby':
      [title, body] = [m.want === 'shop' ? 'ช็อปใกล้ร้านนี้' : 'กินใกล้จุดนี้', nearbyBody(m)];
      break;
    case 'route':
      [title, body] = ['เปรียบเทียบการเดินทาง', routeBody(m)];
      break;
    case 'custom':
      [title, body] = ['เพิ่มสถานที่เอง', customBody()];
      break;
    case 'leg': {
      const d = app.findDay(m.dayId);
      const s = d ? app.schedule(d) : null;
      const leg = m.target === '__end' ? s?.end?.leg : s?.stops.find((t) => t.uid === m.target)?.leg;
      [title, body] = ['การเดินทาง', d && leg ? legInfoBody(d.id, leg, m.target) : '<p>ไม่พบข้อมูล</p>'];
      break;
    }
    case 'stop': {
      const d = app.findDay(m.dayId);
      const s = d ? app.schedule(d) : null;
      const i = s ? s.stops.findIndex((t) => t.uid === m.stopUid) : -1;
      const t = i >= 0 ? s!.stops[i] : null;
      const p = t ? app.getPlace(t.stop.placeId) : undefined;
      const name = t ? (t.stop.kind === 'dinner' ? (p ? `${mealName(t.stop)} · ${p.nameTh}` : mealName(t.stop)) : (p?.nameTh ?? t.stop.title ?? 'รายการ')) : 'รายการ';
      [title, body] = [name, d && t ? stopInfoBody(d, t, i, s!.stops.length) : '<p>ไม่พบรายการ</p>'];
      break;
    }
    case 'meal':
      [title, body] = [
        'เพิ่มมื้ออาหาร',
        `<div class="meal-pick">${(Object.keys(MEALS) as Meal[]).map((k) => `<button class="btn meal-btn" data-act="meal-add" data-day="${m.dayId}" data-v="${k}"><span>${MEALS[k].icon}</span>${MEALS[k].th}<small>~${MEALS[k].stay} นาที${MEALS[k].at ? ` · ราว ${MEALS[k].at}` : ' · แทรกระหว่างทาง'}</small></button>`).join('')}</div><p class="muted small">วางในวันให้อัตโนมัติตามเวลามื้อ ย้าย/เปลี่ยนมื้อได้ภายหลังใน ⓘ</p>`,
      ];
      break;
    case 'settings':
      [title, body] = ['ตั้งค่าบริการแผนที่', settingsBody()];
      break;
    case 'place': {
      const p = app.getPlace(m.placeId);
      [title, body] = [p?.nameTh ?? 'สถานที่', p ? `<div class="place-list">${placeCard(p, { open: true })}</div>` : 'ไม่พบสถานที่'];
      break;
    }
    case 'indoor':
      [title, body] = ['ทางเลือกในร่ม', indoorBody(m)];
      break;
    case 'reorder':
      break;
  }
  return `<div class="modal-backdrop" data-act="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="modal-close" aria-label="ปิด">✕</button></div>
      <div class="modal-body">${body}</div>
    </div></div>`;
}

/* ---------- เปรียบเทียบก่อนยืนยัน ---------- */
function legText(l: LegInfo | undefined | null): string {
  if (!l) return '—';
  if (l.source === 'same') return 'จุดเดิม (0 นาที)';
  return `${MODE_ICON[l.mode]} ${l.travelMin != null ? fmtDur(l.travelMin) : '<span class="warn-text">ไม่ทราบ</span>'}${l.bufferMin ? ` + เผื่อ ${l.bufferMin}` : ''} <span class="pill src ${l.source}">${l.source === 'service' ? 'จากบริการ' : l.source === 'user' ? 'ผู้ใช้กำหนด' : l.source === 'estimate' ? 'ประมาณการ' : 'ยังไม่มีข้อมูล'}</span>`;
}

function compareBody(m: Extract<Modal, { type: 'compare' }>): string {
  const titleOf = (uid: string) => {
    const s = m.newDay.stops.find((x) => x.uid === uid) ?? m.oldDay.stops.find((x) => x.uid === uid);
    return s ? (app.getPlace(s.placeId)?.nameTh ?? s.title ?? s.kind) : uid;
  };
  const d = diffSchedules(m.oldDay, m.newDay, app.ctxFor(m.newDay), titleOf);
  const { before, after } = d;
  // ช่วงที่เกี่ยวข้อง (A → X → B)
  let segHtml = '';
  if (m.afterConfirm) {
    const i = after.stops.findIndex((t) => t.uid === m.afterConfirm);
    if (i >= 0) {
      const x = after.stops[i];
      const nextAfter = after.stops.slice(i + 1).find((t) => !t.stop.skipped && (t.stop.kind === 'place' || t.stop.kind === 'dinner'));
      const legXB = nextAfter ? nextAfter.leg : after.end?.leg;
      const oldB = nextAfter ? before.stops.find((t) => t.uid === nextAfter.uid)?.leg : before.end?.leg;
      const isNew = !before.stops.some((t) => t.uid === x.uid);
      const A = app.getPlace(x.leg.fromId)?.nameTh ?? 'จุดก่อนหน้า';
      const X = app.getPlace(x.leg.toId)?.nameTh ?? titleOf(x.uid);
      const B = app.getPlace(legXB?.toId)?.nameTh ?? 'จุดถัดไป';
      segHtml = `<table class="cmp"><tbody>
        ${isNew ? `<tr><th>แผนเดิม</th><td>${esc(A)} → ${esc(B)}: ${legText(oldB)}</td></tr>` : `<tr><th>แผนเดิม</th><td>${esc(A)} → ${esc(X)}: ${legText(before.stops.find((t) => t.uid === x.uid)?.leg)}</td></tr>`}
        <tr><th>แผนใหม่</th><td>${esc(A)} → ${esc(X)}: ${legText(x.leg)}<br>${esc(X)} → ${esc(B)}: ${legText(legXB)}</td></tr>
        <tr><th>เวลาแวะ ${esc(X)}</th><td>${fmtDur(x.stop.stayMin)}</td></tr>
      </tbody></table>`;
    }
  }
  const pending = after.missingLegs > 0;
  const row = (label: string, b: string, a: string, delta = '') => `<tr><th>${label}</th><td>${b}</td><td>${a}</td><td>${delta}</td></tr>`;
  const t = (x: number | null, lb = false) => (x == null ? '<span class="muted">--:--</span>' : `${lb ? '≥' : ''}${fmtHM(x)}`);
  const sign = (x: number | null) => (x == null ? '<span class="muted">ยังสรุปไม่ได้</span>' : x === 0 ? '±0' : x > 0 ? `<b class="bad-text">+${fmtDur(x)}</b>` : `<b class="ok-text">${fmtDur(x)}</b>`);
  const slack = (x: number | null) => (x == null ? '<span class="muted">ยังสรุปไม่ได้</span>' : x >= 0 ? `<span class="ok-text">เหลือ ${fmtDur(x)}</span>` : `<span class="bad-text">เกิน ${fmtDur(-x)}</span>`);
  const listCol = (sched: typeof before, day: Day) =>
    `<ol class="mini-tl">${sched.stops.map((s) => `<li>${t(s.arrive, s.lowerBound)} ${esc(app.getPlace(s.stop.placeId)?.nameTh ?? s.stop.title ?? (s.stop.kind === 'dinner' ? 'มื้อเย็น (ยังไม่เลือก)' : s.stop.kind))}${s.lateMin ? ` <span class="bad-text">สาย ${s.lateMin} น.</span>` : ''}</li>`).join('')}<li>${t(sched.end?.arrive ?? null, sched.end?.lowerBound)} ${esc(app.getPlace(day.endPlaceId)?.nameTh ?? 'จุดสิ้นสุด')}</li></ol>`;
  return `
    ${m.note ? `<p class="muted">${esc(m.note)}</p>` : ''}
    ${!after.hasTime ? '<p class="notice warn">ยังไม่กำหนดเวลาออก — แสดงได้เฉพาะลำดับ ยังประเมินผลต่อเวลาไม่ได้</p>' : ''}
    ${pending ? `<p class="notice warn">ยังไม่มีข้อมูลเวลาเดินทาง ${after.missingLegs} ช่วง${app.settings.apiKey ? ' (กำลังขอจากบริการ…)' : ''} — ตัวเลขที่ขึ้นต้นด้วย ≥ คือเวลาอย่างเร็ว ยังสรุปไม่ได้ว่าทัน</p>` : ''}
    ${segHtml}
    <table class="cmp"><thead><tr><th></th><th>แผนเดิม</th><th>แผนใหม่</th><th>ผลต่าง</th></tr></thead><tbody>
      ${row('เวลาเดินทางรวม (+เผื่อ)', before.totalTravelMin != null ? fmtDur(before.totalTravelMin + before.totalBufferMin) : 'ไม่ทราบ', after.totalTravelMin != null ? fmtDur(after.totalTravelMin + after.totalBufferMin) : 'ไม่ทราบ', sign(d.travelDelta))}
      ${row('ถึงจุดสิ้นสุด', t(d.endBefore, before.end?.lowerBound), t(d.endAfter, after.end?.lowerBound), sign(d.endDelta))}
      ${row('เวลาเหลือ/เกิน', slack(before.end?.slackMin ?? null), slack(after.end?.slackMin ?? null))}
    </tbody></table>
    ${d.affectedLocks.length ? `<h4>เวลานัดที่ล็อกไว้</h4><ul>${d.affectedLocks.map((a) => `<li>${esc(a.title)}: ถึง ${t(a.before)} → ${t(a.after)} ${a.lateAfter ? `<b class="bad-text">สาย ${a.lateAfter} นาที</b>` : a.unknown ? '<span class="warn-text">ยังไม่แน่ใจ</span>' : '<span class="ok-text">ทัน</span>'}</li>`).join('')}</ul>` : ''}
    <details><summary>ดูตารางเทียบทั้งวัน</summary><div class="two-col"><div><h4>แผนเดิม</h4>${listCol(before, m.oldDay)}</div><div><h4>แผนใหม่</h4>${listCol(after, m.newDay)}</div></div></details>
    <div class="modal-actions sticky"><button class="btn" data-act="modal-close">ยกเลิก</button><button class="btn primary" data-act="compare-confirm">ยืนยันเปลี่ยนแผน</button></div>`;
}

/* ---------- เพิ่มเข้าวัน ---------- */
function addBody(m: Extract<Modal, { type: 'add' }>): string {
  const p = app.getPlace(m.placeId);
  if (!p) return 'ไม่พบสถานที่';
  const day = app.findDay(m.dayId) ?? app.day;
  const positions = [];
  const startName = app.getPlace(day.startPlaceId)?.nameTh ?? 'จุดเริ่ม';
  for (let i = 0; i <= day.stops.length; i++) {
    const prev = i === 0 ? startName : (app.getPlace(day.stops[i - 1].placeId)?.nameTh ?? day.stops[i - 1].title ?? (day.stops[i - 1].kind === 'dinner' ? 'มื้อเย็น' : 'รายการ'));
    const next = i === day.stops.length ? (app.getPlace(day.endPlaceId)?.nameTh ?? 'จุดสิ้นสุด') : (app.getPlace(day.stops[i].placeId)?.nameTh ?? day.stops[i].title ?? (day.stops[i].kind === 'dinner' ? 'มื้อเย็น' : 'รายการ'));
    positions.push({ i, label: `ระหว่าง ${prev} → ${next}` });
  }
  const dinnerFree = day.stops.find((s) => s.kind === 'dinner' && !s.placeId);
  return `
    <p><b>${esc(p.nameTh)}</b> ${p.lat == null ? '<span class="pill warn">ยังไม่มีพิกัด — คำนวณเส้นทางไม่ได้ ต้องกรอกเวลาเอง</span>' : ''}</p>
    <label class="block">วัน <select class="inp" data-act-change="add-day-select">${app.plan.days.map((d, i) => `<option value="${d.id}" ${d.id === day.id ? 'selected' : ''}>${esc(dayDate(d, i))} (วัน ${i + 1})</option>`).join('')}</select></label>
    <p class="small muted">เลือกตำแหน่งที่จะแทรก แล้วดูผลต่อเวลาก่อนยืนยัน</p>
    <div class="pos-list">
      ${positions.map((x) => `<button class="btn block-btn" data-act="add-at" data-i="${x.i}">${esc(x.label)}</button>`).join('')}
      ${p.category === 'food' && dinnerFree ? `<button class="btn primary block-btn" data-act="add-as-dinner" data-stop="${dinnerFree.uid}">ใช้เป็นร้าน${mealName(dinnerFree)}ของวันนี้</button>` : ''}
    </div>`;
}

/* ---------- มื้อเย็น ---------- */
function dinnerBody(m: Extract<Modal, { type: 'dinner' }>): string {
  const day = app.findDay(m.dayId);
  if (!day) return '';
  const i = day.stops.findIndex((s) => s.uid === m.stopUid);
  const prevLoc = [...day.stops.slice(0, i)].reverse().map(stopLocationId).find(Boolean) ?? day.startPlaceId;
  const prev = app.getPlace(prevLoc);
  const fromCoex = day.startPlaceId === 'coex' || day.afterBooth || prevLoc === 'coex';
  const zones: [string, string][] = [
    ['near-coex', 'กินใกล้ COEX แล้วกลับ'],
    ['near-hotel', 'กลับใกล้โรงแรมแล้วกิน'],
    ['between', 'แวะกินระหว่างทาง'],
    ['eat-shop', 'กินและช็อปเพิ่มหนึ่งจุด'],
    ['near-prev', `ใกล้จุดก่อนหน้า (${prev?.nameTh ?? '?'})`],
  ];
  const zone = m.zone ?? (fromCoex ? 'near-coex' : 'near-prev');
  const foods = app.places().filter((p) => p.food != null && p.lat != null);
  let list: Place[] = [];
  if (zone === 'near-prev' && prev?.lat != null) list = nearby({ lat: prev.lat, lng: prev.lng! }, foods, () => true, 2000, 12).map((x) => x.place);
  else if (zone === 'eat-shop') list = foods.filter((f) => f.lat != null);
  else list = foods.filter((f) => f.food?.diningZone === zone);
  const items = list
    .map((f) => {
      const dist = straightDist(prevLoc, f.id);
      let pairBtn = '';
      if (zone === 'eat-shop' && f.lat != null) {
        const shop = nearby({ lat: f.lat, lng: f.lng! }, app.places(), (p) => p.category === 'fashion' || p.category === 'beauty', 1200, 1)[0];
        if (!shop) return '';
        pairBtn = `<button class="btn sm primary" data-act="dinner-pick" data-place="${esc(f.id)}" data-shop="${esc(shop.place.id)}">ดูผล: กิน + ช็อป ${esc(shop.place.nameTh)} (${fmtDist(shop.distM)} เส้นตรง)</button>`;
      }
      return `<div class="pick">
        <div><b>${esc(f.nameTh)}</b> <span class="muted small">${esc(f.nameEn)}</span><br>
        <span class="small">${f.food ? `${FOOD_TYPE_LABEL[f.food.type]} · ${DINING_ZONE_LABEL[f.food.diningZone]} · ${esc(f.food.menu.slice(0, 3).join(', '))} · ทาน ~${f.food.mealMin} นาที` : ''}${f.hours?.lastOrder ? ` · L.O. ${esc(f.hours.lastOrder)}` : ''}</span><br>
        <span class="muted small">${dist != null ? `ห่างจาก${esc(prev?.nameTh ?? 'จุดก่อนหน้า')} ${fmtDist(dist)} (เส้นตรง)` : 'ยังไม่มีพิกัด'}</span></div>
        ${pairBtn || `<button class="btn sm primary" data-act="dinner-pick" data-place="${esc(f.id)}">ดูผลก่อนเลือก</button>`}
      </div>`;
    })
    .join('');
  return `
    ${fromCoex ? '<p class="notice">วันนี้เริ่มจาก/เพิ่งออกจาก COEX — เทียบตัวเลือกด้านล่าง ระบบใช้เวลาที่คุณกรอก ไม่สมมติเวลาเลิกงาน</p>' : ''}
    <div class="chips">${zones.map(([k, v]) => `<button class="chip ${zone === k ? 'on' : ''}" data-act="dinner-zone" data-v="${k}">${esc(v)}</button>`).join('')}</div>
    ${zone === 'between' ? '<p class="muted small">“ระหว่างทาง” คัดจากร้านที่อยู่ใกล้สถานีบนเส้นทางรถไฟจริงระหว่าง COEX กับโรงแรม (ดูหมายเหตุในการ์ดร้าน) — เวลาจริงดูได้ในหน้าผลก่อนยืนยัน</p>' : ''}
    <div class="pick-list">${items || '<p class="empty">ไม่มีร้านในกลุ่มนี้</p>'}</div>`;
}

/* ---------- ใกล้จุดนี้ ---------- */
function nearbyBody(m: Extract<Modal, { type: 'nearby' }>): string {
  const day = app.findDay(m.dayId);
  const stop = day?.stops.find((s) => s.uid === m.stopUid);
  const p = app.getPlace(stop?.placeId);
  if (!p || p.lat == null) return '<p>จุดนี้ยังไม่มีพิกัด</p>';
  const want = m.want === 'shop' ? (x: Place) => x.category === 'fashion' || x.category === 'beauty' || x.category === 'market' : (x: Place) => x.category === 'food' || x.category === 'market';
  const list = nearby({ lat: p.lat, lng: p.lng! }, app.places(), want, 1500, 8);
  return `<p class="muted small">เรียงตามระยะเส้นตรงจาก ${esc(p.nameTh)} (ไม่ใช่ระยะเดินจริง) · ดูผลต่อเวลาก่อนเพิ่ม</p>
    <div class="pick-list">${list.length ? list.map((x) => `<div class="pick"><div>${CATEGORY_ICON[x.place.category]} <b>${esc(x.place.nameTh)}</b><br><span class="muted small">${fmtDist(x.distM)} (เส้นตรง) · แวะ ~${app.stayFor(x.place.id)} นาที</span></div><button class="btn sm primary" data-act="nearby-pick" data-place="${esc(x.place.id)}">ดูผลก่อนเพิ่ม</button></div>`).join('') : '<p class="empty">ไม่พบในระยะ 1.5 กม. (เส้นตรง)</p>'}</div>`;
}

/* ---------- ทางเลือกในร่ม ---------- */
function indoorBody(m: Extract<Modal, { type: 'indoor' }>): string {
  const day = app.findDay(m.dayId);
  if (!day) return '';
  const outdoor = day.stops.filter((s) => {
    const p = app.getPlace(s.placeId);
    return p && !p.indoor && p.lat != null;
  });
  if (!outdoor.length) return '<p>แผนวันนี้ไม่มีจุดกลางแจ้ง</p>';
  return `<p class="muted small">ระบบไม่เปลี่ยนแผนเอง — กด “ดูผลถ้าแทน” เพื่อเทียบเวลาก่อนยืนยัน</p>` +
    outdoor
      .map((s) => {
        const p = app.getPlace(s.placeId)!;
        const alts = nearby({ lat: p.lat!, lng: p.lng! }, app.places(), (x) => x.indoor && x.category !== 'base' && x.category !== 'food', 4000, 4);
        return `<h4>แทน ${esc(p.nameTh)}</h4><div class="pick-list">${alts.map((a) => `<div class="pick"><div><b>${esc(a.place.nameTh)}</b><br><span class="muted small">${fmtDist(a.distM)} (เส้นตรง) จาก ${esc(p.nameTh)}</span></div><button class="btn sm primary" data-act="indoor-replace" data-stop="${s.uid}" data-place="${esc(a.place.id)}">ดูผลถ้าแทน</button></div>`).join('') || '<p class="empty">ไม่พบตัวเลือกในร่มใกล้ ๆ</p>'}</div>`;
      })
      .join('');
}

/* ---------- เปรียบเทียบวิธีเดินทาง ---------- */
function routeBody(m: Extract<Modal, { type: 'route' }>): string {
  const from = app.getPlace(m.fromId);
  const to = app.getPlace(m.toId);
  if (!from || !to) return '';
  const day = app.findDay(m.dayId) ?? app.day;
  const dist = straightDist(m.fromId, m.toId);
  const g = googleStatus();
  const modes: TravelMode[] = ['TRANSIT', 'WALKING', 'DRIVING'];
  const cards = modes
    .map((mode) => {
      let r = m.date ? peekRoute(routeKey(m.fromId, m.toId, mode, m.date, m.departMins, day.prefs), m.fromId, m.toId, mode) : undefined;
      if (!r && m.date) {
        app.requestExtraRoute(m.fromId, m.toId, mode, m.date, m.departMins, day);
        r = undefined;
      }
      let body = '';
      if (!m.date) body = '<p class="warn-text small">ยังไม่เลือกวันที่ของวันนี้ — ขอข้อมูลตามวันเวลาไม่ได้</p>';
      else if (g.status !== 'ready') body = `<p class="warn-text small">${g.status === 'no-key' ? 'ยังไม่ได้ตั้งค่า Google Maps API Key' : g.status === 'loading' ? 'กำลังโหลดบริการ…' : esc(g.error)}</p>`;
      else if (!r) body = '<p class="muted small">กำลังขอข้อมูล…</p>';
      else if (r.status !== 'ok') body = `<p class="warn-text small">ไม่มีข้อมูล: ${esc(r.message || r.status)}</p>${mode !== 'TRANSIT' ? '<p class="muted small">Google ระบุว่าเส้นทางเดิน/ขับรถในเกาหลีใต้ไม่มีหรือคุณภาพต่ำ — ใช้ KakaoMap/Naver Map หรือกรอกเวลาเอง</p>' : ''}`;
      else body = `<p><b>${fmtDur(r.durationMin)}</b> · ${routeSummary(r)}</p>${mode === 'TRANSIT' ? stepsText(r.steps) : ''}`;
      return `<div class="mode-card"><h4>${MODE_ICON[mode]} ${MODE_LABEL[mode]}</h4>${body}
        ${mode === 'DRIVING' ? '<p class="muted small">ไม่รวมเวลารอเรียกรถ และไม่ใช่ราคาแท็กซี่ที่ยืนยันแล้ว</p>' : ''}
        <div class="row-btns">${m.stopUid ? `<button class="btn sm" data-act="route-use-mode" data-v="${mode}">ใช้วิธีนี้ในแผน</button>` : ''}
        <a class="btn sm" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(from, to, mode))}">Google Maps ↗</a></div></div>`;
    })
    .join('');
  return `<p><b>${esc(from.nameTh)}</b> → <b>${esc(to.nameTh)}</b></p>
    <p class="small">จุดอ้างอิง: ${esc(from.nameTh)} · ${m.date ? `${esc(fmtDateTh(m.date))} ออก ${m.departMins != null ? fmtHM(m.departMins) : 'ไม่ระบุเวลา'} (เวลาเกาหลี)` : 'ยังไม่เลือกวันที่'}</p>
    <label class="small">เปลี่ยนเวลาออก <input class="inp xs" type="time" value="${m.departMins != null ? fmtHM(m.departMins).slice(0, 5) : ''}" data-act-change="route-depart"></label>
    ${dist != null ? `<p class="muted small">ระยะเส้นตรง ${fmtDist(dist)} — ไม่ใช่ระยะเดินทางจริง</p>` : ''}
    <div class="mode-grid">${cards}</div>
    <p class="small">${naverBtn(naverRouteUrl(from, to), naverLabel('ดูรถเมล์/รถไฟใน Naver Map'))} <span class="muted">แม่นที่สุดในเกาหลี: สายรถเมล์ เวลารถมา ทางออกสถานี</span></p>
    ${kakaoToUrl(to) ? `<p class="small"><a target="_blank" rel="noopener" href="${esc(kakaoToUrl(to)!)}">เปิดใน KakaoMap ↗</a> (มีเส้นทางเดิน/รถในเกาหลี)</p>` : ''}`;
}

/* ---------- แม่แบบ ---------- */
/** วันปลายทางของการ์ดแม่แบบ: ที่ผู้ใช้เลือกไว้ › แม่แบบลงวันที่ = วันที่ตรงกัน › เมนูรายวัน = วันที่กำลังดู › ลำดับเดียวกัน */
export function tplTargetDay(m: Extract<Modal, { type: 'templates' }>, tpl: Template, i: number): string {
  const chosen = m.targets?.[i];
  if (chosen && app.findDay(chosen)) return chosen;
  const td = tpl.days[i];
  const byDate = td.date ? app.plan.days.find((d) => d.date === td.date) : undefined;
  if (byDate) return byDate.id;
  if (tpl.pick) return app.activeDayId;
  return (app.plan.days[i] ?? app.day).id;
}

function templatesBody(m: Extract<Modal, { type: 'templates' }>): string {
  const tpl = TEMPLATES.find((t) => t.id === m.tplId) ?? TEMPLATES[0];
  const addBtn = (i: number, p: Place, inDay: boolean, label = '') =>
    `<button class="btn ghost xs ${inDay ? 'on' : ''}" data-act="tpl-add-place" data-tpl="${tpl.id}" data-i="${i}" data-place="${esc(p.id)}" aria-pressed="${inDay}" aria-label="${inDay ? 'เอาออกจากวันนั้น' : 'เพิ่มเข้าวันนั้น'} ${esc(p.nameTh)}">${inDay ? '✓' : '＋'}${label}</button>`;
  const hint = tpl.pick
    ? 'เลือกวันที่ช่องล่างการ์ด แล้วกด “ใช้เป็นวันนั้น” หรือกด ＋ ทีละจุด · แทนที่แล้วนัดที่ล็อกเวลา (COEX/สนามบิน) ยังอยู่ · กดเลิกทำได้'
    : tpl.dated
      ? 'แม่แบบนี้ลงวันที่และนัดหมายไว้แล้ว ใช้แล้วยังแก้/ย้าย/ลบได้ทุกจุด'
      : 'แม่แบบไม่กำหนดวันที่หรือเวลา คุณกำหนดเองในแต่ละวัน';
  return `
    <p class="muted small">การดูแม่แบบไม่เปลี่ยนแผนที่กำลังแก้ไข · ${hint}</p>
    <div class="chips">${TEMPLATES.map((t) => `<button class="chip ${t.id === tpl.id ? 'on' : ''}" data-act="tpl-tab" data-v="${t.id}">${esc(t.id)}. ${esc(t.name)}</button>`).join('')}</div>
    <p>${esc(tpl.desc)}</p>
    <div class="tpl-days">
      ${tpl.days
        .map((d, i) => {
          const targetId = tplTargetDay(m, tpl, i);
          const target = app.findDay(targetId)!;
          const inTarget = (pid: string) => target.stops.some((s) => s.placeId === pid);
          const near = nearbyForTemplateDay(d, app.places());
          const head = d.date ? `${esc(fmtDateTh(d.date))}${d.startTime ? ` · ออก ${esc(d.startTime)}` : ''}: ` : tpl.pick ? '' : `กลุ่ม ${i + 1}: `;
          return `<div class="card tpl-day" data-tpl-card="${i}"><h4>${head}${esc(d.title)}</h4><p class="muted small">${esc(d.note)}</p>
        <ol>${d.stops
          .map((s) => {
            const p = app.getPlace(s.placeId);
            const lock = s.lockedTime ? `🔒 ${esc(s.lockedTime)} ` : '';
            const tip = s.note ? `<br><span class="muted small">${esc(s.note)}</span>` : '';
            if (!p) return s.breakTitle ? `<li>☕ ${lock}${esc(s.breakTitle)} <span class="muted small">~${s.stayMin} นาที</span>${tip}</li>` : '';
            return `<li>${CATEGORY_ICON[p.category] ?? ''} ${lock}${esc(p.nameTh)} <span class="muted small">~${s.stayMin} นาที${s.dinner ? ' · มื้อเย็น' : ''}</span> <a class="btn ghost xs" href="${esc(photosUrl(p))}" target="_blank" rel="noopener" aria-label="ดูรูป ${esc(p.nameTh)}">📷</a> ${p.category === 'base' ? '' : addBtn(i, p, inTarget(p.id))}${tip}</li>`;
          })
          .join('')}</ol>
        ${near.length ? `<div class="tpl-near"><span class="muted small">ที่ใกล้เคียง (เติมเองได้):</span> ${near.map((n) => `<span class="near-chip">${addBtn(i, n.place, inTarget(n.place.id), ` ${CATEGORY_ICON[n.place.category] ?? ''} ${esc(n.place.nameTh)} <span class="muted">· ${esc(fmtDist(n.distM))}</span>`)}<a class="btn ghost xs" href="${esc(photosUrl(n.place))}" target="_blank" rel="noopener" aria-label="ดูรูป ${esc(n.place.nameTh)}">📷</a></span>`).join('')}</div>` : ''}
        <div class="row-btns tpl-actions"><label class="small">ใช้กับ <select class="inp xs" data-act-change="tpl-target" data-i="${i}" aria-label="วันปลายทาง">${app.plan.days.map((dd, k) => `<option value="${dd.id}" ${dd.id === targetId ? 'selected' : ''}>${esc(dayDate(dd, k))}${dd.date ? ` (วัน ${k + 1})` : ''}</option>`).join('')}</select></label>
        <button class="btn sm primary" data-act="tpl-copy-day" data-tpl="${tpl.id}" data-i="${i}" data-mode="replace">ใช้เป็นวันนั้น</button>
        <button class="btn sm" data-act="tpl-copy-day" data-tpl="${tpl.id}" data-i="${i}" data-mode="append">เพิ่มต่อท้าย</button></div></div>`;
        })
        .join('')}
    </div>
    <div class="modal-actions sticky"><button class="btn" data-act="tpl-blank">เริ่มจากแผนว่าง (สร้างแผนใหม่)</button>${tpl.pick ? '' : `<button class="btn primary" data-act="tpl-apply-all" data-tpl="${tpl.id}">ใช้ทั้งแม่แบบนี้</button>`}</div>`;
}

/* ---------- แชร์ ---------- */
function syncSection(): string {
  if (!SYNC_DB_URL) return '';
  const room = app.plan.roomId;
  if (!room)
    return `<div class="card sync-card"><h4>👥 วางแผนร่วมกับเพื่อน (ซิงก์สด)</h4>
      <p class="small">ส่งลิงก์ให้เพื่อน แล้ว<b>แก้ได้ทั้งคู่</b> ใครแก้อีกเครื่องเห็นทันที · ถ้าแก้พร้อมกันจุดเดียวกัน ฉบับที่บันทึกทีหลังจะถูกใช้</p>
      <button class="btn primary" data-act="sync-start">เริ่มแชร์แผนนี้กับเพื่อน</button></div>`;
  const url = inviteUrl(location.href, room);
  return `<div class="card sync-card"><h4>👥 แผนนี้ซิงก์กับเพื่อนอยู่</h4>
    <p class="small">ส่งลิงก์หรือให้เพื่อนสแกน QR — เปิดแล้วจะเห็นและแก้แผนเดียวกัน · <b>ใครมีลิงก์นี้แก้แผนได้</b> ส่งเฉพาะคนที่ไปด้วย</p>
    <div class="share-row"><input class="inp" readonly value="${esc(url)}" aria-label="ลิงก์ชวนเพื่อน" id="invite-url"><button class="btn primary" data-act="copy-invite">คัดลอกลิงก์</button></div>
    <div class="qr-wrap"><canvas id="qr-invite" aria-label="QR code ลิงก์ชวนเพื่อน"></canvas></div>
    <button class="btn ghost sm danger" data-act="sync-stop">หยุดซิงก์ในเครื่องนี้</button></div>`;
}

/** ส่งแผนจากโน้ตบุ๊ก/iPad ไปมือถือ: ลิงก์มีแผนทั้งหมด → มือถือเปิดแล้วกด "ใช้แผนนี้ในมือถือ" */
function phoneSection(r: ReturnType<typeof buildShareUrl>): string {
  if (!r.ok) return `<div class="card phone-card"><h4>📱 ส่งแผนไปมือถือ</h4><p class="warn-text">แผนใหญ่เกินไปสำหรับลิงก์ — ใช้ Export JSON แล้วเปิดไฟล์ในมือถือ</p></div>`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return `<div class="card phone-card">
    <h4>📱 ส่งแผนไปมือถือ</h4>
    <ol class="phone-steps small">
      <li>กด “ยืนยันแผนวันนี้” ให้ครบทุกวันที่แก้ก่อน</li>
      <li>${canShare ? 'กด <b>ส่งลิงก์</b> → เลือก AirDrop / LINE / ข้อความ ไปที่มือถือ' : 'กด <b>คัดลอกลิงก์</b> แล้วส่งให้ตัวเองทาง LINE / อีเมล'}${r.qr ? ' หรือสแกน QR ด้วยกล้องมือถือ' : ''}</li>
      <li>เปิดลิงก์ในมือถือ → กด <b>ใช้แผนนี้ในมือถือ</b> · หน้า “วันนี้” จะแสดงมื้ออาหารและการเดินทางตามแผน</li>
    </ol>
    <div class="share-row"><input class="inp" readonly value="${esc(r.url)}" aria-label="ลิงก์แผน" id="share-url">${canShare ? '<button class="btn primary" data-act="share-native">📤 ส่งลิงก์</button>' : ''}<button class="btn ${canShare ? '' : 'primary'}" data-act="copy-link">คัดลอก</button></div>
    ${r.qr ? '<div class="qr-wrap"><canvas id="qr" aria-label="QR code ลิงก์แผน"></canvas></div>' : '<p class="muted small">แผนยาวเกินกว่าจะใส่ QR ได้ — ใช้ปุ่มส่งลิงก์แทน</p>'}
    <p class="muted small">ลิงก์คือ<b>สำเนาแผน ณ ตอนนี้</b> — แก้แผนอีกครั้งต้องส่งใหม่ · ข้อมูลอยู่ในส่วน # ของลิงก์ (ไม่ถูกส่งไปเซิร์ฟเวอร์) · การเช็กอินในมือถือไม่หายเมื่อรับแผนใหม่${location.protocol !== 'https:' ? '<br><b class="warn-text">ตอนนี้เปิดจาก ' + esc(location.origin) + ' — มือถืออาจเปิดไม่ได้ ใช้เว็บที่ github.io</b>' : ''}</p>
  </div>`;
}

function shareBody(): string {
  const r = buildShareUrl(app.plan, location.href);
  return `
    ${phoneSection(r)}
    ${syncSection()}
    <p class="small">${app.storageOk ? (app.saveOk ? '✓ บันทึกในเครื่องนี้ (localStorage) แล้ว — แต่ไม่ซิงก์ไปเครื่องอื่นเอง' : '⚠ บันทึกในเครื่องไม่สำเร็จ (พื้นที่เต็ม?) — โปรด Export JSON') : '⚠ เบราว์เซอร์นี้บันทึกในเครื่องไม่ได้ (เช่น โหมดส่วนตัว) — โปรด Export JSON ก่อนปิด'}</p>
    <h4>ข้อความ / ไฟล์ (สำรองข้อมูล)</h4>
    <div class="row-btns">
      <button class="btn" data-act="copy-text">คัดลอกแผนเป็นข้อความ</button>
      <button class="btn" data-act="export-json">Export JSON</button>
      <label class="btn">Import JSON<input type="file" accept="application/json,.json" data-act-change="import-file" hidden></label>
    </div>
    <h4>แผนในเครื่องนี้</h4>
    <ul class="plan-list">${app.store.plans.map((p) => `<li>${p.id === app.plan.id ? '▶ ' : ''}<button class="link" data-act="switch-plan" data-v="${p.id}">${esc(p.name)}</button> <span class="muted small">${p.days.length} วัน · แก้ไข ${esc(new Date(p.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }))}</span>${app.store.plans.length > 1 ? ` <button class="btn ghost xs danger" data-act="delete-plan" data-v="${p.id}">ลบ</button>` : ''}</li>`).join('')}</ul>
    <label class="small">ชื่อแผน <input class="inp" value="${esc(app.plan.name)}" maxlength="80" data-act-change="plan-name"></label>`;
}

function importBody(m: Extract<Modal, { type: 'import' }>): string {
  const p = m.plan;
  const same = app.store.plans.some((x) => x.id === p.id);
  return `<p>พบแผน <b>${esc(p.name)}</b> (${p.days.length} วัน${p.days[0]?.date ? `, เริ่ม ${esc(fmtDateTh(p.days[0].date))}` : ''}) จาก${m.source === 'link' ? 'ลิงก์' : 'ไฟล์'}${same ? ' · <b>ฉบับใหม่ของแผนที่มีในเครื่องนี้</b>' : ''}</p>
    <ul class="import-days">${p.days.map((d, i) => `<li><b style="color:${dayColor(i)}">${esc(dayDate(d, i))}</b> ${d.stops.map((s) => esc(app.getPlace(s.placeId)?.nameTh ?? s.title ?? s.kind)).join(' → ') || '—'}</li>`).join('')}</ul>
    <p class="muted small">ใช้แผนนี้ = แทนที่แผนในเครื่องนี้ (เวลาที่เช็กอินไว้ในเครื่องนี้ยังอยู่ · กดเลิกทำได้)${m.warnings.length ? ` · คำเตือน: ${esc(m.warnings.join(', '))}` : ''}</p>
    <div class="modal-actions sticky"><button class="btn" data-act="modal-close">ยกเลิก</button><button class="btn" data-act="import-copy">เก็บเป็นแผนแยก</button><button class="btn primary" data-act="import-replace">✓ ใช้แผนนี้ในเครื่องนี้</button></div>`;
}

/* ---------- เพิ่มสถานที่เอง ---------- */
function customBody(): string {
  return `<form data-form="custom" class="form">
    <label>ชื่อ* <input class="inp" name="name" required maxlength="120" placeholder="ชื่อร้าน/สถานที่"></label>
    <label>หมวด <select class="inp" name="category">${(Object.keys(OWN_CATEGORY_LABEL) as OwnCategory[]).map((c) => `<option value="${c}" ${c === 'sight' ? 'selected' : ''}>${OWN_CATEGORY_LABEL[c]}</option>`).join('')}</select></label>
    <label>พิกัด <input class="inp" name="coord" placeholder="วางรหัส เช่น HX7M+HQ8 หรือ 37.5438, 127.0557 (ไม่บังคับ)"></label>
    <p class="muted small">ในหน้าร้านของ Google Maps มีบรรทัดรหัสแบบ <b>HX7M+HQ8 Seoul</b> (ไอคอนจุดตาราง) → กดค้าง/คัดลอก แล้ววางที่นี่ · ไม่ใส่พิกัด = ยังจัดในแผนได้ แต่ไม่ปักหมุด</p>
    <label>อยู่ประมาณ (นาที) <input class="inp" name="stay" type="number" value="45" min="5" max="600"></label>
    <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">ยกเลิก</button><button class="btn primary">บันทึก</button></div>
  </form>`;
}

function settingsBody(): string {
  const g = googleStatus();
  return `<form data-form="settings" class="form">
    <p>สถานะ Google Maps: <b>${{ 'no-key': 'ยังไม่มีคีย์', loading: 'กำลังโหลด', ready: 'พร้อมใช้งาน', error: 'ผิดพลาด' }[g.status]}</b> ${g.error ? `<span class="warn-text small">${esc(g.error)}</span>` : ''}</p>
    <label>Google Maps API Key <input class="inp" name="apiKey" value="${esc(app.settings.apiKey ?? '')}" autocomplete="off" spellcheck="false"></label>
    <label>Map ID (สำหรับหมุดแบบ Advanced) <input class="inp" name="mapId" value="${esc(app.settings.mapId ?? '')}" placeholder="DEMO_MAP_ID"></label>
    <p class="muted small">คีย์เก็บเฉพาะในเบราว์เซอร์เครื่องนี้ ไม่อยู่ในลิงก์แชร์/ไฟล์ JSON · ผู้ดูแลเว็บตั้งค่า VITE_GOOGLE_MAPS_API_KEY ตอน build ได้ · จำกัดคีย์ด้วย HTTP referrer และเปิดเฉพาะ Maps JavaScript API + Routes API + Places API (New) (ใช้ค้นหาสถานที่ด้วยชื่อ)</p>
    <div class="modal-actions"><button type="button" class="btn" data-act="modal-close">ยกเลิก</button><button class="btn primary">บันทึกและโหลดใหม่</button></div>
  </form>`;
}

export function parseTime(v: string): number | null {
  return parseHM(v);
}
export { dayColor };
