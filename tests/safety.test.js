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
  section("Backup, storage, lock and history");
  const a = await bootApp({ hash: "#/home" });
  const S = a.w.fsp.sync;
  await S.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);

  // ---- history: local edit, delete, incoming change ----
  const t = await S.createRecord({ type: "task", data: { title: "Fix gate", status: "open" }, companyKey: CO, projectId: "p1" });
  await S.saveRecord(t.id, { title: "Fix gate hinge", status: "open" });
  let h = await S.getHistory();
  check(h.length === 1 && h[0].title === "Fix gate" && h[0].source === "edit", "an edit is logged with the previous title");
  await S.saveRecord(t.id, { title: "Fix gate hinge", status: "open" });
  check((await S.getHistory()).length === 1, "saving with no change logs nothing");
  // incoming change from desktop
  const cur = await a.w.fsp.db.get("records", t.id);
  const vv = { ...cur.vv, [DT]: 1 };
  await S.importFiles([file("fsp-bundle-dt-bbbbbb-20261005-h1.json", P.makeBundle({ origin: DT, envelopes: [envelope({ type: "task", id: t.id, vv, data: { title: "Fix gate hinge urgently", status: "open" }, projectId: "p1" })], acks: [], now: T0 }))]);
  h = await S.getHistory();
  check(h.length === 2 && h[0].source === "desktop" && h[0].title === "Fix gate hinge" && h[0].newTitle === "Fix gate hinge urgently", "desktop change logged: " + JSON.stringify(h[0]));
  const u = await S.undoHistory(h[0].n);
  check(u.ok && (await a.w.fsp.db.get("records", t.id)).data.title === "Fix gate hinge", "undo restores the earlier text");
  check((await S.getHistory()).length === 1, "undone entry leaves the list");
  await S.deleteRecord(t.id);
  h = await S.getHistory();
  check(h[0].source === "delete" && (await S.getRecords("task")).length === 0, "delete logged");
  check((await S.undoHistory(h[0].n)).ok && (await S.getRecords("task")).length === 1, "undo brings a deleted record back");
  check(!(await S.undoHistory("nope")).ok, "unknown entry refused");

  // ---- screen + history undo button ----
  await S.saveRecord(t.id, { title: "Fix gate again", status: "open" });
  await go(a, "#/safety", "Data & security");
  check(a.$$(".sf-undo").length >= 1 && /Fix gate/.test(a.text("#main")), "history listed");
  a.$(".sf-undo").click();
  await a.waitFor(() => /Put .* back/.test(a.text("#hsResult")), "undo from screen");
  check((await a.w.fsp.db.get("records", t.id)).data.title === "Fix gate hinge", "screen undo works");

  // ---- storage meter + shrink ----
  const big = Buffer.alloc(3000, 1).toString("base64");
  const mk = async (w, deliver) => {
    const r = await S.createRecord({ type: "photo", data: { parentId: t.id, mime: "image/jpeg", b64: big, width: w, height: 600, takenAt: T0.toISOString() }, companyKey: CO, projectId: "p1" });
    if (deliver) await a.w.fsp.db.put("records", { ...r, deliveredVv: r.vv });
    return r;
  };
  const p1 = await mk(1280, true), p2 = await mk(1280, false), p3 = await mk(500, true);
  a.w.stShrinkImpl = async () => ({ mime: "image/jpeg", b64: Buffer.alloc(600, 2).toString("base64"), width: 800, height: 450 });
  const m = await a.w.stMeasure();
  check(m.photos === 3 && m.shrinkable === 1, "only the delivered, large photo is shrinkable: " + JSON.stringify(m));
  await a.w.renderSafetyScreen();
  check(/3 photos/.test(a.text("#main")) && !a.$("#stShrink").disabled, "meter shown");
  const vvBefore = (await a.w.fsp.db.get("records", p1.id)).vv;
  a.$("#stShrink").click();
  await a.waitFor(() => /Shrunk 1 photo/.test(a.text("#stResult")), "shrink result");
  const after = await a.w.fsp.db.get("records", p1.id);
  check(after.data.shrunk && after.data.width === 800 && JSON.stringify(after.vv) === JSON.stringify(vvBefore), "shrunk locally, version unchanged (nothing re-sent)");
  check((await a.w.fsp.db.get("records", p2.id)).data.width === 1280 && (await a.w.fsp.db.get("records", p3.id)).data.width === 500, "undelivered and small photos untouched");
  check(S.recordState(after) === "delivered", "still counts as delivered");

  // ---- backup + restore ----
  a.$("#bkMake").click();
  await a.waitFor(() => a.downloads.length === 1, "backup downloaded");
  const dl = a.downloads[0];
  check(/^fieldscanpro-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.name), "backup name " + dl.name);
  const backup = JSON.parse(await a.blobText(dl.blob));
  check(backup.format === "fsp-backup" && backup.records.some((r) => r.id === t.id) && backup.projects.length === 1, "backup contents");
  // newer work on the phone survives a restore; deleted-after-backup items return
  await S.saveRecord(t.id, { title: "Newer than backup", status: "open" });
  const extra = await S.createRecord({ type: "task", data: { title: "Made after backup" }, companyKey: CO, projectId: "p1" });
  const lost = await S.createRecord({ type: "task", data: { title: "Lost one" }, companyKey: CO, projectId: "p1" });
  const b2 = await a.w.bkBuild();
  await a.w.fsp.db.delete("records", lost.id);
  const r1 = await a.w.bkRestore(b2);
  check(r1.ok && r1.restored === 1, "the missing record comes back: " + JSON.stringify(r1));
  const r2 = await a.w.bkRestore(backup);
  check((await a.w.fsp.db.get("records", t.id)).data.title === "Newer than backup" && r2.kept >= 1, "newer phone work is kept");
  check((await a.w.fsp.db.get("records", extra.id)) && (await a.w.fsp.db.get("records", lost.id)).deliveredVv && Object.keys((await a.w.fsp.db.get("records", lost.id)).exportedVv).length === 0, "restored records will be re-sent");
  check(!(await a.w.bkRestore({ nope: 1 })).ok, "non-backup refused");
  // restore through the file picker
  await a.w.fsp.db.delete("records", lost.id);
  await a.w.renderSafetyScreen();
  a.setFiles(a.$("#bkFile"), [{ name: "b.json", text: async () => JSON.stringify(b2) }]);
  await a.waitFor(() => /Restored 1 record/.test(a.text("#bkResult")), "restore from file");

  // ---- app lock ----
  check(!a.w.lkEnabled() && !a.$("#lockScreen"), "no lock by default");
  a.$("#lkOn").click();
  a.setValue(a.$("#lkNew"), "12"); a.setValue(a.$("#lkNew2"), "12"); a.$("#modalSubmitBtn").click();
  check(!a.w.lkEnabled(), "a 2-digit PIN is refused");
  a.setValue(a.$("#lkNew"), "4821"); a.setValue(a.$("#lkNew2"), "4822"); a.$("#modalSubmitBtn").click();
  check(!a.w.lkEnabled(), "mismatched PINs refused");
  a.setValue(a.$("#lkNew"), "4821"); a.setValue(a.$("#lkNew2"), "4821"); a.$("#modalSubmitBtn").click();
  await a.waitFor(() => a.w.lkEnabled(), "PIN saved");
  check(!/4821/.test(a.w.localStorage.getItem("fsp-lock")), "the PIN itself is never stored");
  check(await a.w.lkCheckPin("4821") && !(await a.w.lkCheckPin("0000")), "PIN check");
  // going away for more than a minute locks; a short trip does not
  const hide = (state) => { Object.defineProperty(a.w.document, "visibilityState", { value: state, configurable: true }); a.event(a.w.document, "visibilitychange"); };
  hide("hidden"); hide("visible");
  check(!a.$("#lockScreen"), "a quick switch does not lock");
  const realNow = a.w.Date.now; let skew = 0; a.w.Date.now = () => realNow() + skew;
  hide("hidden"); skew = 120000; hide("visible");
  a.w.Date.now = realNow;
  check(a.$("#lockScreen"), "locks after a minute away");
  a.setValue(a.$("#lkPin"), "0000"); a.$("#lkGo").click();
  await a.waitFor(() => /Wrong PIN/.test(a.text("#lkMsg")), "wrong PIN message");
  check(a.$("#lockScreen"), "still locked");
  a.setValue(a.$("#lkPin"), "4821"); a.$("#lkGo").click();
  await a.waitFor(() => !a.$("#lockScreen"), "unlocked");
  // fingerprint (fake authenticator)
  a.w.lkBioImpl = { enable: async () => { const c = a.w.lkConfig(); c.bio = "cred"; a.w.localStorage.setItem("fsp-lock", JSON.stringify(c)); }, unlock: async () => true };
  await a.w.renderSafetyScreen();
  a.$("#lkBioBtn").click();
  await a.waitFor(() => /is on/.test(a.text("#lkBioBtn")), "fingerprint enabled");
  a.w.lkShow();
  a.$("#lkBio").click();
  await a.waitFor(() => !a.$("#lockScreen"), "fingerprint unlocks");
  // turn off needs the PIN
  a.$("#lkOff").click();
  a.setValue(a.$("#lkConfirm"), "1111"); a.$("#modalSubmitBtn").click();
  await new Promise((r) => setTimeout(r, 50));
  check(a.w.lkEnabled(), "wrong PIN does not turn the lock off");
  a.setValue(a.$("#lkConfirm"), "4821"); a.$("#modalSubmitBtn").click();
  await a.waitFor(() => !a.w.lkEnabled(), "lock removed");
  check(a.errors.length === 0, "no page errors: " + a.errors.join("; "));
  console.log("\nAll backup / storage / lock / history checks passed.");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
