import L from 'leaflet';
import type { Place } from '../core/types';
import { app } from './app';
import { esc, dayDate, IC, iconBtn } from './util';
import { uid } from '../core/planOps';
import { buildOwnPlace, OWN_CATEGORY_LABEL, type OwnCategory } from '../core/ownPlace';
import { coordError, parseLatLng } from '../core/coords';
import { cleanLinks } from '../storage/validate';
import { placePhotos, resizeImage } from '../services/shopPhotos';
import { placeInfoHtml, hydratePlacePhotos } from './views/placeInfo';
import { ZONES, ZONE_AREA, zoneOf, zoneShort, type Zone } from '../core/zones';
import { signedInUser } from '../services/tripSync';

/**
 * หน้า "สถานที่": เพิ่ม/แก้สถานที่ของฉัน (ชื่อ · ตำแหน่ง · รูป · ลิงก์ · โน้ต) พร้อมแผนที่ของตัวเอง
 * — สถานที่ที่เพิ่มที่นี่ใช้ในตัวจัดแผนได้ทุกวัน · รูปเก็บในเครื่องนี้ (IndexedDB)
 */

const MAX_PHOTOS = 12;
const PHOTO_PX = 1280;

interface FormState {
  id: string | null; // null = เพิ่มใหม่
  name: string;
  category: OwnCategory;
  coord: string;
  stay: number;
  /** ย่านที่เลือกเอง ('' = เดาจากตำแหน่ง) */
  zone: Zone | '';
  note: string;
  links: string;
  error: string;
}

let root: HTMLElement | null = null;
let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;
let sel: string | null = null;
let form: FormState | null = null;
let picking = false;
let viewer: { placeId: string; i: number } | null = null;
let busy: string | null = null;
let fitKey = '';

const mine = (): Place[] => app.plan.customPlaces;
const ownCat = (p: Place): OwnCategory => (p.food?.type === 'cafe' ? 'cafe' : ((Object.keys(OWN_CATEGORY_LABEL) as OwnCategory[]).find((c) => c === p.category) ?? 'sight'));

/** วันที่ใช้สถานที่นี้ (วันที่จริง) */
function usedOn(id: string): string[] {
  return app.plan.days.flatMap((d, i) => (d.stops.some((s) => s.placeId === id) || d.startPlaceId === id || d.endPlaceId === id ? [dayDate(d, i)] : []));
}

/** พิกัดจากช่องในฟอร์ม (ใช้ทำหมุดตัวอย่าง) */
const formPoint = () => (form?.coord.trim() ? parseLatLng(form.coord) : null);

export function initMyPlaces(el: HTMLElement) {
  root = el;
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  // ล้างรูปที่ไม่มีสถานที่ไหนใช้แล้ว (ทุกแผนในเครื่อง) — ทำตอนเปิดแอปครั้งเดียว เลิกทำในรอบนี้จึงยังได้รูปคืน
  void placePhotos.photoIds().then((ids) => {
    const used = new Set(app.store.plans.flatMap((p) => p.customPlaces.flatMap((c) => c.photos ?? [])));
    void placePhotos.deletePhotos(ids.filter((id) => !used.has(id)));
  });
}

export function renderMyPlaces() {
  if (!root) return;
  if (!root.querySelector('#pp-map')) {
    root.innerHTML = `<div class="pp-list"></div><div class="pp-mapcol"><div class="pp-mapwrap"><div id="pp-map"></div><button class="btn sm pp-fit" data-pp="fit">พอดีจอ</button></div><p class="muted small pp-maphint"></p></div><div class="pp-viewer-root"></div>`;
  }
  const list = root.querySelector('.pp-list') as HTMLElement;
  const keep = list.scrollTop;
  const focusedName = (document.activeElement as HTMLElement | null)?.dataset?.ppField;
  list.innerHTML = listHtml();
  list.scrollTop = keep;
  if (focusedName) (list.querySelector(`[data-pp-field="${focusedName}"]`) as HTMLInputElement | null)?.focus();
  else (list.querySelector('[data-autofocus]') as HTMLInputElement | null)?.focus();
  (root.querySelector('.pp-maphint') as HTMLElement).textContent = picking ? 'แตะบนแผนที่ตรงตำแหน่งร้าน' : 'หมุดแดง = ตำแหน่งที่กำลังใส่ · แตะหมุดเพื่อดูรายละเอียด';
  root.classList.toggle('picking', picking);
  (root.querySelector('.pp-viewer-root') as HTMLElement).innerHTML = viewerHtml();
  hydratePlacePhotos(root);
  drawMap();
}

