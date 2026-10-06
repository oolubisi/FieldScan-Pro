// Run: node tests/foldersync.test.js
const { IDBFactory } = require("fake-indexeddb");
const P = require("../js/protocol.js");
const FSPDb = require("../js/db.js");
const { createSync } = require("../js/sync.js");
const { createFolderSync } = require("../js/foldersync.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");
const DT = "dt-bbbbbb";
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0);
let tick = 0, ids = 0;

// A fake Android folder: just enough of the File System Access API.
function fakeFolder(name = "FieldScanPro Sync") {
  const files = new Map(); // name -> {text, mtime}
  const f = {
    name, files, perm: "granted", failWrite: false, failList: null, removed: [],
    queryPermission: async () => f.perm,
    requestPermission: async () => { if (f.perm === "prompt") f.perm = f.grant === false ? "denied" : "granted"; return f.perm; },
    entries: async function* () {
      if (f.failList) throw f.failList;
      for (const [n] of [...files]) yield [n, f.entry(n)];
    },
    entry: (n) => ({ kind: "file", getFile: async () => { const x = files.get(n); return { name: n, size: x.text.length, lastModified: x.mtime, text: async () => x.text }; } }),
    getFileHandle: async (n, o) => {
      if (!files.has(n) && !(o && o.create)) throw Object.assign(new Error("nf"), { name: "NotFoundError" });
      return { getFile: async () => f.entry(n).getFile(), createWritable: async () => { let buf = ""; return { write: async (t) => { if (f.failWrite) throw Object.assign(new Error("disk full"), { name: "QuotaExceededError" }); buf += t; }, close: async () => { if (!f.failWrite) files.set(n, { text: buf, mtime: ++tick }); } }; } };
    },
    removeEntry: async (n) => { f.removed.push(n); files.delete(n); },
    put(n, obj) { files.set(n, { text: typeof obj === "string" ? obj : JSON.stringify(obj), mtime: ++tick }); },
  };
  return f;
}

async function fresh(folder) {
  const db = await FSPDb.open(new IDBFactory());
  const sync = createSync({ db, protocol: P, download: async () => {}, now: () => new Date(T0 + 1000 * ++tick), uuid: () => `rec-${++ids}` });
  let held = null;
  const handleStore = { get: async () => held, set: async (h) => { held = h; }, clear: async () => { held = null; } };
  const fs = createFolderSync({ sync, db, protocol: P, now: () => new Date(T0 + 1000 * ++tick), handleStore });
  if (folder) await fs.chooseFolder(async () => folder);
  return { db, sync, fs, setStore: (h) => { held = h; } };
}
const env = (o = {}) => ({ fsp: 1, type: "ping", id: "rec-d1", vv: { [DT]: 1 }, updatedAt: "2026-10-05T11:00:00.000Z", deleted: false, origin: DT, data: { note: "hi" }, ...o });
const desktopBundle = (envs, acks = []) => P.makeBundle({ origin: DT, envelopes: envs, acks, now: new Date(T0) });
const bundleFiles = (folder, dev) => [...folder.files.keys()].filter((n) => n.indexOf("fsp-bundle-" + dev) === 0);

