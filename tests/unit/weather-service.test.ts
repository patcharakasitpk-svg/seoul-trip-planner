import { describe, it, expect, vi } from 'vitest';
import { ensureWeather, getWeather, buildUrl } from '../../src/services/weather';

describe('weather service', () => {
  it('ขอข้อมูลด้วย timezone=Asia/Seoul และใช้แคช ไม่เรียกซ้ำ', async () => {
    expect(buildUrl(37.5663, 126.9779)).toMatch(/timezone=Asia%2FSeoul/);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ utc_offset_seconds: 32400, hourly: { time: [] }, daily: { time: [] } }) }));
    await ensureWeather(37.11, 127.11, false, fetchMock as any);
    await ensureWeather(37.11, 127.11, false, fetchMock as any);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWeather(37.11, 127.11)!.status).toBe('ok');
    await ensureWeather(37.11, 127.11, true, fetchMock as any);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('ปฏิเสธข้อมูลที่ไม่ใช่เวลาเกาหลี', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ utc_offset_seconds: 0, hourly: { time: [] }, daily: { time: [] } }) }));
    await ensureWeather(36.0, 128.0, false, fetchMock as any);
    expect(getWeather(36.0, 128.0)!.status).toBe('error');
  });
  it('HTTP error จากผู้ให้บริการแสดงเป็น error', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: 'out of range' }) }));
    await ensureWeather(35.0, 129.0, false, fetchMock as any);
    const st = getWeather(35.0, 129.0)!;
    expect(st.status === 'error' && st.message).toBe('out of range');
  });
});
