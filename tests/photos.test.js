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
  section("Photos on a task, an inspection and a take-off card");
  const a = await bootApp({ hash: "#/tasks" });
  a.w.phShrinkImpl = async () => ({ mime: "image/jpeg", b64: JPG, width: 8, height: 6 });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  const task = await a.w.fsp.sync.createRecord({ type: "task", data: { title: "Order", notes: "", status: "Open", groupId: "", sortOrder: 1 }, companyKey: CO, projectId: "p1" });
  await go(a, "#/calculators", "Calculators");
  await go(a, "#/tasks/" + task.id, "Edit task");
  check(/Photos/.test(a.text("#tsPhotos")) && photoIs(a).length === 0, "photo section on the task");
  await a.waitFor(() => a.$(".ph-file"), "the photo section");
  a.setFiles(a.$(".ph-file"), [{ name: "a.jpg" }, { name: "b.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 2, "two photos");
  let ph = await a.w.fsp.sync.getRecords("photo");
  check(ph.length === 2 && ph.every((p) => p.data.parentId === task.id && p.companyKey === CO && p.projectId === "p1" && p.data.b64 === JPG), "stored as records of the task's company and project");
  a.$(".ph-save").click();
  await a.waitFor(() => /Tick the photos you want first/.test(a.text(".ph-result")), "must select first");
  check(a.downloads.length === 0, "nothing downloaded without a selection");
  a.$$(".ph-pick")[1].checked = true;
  a.$(".ph-save").click();
  await a.waitFor(() => /1 photo saved/.test(a.text(".ph-result")), "one selected photo downloaded");
  check(a.downloads.length === 1 && a.downloads[0].name === "Order-02.jpg", "numbering follows the photo's place, not the selection: " + a.downloads.map((d) => d.name));
  a.downloads.length = 0;
  a.$(".ph-all").checked = true; a.event(a.$(".ph-all"), "change");
  a.$(".ph-save").click();
  await a.waitFor(() => /2 photos saved/.test(a.text(".ph-result")), "download finished");
  check(a.downloads.length === 2 && a.downloads[0].name === "Order-01.jpg" && a.downloads[1].name === "Order-02.jpg", "two image files downloaded with readable names: " + a.downloads.map((d) => d.name));
  check(a.downloads[0].blob.size === Buffer.from(JPG, "base64").length && a.downloads[0].blob.type === "image/jpeg", "the file holds the photo's real bytes");
  a.$(".ph-del").click();
  await a.waitFor(() => photoIs(a).length === 1, "one removed");
  check((await a.w.fsp.sync.getRecords("photo")).length === 1, "removed from the store");

  // viewer: tap a picture, rotate, next/prev, delete
  await a.waitFor(() => a.$(".ph-file"), "the photo section");
  a.setFiles(a.$(".ph-file"), [{ name: "e.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 2, "second photo back");
  const ROT = Buffer.from("rotated").toString("base64");
  a.w.phRotateImpl = async (photo, deg) => ({ mime: "image/jpeg", b64: ROT, width: 6, height: 8 });
  a.$(".ph-item img").click();
  await a.waitFor(() => a.$("#phViewer"), "viewer opens");
  check(/1 \/ 2/.test(a.text(".ph-v-count")) && a.$(".ph-v-img").src.includes(JPG), "viewer shows the tapped photo");
  a.$(".ph-v-next").click();
  check(/2 \/ 2/.test(a.text(".ph-v-count")) && a.$(".ph-v-next").disabled, "next works, ends at last");
  a.$(".ph-v-right").click();
  await a.waitFor(() => a.$(".ph-v-img").src.includes(ROT), "rotated copy shown");
  ph = await a.w.fsp.sync.getRecords("photo");
  check(ph.length === 2 && ph.filter((x) => x.data.b64 === ROT).length === 1 && /2 \/ 2/.test(a.text(".ph-v-count")), "rotation replaced the photo, count and place kept");
  const EDT = Buffer.from("edited").toString("base64");
  let opened = null;
  a.w.phEditImpl = async (photo) => { opened = photo; return { mime: "image/jpeg", b64: EDT, width: 3, height: 3 }; };
  a.$(".ph-v-edit").click();
  await a.waitFor(() => a.$(".ph-v-img").src.includes(EDT), "edited copy shown");
  ph = await a.w.fsp.sync.getRecords("photo");
  check(opened && opened.data.b64 === ROT && ph.length === 2 && /2 \/ 2/.test(a.text(".ph-v-count")), "editor got the current photo; the edit replaced it in place");
  a.w.phEditImpl = async () => null;
  a.$(".ph-v-edit").click(); await new Promise((r) => setTimeout(r, 20));
  check(a.$(".ph-v-img").src.includes(EDT) && (await a.w.fsp.sync.getRecords("photo")).length === 2, "cancelling the editor changes nothing");
  a.$(".ph-v-del").click();
  check((await a.w.fsp.sync.getRecords("photo")).length === 2, "delete needs a second tap");
  a.$(".ph-v-del").click();
  await a.waitFor(() => /1 \/ 1/.test(a.text(".ph-v-count")), "deleted inside viewer");
  a.$(".ph-v-close").click();
  await a.waitFor(() => !a.$("#phViewer") && photoIs(a).length === 1, "closed, grid refreshed");

  // inspection: new form says save first, edit form has photos
  await a.w.fsp.sync.importFiles([file("p2.json", snap(CO, "PI Projects", ["p1"]))]);
  await go(a, "#/inspections/new", "New inspection");
  check(/Save the inspection first/.test(a.text("#main")) && !a.$("#inPhotos"), "new inspection: save first");
  const insp = await a.w.fsp.sync.createRecord({ type: "inspection", data: { title: "Site" }, companyKey: CO });
  await go(a, "#/inspections/" + insp.id, "Edit inspection");
  await a.waitFor(() => a.$(".ph-file"), "the photo section");
  a.setFiles(a.$(".ph-file"), [{ name: "c.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 1, "inspection photo");

  // take-off card
  const grp = await a.w.fsp.sync.createRecord({ type: "takeoff-group", data: { name: "G" }, companyKey: CO, projectId: "p1" });
  const card = await a.w.fsp.sync.createRecord({ type: "takeoff", data: { groupId: grp.id, title: "Tiling", date: "2026-10-01", notes: "", lineItems: [] }, companyKey: CO, projectId: "p1" });
  await go(a, "#/takeoff/" + grp.id + "/" + card.id, "Edit take-off");
  await a.waitFor(() => a.$(".ph-file"), "the photo section");
  a.setFiles(a.$(".ph-file"), [{ name: "d.jpg" }]);
  await a.waitFor(() => photoIs(a).length === 1, "take-off photo");

  // deleting the inspection removes its photo (and the phone sends the tombstone)
  await a.w.fsp.sync.deleteRecord(insp.id);
  const live = (await a.w.fsp.sync.getRecords("photo")).filter((p) => p.data.parentId === insp.id);
  check(live.length === 0, "an inspection's photos are removed with it");
  // deleting the group deletes cards and their photos
  await a.w.fsp.sync.deleteRecord(card.id);
  check((await a.w.fsp.sync.getRecords("photo")).filter((p) => p.data.parentId === card.id).length === 0, "a take-off's photos are removed with it");
  check((await a.w.fsp.sync.getRecords("photo")).filter((p) => p.data.parentId === task.id).length === 1, "other photos untouched");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("Confirmed: add, remove, scope, cascade");
  console.log("\n✅ ALL PHOTOS TESTS PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
