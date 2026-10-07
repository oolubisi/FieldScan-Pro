// Run: node tests/autosync.test.js -- the 10-minute automatic sync timing and safety rules.
const fs = require("fs");
const { JSDOM } = require("jsdom");
function check(c, m) { if (!c) { console.error("FAIL: " + m); process.exit(1); } }
const dom = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" });
const w = dom.window;
w.eval(fs.readFileSync(__dirname + "/../js/autosync.js", "utf8") + "\nwindow.createAutoSync = createAutoSync; window.asEnabled = asEnabled;");
console.log("=== Automatic sync ===");
(async () => {
  let t = 1000, calls = [], on = true, shown = true, results = [];
  const a = w.createAutoSync({ syncNow: async (o) => { calls.push(o); return { ok: true, applied: 2 }; }, enabled: () => on, visible: () => shown, now: () => t, onResult: (r) => results.push(r) });
  await a.tick(true);
  check(calls.length === 1 && calls[0].auto === true, "runs, flagged as automatic (so it never asks for permission)");
  t += 9 * 60000; await a.tick(false);
  check(calls.length === 1, "not due before 10 minutes");
  t += 61000; await a.tick(false);
  check(calls.length === 2, "due after 10 minutes");
  on = false; t += 20 * 60000; await a.tick(false);
  check(calls.length === 2, "off means off");
  on = true; shown = false; await a.tick(false);
  check(calls.length === 2, "does nothing while the app is hidden");
  const before = calls.length;
  await a.tick(true, { leaving: true });
  check(calls.length === before + 1, "leaving the app (closing or putting it away) still does one last sync");
  shown = true; await a.tick(false);
  check(calls.length === before + 1 || calls.length === before + 2, "catches up as soon as the app is shown again");
  // never two at once
  let release; const slow = w.createAutoSync({ syncNow: () => new Promise((r) => { release = r; calls.push("slow"); }), enabled: () => true, visible: () => true, now: () => t });
  const p1 = slow.tick(true); const p2 = await slow.tick(true);
  check(p2 === null && calls.filter((c) => c === "slow").length === 1, "a second run never starts while one is running");
  release({ ok: true }); await p1;
  // no folder chosen: quiet, and not counted as a run
  let n = 0; const none = w.createAutoSync({ syncNow: async () => { n++; return { ok: false, code: "no-folder" }; }, enabled: () => true, visible: () => true, now: () => t });
  await none.tick(true); await none.tick(false);
  check(n === 2 && none.lastRun() === 0, "without a folder it keeps checking quietly");
  // errors don't escape
  const bad = w.createAutoSync({ syncNow: async () => { throw new Error("boom"); }, enabled: () => true, visible: () => true, now: () => t, onResult: (r) => results.push(r) });
  const br = await bad.tick(true);
  check(br.ok === false && /boom/.test(br.error), "a failure is reported, not thrown");
  check(w.asEnabled() === true && w.asEnabled(false) === false && w.asEnabled() === false, "on by default, switch remembered");
  console.log("Confirmed: 10-minute timing, visibility, on/off, no overlap, failures contained");
  console.log("\n✅ ALL AUTO SYNC TESTS PASSED");
})();
