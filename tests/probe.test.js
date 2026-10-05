// Run: node tests/probe.test.js
const { collectCapabilities, formatReport } = require("../js/probe.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");

class FakeFile { constructor(parts, name, opts) { this.name = name; this.type = (opts && opts.type) || ""; } }

const capablePhone = () => ({
  window: {
    isSecureContext: true,
    matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }),
    indexedDB: {}, File: FakeFile, caches: { keys: async () => ["fsp-shell-abc123", "other"] },
    showOpenFilePicker() {}, showSaveFilePicker() {}, showDirectoryPicker() {},
  },
  navigator: {
    serviceWorker: { controller: {} },
    storage: { persisted: async () => true, persist: async () => true, estimate: async () => ({ quota: 5 * 1024 * 1024 * 1024, usage: 3 * 1024 * 1024 }) },
    clipboard: { writeText() {} }, mediaDevices: { getUserMedia() {} },
    share() {}, canShare: (d) => d.files[0].type === "text/plain",
    onLine: true, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130", platform: "Linux armv81", language: "en-NG",
  },
});

(async () => {
  section("A capable phone");
  const c = await collectCapabilities(capablePhone());
  const f = c.features;
  check(f.secureContext && f.installedStandalone && f.serviceWorkerControlling && f.indexedDB, "install/offline/storage features detected");
  check(f.showDirectoryPicker && f.showSaveFilePicker && f.showOpenFilePicker, "all three file pickers detected");
  check(f.webShare && f.webShareTextFile === true && f.webShareJsonFile === false, "share sheet detected, and text files shareable but JSON not -- told apart");
  check(f.camera && f.clipboardWrite, "camera and clipboard detected");
  check(c.storage.persisted === true && c.storage.quotaMB === 5120 && c.storage.usageMB === 3, "storage figures: " + JSON.stringify(c.storage));
  check(c.environment.cacheNames.includes("fsp-shell-abc123") && c.environment.language === "en-NG", "cache names and locale read");
  console.log("Confirmed: every feature read from the browser itself, and JSON vs text sharing told apart");

  section("A limited / older browser: nothing assumed, nothing crashes");
  const bare = await collectCapabilities({ window: { File: FakeFile }, navigator: {} });
  const b = bare.features;
  check(b.secureContext === false && b.installedStandalone === false && b.serviceWorkerSupported === false && b.indexedDB === false, "missing basics read as 'no'");
  check(!b.showDirectoryPicker && !b.showSaveFilePicker && !b.showOpenFilePicker && !b.webShare && !b.camera && !b.clipboardWrite, "missing features read as 'no'");
  check(bare.storage.persisted === null && bare.storage.quotaMB === null && bare.storage.persistSupported === false, "unknown storage stays unknown (null), not guessed");
  check(Array.isArray(bare.environment.cacheNames) && bare.environment.cacheNames.length === 0, "no cache API -> empty list");

  const hostile = capablePhone();
  hostile.navigator.canShare = () => { throw new Error("boom"); };
  hostile.navigator.storage.estimate = async () => { throw new Error("denied"); };
  hostile.navigator.storage.persisted = async () => { throw new Error("denied"); };
  hostile.window.caches.keys = async () => { throw new Error("denied"); };
  const h = await collectCapabilities(hostile);
  check(h.features.webShareJsonFile === false && h.storage.quotaMB === null && h.storage.persisted === null && h.environment.cacheNames.length === 0, "APIs that throw are reported as unknown, never crash the check");
  console.log("Confirmed: absent features read as no, unreadable ones as unknown, and a throwing browser API can't break the screen");

  section("The report you copy and send back");
  const report = formatReport({
    appVersion: "0.1.0 (Phase 1)", when: "2026-10-05T10:00:00.000Z", capabilities: c,
    tests: {
      download: { ok: true, message: "asked the browser to save fsp-probe-x.json" },
      folder: { ok: false, message: "SecurityError: user gesture required" },
    },
  });
  check(/Installed as an app \(standalone\): yes/.test(report) && /Pick a folder \(showDirectoryPicker\): yes/.test(report), "capabilities appear in plain words");
  check(/Cached build: fsp-shell-abc123/.test(report) && !/other/.test(report.split("Cached build:")[1].split("\n")[0]), "which build is installed (and only this app's caches)");
  check(/\.json files: no/.test(report) && /text files: yes/.test(report), "share-sheet detail is in the report");
  check(/Download: OK -- asked the browser/.test(report) && /Folder access: PROBLEM -- SecurityError/.test(report), "test results show OK / PROBLEM with the reason");
  check(/Remembered folder: not run/.test(report) && /File picker: not run/.test(report), "tests not run are said to be 'not run'");
  check(/Android 14/.test(report), "the phone model/browser is included");
  const minimal = formatReport({ appVersion: "x", when: "now", capabilities: bare });
  check(/Storage kept permanently: unknown/.test(minimal) && /Cached build: none/.test(minimal), "a bare report is still readable");
  console.log("Confirmed: the report is plain text, labels problems as PROBLEM with the reason, and unknowns as unknown");

  console.log("\n\u2705 ALL DEVICE CHECK TESTS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
