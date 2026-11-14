import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { markerContent, type LineSpec, type MarkerSpec } from './map';

/**
 * แผนที่ฟรีจาก OpenStreetMap (Leaflet) — ใช้เมื่อไม่มี Google Maps API Key
 * แสดงเฉพาะหมุดและ "เส้นเชื่อมลำดับ" (ไม่ใช่เส้นทางจริง) · ต้องแสดง attribution ตามนโยบาย OSM
 */
let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;
let clickHandler: (id: string) => void = () => {};
let lastSig = '';

export function onOsmMarkerClick(fn: (id: string) => void) {
  clickHandler = fn;
}

export function initOsm(el: HTMLElement): boolean {
  if (map) {
    if (map.getContainer().parentElement !== el) el.replaceChildren(map.getContainer());
    return true;
  }
  const div = document.createElement('div');
  div.style.width = '100%';
  div.style.height = '100%';
  el.replaceChildren(div);
  map = L.map(div, { zoomControl: true, attributionControl: true }).setView([37.545, 127.0], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  return true;
}

export function osmReady() {
  return !!map;
}

export function destroyOsm() {
  map?.remove();
  map = null;
  layer = null;
  lastSig = '';
}

export function syncOsm(specs: MarkerSpec[], lines: LineSpec[], fit: boolean) {
  if (!map || !layer) return;
  const sig = JSON.stringify([specs, lines.map((l) => [l.color, l.real, l.path.length, l.path[0], l.path[l.path.length - 1]])]);
  if (sig !== lastSig) {
    lastSig = sig;
    layer.clearLayers();
    for (const l of lines) {
      L.polyline(l.path.map((p) => [p.lat, p.lng] as [number, number]), {
        color: l.color,
        weight: l.real ? 5 : 3,
        opacity: l.real ? 0.85 : 0.7,
        dashArray: l.real ? undefined : '6 8',
      }).addTo(layer);
    }
    // จุดในคลังวางก่อน ให้หมุดของแผนอยู่ด้านบน
    const rank = (k: MarkerSpec['kind']) => (k === 'lib' ? 0 : k === 'search' ? 2 : 1);
    const ordered = [...specs].sort((a, b) => rank(a.kind) - rank(b.kind));
    for (const s of ordered) {
      const html = markerContent(s);
      html.classList.add('mk-osm');
      const icon = L.divIcon({ html: html.outerHTML, className: 'osm-icon', iconSize: [0, 0] });
      L.marker([s.lat, s.lng], { icon, title: s.title, zIndexOffset: s.kind === 'lib' ? 0 : s.kind === 'search' ? 2000 : 1000, keyboard: true })
        .on('click', () => clickHandler(s.id))
        .addTo(layer);
    }
  }
  if (fit) {
    const f = specs.filter((s) => s.focus);
    const pts = f.length ? f : specs.filter((s) => s.kind !== 'lib' && s.kind !== 'search');
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [36, 36], maxZoom: 15 });
    else if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 15);
  }
}

export function focusOsm(lat: number, lng: number) {
  if (!map) return;
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}

/** เรียกเมื่อกล่องแผนที่เพิ่งถูกแสดง (เช่นสลับแท็บบนมือถือ) */
export function refreshOsmSize() {
  map?.invalidateSize();
}
