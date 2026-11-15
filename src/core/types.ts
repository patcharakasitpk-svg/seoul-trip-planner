export type Category = 'base' | 'food' | 'fashion' | 'beauty' | 'market' | 'sight';

/** given = พิกัดตั้งต้นจากผู้ใช้, verified = ตรวจกับแหล่งข้อมูล, area-center = กลางย่าน, approx = มีพิกัดจากแหล่งเดียว (ปักหมุดเส้นประ), user = ผู้ใช้เพิ่มเอง, unverified = ยังไม่ปักหมุด */
export type CoordStatus = 'given' | 'verified' | 'area-center' | 'approx' | 'user' | 'unverified';

export interface Source {
  label: string;
  url: string;
}

export interface Place {
  id: string;
  nameTh: string;
  nameEn: string;
  nameKo?: string | null;
  /** ชื่อไทย (ใช้ค้นหา/แสดงในรายละเอียด) — ชื่อหลักที่แสดง (nameTh) เป็นชื่ออังกฤษมาตรฐานแบบที่ค้นใน Google */
  thaiName?: string | null;
  branch?: string | null;
  category: Category;
  /** hotel / venue = หมุดแยกประเภท */
  kind?: 'hotel' | 'venue' | 'place';
  area: string;
  address?: string | null;
  lat: number | null;
  lng: number | null;
  coordStatus: CoordStatus;
  coordSource?: string | null;
  reasonTh: string;
  suggestedStayMin: number;
  budget?: { textTh: string; krwMin: number | null; krwMax: number | null; status: 'source' | 'estimate' | 'unknown' } | null;
  hours?: { text: string; closedDays: string | null; lastOrder: string | null; status: 'verified' | 'unverified'; /** วันหยุดประจำสัปดาห์ 0=อาทิตย์ */ closedWeekdays?: number[] } | null;
  openTime?: string | null;
  closeTime?: string | null;
  indoor: boolean;
  food?: {
    type: 'one-dish' | 'noodle' | 'bbq' | 'market' | 'cafe';
    menu: string[];
    mealMin: number;
    minOrder: string | null;
    diningZone: 'near-coex' | 'near-hotel' | 'between' | 'other';
  } | null;
  fashionTypes?: string[] | null;
  /** สถานีรถไฟฟ้าใกล้สุด (จากแหล่งข้อมูล) */
  transit?: {
    stations: { name: string; nameKo?: string | null; lines: string[]; exit?: string | null; walkMin?: number | null }[];
    bus?: string | null;
    status: 'verified' | 'unverified';
    sources?: Source[];
  } | null;
  sources: Source[];
  checkedAt?: string | null;
  notes?: string | null;
  custom?: boolean;
  /** ลิงก์ที่ผู้ใช้แนบ (เฉพาะสถานที่ที่เพิ่มเอง) — เช่น Google Maps / IG / รีวิว */
  links?: string[] | null;
  /** รูปที่ผู้ใช้อัปโหลด (id ใน IndexedDB ของเครื่องนี้) */
  photos?: string[] | null;
  /** ชื่อคนที่เพิ่ม (กลุ่มแชร์สถานที่) */
  addedBy?: string | null;
}

export type TravelMode = 'TRANSIT' | 'WALKING' | 'DRIVING';

export interface Leg {
  mode: TravelMode;
  /** เวลาเดินทางที่ผู้ใช้กรอกเอง (นาที) */
  manualMin: number | null;
  /** 'user' = ผู้ใช้กรอก, 'estimate' = ผู้ใช้กดใช้ค่าประมาณจากระยะเส้นตรง */
  manualKind?: 'user' | 'estimate';
}

export type StopKind = 'place' | 'dinner' | 'break' | 'buffer';

export interface Stop {
  uid: string;
  kind: StopKind;
  placeId: string | null;
  title?: string;
  stayMin: number;
  /** เวลานัดที่ล็อก 'HH:MM' (เวลาเริ่มกิจกรรม/ถึง) */
  lockedTime: string | null;
  note: string;
  legIn: Leg;
  skipped?: boolean;
  /** ชนิดมื้อ (เฉพาะ kind 'dinner' = ช่องมื้ออาหาร) · ไม่มี = มื้อเย็น */
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

export interface DayPrefs {
  lessWalking: boolean;
  fewerTransfers: boolean;
  fastest: boolean;
}

export interface Day {
  id: string;
  date: string | null; // YYYY-MM-DD (Asia/Seoul)
  /** ชื่อวันที่ผู้ใช้ตั้ง เช่น "เมียงดง · นัมแดมุน" */
  title?: string;
  startPlaceId: string | null;
  startTime: string | null; // HH:MM
  endPlaceId: string | null;
  endTime: string | null; // desired arrival HH:MM
  bufferMin: number; // เวลาเผื่อต่อช่วงการเดินทาง (แยกจากเวลาบริการ)
  prefs: DayPrefs;
  afterBooth: boolean;
  stops: Stop[];
  endLeg: Leg;
  weatherRef: string; // 'seoul' | placeId
  /** เวลาจริงระหว่างเดินทาง: key = uid ของจุดแวะ, '__start' (ออกจากจุดเริ่ม), '__end' (ถึงจุดสิ้นสุด) · a = ถึง, d = ออก (HH:MM) */
  actual?: Record<string, { a?: string; d?: string }>;
}

export type ColdLevel = 'low' | 'normal' | 'high';

export interface Plan {
  version: 1;
  id: string;
  /** รหัสห้องซิงก์สดกับเพื่อน (ไม่มี = แผนเฉพาะเครื่องนี้) */
  roomId?: string | null;
  name: string;
  days: Day[];
  customPlaces: Place[];
  /** พิกัดที่ผู้ใช้ตั้งเองให้สถานที่ที่ยังไม่มีพิกัด (placeId → lat/lng) */
  coordOverrides?: Record<string, { lat: number; lng: number }>;
  stayOverrides: Record<string, number>;
  saved: string[];
  coldLevel: ColdLevel;
  /** dayId -> item key -> checked */
  checklist: Record<string, Record<string, boolean>>;
  extraChecklist: Record<string, string[]>;
  /** สิ่งของที่ต้องเตรียมไป (ไม่มี = ยังไม่เคยเปิด → ใช้รายการแนะนำ) */
  packing?: import('./packing').PackItem[];
  updatedAt: string;
}

/** ผลเส้นทางจากบริการ (ไม่บันทึกลงแผน / ไม่แชร์) */
export interface TransitStep {
  kind: 'walk' | 'transit' | 'other';
  durationMin: number | null;
  distanceM: number | null;
  instruction?: string;
  line?: string;
  vehicle?: string;
  headsign?: string;
  fromStop?: string;
  toStop?: string;
  departAt?: string; // HH:MM Seoul
  arriveAt?: string;
  stopCount?: number;
}

export type RouteResult =
  | {
      status: 'ok';
      durationMin: number;
      distanceM: number | null;
      walkMin: number | null;
      transfers: number | null;
      fareText: string | null;
      departAt: string | null;
      arriveAt: string | null;
      steps: TransitStep[];
      path: { lat: number; lng: number }[] | null;
    }
  | { status: 'unsupported' | 'error' | 'no-key' | 'no-coords' | 'offline'; message: string };
