/** โหลด Google Maps JavaScript API แบบ dynamic library import */
export type GoogleStatus = 'no-key' | 'loading' | 'ready' | 'error';

let status: GoogleStatus = 'no-key';
let error = '';
let loadPromise: Promise<boolean> | null = null;
const listeners: (() => void)[] = [];

export function googleStatus() {
  return { status, error };
}
export function onGoogleStatus(fn: () => void) {
  listeners.push(fn);
}
function set(s: GoogleStatus, e = '') {
  status = s;
  error = e;
  listeners.forEach((f) => f());
}

export function loadGoogle(apiKey: string | undefined): Promise<boolean> {
  if (!apiKey) {
    set('no-key');
    return Promise.resolve(false);
  }
  if (loadPromise) return loadPromise;
  set('loading');
  loadPromise = new Promise<boolean>((resolve) => {
    const w = window as any;
    w.gm_authFailure = () => {
      set('error', 'API Key ใช้ไม่ได้ (ตรวจ HTTP referrer / การเปิดใช้ API / Billing)');
      resolve(false);
    };
    w.__stpGoogleReady = () => {
      set('ready');
      resolve(true);
    };
    const p = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', callback: '__stpGoogleReady', language: 'th', region: 'KR' });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${p}`;
    s.async = true;
    s.onerror = () => {
      set('error', 'โหลด Google Maps ไม่สำเร็จ (ออฟไลน์หรือถูกบล็อก)');
      resolve(false);
    };
    document.head.append(s);
  });
  return loadPromise;
}

export function isGoogleReady() {
  return status === 'ready';
}
