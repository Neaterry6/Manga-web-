/* ============================================================
   MangaVerse — Service Worker (offline cache + install)
   ============================================================ */
const CACHE = "mv-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/styles.css",
  "/css/mobile-redesign.css",
  "/js/api.js",
  "/js/app.js",
  "/js/auth.js",
  "/js/cloud.js",
  "/js/data.js",
  "/js/social.js",
  "/js/translate.js",
  "/worker.js"
];

// Install: cache core assets
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache first, fallback to network
self.addEventListener("fetch", e => {
  // Skip non-GET, API calls, and data URIs
  if (e.request.method !== "GET" ||
      e.request.url.includes("api.mangadex") ||
      e.request.url.includes("graphql.anilist") ||
      e.request.url.startsWith("data:") ||
      e.request.url.startsWith("blob:")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      // Cache successful responses
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => new Response("Offline", { status: 503 })))
  );
});
