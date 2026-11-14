/**
 * รูปของที่จะซื้อ — เก็บใน IndexedDB ของเครื่องนี้ (localStorage เล็กเกินสำหรับรูป)
 * ย่อรูปก่อนเก็บ: ด้านยาวไม่เกิน 640px, JPEG ~0.78 → ราว 40–80KB ต่อรูป
 */
const DB = 'stp-shop';
const STORE = 'photos';
export const PHOTO_MAX_PX = 640;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const urls = new Map<string, string>();

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  await tx('readwrite', (s) => s.put(blob, id));
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  urls.delete(id);
}

/** object URL ของรูป (แคชไว้ ไม่สร้างใหม่ทุกครั้งที่เรนเดอร์) */
export async function photoUrl(id: string): Promise<string | null> {
  const c = urls.get(id);
  if (c) return c;
  try {
    const b = await tx<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  } catch {
    return null;
  }
}

export async function photoIds(): Promise<string[]> {
  try {
    return (await tx('readonly', (s) => s.getAllKeys())).map(String);
  } catch {
    return [];
  }
}

export async function deletePhotos(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await tx('readwrite', (s) => s.delete(id));
    } catch {
      /* ข้าม */
    }
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.delete(id);
  }
}

/** ขนาดใหม่ที่คงสัดส่วน ด้านยาวไม่เกิน max (ไม่ขยายรูปเล็ก) */
export function fitSize(w: number, h: number, max = PHOTO_MAX_PX): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** ย่อรูปเป็น JPEG (หมุนตาม EXIF โดย createImageBitmap/เบราว์เซอร์) */
export async function resizeImage(file: Blob): Promise<Blob> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    src = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('อ่านรูปไม่ได้'));
      img.src = URL.createObjectURL(file);
    });
  }
  const { w, h } = fitSize(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('ย่อรูปไม่ได้');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('ย่อรูปไม่ได้'))), 'image/jpeg', 0.78));
}
