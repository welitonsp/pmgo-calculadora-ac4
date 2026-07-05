/* Service Worker — Calculadora AC4
   Estratégia: network-first para o app shell (atualizações chegam rápido),
   com fallback ao cache quando offline. */
const CACHE = 'ac4-v24';
const SHELL = [
  './',
  './index.html',
  './css/styles.css?v=24',
  './js/app.js?v=24',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' ignora o cache HTTP e busca direto do servidor,
      // evitando misturar versões de HTML e JS/CSS.
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((resp) => {
        // guarda cópia atualizada de recursos do próprio site
        if (resp.ok && new URL(request.url).origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return resp;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
