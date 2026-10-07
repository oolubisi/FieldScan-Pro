// Run: node tests/tasks.test.js
// Tasks, on the real page with real clicks.
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
const envelope = (o) => ({ fsp: 1, type: "task", id: "x", vv: { [DT]: 1 }, updatedAt: T0.toISOString(), deleted: false, origin: DT, companyKey: CO, projectId: undefined, data: {}, ...o });
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2, "screen " + h2); };
const rows = (a) => a.$$(".task-row");
const titles = (a) => rows(a).map((r) => r.querySelector("b").textContent);

(async () => {
  section("No company known yet");
  {
    const a = await bootApp({ hash: "#/tasks" });
    check(/No project list yet/.test(a.text("#main")) && a.$("#tsAdd").disabled, "explains what to do, and Add is disabled");
    console.log("Confirmed: guided before the project list arrives");
  }

  section("Add, complete, edit, delete");
  {
    const a = await bootApp({ hash: "#/tasks" });
    await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1", "p2"]))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/tasks", "Tasks");
    check(!a.$("#tsCompany"), "with one company there is nothing to choose");
    a.$("#tsAdd").click();
    await a.waitFor(() => /Type a task first/.test(a.text("#status-bar")), "empty add refused");
    a.setValue(a.$("#tsNew"), "Order cement; Call surveyor ;; ");
    a.$("#tsAdd").click();
    await a.waitFor(() => rows(a).length === 2, "two tasks");
    check(/2 tasks added/.test(a.text("#status-bar")), "says how many");
    let recs = await a.w.fsp.sync.getRecords("task");
    check(recs.every((r) => r.companyKey === CO && !r.projectId && r.data.status === "Open" && r.data.groupId === ""), "saved for the company, no project, open");
    check(titles(a)[0] === "Call surveyor", "newest first: " + titles(a));

    // adding while a project is selected files the task under it
    a.$("#tsFilter").value = CO + ":p2"; a.event(a.$("#tsFilter"), "change");
    await a.waitFor(() => rows(a).length === 0, "filtered to p2");
    a.setValue(a.$("#tsNew"), "Inspect slab");
    a.$("#tsAdd").click();
    await a.waitFor(() => rows(a).length === 1, "the new one shows in the filtered list");
    check((await a.w.fsp.sync.getRecords("task")).find((r) => r.data.title === "Inspect slab").projectId === "p2", "filed under the selected project");
    a.$("#tsFilter").value = "all"; a.event(a.$("#tsFilter"), "change");
    await a.waitFor(() => rows(a).length === 3, "all three");

    // complete
    const row = rows(a).find((r) => r.querySelector("b").textContent === "Order cement");
    row.querySelector(".ts-toggle").click();
    await a.waitFor(() => rows(a).length === 3 && a.$("details"), "done section appears");
    check(/Done \(1\)/.test(a.text("details summary")), "counted under Done");
    check((await a.w.fsp.sync.getRecords("task")).find((r) => r.data.title === "Order cement").data.status === "Done", "status saved");
    a.$("details").setAttribute("open", "");
    a.$("details .ts-toggle").click();
    await a.waitFor(() => !a.$("details"), "reopened");

    // edit
    const target = (await a.w.fsp.sync.getRecords("task")).find((r) => r.data.title === "Call surveyor");
    await a.w.fsp.db.readModifyWrite([{ store: "records", key: target.id }], ([r]) => ({ ops: [{ op: "put", store: "records", value: { ...r, data: { ...r.data, desktopOnly: { n: 1 } } } }] }));
    a.w.location.hash = "#/tasks/" + target.id;
    await a.waitFor(() => a.text("#main h2") === "Edit task", "edit screen");
    check(a.$("#tsTitle").value === "Call surveyor", "loaded");
    a.setValue(a.$("#tsTitle"), "   "); a.$("#tsSave").click();
    await a.waitFor(() => /Enter a title/.test(a.text("#tsResult")), "title required");
    a.setValue(a.$("#tsTitle"), "Call the surveyor"); a.setValue(a.$("#tsNotes"), "about levels");
    a.$("#tsProject").value = "p1"; a.$("#tsDone").checked = true;
    a.$("#tsSave").click();
    await a.waitFor(() => a.text("#main h2") === "Tasks", "back to the list");
    const after = await a.w.fsp.db.get("records", target.id);
    check(after.data.title === "Call the surveyor" && after.data.notes === "about levels" && after.data.status === "Done" && after.projectId === "p1", "edit saved, project changed");
    check(after.data.desktopOnly.n === 1, "fields the phone doesn't show are kept");
    check(P.vvCompare(after.vv, target.vv) === "a_after", "counts as a new version");

    // delete
    a.w.location.hash = "#/tasks/" + target.id;
    await a.waitFor(() => a.$("#tsDelete"), "edit screen");
    a.$("#tsDelete").click();
    await a.waitFor(() => /deleted here and on the desktop/.test(a.text("#modalBox")), "confirm");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => a.text("#main h2") === "Tasks", "back");
    check((await a.w.fsp.db.get("records", target.id)).deleted === true, "tombstone kept so the delete syncs");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: add one/many, project filter, complete/reopen, edit (kept fields), delete");
  }

  section("Groups from the desktop, several companies, hostile text, decisions");
  {
    const a = await bootApp({ hash: "#/tasks" });
    await a.w.fsp.sync.importFiles([file("p1.json", snap(CO, "PI Projects", ["p1"])), file("p2.json", snap("co-bbbb2222", "Rivotel", ["r1"])),
      file("b.json", P.makeBundle({ origin: DT, now: T0, envelopes: [
        envelope({ type: "task-group", id: "tg1", data: { name: "Site <b>visit</b>" } }),
        envelope({ id: "t1", data: { title: "<img src=x onerror=alert(1)>Check rebar", notes: "", status: "Open", groupId: "tg1", sortOrder: 5 } }),
        envelope({ id: "t2", data: { title: "Loose task", notes: "", status: "Open", groupId: "", sortOrder: 1 } }),
      ] }))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/tasks", "Tasks");
    check(!!a.$("#tsCompany") && a.$$("#tsCompany option").length === 2, "with two companies you choose which one a new task is for");
    check(!a.$("#main img") && /<img src=x/.test(a.text("#main")) && !a.$("#main h3 b"), "text from the desktop is shown as text");
    check(/Site <b>visit<\/b>/.test(a.text("#main h3")), "the group heading is shown");
    check(a.$$(".card").some((c) => c.querySelector("h3") && /Site/.test(c.querySelector("h3").textContent) && /Check rebar/.test(c.textContent)), "the grouped task sits under its group");
    a.$("#tsCompany").value = "co-bbbb2222"; a.event(a.$("#tsCompany"), "change");
    a.setValue(a.$("#tsNew"), "For Rivotel"); a.$("#tsAdd").click();
    await a.waitFor(() => rows(a).length === 3, "added");
    check((await a.w.fsp.sync.getRecords("task")).find((r) => r.data.title === "For Rivotel").companyKey === "co-bbbb2222", "filed under the chosen company");

    // edit offers only that company's projects and groups
    const rv = (await a.w.fsp.sync.getRecords("task")).find((r) => r.data.title === "For Rivotel");
    a.w.location.hash = "#/tasks/" + rv.id;
    await a.waitFor(() => a.text("#main h2") === "Edit task", "edit");
    check(a.$$("#tsProject option").length === 2 && a.$$("#tsGroup option").length === 1, "only that company's projects, and none of the other company's groups");

    // conflict
    const base = (await a.w.fsp.sync.getRecords("task")).find((r) => r.id === "t2");
    await a.w.fsp.sync.saveRecord("t2", { ...base.data, title: "Loose (phone)" });
    await a.w.fsp.sync.importFiles([file("c.json", P.makeBundle({ origin: DT, now: T0, envelopes: [envelope({ id: "t2", vv: { [DT]: 2 }, data: { title: "Loose (desktop)", notes: "", status: "Open", groupId: "", sortOrder: 1 } })] }))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/tasks", "Tasks");
    check(/changed on both phone and desktop/.test(a.text("#main")), "banner");
    check(a.$$(".task-row").find((r) => /Loose/.test(r.textContent)).querySelector(".ts-toggle").disabled, "can't tick a task that needs a decision");
    a.w.location.hash = "#/tasks/t2";
    await a.waitFor(() => /Needs your decision/.test(a.text("#main")), "edit blocked");
    a.w.location.hash = "#/conflicts";
    await a.waitFor(() => a.text("#main h2") === "Decisions", "decisions");
    check(/Task: Loose \(phone\)/.test(a.text("#main")) && /Task: Loose \(desktop\)/.test(a.text("#main")), "both versions are described in task terms");
    a.$(".keep-incoming").click();
    await a.waitFor(() => /Nothing to decide/.test(a.text("#main")), "resolved");
    check((await a.w.fsp.db.get("records", "t2")).data.title === "Loose (desktop)", "desktop's version kept");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: groups, company chooser, scoped edit lists, escaping, conflict handling");
  }

  console.log("\n✅ ALL TASKS SCREEN TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
