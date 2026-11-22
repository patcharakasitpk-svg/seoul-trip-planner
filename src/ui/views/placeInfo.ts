import type { Place } from '../../core/types';
import { esc, IC, gmapsPlaceUrl, naverPlaceUrl, naverBtn, googleLabel, photosUrl } from '../util';
import { placePhotos } from '../../services/shopPhotos';
import { closedOn, shortHours } from '../../core/hours';
import { OWN_CATEGORY_LABEL, type OwnCategory } from '../../core/ownPlace';
import { lineChip } from './transit';
import { I, catIcon } from '../icons';

/** ลิงก์เปิดหมุดตามพิกัดใน Google Maps — ใช้เช็กว่าตำแหน่งที่วางไว้ตรงร้านจริงไหม */
export const gmapsPinUrl = (p: Place) => (p.lat != null && p.lng != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null);
/** ค้นชื่อใน Google Maps (เทียบกับหมุดที่วางไว้) */
export const gmapsNameUrl = (p: Place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.nameEn || p.nameTh)}`;

/** ชื่อสั้นของลิงก์: โดเมน (เช่น instagram.com) */
export function linkLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/google\.|goo\.gl/.test(h)) return 'Google Maps';
    if (/naver/.test(h)) return 'Naver';
    if (/instagram/.test(h)) return 'Instagram';
    if (/tiktok/.test(h)) return 'TikTok';
    if (/youtube|youtu\.be/.test(h)) return 'YouTube';
    return h;
  } catch {
    return 'ลิงก์';
  }
}

/** มีข้อมูลที่ผู้ใช้ใส่เอง (รูป/ลิงก์/โน้ต) ไหม */
export const hasOwnInfo = (p: Place | undefined) => !!p && !!p.custom && (!!p.photos?.length || !!p.links?.length || !!p.notes);

/** รูป + ลิงก์ + โน้ต + ปุ่มเช็กหมุด ของสถานที่ที่เพิ่มเอง (อ่านอย่างเดียว) */
export function placeInfoHtml(p: Place, opts: { photoAct?: string } = {}): string {
  const pin = gmapsPinUrl(p);
  const photos = p.photos ?? [];
  return `<div class="pinfo">
    ${p.notes ? `<p class="pinfo-note">${esc(p.notes)}</p>` : ''}
    ${
      photos.length
        ? `<div class="pinfo-photos">${photos
            .map((id, i) =>
              opts.photoAct
                ? `<button class="pinfo-ph" data-pp="${opts.photoAct}" data-place="${esc(p.id)}" data-i="${i}" aria-label="ดูรูปที่ ${i + 1}"><img data-pphoto="${esc(id)}" alt=""></button>`
                : `<span class="pinfo-ph"><img data-pphoto="${esc(id)}" alt=""></span>`,
            )
            .join('')}</div>`
        : ''
    }
    ${p.links?.length ? `<div class="pinfo-links">${p.links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${IC.link}<span>${esc(linkLabel(u))}</span></a>`).join('')}</div>` : ''}
    <div class="pinfo-check">${pin ? `<a class="btn sm btn-ico" href="${esc(pin)}" target="_blank" rel="noopener">${IC.pin}<span>ดูหมุดนี้ใน Google Maps</span></a>` : '<span class="muted small">ยังไม่มีตำแหน่ง</span>'}<a class="btn sm ghost" href="${esc(gmapsNameUrl(p))}" target="_blank" rel="noopener">ค้นชื่อใน Google Maps</a></div>
  </div>`;
}

const CAT_SHORT: Record<string, string> = { ...OWN_CATEGORY_LABEL, base: 'จุดหลัก' };

/**
 * แผ่นรายละเอียดสถานที่แบบอ่านอย่างเดียว (หน้า "วันนี้" / แผนของฉัน) — เรียบ ๆ อ่านบนมือถือง่าย
 * รูป → ข้อมูลสั้น (ประเภท · ย่าน · เวลาเปิด) → เหตุผล/โน้ต → เมนู/งบ → สถานีใกล้สุด → ลิงก์ → ปุ่มเปิดแผนที่
 */
export function placeSheetHtml(p: Place, date: string | null): string {
  const photos = p.photos ?? [];
  const cat = p.food?.type === 'cafe' ? OWN_CATEGORY_LABEL.cafe : (CAT_SHORT[p.category as OwnCategory] ?? '');
  const hrs = shortHours(p);
  const closed = closedOn(p, date);
  const meta = [cat, p.area, hrs ? `เปิด ${hrs}` : null].filter(Boolean).map((x) => esc(String(x))).join(' · ');
  const text = p.custom ? p.notes : p.reasonTh;
  const facts = [
    p.food?.menu?.length ? `<li><span>เมนู</span><span>${p.food.menu.slice(0, 3).map(esc).join(', ')}</span></li>` : '',
    p.budget?.textTh ? `<li><span>งบ</span><span>${esc(p.budget.textTh)}</span></li>` : '',
    p.hours?.lastOrder ? `<li><span>รอบสุดท้าย</span><span>${esc(p.hours.lastOrder)}</span></li>` : '',
    p.transit?.stations?.[0] ? ((st) => `<li><span>สถานี</span><span>${st.lines.map(lineChip).join('')} ${esc(st.name)}${st.exit ? ` · ทางออก ${esc(st.exit)}` : ''}${st.walkMin != null ? ` · เดิน ~${st.walkMin} นาที` : ''}</span></li>`)(p.transit.stations[0]) : '',
  ].join('');
  return `<div class="psheet">
    ${photos.length ? `<div class="psheet-photos">${photos.map((id) => `<span class="psheet-ph"><img data-pphoto="${esc(id)}" alt=""></span>`).join('')}</div>` : ''}
    <p class="psheet-meta"><span class="cat-ico" aria-hidden="true">${catIcon(p.category, p.food?.type)}</span>${meta || 'สถานที่'}</p>
    ${closed ? `<p class="psheet-warn">${I.alert} ${esc(closed)}</p>` : ''}
    ${text ? `<p class="psheet-text">${esc(text)}</p>` : ''}
    ${facts ? `<ul class="psheet-facts">${facts}</ul>` : ''}
    ${p.links?.length ? `<div class="pinfo-links">${p.links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${IC.link}<span>${esc(linkLabel(u))}</span></a>`).join('')}</div>` : ''}
    <div class="psheet-nav">
      ${naverBtn(naverPlaceUrl(p), undefined, 'btn')}
      <a class="btn app-btn google" href="${esc(p.custom && p.lat != null ? gmapsPinUrl(p)! : gmapsPlaceUrl(p))}" target="_blank" rel="noopener">${googleLabel('Google')}</a>
      ${!photos.length && p.category !== 'base' ? `<a class="btn" href="${esc(photosUrl(p))}" target="_blank" rel="noopener" aria-label="ดูรูปใน Google" title="ดูรูป">${IC.camera}</a>` : ''}
    </div>
  </div>`;
}

/** ใส่รูปจริงให้ <img data-pphoto> (อ่านจาก IndexedDB) · รูปที่ไม่มีในเครื่องนี้ (เช่นส่งแผนมาจากเครื่องอื่น) แสดงเป็นช่องว่าง */
export function hydratePlacePhotos(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img[data-pphoto]').forEach((img) => {
    if (img.src) return;
    void placePhotos.photoUrl(img.dataset.pphoto!).then((u) => {
      if (u) img.src = u;
      else img.parentElement?.classList.add('missing');
    });
  });
}
