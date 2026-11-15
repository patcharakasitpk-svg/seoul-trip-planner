/**
 * รายการสิ่งของที่ต้องเตรียมไป (เช็กลิสต์) — เก็บในแผน จึงส่งไปมือถือพร้อมแผนได้
 * รายการตั้งต้นทำสำหรับทริปนี้: โซลต้นเดือนธันวาคม (หนาว) + งานที่ COEX
 */
export interface PackItem {
  id: string;
  text: string;
  group: string;
  done: boolean;
}

export const PACK_LIMITS = { items: 200, text: 100, group: 40 };

const DEFAULTS: [string, string[]][] = [
  ['เอกสารและเงิน', ['พาสปอร์ต (อายุเหลือเกิน 6 เดือน)', 'ตั๋วเครื่องบิน TG656 / TG653', 'ใบยืนยันโรงแรม (โซล + ซูวอน)', 'ประกันเดินทาง', 'บัตรเครดิต / บัตรเดบิตต่างประเทศ', 'เงินวอนสด', 'เช็กเงื่อนไขเข้าเกาหลี (K-ETA)']],
  ['งานที่ COEX', ['บัตรผ่าน / เอกสารงาน', 'นามบัตร', 'ของสำหรับตั้งบูธ', 'ชุดสำหรับงานมอบรางวัล (4 ธ.ค.)']],
  ['เสื้อผ้ากันหนาว', ['เสื้อโค้ท / ดาวน์', 'ฮีทเทค / เสื้อชั้นในกันหนาว', 'ถุงมือ', 'หมวกไหมพรม', 'ผ้าพันคอ', 'ถุงเท้าหนา', 'รองเท้าเดินสบาย']],
  ['อุปกรณ์', ['ปลั๊กแปลง (เกาหลีใช้ขากลม 2 ขา 220V)', 'พาวเวอร์แบงก์ (ถือขึ้นเครื่อง)', 'สายชาร์จ', 'ซิม / eSIM เกาหลี']],
  ['ของใช้และยา', ['ยาประจำตัว', 'ยาแก้หวัด / แก้ปวด', 'ลิปบาล์ม / โลชั่น (อากาศแห้ง)', 'กระเป๋าผ้าสำหรับช้อปปิ้ง']],
];

export function defaultPacking(newId: () => string): PackItem[] {
  return DEFAULTS.flatMap(([group, items]) => items.map((text) => ({ id: newId(), text, group, done: false })));
}

/** หมวดเรียงตามลำดับที่พบครั้งแรก */
export function packGroups(items: PackItem[]): { name: string; items: PackItem[] }[] {
  const out: { name: string; items: PackItem[] }[] = [];
  for (const it of items) {
    let g = out.find((x) => x.name === it.group);
    if (!g) out.push((g = { name: it.group, items: [] }));
    g.items.push(it);
  }
  return out;
}

/** ตรวจข้อมูลจากภายนอก (ลิงก์/JSON/เครื่องนี้) */
export function cleanPacking(x: unknown): PackItem[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const seen = new Set<string>();
  const out: PackItem[] = [];
  for (const it of x.slice(0, PACK_LIMITS.items)) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.slice(0, 40) : '';
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, PACK_LIMITS.text) : '';
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    const group = (typeof o.group === 'string' ? o.group.trim().slice(0, PACK_LIMITS.group) : '') || 'อื่น ๆ';
    out.push({ id, text, group, done: o.done === true });
  }
  return out;
}

/** รับแผนจากเครื่องอื่น: ของที่ติ๊กไว้ในเครื่องไหนก็ยังติ๊กอยู่ */
export function mergePackingDone(incoming: PackItem[] | undefined, local: PackItem[] | undefined): PackItem[] | undefined {
  if (!incoming) return local; // อีกเครื่องยังไม่เคยเปิดรายการ → คงของเครื่องนี้ไว้
  if (!local) return incoming;
  const done = new Set(local.filter((i) => i.done).map((i) => i.id));
  return incoming.map((i) => (done.has(i.id) && !i.done ? { ...i, done: true } : i));
}
