// Run: node tests/sw.test.js
// Executes the real sw.js in a sandbox with an in-memory CacheStorage and network.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readPrecache } = require("../tools/stamp.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");

const ROOT = path.join(__dirname, "..");
const SW_SOURCE = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const PRECACHE = readPrecache(SW_SOURCE);
const BASE = "https://example.test/app/";
const abs = (p) => new URL(p, BASE).href;

// ----- in-memory browser pieces -----
class FakeCache {
  constructor() { this.map = new Map(); }
  async match(req) { const hit = this.map.get(typeof req === "string" ? req : req.url); return hit ? hit.clone() : undefined; }
  async put(req, res) { this.map.set(typeof req === "string" ? req : req.url, res.clone()); }
  async addAll(reqs) {
    const done = [];
    for (const r of reqs) {
      const res = await fakeFetchFor(this.network)(r);
      if (!res.ok) throw new TypeError(`addAll: ${r.url} -> ${res.status}`);
      done.push([r.url, res]);
    }
    done.forEach(([u, res]) => this.map.set(u, res.clone())); // all-or-nothing, like the real thing
  }
}
function makeCaches(network) {
  const store = new Map();
  return {
    store,
    async open(name) { if (!store.has(name)) { const c = new FakeCache(); c.network = network; store.set(name, c); } return store.get(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
}
function fakeFetchFor(network) {
  return async (req) => {
    network.requests.push({ url: req.url, cache: req.cache });
    if (!network.online) throw new TypeError("Failed to fetch");
    const body = network.files[req.url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  };
}

function loadServiceWorker({ network, caches, build }) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    registration: { scope: BASE },
    location: { origin: "https://example.test" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { calls.claim++; return Promise.resolve(); } },
  };
  // relative URLs resolve against the worker's own address, as in a real browser
  const RelativeRequest = function (input, init) { return new Request(new URL(input, BASE + "sw.js").href, init); };
  const source = build ? SW_SOURCE.replace(/const BUILD = "[0-9a-f]{12}";/, `const BUILD = "${build}";`) : SW_SOURCE;
  vm.runInNewContext(source, { self, caches, fetch: fakeFetchFor(network), Request: RelativeRequest, Response, URL, Promise, console });
  const dispatch = async (type, event) => {
    let pending = Promise.resolve();
    event.waitUntil = (p) => { pending = p; };
    listeners[type](event);
    await pending;
    return event;
  };
  return {
    calls,
    install: () => dispatch("install", {}),
    activate: () => dispatch("activate", {}),
    // resolves to the Response the worker answers with, or "not handled" if it let the browser deal with it
    async fetch(req) {
      let answered;
      const event = { request: req, respondWith: (p) => { answered = p; } };
      listeners.fetch(event);
      return answered ? answered : "not handled";
    },
  };
}

const siteFiles = () => Object.fromEntries(PRECACHE.map((f) => [abs(f === "./" ? "./" : f), `content of ${f}`]));
const nav = (url) => ({ method: "GET", url, mode: "navigate", headers: new Headers() });
const get = (url) => ({ method: "GET", url, mode: "cors", headers: new Headers() });

(async () => {
  const buildOf = /const BUILD = "([0-9a-f]{12})"/.exec(SW_SOURCE)[1];

  section("Install: the whole release is cached together");
  {
    const network = { online: true, files: siteFiles(), requests: [] };
    const caches = makeCaches(network);
    const sw = loadServiceWorker({ network, caches });
    await sw.install();
    const names = await caches.keys();
    check(names.length === 1 && names[0] === "fsp-shell-" + buildOf, "one cache named for this build: " + names);
    const cache = await caches.open(names[0]);
    check(cache.map.size === PRECACHE.length, `all ${PRECACHE.length} files cached, got ${cache.map.size}`);
    check(PRECACHE.every((f) => cache.map.has(abs(f))), "every listed file is in the cache");
    check(network.requests.length === PRECACHE.length && network.requests.every((r) => r.cache === "reload"), "files were fetched past the browser's HTTP cache (so a fresh release can't cache a stale file)");
    check(sw.calls.skipWaiting === 1, "the new worker takes over straight away");
    console.log("Confirmed: " + PRECACHE.length + " files cached under " + names[0] + ", fetched fresh, worker activates immediately");
  }

  section("Install: if any file can't be fetched, nothing changes");
  {
    const network = { online: true, files: siteFiles(), requests: [] };
    delete network.files[abs("js/app.js")]; // one file 404s
    const caches = makeCaches(network);
    const sw = loadServiceWorker({ network, caches });
    let failed = false;
    try { await sw.install(); } catch (e) { failed = true; }
    check(failed, "a failed install is reported (so the browser keeps the previous version)");
    const cache = await caches.open("fsp-shell-" + buildOf);
    check(cache.map.size === 0, "and no half-installed set is left behind");
    check(sw.calls.skipWaiting === 0, "the broken release never takes over");
    console.log("Confirmed: a missing file means the update is refused, with nothing half-cached");
  }

  section("Serving: works completely offline");
  {
    const network = { online: true, files: siteFiles(), requests: [] };
    const caches = makeCaches(network);
    const sw = loadServiceWorker({ network, caches });
    await sw.install();
    await sw.activate();
    network.online = false; // lose signal
    network.requests.length = 0;

    let res = await sw.fetch(nav(BASE));
    check((await res.text()) === "content of index.html", "opening the app offline shows the app");
    res = await sw.fetch(nav(BASE + "index.html?utm=x#/sync"));
    check((await res.text()) === "content of index.html", "a link with extra bits on it still opens the app offline");
    res = await sw.fetch(get(abs("js/app.js")));
    check((await res.text()) === "content of js/app.js", "scripts load offline");
    res = await sw.fetch(get(abs("icons/icon-192.png")));
    check(res.status === 200, "icons load offline");
    check(network.requests.length === 0, "none of that touched the network");

    res = await sw.fetch(get(abs("js/not-a-real-file.js")));
    check(res.status === 504, "a file that was never cached fails cleanly while offline");
    network.online = true;
    network.requests.length = 0;
    await sw.fetch(get(abs("js/app.js")));
    check(network.requests.length === 0, "cached files are served without waiting on the network, even when online");
    console.log("Confirmed: app, scripts and icons all load with no signal; nothing waits on the network");
  }

  section("Serving: leaves everything else alone");
  {
    const network = { online: true, files: siteFiles(), requests: [] };
    const caches = makeCaches(network);
    const sw = loadServiceWorker({ network, caches });
    await sw.install();
    check((await sw.fetch({ method: "POST", url: abs("js/app.js"), mode: "cors", headers: new Headers() })) === "not handled", "non-GET requests are not touched");
    check((await sw.fetch(get("https://other.example/x.js"))) === "not handled", "other sites' requests are not touched");
    console.log("Confirmed: only this app's own GET requests are handled");
  }
  {
    const network = { online: false, files: {}, requests: [] };
    const sw = loadServiceWorker({ network, caches: makeCaches(network) });
    const res = await sw.fetch(nav(BASE));
    check(res.status === 503 && /Open FieldScan Pro once/.test(await res.text()), "opened offline before it was ever installed: a clear message, not a blank screen");
    console.log("Confirmed: first-ever open with no signal explains itself");
  }

  section("Updating to a new release");
  {
    const network = { online: true, files: siteFiles(), requests: [] };
    const caches = makeCaches(network);
    const v1 = loadServiceWorker({ network, caches, build: "aaaaaaaaaaaa" });
    await v1.install(); await v1.activate();

    // release 2 has a broken file: the update must fail and leave release 1 fully intact
    const brokenNetwork = { online: true, files: { ...siteFiles() }, requests: [] };
    delete brokenNetwork.files[abs("css/app.css")];
    const cachesBroken = { ...caches, async open(n) { const c = await caches.open(n); c.network = brokenNetwork; return c; } };
    const v2bad = loadServiceWorker({ network: brokenNetwork, caches: cachesBroken, build: "bbbbbbbbbbbb" });
    let failed = false;
    try { await v2bad.install(); } catch (e) { failed = true; }
    check(failed, "a release with a missing file is refused");
    const stillV1 = await caches.open("fsp-shell-aaaaaaaaaaaa");
    check(stillV1.map.size === PRECACHE.length, "release 1's files are untouched");
    check((await (await v1.fetch(get(abs("js/app.js")))).text()) === "content of js/app.js", "and release 1 keeps working");

    // release 2 good: installs next to release 1, then replaces it on activate
    const v2 = loadServiceWorker({ network, caches, build: "cccccccccccc" });
    await v2.install();
    let keys = await caches.keys();
    check(keys.includes("fsp-shell-aaaaaaaaaaaa") && keys.includes("fsp-shell-cccccccccccc"), "both releases sit side by side until the new one takes over");
    await caches.open("someone-elses-cache");
    await v2.activate();
    keys = (await caches.keys()).sort();
    check(keys.join() === "fsp-shell-cccccccccccc,someone-elses-cache", "activating clears the old release but never touches other caches: " + keys);
    check(v2.calls.claim === 1, "the new worker takes control of open pages");
    console.log("Confirmed: a bad release is refused with the old one intact; a good one replaces the old one and only the old one");
  }

  console.log("\n\u2705 ALL SERVICE WORKER TESTS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
