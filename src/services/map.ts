import { I } from '../ui/icons';
import { isGoogleReady } from './google';

export interface MarkerSpec {
  id: string; // placeId
  lat: number;
  lng: number;
  kind: 'hotel' | 'venue' | 'stop' | 'lib' | 'search';
  title: string;
  /** ป้ายวัน/ลำดับ เช่น [{color, text:'1'}] — สถานที่เดียวหลายวันแสดงหลายป้ายในหมุดเดียว */
  badges: { color: string; text: string }[];
  areaCenter: boolean;
  /** อยู่ในวันที่แสดง (ใช้สำหรับซูมพอดีจอ) */
  focus?: boolean;
}

export interface LineSpec {
  path: { lat: number; lng: number }[];
  color: string;
  real: boolean; // true = เส้นทางจริงจากบริการ, false = เส้นเชื่อมลำดับ
}

let map: google.maps.Map | null = null;
let AdvMarker: any = null;
const markers = new Map<string, any>();
let lines: google.maps.Polyline[] = [];
let clickHandler: (id: string) => void = () => {};
let lastSig = '';

export function onMarkerClick(fn: (id: string) => void) {
  clickHandler = fn;
}

export async function initMap(el: HTMLElement, mapId: string): Promise<boolean> {
  if (!isGoogleReady()) return false;
  if (map) {
    if (map.getDiv() !== el) {
      el.replaceChildren(map.getDiv());
    }
    return true;
  }
  const g = (window as any).google;
  const { Map } = await g.maps.importLibrary('maps');
  const lib = await g.maps.importLibrary('marker');
  AdvMarker = lib.AdvancedMarkerElement;
  const div = document.createElement('div');
  div.style.width = '100%';
  div.style.height = '100%';
  el.replaceChildren(div);
  map = new Map(div, {
    center: { lat: 37.545, lng: 127.0 },
    zoom: 12,
    mapId: mapId || 'DEMO_MAP_ID',
    gestureHandling: 'greedy',
    clickableIcons: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  return true;
}

export function mapReady() {
  return !!map;
}

export function markerContent(spec: MarkerSpec): HTMLElement {
  const el = document.createElement('div');
  el.className = `mk mk-${spec.kind}${spec.areaCenter ? ' mk-area' : ''}`;
  el.title = spec.title;
  if (spec.kind === 'hotel') el.innerHTML = `<span class="mk-ico">${I.hotel}</span>`;
  else if (spec.kind === 'venue') el.innerHTML = `<span class="mk-ico">${I.building}</span>`;
  else if (spec.kind === 'lib') el.innerHTML = '';
  else if (spec.kind === 'search') el.innerHTML = `<span class="mk-ico">${I.pin}</span>`;
  for (const b of spec.badges.slice(0, 4)) {
    const s = document.createElement('span');
    s.className = 'mk-badge';
    s.style.background = b.color;
    s.textContent = b.text;
    el.append(s);
  }
  if (spec.badges.length > 4) {
    const s = document.createElement('span');
    s.className = 'mk-badge mk-more';
    s.textContent = `+${spec.badges.length - 4}`;
    el.append(s);
  }
  return el;
}

export function syncMap(specs: MarkerSpec[], lineSpecs: LineSpec[], fit: boolean) {
  if (!map || !AdvMarker) return;
  const sig = JSON.stringify([specs, lineSpecs.map((l) => [l.color, l.real, l.path.length, l.path[0], l.path[l.path.length - 1]])]);
  if (sig === lastSig) return;
  lastSig = sig;
  const seen = new Set<string>();
  for (const s of specs) {
    seen.add(s.id);
    const ex = markers.get(s.id);
    if (ex) {
      ex.position = { lat: s.lat, lng: s.lng };
      ex.content = markerContent(s);
      ex.title = s.title;
      ex.zIndex = s.kind === 'lib' ? 1 : s.kind === 'search' ? 20 : 10;
    } else {
      const m = new AdvMarker({ map, position: { lat: s.lat, lng: s.lng }, content: markerContent(s), title: s.title, zIndex: s.kind === 'lib' ? 1 : s.kind === 'search' ? 20 : 10, gmpClickable: true });
      m.addListener('click', () => clickHandler(s.id));
      markers.set(s.id, m);
    }
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      m.map = null;
      markers.delete(id);
    }
  }
  lines.forEach((l) => l.setMap(null));
  lines = lineSpecs.map(
    (l) =>
      new google.maps.Polyline({
        map,
        path: l.path,
        strokeColor: l.color,
        strokeOpacity: l.real ? 0.85 : 0,
        strokeWeight: l.real ? 5 : 2,
        icons: l.real ? undefined : [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: l.color, scale: 3 }, offset: '0', repeat: '12px' }],
      }),
  );
  if (fit) {
    const f = specs.filter((s) => s.focus);
    const pts = f.length ? f : specs.filter((s) => s.kind !== 'lib' && s.kind !== 'search');
    if (pts.length) {
      const b = new google.maps.LatLngBounds();
      pts.forEach((p) => b.extend(p));
      map.fitBounds(b, 48);
      if (pts.length === 1) map.setZoom(15);
    }
  }
}

export function focusOn(lat: number, lng: number) {
  if (!map) return;
  map.panTo({ lat, lng });
  if ((map.getZoom() ?? 0) < 15) map.setZoom(15);
}
