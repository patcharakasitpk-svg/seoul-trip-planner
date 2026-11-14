import { app } from '../app';
import { esc, gmapsDirUrl, kakaoToUrl, MODE_ICON, MODE_LABEL, photosUrl, naverBtn, naverRouteUrl } from '../util';
import { fmtDateTh, fmtDur, fmtHM, seoulNow } from '../../core/time';
import { renderWeather } from './weather';
import { routeSummary, stepsText } from './leg';

export function renderToday(): string {
  const now = seoulNow();
  const todayDay = app.plan.days.find((d) => d.date === now.date);
  const day = todayDay ?? app.day;
  const idx = app.dayIndex(day.id);
  const s = app.schedule(day);
  const isToday = !!todayDay;
  // จุดถัดไป: รายการแรกที่ยังไม่ออก (ถ้าเป็นวันนี้) หรือรายการแรก
  const active = s.stops.filter((t) => !t.stop.skipped);
  let nextIdx = 0;
  if (isToday) {
    nextIdx = active.findIndex((t) => t.depart == null || t.depart > now.mins);
    if (nextIdx < 0) nextIdx = active.length; // เหลือช่วงกลับ
  }
  const next = active[nextIdx];
  const prevLocId = nextIdx > 0 ? active[nextIdx - 1].stop.placeId ?? day.startPlaceId : day.startPlaceId;
  const prevPlace = app.getPlace(prevLocId);
  let nextHtml = '';
  if (next) {
    const p = app.getPlace(next.stop.placeId);
    const r = next.leg.route && next.leg.route.status === 'ok' ? next.leg.route : null;
    nextHtml = `<section class="card next">
      <p class="eyebrow">จุดถัดไป</p>
      <h2>${esc(p?.nameTh ?? next.stop.title ?? (next.stop.kind === 'dinner' ? 'มื้อเย็น — ยังไม่ได้เลือกร้าน' : 'รายการ'))}</h2>
      <p class="big-time">${next.arrive != null ? `ถึง ${next.lowerBound ? '≥' : ''}${fmtHM(next.arrive)}` : 'ยังไม่มีเวลา'}${next.stop.lockedTime ? ` · 🔒 นัด ${esc(next.stop.lockedTime)}` : ''}</p>
      <p>${MODE_ICON[next.leg.mode]} ${MODE_LABEL[next.leg.mode]} · ${next.leg.travelMin != null ? fmtDur(next.leg.travelMin) : 'ไม่ทราบเวลาเดินทาง'}${next.leg.source === 'none' ? ' <span class="pill src none">ยังไม่มีข้อมูล</span>' : ''}</p>
      ${r ? `<p class="small">${routeSummary(r)}</p>${stepsText(r.steps)}` : ''}
      ${next.warnings.length ? `<ul class="warns">${next.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${p ? `<div class="nav-btns">
        <a class="btn primary big" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(null, p, next.leg.mode))}">🧭 นำทางจากตำแหน่งปัจจุบัน</a>
        ${prevPlace ? `<a class="btn" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(prevPlace, p, next.leg.mode))}">เส้นทางจาก ${esc(prevPlace.nameTh)}</a>` : ''}
        ${naverBtn(naverRouteUrl(null, p), '🟢 Naver Map (รถเมล์/รถไฟ จากตรงนี้)', 'btn')}
        ${kakaoToUrl(p) ? `<a class="btn" target="_blank" rel="noopener" href="${esc(kakaoToUrl(p)!)}">KakaoMap</a>` : ''}
        <a class="btn" target="_blank" rel="noopener" href="${esc(photosUrl(p))}">📷 ดูรูปหน้าร้าน</a>
      </div>` : ''}
    </section>`;
  }
  const end = app.getPlace(day.endPlaceId);
  const lastLoc = active.length ? (active[active.length - 1].stop.placeId ?? prevLocId) : day.startPlaceId;
  const lastPlace = app.getPlace(lastLoc);
  const returnHtml = end
    ? `<section class="card">
      <p class="eyebrow">ช่วงกลับ</p>
      <h3>กลับ ${esc(end.nameTh)}</h3>
      <p>${s.end?.arrive != null ? `ถึง ${s.end.lowerBound ? '≥' : ''}${fmtHM(s.end.arrive)}` : 'ยังไม่มีเวลา'}${s.end?.slackMin != null ? (s.end.slackMin >= 0 ? ` · <span class="ok-text">เหลือ ${fmtDur(s.end.slackMin)}</span>` : ` · <span class="bad-text">เกิน ${fmtDur(-s.end.slackMin)}</span>`) : s.end?.lowerBound ? ' · <span class="warn-text">ยังสรุปไม่ได้ว่าทัน</span>' : ''}</p>
      <div class="nav-btns"><a class="btn primary" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(null, end, day.endLeg.mode))}">🧭 นำทางกลับจากตำแหน่งปัจจุบัน</a>${naverBtn(naverRouteUrl(null, end), '🟢 Naver Map', 'btn')}
      ${lastPlace && lastPlace.id !== end.id ? `<a class="btn" target="_blank" rel="noopener" href="${esc(gmapsDirUrl(lastPlace, end, day.endLeg.mode))}">จาก ${esc(lastPlace.nameTh)}</a>` : ''}</div>
    </section>`
    : '';
  const upcoming = active.slice(nextIdx + 1);
  return `
    <div class="today-head">
      <h2>วันนี้ · ${esc(fmtDateTh(now.date))}</h2>
      <p class="muted small">เวลาในโซลตอนนี้ ${fmtHM(now.mins)} (Asia/Seoul)</p>
      ${isToday ? `<p>ตามแผน <b>วัน ${idx + 1}</b></p>` : `<p class="notice">วันนี้ไม่มีในแผน — แสดง <b>วัน ${idx + 1}</b> (${esc(fmtDateTh(day.date))}) แทน</p>`}
      ${!app.online ? '<p class="notice warn">ออฟไลน์ — แสดงแผนที่บันทึกไว้ แผนที่ออนไลน์ เส้นทาง และอากาศยังอัปเดตไม่ได้</p>' : ''}
    </div>
    ${nextHtml || (active.length ? '' : '<p class="empty">วันนี้ยังไม่มีจุดแวะ</p>')}
    ${upcoming.length ? `<section class="card"><p class="eyebrow">ต่อจากนั้น</p><ol class="mini-tl">${upcoming.map((t) => `<li>${t.arrive != null ? (t.lowerBound ? '≥' : '') + fmtHM(t.arrive) : '--:--'} ${esc(app.getPlace(t.stop.placeId)?.nameTh ?? t.stop.title ?? (t.stop.kind === 'dinner' ? 'มื้อเย็น (ยังไม่เลือกร้าน)' : t.stop.kind))}</li>`).join('')}</ol></section>` : ''}
    ${returnHtml}
    ${renderWeather(day, s, { full: false })}
    <button class="btn block-btn" data-act="tab" data-tab="plan">แก้แผนวันนี้</button>`;
}
