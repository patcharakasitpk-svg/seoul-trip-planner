import type { Stop } from './types';
import { newPlan } from './planOps';
import { TEMPLATES, templateDayStops } from '../data/templates';

/** ค่าที่ระบบตั้งไว้ของวัน (ตามทริป: เที่ยวบิน คืนที่นอนซูวอน) — ใช้กับปุ่ม "คืนค่าเริ่มต้น" */
export function systemDayDefaults(date: string | null): { startPlaceId: string; startTime: string; endPlaceId: string; endTime: string } {
  const d = date ? newPlan().days.find((x) => x.date === date) : undefined;
  return {
    startPlaceId: d?.startPlaceId ?? 'hotel',
    startTime: d?.startTime ?? '09:00',
    endPlaceId: d?.endPlaceId ?? 'hotel',
    endTime: d?.endTime ?? '21:00',
  };
}

/** แผนแนะนำของวัน (จากแม่แบบแบบลงวันที่) — ไม่มี = [] */
export function recommendedStops(date: string | null): Stop[] {
  const tpl = TEMPLATES.find((t) => t.dated);
  const td = tpl?.days.find((x) => x.date === date);
  return td ? templateDayStops(td, () => 60) : [];
}
