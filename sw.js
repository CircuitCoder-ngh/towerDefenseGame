/* ZERO//DAY service worker: offline play via cache, stale-while-revalidate. */
const VERSION = 'zeroday-v1.0.0';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/engine/atlas.js',
  'js/engine/audio.js',
  'js/engine/save.js',
  'js/engine/util.js',
  'js/data/enemies.js',
  'js/data/maps.js',
  'js/data/towers.js',
  'js/data/waves.js',
  'js/game/enemy.js',
  'js/game/fx.js',
  'js/game/game.js',
  'js/game/map.js',
  'js/game/rain.js',
  'js/game/tower.js',
  'js/ui/ui.js',
  'assets/sprites.png',
  'assets/sprites.json',
  'assets/fonts/VT323-Regular.ttf',
  'assets/fonts/PressStart2P-Regular.ttf',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
