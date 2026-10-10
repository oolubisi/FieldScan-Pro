// Run: node tests/receipts.test.js
// Quick expenses, photo stamp (date/time/GPS), Before/During/After compare, the sync chip, and PDFs to share.
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
const go = async (a, hash, h2) => {
  if (a.w.location.hash === hash) { a.w.location.hash = "#/search"; await a.waitFor(() => /Search/i.test(a.text("#main h2")), "leave"); }
  a.w.location.hash = hash; await a.waitFor(() => (h2 === "Home" ? !!a.$("#main .hero") : a.text("#main h2") === h2), "screen " + h2);
};
const JPG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBtFFFeOe+FFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//2Q==";

(async () => {
  section("Pure helpers: sync chip wording");
  const a = await bootApp({ hash: "#/home" });
  const w = a.w;
  const now = new Date("2026-10-10T12:00:00Z").getTime();
  check(w.scAgo("2026-10-10T11:58:00Z", now) === "2 min ago" && w.scAgo("2026-10-10T08:00:00Z", now) === "4 h ago" && w.scAgo("2026-10-07T12:00:00Z", now) === "3 days ago" && w.scAgo(null, now) === null, "scAgo");
  let m = w.scModel({ lastSync: "2026-10-10T11:55:00Z", counts: { unsent: 0, sent: 0 }, conflicts: 0, folderState: "granted", now });
  check(m.level === "ok" && m.text === "✓ Synced 5 min ago", "synced: " + m.text);
  m = w.scModel({ lastSync: "2026-10-10T11:55:00Z", counts: { unsent: 2, sent: 1 }, conflicts: 0, folderState: "granted", now });
  check(m.text === "⟳ 3 waiting · synced 5 min ago" && m.level === "ok", "waiting: " + m.text);
  m = w.scModel({ lastSync: "2026-10-10T07:00:00Z", counts: { unsent: 1, sent: 0 }, conflicts: 0, folderState: "granted", now });
  check(m.level === "warn", "waiting for hours is a warning");
  check(w.scModel({ lastSync: "2026-10-08T07:00:00Z", counts: { unsent: 0, sent: 0 }, conflicts: 0, folderState: "granted", now }).level === "warn", "stale (over a day) is a warning");
  check(w.scModel({ lastSync: null, counts: { unsent: 0, sent: 0 }, conflicts: 2, folderState: "granted", now }).text === "⚠ 2 need a decision", "conflicts first");
  check(w.scModel({ lastSync: null, counts: { unsent: 0, sent: 0 }, conflicts: 0, folderState: "denied", now }).level === "bad", "folder refused is bad");
  check(w.scModel({ lastSync: null, counts: { unsent: 0, sent: 0 }, conflicts: 0, folderState: "none", now }).text === "Not syncing yet", "no folder yet");
  await a.w.fsp.sync.importFiles([file("p.json", snap(CO, "PI Projects", ["p1", "p2"]))]);
  await a.waitFor(() => a.$("#syncChip") && !a.$("#syncChip").hidden && a.$("#syncChip").textContent, "the chip shows in the header");
  check(/Not syncing yet|waiting/.test(a.$("#syncChip").textContent) && a.$("#syncChip").getAttribute("href") === "#/sync", "chip is a link to Sync: " + a.$("#syncChip").textContent);

  section("Photo stamp text and the setting");
  check(w.phStampText({ at: "2026-10-10T14:32:00", lat: 6.52411, lng: 3.37921, acc: 12.4 }) === "10 Oct 2026 14:32 · 6.52411, 3.37921 (±12 m)" && w.phStampText({ at: "2026-10-10T09:05:00" }) === "10 Oct 2026 09:05", "stamp wording");
  check(w.phStampEnabled() === true, "on by default");
  w.phGeoImpl = async () => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 9 } });
  let info = await w.phStampInfo();
  check(info.lat === 6.5 && /6\.50000, 3\.40000/.test(info.text), "stamp has the location");
  w.phGeoImpl = async () => { throw new Error("denied"); };
  info = await w.phStampInfo();
  check(info.lat === undefined && /^\d+ \w+ 2026/.test(info.text), "no location: time only, photo still taken");
  w.phStampEnabled(false); check((await w.phStampInfo()) === null, "off means no stamp"); w.phStampEnabled(true);
  await go(a, "#/sync", "Sync");
  check(a.$("#geoStampBox") && a.$("#geoStampBox").checked, "setting is on the Sync screen");
  a.$("#geoStampBox").checked = false; a.event(a.$("#geoStampBox"), "change"); check(w.phStampEnabled() === false, "turning it off is remembered"); w.phStampEnabled(true);

  section("Quick expense: photo, amount, project");
  w.phGeoImpl = async () => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 9 } });
  const stamps = []; w.phShrinkImpl = async (f, stamp) => { stamps.push(stamp); return { mime: "image/jpeg", b64: JPG, width: 640, height: 480 }; };
  await go(a, "#/expenses", "Expenses");
  check(/No expenses yet/.test(a.text("#main")), "empty state");
  check(a.$$("#main a").some((x) => /Add expense/.test(x.textContent)), "Add expense button");
  await go(a, "#/expenses/new", "Add expense");
  a.setFiles(a.$("#exFile"), [{ name: "r.jpg" }]);
  check(/1 photo ready/.test(a.text("#exFileName")), "photo noted");
  a.$("#exSave").click();
  await a.waitFor(() => /Enter the amount/.test(a.text("#exResult")), "amount required");
  a.$("#exAmount").value = "12500"; a.$("#exSave").click();
  await a.waitFor(() => /who was paid/.test(a.text("#exResult")), "payee required");
  a.$("#exPayee").value = "Bright Hardware"; a.$("#exSave").click();
  await a.waitFor(() => /Choose the project/.test(a.text("#exResult")), "project required");
  a.$("#exProject").value = "p1"; a.$("#exCat").value = "Materials"; a.$("#exMethod").value = "Cash"; a.$("#exNote").value = "Binding wire";
  a.$("#exSave").click();
  await a.waitFor(() => w.location.hash === "#/expenses", "saved");
  const exp = (await w.fsp.sync.getRecords("expense"))[0];
  check(exp && exp.projectId === "p1" && exp.data.amount === 12500 && exp.data.payee === "Bright Hardware" && exp.data.status === "new" && exp.data.category === "Materials" && exp.data.note === "Binding wire", "expense record shape");
  const photo = (await w.fsp.sync.getRecords("photo")).find((p) => p.data.parentId === exp.id);
  check(photo && photo.projectId === "p1" && photo.data.lat === 6.5 && photo.data.lng === 3.4 && photo.data.acc === 9 && stamps[0] && /6\.50000/.test(stamps[0].text), "receipt photo attached, stamped, with its coordinates");
  await a.waitFor(() => /Bright Hardware/.test(a.text("#main")), "listed");
  check(/₦12,500\.00/.test(a.text("#main")) && /Sent to desktop/.test(a.text("#main")) && /This month/.test(a.text("#main")), "list shows amount, status and the month total");
  // the desktop marks it added: the phone shows it and locks it
  await w.fsp.sync.saveRecord(exp.id, { ...exp.data, status: "added", paymentId: "pay1" });
  await go(a, "#/expenses", "Expenses");
  check(/On the desktop ✓/.test(a.text("#main")), "added by the desktop");
  await go(a, "#/expenses/" + exp.id, "Expense");
  check(a.$("#exAmount").disabled && !a.$("#exSave") && /can no longer be changed/.test(a.text("#main")), "locked once the desktop has added it");
  await go(a, "#/home", "Home");
  check(a.$$(".tile").some((x) => /Expenses this month/.test(x.textContent) && x.getAttribute("href") === "#/expenses"), "Expenses card on Home");

  section("Before / During / After side by side");
  await go(a, "#/projects/" + CO + ":p1/snags/new", "Add snag").catch(() => {});
  const snagRec = await w.fsp.sync.createRecord({ type: "snag", companyKey: CO, projectId: "p1", data: { title: "Crack in wall", notes: "Hairline crack\nabove the door", assigned: "Musa", dateLogged: "2026-10-03", status: "Open" } });
  const mk = (b) => w.fsp.sync.createRecord({ type: "photo", companyKey: CO, projectId: "p1", data: { parentId: snagRec.id, mime: "image/jpeg", b64: JPG, width: 640, height: 480, takenAt: b } });
  const p1 = await mk("2026-10-03T08:00:00Z"), p2 = await mk("2026-10-04T08:00:00Z"), p3 = await mk("2026-10-05T08:00:00Z");
  const g = w.phStageGroups([p1, p2, p3].map((x) => ({ id: x.id, data: x.data })), { [p1.id]: "Before", [p3.id]: "After" });
  check(g.Before.length === 1 && g.After.length === 1 && g.During.length === 0 && g.filled === 2, "grouping by stage");
  await w.fsp.sync.saveRecord(snagRec.id, { ...snagRec.data, photoStages: { [p1.id]: "Before", [p3.id]: "After" } });
  await go(a, "#/projects/" + CO + ":p1/snags/" + snagRec.id, "Edit snag");
  await a.waitFor(() => a.$("#sgPhotos .ph-compare"), "compare button appears with two stages tagged");
  a.$("#sgPhotos .ph-compare").click();
  check(a.$$("#phCompare .ph-cmp-col").length === 2 && /Before/.test(a.text("#phCompare")) && /After/.test(a.text("#phCompare")) && a.$$("#phCompare img").length === 2, "two columns, one photo each");
  a.$("#phCompare .ph-v-close").click(); check(!a.$("#phCompare"), "closes");

  section("PDF: build, and share through the share sheet");
  const shared = []; w.pdfShareImpl = async (bytes, name, title) => { shared.push({ bytes, name, title }); return "shared"; };
  await go(a, "#/projects/" + CO + ":p1/snags", "PRJ/26/001 — Client p1");
  await a.waitFor(() => a.$("#pjSnagShare"), "share snag report button");
  a.$("#pjSnagShare").click();
  await a.waitFor(() => shared.length === 1, "pdf handed to the share sheet");
  const pdf = Buffer.from(shared[0].bytes), raw = pdf.toString("latin1");
  check(/^%PDF-1\.4/.test(raw) && /%%EOF$/.test(raw) && /\.pdf$/.test(shared[0].name) && /Snags/.test(shared[0].name), "a real PDF named for the project: " + shared[0].name);
  const xr = /startxref\n(\d+)/.exec(raw); check(xr && raw.slice(Number(xr[1]), Number(xr[1]) + 4) === "xref", "xref table is where startxref says");
  check(/Crack in wall/.test(raw) && /COMPLETED|OPEN/.test(raw) && /Hairline crack/.test(raw) && /Musa/.test(raw), "text is real text, not a picture");
  check((raw.match(/\/Subtype \/Image/g) || []).length === 3 && /\(Before\)|Before/.test(raw) && /After/.test(raw), "3 photos embedded and the Before/After tags printed");
  check(/Page 1 of 1/.test(raw), "page footer");
  let printed = 0; w.print = () => { printed++; };
  a.$("#pjSnagPrint").click(); await a.waitFor(() => printed === 1, "snag report prints");
  check(/Snag Report/.test(a.$("#printArea").textContent) && /Crack in wall/.test(a.$("#printArea").textContent), "snag print content");
  // diary + inspection share
  const di = await w.fsp.sync.createRecord({ type: "diary", companyKey: CO, projectId: "p1", data: { date: "2026-10-05", weather: "Sunny", progress: "Pile caps cast" } });
  await go(a, "#/diary/" + di.id, "Edit entry");
  a.$("#dyShare").click(); await a.waitFor(() => shared.length === 2, "diary shared");
  check(/Pile caps cast/.test(Buffer.from(shared[1].bytes).toString("latin1")) && /Site diary/.test(shared[1].name), "diary PDF");
  await go(a, "#/diary", "Site diary");
  a.$("#dyWeekShare") && a.$("#dyWeekShare").click();
  const insp = await w.fsp.sync.createRecord({ type: "inspection", companyKey: CO, projectId: "p1", data: { title: "Monthly", location: "Plot 4", inspectorName: "Kayode", inspectionDate: "2026-10-05", items: [{ id: "i1", text: "Wall paint", result: "fail", note: "Peeling" }], conclusion: "Redo" } });
  await go(a, "#/inspections/" + insp.id, "Edit inspection").catch(async () => { await a.waitFor(() => a.$("#inShare"), "inspection form"); });
  await a.waitFor(() => a.$("#inShare"), "share button on inspection");
  a.$("#inShare").click(); await a.waitFor(() => shared.some((s) => /Inspection/.test(s.name)), "inspection shared");
  const ip = Buffer.from(shared.find((s) => /Inspection/.test(s.name)).bytes).toString("latin1");
  check(/Wall paint/.test(ip) && /Peeling/.test(ip) && /FAIL/.test(ip), "inspection PDF has the checklist");

  section("Fallback: no share sheet saves the file; PNG photos are converted");
  delete w.pdfShareImpl;
  const out = await w.pdfShare(new Uint8Array([37, 80, 68, 70]), "My report", "x");
  check(out === "saved" && a.downloads.some((d) => d.name === "My report.pdf"), "no share sheet: saved to Downloads");
  w.pdfToJpegImpl = async () => JPG;
  const blocks = await w.pdfPrepareImages([{ t: "photos", items: [{ mime: "image/png", b64: "AAAA", caption: "c" }, { mime: "image/jpeg", b64: JPG, caption: "d" }] }]);
  check(blocks[0].items.length === 2 && blocks[0].items[0].b64 === JPG, "PNG converted to JPEG before embedding");
  const big = w.pdfBuild({ title: "t", blocks: Array.from({ length: 120 }, (_, i) => ({ t: "p", text: "Line " + i + " " + "word ".repeat(30) })) });
  check((Buffer.from(big).toString("latin1").match(/\/Type \/Page /g) || []).length >= 3, "long reports flow onto more pages");
  check(w.pdfWin("₦1,200 — “ok” ✓ 😀") === "N1,200 \x97 \x93ok\x94 v ?", "characters the PDF font can't draw are replaced");

  section("Dictation: long notes keep listening");
  let recObj = null; w.SpeechRecognition = function () { recObj = this; this.start = () => {}; this.stop = () => {}; };
  await go(a, "#/diary/new", "New diary entry");
  a.$("#dyProgress + .dt-btn").click(); check(recObj.continuous === true, "notes (text areas) listen continuously");
  await go(a, "#/expenses/new", "Add expense");
  a.$("#exPayee + .dt-btn").click(); check(recObj.continuous === false, "short fields stop after one phrase");
  check(a.$("#exNote + .dt-btn"), "dictation on the expense note too");
  check(a.errors.length === 0, "no script errors: " + a.errors.join("; "));
  console.log("\n✅ ALL RECEIPT, STAMP, COMPARE AND PDF TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
