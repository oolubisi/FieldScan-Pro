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
  section("Checklists, defect tasks and captions");
  const a = await bootApp({ hash: "#/inspections" });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  const sel = a.w.document.createElement("select"); void sel;
  await go(a, "#/inspections/new", "New inspection");
  a.$("#inTitle").value = "Slab pour check";
  const tpl = a.$(".cl-tpl"); tpl.value = "Slab pour"; a.event(tpl, "change");
  check(a.$$(".cl-item").length === 8 && /8 to check/.test(a.text(".cl-sum")), "a template adds its items");
  a.$(".cl-new").value = "Water supply on site"; a.$(".cl-addbtn").click();
  check(a.$$(".cl-item").length === 9, "own items can be added");
  const items = () => a.$$(".cl-item");
  items()[0].querySelector('[data-r="pass"]').click();
  items()[1].querySelector('[data-r="fail"]').click();
  check(!!items()[1].querySelector(".cl-note") && items()[1].querySelector(".cl-want").checked, "a failed item asks for a note and offers a task (on by default)");
  items()[1].querySelector(".cl-note").value = "DPM torn near gridline C"; a.event(items()[1].querySelector(".cl-note"), "input");
  items()[2].querySelector('[data-r="fail"]').click();
  items()[2].querySelector(".cl-want").checked = false; a.event(items()[2].querySelector(".cl-want"), "change");
  items()[3].querySelector('[data-r="na"]').click();
  check(/1 pass · 2 fail · 1 n\/a · 5 to check/.test(a.text(".cl-sum")), "summary counts: " + a.text(".cl-sum"));
  items()[0].querySelector('[data-r="pass"]').click();
  check(/0 pass/.test(a.text(".cl-sum")), "tapping a result again clears it");
  items()[0].querySelector('[data-r="pass"]').click();
  a.$("#inSave").click();
  await a.waitFor(() => a.w.location.hash === "#/inspections", "saved");
  const insp = (await a.w.fsp.sync.getRecords("inspection"))[0];
  const tasks = await a.w.fsp.sync.getRecords("task");
  check(insp.data.items.length === 9 && insp.data.items[1].result === "fail" && insp.data.items[1].taskId, "items are stored on the inspection");
  check(tasks.length === 1 && tasks[0].data.title === "Fix: DPM laid and lapped" && /DPM torn/.test(tasks[0].data.notes) && /From inspection: Slab pour check/.test(tasks[0].data.notes), "the failed item with 'create task' made one task, with the note");
  check(!insp.data.items[2].taskId, "the failed item with the box unticked made none");
  await go(a, "#/inspections/" + insp.id, "Edit inspection");
  check(/Task created for this defect/.test(a.text("#inChecklist")), "reopened: shows the task was created");
  a.$("#inSave").click(); await a.waitFor(() => a.w.location.hash === "#/inspections", "saved again");
  check((await a.w.fsp.sync.getRecords("task")).length === 1, "saving again doesn't make a second task");
  // captions
  a.w.phShrinkImpl = async () => ({ mime: "image/jpeg", b64: JPG, width: 8, height: 6 });
  await go(a, "#/inspections/" + insp.id, "Edit inspection");
  a.setFiles(a.$(".ph-file"), [{ name: "a.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 1, "photo added");
  a.$(".ph-item img").click();
  await a.waitFor(() => a.$("#phViewer"), "viewer");
  a.$(".ph-v-captext").value = "Torn DPM, gridline C"; a.$(".ph-v-capsave").click();
  await a.waitFor(async () => true, "x"); await new Promise((r) => setTimeout(r, 60));
  const ph = await a.w.fsp.sync.getRecords("photo");
  check(ph.length === 1 && ph[0].data.caption === "Torn DPM, gridline C" && ph[0].data.b64 === JPG, "caption saved on a copy of the photo; the original is replaced");
  a.$(".ph-v-close").click();
  await a.waitFor(() => /Torn DPM/.test(a.text(".ph-cap") || ""), "caption under the thumbnail");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("Confirmed: templates, results, notes, defect tasks (once), captions");
  console.log("\n✅ ALL CHECKLIST TESTS PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
