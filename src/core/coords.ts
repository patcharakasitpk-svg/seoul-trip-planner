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
