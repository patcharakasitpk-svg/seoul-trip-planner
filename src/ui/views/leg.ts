import type { LegInfo } from '../../core/schedule';
import type { RouteResult, TransitStep, TravelMode } from '../../core/types';
import { app } from '../app';
import { esc, gmapsDirUrl, kakaoToUrl, MODE_ICON, MODE_LABEL, naverBtn, naverRouteUrl } from '../util';
import { fmtDur } from '../../core/time';
import { fmtDist, roughEstimateMin, straightLineM } from '../../core/geo';
import { legTransitHint, lineChip } from './transit';

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

const SRC_TEXT: Record<string, string> = { user: 'กำหนดเอง', service: 'จาก Google', estimate: 'ประมาณ', auto: 'ประมาณจากระยะทาง', none: 'ยังไม่มีข้อมูล', same: '' };

/** เวลาเดินทางสั้น ๆ: "22 นาที" / "≈ 22 นาที" */
export function travelText(leg: LegInfo): string {
  return leg.travelMin != null ? `${leg.source === 'auto' || leg.source === 'estimate' ? '≈ ' : ''}${fmtDur(leg.travelMin)}` : 'ไม่ทราบเวลา';
}

/** ไปยังไง แบบบรรทัดเดียว: สายรถไฟ → สถานีปลายทาง ทางออก / เดิน / แท็กซี่ */
export function shortHow(leg: LegInfo): string {
  const from = app.getPlace(leg.fromId);
  const to = app.getPlace(leg.toId);
  if (leg.mode === 'WALKING') return 'เดิน';
  if (leg.mode === 'DRIVING') return 'แท็กซี่/รถ';
  const r = leg.route && leg.route.status === 'ok' ? leg.route : null;
  const tr = r?.steps.filter((x) => x.kind === 'transit') ?? [];
  if (tr.length) return tr.map((x) => `${esc(x.line ?? '')} → ${esc(x.toStop ?? '')}`).join(' · ');
  const d = straightDist(leg.fromId, leg.toId);
  if (d != null && d < 1200) return 'เดินได้';
  const sa = from?.transit?.stations?.[0];
  const sb = to?.transit?.stations?.[0];
  if (!sa || !sb) return 'รถไฟฟ้า/รถเมล์';
  if (sa.name === sb.name) return `เดินได้ (สถานี ${esc(sa.name)})`;
  const common = sa.lines.filter((l) => sb.lines.includes(l));
  const exit = sb.exit ? ` ทางออก ${esc(sb.exit)}` : '';
  return common.length ? `${lineChip(common[0])}→ ${esc(sb.name)}${exit}` : `${lineChip(sa.lines[0])}→ เปลี่ยน ${lineChip(sb.lines[0])}→ ${esc(sb.name)}${exit}`;
}

/** แถวเดินทางระหว่างจุด (แบบย่อ): ไปยังไง ใช้เวลาเท่าไร · รายละเอียด/กำหนดเองใน ⓘ */
export function legRow(dayId: string, leg: LegInfo, target: string): string {
  if (leg.source === 'same' && leg.fromId === leg.toId) return '';
  if (leg.reason?.startsWith('ยังไม่ได้เลือกร้าน')) return `<div class="leg slim pending"><span class="muted small">เลือกร้านก่อน จึงจะรู้ว่าเดินทางกี่นาที</span></div>`;
  if (!leg.fromId || !leg.toId) return '';
  const unknown = leg.travelMin == null;
  return `<div class="leg slim ${unknown ? 'missing' : ''}">
    <span class="leg-ico" aria-hidden="true">${MODE_ICON[leg.mode]}</span>
    <b class="leg-time">${travelText(leg)}</b>${leg.bufferMin ? `<span class="muted small">+ เผื่อ ${leg.bufferMin} นาที</span>` : ''}
    <span class="leg-how">${shortHow(leg)}</span>
    <button class="icon-btn sm info" data-act="leg-info" data-day="${dayId}" data-stop="${target}" aria-label="รายละเอียดการเดินทาง / กำหนดเอง">ⓘ</button>
  </div>`;
}

