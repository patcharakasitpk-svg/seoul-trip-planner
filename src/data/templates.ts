import type { Stop } from '../core/types';
import type { Place, Plan } from '../core/types';
import { straightLineM } from '../core/geo';
import { applyTripDates, dinnerSlot, newStop } from '../core/planOps';

/**
 * แม่แบบ 3 แนว — จัดกลุ่มสถานที่ตามย่านเพื่อลดการย้อนเส้นทาง
 * ไม่กำหนดวันที่ เวลา หรือสมมติฐานเวลาว่าง ผู้ใช้กำหนดเองในแต่ละวัน
 */
export interface TemplateStop {
  placeId: string | null;
  stayMin: number;
  dinner?: boolean;
  breakTitle?: string;
  /** นัดหมายที่ล็อกเวลา เช่น ออกบูธ COEX */
  lockedTime?: string;
  /** วิธีเดินทาง/ข้อควรรู้ (แสดงในหมายเหตุของจุดแวะ) */
  note?: string;
}
export interface TemplateDay {
  title: string;
  note: string;
  stops: TemplateStop[];
  /** แม่แบบแบบลงวันที่: ใช้กับวันในแผนที่วันที่ตรงกัน */
  date?: string;
  startPlaceId?: string;
  startTime?: string;
  endPlaceId?: string;
  endTime?: string;
  /** ไม่เพิ่มช่องมื้อเย็นว่าง (เช่นวันบินกลับ) */
  noDinner?: boolean;
}
export interface Template {
  id: string;
  name: string;
  desc: string;
  days: TemplateDay[];
  /** true = ทุกวันมีวันที่ ใช้ทั้งแม่แบบแล้วตั้งจุดเริ่ม/จบ/เวลาให้ด้วย */
  dated?: boolean;
  /** true = เมนูแผนรายวัน เลือกทีละการ์ดไปใส่วันที่ต้องการ (ไม่มีปุ่มใช้ทั้งแม่แบบ) */
  pick?: boolean;
}

