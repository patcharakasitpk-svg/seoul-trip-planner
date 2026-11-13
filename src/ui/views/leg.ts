import type { LegInfo } from '../../core/schedule';
import type { RouteResult, TransitStep, TravelMode } from '../../core/types';
import { app } from '../app';
import { esc, gmapsDirUrl, kakaoToUrl, MODE_ICON, MODE_LABEL } from '../util';
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
          ขึ้น <b>${esc(s.fromStop ?? 'ไม่ทราบ')}</b>${s.departAt ? ` ${s.departAt}` : ''} → ลง <b>${esc(s.toStop ?? 'ไม่ทราบ')}</b>${s.arriveAt ? ` ${s.arriveAt}` : ''}${s.stopCount != null ? ` · ${s.stopCount} ป้าย` : ''}</li>`;
      return `<li>${esc(s.instruction ?? 'ช่วงอื่น')} ${fmtDur(s.durationMin)}</li>`;
    })
    .join('')}</ol><p class="muted small">หมายเลขทางออกสถานี: ไม่ทราบ (บริการไม่ระบุ)</p>`;
}

export function routeSummary(r: RouteResult & { status: 'ok' }): string {
  return [
    r.departAt ? `ออก ${r.departAt}` : null,
    r.arriveAt ? `ถึง ${r.arriveAt}` : null,
    r.distanceM != null ? `${fmtDist(r.distanceM)}` : null,
    r.walkMin != null ? `เดิน ${fmtDur(r.walkMin)}` : null,
    r.transfers != null ? `เปลี่ยน ${r.transfers} ครั้ง` : null,
    r.fareText ? esc(r.fareText) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const SRC_TEXT: Record<string, string> = { user: 'กรอกเอง', service: 'จากบริการ', estimate: 'ประมาณ', none: 'ยังไม่มีข้อมูล', same: '' };

/** แถวเดินทางระหว่างจุด (target = stop uid หรือ '__end') */
export function legRow(dayId: string, leg: LegInfo, target: string): string {
  if (leg.source === 'same' && leg.fromId === leg.toId) return '';
  const from = app.getPlace(leg.fromId);
  const to = app.getPlace(leg.toId);
  const key = `leg:${target}`;
  const open = app.expanded.has(key);
  const r = leg.route && leg.route.status === 'ok' ? leg.route : null;
  const missing = leg.source === 'none';
  const canFill = missing && !!leg.fromId && !!leg.toId;
  const day = app.findDay(dayId)!;
  const legObj = target === '__end' ? day.endLeg : day.stops.find((s) => s.uid === target)?.legIn;
  const dist = straightDist(leg.fromId, leg.toId);
  const est = dist != null ? roughEstimateMin(dist, leg.mode) : null;
  const gm = from && to ? gmapsDirUrl(from, to, leg.mode) : null;

  const main = canFill
    ? `<span class="leg-ico">${MODE_ICON[leg.mode]}</span>
       <label class="leg-fill"><input class="inp xs" type="number" min="0" inputmode="numeric" placeholder="กี่นาที" data-act-change="leg-manual" data-day="${dayId}" data-stop="${target}" aria-label="เวลาเดินทาง (นาที)"> นาที</label>
       ${gm ? `<a class="link small" target="_blank" rel="noopener" href="${esc(gm)}">ดูใน Google Maps ↗</a>` : ''}`
    : missing
      ? `<span class="leg-ico">${MODE_ICON[leg.mode]}</span><span class="muted small">${esc(leg.reason ?? 'ยังไม่มีข้อมูล')}</span>`
      : `<span class="leg-ico">${MODE_ICON[leg.mode]}</span><b>${fmtDur(leg.travelMin)}</b>${leg.bufferMin ? `<span class="muted small">+ เผื่อ ${leg.bufferMin} นาที</span>` : ''}<span class="src ${leg.source}">${SRC_TEXT[leg.source]}</span>`;

  return `
  <div class="leg ${missing ? 'missing' : ''}">
    <div class="leg-line">
      ${main}
      ${from && to ? `<button class="icon-btn sm" data-act="toggle-leg" data-stop="${target}" aria-expanded="${open}" aria-label="ตัวเลือกการเดินทาง">${open ? '▴' : '⋯'}</button>` : ''}
    </div>
    ${
      open
        ? `<div class="leg-more">
      <label class="small">วิธีเดินทาง
        <select class="inp xs" data-act-change="leg-mode" data-day="${dayId}" data-stop="${target}">
          ${(['TRANSIT', 'WALKING', 'DRIVING'] as TravelMode[]).map((m) => `<option value="${m}" ${leg.mode === m ? 'selected' : ''}>${MODE_ICON[m]} ${MODE_LABEL[m]}</option>`).join('')}
        </select></label>
      <label class="small">เวลาเดินทาง <input class="inp xs" type="number" min="0" value="${leg.source === 'user' ? leg.travelMin : ''}" placeholder="นาที" data-act-change="leg-manual" data-day="${dayId}" data-stop="${target}"> นาที</label>
      ${r ? `<p class="small">${routeSummary(r)}</p>${r.steps.some((s) => s.kind === 'transit') ? stepsText(r.steps) : ''}` : ''}
      ${leg.mode === 'DRIVING' ? '<p class="muted small">รถยนต์: ไม่รวมเวลารอเรียกรถ และไม่ใช่ราคาแท็กซี่ที่ยืนยันแล้ว</p>' : ''}
      ${dist != null ? `<p class="muted small">ระยะเส้นตรง ${fmtDist(dist)} (ไม่ใช่ระยะเดินทางจริง)</p>` : ''}
      <div class="row-btns">
        ${gm ? `<a class="btn xs" target="_blank" rel="noopener" href="${esc(gm)}">Google Maps ↗</a>` : ''}
        ${to && kakaoToUrl(to) ? `<a class="btn xs" target="_blank" rel="noopener" href="${esc(kakaoToUrl(to)!)}">KakaoMap ↗</a>` : ''}
        <button class="btn xs" data-act="leg-detail" data-day="${dayId}" data-stop="${target}">เทียบวิธีเดินทาง</button>
        ${missing && est != null ? `<button class="btn ghost xs" data-act="leg-estimate" data-day="${dayId}" data-stop="${target}" data-v="${est}">ใช้ค่าประมาณ ~${est} นาที</button>` : ''}
        ${legObj?.manualMin != null ? `<button class="btn ghost xs" data-act="leg-clear" data-day="${dayId}" data-stop="${target}">ล้างค่าที่กรอก</button>` : ''}
      </div>
    </div>`
        : ''
    }
  </div>`;
}
