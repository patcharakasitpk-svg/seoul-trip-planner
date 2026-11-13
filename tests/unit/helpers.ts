import type { Day, Place, RouteResult, TravelMode } from '../../src/core/types';
import type { ScheduleCtx } from '../../src/core/schedule';
import { newDay, newStop } from '../../src/core/planOps';

export const P = (id: string, lat: number | null, lng: number | null, extra: Partial<Place> = {}): Place => ({
  id, nameTh: id, nameEn: id, category: 'sight', area: 'x', lat, lng, coordStatus: lat == null ? 'unverified' : 'verified', reasonTh: '', suggestedStayMin: 60, indoor: true, sources: [], ...extra,
});

export const places: Record<string, Place> = {
  hotel: P('hotel', 37.562, 126.979, { kind: 'hotel', category: 'base' }),
  coex: P('coex', 37.5118, 127.0592, { kind: 'venue', category: 'base' }),
  a: P('a', 37.56, 126.98),
  b: P('b', 37.57, 127.0),
  c: P('c', 37.55, 126.92),
  shop: P('shop', 37.5641, 126.9851, { openTime: '10:00', closeTime: '22:00' }),
  nocoord: P('nocoord', null, null),
};

/** ตารางเวลาเดินทางจำลอง (นาที) ต่อ from>to>mode; ไม่มี = ไม่มีข้อมูล */
export function ctxWith(table: Record<string, number>, calls: string[] = []): ScheduleCtx {
  return {
    getPlace: (id) => places[id],
    getRoute: (from, to, mode: TravelMode, date, dep): RouteResult | undefined => {
      calls.push(`${from}>${to}>${mode}@${dep}`);
      const v = table[`${from}>${to}>${mode}`] ?? table[`${from}>${to}`];
      if (v == null) return undefined;
      return { status: 'ok', durationMin: v, distanceM: null, walkMin: null, transfers: null, fareText: null, departAt: null, arriveAt: null, steps: [], path: null };
    },
  };
}

export function day(stops: [string, number][], extra: Partial<Day> = {}): Day {
  return newDay({
    date: '2026-11-20', startPlaceId: 'hotel', startTime: '09:00', endPlaceId: 'hotel', endTime: '22:00', bufferMin: 0,
    stops: stops.map(([id, stay]) => newStop('place', id, stay)),
    ...extra,
  });
}
