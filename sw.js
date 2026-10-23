/* Offline support: the app shell is cached on first visit, procedures and cycles are refreshed when online. */
const VERSION = 'tpr-v1';
const SHELL = ['./', 'index.html', 'app.css', 'js/util.js', 'js/store.js', 'js/sensors.js', 'js/steps.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'procedures/index.json', 'cycles/udds.json', 'cycles/nycc.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const dataFile = url.origin === location.origin && /\/(procedures|cycles)\//.test(url.pathname);
  if (dataFile) {
    // Network first so edited procedures arrive; fall back to the cached copy at the track.
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // Cache first for the app shell and fonts.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  })));
});