/** หน้าต่าง ⓘ ของการเดินทาง: เลือกวิธี กำหนดเวลาเอง เส้นทาง และเปิดแอปแผนที่ */
export function legInfoBody(dayId: string, leg: LegInfo, target: string): string {
  const from = app.getPlace(leg.fromId);
  const to = app.getPlace(leg.toId);
  const day = app.findDay(dayId);
  if (!from || !to || !day) return '<p>ไม่พบข้อมูลการเดินทาง</p>';
  const legObj = target === '__end' ? day.endLeg : day.stops.find((s) => s.uid === target)?.legIn;
  const dist = straightDist(leg.fromId, leg.toId);
  const est = dist != null ? roughEstimateMin(dist, leg.mode) : null;
  const r = leg.route && leg.route.status === 'ok' ? leg.route : null;
  return `
    <p class="leg-route"><b>${esc(from.nameTh)}</b> → <b>${esc(to.nameTh)}</b>${dist != null ? ` <span class="muted small">· ห่าง ${fmtDist(dist)} (เส้นตรง)</span>` : ''}</p>
    <div class="seg leg-modes" role="radiogroup" aria-label="วิธีเดินทาง">
      ${(['TRANSIT', 'WALKING', 'DRIVING'] as TravelMode[]).map((m) => `<button class="${leg.mode === m ? 'on' : ''}" data-act="leg-mode-set" data-day="${dayId}" data-stop="${target}" data-v="${m}" role="radio" aria-checked="${leg.mode === m}">${MODE_ICON[m]} ${MODE_LABEL[m]}</button>`).join('')}
    </div>
    <p class="leg-now">ใช้เวลา <b>${travelText(leg)}</b> <span class="pill">${SRC_TEXT[leg.source] ?? ''}</span></p>
    <label class="small leg-own">กำหนดเวลาเอง <input class="inp xs" type="number" min="0" inputmode="numeric" value="${leg.source === 'user' ? leg.travelMin : ''}" placeholder="${est ?? 'นาที'}" data-act-change="leg-manual" data-day="${dayId}" data-stop="${target}" aria-label="เวลาเดินทาง (นาที)"> นาที
      ${legObj?.manualMin != null ? `<button class="btn ghost xs" data-act="leg-clear" data-day="${dayId}" data-stop="${target}">ใช้ค่าอัตโนมัติ</button>` : ''}</label>
    ${leg.mode === 'TRANSIT' ? legTransitHint(from, to) : ''}
    ${r ? `<p class="small">${routeSummary(r)}</p>${r.steps.some((x) => x.kind === 'transit') ? stepsText(r.steps) : ''}` : ''}
    ${leg.mode === 'DRIVING' ? '<p class="muted small">รถยนต์: ไม่รวมเวลารอเรียกรถ และไม่ใช่ราคาแท็กซี่ที่ยืนยันแล้ว</p>' : ''}
    <div class="nav-row">
      ${naverBtn(naverRouteUrl(from, to), '🟢 Naver Map', 'btn')}
      <a class="btn" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(from, to, leg.mode))}">🧭 Google</a>
      ${kakaoToUrl(to) ? `<a class="btn" target="_blank" rel="noopener" href="${esc(kakaoToUrl(to)!)}">Kakao</a>` : ''}
    </div>
    <p class="muted small">Naver Map แม่นที่สุดในเกาหลี: สายรถเมล์ เวลารถมา ทางออกสถานี</p>
    ${app.settings.apiKey ? `<button class="btn ghost sm" data-act="leg-detail" data-day="${dayId}" data-stop="${target}">เทียบวิธีเดินทาง (Google)</button>` : ''}
    <div class="modal-actions"><button class="btn primary" data-act="modal-close">เสร็จ</button></div>`;
}
