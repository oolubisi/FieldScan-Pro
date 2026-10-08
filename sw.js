/*
 * FieldScan Pro service worker: makes the app work with no signal.
 *
 * Every file of a release is cached TOGETHER under one name derived from a
 * hash of their contents (BUILD, stamped by tools/stamp.js). A new release
 * installs its complete set before it takes over, so the app can never run
 * a mix of old and new files, and a half-finished update changes nothing.
 * Files are cache-first and fully offline once installed.
 */
const BUILD = "53b27de8998d";
const CACHE = "fsp-shell-" + BUILD;

// Strictly JSON (double quotes, no comments): tools/stamp.js and the tests read this list.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/protocol.js",
  "js/db.js",
  "js/sync.js",
  "js/foldersync.js",
  "js/helpers.js",
  "js/calculators.js",
  "js/probe.js",
  "js/takeoff.js",
  "js/photoedit.js",
  "js/photos.js",
  "js/search.js",
  "js/home.js",
  "js/autosync.js",
  "js/safety.js",
  "js/tasks.js",
  "js/checklists.js",
  "js/dictation.js",
  "js/report.js",
  "js/diary.js",
  "js/inspections.js",
  "js/projects.js",
  "js/helpcontent.js",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

const SHELL = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: "reload" bypasses the browser's HTTP cache, so a new release can't
      // precache a stale copy of a file that was changed a few minutes ago.
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf("fsp-shell-") === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(respond(req));
});

async function respond(req) {
  const cache = await caches.open(CACHE);
  if (req.mode === "navigate") {
    const shell = await cache.match(SHELL);
    if (shell) return shell;
    try { return await fetch(req); } catch (e) { return offlineResponse(); }
  }
  const hit = await cache.match(req);
  if (hit) return hit;
  try { return await fetch(req); } catch (e) { return new Response("", { status: 504, statusText: "Offline" }); }
}

function offlineResponse() {
  return new Response(
    "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:24px'><h2>Offline</h2><p>Open FieldScan Pro once while you have signal so it can save itself to this phone.</p>",
    { status: 503, headers: { "Content-Type": "text/html" } },
  );
}
