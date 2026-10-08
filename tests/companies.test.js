// Run: node tests/companies.test.js
// Company switch: with two companies on the phone, every screen shows one company at a time.
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



const CO2 = "co-bbbb2222";
const snap = (key, name, id, num) => P.makeProjectsSnapshot({ origin: DT, company: { key, name }, projects: [{ id, displayNumber: num, clientName: "Client " + id, siteLocation: "", status: "Active" }], now: T0 });
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2, "screen " + h2); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = await bootApp({ hash: "#/projects" });
  const sw = () => a.$("#coSwitch");
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", "p1", "PRJ/26/001"))]);
  await go(a, "#/calculators", "Calculators"); await go(a, "#/projects", "Projects");
  await a.waitFor(() => /PRJ\/26\/001/.test(a.text("#main")), "project listed");
  check(sw().hidden, "no switch with one company");

  await a.w.fsp.sync.importFiles([file("p2.json", snap(CO2, "Rivotel", "r1", "PRJ/26/001"))]);
  await a.w.fsp.sync.createRecord({ type: "task", companyKey: CO, projectId: "p1", data: { title: "PI task", status: "Open", groupId: "" } });
  await a.w.fsp.sync.createRecord({ type: "task", companyKey: CO2, projectId: "r1", data: { title: "Rivotel task", status: "Open", groupId: "" } });
  await a.w.fsp.sync.createRecord({ type: "snag", companyKey: CO2, projectId: "r1", data: { title: "Rivotel snag", status: "Open" } });
  await go(a, "#/calculators", "Calculators"); await go(a, "#/projects", "Projects");
  await a.waitFor(() => !sw().hidden, "switch appears with two companies");
  check([...sw().options].map((o) => o.textContent).join("|") === "All companies|PI Projects|Rivotel", "options: " + [...sw().options].map((o) => o.textContent));
  check(a.$$("a.link-card").length === 2, "All companies shows both projects");

  sw().value = CO2; a.event(sw(), "change");
  await a.waitFor(() => a.$$("a.link-card").length === 1, "one project after choosing Rivotel");
  check(/Rivotel/.test(a.text("#main")) && /1 snag/.test(a.text("#main")), "Rivotel project with its own snag: " + a.text("#main"));

  await go(a, "#/tasks", "Tasks");
  await a.waitFor(() => a.$$(".task-row").length === 1, "tasks filtered");
  check(/Rivotel task/.test(a.text("#main")) && !/PI task/.test(a.text("#main")), "only Rivotel's task");
  check(!a.$("#tsCompany"), "no company picker when one is chosen");

  // it is remembered, and survives going back to the list
  check(a.w.localStorage.getItem("fsp-company") === CO2, "remembered on the phone");
  await go(a, "#/inspections", "Inspections"); await go(a, "#/tasks", "Tasks");
  check(sw().value === CO2 && a.$$(".task-row").length === 1, "still Rivotel");

  sw().value = CO; a.event(sw(), "change");
  await a.waitFor(() => /PI task/.test(a.text("#main")), "switch to PI Projects");
  check(!/Rivotel task/.test(a.text("#main")), "no Rivotel task");

  sw().value = ""; a.event(sw(), "change");
  await a.waitFor(() => a.$$(".task-row").length === 2, "all companies shows both again");
  check(a.w.localStorage.getItem("fsp-company") === null, "cleared");
  check(a.errors.length === 0, "no page errors: " + a.errors);
  console.log("\n✅ ALL COMPANY SWITCH TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
