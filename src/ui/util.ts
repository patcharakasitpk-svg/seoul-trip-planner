import type { Place, TravelMode } from '../core/types';
import { fmtDateTh } from '../core/time';
import naverIcon from '../assets/naver-map.png';
import gmapsIcon from '../assets/google-maps.png';

/** โลโก้แอปแผนที่ (ไฟล์ในเว็บเอง ไม่โหลดจากภายนอก) */
const logo = (src: string) => `<img class="app-logo" src="${src}" alt="" width="18" height="18">`;
export const naverLabel = (text = 'Naver Map') => `${logo(naverIcon)}<span>${text}</span>`;
export const googleLabel = (text = 'Google Maps') => `${logo(gmapsIcon)}<span>${text}</span>`;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** สีประจำวัน (หมุด/เส้น/การ์ด) — วันแรกเขียว วันที่สองเหลือง … */
export const DAY_COLORS = ['#16a34a', '#ca8a04', '#2563eb', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#475569'];

/** วันที่ตามปฏิทินแบบสั้น "จ. 30 พ.ย." — ใช้เป็นชื่อวันหลักทุกหน้า (คุยกับเพื่อนด้วยวันจริง) */
export const dayDate = (d: { date: string | null }, i?: number) => (d.date ? fmtDateTh(d.date).replace(/ \d{4}$/, '') : i != null ? `วัน ${i + 1}` : 'ยังไม่ตั้งวันที่');
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

/** ไอคอนเส้นเรียบ (SVG) สำหรับเมนู — แทนอีโมจิ */
const svg = (d: string) => `<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  today: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  map: svg('<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2Z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  plan: svg('<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.25" cy="6.5" r=".9"/><circle cx="4.25" cy="12" r=".9"/><circle cx="4.25" cy="17.5" r=".9"/>'),
  planner: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  places: svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  packing: svg('<rect x="4.5" y="7" width="15" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M8.5 13.5l2.2 2.2 4.8-4.7"/>'),
  fx: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
};
