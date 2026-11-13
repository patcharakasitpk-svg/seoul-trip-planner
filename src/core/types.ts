export type Category = 'base' | 'food' | 'fashion' | 'beauty' | 'market' | 'sight';

/** given = พิกัดตั้งต้นจากผู้ใช้, verified = ตรวจกับแหล่งข้อมูล, area-center = กลางย่าน, user = ผู้ใช้เพิ่มเอง, unverified = ยังไม่ปักหมุด */
export type CoordStatus = 'given' | 'verified' | 'area-center' | 'user' | 'unverified';

export interface Source {
  label: string;
  url: string;
}

export interface Place {
  id: string;
  nameTh: string;
  nameEn: string;
  nameKo?: string | null;
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
    type: 'one-dish' | 'noodle' | 'bbq' | 'market';
    menu: string[];
    mealMin: number;
    minOrder: string | null;
    diningZone: 'near-coex' | 'near-hotel' | 'between' | 'other';
  } | null;
  fashionTypes?: string[] | null;
  sources: Source[];
  checkedAt?: string | null;
  notes?: string | null;
  custom?: boolean;
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
}

export interface DayPrefs {
  lessWalking: boolean;
  fewerTransfers: boolean;
  fastest: boolean;
}

export interface Day {
  id: string;
  date: string | null; // YYYY-MM-DD (Asia/Seoul)
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
}

export type ColdLevel = 'low' | 'normal' | 'high';

export interface Plan {
  version: 1;
  id: string;
  name: string;
  days: Day[];
  customPlaces: Place[];
  stayOverrides: Record<string, number>;
  saved: string[];
  coldLevel: ColdLevel;
  /** dayId -> item key -> checked */
  checklist: Record<string, Record<string, boolean>>;
  extraChecklist: Record<string, string[]>;
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