export const TEMPLATES: Template[] = [
  {
    id: 'D',
    name: 'เลือกแผนรายวัน (ผสมเอง)',
    pick: true,
    desc: 'เมนูแผนรายวันแยกตามย่าน — ถูกใจการ์ดไหนเลือก "ใช้เป็นวัน…" แล้วเติม/ตัดเองจาก "ที่ใกล้เคียง" · แทนที่วันไหน นัดที่ล็อกเวลาไว้ (COEX/สนามบิน) ยังอยู่ · ทุกอย่างกดเลิกทำได้',
    days: [
      {
        title: 'วันมาถึง · เมียงดงเบา ๆ',
        note: 'เหมาะวันลงเครื่องเช้า · เดินจากโรงแรมได้ทั้งหมด มีช่วงพัก',
        stops: [
          { placeId: 'hotel', stayMin: 30, note: 'AREX จากสนามบินไปสถานีโซล แล้วแท็กซี่/เดิน · ฝากกระเป๋า' },
          { placeId: 'myeongdong-kyoja', stayMin: 45, note: 'คัลกุกซุ · เดินจากโรงแรม' },
          { placeId: 'myeongdong-cathedral', stayMin: 40 },
          { placeId: 'shinsegae-main-store', stayMin: 60, note: 'ฮเวฮยอน ทางออก 7' },
          { placeId: null, stayMin: 90, breakTitle: 'เช็กอิน · พักที่โรงแรม' },
          { placeId: 'myeongdong', stayMin: 90, note: 'สตรีทฟู้ดเปิด ~16:00' },
          { placeId: 'hanam-pig-myeongdong', stayMin: 75, dinner: true },
        ],
      },
      {
        title: 'เมียงดง · นัมแดมุน · นัมซาน',
        note: 'ช็อปเครื่องสำอาง/ของฝากใกล้โรงแรม แล้วขึ้นหอคอยตอนเย็น · นัมแดมุนปิดวันอาทิตย์',
        stops: [
          { placeId: 'namdaemun', stayMin: 60, note: 'เดินจากโรงแรม ~5 นาที' },
          { placeId: 'oliveyoung-myeongdong-global', stayMin: 40 },
          { placeId: 'daiso-myeongdong-main', stayMin: 30 },
          { placeId: 'n-seoul-tower', stayMin: 90, note: 'เดินไปสถานีกระเช้านัมซาน ~10 นาทีจากเมียงดง' },
          { placeId: 'odarijip-myeongdong', stayMin: 60, dinner: true, note: 'ปูดองซีอิ๊ว · เมียงดง ทางออก 6' },
        ],
      },
      {
        title: 'จงโน · ตลาดกวางจัง · ลักซาน',
        note: 'วังเก่า ตลาด ขนมปังเกลือ แล้วชมกำแพงเมืองยามเย็น · คย็องบกกุงปิดวันอังคาร',
        stops: [
          { placeId: 'gyeongbokgung', stayMin: 120, note: 'สาย 3 คย็องบกกุง ทางออก 5' },
          { placeId: 'gwangjang', stayMin: 75, note: 'จงโน 5-กา ทางออก 8 · บินแดต็อก ยุกฮเว' },
          { placeId: 'soha-salt-pond-ikseon', stayMin: 30, note: 'จงโน 3-กา ทางออก 4 · รสยอดนิยมหมดเร็ว' },
          { placeId: 'naksan-park', stayMin: 60, note: 'สาย 4 ฮเยฮวา ทางออก 2 เดินขึ้นเนิน ~15 นาที · ไปช่วงพระอาทิตย์ตก' },
          { placeId: 'jinokhwa-dakhanmari', stayMin: 60, dinner: true, note: 'ไก่ต้มทั้งตัว ย่านทงแดมุน' },
        ],
      },
      {
        title: 'มังวอน · ยอนนัม · ฮงแด (เต็มวัน)',
        note: 'ตลาด ริมแม่น้ำ ช็อป แล้วปิ้งย่างฮงแด · กลับสาย 2 ตรงถึงอึลจีโร 1-กา',
        stops: [
          { placeId: 'mangwon', stayMin: 60, note: 'สาย 2 → ฮับจอง ต่อสาย 6 → มังวอน ทางออก 2' },
          { placeId: 'mangwon-hangang-park', stayMin: 40, note: 'เดิน ~20 นาที · ลมริมแม่น้ำหนาว' },
          { placeId: 'mibbedong-yeonnam', stayMin: 60, note: 'ดงบุริ · คิวยาว' },
          { placeId: 'musinsa-standard-hongdae', stayMin: 45 },
          { placeId: 'hongdae', stayMin: 90 },
          { placeId: 'yeonnam-mulgalbi-hongdae', stayMin: 75, dinner: true, note: 'มุลกาลบี (2 ที่ขึ้นไป)' },
        ],
      },
      {
        title: 'ฮงแด ช็อปตอนเย็น (หลังเลิกงาน)',
        note: 'ร้านเปิดดึก เหมาะวันที่ว่างหลัง 17:00 · สาย 2 ตรงจากซัมซอง/อึลจีโร',
        stops: [
          { placeId: 'musinsa-standard-hongdae', stayMin: 45, note: 'ฮงอิกแด ทางออก 9 · เปิดถึง 23:00' },
          { placeId: 'oliveyoung-hongdae-town', stayMin: 30 },
          { placeId: 'hongdae', stayMin: 60 },
          { placeId: 'jangin-dakgalbi-hongdae', stayMin: 60, dinner: true, note: 'ทัคกาลบี · เปิดถึงเที่ยงคืน · ทางเลือก: โชซอนฮวาโรกุย (ปิดวันอาทิตย์)' },
        ],
      },
      {
        title: 'ซองซู · อัปกูจอง',
        note: 'โดนัท ร้านเครื่องเขียน/ของดีไซน์ แล้วต่อห้างหรู · Point of View เปิด 12:00',
        stops: [
          { placeId: 'im-donut-seongsu', stayMin: 30, note: 'สาย 2 ซองซู ทางออก 4 · ซื้อกลับ ไม่มีที่นั่ง' },
          { placeId: null, stayMin: 45, breakTitle: 'เดินเล่นถนนยอนมูจัง / คาเฟ่' },
          { placeId: 'point-of-view-seongsu', stayMin: 45 },
          { placeId: 'hyundai-department-store-apgujeong', stayMin: 90, note: 'แท็กซี่ ~15 นาที หรือสาย 3 อัปกูจอง ทางออก 6 · ศูนย์อาหารชั้นใต้ดิน' },
        ],
      },
      {
        title: 'ยงซาน · ฮันนัม · แฮบังชน',
        note: 'พิพิธภัณฑ์ในร่ม (เหมาะวันอากาศไม่ดี) แล้วย่านแฟชั่น/คาเฟ่บนเนิน',
        stops: [
          { placeId: 'museum', stayMin: 120, note: 'สาย 4 อีชน ทางออก 2' },
          { placeId: 'hannam-dong', stayMin: 90, note: 'แท็กซี่ ~10 นาที · ฮันกังจิน ทางออก 3' },
          { placeId: 'haebangchon', stayMin: 75, note: 'แท็กซี่ ~10 นาที (ทางชัน)' },
        ],
      },
      {
        title: 'COEX หลังเลิกบูธ',
        note: 'ใช้ "เพิ่มต่อท้าย" กับวันออกบูธ — ทุกจุดอยู่ในอาคารเดียวกัน',
        stops: [
          { placeId: 'library', stayMin: 30 },
          { placeId: 'starfield-coex-mall', stayMin: 90 },
          { placeId: 'oliveyoung-coex', stayMin: 30 },
          { placeId: 'gwanghwamun-seokgalbi-coex', stayMin: 60, dinner: true },
        ],
      },
      {
        title: 'ยองดึงโพ · ยออีโด (มื้อเย็น + ไฟกลางคืน)',
        note: 'ใช้ "เพิ่มต่อท้าย" กับวันที่เลิกงานเย็น · สาย 2 ถึงทังซาน',
        stops: [
          { placeId: 'jeonwon-jipbul-ppyeogui', stayMin: 75, dinner: true, note: 'เช็กเวลาเปิดใน Naver ก่อน · คิวยาว' },
          { placeId: 'yeouido-hangang-park', stayMin: 45, note: 'แท็กซี่ ~10 นาที หรือยออีนารู (สาย 5) ทางออก 2/3' },
        ],
      },
      {
        title: 'เสื้อผ้าราคาถูก · โกโตมอลล์',
        note: 'ช็อปใต้ดินยาวในสถานีขนส่งด่วน · เดินในร่มทั้งหมด',
        stops: [
          { placeId: 'gotomall', stayMin: 120, note: 'สาย 3/7/9 สถานีขนส่งด่วน (Express Bus Terminal)' },
        ],
      },
      {
        title: 'วันกลับ · ซูวอน → สนามบิน',
        note: 'ถึงสนามบินก่อนเครื่องออก 3 ชม. · รถบัสลีมูซีนจากสถานีซูวอน หรือรถไฟไปสถานีโซลต่อ AREX',
        noDinner: true,
        stops: [{ placeId: null, stayMin: 60, breakTitle: 'บรันช์ / ช็อปใกล้สถานีซูวอน (AK Plaza)' }],
      },
    ],
  },
  {
    id: 'T',
    name: 'แผนแนะนำ 30 พ.ย.–6 ธ.ค.',
    dated: true,
    desc: 'จัดตามเที่ยวบิน TG656/TG653 และนัด COEX (1 ธ.ค. เตรียมบูธบ่าย · 3 ธ.ค. ออกบูธถึง 17:00 · 4 ธ.ค. งานประกาศรางวัลถึง 18:00) · พักเมียงดง 30 พ.ย.–4 ธ.ค. · คืน 5 ธ.ค. นอนซูวอน · จัดกลุ่มตามย่านให้เดินทางน้อย — ใช้แล้วแก้/ย้ายวัน/ลบได้ทุกจุด',
    days: [
      {
        date: '2026-11-30',
        title: 'ถึงโซล · เมียงดง · ลักซาน',
        note: 'ลงเครื่อง 06:55 อาคาร 1 → AREX เข้าเมือง (Express ถึงสถานีโซล ~45 นาที / รถธรรมดา ~1 ชม.) · ฝากกระเป๋าที่โรงแรมแล้วเที่ยวเมียงดงแบบเดินได้ · บ่ายพักงีบ',
        startPlaceId: 'icn',
        startTime: '08:00',
        endPlaceId: 'hotel',
        stops: [
          { placeId: 'hotel', stayMin: 30, note: 'AREX ไปสถานีโซล แล้วแท็กซี่/เดินไปโรงแรม · ฝากกระเป๋า (เช็กอินบ่าย)' },
          { placeId: 'myeongdong-kyoja', stayMin: 45, note: 'มื้อกลางวัน คัลกุกซุ · เดินจากโรงแรม · ตรวจใน Naver ว่าสาขาหลักเปิดอาคารไหน' },
          { placeId: 'myeongdong-cathedral', stayMin: 40, note: 'เดินจากร้าน ~5 นาที' },
          { placeId: 'shinsegae-main-store', stayMin: 60, note: 'สถานีฮเวฮยอน ทางออก 7 (เดินจากเมียงดงได้) · ห้างปิดเดือนละครั้งมักเป็นวันจันทร์ — เช็กก่อน' },
          { placeId: null, stayMin: 90, breakTitle: 'เช็กอิน · พักที่โรงแรม' },
          { placeId: 'naksan-park', stayMin: 60, note: 'สาย 4 เมียงดง → ฮเยฮวา ทางออก 2 แล้วเดินขึ้นเนิน ~15 นาที · ไปช่วงพระอาทิตย์ตก (~17:15) กำแพงเมืองเปิดไฟสวย · ลมแรง ใส่เสื้อหนา' },
          { placeId: 'hanam-pig-myeongdong', stayMin: 75, dinner: true, note: 'กลับสาย 4 ลงเมียงดง · หมูย่าง' },
        ],
      },
      {
        date: '2026-12-01',
        title: 'ตลาดกวางจัง · อิกซอนดง · COEX (เตรียมบูธ)',
        note: 'เช้ากินในตลาด แล้วเข้า COEX เตรียมบูธช่วงบ่าย',
        startPlaceId: 'hotel',
        startTime: '08:30',
        endPlaceId: 'hotel',
        stops: [
          { placeId: 'gwangjang', stayMin: 75, note: 'สาย 1 ซิตี้ฮอลล์ → จงโน 5-กา ทางออก 8 · บินแดต็อก ยุกฮเว กิมบับ' },
          { placeId: 'soha-salt-pond-ikseon', stayMin: 30, note: 'ขนมปังเกลือ · สถานีจงโน 3-กา ทางออก 4 (นั่ง 1 สถานี หรือเดิน ~15 นาที) · รสยอดนิยมหมดเร็ว ไปช่วงเช้า' },
          { placeId: 'coex', stayMin: 240, lockedTime: '13:00', note: 'เตรียมบูธ · จงโน 3-กา สาย 3 → อึลจีโร 3-กา ต่อสาย 2 → ซัมซอง ทางออก 5/6 (~45 นาที)' },
          { placeId: 'library', stayMin: 30, note: 'ห้องสมุดสตาร์ฟิลด์ อยู่ในห้างติด COEX' },
          { placeId: 'misari-chogyeguksu-coex', stayMin: 45, dinner: true, note: 'กินในห้าง COEX แล้วกลับสาย 2 ซัมซอง → อึลจีโร 1-กา' },
        ],
      },
      {
        date: '2026-12-02',
        title: 'มังวอน · ยอนนัม · ฮงแด',
        note: 'วันว่างเต็มวันฝั่งตะวันตก · ตลาด ริมแม่น้ำ ช็อป แล้วปิ้งย่างฮงแด',
        startPlaceId: 'hotel',
        startTime: '09:30',
        endPlaceId: 'hotel',
        stops: [
          { placeId: 'mangwon', stayMin: 60, note: 'สาย 2 → ฮับจอง ต่อสาย 6 → มังวอน ทางออก 2 · ของกินในตลาด' },
          { placeId: 'mangwon-hangang-park', stayMin: 40, note: 'เดิน ~20 นาที (มังวอน ทางออก 1) · ลมริมแม่น้ำหนาวมาก' },
          { placeId: 'mibbedong-yeonnam', stayMin: 60, note: 'ดงบุริ · แท็กซี่ ~10 นาที หรือสถานีฮงอิกแด ทางออก 3 · คิวยาว' },
          { placeId: 'musinsa-standard-hongdae', stayMin: 45, note: 'ฮงอิกแด ทางออก 9' },
          { placeId: 'hongdae', stayMin: 90, note: 'เดินเล่นย่านฮงแด · Olive Young ฮงแดอยู่ในย่าน' },
          { placeId: 'yeonnam-mulgalbi-hongdae', stayMin: 75, dinner: true, note: 'มุลกาลบี (สั่ง 2 ที่ขึ้นไป) · ทางเลือก: จังอินดักกาลบี หรือ โชซอนฮวาโรกุย (ปิดวันอาทิตย์) — แตะ "เปลี่ยนร้าน" · กลับสาย 2 ตรงถึงอึลจีโร 1-กา' },
        ],
      },
      {
        date: '2026-12-03',
        title: 'ออกบูธ COEX · ห้างฮุนได อัปกูจอง',
        note: 'ออกบูธถึง 17:00 แล้วช็อปห้างต่อ (ปิด 20:00) กลับกินปูดองที่เมียงดง',
        startPlaceId: 'hotel',
        startTime: '08:00',
        endPlaceId: 'hotel',
        stops: [
          { placeId: 'coex', stayMin: 480, lockedTime: '09:00', note: 'ออกบูธ 09:00–17:00 (แก้เวลาเริ่มได้) · สาย 2 อึลจีโร 1-กา → ซัมซอง' },
          { placeId: 'hyundai-department-store-apgujeong', stayMin: 90, note: 'แท็กซี่ ~15–20 นาที หรือรถไฟฟ้าถึงอัปกูจอง (สาย 3) ทางออก 6 เชื่อมห้าง · ห้างปิด 20:00 วันพฤหัสฯ · วันหยุดห้างเดือน ธ.ค. ยังไม่ประกาศ' },
          { placeId: 'odarijip-myeongdong', stayMin: 60, dinner: true, note: 'ปูดองซีอิ๊ว · สาย 3 อัปกูจอง → ชุงมูโร ต่อสาย 4 → เมียงดง ทางออก 6 · ร้านเปิดถึง 23:00' },
        ],
      },
      {
        date: '2026-12-04',
        title: 'งานประกาศรางวัล COEX · ยองดึงโพ · ยออีโด',
        note: 'งานถึง 18:00 แล้วไปกินกระดูกหมูย่างฟางข้าว และเดินชมไฟริมแม่น้ำฮัน',
        startPlaceId: 'hotel',
        startTime: '08:00',
        endPlaceId: 'hotel',
        stops: [
          { placeId: 'coex', stayMin: 540, lockedTime: '09:00', note: 'งานประกาศรางวัล 09:00–18:00 (แก้เวลาเริ่มได้)' },
          { placeId: 'jeonwon-jipbul-ppyeogui', stayMin: 75, dinner: true, note: 'สาย 2 ซัมซอง → ทังซาน (~40 นาที) · ยังไม่ยืนยันเวลาเปิด — เช็ก Naver Map ก่อน · ร้านคิวยาว' },
          { placeId: 'yeouido-hangang-park', stayMin: 45, note: 'แท็กซี่ ~10 นาที หรือสถานียออีนารู (สาย 5) ทางออก 2/3 · กลับสาย 5 → ชุงมูโร/แท็กซี่' },
        ],
      },
      {
        date: '2026-12-05',
        title: 'ซองซู · ฮันนัม · แฮบังชน → ซูวอน',
        note: 'เช็กเอาต์แล้วฝากกระเป๋าที่โรงแรม เที่ยวฝั่งตะวันออก เย็นกลับมารับกระเป๋าแล้วไปซูวอน',
        startPlaceId: 'hotel',
        startTime: '09:30',
        endPlaceId: 'novotel-suwon',
        stops: [
          { placeId: 'im-donut-seongsu', stayMin: 30, note: 'สาย 2 อึลจีโร 1-กา → ซองซู ทางออก 4 · ซื้อกลับบ้าน (ไม่มีที่นั่ง) ขายหมดก่อนปิด' },
          { placeId: null, stayMin: 45, breakTitle: 'เดินเล่นถนนยอนมูจัง / คาเฟ่ซองซู' },
          { placeId: 'point-of-view-seongsu', stayMin: 45, note: 'เปิด 12:00 · เดินจาก I\'m Donut ได้' },
          { placeId: 'hannam-dong', stayMin: 90, note: 'แท็กซี่ ~15 นาที · ร้านแฟชั่นตามถนนอิแทวอนโร · กินกลางวันในย่าน' },
          { placeId: 'haebangchon', stayMin: 75, note: 'แท็กซี่ ~10 นาที (ทางขึ้นชัน) · วิวเมือง/คาเฟ่' },
          { placeId: 'hotel', stayMin: 20, note: 'รับกระเป๋า → แท็กซี่ไปสถานีโซล → รถไฟไปซูวอน (ITX/มูกุงฮวา ~30–40 นาที หรือรถไฟฟ้าสาย 1 ~1 ชม.) · Novotel ติดสถานีซูวอน ทางออก 4' },
        ],
      },
      {
        date: '2026-12-06',
        title: 'ซูวอน → สนามบิน (TG653 17:00)',
        note: 'ถึงสนามบิน T1 ภายใน 14:00 · จากสถานีซูวอนมีรถบัสลีมูซีนไปสนามบิน (ตรวจตารางรถก่อน) หรือรถไฟไปสถานีโซลต่อ AREX',
        startPlaceId: 'novotel-suwon',
        startTime: '10:00',
        endPlaceId: 'icn',
        endTime: '14:00',
        noDinner: true,
        stops: [{ placeId: null, stayMin: 60, breakTitle: 'บรันช์ / ช็อปใกล้สถานีซูวอน (AK Plaza)' }],
      },
    ],
  },
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
    const extra = { lockedTime: s.lockedTime ?? null, note: s.note ?? '' };
    if (!s.placeId) return newStop('break', null, s.stayMin, { title: s.breakTitle ?? 'พัก', ...extra });
    return newStop(s.dinner ? 'dinner' : 'place', s.placeId, s.stayMin, s.dinner ? { title: 'มื้อเย็น', ...extra } : extra);
  });
  if (!td.noDinner && !stops.some((s) => s.kind === 'dinner')) stops.push(dinnerSlot());
  return stops;
}

