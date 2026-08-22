// Bump this on every deploy. The fetch handler below is cache-first with no
// revalidation, so an installed phone serves stale JS indefinitely until the
// cache name changes - which is exactly how a shipped fix can appear to have
// done nothing.
const CACHE_NAME = 'pocketeers-v6';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/core/constants.js',
    './js/core/storage.js',
    './js/core/audio.js',
    './js/core/renderer.js',
    './js/core/input.js',
    './js/core/particles.js',
    './js/core/hub.js',
    './js/core/net.js',
    './js/core/multiplayer.js',
    './js/games/index.js',
    './js/games/amazing-maze.js',
    './js/games/secret-passage.js',
    './js/games/pachinko.js',
    './js/games/derby.js',
    './js/games/target-range.js',
    './js/games/baseball.js',
    './js/games/pocket-slot.js',
    './js/games/racing-pigs.js',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => {
                    if (event.request.mode === 'navigate') return caches.match('./index.html');
                });
        })
    );
});
