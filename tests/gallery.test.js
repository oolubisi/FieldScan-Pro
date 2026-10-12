// Run: node tests/gallery.test.js
// The Photos tile on Home opens the photo gallery (not Inspections).
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
  section("Photos gallery");
  const a = await bootApp({ hash: "#/home" });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1", "p2"]))]);
  const t1 = await a.w.fsp.sync.createRecord({ type: "task", data: { title: "Order", notes: "", status: "Open", groupId: "", sortOrder: 1 }, companyKey: CO, projectId: "p1" });
  const t2 = await a.w.fsp.sync.createRecord({ type: "task", data: { title: "Other", notes: "", status: "Open", groupId: "", sortOrder: 1 }, companyKey: CO, projectId: "p2" });
  const mk = (parent, at) => a.w.fsp.sync.createRecord({ type: "photo", companyKey: CO, projectId: parent.projectId, data: { parentId: parent.id, mime: "image/jpeg", b64: JPG, width: 1, height: 1, takenAt: at } });
  await mk(t1, "2026-10-01T10:00:00Z"); await mk(t1, "2026-10-03T10:00:00Z"); await mk(t2, "2026-10-02T10:00:00Z");
  await go(a, "#/calculators", "Calculators"); await go(a, "#/home", a.text("#main h2"));
  await a.waitFor(() => [...a.$$("a.tile")].some((t) => /Photos/.test(t.textContent)), "the photos tile");
  const tile = [...a.$$("a.tile")].find((t) => /Photos/.test(t.textContent));
  check(tile.getAttribute("href") === "#/photos", "the Photos tile goes to #/photos, not Inspections: " + tile.getAttribute("href"));
  a.w.location.hash = "#/photos";
  await a.waitFor(() => a.text("#main h2") === "Photos" && a.$$(".ph-item").length === 3, "three photos shown");
  check(/Task · Order/.test(a.text(".ph-item .ph-cap")) && /3 \/ ?|All photos \(3\)/.test(a.text("#glFilter")), "captions say where each came from; filter shows the total");
  const first = a.$$(".ph-item .ph-cap").map((c) => c.textContent);
  check(/Order/.test(first[0]) && /Other/.test(first[1]) && /Order/.test(first[2]), "newest first");
  a.setValue(a.$("#glFilter"), `${CO}:p2`); a.event(a.$("#glFilter"), "change");
  await a.waitFor(() => a.$$(".ph-item").length === 1, "filtered to one project");
  a.$(".ph-item img").click();
  await a.waitFor(() => a.$("#phViewer"), "the viewer opens");
  check(/1 \/ 1/.test(a.text(".ph-v-count")), "viewer shows that task's photo");
  a.$(".ph-v-close").click();
  check(a.errors.length === 0, "no page errors: " + a.errors);
  console.log("\n✅ ALL PHOTO GALLERY TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
