export interface LatLng {
  lat: number;
  lng: number;
}

/** ระยะเส้นตรง (เมตร) — ไม่ใช่ระยะเดินหรือเส้นทางจริง */
export function straightLineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtDist(m: number | null | undefined): string {
  if (m == null) return 'ไม่ทราบ';
  return m < 1000 ? `${Math.round(m)} ม.` : `${(m / 1000).toFixed(1)} กม.`;
}

/**
 * ค่าประมาณหยาบจากระยะเส้นตรง — ใช้เมื่อผู้ใช้กดเลือกเองเท่านั้น และติดป้าย "ประมาณการ"
 * เดิน: 4.5 กม./ชม. × ตัวคูณเส้นทาง 1.3
 * ขนส่งสาธารณะ: 15 นาที (เดิน+รอ) + 25 กม./ชม. × 1.4
 * รถยนต์: 5 นาที + 20 กม./ชม. × 1.4 (ไม่รวมรอเรียกรถ)
 */
export function roughEstimateMin(distM: number, mode: 'WALKING' | 'TRANSIT' | 'DRIVING'): number {
  const km = distM / 1000;
  if (mode === 'WALKING') return Math.max(1, Math.round(((km * 1.3) / 4.5) * 60));
  if (mode === 'TRANSIT') {
    // ระยะเส้นทาง ≈ 1.3× เส้นตรง · 10 กม.แรกช้าแบบในเมือง (~24 กม./ชม.) ส่วนที่เกินเร็วแบบรถไฟระยะไกล/AREX (~55 กม./ชม.) + เดิน/รอ ~12 นาที
    const r = km * 1.3;
    return Math.round(12 + (Math.min(r, 10) / 24 + Math.max(0, r - 10) / 55) * 60);
  }
  return Math.round(5 + ((km * 1.4) / 20) * 60);
}

/** เวลาประมาณสำหรับหน้า "วันนี้": ระยะใกล้ (เดินไม่เกิน ~20 นาที ≈ 1.2 กม.) เดินเร็วกว่ารอรถ → ใช้เวลาเดิน */
export function liveEstimateMin(distM: number, mode: 'WALKING' | 'TRANSIT' | 'DRIVING'): number {
  const walk = roughEstimateMin(distM, 'WALKING');
  if (mode === 'TRANSIT' && walk <= 20) return walk;
  return roughEstimateMin(distM, mode);
}

/** วิธีเดินทางที่ใช้คิดเวลาจริง: เวลาประมาณ (auto/estimate) ระยะใกล้ของรถสาธารณะ = เดิน (ตาม liveEstimateMin) */
export function effectiveMode(mode: 'WALKING' | 'TRANSIT' | 'DRIVING', source: string, distM: number | null): 'WALKING' | 'TRANSIT' | 'DRIVING' {
  if (mode !== 'TRANSIT' || distM == null || (source !== 'auto' && source !== 'estimate')) return mode;
  return roughEstimateMin(distM, 'WALKING') <= 20 ? 'WALKING' : 'TRANSIT';
}
