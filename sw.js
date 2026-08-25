// Two builds are served from this file and they want opposite things.
//
// The public web build wants a cache, so the app opens without a signal. The
// host app wants none at all: it serves every file off the phone the browser
// is running on, so a copy buys nothing and costs everything. It cost an
// evening once - a worker registered by one build served that build forever,
// including an index.html too old to contain the code that would remove it,
// so every fix was measured against a stale app.
//
// So this worker asks the origin what it is rather than trusting whichever
// page registered it, and on a host-app origin it deletes its caches and
// unregisters itself. Whichever build installed it, it dies as soon as it
// wakes.

const VERSION = '1.3.0';
const CACHE_NAME = `pocketeers-${VERSION}`;

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './css/fonts/fredoka-600-latin.woff2',
    './js/core/constants.js',
    './js/core/storage.js',
    './js/core/audio.js',
    './js/core/renderer.js',
    './js/core/input.js',
    './js/core/particles.js',
    './js/core/hub.js',
    './js/core/net.js',
    './js/core/multiplayer.js',
    './js/core/hostphone.js',
    './js/core/qr.js',
    './js/core/qrcode-generator.js',
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

// The host app answers /host/status on loopback and refuses it with 403 to a
// guest on the hotspot. Either way the endpoint exists, which is the question
// being asked. A static web host has no such path, so 404 - or no answer at
// all, when the phone is offline - means the public build.
async function servedByHostApp() {
    try {
        const response = await fetch('./host/status', { cache: 'no-store' });
        return response.status !== 404;
    } catch (_) {
        return false;
    }
}

async function selfDestruct() {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    // Reload every tab this worker was answering, so they stop running
    // whatever build it was holding.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        if (await servedByHostApp()) return self.skipWaiting();
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(ASSETS);
        return self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        if (await servedByHostApp()) return selfDestruct();
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

// Network first, cache only as a fallback. Cache-first with no revalidation is
// how a shipped fix appears to have done nothing: the phone keeps serving the
// build it already has and never finds out there is another one.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    // Hosting state changes while the page is watching it. A cached answer
    // here freezes the Wi-Fi step on whatever the phone said first.
    if (new URL(request.url).pathname.includes('/host/')) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response && response.ok && response.type === 'basic') {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
        } catch (_) {
            const cached = await caches.match(request);
            if (cached) return cached;
            if (request.mode === 'navigate') {
                const index = await caches.match('./index.html');
                if (index) return index;
            }
            throw new Error('offline and not cached');
        }
    })());
});
