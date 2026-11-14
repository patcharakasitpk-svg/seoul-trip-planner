import type { Place } from '../../core/types';
import { LINES } from '../../data/subway';
import { esc, gmapsDirUrl } from '../util';
import { fmtDist, straightLineM } from '../../core/geo';

export function lineChip(code: string): string {
  const l = LINES[code];
  return `<span class="line-chip" style="--lc:${l?.color ?? '#6b7280'}" title="${esc(l?.th ?? code)}">${esc(l?.label ?? code)}</span>`;
}

/** สถานีใกล้สถานที่ (สำหรับหน้า ⓘ) */
export function stationBlock(p: Place, from: Place | undefined): string {
  const t = p.transit;
  const rows = t?.stations?.length
    ? t.stations
        .map(
          (s) => `<li>${s.lines.map(lineChip).join('')} <b>${esc(s.name)}</b>${s.exit ? ` · ทางออก ${esc(s.exit)}` : ''}${s.walkMin != null ? ` · เดิน ~${s.walkMin} นาที` : ''}</li>`,
        )
        .join('')
    : '';
  const link = from && from.id !== p.id ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(from, p, 'TRANSIT'))}">🚇 วิธีไปจาก${esc(from.id === 'hotel' ? 'โรงแรม' : from.nameTh)} (รถไฟฟ้า/รถเมล์) ↗</a>` : '';
  return `<div class="transit-block">
      <p class="small"><b>รถไฟฟ้า</b></p>
      ${rows ? `<ul class="stations">${rows}</ul>` : '<p class="small muted">ยังไม่มีข้อมูลสถานี</p>'}
      ${t?.bus ? `<p class="small">🚌 ${esc(t.bus)}</p>` : ''}
      ${t && t.status !== 'verified' ? '<p class="small muted">ข้อมูลสถานียังไม่ยืนยัน</p>' : ''}
      ${link}
    </div>`;
}

/** สรุปการเดินทางระหว่าง 2 จุดจากข้อมูลสถานี (ไม่ใช่เส้นทางจากบริการ) */
export function legTransitHint(a: Place | undefined, b: Place | undefined): string {
  if (!a || !b || a.lat == null || b.lat == null) return '';
  const d = straightLineM({ lat: a.lat, lng: a.lng! }, { lat: b.lat, lng: b.lng! });
  if (d < 700) return `<div class="transit-hint">🚶 ใกล้กัน เดินได้ (≈ ${fmtDist(d)})</div>`;
  const sa = a.transit?.stations?.[0];
  const sb = b.transit?.stations?.[0];
  const link = `<a class="link small" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(a, b, 'TRANSIT'))}">เส้นทางละเอียด ↗</a>`;
  if (!sa || !sb) return `<div class="transit-hint">🚇 ${link}</div>`;
  if (sa.name === sb.name) return `<div class="transit-hint">🚶 ใช้สถานีเดียวกัน (${esc(sa.name)}) เดินได้ · ${link}</div>`;
  const common = sa.lines.filter((l) => sb.lines.includes(l));
  const exitB = sb.exit ? ` ทางออก ${esc(sb.exit)}` : '';
  if (common.length) {
    return `<div class="transit-hint">${lineChip(common[0])} ${esc(sa.name)} → ${esc(sb.name)}${exitB} · ไม่ต้องเปลี่ยนสาย · ${link}</div>`;
  }
  return `<div class="transit-hint">${sa.lines.map(lineChip).join('')} ${esc(sa.name)} → <span class="muted">เปลี่ยนสาย</span> → ${sb.lines.map(lineChip).join('')} ${esc(sb.name)}${exitB} · ${link}</div>`;
}
