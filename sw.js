// 오프라인에서도 열리도록 앱 파일과 본문을 저장해 둔다.
// 앱을 수정해서 다시 올릴 때는 아래 CACHE 이름의 숫자를 올려야 기기에 새 버전이 반영된다.
const CACHE = 'bibleflip-v28';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'lib/page-flip.browser.js',
  'data/krv.json',
  'fonts/nanum-myeongjo.woff2',
  'fonts/gowun-batang.woff2',
  'fonts/gowun-dodum.woff2',
  'fonts/nanum-gothic.woff2',
  'fonts/nanum-myeongjo-bold.woff2',
  'fonts/gowun-batang-bold.woff2',
  'fonts/nanum-gothic-bold.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request))
  );
});
