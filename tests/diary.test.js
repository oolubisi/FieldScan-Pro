// Run: node tests/photos.test.js
// Photos, on the real page with real clicks.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");
const P = require("../js/protocol.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");
const ROOT = path.join(__dirname, "..");
const DT = "dt-bbbbbb";
const CO = "co-aaaa1111";
const T0 = new Date("2026-10-05T10:00:00Z");
const file = (name, obj) => ({ name, text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });

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
    else if ((this.getAttribute("href") || "").startsWith("#")) w.location.hash = this.getAttribute("href");
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



const snap = (key, name, ids) => P.makeProjectsSnapshot({
  origin: DT, company: { key, name },
  projects: ids.map((id, i) => ({ id, displayNumber: "PRJ/26/00" + (i + 1), clientName: "Client " + id, siteLocation: "", status: "Active" })),
  now: T0,
});
const envelope = (o) => ({ fsp: 1, type: "inspection", id: "x", vv: { [DT]: 1 }, updatedAt: T0.toISOString(), deleted: false, origin: DT, companyKey: CO, projectId: undefined, data: {}, ...o });
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2, "screen " + h2); };
const JPG = Buffer.from("fake-jpeg-bytes").toString("base64");
const photoIs = (a) => a.$$(".ph-item");

(async () => {
  section("Site diary, dictation and PDF reports");
  const a = await bootApp({ hash: "#/diary" });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  await go(a, "#/diary", "Site diary");
  check(/No diary entries yet/.test(a.text("#main")), "empty state");
  // dictation: a fake speech engine
  let spoken = null;
  a.w.SpeechRecognition = function () { this.start = () => { spoken = this; setTimeout(() => { this.onresult({ results: [[{ transcript: "four bricklayers and six labourers" }]] }); this.onend(); }, 5); }; this.stop = () => {}; };
  await go(a, "#/diary/new", "New diary entry");
  check(a.$$(".dt-btn").length === 5, "a mic button beside each text box: " + a.$$(".dt-btn").length);
  a.$("#dyLabour + .dt-btn").click();
  await a.waitFor(() => /bricklayers/.test(a.$("#dyLabour").value), "dictated text arrives");
  check(a.$("#dyLabour").value === "Four bricklayers and six labourers" && spoken.lang === "en-NG", "capitalised, Nigerian English");
  a.$("#dyDeliveries").value = "Cement delivered."; a.$("#dyDeliveries + .dt-btn").click();
  await a.waitFor(() => /labourers/.test(a.$("#dyDeliveries").value), "appends");
  check(a.$("#dyDeliveries").value === "Cement delivered. four bricklayers and six labourers", "added after what was typed: " + a.$("#dyDeliveries").value);
  a.$("#dyWeather").value = "Sunny"; a.$("#dyProgress").value = "Set out block wall";
  a.$("#dySave").click();
  await a.waitFor(() => a.w.location.hash === "#/diary", "saved");
  const rec = (await a.w.fsp.sync.getRecords("diary"))[0];
  check(rec.data.weather === "Sunny" && rec.data.progress === "Set out block wall" && rec.data.date === a.w.tsToday() && rec.type === "diary", "entry stored with its date");
  check(/Sunny/.test(a.text("#main")) && /Set out block wall/.test(a.text("#main")), "listed");
  // photos on a diary entry
  await go(a, "#/diary/" + rec.id, "Edit entry");
  a.w.phShrinkImpl = async () => ({ mime: "image/jpeg", b64: JPG, width: 8, height: 6 });
  a.setFiles(a.$(".ph-file"), [{ name: "a.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 1, "diary photo");
  // PDF report: opens the print dialog with the content
  let printed = 0; a.w.print = () => { printed++; };
  a.$("#dyReport").click();
  await a.waitFor(() => printed === 1, "print dialog");
  const rep = a.$("#printArea").textContent;
  check(/Site Diary/.test(rep) && /Sunny/.test(rep) && /Set out block wall/.test(rep) && a.$$("#printArea img").length === 1, "diary report has the day and its photo");
  await go(a, "#/diary", "Site diary");
  a.$("#dyWeek").click();
  await a.waitFor(() => printed === 2, "weekly report");
  // inspection report from the phone
  const insp = await a.w.fsp.sync.createRecord({ type: "inspection", companyKey: CO, projectId: "p1", data: { title: "Slab", location: "Lekki", inspectorName: "K", inspectionDate: "2026-10-05", items: [{ id: "a", text: "DPM laid", result: "fail", note: "torn", wantTask: false, taskId: "" }] } });
  await go(a, "#/inspections/" + insp.id, "Edit inspection");
  a.$("#inReport").click();
  await a.waitFor(() => printed === 3, "inspection report");
  check(/Inspection Report/.test(a.$("#printArea").textContent) && /DPM laid/.test(a.$("#printArea").textContent) && /FAIL/.test(a.$("#printArea").textContent) && /Lekki/.test(a.$("#printArea").textContent), "inspection report lists the checklist");
  // cascade
  await a.w.fsp.sync.deleteRecord(rec.id);
  check((await a.w.fsp.sync.getRecords("photo")).filter((p) => p.data.parentId === rec.id).length === 0, "deleting an entry removes its photos");
  check(a.w.dtJoin("", "hello") === "Hello" && a.w.dtJoin("a", "b") === "a b", "text joining");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("Confirmed: diary entries, dictation, photos, PDF reports");
  console.log("\n✅ ALL DIARY TESTS PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
