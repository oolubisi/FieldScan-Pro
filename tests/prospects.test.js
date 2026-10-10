// Run: node tests/prospects.test.js
// Prospects (temporary project codes), on the real page.
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
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2, "screen " + h2); };

(async () => {
  section("Prospects");
  const a = await bootApp({ hash: "#/prospects" });
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  await go(a, "#/prospects", "Prospects");
  check(/No prospects/.test(a.text("#main")), "empty state");
  await go(a, "#/prospects/new", "New prospect");
  a.$("#psSave").click();
  await a.waitFor(() => /Enter the client/.test(a.text("#psResult")), "name required");
  a.$("#psClient").value = "Mr Ade"; a.$("#psLocation").value = "Lekki"; a.$("#psNotes").value = "Tiling job";
  a.$("#psSave").click();
  await a.waitFor(() => a.w.location.hash === "#/prospects", "saved");
  const rec = (await a.w.fsp.sync.getRecords("prospect"))[0];
  check(rec.companyKey === CO && /^PROS-\d{6}-1$/.test(rec.data.code) && rec.data.client === "Mr Ade" && rec.data.status === "open", "stored with a code: " + rec.data.code);
  await a.waitFor(() => /Mr Ade/.test(a.text("#main")), "listed");

  section("Used like a project");
  const all = await a.w.fsp.sync.listProjects();
  const pr = all.find((p) => p.isProspect);
  check(all.length === 2 && pr.key === CO + ":" + rec.id && pr.displayNumber === rec.data.code && /prospect/.test(pr.clientName), "pickers see it");
  check((await a.w.fsp.sync.listProjects({ excludeProspects: true })).length === 1, "project list and home can leave it out");
  await go(a, "#/projects", "Projects");
  check(!/Mr Ade/.test(a.text("#main")), "Projects screen shows real projects only");
  await go(a, "#/takeoff", "Take-Off");
  a.$("#toFilter") && check([...a.$("#toFilter").options].some((o) => /Mr Ade/.test(o.textContent)), "take-off picker offers the prospect");
  const card = await a.w.fsp.sync.createRecord({ type: "takeoff", companyKey: CO, projectId: rec.id, data: { title: "Floor", lineItems: [] } });

  section("Edit, lost, convert, delete");
  await go(a, "#/prospects/" + rec.id, rec.data.code);
  a.$("#psLocation").value = "Victoria Island"; a.$("#psSave").click();
  await a.waitFor(() => a.w.location.hash === "#/prospects", "edit saved");
  check((await a.w.fsp.sync.getRecords("prospect"))[0].data.location === "Victoria Island", "edit stored");
  await go(a, "#/prospects/" + rec.id, rec.data.code);
  a.$("#psLost").click();
  await a.waitFor(() => /lost/.test(a.text("#main")), "marked lost");
  // the desktop converts it: record flips and the project arrives with the same id
  const cur = (await a.w.fsp.sync.getRecords("prospect"))[0];
  await a.w.fsp.sync.saveRecord(cur.id, { ...cur.data, status: "converted", convertedNumber: "PRJ/26/009" });
  await a.w.fsp.sync.importFiles([file("p2.json", snap(CO, "PI Projects", ["p1", rec.id]))]);
  const after = await a.w.fsp.sync.listProjects();
  check(after.filter((p) => p.id === rec.id).length === 1 && !after.find((p) => p.id === rec.id).isProspect, "converted: the real project replaces the prospect, same id");
  check((await a.w.fsp.sync.getRecords("takeoff")).find((c) => c.id === card.id).projectId === rec.id, "take-off stays attached");
  await go(a, "#/prospects/" + rec.id, "Prospects").catch(() => {});

  section("Handed-over projects stay out of lists");
  const hs = P.makeProjectsSnapshot({ origin: DT, company: { key: CO, name: "PI Projects" }, now: T0,
    projects: [{ id: "p1", displayNumber: "PRJ/26/001", clientName: "Live", siteLocation: "", status: "Active" }, { id: "h1", displayNumber: "PRJ/25/009", clientName: "Done Client", siteLocation: "", status: "Handed Over" }] });
  await a.w.fsp.sync.importFiles([file("h.json", hs)]);
  await go(a, "#/projects", "Projects");
  check(/Live/.test(a.text("#main")) && !/Done Client/.test(a.text("#main")), "Projects list hides handed-over");
  await go(a, "#/takeoff", "Take-Off");
  check(![...a.$("#toFilter").options].some((o) => /Done Client/.test(o.textContent)), "pickers hide handed-over");
  const lp = await a.w.fsp.sync.listProjects();
  check(lp.find((p) => p.id === "h1").handedOver === true, "still known for labels on old records");

  section("Delete");
  const p2 = await a.w.fsp.sync.createRecord({ type: "prospect", companyKey: CO, data: { code: "PROS-X-1", client: "Mrs Bello", status: "open" } });
  const c2 = await a.w.fsp.sync.createRecord({ type: "takeoff", companyKey: CO, projectId: p2.id, data: { title: "Roof", lineItems: [] } });
  a.w.confirm = () => true;
  await go(a, "#/prospects/" + p2.id, "PROS-X-1");
  a.$("#psDelete").click();
  await a.waitFor(() => a.w.location.hash === "#/prospects", "deleted");
  check((await a.w.fsp.sync.getRecords("prospect")).every((r) => r.id !== p2.id) && (await a.w.fsp.sync.getRecords("takeoff")).every((r) => r.id !== c2.id), "prospect and what was filed under it are gone");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("\nProspect tests passed");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
