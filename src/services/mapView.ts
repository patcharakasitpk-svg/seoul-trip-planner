import { initMap, mapReady, onMarkerClick, syncMap, focusOn, type LineSpec, type MarkerSpec } from './map';
import { destroyOsm, focusOsm, initOsm, onOsmMarkerClick, osmReady, refreshOsmSize, syncOsm } from './osmMap';

/** ตัวเลือกแผนที่: Google (มีคีย์) หรือ OpenStreetMap (ฟรี ไม่ต้องใช้คีย์) */
export type MapProvider = 'google' | 'osm' | null;
let provider: MapProvider = null;

export function mapProvider(): MapProvider {
  return provider;
}

export function startOsm(el: HTMLElement) {
  if (provider) return;
  initOsm(el);
  provider = 'osm';
}

/** สลับไปใช้ Google เมื่อโหลดคีย์สำเร็จ */
export async function switchToGoogle(el: HTMLElement, mapId: string): Promise<boolean> {
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0';
    const ok = await initMap(host, mapId);
    if (!ok) return false;
    destroyOsm();
    el.replaceChildren(host);
    provider = 'google';
    return true;
  } catch {
    return false;
  }
}

export function onMapMarkerClick(fn: (id: string) => void) {
  onMarkerClick(fn);
  onOsmMarkerClick(fn);
}

export function mapViewReady() {
  return provider === 'google' ? mapReady() : osmReady();
}

export function syncMapView(markers: MarkerSpec[], lines: LineSpec[], fit: boolean) {
  if (provider === 'google') syncMap(markers, lines, fit);
  else if (provider === 'osm') syncOsm(markers, lines, fit);
}

export function focusMapView(lat: number, lng: number) {
  if (provider === 'google') focusOn(lat, lng);
  else focusOsm(lat, lng);
}

export function refreshMapSize() {
  if (provider === 'osm') refreshOsmSize();
}
