// Service worker: แคชไฟล์ของแอปเพื่อเปิดดูแผนที่บันทึกไว้ได้เมื่อออฟไลน์
// ไม่แคชคำขอ Google Maps / Open-Meteo (ข้อมูลออนไลน์จะแจ้งว่าอัปเดตไม่ได้)
const CACHE = 'stp-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