/** ใช้แม่แบบแบบลงวันที่กับทั้งแผน: ตั้งวันเที่ยวให้ครบ แล้วแทนรายการ/จุดเริ่ม/จบ/เวลาของวันที่ตรงกัน */
export function applyDatedTemplate(plan: Plan, tpl: Template): void {
  applyTripDates(plan);
  for (const td of tpl.days) {
    const day = plan.days.find((d) => d.date === td.date);
    if (!day) continue;
    day.stops = templateDayStops(td, () => 60);
    if (td.startPlaceId) day.startPlaceId = td.startPlaceId;
    if (td.endPlaceId) day.endPlaceId = td.endPlaceId;
    if (td.startTime) day.startTime = td.startTime;
    if (td.endTime !== undefined) day.endTime = td.endTime || null;
  }
}

/**
 * รวมรายการจากแม่แบบเข้าวัน
 * - replace: แทนรายการเดิม แต่คงนัดที่ล็อกเวลาไว้ (เช่น COEX) โดยวางนัดตามเวลาที่ล็อก (ก่อน/หลังรายการใหม่)
 * - append: ต่อท้ายก่อนมื้อเย็น และไม่เพิ่มมื้อเย็นซ้ำถ้าวันนั้นมีแล้ว
 */
export function mergeDayStops(existing: Stop[], incoming: Stop[], mode: 'replace' | 'append'): Stop[] {
  if (mode === 'append') {
    const hasDinner = existing.some((x) => x.kind === 'dinner');
    const extra = incoming.filter((s) => s.kind !== 'dinner' || !hasDinner);
    const out = [...existing];
    const di = out.findIndex((x) => x.kind === 'dinner');
    out.splice(di >= 0 ? di : out.length, 0, ...extra);
    return out;
  }
  const locked = existing.filter((x) => x.lockedTime);
  const morning = locked.filter((x) => x.lockedTime! < '12:00');
  const later = locked.filter((x) => x.lockedTime! >= '12:00');
  const dinnerIdx = incoming.findIndex((s) => s.kind === 'dinner');
  const body = dinnerIdx >= 0 ? incoming.slice(0, dinnerIdx) : incoming;
  const tail = dinnerIdx >= 0 ? incoming.slice(dinnerIdx) : [];
  // นัดเช้า (เช่นออกบูธ 09:00) ไว้หน้าสุด · นัดบ่าย (เช่นเตรียมบูธ 13:00) ไว้หลังรายการช่วงเช้าครึ่งแรก
  const half = later.length ? Math.ceil(body.length / 2) : body.length;
  return [...morning, ...body.slice(0, half), ...later, ...body.slice(half), ...tail];
}

/** สถานที่ใกล้เคียงที่แนะนำเพิ่มสำหรับการ์ดแผนรายวัน (เดินถึง ~1.5 กม. จากจุดใดจุดหนึ่งในการ์ด) */
export function nearbyForTemplateDay(td: TemplateDay, places: Place[], max = 6, radiusM = 1500): { place: Place; distM: number }[] {
  const inCard = new Set(td.stops.map((s) => s.placeId).filter(Boolean) as string[]);
  const anchors = places.filter((p) => inCard.has(p.id) && p.lat != null && p.lng != null && p.category !== 'base');
  if (!anchors.length) return [];
  const out: { place: Place; distM: number }[] = [];
  for (const p of places) {
    if (inCard.has(p.id) || p.category === 'base' || p.lat == null || p.lng == null || p.custom) continue;
    const d = Math.min(...anchors.map((a) => straightLineM({ lat: a.lat!, lng: a.lng! }, { lat: p.lat!, lng: p.lng! })));
    if (d <= radiusM) out.push({ place: p, distM: d });
  }
  return out.sort((a, b) => a.distM - b.distM).slice(0, max);
}
