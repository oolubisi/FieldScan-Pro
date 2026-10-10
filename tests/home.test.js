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
  section("Home screen");
  const a = await bootApp({ hash: "#/home" });
  await a.waitFor(() => a.$(".hero"), "home renders");
  check(a.$$(".tile").length === 4 && /No project list yet/.test(a.text("#main")) && /Nothing yet/.test(a.text("#main")), "empty phone: tiles, a hint, no activity");
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1"]))]);
  const mk = (type, data, projectId) => a.w.fsp.sync.createRecord({ type, data, companyKey: CO, projectId });
  await mk("task", { title: "Order cement", notes: "", status: "Open", groupId: "", sortOrder: 1 }, "p1");
  const done = await mk("task", { title: "Call surveyor", notes: "", status: "Done", groupId: "", sortOrder: 2 }, "p1");
  const insp = await mk("inspection", { title: "Slab check", inspectionDate: new Date().toISOString().slice(0, 10) }, "p1");
  const grp = await mk("takeoff-group", { name: "G" }, "p1");
  await mk("takeoff", { groupId: grp.id, title: "Tiling", date: "", notes: "", lineItems: [] }, "p1");
  await mk("photo", { parentId: insp.id, mime: "image/jpeg", b64: "AAAA", width: 1, height: 1, takenAt: new Date().toISOString() }, "p1");
  await a.w.renderHomeScreen();
  const nums = a.$$(".tile .num").map((n) => n.textContent);
  check(nums.join() === "1,1,1,1", "tiles count open tasks, inspections this month, take-off cards, photos: " + nums);
  check(a.text(".ring span") === "50%", "ring shows the share of tasks done");
  check(a.$$(".proj").length === 1 && /PRJ/.test(a.text(".proj")) && a.$(".proj .bar i").style.width === "50%", "a project card with progress");
  check(a.$$(".feed .row").length === 4 && a.$(".feed .row").getAttribute("href").startsWith("#/"), "recent activity links to the records");
  check(/waiting to be sent/.test(a.text(".alert")), "unsent records raise an alert");
  check(!/No project list yet/.test(a.text("#main")), "hint gone once projects exist");
  check(a.w.hmColor("x") === a.w.hmColor("x") && /^#/.test(a.w.hmColor("y")), "project colours are stable");
  check(a.w.hmAgo(new Date(Date.now() - 5 * 60000).toISOString()) === "5 min ago" && a.w.hmAgo(new Date().toISOString()) === "just now", "relative times");
  check(a.$(".hero .chip.search") && a.$(".hero .chip.search").getAttribute("href") === "#/search" && !a.$("#searchBtn") && !a.$("#appbar #themeBtn"), "Search sits at the end of the greeting box, not in the top line");
  check(a.$(".hero .chip.search").textContent.trim() === "🔍", "Search is icon only");
  check(/^Last sync: /.test(a.text(".hero .last-sync")), "last line of the greeting box shows the last sync");
  // theme button cycles and is remembered
  check(a.text("#themeBtn") === "Auto", "starts on Auto");
  a.$("#themeBtn").click(); check(a.w.document.documentElement.dataset.theme === "light" && a.text("#themeBtn") === "Light", "Light");
  a.$("#themeBtn").click(); check(a.w.document.documentElement.dataset.theme === "dark" && a.w.localStorage.getItem("fsp-theme") === "dark", "Dark, remembered");
  a.$("#themeBtn").click(); check(!a.w.document.documentElement.dataset.theme && a.text("#themeBtn") === "Auto", "back to Auto");
  // due dates
  const today = a.w.tsToday();
  check(a.w.tsDueStatus("2000-01-01") === "overdue" && a.w.tsDueStatus(today) === "today" && a.w.tsDueStatus("2999-01-01") === "" && a.w.tsDueStatus("2026-10-07", "2026-10-05") === "soon", "due status: overdue / today / soon / far");
  const late = await mk("task", { title: "Late job", notes: "", status: "Open", groupId: "", sortOrder: 9, dueDate: "2000-01-01" }, "p1");
  await mk("task", { title: "Today job", notes: "", status: "Open", groupId: "", sortOrder: 10, dueDate: today }, "p1");
  await mk("task", { title: "Old but done", notes: "", status: "Done", groupId: "", sortOrder: 11, dueDate: "2000-01-01" }, "p1");
  await a.w.renderHomeScreen();
  check(/1 task is overdue/.test(a.text("#main")) && /1 task is due today/.test(a.text("#main")), "Home warns about overdue and due-today tasks (done ones don't count)");
  a.w.location.hash = "#/tasks";
  await a.waitFor(() => a.text("#main h2") === "Tasks", "tasks");
  const titles = a.$$(".task-row b").map((b) => b.textContent);
  check(titles[0] === "Late job" && titles[1] === "Today job", "tasks with due dates come first, earliest first: " + titles);
  check(/Overdue · 2000-01-01/.test(a.text("#main")) && /Due today/.test(a.text("#main")), "chips show on the list");
  a.$("#tsDueFilter").value = "overdue"; a.event(a.$("#tsDueFilter"), "change");
  await a.waitFor(() => !/Today job/.test(a.text("#main")) && /Late job/.test(a.text("#main")), "overdue filter");
  a.w.location.hash = "#/tasks/" + late.id;
  await a.waitFor(() => a.text("#main h2") === "Edit task", "edit");
  check(a.$("#tsDueDate").value === "2000-01-01", "the edit form shows the due date");
  a.$("#tsDueDate").value = ""; a.$("#tsSave").click();
  await a.waitFor(async () => true, "x"); await new Promise((r) => setTimeout(r, 50));
  check(!("dueDate" in (await a.w.fsp.sync.getRecords("task")).find((t) => t.id === late.id).data), "clearing the date removes it");
  // search
  a.w.location.hash = "#/search";
  await a.waitFor(() => a.text("#main h2") === "Search", "search screen");
  a.$("#srBox").value = "cement"; a.event(a.$("#srBox"), "input");
  check(a.$$("#srOut .row").length === 1 && /Order cement/.test(a.text("#srOut")) && a.$("#srOut .row").getAttribute("href").startsWith("#/tasks/"), "finds a task by a word and links to it");
  a.$("#srBox").value = "slab check"; a.event(a.$("#srBox"), "input");
  check(/Inspection/.test(a.text("#srOut")), "finds an inspection; every word must match");
  a.$("#srBox").value = "slab nonsense"; a.event(a.$("#srBox"), "input");
  check(/Nothing matches/.test(a.text("#srOut")), "all words must match");
  a.$("#srBox").value = "tiling"; a.event(a.$("#srBox"), "input");
  check(a.$("#srOut .row").getAttribute("href").startsWith("#/takeoff/"), "finds a take-off card");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("Confirmed: tiles, ring, projects, activity, alerts, theme");
  console.log("\n✅ ALL HOME SCREEN TESTS PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
