const CACHE_NAME = "fieldscan-pro-v43";
const urlsToCache = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./config.js",
  "./utils.js",
  "./branding.js",
  "./db.js",
  "./backup.js",
  "./api.js",
  "./payment-helpers.js",
  "./workorder-helpers.js",
  "./reports.js",
  "./layouts.js",
  "./search.js",
  "./accounts.js",
  "./modals.js",
  "./dashboard.js",
  "./console.js",
  "./changeorders.js",
  "./takeoff.js",
  "./tasks.js",
  "./undo.js",
  "./swipe.js",
  "./shortcuts.js",
  "./dragreorder.js",
  "./projecttrash.js",
  "./projectexport.js",
  "./help.js",
  "./inspections.js",
  "./clients.js",
  "./estimates.js",
  "./calculators.js",
  "./photos.js",
  "./documents.js",
  "./app.js",
  "./vendor/inter/inter.css",
  "./vendor/fontawesome/css/all.min.css",
  "./vendor/fontawesome/webfonts/fa-solid-900.woff2",
  "./vendor/fontawesome/webfonts/fa-regular-400.woff2",
  "./vendor/fontawesome/webfonts/fa-brands-400.woff2",
  "./vendor/html2canvas/html2canvas.min.js",
  "./vendor/jspdf/jspdf.umd.min.js",
  "./vendor/pdf-lib/pdf-lib.min.js",
  "./vendor/jszip/jszip.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each URL individually so one 404 doesn't kill the whole install
      return Promise.all(
        urlsToCache.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("SW: failed to cache", url, err);
          }),
        ),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Only the app's own same-origin assets should ever go through the
  // cache. Cross-origin requests -- Apps Script's exec/echo endpoints,
  // Drive, anything external -- must pass straight to the network,
  // untouched. Apps Script's "echo" redirect URL in particular is valid
  // for exactly one fetch; caching it (or matching a *different* echo
  // URL against it via ignoreSearch) breaks every subsequent request in
  // ways that show up as random 404s with no corresponding server error,
  // since the script itself ran fine -- the interference happens entirely
  // on the client afterward.
  if (requestUrl.origin !== self.location.origin) {
    return; // let the browser handle it normally, no respondWith at all
  }

  event.respondWith(
    // ignoreSearch is essential here: every JS/CSS file is requested with
    // a version query string (e.g. api.js?v=13) for cache-busting, but
    // that query string changes on every update while the precached entry
    // stays keyed by the bare path. Without ignoreSearch, every single
    // asset lookup silently misses the cache and falls through to the
    // network -- which is exactly what makes the whole app fail to start
    // offline, even though everything was actually precached correctly.
    caches.match(event.request, { ignoreSearch: true }).then((response) => {
      if (response) return response;
      return fetch(event.request)
        .then((networkResponse) => {
          // Opportunistically cache anything we successfully fetched but
          // didn't already have, so it's available next time offline too.
          if (networkResponse && networkResponse.ok && event.request.method === "GET") {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => {
          // Truly offline and not in cache. For a page navigation, the
          // app shell itself is the only sane fallback -- better to load
          // the app (even if a specific route needs data it doesn't have
          // yet) than show the browser's generic offline page.
          if (event.request.mode === "navigate") {
            return caches.match("./index.html", { ignoreSearch: true });
          }
        });
    }),
  );
});
