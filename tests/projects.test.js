// Run: node tests/projects.test.js
// Projects tab: progress, snags, photo stage tags, project-filtered lists.
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



const snap = () => P.makeProjectsSnapshot({ origin: DT, company: { key: CO, name: "PI Projects" },
  projects: [{ id: "p1", displayNumber: "PRJ/26/001", clientName: "Acme", siteLocation: "Lekki", status: "Active" }], now: T0 });
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2, "screen " + h2); };
const KEY = encodeURIComponent(CO + ":p1");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = await bootApp({ hash: "#/projects" });
  a.w.phShrinkImpl = async () => ({ mime: "image/jpeg", b64: "QUJD", width: 10, height: 10 });
  await a.w.fsp.sync.importFiles([file("p.json", snap())]);
  await go(a, "#/calculators", "Calculators"); await go(a, "#/projects", "Projects");

  section("List and tab bar");
  check(a.$('#tabbar a[data-route="projects"]') && a.$('#tabbar a[data-route="projects"]').classList.contains("active"), "Projects tab present and active");
  check(/PRJ\/26\/001/.test(a.text("#main")) && /0 progress logs · 0 snags/.test(a.text("#main")), "project listed with counts");

  section("Progress");
  await go(a, "#/projects/" + KEY, "PRJ/26/001 — Acme");
  check(a.$$(".pj-tabs a").map((x) => x.textContent).join() === "Progress,Snags,Photos,Tasks,Inspections,Take-off,Diary", "seven sub-tabs");
  await a.waitFor(() => a.$("#pjNewProgress"), "progress tab");
  a.$("#pjNewProgress").click();
  await a.waitFor(() => a.$("#pgTitle"), "form");
  a.$("#pgTitle").value = "Blockwork"; a.$("#pgTrade").value = "Mason"; a.$("#pgPercent").value = "40";
  a.$("#pgSave").click();
  await a.waitFor(() => a.$("#pgPhotos"), "saved and reopened with photos");
  let prog = (await a.w.fsp.sync.getRecords("progress"));
  check(prog.length === 1 && prog[0].companyKey === CO && prog[0].projectId === "p1" && prog[0].data.percent === 40 && prog[0].data.trade === "Mason", "progress record shape");
  a.$("#pgAddSub").click();
  await a.waitFor(() => a.$("#subTitle"), "sub modal");
  a.$("#subTitle").value = "Ground floor"; a.$("#subPct").value = "60";
  a.$("#modalSubmitBtn").click();
  await a.waitFor(async () => true, "x");
  await pause(100);
  prog = await a.w.fsp.sync.getRecords("progress");
  const sub = prog.find((r) => r.data.parentId);
  check(sub && sub.data.percent === 60 && sub.data.title === "Ground floor", "sub-task saved with parentId");

  section("Snag with photo and stage");
  await go(a, "#/projects/" + KEY + "/snags", "PRJ/26/001 — Acme");
  await a.waitFor(() => a.$("#pjNewSnag"), "snag tab");
  a.$("#pjNewSnag").click();
  await a.waitFor(() => a.$("#sgTitle"), "snag form");
  a.$("#sgTitle").value = "Crack in wall"; a.$("#sgAssigned").value = "Tunde";
  a.$("#sgSave").click();
  await a.waitFor(() => a.$("#sgPhotos .ph-file"), "snag reopened");
  const snag = (await a.w.fsp.sync.getRecords("snag"))[0];
  check(snag.data.status === "Open" && snag.data.assigned === "Tunde", "snag record shape");
  a.setFiles(a.$("#sgPhotos .ph-file"), [{ name: "a.jpg" }]);
  await a.waitFor(() => a.$("#sgPhotos .ph-stage"), "photo with stage select");
  const sel = a.$("#sgPhotos .ph-stage"); sel.value = "During"; a.event(sel, "change");
  await a.waitFor(async () => true, "x"); await pause(100);
  const photo = (await a.w.fsp.sync.getRecords("photo"))[0];
  const snag2 = (await a.w.fsp.sync.getRecords("snag"))[0];
  check(snag2.data.photoStages && snag2.data.photoStages[photo.id] === "During" && snag2.data.title === "Crack in wall", "stage stored on the parent record");

  section("Photos tab filter");
  await go(a, "#/projects/" + KEY + "/photos", "PRJ/26/001 — Acme");
  await a.waitFor(() => a.$("#pjStage"), "photos tab");
  check(a.$$(".ph-item").length === 1 && /During/.test(a.text(".ph-cap")), "photo shown with its stage");
  a.$("#pjStage").value = "After"; a.event(a.$("#pjStage"), "change");
  await a.waitFor(() => a.$$(".ph-item").length === 0, "After filter empties");
  a.$("#pjStage").value = "During"; a.event(a.$("#pjStage"), "change");
  await a.waitFor(() => a.$$(".ph-item").length === 1, "During filter shows it");

  section("Complete snag, then delete progress");
  await go(a, "#/projects/" + KEY + "/snags/" + snag.id, "Edit snag");
  a.$("#sgDone").checked = true; a.$("#sgSave").click();
  await a.waitFor(() => /0 open · 1 completed/.test(a.text("#main")), "counts");
  const done = (await a.w.fsp.sync.getRecords("snag"))[0];
  check(done.data.status === "Completed" && done.data.dateCompleted && done.data.photoStages, "completed, date set, stages kept");
  await go(a, "#/projects/" + KEY + "/progress/" + prog.find((r) => !r.data.parentId).id, "Edit progress");
  a.$("#pgDelete").click();
  await a.waitFor(() => a.$("#modalSubmitBtn"), "confirm");
  a.$("#modalSubmitBtn").click();
  await pause(150);
  check((await a.w.fsp.sync.getRecords("progress")).length === 0, "progress and its sub-task deleted");

  section("Linked lists");
  await a.w.fsp.sync.createRecord({ type: "task", companyKey: CO, projectId: "p1", data: { title: "Order sand", status: "Open", groupId: "" } });
  await go(a, "#/projects/" + KEY + "/tasks", "PRJ/26/001 — Acme");
  await a.waitFor(() => /Order sand/.test(a.text("#pjBody")), "task listed");
  check(a.$$(".pj-tabs a.active")[0].dataset.tab === "tasks", "active sub-tab");
  check(a.errors.length === 0, "no page errors: " + a.errors);
  console.log("\n✅ ALL PROJECTS TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
