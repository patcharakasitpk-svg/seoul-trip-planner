import type { Place } from './types';

const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/** วันในสัปดาห์ของวันที่ (ปฏิทินโซล) 0=อาทิตย์ */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function weekdayTh(n: number): string {
  return TH_DAY[n];
}

/** สถานที่ปิดประจำในวันที่นี้หรือไม่ (เฉพาะวันหยุดประจำสัปดาห์ที่มีข้อมูล) */
export function closedOn(p: Place | undefined, date: string | null): string | null {
  if (!p || !date) return null;
  const wd = p.hours?.closedWeekdays;
  if (!wd?.length) return null;
  const d = weekdayOf(date);
  return wd.includes(d) ? `ปิดทุกวัน${TH_DAY[d]}` : null;
}

/** ข้อความเวลาเปิดปิดแบบสั้นสำหรับแถวรายการ */
export function shortHours(p: Place): string {
  if (p.openTime && p.closeTime) return `${p.openTime}–${p.closeTime}`;
  return '';
}
