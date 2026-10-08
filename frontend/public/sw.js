/* Road Trip Planner service worker (Phase 17).
 *
 * - App shell and static assets: cache-first.
 * - Trip data GETs (trip, itinerary, weather, navigation, recap, ...): network-first with a
 *   cache fallback, so a saved trip still renders with no signal.
 * - Page documents under /trips: network-first, cached for offline navigation.
 * - Anything cross-origin is never touched, so Google Maps tiles are never cached (Google's
 *   terms forbid it); the app shows a "map unavailable offline" panel instead.
 *
 * Private data lands in Cache Storage, so the page asks this worker to wipe it on logout.
 */
const VERSION = "v1";
const STATIC = `rtp-static-${VERSION}`;
const API = `rtp-api-${VERSION}`;
const PAGES = `rtp-pages-${VERSION}`;
const KEEP = [STATIC, API, PAGES];
const NETWORK_TIMEOUT_MS = 4000;

// /api/trips/<id>[/itinerary|weather|navigation|recap|photos|budget|expenses|packing]
const TRIP_DATA = /^\/api\/trips\/[^/]+(\/(itinerary|weather|navigation|recap|photos|budget|expenses|packing))?$/;
const STATIC_ASSET = /^\/(_next\/static\/|icon-|apple-touch-icon)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("rtp-") && !KEEP.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) cache.put(request.url, response.clone());
    return response;
  } catch (err) {
    clearTimeout(timer);
    const cached = await cache.match(request.url);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache Google Maps or other origins

  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (TRIP_DATA.test(url.pathname)) {
    event.respondWith(networkFirst(request, API));
  } else if (request.mode === "navigate" && url.pathname.startsWith("/trips")) {
    event.respondWith(networkFirst(request, PAGES));
  }
});

// The page can ask us to pre-cache documents (and the scripts/styles they reference) so a
// trip opens offline even on routes the user hasn't visited yet.
async function precachePages(urls) {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) continue;
      const html = await response.clone().text();
      await pages.put(new URL(url, self.location.origin).href, response);
      const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css)/g) || []);
      await Promise.all(
        [...assets].map(async (asset) => {
          if (await statics.match(asset)) return;
          try {
            const r = await fetch(asset);
            if (r.ok) await statics.put(asset, r);
          } catch {
            /* a missing chunk only costs us that chunk */
          }
        })
      );
    } catch {
      /* offline or failing: skip this page */
    }
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "cache-pages" && Array.isArray(data.urls)) {
    event.waitUntil(precachePages(data.urls));
  } else if (data.type === "clear-private") {
    event.waitUntil(Promise.all([caches.delete(API), caches.delete(PAGES)]));
  }
});
