// Run: node tests/takeoff.test.js
// Take-Off and decision screens, on the real page with real clicks.
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


const snapshot = () => P.makeProjectsSnapshot({
  origin: DT, company: { key: CO, name: "PI Projects" },
  projects: [{ id: "p1", displayNumber: "PRJ/26/001", clientName: "Chel", siteLocation: "Lekki", status: "Active" }, { id: "p2", displayNumber: "PRJ/26/002", clientName: "Dipandtafs", siteLocation: "", status: "Active" }],
  now: T0,
});
const envelope = (o) => ({ fsp: 1, type: "takeoff", id: "x", vv: { [DT]: 1 }, updatedAt: T0.toISOString(), deleted: false, origin: DT, companyKey: CO, projectId: "p1", data: {}, ...o });
const go = async (a, hash, h2) => { a.w.location.hash = hash; await a.waitFor(() => a.text("#main h2") === h2 || a.text("#main h3") === h2, "screen " + h2); };

(async () => {
  section("No projects yet");
  {
    const a = await bootApp({ hash: "#/takeoff" });
    check(/No projects yet/.test(a.text("#main")), "explains projects must be synced first");
    check(a.$("#toNewGroup").disabled, "New group is disabled until there is a project");
    console.log("Confirmed: guided when the project list hasn't arrived");
  }

  section("Groups and take-offs: create, edit, delete");
  {
    const a = await bootApp({ hash: "#/takeoff" });
    await a.w.fsp.sync.importFiles([file("fsp-projects-co.json", snapshot())]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/takeoff", "Take-Off");
    check(!a.$("#toNewGroup").disabled, "New group enabled once projects are there");

    // validation
    a.$("#toNewGroup").click();
    await a.waitFor(() => a.$("#tgName"), "the group form");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => /Enter a group name/.test(a.text("#status-bar")), "name required");
    a.setValue(a.$("#tgName"), "Ground floor finishes");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => /Choose a project/.test(a.text("#status-bar")), "project required");

    a.$("#tgProject").value = CO + ":p1"; a.event(a.$("#tgProject"), "change");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => /Ground floor finishes/.test(a.text("#main")), "the new group is listed");
    let groups = await a.w.fsp.sync.getRecords("takeoff-group");
    check(groups.length === 1 && groups[0].data.name === "Ground floor finishes" && groups[0].projectId === "p1" && groups[0].companyKey === CO, "group saved with its project and company");
    check(/PRJ\/26\/001/.test(a.text("#main")) && /Not sent/.test(a.text("#main")), "shows project and unsent state");

    // open group, add a take-off
    a.$("a.link-card").click();
    await a.waitFor(() => a.text("#main h2") === "Ground floor finishes", "group screen");
    check(/No take-offs in this group yet/.test(a.text("#main")), "empty group says so");
    a.$("#toAddCard").click();
    await a.waitFor(() => a.text("#main h2") === "New take-off", "the editor");
    a.$("#toSave").click();
    await a.waitFor(() => /Enter a sector name/.test(a.text("#toResult")), "title required");
    a.setValue(a.$("#toTitle"), "Tiling / Flooring");
    const row = () => a.$$(".to-line");
    check(row().length === 1, "starts with one blank item row");
    const fill = (r, d, q, u, n) => { r.querySelector(".to-desc").value = d; if (q !== undefined) { r.querySelector(".to-qty").value = q; r.querySelector(".to-unit").value = u; r.querySelector(".to-notes").value = n || ""; } };
    fill(row()[0], "Floor tiles 600x600", "42.5", "m²", "grade A");
    a.$("#toAddHeader").click();
    fill(row()[1], "Skirting");
    a.$("#toAddItem").click();
    fill(row()[2], "Skirting tiles", "30", "m");
    a.$("#toAddItem").click(); // left blank on purpose
        a.$("#toSave").click();
    await a.waitFor(() => a.text("#main h2") === "Ground floor finishes" && /Tiling/.test(a.text("#main")), "back at the group with the new take-off");
    let cards = await a.w.fsp.sync.getRecords("takeoff");
    check(cards.length === 1, "one take-off saved");
    const c = cards[0];
    check(c.data.groupId === groups[0].id && c.projectId === "p1" && c.companyKey === CO, "linked to the group, project and company");
    check(c.data.lineItems.length === 3, "the blank row was dropped: " + JSON.stringify(c.data.lineItems));
    check(c.data.lineItems[0].quantity === 42.5 && c.data.lineItems[0].unit === "m²" && c.data.lineItems[1].kind === "header" && c.data.lineItems[2].quantity === 30, "numbers are numbers; heading kept");
    check(/2 items/.test(a.text("#main")), "the list shows 2 items (headings aren't counted)");

    // a desktop-only field must survive a phone edit
    const withExtra = { ...c.data, desktopOnly: { rate: 5 }, lineItems: c.data.lineItems.map((l, i) => i === 0 ? { ...l, rate: 4500 } : l) };
    await a.w.fsp.db.readModifyWrite([{ store: "records", key: c.id }], ([r]) => ({ ops: [{ op: "put", store: "records", value: { ...r, data: withExtra } }] }));
    a.$$("a.link-card")[0].click();
    await a.waitFor(() => a.text("#main h2") === "Edit take-off", "edit screen");
    check(a.$("#toTitle").value === "Tiling / Flooring" && a.$$(".to-line").length === 3, "loads what was saved");
    check(a.$$(".to-line")[0].querySelector(".to-qty").value === "42.5", "quantity shown");
    a.$$(".to-line")[0].querySelector(".to-qty").value = "50";
    a.$$(".to-line")[2].querySelector(".to-remove").click();
    a.$("#toSave").click();
    await a.waitFor(() => /1 item\b/.test(a.text("#main")), "edit saved");
    const edited = (await a.w.fsp.sync.getRecords("takeoff"))[0];
    check(edited.data.lineItems[0].quantity === 50 && edited.data.lineItems.length === 2, "edit applied");
    check(edited.data.desktopOnly.rate === 5 && edited.data.lineItems[0].rate === 4500, "fields the phone doesn't show are kept");
    check(P.vvCompare(edited.vv, c.vv) === "a_after", "the edit counts as a new version");

    // delete take-off
    a.$$("a.link-card")[0].click();
    await a.waitFor(() => a.$("#toDelete"), "delete button");
    a.$("#toDelete").click();
    await a.waitFor(() => /will be deleted here and on the desktop/.test(a.text("#modalBox")), "delete confirmation");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => /No take-offs in this group yet/.test(a.text("#main")), "gone from the list");
    check((await a.w.fsp.sync.getRecords("takeoff")).length === 0, "deleted take-off no longer listed");
    const tomb = await a.w.fsp.db.get("records", c.id);
    check(tomb.deleted === true && P.vvCompare(tomb.vv, edited.vv) === "a_after", "deletion is kept as a tombstone so it syncs");

    // group with two cards: rename, then delete cascades
    for (const t of ["A", "B"]) await a.w.fsp.sync.createRecord({ type: "takeoff", data: { groupId: groups[0].id, title: t, lineItems: [] }, companyKey: CO, projectId: "p1" });
    await go(a, "#/takeoff", "Take-Off");
    a.w.location.hash = "#/takeoff/" + groups[0].id;
    await a.waitFor(() => a.$$("a.link-card").length === 2, "two cards");
    a.$("#toRenameGroup").click();
    await a.waitFor(() => a.$("#tgName"), "rename form");
    a.setValue(a.$("#tgName"), "Level 0 finishes");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => a.text("#main h2") === "Level 0 finishes", "renamed");
    a.$("#toDeleteGroup").click();
    await a.waitFor(() => /and its 2 take-offs/.test(a.text("#modalBox")), "cascade warning");
    a.$("#modalSubmitBtn").click();
    await a.waitFor(() => a.text("#main h2") === "Take-Off", "back to the list");
    check((await a.w.fsp.sync.getRecords("takeoff-group")).length === 0 && (await a.w.fsp.sync.getRecords("takeoff")).length === 0, "group and its cards deleted together");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: create, validate, edit (desktop-only fields kept), delete with tombstones, rename, cascade delete");
  }

  section("Text from the desktop is never treated as markup");
  {
    const a = await bootApp({ hash: "#/takeoff" });
    await a.w.fsp.sync.importFiles([file("p.json", snapshot()), file("b.json", P.makeBundle({ origin: DT, now: T0, envelopes: [envelope({ type: "takeoff-group", id: "g1", data: { name: "<img src=x onerror=alert(1)>Evil" } })] }))]);
    await go(a, "#/calculators", "Calculators"); await go(a, "#/takeoff", "Take-Off");
    check(!a.$("#main img") && /<img src=x/.test(a.text("#main")), "shown as text");
    check(/Delivered/.test(a.text("#main")), "a record that came from the desktop is already 'Delivered'");
    console.log("Confirmed: hostile text is escaped");
  }

  section("Decisions: both sides edited");
  {
    const a = await bootApp({ hash: "#/takeoff" });
    await a.w.fsp.sync.importFiles([file("p.json", snapshot()), file("b0.json", P.makeBundle({ origin: DT, now: T0, envelopes: [envelope({ type: "takeoff-group", id: "g1", data: { name: "Block A" } }), envelope({ id: "c1", data: { groupId: "g1", title: "Plastering", lineItems: [{ id: "l1", kind: "item", description: "Wall plaster", quantity: 100, unit: "m²", notes: "" }] } })] }))]);
    const dev = await a.w.fsp.sync.getDeviceId();
    const base = (await a.w.fsp.sync.getRecords("takeoff"))[0];
    await a.w.fsp.sync.saveRecord(base.id, { ...base.data, title: "Plastering (phone)" });
    // the desktop edited the same record without having seen the phone's edit
    await a.w.fsp.sync.importFiles([file("b1.json", P.makeBundle({ origin: DT, now: T0, envelopes: [envelope({ id: "c1", vv: { [DT]: 2 }, updatedAt: "2026-10-05T12:00:00.000Z", data: { groupId: "g1", title: "Plastering (desktop)", lineItems: [{ id: "l1", kind: "item", description: "Wall plaster", quantity: 120, unit: "m²", notes: "" }] } })] }))]);

    await go(a, "#/calculators", "Calculators"); await go(a, "#/takeoff", "Take-Off");
    check(/1 record changed on both phone and desktop/.test(a.text("#main")), "the Take-Off screen warns about the conflict");
    a.$("a.notice").click();
    await a.waitFor(() => a.text("#main h2") === "Decisions", "the Decisions screen");
    const t = a.text("#main");
    check(/On this phone/.test(t) && /On the desktop/.test(t) && /Plastering \(phone\)/.test(t) && /Plastering \(desktop\)/.test(t), "both versions are shown side by side");
    check(/Wall plaster — 120 m²/.test(t) && /Wall plaster — 100 m²/.test(t), "including the quantities");

    // editing a conflicted record is blocked
    a.w.location.hash = "#/takeoff/g1/c1";
    await a.waitFor(() => /Needs your decision/.test(a.text("#main")), "edit is blocked while undecided");
    a.w.location.hash = "#/conflicts";
    await a.waitFor(() => a.text("#main h2") === "Decisions", "back");

    a.$(".keep-incoming").click();
    await a.waitFor(() => /Nothing to decide/.test(a.text("#main")), "resolved");
    const r = await a.w.fsp.db.get("records", "c1");
    check(r.data.title === "Plastering (desktop)" && r.data.lineItems[0].quantity === 120, "the desktop's version was kept");
    check(P.vvCovers(r.vv, { [DT]: 2, [dev]: 1 }) && P.vvCompare(r.vv, { [DT]: 2, [dev]: 1 }) === "a_after", "the decision covers both versions so it wins everywhere");
    check(a.w.fsp.sync.recordState(r) === "unsent", "and it is queued to go to the desktop");

    // a second conflict, this time keeping the phone's
    await a.w.fsp.sync.saveRecord("c1", { ...r.data, title: "Plaster v3 (phone)" });
    await a.w.fsp.sync.importFiles([file("b2.json", P.makeBundle({ origin: DT, now: T0, envelopes: [envelope({ id: "c1", vv: { [DT]: 3 }, data: { groupId: "g1", title: "Plaster v3 (desktop)", lineItems: [] } })] }))]);
    a.w.location.hash = "#/conflicts"; a.w.location.hash = "#/takeoff"; a.w.location.hash = "#/conflicts";
    await a.waitFor(() => a.$(".keep-local"), "a new decision");
    a.$(".keep-local").click();
    await a.waitFor(() => /Nothing to decide/.test(a.text("#main")), "resolved again");
    const r2 = await a.w.fsp.db.get("records", "c1");
    check(r2.data.title === "Plaster v3 (phone)" && r2.vv[DT] === 3, "the phone's version was kept, and its vector covers the desktop's");
    check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
    console.log("Confirmed: conflict surfaced, both sides shown, edit blocked, keep desktop's, keep phone's");
  }

  section("Helpers");
  {
    const a = await bootApp({ hash: "#/takeoff" });
    const w = a.w;
    const clean = w.toCleanLines([
      { id: "a", kind: "item", description: " Paint ", quantity: "12.5", unit: "m²", notes: "" },
      { kind: "item", description: "", quantity: "", unit: "", notes: "" },
      { id: "h", kind: "header", description: "   " },
      { id: "b", kind: "item", description: "Odd", quantity: "abc", unit: "", notes: "n" },
    ], [{ id: "a", rate: 9 }]);
    check(clean.length === 2 && clean[0].description === "Paint" && clean[0].quantity === 12.5 && clean[0].rate === 9, "trim, drop blanks, keep extra fields");
    check(clean[1].quantity === "", "a non-number quantity becomes empty, never NaN");
    check(w.toCountItems([{ kind: "header" }, { kind: "item" }, {}]) === 2, "headings aren't counted");
    console.log("Confirmed: line cleaning and counting");
  }

  console.log("\n✅ ALL TAKE-OFF SCREEN TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
