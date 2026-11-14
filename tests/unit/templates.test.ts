import { describe, it, expect } from 'vitest';
import { TEMPLATES, applyDatedTemplate } from '../../src/data/templates';
import { PUBLIC_PLACES } from '../../src/data/places';
import { newPlan, tripDates } from '../../src/core/planOps';
import { closedOn } from '../../src/core/hours';

const ids = new Set(PUBLIC_PLACES.map((p) => p.id));

describe('แม่แบบ', () => {
  it('ทุกสถานที่ในแม่แบบมีอยู่จริงในข้อมูล', () => {
    for (const t of TEMPLATES)
      for (const d of t.days) {
        for (const s of d.stops) if (s.placeId) expect(ids.has(s.placeId), `${t.id}: ${s.placeId}`).toBe(true);
        for (const x of [d.startPlaceId, d.endPlaceId]) if (x) expect(ids.has(x), `${t.id}: ${x}`).toBe(true);
      }
  });

  const tpl = TEMPLATES.find((t) => t.dated)!;
  it('แผนแนะนำครอบคลุมทุกวันของทริป และไม่พาไปที่ปิดประจำสัปดาห์', () => {
    expect(tpl.days.map((d) => d.date)).toEqual(tripDates());
    for (const d of tpl.days)
      for (const s of d.stops) {
        const p = PUBLIC_PLACES.find((x) => x.id === s.placeId);
        if (p) expect(closedOn(p, d.date!), `${d.date} ${p.id}`).toBeNull();
      }
  });

  it('ใช้แผนแนะนำแล้วได้นัด COEX ที่ล็อกเวลา จุดเริ่ม/จบ และวันบินกลับไม่มีช่องมื้อเย็น', () => {
    const p = newPlan();
    applyDatedTemplate(p, tpl);
    const by = (date: string) => p.days.find((d) => d.date === date)!;
    expect(by('2026-11-30')).toMatchObject({ startPlaceId: 'icn', startTime: '08:00' });
    expect(by('2026-12-01').stops.find((s) => s.placeId === 'coex')?.lockedTime).toBe('13:00');
    expect(by('2026-12-03').stops[0]).toMatchObject({ placeId: 'coex', lockedTime: '09:00', stayMin: 480 });
    expect(by('2026-12-04').stops[0]).toMatchObject({ placeId: 'coex', stayMin: 540 });
    expect(by('2026-12-05').endPlaceId).toBe('novotel-suwon');
    const last = by('2026-12-06');
    expect(last).toMatchObject({ startPlaceId: 'novotel-suwon', endPlaceId: 'icn', endTime: '14:00' });
    expect(last.stops.some((s) => s.kind === 'dinner')).toBe(false);
    expect(by('2026-12-02').stops.find((s) => s.kind === 'dinner')?.placeId).toBe('yeonnam-mulgalbi-hongdae');
  });
});
