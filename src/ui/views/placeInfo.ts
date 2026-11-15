import type { Place } from '../../core/types';
import { esc } from '../util';
import { placePhotos } from '../../services/shopPhotos';

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
    ${p.links?.length ? `<div class="pinfo-links">${p.links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(linkLabel(u))}</a>`).join('')}</div>` : ''}
    <div class="pinfo-check">${pin ? `<a class="btn sm" href="${esc(pin)}" target="_blank" rel="noopener">📍 ดูหมุดนี้ใน Google Maps</a>` : '<span class="muted small">ยังไม่มีตำแหน่ง</span>'}<a class="btn sm ghost" href="${esc(gmapsNameUrl(p))}" target="_blank" rel="noopener">ค้นชื่อใน Google Maps</a></div>
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
