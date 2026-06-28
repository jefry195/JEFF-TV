const CACHE_NAME = 'jefftv-cache-v4.2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// Install Service Worker
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Interceptor
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Dynamic caching for large IPTV lists (Stale-While-Revalidate style)
  const isIPTVAPI = url.hostname.includes('iptv-org') || 
                    url.pathname.includes('channels.json') || 
                    url.pathname.includes('streams.json') ||
                    url.pathname.includes('.m3u');

  if (isIPTVAPI) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(e.request).then(cachedResponse => {
          const fetchPromise = fetch(e.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(err => {
            console.warn('[SW] Fetch failed, fallback to cache:', err);
          });

          // Return cache if exists, otherwise wait for network
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Cache-first for standard local assets
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
