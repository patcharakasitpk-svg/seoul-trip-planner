/** เวลาทั้งหมดอิง Asia/Seoul (UTC+09:00 ตลอดปี ไม่มี DST) */
export const SEOUL_TZ = 'Asia/Seoul';
export const SEOUL_OFFSET = '+09:00';

export function parseHM(hm: string | null | undefined): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

/** นาทีจากเที่ยงคืน → 'HH:MM' (เกิน 24 ชม. เติม +1) */
export function fmtHM(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return '--:--';
  const m = Math.round(mins);
  const dayOff = Math.floor(m / 1440);
  const r = ((m % 1440) + 1440) % 1440;
  const s = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  return dayOff > 0 ? `${s} (+${dayOff})` : s;
}

export function fmtDur(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return 'ไม่ทราบ';
  const m = Math.round(Math.abs(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = h ? (r ? `${h} ชม. ${r} นาที` : `${h} ชม.`) : `${r} นาที`;
  return mins < 0 ? `-${s}` : s;
}

/** Date จริง (instant) ของวันที่+เวลาในโซล */
export function seoulDate(date: string, mins: number): Date {
  const dayOff = Math.floor(mins / 1440);
  const r = mins - dayOff * 1440;
  const base = new Date(`${date}T${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}:00${SEOUL_OFFSET}`);
  return new Date(base.getTime() + dayOff * 86400000);
}

/** วันที่/เวลา ปัจจุบันในโซล */
export function seoulNow(now: Date = new Date()): { date: string; mins: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, mins: Number(g('hour')) * 60 + Number(g('minute')) };
}

/** instant → นาทีจากเที่ยงคืนของ refDate (โซล) */
export function minsOnSeoulDate(instant: Date, refDate: string): number {
  const midnight = new Date(`${refDate}T00:00:00${SEOUL_OFFSET}`).getTime();
  return Math.round((instant.getTime() - midnight) / 60000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00${SEOUL_OFFSET}`);
  d.setTime(d.getTime() + n * 86400000);
  return seoulNow(d).date;
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
}

const TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function fmtDateTh(date: string | null): string {
  if (!date) return 'ยังไม่เลือกวันที่';
  const d = new Date(`${date}T12:00:00Z`);
  return `${TH_DOW[d.getUTCDay()]} ${d.getUTCDate()} ${TH_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}