/* ---------------- HTML ---------------- */
function listHtml(): string {
  const ps = mine();
  return `
    <div class="pp-head"><h2>สถานที่ที่เพิ่มเอง <span class="muted">(${ps.length})</span></h2>${form ? '' : '<button class="btn primary" data-pp="add">＋ เพิ่มสถานที่</button>'}</div>
    <p class="muted small pp-intro">ร้าน/ที่เที่ยวที่ไม่มีในรายการ — ใส่ตำแหน่ง แล้วเพิ่มรูปกับลิงก์ไว้ จะได้จำได้ว่าที่ไหน · ใช้ในหน้า “จัดแผน” ได้ทุกวัน</p>
    ${form && !form.id ? formHtml() : ''}
    ${ps.length ? ps.map(card).join('') : form ? '' : '<p class="empty">ยังไม่มีสถานที่ที่เพิ่มเอง — กด “＋ เพิ่มสถานที่”</p>'}`;
}

function formHtml(): string {
  const f = form!;
  const pt = formPoint();
  return `<form class="pp-form card" data-pp-form>
    <h3>${f.id ? 'แก้สถานที่' : 'เพิ่มสถานที่'}</h3>
    <label>ชื่อสถานที่<input class="inp" data-pp-field="name" value="${esc(f.name)}" maxlength="120" placeholder="เช่น Onion Anguk" required ${f.id ? '' : 'data-autofocus'}></label>
    <div class="pp-cat-field"><span>ประเภท</span><div class="chips pp-cats" role="radiogroup" aria-label="ประเภทสถานที่">${(Object.entries(OWN_CATEGORY_LABEL) as [OwnCategory, string][]).map(([k, v]) => `<button type="button" class="chip ${k === f.category ? 'on' : ''}" data-pp="cat" data-pp-cat="${k}" role="radio" aria-checked="${k === f.category}">${esc(v)}</button>`).join('')}</div></div>
    <label>ตำแหน่ง <span class="muted small">— วางพิกัด, Plus Code (เช่น HX7M+HQ8) หรือลิงก์ Google Maps แบบเต็ม</span>
      <span class="pp-coord"><input class="inp" data-pp-field="coord" value="${esc(f.coord)}" placeholder="37.5639, 126.9844" inputmode="text"><button type="button" class="btn sm ${picking ? 'primary' : ''}" data-pp="pick">${picking ? 'กำลังเลือก… แตะบนแผนที่' : '📍 แตะบนแผนที่'}</button></span></label>
    <p class="pp-coord-msg ${f.error ? 'bad-text' : 'muted'} small">${f.error ? esc(f.error) : pt ? `✓ ได้ตำแหน่งแล้ว (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}) — ดูหมุดแดงบนแผนที่ แล้วเช็กใน <a href="https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lng}" target="_blank" rel="noopener">Google Maps ↗</a>` : 'ยังไม่มีตำแหน่งก็บันทึกได้ (จะยังไม่ปักหมุด)'}</p>
    <label>ย่าน <span class="muted small">— ใช้กรองในหน้า “จัดแผน”</span><select class="inp" data-pp-field="zone">${zoneOptions(f)}</select></label>
    <label>โน้ต <span class="muted small">(ไม่บังคับ)</span><textarea class="inp" data-pp-field="note" rows="2" maxlength="500" placeholder="เช่น ร้านคาเฟ่ในบ้านเก่า สั่งขนมปังเกลือ">${esc(f.note)}</textarea></label>
    <label>ลิงก์ <span class="muted small">— บรรทัดละ 1 ลิงก์ (Google Maps, IG, รีวิว)</span><textarea class="inp" data-pp-field="links" rows="2" placeholder="https://…">${esc(f.links)}</textarea></label>
    <p class="muted small">เพิ่มรูปได้หลังบันทึก (ปุ่ม 📷 บนการ์ด)</p>
    <div class="row-btns"><button class="btn primary">บันทึก</button><button type="button" class="btn" data-pp="cancel">ยกเลิก</button></div>
  </form>`;
}

/** ย่านที่เดาได้จากตำแหน่งในฟอร์ม (สถานที่ใกล้สุดในรายการ ≤ 2 กม.) */
function autoZone(): Zone {
  if (!form) return 'other';
  const r = buildOwnPlace({ id: 'x', name: 'x', category: form.category, coord: form.coord, stay: 45 }, app.places());
  return r.ok ? zoneOf(r.place.area) : 'other';
}

