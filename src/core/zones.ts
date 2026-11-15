/** ย่านหลักของทริป — รวมชื่อย่านที่เขียนต่างกันในข้อมูล (เช่น "COEX/Samseong" กับ "COEX / Samseong") */
export const ZONES = {
  myeongdong: { th: 'เมียงดง · ใจกลางเมือง', keys: ['myeongdong', 'hoehyeon', 'namdaemun', 'euljiro', 'chungmuro', 'city hall', 'namsan', 'jung-gu'] },
  jongno: { th: 'จงโน · อิกซอนดง · ทงแดมุน', keys: ['jongno', 'ikseon', 'hyehwa', 'ihwa', 'dongdaemun', 'seochon', 'gwanghwamun', 'insadong'] },
  hongdae: { th: 'ฮงแด · ยอนนัม · ยอนฮี · มังวอน', keys: ['hongdae', 'yeonnam', 'yeonhui', 'seodaemun', 'mangwon', 'hapjeong', 'mapo', 'sinchon'] },
  seongsu: { th: 'ซองซู · ทุกซอม', keys: ['seongsu', 'ttukseom', 'seoul forest'] },
  gangnam: { th: 'คังนัม · ชินซา · อัปกูจอง', keys: ['gangnam', 'sinsa', 'garosu', 'apgujeong', 'cheongdam', 'dosan', 'express bus terminal', 'sinnonhyeon'] },
  coex: { th: 'COEX · ซัมซอง', keys: ['coex', 'samseong', 'bongeunsa'] },
  yongsan: { th: 'ยงซาน · อิแทวอน · ฮันนัม', keys: ['yongsan', 'itaewon', 'hannam', 'haebangchon', 'noksapyeong'] },
  yeouido: { th: 'ยออีโด · ยองดึงโพ', keys: ['yeouido', 'yeongdeungpo', 'dangsan'] },
  jamsil: { th: 'จัมซิล · ล็อตเต้เวิลด์ · ซงพา', keys: ['jamsil', 'songpa', 'lotte world'] },
  suwon: { th: 'ซูวอน', keys: ['suwon'] },
  airport: { th: 'สนามบินอินชอน', keys: ['incheon'] },
  other: { th: 'อื่น ๆ', keys: [] as string[] },
} as const;

export type Zone = keyof typeof ZONES;

export function zoneOf(area: string | null | undefined): Zone {
  const a = (area ?? '').toLowerCase();
  for (const [z, def] of Object.entries(ZONES) as [Zone, (typeof ZONES)[Zone]][]) {
    if (def.keys.some((k) => a.includes(k))) return z;
  }
  return 'other';
}

/** ชื่อย่านที่เก็บใน area เมื่อผู้ใช้เลือกย่านเอง — zoneOf(ค่านี้) ได้ย่านเดิมเสมอ */
export const ZONE_AREA: Record<Zone, string> = {
  myeongdong: 'Myeongdong',
  jongno: 'Jongno',
  hongdae: 'Hongdae',
  seongsu: 'Seongsu',
  gangnam: 'Gangnam',
  coex: 'COEX / Samseong',
  yongsan: 'Yongsan / Itaewon',
  yeouido: 'Yeouido',
  jamsil: 'Jamsil / Songpa',
  suwon: 'Suwon',
  airport: 'Incheon',
  other: 'เพิ่มเอง',
};

/** ชื่อย่านภาษาไทยสั้น ๆ (คำแรก) เช่น "เมียงดง" */
export const zoneShort = (z: Zone) => ZONES[z].th.split(' · ')[0];
