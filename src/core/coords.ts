/** พิกัดในเกาหลีใต้ (กันวางพิกัดผิดประเทศ/สลับ lat-lng) */
export const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

/**
 * อ่านพิกัดที่ผู้ใช้วาง: "37.5438, 127.0557" (คลิกขวาบน Google Maps) หรือลิงก์ Google Maps แบบยาว
 * (มี !3d…!4d… ซึ่งเป็นตำแหน่งร้าน, @lat,lng หรือ q=lat,lng) — ลิงก์ย่อ maps.app.goo.gl อ่านไม่ได้ (ต้องเปิดก่อน)
 * ลิงก์ Naver Map: c=x,y (เมตร Web Mercator แบบเก่า) / c=lng,lat (องศา) / /address/x,y / lat=&lng= (nmap://, มือถือ)
 * ตัวเลขสลับลำดับ "lng, lat" ก็อ่านได้ เพราะช่วงละติจูด (33–39) กับลองจิจูด (124–132) ของเกาหลีไม่ทับกัน
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const pc = parsePlusCode(text);
  if (pc) return pc;
  const t = text.trim();
  const num = '(-?\\d{1,3}\\.\\d+)';
  const tries = [new RegExp(`!3d${num}!4d${num}`), new RegExp(`@${num},${num}`), new RegExp(`[?&](?:q|ll|query)=${num},\\s*${num}`), new RegExp(`^${num}\\s*,\\s*${num}$`)];
  for (const re of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && inKorea(lat, lng)) return { lat, lng };
  }
  return parseNaver(t);
}

const R_EARTH = 6378137;
/** เมตร Web Mercator (EPSG:3857) → องศา */
const fromMercator = (x: number, y: number) => ({ lat: (Math.atan(Math.sinh(y / R_EARTH)) * 180) / Math.PI, lng: ((x / R_EARTH) * 180) / Math.PI });
const ok = (p: { lat: number; lng: number }) => (Number.isFinite(p.lat) && Number.isFinite(p.lng) && inKorea(p.lat, p.lng) ? p : null);

function parseNaver(t: string): { lat: number; lng: number } | null {
  const num = '(-?\\d{1,3}\\.\\d+)';
  // lat=…&lng=… (ลำดับไหนก็ได้)
  const la = new RegExp(`[?&]lat=${num}`).exec(t);
  const ln = new RegExp(`[?&]lng=${num}`).exec(t);
  if (la && ln) {
    const p = ok({ lat: Number(la[1]), lng: Number(ln[1]) });
    if (p) return p;
  }
  // เมตร Web Mercator: x ≈ 13.8–14.7 ล้าน, y ≈ 3.9–4.8 ล้าน
  const m = /(1[34]\d{6}(?:\.\d+)?)\s*,\s*(\d{7}(?:\.\d+)?)/.exec(t);
  if (m) {
    const p = ok(fromMercator(Number(m[1]), Number(m[2])));
    if (p) return p;
  }
  // คู่องศาแบบ lng,lat (เช่น c=127.02,37.49,…)
  const re = new RegExp(`${num}\\s*,\\s*${num}`, 'g');
  for (let x = re.exec(t); x; x = re.exec(t)) {
    const p = ok({ lat: Number(x[2]), lng: Number(x[1]) });
    if (p) return p;
  }
  return null;
}

/** เหตุผลที่อ่านพิกัดไม่ได้ (ข้อความแสดงใต้ช่อง) */
export function coordError(text: string): string {
  const t = text.trim();
  if (/naver\.me/i.test(t)) return 'ลิงก์ย่อ naver.me ไม่มีพิกัดในลิงก์ — เปิดใน map.naver.com บนคอมแล้วคัดลอกลิงก์เต็มจากช่องที่อยู่ หรือกด “แตะบนแผนที่” แล้วแตะตรงร้านแทน';
  if (/naver\.com/i.test(t)) return 'ลิงก์ Naver นี้มีแต่รหัสร้าน ไม่มีพิกัด — ลองคัดลอกลิงก์ “ที่อยู่/จุดบนแผนที่” ของ Naver หรือกด “แตะบนแผนที่” แล้วแตะตรงร้านแทน';
  if (/goo\.gl|maps\.app/i.test(t)) return 'ลิงก์ย่อ (maps.app.goo.gl) ไม่มีพิกัดในลิงก์ — เปิดลิงก์นั้นใน Google Maps แล้วคัดลอกบรรทัดรหัสแบบ “HX7M+HQ8 Seoul” (ไอคอนจุดตาราง) มาวางแทน';
  const m = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(t);
  if (m && !inKorea(Number(m[1]), Number(m[2]))) return 'พิกัดนี้ไม่อยู่ในเกาหลี — ตรวจลำดับตัวเลข (ละติจูด 37.xx ก่อน ลองจิจูด 126–127.xx)';
  return 'อ่านพิกัดไม่ได้ — วางรหัสแบบ HX7M+HQ8 จาก Google Maps หรือตัวเลขเช่น 37.5438, 127.0557';
}

