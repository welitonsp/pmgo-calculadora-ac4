/* Service Worker — Calculadora AC4
   Estratégia: network-first para o app shell (atualizações chegam rápido),
   com fallback ao cache quando offline. */
const CACHE = 'ac4-v50';
const SHELL = [
  './',
  './index.html',
  './css/styles.css?v=50',
  './js/app.js?v=50',
  './js/theme.js?v=50',
  // módulos importados sem query string (resolvidos pelo import de app.js)
  './js/modules/formato.mjs',
  './js/modules/calculo.mjs',
  './js/modules/agenda.mjs',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/inter-latin-ext.woff2',
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
  // Terceiros (analytics, etc.) seguem direto para a rede, sem interceptação.
  if (new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return resp;
      })
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          // Fallback de index só para navegação — devolver HTML no lugar
          // de CSS/JS quebraria a página.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
