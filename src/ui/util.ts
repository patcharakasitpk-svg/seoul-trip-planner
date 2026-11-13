import type { Place, TravelMode } from '../core/types';

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

/** origin = null → ใช้ตำแหน่งปัจจุบันของผู้ใช้ */
export function gmapsDirUrl(from: Place | null, to: Place, mode: TravelMode): string {
  const p = new URLSearchParams({ api: '1', destination: placeQuery(to), travelmode: GM_MODE[mode] });
  if (from) p.set('origin', placeQuery(from));
  return `https://www.google.com/maps/dir/?${p}`;
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