function zoneOptions(f: FormState): string {
  const auto = autoZone();
  const zones = (Object.keys(ZONES) as Zone[]).filter((z) => z !== 'airport' && z !== 'other');
  return `<option value="" ${f.zone === '' ? 'selected' : ''}>${auto === 'other' ? 'เดาจากตำแหน่ง (ยังไม่รู้ย่าน)' : `เดาจากตำแหน่ง: ${esc(zoneShort(auto))}`}</option>${zones.map((z) => `<option value="${z}" ${f.zone === z ? 'selected' : ''}>${esc(ZONES[z].th)}</option>`).join('')}<option value="other" ${f.zone === 'other' ? 'selected' : ''}>อื่น ๆ (ไม่อยู่ในย่านไหน)</option>`;
}

function card(p: Place): string {
  if (form?.id === p.id) return formHtml();
  const used = usedOn(p.id);
  const n = p.photos?.length ?? 0;
  return `<article class="pp-card ${sel === p.id ? 'sel' : ''}" data-pp-card="${esc(p.id)}">
    <div class="pp-card-head">
      <button class="pp-name" data-pp="select" data-place="${esc(p.id)}">${esc(p.nameTh)}</button>
      <span class="muted small">${esc(OWN_CATEGORY_LABEL[ownCat(p)])}${zoneOf(p.area) !== 'other' ? ` · ${esc(zoneShort(zoneOf(p.area)))}` : ''}${p.addedBy ? ` · เพิ่มโดย ${esc(p.addedBy)}` : ''}</span>
    </div>
    ${p.lat == null ? '<p class="warn-text small">ยังไม่มีตำแหน่ง — กด “แก้” เพื่อใส่พิกัดหรือแตะบนแผนที่</p>' : ''}
    ${used.length ? `<p class="small pp-used">อยู่ในแผน: <b>${used.map(esc).join(', ')}</b></p>` : ''}
    ${placeInfoHtml(p, { photoAct: 'view' })}
    <div class="row-btns pp-actions">
      ${busy === p.id ? '<span class="muted small">กำลังเพิ่มรูป…</span>' : n < MAX_PHOTOS ? `<label class="btn sm btn-ico">${IC.camera}<span>เพิ่มรูป</span><input type="file" accept="image/*" multiple hidden data-pp-photo="${esc(p.id)}"></label>` : ''}
      ${iconBtn(IC.pencil, `แก้ ${p.nameTh}`, `data-pp="edit" data-place="${esc(p.id)}"`)}
      ${iconBtn(IC.trash, `ลบ ${p.nameTh}`, `data-pp="delete" data-place="${esc(p.id)}"`, 'ibtn danger')}
    </div>
  </article>`;
}

function viewerHtml(): string {
  if (!viewer) return '';
  const p = mine().find((x) => x.id === viewer!.placeId);
  const ids = p?.photos ?? [];
  if (!p || !ids.length) return '';
  const i = Math.min(viewer.i, ids.length - 1);
  return `<div class="pp-viewer" role="dialog" aria-label="รูป ${esc(p.nameTh)}">
    <div class="pp-viewer-bar"><b>${esc(p.nameTh)}</b> <span class="muted">${i + 1}/${ids.length}</span><button class="btn sm danger" data-pp="photo-del" data-i="${i}">ลบรูปนี้</button><button class="btn sm" data-pp="viewer-close" aria-label="ปิด">✕</button></div>
    <div class="pp-viewer-img">${ids.length > 1 ? `<button class="pp-nav prev" data-pp="viewer-go" data-i="${(i - 1 + ids.length) % ids.length}" aria-label="รูปก่อนหน้า">‹</button>` : ''}<img data-pphoto="${esc(ids[i])}" alt="">${ids.length > 1 ? `<button class="pp-nav next" data-pp="viewer-go" data-i="${(i + 1) % ids.length}" aria-label="รูปถัดไป">›</button>` : ''}</div>
  </div>`;
}