/* ---------- Plus Code (Open Location Code) ---------- */
const OLC = '23456789CFGHJMPQRVWX';
/** จุดอ้างอิงสำหรับรหัสแบบสั้น (เช่น "HX7M+HQ8 Seoul") — กลางโซล ใช้ได้ทั้งโซล/ซูวอน/อินชอน */
const SEOUL_REF = { lat: 37.5665, lng: 126.978 };

function olcDecode(code: string): { lat: number; lng: number } | null {
  const c = code.replace('+', '');
  if (c.length < 8 || [...c].some((ch) => !OLC.includes(ch))) return null;
  let lat = -90;
  let lng = -180;
  let res = 20;
  const pairs = c.slice(0, 10);
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    lat += OLC.indexOf(pairs[i]) * res;
    lng += OLC.indexOf(pairs[i + 1]) * res;
    if (i < 8) res /= 20;
  }
  let latRes = res;
  let lngRes = res;
  if (pairs.length < 10) {
    // รหัสสั้นกว่า 10 หลัก: ความละเอียดตามจำนวนคู่
    latRes = lngRes = 20 / 20 ** (pairs.length / 2 - 1);
  }
  for (const ch of c.slice(10)) {
    const v = OLC.indexOf(ch);
    latRes /= 5;
    lngRes /= 4;
    lat += Math.floor(v / 4) * latRes;
    lng += (v % 4) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

function olcPrefix(lat: number, lng: number): string {
  let a = lat + 90;
  let b = lng + 180;
  let res = 20;
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += OLC[Math.floor(a / res) % 20] + OLC[Math.floor(b / res) % 20];
    a %= res;
    b %= res;
    res /= 20;
  }
  return out;
}

/** อ่าน Plus Code ทั้งแบบเต็ม (8Q98HX7M+HQ8) และแบบสั้นที่ Google Maps แสดง (HX7M+HQ8 Seoul) — รวมถึงในลิงก์ */
export function parsePlusCode(text: string): { lat: number; lng: number } | null {
  let t = text;
  try {
    t = decodeURIComponent(text);
  } catch {
    /* ใช้ข้อความเดิม */
  }
  const m = /(?:^|[^A-Z0-9])([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})(?![A-Z0-9])/i.exec(t.toUpperCase());
  if (!m) return null;
  const code = m[1];
  const sep = code.indexOf('+');
  let full = code;
  if (sep < 8) {
    // รหัสสั้น: เติมหลักหน้าจากจุดอ้างอิง แล้วเลือกตำแหน่งที่ใกล้จุดอ้างอิงที่สุด
    const pad = 8 - sep;
    full = olcPrefix(SEOUL_REF.lat, SEOUL_REF.lng).slice(0, pad) + code;
    const d = olcDecode(full);
    if (!d) return null;
    const resolution = 20 ** (2 - pad / 2);
    const half = resolution / 2;
    let { lat, lng } = d;
    if (SEOUL_REF.lat + half < lat) lat -= resolution;
    else if (SEOUL_REF.lat - half > lat) lat += resolution;
    if (SEOUL_REF.lng + half < lng) lng -= resolution;
    else if (SEOUL_REF.lng - half > lng) lng += resolution;
    return inKorea(lat, lng) ? { lat, lng } : null;
  }
  const d = olcDecode(full);
  return d && inKorea(d.lat, d.lng) ? d : null;
}
