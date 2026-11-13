import type { Stop } from '../core/types';
import { dinnerSlot, newStop } from '../core/planOps';

/**
 * แม่แบบ 3 แนว — จัดกลุ่มสถานที่ตามย่านเพื่อลดการย้อนเส้นทาง
 * ไม่กำหนดวันที่ เวลา หรือสมมติฐานเวลาว่าง ผู้ใช้กำหนดเองในแต่ละวัน
 */
export interface TemplateStop {
  placeId: string | null;
  stayMin: number;
  dinner?: boolean;
  breakTitle?: string;
}
export interface TemplateDay {
  title: string;
  note: string;
  stops: TemplateStop[];
}
export interface Template {
  id: string;
  name: string;
  desc: string;
  days: TemplateDay[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'A',
    name: 'ช็อปให้คุ้ม',
    desc: 'จุดเยอะ แวะสั้น เน้นเสื้อผ้าราคาคุ้ม เครื่องสำอาง และของกินระหว่างช็อป — แต่ละกลุ่มอยู่ย่านเดียวกันหรือเดินถึงกัน',
    days: [
      {
        title: 'โรงแรม · นัมแดมุน · เมียงดง',
        note: 'เดินจากโรงแรมได้ทั้งกลุ่ม · Olive Young และ Daiso อยู่ถนนเดียวกัน',
        stops: [
          { placeId: 'namdaemun', stayMin: 45 },
          { placeId: 'oliveyoung-myeongdong-global', stayMin: 40 },
          { placeId: 'daiso-myeongdong-main', stayMin: 30 },
          { placeId: 'myeongdong', stayMin: 60 },
          { placeId: 'myeongdong-kyoja', stayMin: 40, dinner: true },
        ],
      },
      {
        title: 'ตลาดมังวอน · ฮงแด',
        note: 'มังวอน → ฮงแด อยู่ฝั่งตะวันตกเดียวกัน จบด้วยปิ้งย่างในย่าน',
        stops: [
          { placeId: 'mangwon', stayMin: 45 },
          { placeId: 'musinsa-standard-hongdae', stayMin: 45 },
          { placeId: 'oliveyoung-hongdae-town', stayMin: 30 },
          { placeId: 'hongdae', stayMin: 60 },
          { placeId: 'yennaljip-hongdae', stayMin: 75, dinner: true },
        ],
      },
      {
        title: 'COEX · Starfield',
        note: 'ทุกจุดอยู่ในอาคาร COEX/Starfield (ตำแหน่งร้านในห้างเป็นจุดรวม)',
        stops: [
          { placeId: 'starfield-coex-mall', stayMin: 90 },
          { placeId: 'oliveyoung-coex', stayMin: 30 },
          { placeId: 'library', stayMin: 20 },
          { placeId: 'hadongkwan-coex', stayMin: 35, dinner: true },
        ],
      },
      {
        title: 'GOTO Mall · ตลาดกวางจัง',
        note: 'GOTO Mall (สาย 3) → ตลาดกวางจังเป็นมื้อเย็นแบบอาหารตลาด — ตรวจเส้นทางจริงในแอป',
        stops: [
          { placeId: 'gotomall', stayMin: 90 },
          { placeId: 'gwangjang', stayMin: 60, dinner: true },
        ],
      },
    ],
  },
  {
    id: 'B',
    name: 'กินท้องถิ่น + วัฒนธรรม',
    desc: 'จุดปานกลาง เน้นวัง พิพิธภัณฑ์ ตลาด และร้านเก่าแก่ — แวะนานขึ้นที่จุดวัฒนธรรม',
    days: [
      {
        title: 'ศาลากลาง · ประวัติศาสตร์โซล · นัมแดมุน',
        note: 'เริ่มใกล้โรงแรม วนกลับมาที่นัมแดมุน ปิดท้ายนึงมยอนที่ชุงมูโร',
        stops: [
          { placeId: 'deoksugung', stayMin: 60 },
          { placeId: 'seoul-museum-of-history', stayMin: 75 },
          { placeId: 'namdaemun', stayMin: 60 },
          { placeId: 'pildong-myeonok', stayMin: 45, dinner: true },
        ],
      },
      {
        title: 'คย็องบกกุง · ตลาดกวางจัง',
        note: 'วังทางเหนือ แล้วไปทางตะวันออกสู่ตลาดและทักฮันมารีที่ทงแดมุน',
        stops: [
          { placeId: 'gyeongbokgung', stayMin: 120 },
          { placeId: 'gwangjang', stayMin: 75 },
          { placeId: 'jinokhwa-dakhanmari', stayMin: 60, dinner: true },
        ],
      },
      {
        title: 'พิพิธภัณฑ์แห่งชาติ · มังวอน · ปิ้งย่างฮงแด',
        note: 'ยงซาน → ฝั่งตะวันตก (มังวอน/ฮงแด) จบที่ร้านปิ้งย่าง',
        stops: [
          { placeId: 'museum', stayMin: 150 },
          { placeId: 'mangwon', stayMin: 60 },
          { placeId: 'yennaljip-hongdae', stayMin: 75, dinner: true },
        ],
      },
      {
        title: 'บงอึนซา · Starfield Library',
        note: 'วัดบงอึนซาอยู่ตรงข้าม COEX · ซอกคัลบีในห้าง',
        stops: [
          { placeId: 'bongeunsa', stayMin: 45 },
          { placeId: 'library', stayMin: 30 },
          { placeId: 'gwanghwamun-seokgalbi-coex', stayMin: 60, dinner: true },
        ],
      },
    ],
  },
  {
    id: 'C',
    name: 'เที่ยวสบาย มีเวลาพัก',
    desc: 'วันละ 2–3 จุด แวะนาน มีช่วงพักชัดเจน เดินน้อย — เหมาะวันที่เหนื่อยจากบูธ',
    days: [
      {
        title: 'เมียงดงช้า ๆ',
        note: 'เดินจากโรงแรม มีช่วงพัก',
        stops: [
          { placeId: 'myeongdong', stayMin: 90 },
          { placeId: null, stayMin: 45, breakTitle: 'พักที่คาเฟ่/โรงแรม' },
          { placeId: 'myeongdong-kyoja', stayMin: 45, dinner: true },
        ],
      },
      {
        title: 'พิพิธภัณฑ์แห่งชาติ (ในร่ม)',
        note: 'เหมาะวันอากาศไม่ดี มีช่วงพักในพิพิธภัณฑ์',
        stops: [
          { placeId: 'museum', stayMin: 180 },
          { placeId: null, stayMin: 30, breakTitle: 'พัก' },
          { placeId: 'woo-lae-oak', stayMin: 60, dinner: true },
        ],
      },
      {
        title: 'COEX สบาย ๆ',
        note: 'อยู่ในอาคารทั้งหมด',
        stops: [
          { placeId: 'library', stayMin: 45 },
          { placeId: 'starfield-coex-mall', stayMin: 90 },
          { placeId: null, stayMin: 30, breakTitle: 'พักในห้าง' },
          { placeId: 'misari-chogyeguksu-coex', stayMin: 40, dinner: true },
        ],
      },
      {
        title: 'นัมซาน · นัมแดมุน',
        note: 'จุดชมวิว แล้วกลับมาตลาดใกล้โรงแรม',
        stops: [
          { placeId: 'n-seoul-tower', stayMin: 90 },
          { placeId: null, stayMin: 30, breakTitle: 'พัก' },
          { placeId: 'namdaemun', stayMin: 60 },
        ],
      },
    ],
  },
];

/** แปลงกลุ่มในแม่แบบเป็นรายการจุดแวะ (เพิ่มช่องมื้อเย็นว่างถ้าไม่มี) */
export function templateDayStops(td: TemplateDay, _stayFor: (id: string) => number): Stop[] {
  const stops: Stop[] = td.stops.map((s) => {
    if (!s.placeId) return newStop('break', null, s.stayMin, { title: s.breakTitle ?? 'พัก' });
    return newStop(s.dinner ? 'dinner' : 'place', s.placeId, s.stayMin, s.dinner ? { title: 'มื้อเย็น' } : {});
  });
  if (!stops.some((s) => s.kind === 'dinner')) stops.push(dinnerSlot());
  return stops;
}
