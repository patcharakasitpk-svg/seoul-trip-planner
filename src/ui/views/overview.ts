import type { Day } from '../../core/types';
import type { StopTiming } from '../../core/schedule';
import { app } from '../app';
import { dayColor, dayDate, esc } from '../util';
import { mealName } from '../../core/meals';
import { fmtDur, fmtHM, seoulNow } from '../../core/time';
import { tripIssues } from '../../core/planOps';

/**
 * หน้า "แผนของฉัน": ดูอย่างเดียว — ทุกวันเรียงกัน แต่ละวันมีสีของตัวเอง (สีเดียวกับหมุดบนแผนที่)
 * แก้ไขทั้งหมดทำในหน้า "จัดแผน"
 */

const shortPlace = (id: string | null) => {
  const p = app.getPlace(id);
  if (!p) return '?';
  return p.id === 'hotel' ? 'โรงแรม' : p.id === 'icn' ? 'สนามบินอินชอน T1' : p.id === 'novotel-suwon' ? 'Novotel ซูวอน' : p.nameTh;
};

function stopLine(t: StopTiming): string {
  const s = t.stop;
  const p = app.getPlace(s.placeId);
  const name = p ? (p.id === 'hotel' ? 'โรงแรม' : p.nameTh) : s.kind === 'dinner' ? `${mealName(s)} — ยังไม่เลือกร้าน` : s.title ?? 'พัก';
  const meal = s.kind === 'dinner' && p ? `<span class="ov-meal">${esc(mealName(s))}</span>` : '';
  const warn = t.lateMin ? `สาย ${fmtDur(t.lateMin)}` : t.warnings.find((w) => w.startsWith('ปิด')) ?? '';
  return `<li class="${s.kind === 'dinner' && !p ? 'ov-empty' : ''}">
    <span class="ov-t">${t.arrive != null ? `${t.lowerBound ? '≥' : ''}${fmtHM(t.arrive)}` : ''}</span>
    <span class="ov-n">${meal}${esc(name)}${s.lockedTime ? ` <span class="ov-lock">นัด ${esc(s.lockedTime)}</span>` : ''}${s.note ? `<small>${esc(s.note)}</small>` : ''}${warn ? `<small class="bad-text">${esc(warn)}</small>` : ''}</span>
  </li>`;
}

function dayCard(d: Day, i: number): string {
  const s = app.schedule(d);
  const c = dayColor(i);
  const today = d.date === seoulNow().date;
  const stops = s.stops.filter((t) => !t.stop.skipped);
  const end = s.end;
  const endText =
    end?.arrive != null
      ? `${end.lowerBound ? '≥' : ''}${fmtHM(end.arrive)}`
      : '';
  const late = end?.slackMin != null && end.slackMin < 0 ? `<small class="bad-text">เกิน ${esc(d.endTime ?? '')} ${fmtDur(-end.slackMin)}</small>` : '';
  const sel = app.mapFilter === 'day' && app.activeDayId === d.id;
  return `<article class="ov-day ${sel ? 'sel' : ''}" style="--c:${c}" data-day-card="${d.id}">
    <header class="ov-head">
      <button class="ov-date" data-act="map-day" data-day="${d.id}" aria-label="ดู ${esc(dayDate(d))} บนแผนที่">
        <b>${esc(dayDate(d))}</b>${today ? '<span class="ov-today">วันนี้</span>' : ''}
        <span class="muted">วัน ${i + 1}${d.startTime ? ` · ${esc(d.startTime)}–${esc(d.endTime ?? '')}` : ''}</span>
      </button>
      <button class="btn sm" data-act="edit-day" data-day="${d.id}">แก้</button>
    </header>
    ${
      stops.length
        ? `<ol class="ov-list">
      <li class="ov-end"><span class="ov-t">${esc(d.startTime ?? '')}</span><span class="ov-n">ออกจาก ${esc(shortPlace(d.startPlaceId))}</span></li>
      ${stops.map(stopLine).join('')}
      ${d.endPlaceId ? `<li class="ov-end"><span class="ov-t">${endText}</span><span class="ov-n">ถึง ${esc(shortPlace(d.endPlaceId))}${late}</span></li>` : ''}
    </ol>`
        : `<p class="ov-none muted">ยังไม่มีแผน — กด “แก้” เพื่อจัดแผนวันนี้</p>`
    }
  </article>`;
}

function tripNotice(): string {
  const issues = tripIssues(app.plan);
  if (!issues.length) return '';
  return `<div class="notice trip ov-trip"><ul>${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><button class="btn sm primary" data-act="apply-trip-dates">แก้ให้ตรงทริป</button><span class="muted small">รายการที่จัดไว้ไม่หาย · เลิกทำได้</span></div>`;
}

export function renderPlanOverview(): string {
  return `
    ${tripNotice()}
    <div class="ov-wrap">${app.plan.days.map(dayCard).join('')}</div>`;
}
