import type { Place, TravelMode } from '../core/types';
import naverIcon from '../assets/naver-map.png';
import gmapsIcon from '../assets/google-maps.png';

/** โลโก้แอปแผนที่ (ไฟล์ในเว็บเอง ไม่โหลดจากภายนอก) */
const logo = (src: string) => `<img class="app-logo" src="${src}" alt="" width="18" height="18">`;
export const naverLabel = (text = 'Naver Map') => `${logo(naverIcon)}<span>${text}</span>`;
export const googleLabel = (text = 'Google Maps') => `${logo(gmapsIcon)}<span>${text}</span>`;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const DAY_COLORS = ['#1f6feb', '#0ea47a', '#d9480f', '#8b5cf6', '#c2255c', '#0b7285', '#a16207', '#495057'];
export const dayColor = (i: number) => DAY_COLORS[i % DAY_COLORS.length];

export const MODE_LABEL: Record<TravelMode, string> = { TRANSIT: 'ขนส่งสาธารณะ', WALKING: 'เดิน', DRIVING: 'รถยนต์/แท็กซี่' };
export const MODE_ICON: Record<TravelMode, string> = { TRANSIT: '🚇', WALKING: '🚶', DRIVING: '🚕' };
const GM_MODE: Record<TravelMode, string> = { TRANSIT: 'transit', WALKING: 'walking', DRIVING: 'driving' };

export const SOURCE_LABEL: Record<string, string> = {
  user: 'ผู้ใช้กำหนด',
  service: 'จากบริการ',
  estimate: 'ประมาณการ',
  none: 'ยังไม่มีข้อมูล',
  same: 'จุดเดิม',
};

function placeQuery(p: Place): string {
  if (p.lat != null && p.lng != null) return `${p.lat},${p.lng}`;
  return [p.nameEn, p.branch, p.address].filter(Boolean).join(' ');
}

export function gmapsPlaceUrl(p: Place): string {
  const q = p.lat != null && p.lng != null && p.coordStatus !== 'area-center' ? `${p.nameEn} ${p.address ?? ''}`.trim() : placeQuery(p);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || placeQuery(p))}`;
}

/**
 * ลิงก์ดูรูปสถานที่ใน Google รูปภาพ — ใช้ชื่อเกาหลีเป็นหลัก (ได้รูปตรงร้าน/สาขามากกว่าชื่ออังกฤษ)
 * สถานที่ที่เพิ่มจากการค้นหา Google ใช้ลิงก์ Google Maps (มีแท็บรูปของสถานที่นั้น)
 */
export function photosUrl(p: Place): string {
  const gm = p.sources.find((s) => s.url.includes('query_place_id='));
  if (gm) return gm.url;
  const q = p.nameKo ? p.nameKo.replace(/\s*\(.*?\)\s*/g, ' ').trim() : `${p.nameEn} ${p.area && p.area !== 'เพิ่มเอง' ? p.area : ''} Seoul`.trim();
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

/** origin = null → ใช้ตำแหน่งปัจจุบันของผู้ใช้ */
export function gmapsDirUrl(from: Place | null, to: Place, mode: TravelMode): string {
  const p = new URLSearchParams({ api: '1', destination: placeQuery(to), travelmode: GM_MODE[mode] });
  if (from) p.set('origin', placeQuery(from));
  return `https://www.google.com/maps/dir/?${p}`;
}

/**
 * Naver Map (แอป) — เส้นทางขนส่งสาธารณะ: รถเมล์/รถไฟฟ้า เวลารถมาจริง ทางออกสถานี
 * ใช้ URL scheme ทางการ nmap://route/public · ไม่ใส่ต้นทาง = ใช้ตำแหน่งปัจจุบันในแอป
 * https://guide.ncloud-docs.com/docs/en/maps-url-scheme
 */
export function naverRouteUrl(from: Place | null, to: Place, appname = 'seoul-trip-planner'): string | null {
  if (to.lat == null || to.lng == null) return null;
  const p = new URLSearchParams();
  if (from && from.lat != null && from.lng != null) {
    p.set('slat', String(from.lat));
    p.set('slng', String(from.lng));
    p.set('sname', naverName(from));
  }
  p.set('dlat', String(to.lat));
  p.set('dlng', String(to.lng));
  p.set('dname', naverName(to));
  p.set('appname', appname);
  return `nmap://route/public?${p}`;
}

/** Naver Map (แอป) — เปิดหมุดสถานที่ */
export function naverPlaceUrl(p: Place, appname = 'seoul-trip-planner'): string | null {
  if (p.lat == null || p.lng == null) return null;
  return `nmap://place?${new URLSearchParams({ lat: String(p.lat), lng: String(p.lng), name: naverName(p), appname })}`;
}

/** ชื่อที่ส่งให้ Naver: เกาหลีก่อน (ค้นตรงกว่า) */
function naverName(p: Place): string {
  return (p.nameKo ?? p.nameEn).replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 60);
}

/** ปุ่มเปิด Naver Map (จัดการกรณีไม่มีแอป/เปิดจากในแอป LINE ใน main.ts: data-act="naver") */
export function naverBtn(url: string | null, label = naverLabel(), cls = 'btn sm'): string {
  return url ? `<button class="${cls} app-btn naver" data-act="naver" data-href="${esc(url)}">${label}</button>` : '';
}

/** KakaoMap (ใช้งานได้ดีในเกาหลีสำหรับเดิน/รถ) — ต้องมีพิกัด */
export function kakaoToUrl(to: Place): string | null {
  if (to.lat == null || to.lng == null) return null;
  return `https://map.kakao.com/link/to/${encodeURIComponent(to.nameEn)},${to.lat},${to.lng}`;
}

export function placeName(p: Place | undefined | null): string {
  if (!p) return 'ไม่ทราบสถานที่';
  return p.nameTh;
}

export function fmtKrw(n: number | null | undefined): string {
  return n == null ? '?' : `₩${n.toLocaleString('en-US')}`;
}
