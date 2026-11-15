/** พิกัดในเกาหลีใต้ (กันวางพิกัดผิดประเทศ/สลับ lat-lng) */
export const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

/**
 * อ่านพิกัดที่ผู้ใช้วาง: "37.5438, 127.0557" (คลิกขวาบน Google Maps) หรือลิงก์ Google Maps แบบยาว
 * (มี !3d…!4d… ซึ่งเป็นตำแหน่งร้าน, @lat,lng หรือ q=lat,lng) — ลิงก์ย่อ maps.app.goo.gl อ่านไม่ได้ (ต้องเปิดก่อน)
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const num = '(-?\\d{1,3}\\.\\d+)';
  const tries = [new RegExp(`!3d${num}!4d${num}`), new RegExp(`@${num},${num}`), new RegExp(`[?&](?:q|ll|query)=${num},\\s*${num}`), new RegExp(`^${num}\\s*,\\s*${num}$`)];
  for (const re of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && inKorea(lat, lng)) return { lat, lng };
  }
  return null;
}

/** เหตุผลที่อ่านพิกัดไม่ได้ (ข้อความแสดงใต้ช่อง) */
export function coordError(text: string): string {
  const t = text.trim();
  if (/goo\.gl|maps\.app/i.test(t)) return 'ลิงก์ย่อ (maps.app.goo.gl) ไม่มีพิกัดอยู่ในลิงก์ — กด “เลือกตำแหน่งบนแผนที่” แล้วแตะตรงร้าน หรือเปิดลิงก์นั้นแล้วคัดลอกลิงก์ยาวจากแถบที่อยู่';
  const m = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(t);
  if (m && !inKorea(Number(m[1]), Number(m[2]))) return 'พิกัดนี้ไม่อยู่ในเกาหลี — ตรวจลำดับตัวเลข (ละติจูด 37.xx ก่อน ลองจิจูด 126–127.xx)';
  return 'อ่านพิกัดไม่ได้ — วางตัวเลขเช่น 37.5438, 127.0557 หรือกด “เลือกตำแหน่งบนแผนที่”';
}
