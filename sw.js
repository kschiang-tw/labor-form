// 離線快取：第一次打開時把整個 app 存到裝置上，之後完全不需要網路。
// 這裡只快取 app 本身的檔案；個人資料存在 IndexedDB，不經過這裡。
// 每次更新 app 檔案時，請把 VERSION 改掉。
const VERSION = '2026-10-01.1';
const CACHE = `labor-form-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/docx.js',
  'js/parse.js',
  'js/numerals.js',
  'js/render.js',
  'js/pdf.js',
  'js/store.js',
  'js/images.js',
  'js/signature.js',
  'js/cropper.js',
  'vendor/fflate.js',
  'fonts/NotoSansTC-Regular.woff2',
  'fonts/NotoSansTC-Medium.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('labor-form-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const index = await cache.match('index.html');
        if (index) return index;
      }
      return fetch(req);
    })(),
  );
});
