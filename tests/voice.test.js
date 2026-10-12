// Run: node tests/voice.test.js
// Voice notes, on the real page with real clicks.
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
const AUD = Buffer.from("fake-opus-audio").toString("base64");

(async () => {
  section("Voice notes: record, play, delete, and they go with the record");
  const a = await bootApp({ hash: "#/tasks" });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  const task = await a.w.fsp.sync.createRecord({ type: "task", data: { title: "Order", notes: "", status: "Open", groupId: "", sortOrder: 1 }, companyKey: CO, projectId: "p1" });
  let stopped = 0, cancelled = 0;
  a.w.vnCaptureImpl = async () => ({ stop: async () => { stopped++; return { mime: "audio/webm", b64: AUD, durationSec: 7 }; }, cancel: () => { cancelled++; } });
  await go(a, "#/calculators", "Calculators");
  await go(a, "#/tasks/" + task.id, "Edit task");
  await a.waitFor(() => a.$(".vn-start"), "the record button");
  a.$(".vn-start").click();
  await a.waitFor(() => !a.$(".vn-live").hidden, "recording indicator");
  a.$(".vn-cancel").click();
  await a.waitFor(() => a.$(".vn-start") && !a.$(".vn-start").hidden, "cancel returns to the record button");
  check(cancelled === 1 && (await a.w.fsp.sync.getRecords("voice")).length === 0, "cancel saves nothing");
  a.$(".vn-start").click();
  await a.waitFor(() => !a.$(".vn-live").hidden, "recording again");
  a.$(".vn-stop").click();
  await a.waitFor(() => a.$$(".vn-row").length === 1, "the note appears");
  const v = await a.w.fsp.sync.getRecords("voice");
  check(stopped === 1 && v.length === 1 && v[0].data.parentId === task.id && v[0].companyKey === CO && v[0].projectId === "p1" && v[0].data.b64 === AUD && v[0].data.durationSec === 7, "stored as a record of the task's company and project");
  check(/Voice notes \(1\)/.test(a.text(".vn-box")) && /0:07/.test(a.text(".vn-row")) && a.$(".vn-row audio").src.includes(AUD), "listed with its length and a player");
  check(a.$("#tsPhotos") && a.$("#tsPhotos").nextElementSibling.classList.contains("vn-box"), "sits under the photos");
  // photos redrawing doesn't lose it
  a.w.phShrinkImpl = async () => ({ mime: "image/jpeg", b64: AUD, width: 1, height: 1 });
  a.setFiles(a.$(".ph-file"), [{ name: "a.jpg" }]);
  await a.waitFor(() => a.$$(".ph-item").length === 1, "a photo");
  check(a.$$(".vn-box").length === 1 && a.$$(".vn-row").length === 1, "one voice block, note still there");
  a.$(".vn-del").click();
  check((await a.w.fsp.sync.getRecords("voice")).length === 1, "first tap only asks");
  a.$(".vn-del").click();
  await a.waitFor(() => a.$$(".vn-row").length === 0, "deleted");
  check((await a.w.fsp.sync.getRecords("voice")).filter((r) => !r.deleted).length === 0, "removed from the store");
  // goes with its record
  a.w.vnCaptureImpl = async () => ({ stop: async () => ({ mime: "audio/mp4", b64: AUD, durationSec: 3 }), cancel() {} });
  a.$(".vn-start").click(); await a.waitFor(() => !a.$(".vn-live").hidden, "recording");
  a.$(".vn-stop").click(); await a.waitFor(() => a.$$(".vn-row").length === 1, "second note");
  await a.w.fsp.sync.deleteRecord(task.id);
  check((await a.w.fsp.sync.getRecords("voice")).length === 0, "deleting the task removes its voice notes");
  // a denied microphone is explained
  const b = await bootApp({ hash: "#/tasks" });
  await b.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  const t2 = await b.w.fsp.sync.createRecord({ type: "task", data: { title: "X", notes: "", status: "Open", groupId: "", sortOrder: 1 }, companyKey: CO, projectId: "p1" });
  b.w.vnCaptureImpl = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; };
  await go(b, "#/calculators", "Calculators"); await go(b, "#/tasks/" + t2.id, "Edit task");
  await b.waitFor(() => b.$(".vn-start"), "record button");
  b.w.vnCaptureImpl = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; };
  b.$(".vn-start").click();
  await b.waitFor(() => /Allow microphone access/.test(b.text(".vn-result")), "permission explained");
  check(a.errors.length === 0 && b.errors.length === 0, "no page errors: " + a.errors.concat(b.errors));
  console.log("\n✅ ALL VOICE NOTE TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
