/* ==========================================================================
   $LGL Miner — Service Worker
   --------------------------------------------------------------------------
   Strategy:
     • App shell (HTML, CSS, JS, icons) — cache-first, so the interface opens
       instantly and works offline.
     • Navigations — network-first with an offline fallback to the cached shell,
       so a new deploy is picked up quickly without breaking offline use.
     • Anything that looks like an API/session request — NEVER cached.

   Bump CACHE_VERSION on every release to invalidate old caches.
   ========================================================================== */

const CACHE_VERSION = 'lgl-miner-v1.2.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/** Core app shell — must be available offline. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/admin.js',
  './js/admin-store.js',
  './js/android.js',
  './js/zip.js',
  './js/config.js',
  './js/store.js',
  './js/ui.js',
  './js/icons.js',
  './js/mining.js',
  './js/tasks.js',
  './js/referrals.js',
  './js/airdrop.js',
  './js/profile.js',
  './js/pwa.js',
  './js/feedback.js',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
];

/* --------------------------------------------------------------------------
   Install — pre-cache the shell.
   -------------------------------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll rejects the whole batch if one asset 404s, so add individually.
      .then((cache) => Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] skipped', url, err)),
        ),
      ))
      .then(() => self.skipWaiting()),
  );
});

/* --------------------------------------------------------------------------
   Activate — drop caches from previous versions.
   -------------------------------------------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

/* --------------------------------------------------------------------------
   Fetch
   -------------------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only. Never intercept third-party requests.
  if (url.origin !== self.location.origin) return;

  // NEVER cache API / session / auth responses. These may be personalised and
  // must always reflect the server's current state.
  if (isSensitivePath(url.pathname)) return;

  // Navigations: network-first with offline fallback to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: cache-first, then network with runtime caching.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Only cache successful, basic (same-origin) responses.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      }).catch(() => {
        // Offline and uncached: let the browser handle it.
        return Response.error();
      });
    }),
  );
});

/**
 * Paths that must never be written to the cache.
 * Extend this list as the production API is added.
 */
function isSensitivePath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/session') ||
    pathname.includes('/token') ||
    pathname.includes('/claim')
  );
}

/* --------------------------------------------------------------------------
   Messages — allow the page to trigger an immediate update.
   -------------------------------------------------------------------------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
