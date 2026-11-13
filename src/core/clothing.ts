import type { ColdLevel } from './types';
import type { WindowSummary } from './weather';

export interface ClothingItem {
  key: string;
  label: string;
  why: string;
}

export interface ClothingAdvice {
  items: ClothingItem[];
  basis: string; // อธิบายว่าใช้ข้อมูลอะไร
  badWeather: string | null; // เหตุผลที่ควรพิจารณาทางเลือกในร่ม
}

const COLD_SHIFT: Record<ColdLevel, number> = { low: 3, normal: 0, high: -3 };
const COLD_LABEL: Record<ColdLevel, string> = { low: 'ไม่ค่อยขี้หนาว', normal: 'ปกติ', high: 'ขี้หนาวมาก' };

/**
 * กฎที่อธิบายได้ (ไม่ใช่ AI):
 * ใช้ "อุณหภูมิรู้สึกจริงต่ำสุดในช่วงเวลาที่ออกเที่ยว" ปรับตามระดับขี้หนาว (±3°C)
 */
export function clothingAdvice(w: WindowSummary, opts: { coldLevel: ColdLevel; walkMin: number | null; outdoorMin: number | null; windowLabel: string }): ClothingAdvice {
  const items: ClothingItem[] = [];
  const feels = w.feelsMin;
  const adj = feels == null ? null : feels + COLD_SHIFT[opts.coldLevel];
  const f = (v: number | null, unit = '°C') => (v == null ? 'ไม่มีข้อมูล' : `${Math.round(v)}${unit}`);
  const longOutside = (opts.outdoorMin ?? 0) + (opts.walkMin ?? 0) >= 90;

  if (adj != null) {
    if (adj <= 5) items.push({ key: 'base', label: 'เสื้อชั้นในให้ความอบอุ่น (Heattech/thermal)', why: `รู้สึกจริงต่ำสุด ${f(feels)} ช่วง ${opts.windowLabel}` });
    if (adj <= 14) items.push({ key: 'mid', label: 'เสื้อกลาง เช่น ไหมพรม/ฟลีซ', why: `รู้สึกจริงต่ำสุด ${f(feels)}` });
    if (adj <= 5) items.push({ key: 'coat', label: 'เสื้อโค้ทหนา/ดาวน์', why: `รู้สึกจริง ≤ 5°C (ปรับตามระดับขี้หนาว)` });
    else if (adj <= 14) items.push({ key: 'jacket', label: 'แจ็กเก็ตบาง', why: `รู้สึกจริง 6–14°C (ปรับตามระดับขี้หนาว)` });
    if (adj <= 3) items.push({ key: 'scarf', label: 'ผ้าพันคอ/หมวกไหมพรม', why: `รู้สึกจริง ≤ 3°C${longOutside ? ' และอยู่ข้างนอก/เดินนาน' : ''}` });
    if (adj <= 0) items.push({ key: 'gloves', label: 'ถุงมือ', why: `รู้สึกจริง ≤ 0°C` });
    if (adj >= 25) items.push({ key: 'light', label: 'เสื้อผ้าบางระบายอากาศ + น้ำดื่ม', why: `รู้สึกจริงต่ำสุด ${f(feels)}` });
  }
  if (w.feelsMax != null && w.feelsMin != null && w.feelsMax - w.feelsMin >= 8) {
    items.push({ key: 'layers', label: 'แต่งตัวเป็นชั้นถอดง่าย', why: `ช่วงเที่ยวอุณหภูมิรู้สึกจริงต่างกัน ${Math.round(w.feelsMax - w.feelsMin)}°C` });
  }
  const windy = (w.windMax ?? 0) >= 25 || (w.gustMax ?? 0) >= 40;
  const wet = (w.ppMax ?? 0) >= 40 || (w.precipSum ?? 0) >= 0.5;
  if (windy || wet) {
    items.push({ key: 'shell', label: 'เสื้อคลุมกันลม/กันฝน', why: [windy ? `ลมสูงสุด ${f(w.windMax, ' กม./ชม.')} กระโชก ${f(w.gustMax, ' กม./ชม.')}` : '', wet ? `โอกาสฝนสูงสุด ${f(w.ppMax, '%')}` : ''].filter(Boolean).join(' · ') });
  }
  if (wet) items.push({ key: 'umbrella', label: 'ร่มพับ', why: `โอกาสฝนสูงสุด ${f(w.ppMax, '%')}, ปริมาณรวม ${f(w.precipSum, ' มม.')}` });
  const snowForecast = (w.snowSum ?? 0) > 0;
  if ((w.precipSum ?? 0) >= 2 || snowForecast) {
    items.push({ key: 'wshoes', label: 'รองเท้ากันน้ำ/พื้นกันลื่น', why: snowForecast ? `พยากรณ์ระบุหิมะรวม ${w.snowSum} ซม. (ไม่ได้ยืนยันสภาพพื้นถนน)` : `ปริมาณฝนรวม ${f(w.precipSum, ' มม.')}` });
  } else if ((opts.walkMin ?? 0) >= 30 || opts.walkMin == null) {
    items.push({ key: 'shoes', label: 'รองเท้าที่เดินสบาย', why: opts.walkMin == null ? 'ยังไม่ทราบเวลาเดินรวม — เผื่อไว้' : `เวลาเดินตามแผนประมาณ ${opts.walkMin} นาที` });
  }

  let bad: string | null = null;
  if ((w.ppMax ?? 0) >= 60 || (w.precipSum ?? 0) >= 3) bad = `โอกาสฝน ${f(w.ppMax, '%')} / ฝนรวม ${f(w.precipSum, ' มม.')}`;
  else if (adj != null && adj <= -5) bad = `รู้สึกจริงต่ำสุด ${f(feels)}`;
  else if ((w.gustMax ?? 0) >= 50) bad = `ลมกระโชก ${f(w.gustMax, ' กม./ชม.')}`;
  else if (snowForecast) bad = `พยากรณ์ระบุหิมะ ${w.snowSum} ซม.`;

  const basis = `อิงอุณหภูมิรู้สึกจริงช่วง ${opts.windowLabel} (${f(w.feelsMin)} ถึง ${f(w.feelsMax)}), ระดับขี้หนาว: ${COLD_LABEL[opts.coldLevel]}${opts.walkMin != null ? `, เดินตามแผน ~${opts.walkMin} นาที` : ''}${opts.outdoorMin ? `, จุดกลางแจ้ง ~${opts.outdoorMin} นาที` : ''}`;
  return { items, basis, badWeather: bad };
}
