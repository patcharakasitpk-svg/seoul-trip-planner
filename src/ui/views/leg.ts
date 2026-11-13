import type { LegInfo } from '../../core/schedule';
import type { RouteResult, TransitStep, TravelMode } from '../../core/types';
import { app } from '../app';
import { esc, gmapsDirUrl, kakaoToUrl, MODE_ICON, MODE_LABEL, SOURCE_LABEL } from '../util';
import { fmtDur } from '../../core/time';
import { fmtDist, roughEstimateMin, straightLineM } from '../../core/geo';

export function straightDist(fromId: string | null, toId: string | null): number | null {
  const a = app.getPlace(fromId);
  const b = app.getPlace(toId);
  if (a?.lat == null || b?.lat == null) return null;
  return straightLineM({ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! });
}

export function stepsText(steps: TransitStep[]): string {
  if (!steps.length) return '';
  return `<ol class="steps">${steps
    .map((s) => {
      if (s.kind === 'walk') return `<li>🚶 เดิน ${fmtDur(s.durationMin)}${s.distanceM ? ` (${fmtDist(s.distanceM)})` : ''}</li>`;
      if (s.kind === 'transit')
        return `<li>${s.vehicle && /bus|버스|รถเมล์/i.test(s.vehicle) ? '🚌' : '🚇'} <b>${esc(s.vehicle ?? '')} ${esc(s.line ?? 'ไม่ทราบสาย')}</b>${s.headsign ? ` ทิศ ${esc(s.headsign)}` : ''}<br>
          ขึ้นที่ <b>${esc(s.fromStop ?? 'ไม่ทราบ')}</b>${s.departAt ? ` ${s.departAt}` : ''} → ลงที่ <b>${esc(s.toStop ?? 'ไม่ทราบ')}</b>${s.arriveAt ? ` ${s.arriveAt}` : ''}${s.stopCount != null ? ` · ${s.stopCount} ป้าย/สถานี` : ''}</li>`;
      return `<li>${esc(s.instruction ?? 'ช่วงอื่น')} ${fmtDur(s.durationMin)}</li>`;
    })
    .join('')}</ol><p class="muted small">หมายเลขทางออกสถานี: ไม่ทราบ (บริการไม่ได้ระบุ) — ตรวจป้ายในสถานี</p>`;
}

export function routeSummary(r: RouteResult & { status: 'ok' }): string {
  const parts = [
    r.departAt ? `ออก ${r.departAt}` : null,
    r.arriveAt ? `ถึง ${r.arriveAt}` : null,
    r.distanceM != null ? `ระยะตามเส้นทาง ${fmtDist(r.distanceM)}` : null,
    r.walkMin != null ? `เดินรวม ${fmtDur(r.walkMin)}` : null,
    r.transfers != null ? `เปลี่ยนสาย ${r.transfers} ครั้ง` : null,
    r.fareText ? `ค่าโดยสาร ${esc(r.fareText)}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** แถวการเดินทางระหว่างจุด (target = stop uid หรือ '__end') */
export function legRow(dayId: string, leg: LegInfo, target: string, opts: { compact?: boolean } = {}): string {
  if (leg.source === 'same' && leg.fromId === leg.toId) return `<div class="leg same"><span class="muted small">อยู่จุดเดิม — ไม่มีการเดินทาง</span></div>`;
  const from = app.getPlace(leg.fromId);
  const to = app.getPlace(leg.toId);
  const dist = straightDist(leg.fromId, leg.toId);
  const r = leg.route && leg.route.status === 'ok' ? leg.route : null;
  const manualVal = leg.source === 'user' ? leg.travelMin : '';
  const est = dist != null ? roughEstimateMin(dist, leg.mode) : null;
  const day = app.findDay(dayId)!;
  const stop = day.stops.find((s) => s.uid === target);
  const legObj = target === '__end' ? day.endLeg : stop?.legIn;
  return `
  <div class="leg src-${leg.source}">
    <div class="leg-main">
      <select class="inp xs mode" data-act-change="leg-mode" data-day="${dayId}" data-stop="${target}" aria-label="วิธีเดินทาง">
        ${(['TRANSIT', 'WALKING', 'DRIVING'] as TravelMode[]).map((m) => `<option value="${m}" ${leg.mode === m ? 'selected' : ''}>${MODE_ICON[m]} ${MODE_LABEL[m]}</option>`).join('')}
      </select>
      <b class="leg-time">${leg.travelMin != null ? fmtDur(leg.travelMin) : 'ไม่ทราบเวลา'}</b>
      ${leg.bufferMin ? `<span class="pill">+ เผื่อ ${leg.bufferMin} นาที</span>` : ''}
      <span class="pill src ${leg.source}">${SOURCE_LABEL[leg.source]}</span>
    </div>
    ${r ? `<div class="small">${routeSummary(r)}</div>` : ''}
    ${leg.reason ? `<div class="small warn-text">${esc(leg.reason)}</div>` : ''}
    ${leg.mode === 'DRIVING' ? `<div class="muted small">เวลารถยนต์ไม่รวมเวลารอเรียกรถ และไม่ใช่ราคาแท็กซี่ที่ยืนยันแล้ว</div>` : ''}
    ${dist != null && !opts.compact ? `<div class="muted small">ระยะเส้นตรง ${fmtDist(dist)} (ไม่ใช่ระยะเดินทางจริง)</div>` : ''}
    ${opts.compact ? '' : `
    <div class="leg-tools">
      <label class="small">กรอกเวลาเอง <input class="inp xs" type="number" min="0" step="1" value="${manualVal ?? ''}" placeholder="นาที" data-act-change="leg-manual" data-day="${dayId}" data-stop="${target}" aria-label="เวลาเดินทางที่กรอกเอง (นาที)"></label>
      ${legObj?.manualMin != null ? `<button class="btn ghost xs" data-act="leg-clear" data-day="${dayId}" data-stop="${target}">ล้างค่าที่กรอก</button>` : ''}
      ${leg.source === 'none' && est != null && leg.fromId && leg.toId ? `<button class="btn ghost xs" data-act="leg-estimate" data-day="${dayId}" data-stop="${target}" data-v="${est}">ใช้ค่าประมาณ ~${est} นาที</button>` : ''}
      ${from && to ? `<button class="btn ghost xs" data-act="leg-detail" data-day="${dayId}" data-stop="${target}">เทียบวิธีเดินทาง</button>
      <a class="btn ghost xs" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(from, to, leg.mode))}">Google Maps ↗</a>` : ''}
      ${to && kakaoToUrl(to) ? `<a class="btn ghost xs" target="_blank" rel="noopener" href="${esc(kakaoToUrl(to)!)}">KakaoMap ↗</a>` : ''}
    </div>
    ${r && r.steps.some((s) => s.kind === 'transit') ? `<details><summary class="small">ขั้นตอนการเดินทาง</summary>${stepsText(r.steps)}</details>` : ''}`}
  </div>`;
}
