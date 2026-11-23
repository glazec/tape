/* Tape offline support.
 *
 * Privacy rule: never cache HTML pages or API responses. Meeting content is
 * private and a shared device must not show it after sign out. Only hashed
 * build assets, icons and the offline screen are stored.
 */
const TAPE_CACHE_VERSION = "v1";
const TAPE_STATIC_CACHE = `tape-static-${TAPE_CACHE_VERSION}`;
const TAPE_SHELL_CACHE = `tape-shell-${TAPE_CACHE_VERSION}`;
const TAPE_OFFLINE_URL = "/offline.html";
const TAPE_PRECACHE = [
  TAPE_OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/brand/tape-mark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(TAPE_SHELL_CACHE)
      .then((cache) => cache.addAll(TAPE_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([TAPE_STATIC_CACHE, TAPE_SHELL_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("tape-") && !keep.has(key))
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

// Build assets carry a content hash, so a cached copy is always correct.
function isHashedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

// Brand files keep their names across releases: serve fast, refresh behind.
function isBrandAsset(url) {
  return url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/");
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(TAPE_STATIC_CACHE);
  // Search every Tape cache: the offline screen's icons are precached in the
  // shell cache and must resolve with no network.
  const cached = await caches.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(event.request, response.clone());
      }
      return response;
    })
    .catch(() => cached || Response.error());
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

// Old deploys leave hashed chunks behind; keep the newest entries only so
// small mobile quotas (iOS) never fill up.
const TAPE_STATIC_LIMIT = 250;

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= TAPE_STATIC_LIMIT) return;
  await Promise.all(
    keys.slice(0, keys.length - TAPE_STATIC_LIMIT).map((key) => cache.delete(key)),
  );
}

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(TAPE_STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    event.waitUntil(cache.put(request, response.clone()).then(() => trimCache(cache)));
  }
  return response;
}

async function networkWithOfflineFallback(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(TAPE_OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflineFallback(event));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(event));
  } else if (isBrandAsset(url)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
