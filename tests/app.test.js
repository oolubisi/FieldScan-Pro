// Run: node tests/app.test.js
// Boots the REAL index.html and scripts in a simulated browser and drives them with real clicks.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");
const P = require("../js/protocol.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");
const ROOT = path.join(__dirname, "..");
const DT = "dt-bbbbbb";

async function bootApp({ withIndexedDB = true, hash = "" } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    url: "https://example.test/app/" + hash, runScripts: "dangerously", pretendToBeVisual: true,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, "crypto", { value: require("crypto").webcrypto });
  if (withIndexedDB) w.indexedDB = new IDBFactory();

  // capture what the app asks the browser to download
  const downloads = [];
  const blobs = new Map();
  let n = 0;
  w.URL.createObjectURL = (blob) => { const u = "blob:test/" + ++n; blobs.set(u, blob); return u; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) downloads.push({ name: this.getAttribute("download"), blob: blobs.get(this.href) });
  };

  scripts.forEach((src) => {
    const el = w.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, src), "utf8");
    w.document.body.appendChild(el);
  });
  const app = {
    w, doc: w.document, downloads, errors,
    $: (sel) => w.document.querySelector(sel),
    $$: (sel) => [...w.document.querySelectorAll(sel)],
    text: (sel) => (w.document.querySelector(sel) || { textContent: "" }).textContent,
    button: (label) => [...w.document.querySelectorAll("button, a.btn")].find((b) => b.textContent.trim().includes(label)),
    blobText: (blob) => new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(blob); }),
    async waitFor(fn, what, ms = 3000) {
      const start = Date.now();
      for (;;) {
        let v; try { v = fn(); } catch (e) { v = false; }
        if (v) return v;
        if (Date.now() - start > ms) throw new Error("FAIL: timed out waiting for " + what);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    event: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    setValue(el, v) { el.value = v; app.event(el, "input"); },
    setFiles(input, files) { Object.defineProperty(input, "files", { value: files, configurable: true }); app.event(input, "change"); },
  };
  await app.waitFor(() => w.fsp && (w.fsp.sync || w.fsp.storageError), "the app to start");
  await app.waitFor(() => app.$("#main h2"), "the first screen");
  return app;
}

const file = (name, obj) => ({ name, text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });
const T0 = new Date("2026-10-05T10:00:00Z");

