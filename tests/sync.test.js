// Run: node tests/sync.test.js
const assert = require("assert");
const { IDBFactory } = require("fake-indexeddb");
const P = require("../js/protocol.js");
const FSPDb = require("../js/db.js");
const { createSync } = require("../js/sync.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");

const DT = "dt-bbbbbb";
let idCounter = 0;
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0);
let tick = 0;

async function fresh() {
  const factory = new IDBFactory();
  const db = await FSPDb.open(factory);
  const downloads = [];
  const sync = createSync({
    db, protocol: P,
    download: async (filename, text) => { downloads.push({ filename, text }); },
    now: () => new Date(T0 + 1000 * ++tick),
    uuid: () => `rec-${++idCounter}`,
  });
  return { factory, db, sync, downloads };
}

const file = (name, obj) => ({ name, text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });
const env = (over = {}) => ({ fsp: 1, type: "ping", id: "rec-x", vv: { [DT]: 1 }, updatedAt: "2026-10-05T11:00:00.000Z", deleted: false, origin: DT, data: { note: "from desktop" }, ...over });
const bundleFrom = (envelopes, acks = [], origin = DT) => P.makeBundle({ origin, envelopes, acks, now: new Date(T0) });

(async () => {
  section("Storage: basics");
  {
    const { db } = await fresh();
    await db.put("records", { id: "a", type: "ping", v: 1 });
    await db.putMany("records", [{ id: "b", type: "ping" }, { id: "c", type: "other" }]);
    check((await db.getAll("records")).length === 3, "put + putMany");
    check((await db.getAllByIndex("records", "byType", "ping")).length === 2, "index lookup");
    await db.delete("records", "a");
    check(!(await db.get("records", "a")), "delete");
    await db.clear("records");
    check((await db.getAll("records")).length === 0, "clear");
    await db.kvSet("x", { n: 1 });
    assert.deepStrictEqual(await db.kvGet("x"), { n: 1 });
    check((await db.kvGet("missing", "fallback")) === "fallback", "kv fallback");
    console.log("Confirmed: put / putMany / index / delete / clear / kv");
  }

  section("Storage: replace-by-index is atomic and scoped");
  {
    const { db } = await fresh();
    await db.putMany("projects", [
      { key: "A:1", companyKey: "A", n: 1 }, { key: "A:2", companyKey: "A", n: 2 }, { key: "B:1", companyKey: "B", n: 9 },
    ]);
    await db.replaceByIndex("projects", "byCompany", "A", [{ key: "A:3", companyKey: "A", n: 3 }]);
    const rows = (await db.getAll("projects")).map((r) => r.key).sort();
    assert.deepStrictEqual(rows, ["A:3", "B:1"]);
    console.log("Confirmed: company A's rows replaced wholesale; company B untouched");
  }

  section("Storage: read-modify-write is all-or-nothing");
  {
    const { db } = await fresh();
    await db.put("records", { id: "r1", n: 1 });
    await db.put("conflicts", { id: "r1", n: 1 });
    // fn throws -> nothing written to either store
    let threw = false;
    try {
      await db.readModifyWrite([{ store: "records", key: "r1" }], () => { throw new Error("boom"); });
    } catch (e) { threw = e.message === "boom"; }
    check(threw, "the error surfaces");
    // ops across two stores apply together
    await db.readModifyWrite(
      [{ store: "records", key: "r1" }, { store: "conflicts", key: "r1" }],
      ([r, c]) => ({ ops: [{ op: "put", store: "records", value: { ...r, n: 2 } }, { op: "delete", store: "conflicts", key: "r1" }], result: c.n }),
      ["records", "conflicts"],
    );
    check((await db.get("records", "r1")).n === 2 && !(await db.get("conflicts", "r1")), "both writes applied together");
    // a bad op in the middle aborts the whole transaction: the earlier put in the same batch must not survive
    let aborted = false;
    try {
      await db.readModifyWrite([{ store: "records", key: "r1" }], ([r]) => ({ ops: [{ op: "put", store: "records", value: { ...r, n: 99 } }, { op: "frobnicate", store: "records" }] }));
    } catch (e) { aborted = true; }
    check(aborted && (await db.get("records", "r1")).n === 2, "a failure part-way leaves NOTHING half-applied");
    console.log("Confirmed: success applies everything together; any failure writes nothing");
  }

  section("Device id and records");
  {
    const { factory, db, sync } = await fresh();
    const id = await sync.getDeviceId();
    check(/^ph-[0-9a-f]{6}$/.test(id), "phone device id format: " + id);
    check((await sync.getDeviceId()) === id, "stable within a session");
    db.close();
    const db2 = await FSPDb.open(factory);
    const again = createSync({ db: db2, protocol: P });
    check((await again.getDeviceId()) === id, "stable across app restarts (persisted)");
    console.log("Confirmed: device id persists across restarts:", id);
  }
  {
    const { sync } = await fresh();
    const dev = await sync.getDeviceId();
    const r = await sync.createRecord({ type: "ping", data: { note: "a" } });
    assert.deepStrictEqual(r.vv, { [dev]: 1 });
    check(sync.recordState(r) === "unsent", "new record is unsent");
    const r2 = await sync.saveRecord(r.id, { note: "b" });
    assert.deepStrictEqual(r2.vv, { [dev]: 2 });
    check(r2.data.note === "b", "edit saved");
    const r3 = await sync.deleteRecord(r.id);
    check(r3.deleted && r3.vv[dev] === 3, "delete is a versioned tombstone");
    check((await sync.getRecords("ping")).length === 0, "deleted records are hidden from lists");
    let threw = false; try { await sync.saveRecord("nope", {}); } catch (e) { threw = true; }
    check(threw, "saving a missing record is an error");
    console.log("Confirmed: create/edit/delete bump this device's counter; tombstones hide from lists");
  }

  section("Export: what is sent, and when it counts as sent");
  {
    const { sync, db, downloads } = await fresh();
    check((await sync.exportBundle()).empty === true && downloads.length === 0, "nothing to export from an empty phone");
    const a = await sync.createPing("first");
    const b = await sync.createPing("second");
    const ex = await sync.exportBundle();
    check(ex.sent === 2 && downloads.length === 1, "one file with both records");
    check(P.isSyncFilename(downloads[0].filename), "the file name is one the protocol recognises: " + downloads[0].filename);
    const parsed = P.parseFileText(downloads[0].text);
    check(parsed.kind === "bundle" && P.validateBundle(parsed.value).ok, "the file is a valid bundle");
    check(parsed.value.envelopes.length === 2 && parsed.value.acks.length === 2, "2 records + 2 acknowledgements");
    check(parsed.value.origin === (await sync.getDeviceId()), "stamped with this phone's id");
    check(sync.recordState(await db.get("records", a.id)) === "sent", "after export: 'sent', NOT yet 'delivered'");
    // not confirmed yet -> they go again
    const ex2 = await sync.exportBundle();
    check(ex2.sent === 2, "unconfirmed records are included again in the next export");
    console.log("Confirmed: valid bundle file; records stay 'sent' (not 'delivered') and are re-sent until confirmed");
  }
  {
    // if handing the file to the browser FAILS, the record must not be marked as sent
    const { db, factory } = await fresh();
    const failing = createSync({ db, protocol: P, download: async () => { throw new Error("download blocked"); }, uuid: () => "rec-fail" });
    const rec = await failing.createPing("x");
    let threw = false; try { await failing.exportBundle(); } catch (e) { threw = true; }
    check(threw, "a failed download is reported to the caller");
    check(failing.recordState(await db.get("records", rec.id)) === "unsent", "...and the record is still 'unsent'");
    console.log("Confirmed: a blocked download leaves records 'unsent' (nothing is marked as sent that wasn't)");
  }

  section("Delivery confirmation");
  {
    const { sync, db } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createPing("hello");
    await sync.exportBundle();
    // the desktop acknowledges a version that does NOT cover ours (it has its own, independent one) -> not delivered
    let r = await sync.importFiles([file("ack-concurrent.json", bundleFrom([], [{ id: rec.id, vv: { [DT]: 1 } }]))]);
    check(sync.recordState(await db.get("records", rec.id)) === "sent", "an ack that doesn't cover our version does NOT confirm delivery");
    r = await sync.importFiles([file("ack-ok.json", bundleFrom([], [{ id: rec.id, vv: { [dev]: 1 } }, { id: "unknown-id", vv: { [DT]: 1 } }]))]);
    check(sync.recordState(await db.get("records", rec.id)) === "delivered", "an ack covering our version confirms delivery");
    check(r.results[0].acked === 1, "exactly one record confirmed; the unknown id is ignored");
    const ex = await sync.exportBundle();
    check(ex.sent === 0, "delivered records are no longer re-sent");
    // editing again makes it undelivered again
    await sync.saveRecord(rec.id, { note: "edited" });
    check(sync.recordState(await db.get("records", rec.id)) === "unsent", "a new edit is unsent again");
    check((await sync.exportBundle()).sent === 1, "and goes out again");
    console.log("Confirmed: only an ack that covers our version counts; delivered records stop being re-sent; edits re-open delivery");
  }

  section("Importing the desktop's records");
  {
    const { sync, db } = await fresh();
    const e1 = env({ id: "d-1", data: { note: "reply" } });
    let out = await sync.importFiles([file("fsp-bundle-dt.json", bundleFrom([e1]))]);
    check(out.results[0].applied === 1, "a new record from the desktop is applied");
    const stored = await db.get("records", "d-1");
    check(stored.data.note === "reply" && sync.recordState(stored) === "delivered", "stored, and counts as delivered (the desktop already has it)");
    out = await sync.importFiles([file("again.json", bundleFrom([e1]))]);
    check(out.results[0].duplicate === 1 && out.results[0].applied === 0, "the same record again is a duplicate (safe to re-import)");
    out = await sync.importFiles([file("newer.json", bundleFrom([env({ id: "d-1", vv: { [DT]: 2 }, data: { note: "reply v2" } })]))]);
    check(out.results[0].applied === 1 && (await db.get("records", "d-1")).data.note === "reply v2", "a newer version replaces it");
    out = await sync.importFiles([file("older.json", bundleFrom([e1]))]);
    check(out.results[0].stale === 1 && (await db.get("records", "d-1")).data.note === "reply v2", "an older version never overwrites a newer one");
    console.log("Confirmed: apply / duplicate / newer / stale");
  }
  {
    const { sync, db } = await fresh();
    const mix = bundleFrom([env({ id: "good-1" }), env({ id: "bad id!" }), env({ id: "good-2" })]);
    const out = await sync.importFiles([
      file("mix.json", mix),
      file("garbage.json", "{ nope"),
      file("other.json", { hello: "world" }),
      file("good.json", bundleFrom([env({ id: "good-3" })])),
    ]);
    check(out.results.filter((r) => r.ok).length === 2, "the two usable files are imported");
    check((await db.getAll("records")).map((r) => r.id).sort().join() === "good-1,good-2,good-3", "all the good records arrived despite a bad record and two bad files");
    check(out.results[0].rejected.length === 1, "the bad record inside a good file is reported");
    check(!out.results[1].ok && /not valid JSON/.test(out.results[1].reason) && !out.results[2].ok && /not a FieldScan Pro sync file/.test(out.results[2].reason), "bad files are reported with a reason");
    check(out.lines.some((l) => /Could not use garbage\.json/.test(l)) && out.lines.some((l) => /could not be used/.test(l)), "the summary tells the user about every problem");
    console.log("Confirmed: one bad record or file never stops the rest; every problem is reported");
  }
  {
    const { sync } = await fresh();
    const dev = await sync.getDeviceId();
    const own = P.makeBundle({ origin: dev, envelopes: [env({ id: "x", origin: dev, vv: { [dev]: 1 } })], now: new Date(T0) });
    const out = await sync.importFiles([file("mine.json", own)]);
    check(out.results[0].own === true && (await sync.getRecords()).length === 0, "a file this phone made itself is skipped, not re-imported");
    check(out.lines.some((l) => /made by this phone/.test(l)), "and the user is told why");
    const tooNew = await sync.importFiles([file("future.json", { ...bundleFrom([env()]), fsp: 2 })]);
    check(!tooNew.results[0].ok && /newer version/.test(tooNew.results[0].reason), "a file from a newer format is refused with a clear reason");
    console.log("Confirmed: own files skipped; newer formats refused clearly");
  }

  section("Importing the project list");
  {
    const { sync, db } = await fresh();
    const snap = (key, name, projects, at) => P.makeProjectsSnapshot({ origin: DT, company: { key, name }, projects, now: new Date(at) });
    const p = (id, n) => ({ id, displayNumber: n, clientName: "Client " + n, siteLocation: "Lekki", status: "Active" });
    let out = await sync.importFiles([file("a.json", snap("co-a", "PI Projects", [p("p1", "PRJ/26/001"), p("p2", "PRJ/26/002")], T0))]);
    check(out.results[0].count === 2, "2 projects imported");
    await sync.importFiles([file("b.json", snap("co-b", "The Cove", [p("p1", "PRJ/26/001")], T0))]);
    let list = await sync.listProjects();
    check(list.length === 3, "two companies side by side, even with the same project id and number");
    check(list.map((x) => x.companyName).join() === "PI Projects,PI Projects,The Cove", "sorted by company then number");
    out = await sync.importFiles([file("a2.json", snap("co-a", "PI Projects", [p("p2", "PRJ/26/002")], T0 + 60000))]);
    list = await sync.listProjects();
    check(list.filter((x) => x.companyKey === "co-a").length === 1 && list.filter((x) => x.companyKey === "co-b").length === 1, "a newer list replaces that company's projects (p1 disappeared) and leaves the other company alone");
    out = await sync.importFiles([file("old.json", snap("co-a", "PI Projects", [p("p1", "PRJ/26/001"), p("p2", "PRJ/26/002")], T0))]);
    check(out.results[0].stale === true && (await sync.listProjects()).filter((x) => x.companyKey === "co-a").length === 1, "an OLDER list never replaces a newer one");
    check(out.lines.some((l) => /older than the one you already have/.test(l)), "and says so");
    const bad = snap("co-a", "PI Projects", [p("p1", "PRJ/26/001"), { id: "bad id", displayNumber: "x", clientName: "y" }], T0 + 120000);
    out = await sync.importFiles([file("bad.json", bad)]);
    check(out.results[0].skippedProjects === 1 && out.results[0].count === 1, "an unusable project is skipped and counted");
    const meta = await db.kvGet("projectsMeta");
    check(meta["co-a"].count === 1 && meta["co-b"].name === "The Cove", "per-company import details are kept");
    console.log("Confirmed: companies kept separate; newer replaces wholesale; older ignored; bad entries counted");
  }
  {
    // a project list also carries acknowledgements, so ordinary use confirms delivery
    const { sync, db } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createPing("x");
    await sync.exportBundle();
    const snap = P.makeProjectsSnapshot({ origin: DT, company: { key: "co-a", name: "PI" }, projects: [], acks: [{ id: rec.id, vv: { [dev]: 1 } }], now: new Date(T0) });
    const out = await sync.importFiles([file("projects.json", snap)]);
    check(out.results[0].acked === 1 && sync.recordState(await db.get("records", rec.id)) === "delivered", "importing just the project list confirms delivery");
    console.log("Confirmed: the project list file carries delivery confirmations too");
  }

  section("Conflicts: never merged or overwritten silently");
  {
    const { sync, db } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createRecord({ type: "ping", data: { note: "original" } }); // vv {ph:1}
    await sync.exportBundle();
    await sync.saveRecord(rec.id, { note: "phone edit" });                              // vv {ph:2}
    const desktopEdit = env({ id: rec.id, vv: { [dev]: 1, [DT]: 1 }, data: { note: "desktop edit" } }); // saw ph:1, edited
    let out = await sync.importFiles([file("c.json", bundleFrom([desktopEdit]))]);
    check(out.results[0].conflicts === 1 && out.lines.some((l) => /1 conflict need/.test(l)), "independent edits are reported as a conflict");
    check((await db.get("records", rec.id)).data.note === "phone edit", "the phone's version is untouched while the conflict is open");
    let conflicts = await sync.getConflicts();
    check(conflicts.length === 1 && conflicts[0].incoming.data.note === "desktop edit" && conflicts[0].local.data.note === "phone edit", "both versions are kept side by side");
    await sync.importFiles([file("c-again.json", bundleFrom([desktopEdit]))]);
    check((await sync.getConflicts()).length === 1, "seeing the same conflict again doesn't duplicate it");
    // a newer concurrent version from the desktop replaces the stored incoming; an older one doesn't
    const desktopEdit2 = env({ id: rec.id, vv: { [dev]: 1, [DT]: 2 }, data: { note: "desktop edit 2" } });
    await sync.importFiles([file("c2.json", bundleFrom([desktopEdit2]))]);
    check((await sync.getConflicts())[0].incoming.data.note === "desktop edit 2", "a newer incoming version updates the open conflict");
    await sync.importFiles([file("c-old.json", bundleFrom([desktopEdit]))]);
    check((await sync.getConflicts())[0].incoming.data.note === "desktop edit 2", "an older incoming version does not replace a newer one");
    check((await sync.getStatus()).conflicts === 1, "status reports the open conflict");

    // resolving: keep the desktop's version
    const resolved = await sync.resolveConflict(rec.id, "incoming");
    check(resolved.data.note === "desktop edit 2", "keeping the desktop's version uses its data");
    check(P.vvCovers(resolved.vv, { [dev]: 2 }) && P.vvCovers(resolved.vv, { [dev]: 1, [DT]: 2 }), "the resolution covers BOTH sides");
    check((await sync.getConflicts()).length === 0, "the conflict is closed");
    check(sync.recordState(await db.get("records", rec.id)) === "unsent", "the resolution is queued to go back to the desktop");
    check(P.decideInbound({ vv: { [dev]: 1, [DT]: 2 }, data: {} }, { vv: resolved.vv, data: resolved.data }) === "apply", "the desktop will accept it as a clean update");
    let threw = false; try { await sync.resolveConflict(rec.id, "incoming"); } catch (e) { threw = true; }
    check(threw, "resolving a conflict that isn't open is an error");
    console.log("Confirmed: conflicts stored with both versions, not duplicated, newest incoming kept; resolution supersedes both and syncs back");
  }
  {
    // keep the phone's version
    const { sync } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createRecord({ type: "ping", data: { note: "o" } });
    await sync.saveRecord(rec.id, { note: "phone" });
    await sync.importFiles([file("c.json", bundleFrom([env({ id: rec.id, vv: { [dev]: 1, [DT]: 1 }, data: { note: "desktop" } })]))]);
    const r = await sync.resolveConflict(rec.id, "local");
    check(r.data.note === "phone", "keeping the phone's version keeps its data");
    console.log("Confirmed: keep-mine works");
  }
  {
    // the desktop resolves first and sends the resolution: the phone's open conflict clears itself
    const { sync, db } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createRecord({ type: "ping", data: { note: "o" } });
    await sync.saveRecord(rec.id, { note: "phone" });
    await sync.importFiles([file("c.json", bundleFrom([env({ id: rec.id, vv: { [dev]: 1, [DT]: 1 }, data: { note: "desktop" } })]))]);
    check((await sync.getConflicts()).length === 1, "setup: a conflict is open");
    const out = await sync.importFiles([file("resolved.json", bundleFrom([env({ id: rec.id, vv: { [dev]: 2, [DT]: 2 }, data: { note: "phone" } })]))]);
    check(out.results[0].applied === 1 && (await sync.getConflicts()).length === 0, "a resolution from the desktop closes the phone's conflict automatically");
    check((await db.get("records", rec.id)).vv[DT] === 2, "and the record moves to the resolved version");
    console.log("Confirmed: if the desktop resolves first, the phone's open conflict clears itself");
  }
  {
    // both edited independently to the SAME content (e.g. both resolved identically): merge, no conflict
    const { sync, db } = await fresh();
    const dev = await sync.getDeviceId();
    const rec = await sync.createRecord({ type: "ping", data: { note: "o" } });
    await sync.saveRecord(rec.id, { note: "same" });
    const out = await sync.importFiles([file("same.json", bundleFrom([env({ id: rec.id, vv: { [dev]: 1, [DT]: 1 }, data: { note: "same" } })]))]);
    check(out.results[0].merged === 1 && (await sync.getConflicts()).length === 0, "identical independent edits are merged, not flagged");
    const merged = await db.get("records", rec.id);
    check(merged.vv[dev] === 2 && merged.vv[DT] === 1, "histories are joined");
    console.log("Confirmed: identical independent edits merge quietly");
  }

  section("Status for the screen");
  {
    const { sync } = await fresh();
    await sync.createPing("a"); await sync.createPing("b"); await sync.createPing("c");
    await sync.exportBundle();
    await sync.createPing("d");
    const s = await sync.getStatus();
    check(s.counts.unsent === 1 && s.counts.sent === 3 && s.counts.delivered === 0, "counts by delivery state");
    check(s.log.length >= 1 && /Saved fsp-bundle/.test(s.log[0].text), "recent activity is logged");
    console.log("Confirmed: unsent / sent / delivered counts and an activity log");
  }

  console.log("\n\u2705 ALL SYNC ENGINE TESTS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
