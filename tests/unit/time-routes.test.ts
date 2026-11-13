import { describe, it, expect } from 'vitest';
import { seoulNow, seoulDate, minsOnSeoulDate, fmtHM } from '../../src/core/time';
import { parseRoute, routeKey } from '../../src/services/routes';

describe('Asia/Seoul time', () => {
  it('ใช้เวลาโซล ไม่ใช่เขตเวลาเครื่อง', () => {
    expect(seoulNow(new Date('2026-11-13T15:30:00Z'))).toEqual({ date: '2026-11-14', mins: 30 });
    expect(seoulDate('2026-11-20', 18 * 60).toISOString()).toBe('2026-11-20T09:00:00.000Z');
    expect(minsOnSeoulDate(new Date('2026-11-20T15:10:00Z'), '2026-11-20')).toBe(24 * 60 + 10);
    expect(fmtHM(24 * 60 + 10)).toBe('00:10 (+1)');
  });
});

describe('routes', () => {
  it('key รวมวันที่และเวลาออก (ปัด 15 นาที) สำหรับ transit', () => {
    expect(routeKey('a', 'b', 'TRANSIT', '2026-11-20', 18 * 60 + 7)).toBe(routeKey('a', 'b', 'TRANSIT', '2026-11-20', 18 * 60 + 14));
    expect(routeKey('a', 'b', 'TRANSIT', '2026-11-20', 18 * 60 + 7)).not.toBe(routeKey('a', 'b', 'TRANSIT', '2026-11-20', 18 * 60 + 16));
    expect(routeKey('a', 'b', 'TRANSIT', '2026-11-20', 600)).not.toBe(routeKey('a', 'b', 'TRANSIT', '2026-11-21', 600));
  });
  it('แปลงผล Routes library เป็นขั้นตอนอ่านง่าย', () => {
    const r = parseRoute(
      {
        durationMillis: 38 * 60000,
        distanceMeters: 15200,
        localizedValues: { transitFare: '₩1,550' },
        path: [{ lat: 37.5, lng: 127 }, { lat: () => 37.56, lng: () => 126.98 }],
        legs: [
          {
            steps: [
              { travelMode: 'WALKING', staticDurationMillis: 4 * 60000, distanceMeters: 300 },
              { travelMode: 'TRANSIT', staticDurationMillis: 28 * 60000, distanceMeters: 14000, transitDetails: { transitLine: { shortName: '2', name: 'Line 2', vehicle: { name: 'Subway' } }, headsign: 'City Hall', departureStop: { name: 'Samseong' }, arrivalStop: { name: 'Euljiro 1-ga' }, departureTime: new Date('2026-11-20T09:05:00Z'), arrivalTime: new Date('2026-11-20T09:33:00Z'), stopCount: 14 } },
              { travelMode: 'WALKING', staticDurationMillis: 6 * 60000, distanceMeters: 400 },
            ],
          },
        ],
      },
      '2026-11-20',
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.durationMin).toBe(38);
    expect(r.walkMin).toBe(10);
    expect(r.transfers).toBe(0);
    expect(r.fareText).toBe('₩1,550');
    expect(r.departAt).toBe('18:05');
    expect(r.steps[1]).toMatchObject({ kind: 'transit', line: '2', headsign: 'City Hall', fromStop: 'Samseong', toStop: 'Euljiro 1-ga', departAt: '18:05', arriveAt: '18:33', stopCount: 14 });
    expect(r.path).toHaveLength(2);
  });
  it('ไม่มีระยะเวลา → error ไม่ใช่ 0 นาที', () => {
    expect(parseRoute({ legs: [] }, '2026-11-20').status).toBe('error');
  });
});
