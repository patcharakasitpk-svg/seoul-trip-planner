import type { DayPrefs, RouteResult, TransitStep, TravelMode } from '../core/types';
import { fmtHM, minsOnSeoulDate, seoulDate, seoulNow, diffDays } from '../core/time';
import { googleStatus, isGoogleReady } from './google';

/**
 * Google Maps JS "Routes library" (Route.computeRoutes) — ขอทีละช่วง (A→B)
 * - Transit: ใช้ departureTime จริง (Asia/Seoul) — Google รับช่วง 7 วันย้อนหลังถึง 100 วันล่วงหน้า
 * - เกาหลีใต้: Google ระบุว่าไม่มี/คุณภาพต่ำ สำหรับเส้นทางเดิน/ขับรถ → แสดง "ไม่รองรับ"
 * - ผลเก็บในหน่วยความจำเท่านั้น (ไม่บันทึก ไม่แชร์)
 * - ป้องกันผลเก่าทับผลใหม่: เก็บผลตาม key (รวมเวลาออก) และ UI อ่านตาม key ปัจจุบันเท่านั้น
 */

export interface RouteReq {
  from: { id: string; lat: number; lng: number };
  to: { id: string; lat: number; lng: number };
  mode: TravelMode;
  date: string;
  departMins: number | null;
  prefs: DayPrefs;
}

const BUCKET = 15; // ปัดเวลาออกเป็นช่วง 15 นาทีเพื่อลดคำขอซ้ำ
const cache = new Map<string, RouteResult | 'pending'>();
const unsupported = new Map<string, RouteResult>(); // from|to|mode ที่บริการตอบว่าไม่มีเส้นทาง (ไม่ขึ้นกับเวลา)
const queue: { key: string; req: RouteReq }[] = [];
let running = 0;
const MAX_CONCURRENT = 2;
let wanted = new Set<string>();
let listener: () => void = () => {};
export function onRoutesChange(fn: () => void) {
  listener = fn;
}

export function bucketMins(m: number | null): number | null {
  return m == null ? null : Math.floor(m / BUCKET) * BUCKET;
}

export function routeKey(fromId: string, toId: string, mode: TravelMode, date: string | null, departMins: number | null, prefs?: DayPrefs): string {
  const p = prefs ? `${prefs.lessWalking ? 'W' : ''}${prefs.fewerTransfers ? 'T' : ''}` : '';
  const t = mode === 'TRANSIT' ? `${date}|${bucketMins(departMins) ?? 'now'}` : '';
  return `${fromId}|${toId}|${mode}|${t}|${p}`;
}

export function peekRoute(key: string, fromId: string, toId: string, mode: TravelMode): RouteResult | undefined {
  const u = unsupported.get(`${fromId}|${toId}|${mode}`);
  if (u) return u;
  const c = cache.get(key);
  return c === 'pending' ? undefined : c;
}

export function isPending(key: string) {
  return cache.get(key) === 'pending';
}

/** แจ้งชุด key ที่หน้าจอต้องการในรอบนี้ — คิวเก่าที่ไม่ต้องการแล้วจะถูกทิ้ง */
export function setWanted(keys: Set<string>) {
  wanted = keys;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!wanted.has(queue[i].key)) {
      cache.delete(queue[i].key);
      queue.splice(i, 1);
    }
  }
}

export function requestRoute(req: RouteReq): void {
  const key = routeKey(req.from.id, req.to.id, req.mode, req.date, req.departMins, req.prefs);
  if (cache.has(key) || unsupported.has(`${req.from.id}|${req.to.id}|${req.mode}`)) return;
  if (!isGoogleReady()) return;
  const today = seoulNow().date;
  const dd = diffDays(today, req.date);
  if (req.mode === 'TRANSIT' && (dd < -7 || dd > 100)) {
    cache.set(key, { status: 'unsupported', message: dd < 0 ? 'วันที่ผ่านมาเกิน 7 วัน' : 'บริการรองรับล่วงหน้าไม่เกิน 100 วัน' });
    return;
  }
  cache.set(key, 'pending');
  queue.push({ key, req });
  pump();
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    if (!wanted.has(job.key)) {
      cache.delete(job.key);
      continue;
    }
    running++;
    compute(job.req)
      .then((r) => {
        if (r.status === 'unsupported' && job.req.mode !== 'TRANSIT') unsupported.set(`${job.req.from.id}|${job.req.to.id}|${job.req.mode}`, r);
        cache.set(job.key, r);
      })
      .catch((e) => cache.set(job.key, { status: 'error', message: String(e?.message ?? e) }))
      .finally(() => {
        running--;
        listener();
        pump();
      });
  }
}

/** ล้างแคช (ปุ่มรีเฟรชเส้นทาง) */
export function clearRoutes() {
  cache.clear();
  unsupported.clear();
  queue.length = 0;
}