(async () => {
  section("Choosing the folder");
  {
    const folder = fakeFolder();
    const a = await fresh();
    let r = await a.fs.chooseFolder(async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); });
    check(r.ok && r.cancelled, "cancelling the chooser is not an error");
    r = await a.fs.chooseFolder(async () => { throw new Error("blocked"); });
    check(!r.ok && /folder chooser/.test(r.error), "a chooser failure is reported");
    folder.failWrite = true;
    r = await a.fs.chooseFolder(async () => folder);
    check(!r.ok && /can't be written/.test(r.error), "a folder that can't be written is refused up front");
    check((await a.fs.status()).state === "none", "a refused folder is not remembered");
    folder.failWrite = false;
    r = await a.fs.chooseFolder(async () => folder);
    check(r.ok && r.name === "FieldScanPro Sync" && r.remembered, "good folder accepted and remembered");
    check(!folder.files.has(".fsp-write-test"), "the test file is cleaned up");
    check((await a.fs.status()).state === "granted", "status granted");
    folder.perm = "prompt";
    check((await a.fs.status()).state === "prompt", "status shows permission prompt needed");
    await a.fs.forgetFolder();
    check((await a.fs.status()).state === "none", "forget works");
    console.log("Confirmed: choose / cancel / refuse / remember / forget");
  }

  section("Receiving and sending in one tap");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    const rec = await a.sync.createRecord({ type: "ping", data: { note: "from phone" } });
    folder.put("fsp-bundle-" + DT + "-20261005-aaaa.json", desktopBundle([env()]));
    folder.put("fsp-probe-dt-bbbbbb-x.json", { junk: true });
    folder.put("notes.txt", "not ours");
    const r = await a.fs.syncNow();
    check(r.ok && r.applied === 1, "desktop record received, got " + JSON.stringify(r));
    check(r.sent === 1 && r.filename, "phone record written, got sent=" + r.sent);
    check(bundleFiles(folder, await a.sync.getDeviceId()).length === 1, "exactly one file of ours written");
    check(folder.files.has("notes.txt") && folder.files.has("fsp-probe-dt-bbbbbb-x.json"), "other files are left alone");
    check(a.sync.recordState(await a.db.get("records", rec.id)) === "sent", "sent, not yet delivered");
    check(r.problems.length === 0, "probe files are not reported as problems");

    // second tap with nothing new: no reading, no writing
    const before = folder.files.size;
    const r2 = await a.fs.syncNow();
    check(r2.ok && r2.skippedUnchanged >= 1 && r2.read === 0, "unchanged files are skipped, got " + JSON.stringify(r2));
    check(r2.sent === 0 && folder.files.size === before, "nothing is written when nothing is new");
    console.log("Confirmed: receive, send, skip unchanged, ignore probes and strangers");
  }

  section("Receipts for the desktop");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    folder.put("fsp-bundle-" + DT + "-20261005-r.json", desktopBundle([env({ id: "rec-only-desktop" })]));
    const r = await a.fs.syncNow();
    const mine = bundleFiles(folder, await a.sync.getDeviceId());
    check(r.ok && r.applied === 1 && mine.length === 1, "a file with receipts is written even when the phone has nothing of its own");
    const parsed = JSON.parse(folder.files.get(mine[0]).text);
    check(parsed.acks.length === 1 && parsed.acks[0].id === "rec-only-desktop", "it carries the receipt");
    console.log("Confirmed: receipts reach the desktop");
  }

  section("Delivery confirmation and tidy-up");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    const dev = await a.sync.getDeviceId();
    const rec = await a.sync.createRecord({ type: "ping", data: { note: "x" } });
    await a.fs.syncNow();
    const first = bundleFiles(folder, dev)[0];
    // the desktop confirms it
    folder.put("fsp-bundle-" + DT + "-20261005-bbbb.json", desktopBundle([], [{ id: rec.id, vv: (await a.db.get("records", rec.id)).vv }]));
    const r = await a.fs.syncNow();
    check(r.ok && r.acked === 1, "receipt processed");
    check(a.sync.recordState(await a.db.get("records", rec.id)) === "delivered", "now delivered");
    check(!folder.files.has(first) && r.pruned === 1, "confirmed file removed from the folder");
    check(folder.files.has("fsp-bundle-" + DT + "-20261005-bbbb.json"), "the desktop's files are never removed");

    // an unconfirmed file is never removed
    const b = await fresh(fakeFolder());
    const f2 = (await b.fs.status(), fakeFolder());
    await b.fs.chooseFolder(async () => f2);
    await b.sync.createRecord({ type: "ping", data: { note: "y" } });
    await b.fs.syncNow();
    const r3 = await b.fs.syncNow();
    check(r3.pruned === 0 && bundleFiles(f2, await b.sync.getDeviceId()).length === 1, "unconfirmed file stays");
    check(r3.sent === 0, "records already waiting in the folder are not written a second time");
    console.log("Confirmed: delivered only on receipt; own confirmed files pruned; waiting files not duplicated");
  }

  section("Receipt-only files are not thrown away early");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    const dev = await a.sync.getDeviceId();
    folder.put("fsp-bundle-" + DT + "-20261005-r1.json", desktopBundle([env({ id: "rec-r1" })]));
    await a.fs.syncNow();
    const first = bundleFiles(folder, dev);
    check(first.length === 1, "receipts file written");
    await a.fs.syncNow(); await a.fs.syncNow();
    check(bundleFiles(folder, dev).join() === first.join(), "the newest receipts file stays, even though it has nothing to confirm");
    // a newer file supersedes it
    folder.put("fsp-bundle-" + DT + "-20261005-r2.json", desktopBundle([env({ id: "rec-r2" })]));
    await a.fs.syncNow();
    const now = bundleFiles(folder, dev);
    check(now.length === 1 && now[0] !== first[0], "once a newer receipts file exists the older one is removed");
    console.log("Confirmed: receipts are kept until superseded");
  }

  section("Failures leave records waiting");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    const rec = await a.sync.createRecord({ type: "ping", data: { note: "z" } });
    folder.failWrite = true;
    let r = await a.fs.syncNow();
    check(!r.ok && r.code === "write" && /still waiting/.test(r.error), "write failure reported");
    check(a.sync.recordState(await a.db.get("records", rec.id)) === "unsent", "record still unsent after a failed write");
    folder.failWrite = false;
    r = await a.fs.syncNow();
    check(r.ok && r.sent === 1, "next tap sends it");

    folder.perm = "prompt"; folder.grant = false;
    r = await a.fs.syncNow();
    check(!r.ok && r.code === "permission", "refused permission reported");
    folder.grant = true; folder.perm = "prompt";
    r = await a.fs.syncNow();
    check(r.ok, "permission re-asked on the tap and granted");

    folder.failList = Object.assign(new Error("gone"), { name: "NotFoundError" });
    r = await a.fs.syncNow();
    check(!r.ok && r.code === "missing", "missing folder reported");
    folder.failList = new Error("io");
    r = await a.fs.syncNow();
    check(!r.ok && r.code === "read", "read failure reported");
    folder.failList = null;

    const none = await fresh();
    r = await none.fs.syncNow();
    check(!r.ok && r.code === "no-folder", "no folder chosen");

    folder.put("fsp-bundle-" + DT + "-bad.json", "{not json");
    r = await a.fs.syncNow();
    check(r.problems.length === 1 && r.problems[0].file.indexOf("bad") > 0, "a bad file is reported by name");
    const again = await a.fs.syncNow();
    check(again.problems.length === 1, "a bad file is retried, not silently marked read");
    console.log("Confirmed: write/permission/missing/read failures and bad files");
  }

  section("Conflicts and one-at-a-time");
  {
    const folder = fakeFolder();
    const a = await fresh(folder);
    const rec = await a.sync.createRecord({ type: "ping", data: { note: "phone edit" } });
    folder.put("fsp-bundle-" + DT + "-c.json", desktopBundle([env({ id: rec.id, data: { note: "desktop edit" }, vv: { [DT]: 1 } })]));
    const r = await a.fs.syncNow();
    check(r.ok && r.conflicts === 1 && r.lines.some((l) => /need your decision/.test(l)), "a both-sides edit is surfaced, not overwritten");
    check((await a.sync.getConflicts()).length === 1, "conflict stored");

    const b = await fresh(fakeFolder());
    const f = fakeFolder(); await b.fs.chooseFolder(async () => f);
    await b.sync.createRecord({ type: "ping", data: { note: "q" } });
    const [x, y] = await Promise.all([b.fs.syncNow(), b.fs.syncNow()]);
    check(x === y || (x.sent === y.sent), "a second tap shares the running sync");
    check(bundleFiles(f, await b.sync.getDeviceId()).length === 1, "only one file written");
    console.log("Confirmed: conflicts surfaced; concurrent taps run once");
  }

  console.log("\n✅ ALL FOLDER SYNC TESTS PASSED");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
