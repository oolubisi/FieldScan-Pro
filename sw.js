/*
 * FieldScan Pro service worker: makes the app work with no signal.
 *
 * Every file of a release is cached TOGETHER under one name derived from a
 * hash of their contents (BUILD, stamped by tools/stamp.js). A new release
 * installs its complete set before it takes over, so the app can never run
 * a mix of old and new files, and a half-finished update changes nothing.
 * Files are cache-first and fully offline once installed.
 */
const BUILD = "d1d790abd215";
const CACHE = "fsp-shell-" + BUILD;

// Strictly JSON (double quotes, no comments): tools/stamp.js and the tests read this list.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "css/design.css",
  "js/protocol.js",
  "js/db.js",
  "js/sync.js",
  "js/foldersync.js",
  "js/drive.js",
  "js/helpers.js",
  "js/calculators.js",
  "js/probe.js",
  "js/takeoff.js",
  "js/photoedit.js",
  "js/photos.js",
  "js/search.js",
  "js/home.js",
  "js/autosync.js",
  "js/syncchip.js",
  "js/safety.js",
  "js/tasks.js",
  "js/checklists.js",
  "js/dictation.js",
  "js/pdf.js",
  "js/report.js",
  "js/diary.js",
  "js/expenses.js",
  "js/inspections.js",
  "js/projects.js",
  "js/voice.js",
  "js/gallery.js",
  "js/prospects.js",
  "js/helpcontent.js",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

const SHELL = new URL("index.html", self.registration.scope).href;

/**
 * Fetches one precache URL, retrying a couple of times on a flaky connection
 * before giving up on it. Plain cache.addAll() has no retry at all: on a real
 * mobile connection, a single file timing out once aborts the ENTIRE install,
 * which on a phone's very first install (no earlier version to fall back to)
 * leaves it with nothing cached and unable to work offline at all. The install
 * as a whole is still all-or-nothing -- see below -- this just makes each
 * individual file's fetch resilient to a one-off hiccup before that applies.
 */
async function fetchOne(url, attempt = 1) {
  const req = new Request(url, { cache: "reload" });
  try {
    const res = await fetch(req);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return [req, res];
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      return fetchOne(url, attempt + 1);
    }
    throw e;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(PRECACHE.map((u) => fetchOne(u)))
      // Only once every file is actually in hand do we touch the cache, so a release
      // that still fails after retries changes nothing -- the previous version, if
      // any, stays in control exactly as before.
      .then(async (pairs) => {
        const cache = await caches.open(CACHE);
        await Promise.all(pairs.map(([req, res]) => cache.put(req, res)));
      })
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