/* ---------------- แผนที่ ---------------- */
function drawMap() {
  const el = root?.querySelector('#pp-map') as HTMLElement | null;
  if (!el || !el.offsetParent) return;
  if (!map) {
    map = L.map(el, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!picking || !form) return;
      form.coord = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      form.error = '';
      picking = false;
      renderMyPlaces();
    });
    map.setView([37.5665, 126.978], 12);
  }
  setTimeout(() => map?.invalidateSize(), 0);
  layer!.clearLayers();
  const pts: L.LatLngExpression[] = [];
  for (const p of mine()) {
    if (p.lat == null || p.lng == null) continue;
    pts.push([p.lat, p.lng]);
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: `pp-pin ${sel === p.id ? 'sel' : ''}`, html: `<span>${esc(p.nameTh)}</span>`, iconSize: [0, 0] }),
      title: p.nameTh,
      zIndexOffset: sel === p.id ? 500 : 0,
    })
      .on('click', () => select(p.id, false))
      .addTo(layer!);
  }
  const pv = formPoint();
  if (pv) {
    L.marker([pv.lat, pv.lng], { icon: L.divIcon({ className: 'pp-pin preview', html: `<span>${esc(form?.name || 'ตำแหน่งใหม่')}</span>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(layer!);
  }
  // ซูมพอดีเมื่อจำนวนหมุดเปลี่ยน (ไม่กระโดดทุกครั้งที่แก้)
  const key = `${pts.length}`;
  if (key !== fitKey) {
    fitKey = key;
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 15 });
  }
}

function select(id: string, pan = true) {
  sel = id;
  const p = mine().find((x) => x.id === id);
  if (pan && p?.lat != null && map) map.setView([p.lat, p.lng!], Math.max(map.getZoom(), 16));
  renderMyPlaces();
  root?.querySelector(`[data-pp-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------------- เหตุการณ์ ---------------- */
function openForm(p: Place | null) {
  form = p
    ? { id: p.id, name: p.nameTh, category: ownCat(p), coord: p.lat != null ? `${p.lat}, ${p.lng}` : '', stay: p.suggestedStayMin, zone: zoneOf(p.area) === 'other' ? '' : zoneOf(p.area), note: p.notes ?? '', links: (p.links ?? []).join('\n'), error: '' }
    : { id: null, name: '', category: 'food', coord: '', stay: 45, zone: '', note: '', links: '', error: '' };
  picking = false;
}

function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-pp]') as HTMLElement | null;
  if (!el) return;
  const id = el.dataset.place ?? '';
  switch (el.dataset.pp) {
    case 'add':
      openForm(null);
      break;
    case 'edit': {
      const p = mine().find((x) => x.id === id);
      if (p) openForm(p);
      break;
    }
    case 'cancel':
      form = null;
      picking = false;
      break;
    case 'pick':
      picking = !picking;
      break;
    case 'cat':
      if (form) form.category = (el.dataset.ppCat as OwnCategory) ?? form.category;
      break;
    case 'select':
      select(id);
      return;
    case 'fit':
      fitKey = '';
      break;
    case 'delete':
      removePlace(id);
      return;
    case 'view':
      viewer = { placeId: id, i: Number(el.dataset.i) || 0 };
      break;
    case 'viewer-go':
      if (viewer) viewer = { ...viewer, i: Number(el.dataset.i) || 0 };
      break;
    case 'viewer-close':
      viewer = null;
      break;
    case 'photo-del':
      if (viewer) removePhoto(viewer.placeId, Number(el.dataset.i) || 0);
      return;
    default:
      return;
  }
  renderMyPlaces();
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.ppField as keyof FormState | undefined;
  if (!k || !form) return;
  (form as any)[k] = k === 'stay' ? Number(el.value) : el.value;
  if (k === 'coord') {
    form.error = '';
    // อัปเดตหมุดตัวอย่าง + ข้อความใต้ช่อง โดยไม่วาดฟอร์มใหม่ (ไม่ให้เคอร์เซอร์หลุด)
    const msg = root?.querySelector('.pp-coord-msg') as HTMLElement | null;
    const pt = formPoint();
    if (msg) {
      msg.className = `pp-coord-msg small ${pt || !form.coord.trim() ? 'muted' : 'bad-text'}`;
      msg.textContent = pt ? `✓ ได้ตำแหน่งแล้ว (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}) — ดูหมุดแดงบนแผนที่` : form.coord.trim() ? coordError(form.coord) : 'ยังไม่มีตำแหน่งก็บันทึกได้ (จะยังไม่ปักหมุด)';
    }
    drawMap();
    if (pt && map) map.setView([pt.lat, pt.lng], Math.max(map.getZoom(), 16));
    const zsel = root?.querySelector('[data-pp-field="zone"]') as HTMLSelectElement | null;
    if (zsel) {
      const keep = zsel.value;
      zsel.innerHTML = zoneOptions(form);
      zsel.value = keep;
    }
  }
}

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.ppPhoto && el.files?.length) {
    void addPhotos(el.dataset.ppPhoto, [...el.files]);
    el.value = '';
    return;
  }
  onInput(e);
}

function onSubmit(e: Event) {
  const f = e.target as HTMLFormElement;
  if (!f.matches('[data-pp-form]') || !form) return;
  e.preventDefault();
  const old = form.id ? mine().find((x) => x.id === form!.id) : undefined;
  const r = buildOwnPlace({ id: form.id ?? `custom-${uid('c')}`, name: form.name, category: form.category, coord: form.coord, stay: form.stay }, app.places());
  if (!r.ok) {
    form.error = r.error;
    renderMyPlaces();
    return;
  }
  const place: Place = { ...r.place, ...(form.zone ? { area: ZONE_AREA[form.zone] } : {}), notes: form.note.trim().slice(0, 500) || null, links: cleanLinks(form.links.split(/\s+/)), photos: old?.photos ?? null, addedBy: old ? old.addedBy ?? null : signedInUser()?.name || signedInUser()?.email?.split('@')[0] || null };
  const badLinks = form.links.split(/\s+/).filter(Boolean).length - (place.links?.length ?? 0);
  app.commit((p) => {
    p.customPlaces = old ? p.customPlaces.map((x) => (x.id === old.id ? place : x)) : [...p.customPlaces, place];
  });
  app.showToast(`${old ? 'บันทึก' : 'เพิ่ม'} ${place.nameTh} แล้ว${badLinks > 0 ? ` · ข้ามลิงก์ที่ไม่ใช่ http(s) ${badLinks} รายการ` : ''}`);
  form = null;
  picking = false;
  sel = place.id;
  renderMyPlaces();
}

function removePlace(id: string) {
  const p = mine().find((x) => x.id === id);
  if (!p) return;
  const used = usedOn(id);
  if (used.length) {
    app.showToast(`ลบไม่ได้ — ${p.nameTh} อยู่ในแผน ${used.join(', ')} · เอาออกจากแผนในหน้า “จัดแผน” ก่อน`);
    app.requestRender();
    return;
  }
  const before = app.plan.customPlaces;
  app.commit((pl) => (pl.customPlaces = pl.customPlaces.filter((x) => x.id !== id)));
  app.showToast(`ลบ ${p.nameTh} แล้ว`, () => app.commit((pl) => (pl.customPlaces = before), 'เลิกทำแล้ว'));
  if (sel === id) sel = null;
  renderMyPlaces();
}

async function addPhotos(id: string, files: File[]) {
  busy = id;
  renderMyPlaces();
  const added: string[] = [];
  try {
    const room = MAX_PHOTOS - (mine().find((x) => x.id === id)?.photos?.length ?? 0);
    for (const f of files.slice(0, Math.max(0, room))) {
      const blob = await resizeImage(f, PHOTO_PX);
      const pid = uid('ph');
      await placePhotos.putPhoto(pid, blob);
      added.push(pid);
    }
  } catch {
    app.showToast('เพิ่มรูปไม่ได้ — ลองรูปอื่น');
    app.requestRender();
  }
  busy = null;
  if (added.length) {
    app.commit((pl) => (pl.customPlaces = pl.customPlaces.map((x) => (x.id === id ? { ...x, photos: [...(x.photos ?? []), ...added] } : x))), `เพิ่มรูป ${added.length} รูปแล้ว (เก็บในเครื่องนี้)`);
    if (files.length > added.length) app.showToast(`เพิ่มได้ ${added.length} รูป — สูงสุด ${MAX_PHOTOS} รูปต่อสถานที่`);
  }
  renderMyPlaces();
}

function removePhoto(placeId: string, i: number) {
  const p = mine().find((x) => x.id === placeId);
  if (!p?.photos?.[i]) return;
  const before = p.photos;
  const next = before.filter((_, k) => k !== i);
  const put = (photos: string[]) => app.commit((pl) => (pl.customPlaces = pl.customPlaces.map((x) => (x.id === placeId ? { ...x, photos: photos.length ? photos : null } : x))));
  put(next);
  app.showToast('ลบรูปแล้ว', () => {
    put(before);
    renderMyPlaces();
  });
  viewer = next.length ? { placeId, i: Math.min(i, next.length - 1) } : null;
  renderMyPlaces();
}
