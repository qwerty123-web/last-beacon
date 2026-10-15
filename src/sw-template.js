/* LAST BEACON service worker (generated at build time from src/sw-template.js).
 * - Precaches the app shell, JS/CSS, fonts, manifest, icons and the offline map extract.
 * - Same-origin GET requests: cache first, then network (and refresh the cache).
 * - Navigations: network first with a short timeout, fall back to the cached shell (works offline).
 * - Third-party map tiles are deliberately NOT cached (tile providers restrict offline/bulk caching).
 */
const VERSION = '__VERSION__';
const CACHE = `last-beacon-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('last-beacon-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles and other third-party requests go straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 3500);
          const res = await fetch(req, { signal: ctl.signal });
          clearTimeout(t);
          const c = await caches.open(CACHE);
          c.put('./', res.clone());
          return res;
        } catch {
          const c = await caches.open(CACHE);
          return (await c.match('./')) || (await c.match('index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});
