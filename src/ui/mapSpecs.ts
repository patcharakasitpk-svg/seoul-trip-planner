import type { Day, Place } from '../core/types';
import type { DaySchedule } from '../core/schedule';
import type { LineSpec, MarkerSpec } from '../services/map';
import { dayColor } from './util';
import type { SearchResult } from '../services/placeSearch';

export interface MapSpecInput {
  days: Day[]; // วันที่จะแสดง
  allDays: Day[]; // ทุกวัน (ใช้หาหมายเลขวัน)
  mode: 'all' | 'day';
  getPlace: (id: string | null | undefined) => Place | undefined;
  schedule: (d: Day) => DaySchedule;
  libraryPlaces: Place[] | null; // null = ไม่แสดงจุดในคลัง
  /** ผลค้นหาชั่วคราว → หมุด id "search:<ลำดับ>" */
  searchResults?: SearchResult[] | null;
  /** ซูมพอดีเฉพาะผลค้นหา */
  focusSearch?: boolean;
}

export const SEARCH_PREFIX = 'search:';

/** สร้างหมุด/เส้นจากแผน: ลำดับบนหมุด = ลำดับในรายการของวัน; สถานที่เดียวหลายวัน = หมุดเดียวหลายป้าย */
export function buildMapSpecs(inp: MapSpecInput): { markers: MarkerSpec[]; lines: LineSpec[] } {
  const markers = new Map<string, MarkerSpec>();
  const kindOf = (p: Place): MarkerSpec['kind'] => (p.kind === 'hotel' ? 'hotel' : p.kind === 'venue' ? 'venue' : 'stop');
  const ensure = (p: Place, kind: MarkerSpec['kind']) => {
    if (p.lat == null || p.lng == null) return null; // ไม่ปักหมุดพิกัดที่ยังไม่ตรวจสอบ
    let m = markers.get(p.id);
    if (!m) {
      m = { id: p.id, lat: p.lat, lng: p.lng, kind, title: p.nameTh, badges: [], areaCenter: p.coordStatus === 'area-center' };
      markers.set(p.id, m);
    } else if (kind !== 'lib' && m.kind === 'lib') m.kind = kind;
    return m;
  };
  const lines: LineSpec[] = [];
  for (const d of inp.days) {
    const di = inp.allDays.findIndex((x) => x.id === d.id);
    const color = dayColor(di);
    [d.startPlaceId, d.endPlaceId].forEach((id) => {
      const p = inp.getPlace(id);
      const m = p ? ensure(p, kindOf(p)) : null;
      if (m) m.focus = true;
    });
    d.stops.forEach((st, j) => {
      const p = inp.getPlace(st.placeId);
      if (!p) return;
      const m = ensure(p, kindOf(p));
      if (m) m.focus = true;
      if (m) m.badges.push({ color, text: inp.mode === 'all' ? `${di + 1}-${j + 1}` : `${j + 1}` });
    });
    const s = inp.schedule(d);
    const legs = [...s.stops.filter((t) => !t.stop.skipped).map((t) => t.leg), ...(s.end ? [s.end.leg] : [])];
    for (const l of legs) {
      if (l.source === 'same' || !l.fromId || !l.toId) continue;
      if (l.route && l.route.status === 'ok' && l.route.path?.length) lines.push({ path: l.route.path, color, real: true });
      else {
        const a = inp.getPlace(l.fromId);
        const b = inp.getPlace(l.toId);
        if (a?.lat != null && b?.lat != null) lines.push({ path: [{ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! }], color, real: false });
      }
    }
  }
  ['hotel', 'coex'].forEach((id) => {
    const p = inp.getPlace(id);
    if (p) ensure(p, kindOf(p));
  });
  if (inp.libraryPlaces) for (const p of inp.libraryPlaces) if (!markers.has(p.id)) ensure(p, 'lib');
  const out = [...markers.values()];
  const results = inp.searchResults ?? [];
  if (results.length && inp.focusSearch) out.forEach((m) => (m.focus = false));
  results.forEach((r, i) => {
    out.push({ id: `${SEARCH_PREFIX}${i}`, lat: r.lat, lng: r.lng, kind: 'search', title: r.name, badges: [], areaCenter: false, focus: !!inp.focusSearch });
  });
  return { markers: out, lines };
}
