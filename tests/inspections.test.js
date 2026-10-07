// Run: node tests/inspections.test.js
// Inspections, on the real page with real clicks.
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
const rows = (a) => a.$$("a.link-row");

(async () => {
  section("Before the project list arrives");
  {
    const a = await bootApp({ hash: "#/inspections" });
    check(/No project list yet/.test(a.text("#main")) && a.$("#inNew").getAttribute("aria-disabled") === "true", "guided, New disabled");
  }

  section("Create, edit, delete");
  {
    const a = await bootApp({ hash: "#/inspections" });
    await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1", "p2"]))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/inspections", "Inspections");
    check(/No inspections yet/.test(a.text("#main")), "empty state");
    await go(a, "#/inspections/new", "New inspection");
    check(a.$("#inDate").value === new Date().toISOString().slice(0, 10) && !a.$("#inCompany"), "date defaults to today; one company, no chooser");
    a.$("#inSave").click();
    await a.waitFor(() => /Enter a title/.test(a.text("#inResult")), "title required");
    a.setValue(a.$("#inTitle"), "Monthly site inspection"); a.$("#inProject").value = "p1";
    a.setValue(a.$("#inLocation"), "Lekki"); a.setValue(a.$("#inInspector"), "Kayode");
    a.setValue(a.$("#inConclusion"), "Cracks on column C3");
    a.$("#inSave").click();
    await a.waitFor(() => a.text("#main h2") === "Inspections" && rows(a).length === 1, "back at the list");
    let recs = await a.w.fsp.sync.getRecords("inspection");
    check(recs.length === 1 && recs[0].companyKey === CO && recs[0].projectId === "p1" && recs[0].data.conclusion === "Cracks on column C3" && recs[0].data.inspectorName === "Kayode", "saved for the company and project");
    check(/PRJ\/26\/001/.test(a.text("#main")) && /Lekki/.test(a.text("#main")), "list shows project and location");

    // inspector remembered
    await go(a, "#/inspections/new", "New inspection");
    check(a.$("#inInspector").value === "Kayode", "last inspector pre-filled");
    check(a.$("#inProject").value === "p1" && a.$("#inLocation").value === "Lekki", "project and location pre-filled from the previous inspection");
    check([...a.$$("#inLocations option")].some((o) => o.value === "Lekki") && [...a.$$("#inInspectors option")].some((o) => o.value === "Kayode"), "earlier locations and inspectors are offered as suggestions");
    a.$("#inProject").value = ""; a.event(a.$("#inProject"), "change");
    check(a.$("#inLocation").value === "Lekki", "changing to a project with no history leaves what is typed");

    // edit keeps what the phone doesn't show
    await a.w.fsp.db.readModifyWrite([{ store: "records", key: recs[0].id }], ([r]) => ({ ops: [{ op: "put", store: "records", value: { ...r, data: { ...r.data, intro: "Scope text", extra: { n: 1 } } } }] }));
    await go(a, "#/inspections/" + recs[0].id, "Edit inspection");
    check(a.$("#inTitle").value === "Monthly site inspection", "loaded");
    a.setValue(a.$("#inConclusion"), "Cracks repaired"); a.$("#inProject").value = "";
    a.$("#inSave").click();
    await a.waitFor(() => a.text("#main h2") === "Inspections", "saved");
    const after = await a.w.fsp.db.get("records", recs[0].id);
    check(after.data.conclusion === "Cracks repaired" && after.data.intro === "Scope text" && after.data.extra.n === 1 && !after.projectId, "edit applied; intro and unknown fields kept; project cleared");

    // delete
    await go(a, "#/inspections/" + recs[0].id, "Edit inspection");
    a.$("#inDelete").click();
    await a.waitFor(() => /deleted here and on the desktop/.test(a.text("#modalBox")), "confirmation");
    a.button("Delete") && [...a.$$("#modalBox button")].find((b) => /Delete/.test(b.textContent)).click();
    await a.waitFor(() => /No inspections yet/.test(a.text("#main")), "gone");
    check((await a.w.fsp.db.get("records", recs[0].id)).deleted === true, "tombstoned");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: create, validate, edit (hidden fields kept), delete");
  }

  section("Desktop inspection arrives; both-sides edit becomes a decision");
  {
    const a = await bootApp({ hash: "#/inspections" });
    await a.w.fsp.sync.importFiles([
      file("p.json", snap(CO, "PI Projects", ["p1"])),
      file("fsp-dt.json", P.makeBundle({ origin: DT, now: T0, acks: [], envelopes: [envelope({ id: "i1", projectId: "p1", data: { title: "From desktop", inspectionDate: "2026-10-01", conclusion: "ok" } })] })),
    ]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/inspections", "Inspections");
    check(rows(a).length === 1 && /From desktop/.test(a.text("#main")), "desktop inspection listed");
    await go(a, "#/inspections/i1", "Edit inspection");
    a.setValue(a.$("#inConclusion"), "phone says A"); a.$("#inSave").click();
    await a.waitFor(() => a.text("#main h2") === "Inspections", "saved");
    await a.w.fsp.sync.importFiles([file("fsp-dt2.json", P.makeBundle({ origin: DT, now: T0, acks: [], envelopes: [envelope({ id: "i1", projectId: "p1", vv: { [DT]: 2 }, data: { title: "From desktop", inspectionDate: "2026-10-01", conclusion: "desktop says B" } })] }))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/inspections", "Inspections");
    check(/Needs decision/.test(a.text("#main")), "flagged");
    await go(a, "#/inspections/i1", "Edit inspection").catch(() => {});
    check(/Needs your decision/.test(a.text("#main")), "editing is blocked until decided");
    await go(a, "#/conflicts", "Decisions");
    check(/phone says A/.test(a.text("#main")) && /desktop says B/.test(a.text("#main")), "both versions shown");
    console.log("Confirmed: arrival, conflict, block");
  }
  console.log("\n✅ ALL INSPECTIONS TESTS PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
