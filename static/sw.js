/**
 * BeatDrop Service Worker v2.6.1
 * Handles robust offline caching, PWA background sync shell, and asset management for desktop & mobile devices.
 */

const CACHE_NAME = 'beatdrop-v2.6.1';

// Same-origin core app shell assets (safe for addAll)
const LOCAL_CORE_ASSETS = [
  '/',
  '/manifest.json',
  '/static/css/style.css',
  '/static/js/main.js',
  '/static/images/beatdrop-icon.svg',
  '/static/images/pwa-icon-192.png',
  '/static/images/pwa-icon-512.png'
];

// External assets cached opportunistically
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Installation event: Pre-cache local app shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(LOCAL_CORE_ASSETS);
      } catch (err) {
        console.warn('[ServiceWorker] Local pre-cache warning:', err);
      }

      // Pre-cache external CDNs without failing install if offline/CORS blocked
      EXTERNAL_ASSETS.forEach((url) => {
        fetch(url, { mode: 'cors' })
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(url, res);
            }
          })
          .catch(() => {});
      });
    })
  );
});

// Activation event: Purge old cache versions & claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[ServiceWorker] Purging legacy cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event handler: Stale-while-revalidate for assets, Network-first for API & navigation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests, non-HTTP(S) protocols, and SSE streams
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http') || url.pathname.startsWith('/api/download')) {
    return;
  }

  // Handle API dynamic requests (Network First)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are currently offline. Connect to streaming server.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Handle navigation requests (Network First with fallback, NEVER throw or return Response.error())
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/');
          if (cachedIndex) return cachedIndex;

          return new Response(
            `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>BeatDrop | Offline</title><style>body{background:#0b0d17;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:1.5rem;}.card{background:rgba(17,24,39,0.8);border:1px solid rgba(255,255,255,0.1);padding:2rem;border-radius:1rem;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.5);}h2{color:#6366f1;margin-top:0;}p{color:#cbd5e1;font-size:0.95rem;line-height:1.5;}button{background:#6366f1;color:#fff;border:none;padding:0.75rem 1.5rem;border-radius:0.75rem;font-size:1rem;font-weight:600;cursor:pointer;margin-top:1rem;transition:background 0.2s;}button:hover{background:#4f46e5;}</style></head><body><div class="card"><h2>BeatDrop</h2><p>Connecting to server... If your Render server was sleeping, please wait a few seconds and tap retry.</p><button onclick="location.reload()">Retry Connection</button></div></body></html>`,
            { headers: { 'Content-Type': 'text/html' }, status: 200 }
          );
        })
    );
    return;
  }

  // Static Assets: Stale-While-Revalidate Strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