async function compute(req: RouteReq): Promise<RouteResult> {
  if (!isGoogleReady()) return { status: 'no-key', message: googleStatus().error };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline', message: '' };
  const g = (window as any).google;
  const { Route } = await g.maps.importLibrary('routes');
  const request: any = {
    origin: { lat: req.from.lat, lng: req.from.lng },
    destination: { lat: req.to.lat, lng: req.to.lng },
    travelMode: req.mode,
    language: 'th',
    region: 'kr',
    fields: ['durationMillis', 'distanceMeters', 'path', 'legs', 'localizedValues', 'travelAdvisory'],
  };
  const depMins = bucketMins(req.departMins);
  if (req.mode === 'TRANSIT') {
    if (depMins != null) request.departureTime = seoulDate(req.date, depMins);
    const rp = req.prefs.lessWalking ? 'LESS_WALKING' : req.prefs.fewerTransfers ? 'FEWER_TRANSFERS' : undefined;
    if (rp) request.transitPreference = { routingPreference: rp };
  }
  let resp: any;
  try {
    resp = await Route.computeRoutes(request);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/ZERO_RESULTS|NOT_FOUND|no route|INVALID_ARGUMENT/i.test(msg)) return { status: 'unsupported', message: 'ไม่พบเส้นทางสำหรับวิธีนี้' };
    return { status: 'error', message: msg.slice(0, 160) };
  }
  const route = resp?.routes?.[0];
  if (!route) return { status: 'unsupported', message: req.mode === 'TRANSIT' ? 'ไม่พบเส้นทางขนส่งสาธารณะในเวลานี้' : 'Google ไม่มีเส้นทางวิธีนี้ในเกาหลีใต้' };
  return parseRoute(route, req.date);
}

const toLL = (p: any) => (p ? { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng } : null);
const ms2min = (v: any) => (typeof v === 'number' ? Math.round(v / 60000) : null);
const txt = (v: any): string | undefined => (v == null ? undefined : typeof v === 'string' ? v : v.text ?? v.name ?? undefined);

export function parseRoute(route: any, date: string): RouteResult {
  const durationMin = ms2min(route.durationMillis);
  if (durationMin == null) return { status: 'error', message: 'ไม่มีระยะเวลาในผลลัพธ์' };
  const steps: TransitStep[] = [];
  let walk = 0;
  let walkKnown = false;
  let transitCount = 0;
  let firstDep: Date | null = null;
  let lastArr: Date | null = null;
  for (const leg of route.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const dur = ms2min(s.staticDurationMillis ?? s.durationMillis);
      const td = s.transitDetails;
      if (td) {
        transitCount++;
        const dep = td.departureTime ? new Date(td.departureTime) : null;
        const arr = td.arrivalTime ? new Date(td.arrivalTime) : null;
        if (dep && !firstDep) firstDep = dep;
        if (arr) lastArr = arr;
        steps.push({
          kind: 'transit',
          durationMin: dur,
          distanceM: s.distanceMeters ?? null,
          line: txt(td.transitLine?.shortName) || txt(td.transitLine?.name),
          vehicle: txt(td.transitLine?.vehicle?.name) || txt(td.transitLine?.vehicle?.vehicleType),
          headsign: txt(td.headsign),
          fromStop: txt(td.departureStop?.name),
          toStop: txt(td.arrivalStop?.name),
          departAt: dep ? fmtHM(minsOnSeoulDate(dep, date)) : undefined,
          arriveAt: arr ? fmtHM(minsOnSeoulDate(arr, date)) : undefined,
          stopCount: td.stopCount ?? undefined,
        });
      } else {
        const isWalk = /WALK/i.test(String(s.travelMode ?? ''));
        if (isWalk && dur != null) {
          walk += dur;
          walkKnown = true;
        }
        const prev = steps[steps.length - 1];
        if (isWalk && prev && prev.kind === 'walk') {
          prev.durationMin = (prev.durationMin ?? 0) + (dur ?? 0);
          prev.distanceM = (prev.distanceM ?? 0) + (s.distanceMeters ?? 0);
        } else {
          steps.push({ kind: isWalk ? 'walk' : 'other', durationMin: dur, distanceM: s.distanceMeters ?? null, instruction: txt(s.instructions) });
        }
      }
    }
  }
  const fare = route.localizedValues?.transitFare;
  const path = Array.isArray(route.path) ? route.path.map(toLL).filter(Boolean) : null;
  return {
    status: 'ok',
    durationMin,
    distanceM: route.distanceMeters ?? null,
    walkMin: walkKnown ? walk : null,
    transfers: transitCount ? transitCount - 1 : 0,
    fareText: txt(fare) ?? null,
    departAt: firstDep ? fmtHM(minsOnSeoulDate(firstDep, date)) : null,
    arriveAt: lastArr ? fmtHM(minsOnSeoulDate(lastArr, date)) : null,
    steps,
    path,
  };
}