(async () => {
  section("Start-up and navigation");
  {
    const a = await bootApp();
    check(a.text("#main h2") === "Take-Off", "opens on Take-Off, the first thing needed on site");
    check(a.$("#tabbar a.active").dataset.route === "takeoff", "the Take-Off tab is highlighted");
    a.w.location.hash = "#/sync";
    await a.waitFor(() => a.text("#main h2") === "Sync", "the Sync screen");
    check(a.$("#tabbar a.active").dataset.route === "sync", "the Sync tab is highlighted");
    a.w.location.hash = "#/device-check";
    await a.waitFor(() => a.text("#main h2") === "Device check", "the Device check screen");
    check(a.$("#tabbar a.active").dataset.route === "sync", "the Device check belongs to the Sync tab");
    a.w.location.hash = "#/nonsense";
    await a.waitFor(() => a.text("#main h2") === "Take-Off", "fallback screen");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: opens on Take-Off; tabs, Device check and an unknown address all land on the right screen");
  }
  {
    const a = await bootApp({ hash: "#/sync" });
    check(a.text("#main h2") === "Sync", "opening straight to #/sync works (a bookmark or reload)");
    console.log("Confirmed: reloading on the Sync screen stays there");
  }

  section("Calculators, on the real page");
  {
    const a = await bootApp({ hash: "#/calculators" });
    a.w.confirm = () => true;
    const select = a.$("#calc-type-select");
    select.value = "concrete";
    a.event(select, "change");
    await a.waitFor(() => a.$(".ce-l"), "the concrete form");
    a.$(".ce-l").value = "4"; a.$(".ce-w").value = "3"; a.$(".ce-h-rect").value = "150";
    a.$(".ce-mix").value = "1:2:4"; a.$(".ce-rebar").value = "single";
    a.button("Calculate").click();
    const out = a.$("#calc-output").value;
    check(/Cement: 12 bags \(50kg\)/.test(out) && /Total Volume: 1.8 m/.test(out) && /Reinforcement \(Rebar\): 180 kg/.test(out), "a 4 x 3 m, 150 mm slab gives 12 bags, 1.8 m3, 180 kg rebar:\n" + out);
    check(a.$("#calc-output-card").style.display === "block", "the result is shown");

    a.button("Constants").click();
    check(a.$("#modalOverlay").classList.contains("open") && /Calculator Constants/.test(a.text("#modalBox")), "Constants opens as a sheet");
    a.$("#calcconst_general_cementBagWeightKg").value = "25";
    a.$("#modalSubmitBtn").click();
    check(!a.$("#modalOverlay").classList.contains("open"), "saving closes the sheet");
    check(JSON.parse(a.w.localStorage.getItem("fieldscan_calculator_constants")).general.cementBagWeightKg === 25, "the change is remembered on the phone");
    check(/Constants saved/.test(a.text("#status-bar")), "and confirmed with a message");
    select.value = "concrete"; a.event(select, "change");
    await a.waitFor(() => a.$(".ce-l"), "the concrete form again");
    a.$(".ce-l").value = "4"; a.$(".ce-w").value = "3"; a.$(".ce-h-rect").value = "150";
    a.button("Calculate").click();
    check(/Cement: 23 bags \(25kg\)/.test(a.$("#calc-output").value), "the same slab now needs 23 bags of 25 kg: " + a.$("#calc-output").value.split("\n").find((l) => /Cement/.test(l)));

    a.button("Constants").click();
    a.button("Reset to Defaults").click();
    check(a.w.localStorage.getItem("fieldscan_calculator_constants") === null, "Reset to Defaults clears the saved constants");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: calculate, edit constants (saved on the phone), recalculate, and reset all work on the real page");
  }

  section("Sync screen: the full round trip");
  {
    const a = await bootApp({ hash: "#/sync" });
    const deviceId = await a.w.fsp.sync.getDeviceId();
    check(/No project list yet/.test(a.text("#main")) && /Nothing to send yet/.test(a.text("#main")), "a fresh phone says there's nothing yet");
    check(a.text("#main").includes(deviceId) && /App version 0\.2\.0/.test(a.text("#main")), "the device id and app version are shown");

    check(!a.$("#syncImportInput").hasAttribute("accept") && a.$("#syncImportInput").multiple, "the import picker has NO file-type filter (Android hides files it doesn't recognise, and sync apps often deliver them untyped) and allows several files");

    a.button("Save file for the desktop").click();
    await a.waitFor(() => /Nothing to send yet\./.test(a.text("#syncExportResult")), "the empty-export message");
    check(a.downloads.length === 0, "nothing is downloaded when there is nothing to send");

    a.setValue(a.$("#pingNote"), "hello from site");
    a.button("Create test note").click();
    await a.waitFor(() => /hello from site/.test(a.text("#main")), "the new test note in the list");
    check(/Not sent yet/.test(a.text("#main")), "it is marked 'Not sent yet'");
    check(/Test note created/.test(a.text("#status-bar")), "and the next step is explained in a message");

    const exportBtn = a.$("#syncExport");
    exportBtn.click();
    exportBtn.click(); // an impatient double tap
    await a.waitFor(() => a.downloads.length >= 1 && /Saved fsp-bundle/.test(a.text("#syncExportResult")), "the export result");
    check(a.downloads.length === 1, "a double tap still saves exactly ONE file (got " + a.downloads.length + ")");
    const sent = JSON.parse(await a.blobText(a.downloads[0].blob));
    check(P.isSyncFilename(a.downloads[0].name) && P.validateBundle(sent).ok && sent.origin === deviceId, "a valid bundle from this phone: " + a.downloads[0].name);
    check(sent.envelopes.length === 1 && sent.envelopes[0].data.note === "hello from site", "containing the test note");
    check(/Sent, waiting for desktop/.test(a.text("#main")), "the note now shows 'Sent, waiting for desktop' -- NOT delivered");
    check(/Your sync app will upload it to Drive/.test(a.text("#syncExportResult")), "the result says what happens next");

    // the desktop answers: a project list (carrying the confirmation) and a reply note
    const pingId = sent.envelopes[0].id;
    const snapshot = P.makeProjectsSnapshot({
      origin: DT, company: { key: "co-aaaa1111", name: "PI Projects" },
      projects: [{ id: "p1", displayNumber: "PRJ/26/001", clientName: "Chel", siteLocation: "Lekki", status: "Active" }, { id: "p2", displayNumber: "PRJ/26/002", clientName: "Dipandtafs", siteLocation: "", status: "Active" }],
      acks: [{ id: pingId, vv: sent.envelopes[0].vv }], now: T0,
    });
    const reply = P.makeBundle({
      origin: DT, now: T0, acks: [],
      envelopes: [{ fsp: 1, type: "ping", id: "desktop-reply-1", vv: { [DT]: 1 }, updatedAt: T0.toISOString(), deleted: false, origin: DT, data: { note: "got it, thanks" } }],
    });
    a.setFiles(a.$("#syncImportInput"), [file("fsp-projects-co-aaaa1111.json", snapshot), file("fsp-bundle-dt.json", reply)]);
    await a.waitFor(() => /Project list for PI Projects: 2 projects/.test(a.text("#syncImportResult")), "the import result");
    const result = a.text("#syncImportResult");
    check(/2 files read/.test(result) && /Records: 1 new or updated/.test(result) && /confirmed delivery of 1 record/.test(result), "the result explains what arrived: " + result);
    check(/Delivered/.test(a.text("#main")) && !/Sent, waiting for desktop/.test(a.text("#main")), "the test note now shows Delivered");
    check(/got it, thanks/.test(a.text("#main")) && /From desktop/.test(a.text("#main")), "the desktop's reply is listed");
    check(/PI Projects/.test(a.text("#main")) && /2 projects/.test(a.text("#main")), "the project list card shows the company and count");
    check(/PRJ\/26\/001 \u2014 Chel, Lekki/.test(a.text("#main")), "and the projects themselves");
    check(!/Test note created/.test(a.text("#syncImportResult")), "(sanity: result box shows the import only)");

    // importing the same files again is harmless
    a.setFiles(a.$("#syncImportInput"), [file("again.json", reply)]);
    // wait for the NEW result (the previous import's text also contains "already up to date")
    await a.waitFor(() => /Records: 0 new or updated/.test(a.text("#syncImportResult")), "the repeat import result");
    check(/Records: 0 new or updated, 1 already up to date/.test(a.text("#syncImportResult")), "importing the same file again changes nothing");
    check(a.$$(".row").filter((r) => /got it, thanks/.test(r.textContent)).length === 1, "and doesn't list the reply twice");

    // after delivery, nothing is left to send
    check(/Everything has been confirmed by the desktop/.test(a.text("#main")), "the send card says everything is confirmed");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: create -> send (one file, even on a double tap) -> desktop confirms -> Delivered; reply and projects appear; repeat import is harmless");
  }

  section("Sync screen: problems are explained, never hidden");
  {
    const a = await bootApp({ hash: "#/sync" });
    a.setFiles(a.$("#syncImportInput"), [file("notes.txt", "just some text"), file("other.json", { hello: "world" }), file("fsp-future.json", { ...P.makeBundle({ origin: DT, now: T0 }), fsp: 9 })]);
    await a.waitFor(() => /Could not use/.test(a.text("#syncImportResult")), "the problem report");
    const r = a.text("#syncImportResult");
    check(/Could not use notes\.txt: not valid JSON/.test(r) && /Could not use other\.json: not a FieldScan Pro sync file/.test(r) && /Could not use fsp-future\.json: made by a newer version/.test(r), "each bad file is named with its reason: " + r);
    check(a.$("#syncImportResult .result-box.error"), "shown as an error");
    console.log("Confirmed: unusable files are listed one by one with the reason (plain text, other JSON, a newer app's file)");
  }
  {
    const a = await bootApp({ hash: "#/sync" });
    // a record changed on both sides: the screen must say so (the resolve screen arrives with Take-Off)
    const rec = await a.w.fsp.sync.createPing("both edited");
    const dev = await a.w.fsp.sync.getDeviceId();
    await a.w.fsp.sync.saveRecord(rec.id, { note: "phone edit" });
    await a.w.fsp.sync.importFiles([file("c.json", P.makeBundle({ origin: DT, now: T0, envelopes: [{ fsp: 1, type: "ping", id: rec.id, vv: { [dev]: 1, [DT]: 1 }, updatedAt: T0.toISOString(), deleted: false, origin: DT, data: { note: "desktop edit" } }] }))]);
    a.w.location.hash = "#/calculators";
    await a.waitFor(() => a.text("#main h2") === "Calculators", "leaving");
    a.w.location.hash = "#/sync";
    await a.waitFor(() => /changed on both phone and desktop/.test(a.text("#main")), "the conflict notice");
    check(/1 record changed on both/.test(a.text("#main")), "the conflict is counted on screen");
    console.log("Confirmed: a real conflict is surfaced on the Sync screen, not hidden");
  }
  {
    const a = await bootApp({ withIndexedDB: false, hash: "#/sync" });
    check(/Storage isn't available/.test(a.text("#main")) && /IndexedDB is not available/.test(a.text("#main")), "if storage is unavailable, Sync says so plainly and why");
    a.w.location.hash = "#/calculators";
    await a.waitFor(() => a.text("#main h2") === "Calculators", "calculators");
    const select = a.$("#calc-type-select");
    select.value = "rebar"; a.event(select, "change");
    await a.waitFor(() => a.$(".rb-diameter"), "the rebar form");
    a.$(".rb-diameter").value = "12"; a.$(".rb-quantity").value = "5";
    a.button("Calculate").click();
    check(/53\.3 kg/.test(a.$("#calc-output").value), "and the Calculators still work with no storage at all");
    console.log("Confirmed: no storage -> Sync explains why; Calculators unaffected");
  }

  section("Device check, on the real page");
  {
    const a = await bootApp({ hash: "#/device-check" });
    await a.waitFor(() => /Installed as an app/.test(a.text("#probeChecks")), "the capability table");
    check(/Report/.test(a.text("#main")) && /FieldScan Pro device check/.test(a.$("#probeReport").value), "a report is ready to copy");

    a.$("#probeDownload").click();
    await a.waitFor(() => a.downloads.length === 1, "the test download");
    const deviceId = await a.w.fsp.sync.getDeviceId();
    const probe = JSON.parse(await a.blobText(a.downloads[0].blob));
    check(P.validateProbe(probe).ok && probe.origin === deviceId, "the test file is a valid probe from this phone");
    check(new RegExp(`^fsp-probe-${deviceId}-\\d{8}-\\d{6}\\.json$`).test(a.downloads[0].name) && P.isSyncFilename(a.downloads[0].name), "named so the folder-sync filter picks it up: " + a.downloads[0].name);
    check(a.text("#probeDownloadResult").includes(a.downloads[0].name), "the screen names the file to look for");
    check(/Download: OK/.test(a.$("#probeReport").value), "and the report records the result");

    a.$("#probeFolder").click();
    await a.waitFor(() => /can't open a folder directly/.test(a.text("#probeFolderResult")), "the no-folder-access message");
    check(/Folder access: PROBLEM -- this browser can't open a folder directly/.test(a.$("#probeReport").value), "reported honestly, with the fall-back explained");

    // a phone where folder access works
    let written = null;
    const fileHandle = { createWritable: async () => ({ write: async (s) => { written = s; }, close: async () => {} }), getFile: async () => ({ text: async () => written }) };
    const dir = { name: "FieldScanPro Sync", getFileHandle: async () => fileHandle, entries: () => (async function* () { yield ["a", {}]; yield ["b", {}]; })(), queryPermission: async () => "granted" };
    a.w.showDirectoryPicker = async () => dir;
    a.$("#probeFolder").click();
    await a.waitFor(() => /wrote and read back/.test(a.text("#probeFolderResult")) || /wrote and read back/.test(a.$("#probeReport").value), "the folder test");
    check(/Folder access: OK -- wrote and read back fsp-probe-folder\.json in "FieldScanPro Sync" \(2 items there\); permission now granted/.test(a.$("#probeReport").value), "folder write + read-back + listing verified: " + a.$("#probeReport").value.split("\n").find((l) => /Folder access/.test(l)));
    check(/not remembered|remembered/.test(a.$("#probeReport").value), "and whether the folder could be remembered is stated separately");

    // a folder that accepts the write but hands back different content must NOT be reported as working
    const lossyHandle = { createWritable: async () => ({ write: async () => {}, close: async () => {} }), getFile: async () => ({ text: async () => "something else entirely" }) };
    a.w.showDirectoryPicker = async () => ({ ...dir, getFileHandle: async () => lossyHandle });
    a.$("#probeFolder").click();
    await a.waitFor(() => /Folder access: PROBLEM -- wrote and read back/.test(a.$("#probeReport").value), "the mismatch to be reported");
    check(/Folder access: PROBLEM/.test(a.$("#probeReport").value), "a folder that returns different content than was written is reported as a PROBLEM, not as working");
    // and one that refuses outright
    a.w.showDirectoryPicker = async () => { const e = new Error("user gesture required"); e.name = "SecurityError"; throw e; };
    a.$("#probeFolder").click();
    await a.waitFor(() => /SecurityError: user gesture required/.test(a.$("#probeReport").value), "the refusal to be reported");
    check(/Folder access: PROBLEM -- SecurityError: user gesture required/.test(a.$("#probeReport").value), "a refused folder shows the browser's own reason");

    // remembered folder, three situations
    const realKvGet = a.w.fsp.db.kvGet;
    const handleWith = (perms) => { const q = [...perms]; return { name: "FieldScanPro Sync", queryPermission: async () => q[0], requestPermission: async () => q[1] }; };
    a.w.fsp.db.kvGet = async (k, fb) => (k === "probeFolderHandle" ? null : realKvGet(k, fb));
    a.$("#probeSavedFolder").click();
    await a.waitFor(() => /no folder remembered yet/.test(a.text("#probeFolderResult")), "no remembered folder");
    a.w.fsp.db.kvGet = async (k, fb) => (k === "probeFolderHandle" ? handleWith(["granted"]) : realKvGet(k, fb));
    a.$("#probeSavedFolder").click();
    await a.waitFor(() => /is still usable/.test(a.text("#probeFolderResult")), "granted");
    a.w.fsp.db.kvGet = async (k, fb) => (k === "probeFolderHandle" ? handleWith(["prompt", "denied"]) : realKvGet(k, fb));
    a.$("#probeSavedFolder").click();
    await a.waitFor(() => /needs permission again each time/.test(a.text("#probeFolderResult")), "denied");
    check(/Remembered folder: PROBLEM -- "FieldScanPro Sync" needs permission again/.test(a.$("#probeReport").value), "a folder that needs a tap every session is reported as a problem, with why it matters");

    // picking files
    a.setFiles(a.$("#probeFiles"), [
      Object.assign(file("fsp-bundle-dt.json", P.makeBundle({ origin: DT, now: T0 })), { size: 321, type: "application/json" }),
      Object.assign(file("notes.txt", "hello"), { size: 5, type: "text/plain" }),
    ]);
    await a.waitFor(() => /2 file\(s\) picked/.test(a.$("#probeReport").value), "the file pick report");
    check(/a FieldScan bundle file/.test(a.text("#probeFilesResult")) && /not a sync file/.test(a.text("#probeFilesResult")) && /321 bytes, type "application\/json"/.test(a.text("#probeFilesResult")), "each picked file is read and classified, with its size and the type Android reports");

    // copying
    a.$("#probeCopy").click();
    await a.waitFor(() => /Select all and copy by hand/.test(a.text("#status-bar")), "the no-clipboard message");
    check(a.$("#status-bar").classList.contains("error"), "without clipboard access it says so");
    let copied = "";
    Object.defineProperty(a.w.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    a.$("#probeCopy").click();
    await a.waitFor(() => /Report copied/.test(a.text("#status-bar")), "the copied message");
    check(copied === a.$("#probeReport").value && /Download: OK/.test(copied), "the copied text is the full report");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: download test, folder test (works / can't), remembered-folder (none / granted / needs a tap), file picking and copy -- all with honest reporting");
  }

  section("Sync screen: Sync now with a chosen folder");
  {
    const a = await bootApp({ hash: "#/sync" });
    await a.waitFor(() => a.text("#main h2") === "Sync", "the Sync screen");
    // Chrome without folder access: honest fallback, no dead button
    check(!a.$("#folderChoose") && /can't open a folder directly/.test(a.text("#main")), "no folder button when the browser can't do it");

    // a fake Android folder holding one desktop file
    const files = new Map();
    const dir = {
      name: "FieldScanPro Sync",
      queryPermission: async () => "granted", requestPermission: async () => "granted",
      entries: async function* () { for (const n of [...files.keys()]) yield [n, { kind: "file", getFile: async () => ({ name: n, size: files.get(n).length, lastModified: 1, text: async () => files.get(n) }) }]; },
      getFileHandle: async (n) => ({ getFile: async () => ({ name: n, size: (files.get(n) || "").length, lastModified: 2, text: async () => files.get(n) }), createWritable: async () => { let b = ""; return { write: async (t) => { b += t; }, close: async () => { files.set(n, b); } }; } }),
      removeEntry: async (n) => { files.delete(n); },
    };
    files.set("fsp-bundle-dt-bbbbbb-20261005-aaaa.json", JSON.stringify(P.makeBundle({ origin: "dt-bbbbbb", envelopes: [{ fsp: 1, type: "ping", id: "rec-d9", vv: { "dt-bbbbbb": 1 }, updatedAt: "2026-10-05T11:00:00.000Z", deleted: false, origin: "dt-bbbbbb", data: { note: "<b>hello</b> from the mac" } }], acks: [], now: T0 })));
    a.w.showDirectoryPicker = async () => dir;
    a.w.location.hash = "#/device-check"; a.w.location.hash = "#/sync";
    await a.waitFor(() => a.$("#folderChoose"), "the Choose folder button");
    check(!a.$("#folderSync"), "no Sync now before a folder is chosen");
    a.$("#folderChoose").click();
    await a.waitFor(() => a.$("#folderSync"), "Sync now after choosing");
    check(a.text("#main").includes("FieldScanPro Sync"), "the folder name is shown");
    a.$("#folderSync").click();
    await a.waitFor(() => /1 new or updated record/.test(a.text("#folderCardResult")), "the sync result");
    check(!a.$("#folderCardResult .error"), "a good sync is not shown as an error");
    check([...files.keys()].some((n) => n.indexOf("fsp-bundle-" + "dt-") !== 0), "the receipt file was written to the folder");
    check(a.$$("#main b").every((b) => b.textContent !== "hello"), "text from a file is never treated as markup");
    check(/Last sync/.test(a.text("#main")), "last sync is shown");
    a.$("#folderForget").click();
    await a.waitFor(() => a.$("#folderChoose") && !a.$("#folderSync"), "forget returns to the start");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: fallback message, choose, Sync now, receipt written, forget");
  }

  console.log("\n\u2705 ALL APP SCREEN TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
