// ===== Automatic sync every 10 minutes (phone) =====
// Syncs when the app opens, every 10 minutes, and when it is closed or put away (best effort: Chrome may stop a page
// quickly once it is hidden). Chrome only lets a web app use the sync folder while the app is open, so this runs while FieldScan Pro is open
// on screen. It never asks for permission by itself: if Chrome has forgotten the folder it pauses and says so.

const AS_INTERVAL_MS = 10 * 60 * 1000;
const AS_KEY = "fsp-autosync";

/** Turn automatic sync on or off for this phone (on by default). */
function asEnabled(set) {
  try {
    if (set !== undefined) { localStorage.setItem(AS_KEY, set ? "on" : "off"); return set; }
    return localStorage.getItem(AS_KEY) !== "off";
  } catch (e) { return set === undefined ? true : set; }
}

/**
 * start() begins the timer; tick() runs one automatic sync if it is due. Everything the outside world provides
 * (the sync action, the clock, whether the app is on screen) is passed in so it can be tested.
 */
function createAutoSync({ syncNow, enabled, visible, now, onResult, intervalMs }) {
  const every = intervalMs || AS_INTERVAL_MS;
  const clock = now || (() => Date.now());
  let last = 0, running = false, timer = null;
  async function tick(force, opts) {
    if (running || !enabled()) return null;
    if (!visible() && !(opts && opts.leaving)) return null; // leaving: the app is being closed or put away, which is the last chance to sync
    if (!force && last && clock() - last < every) return null;
    running = true;
    try {
      const r = await syncNow({ auto: true });
      if (r && (r.ok || r.code !== "no-folder")) last = clock();
      if (onResult) onResult(r);
      return r;
    } catch (e) {
      const r = { ok: false, error: e.message || String(e) };
      if (onResult) onResult(r);
      return r;
    } finally { running = false; }
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => tick(false), Math.min(every, 60 * 1000)); // looks every minute; runs when 10 minutes have passed
    document.addEventListener("visibilitychange", () => { if (visible()) tick(false); else tick(true, { leaving: true }); }); // back: catch up; away: one last sync
    window.addEventListener("pagehide", () => { tick(true, { leaving: true }); });
    tick(true);
  }
  return { start, tick, lastRun: () => last };
}

/** Wires it into the real app. */
function startAutoSync() {
  if (!window.fsp || !fsp.folder) return null;
  if (/jsdom/i.test(navigator.userAgent)) return null; // the test browser: a running timer would stop the tests from finishing
  const a = createAutoSync({
    syncNow: (o) => fsp.folder.syncNow(o), enabled: asEnabled, visible: () => document.visibilityState !== "hidden",
    onResult: (r) => {
      fsp.autoSync.lastAt = Date.now(); fsp.autoSync.last = r;
      const got = r && r.ok ? (r.applied || 0) : 0;
      if (got) showStatus(`Auto-sync: ${got} update${got === 1 ? "" : "s"} received.`);
      else if (r && !r.ok && r.code === "permission") showStatus(r.error, true);
      if ((got && /^#\/(home|sync)?$/.test(location.hash)) || (r && r.ok && /^#\/(home)?$/.test(location.hash))) navigate(); // refresh screens with nothing being typed
    },
  });
  fsp.autoSync = a; a.lastAt = 0; a.last = null;
  a.start();
  return a;
}
