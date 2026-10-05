// Run: node tests/protocol.test.js
const assert = require("assert");
const P = require("../js/protocol.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");

const PH = "ph-aaaaaa";
const DT = "dt-bbbbbb";
const good = (over = {}) => ({
  fsp: 1, type: "ping", id: "rec-1", vv: { [PH]: 1 }, updatedAt: "2026-10-05T10:00:00.000Z",
  deleted: false, origin: PH, data: { note: "hi" }, ...over,
});

section("Version vectors");
check(P.vvCompare({}, {}) === "equal", "two empty vectors are equal");
check(P.vvCompare({ [PH]: 2 }, { [PH]: 2 }) === "equal", "identical vectors are equal");
check(P.vvCompare({ [PH]: 2 }, { [PH]: 1 }) === "a_after", "higher counter is after");
check(P.vvCompare({ [PH]: 1 }, { [PH]: 1, [DT]: 1 }) === "b_after", "a missing device counts as 0");
check(P.vvCompare({ [PH]: 2, [DT]: 0 }, { [PH]: 1, [DT]: 1 }) === "concurrent", "each ahead somewhere = concurrent");
check(P.vvCompare(undefined, { [PH]: 1 }) === "b_after", "undefined treated as empty");
check(P.vvCovers({ [PH]: 2 }, { [PH]: 2 }) && P.vvCovers({ [PH]: 3 }, { [PH]: 2 }) && !P.vvCovers({ [PH]: 1 }, { [PH]: 2 }), "covers = equal or ahead");
const orig = { [PH]: 1 };
const bumped = P.vvBump(orig, DT);
check(orig[DT] === undefined && bumped[DT] === 1 && bumped[PH] === 1, "vvBump returns a new object, never mutates");
check(P.vvBump(bumped, DT)[DT] === 2, "bump increments");
assert.deepStrictEqual(P.vvMerge({ [PH]: 3, [DT]: 1 }, { [PH]: 2, [DT]: 4 }), { [PH]: 3, [DT]: 4 });
check(P.vvSignature({ [DT]: 1, [PH]: 3 }) === P.vvSignature({ [PH]: 3, [DT]: 1 }), "signature ignores key order");
check(!P.isValidVv({ "BAD KEY": 1 }) && !P.isValidVv({ [PH]: -1 }) && !P.isValidVv({ [PH]: 1.5 }) && !P.isValidVv([]) && !P.isValidVv({}), "bad vectors rejected (empty rejected by default)");
check(P.isValidVv({}, { allowEmpty: true }), "empty allowed when asked");
let threw = false; try { P.vvBump({}, "Not Valid!"); } catch (e) { threw = true; }
check(threw, "bumping with an invalid device id throws");
console.log("Confirmed: comparison, covers, merge, bump (immutable), signature, validation");

section("Envelope validation");
check(P.validateEnvelope(good()).ok, "a good envelope passes");
check(P.validateEnvelope(good({ deleted: true, data: undefined })).ok, "a tombstone needs no data");
const bad = (over) => P.validateEnvelope(good(over));
check(!bad({ id: "../etc/passwd" }).ok, "path-like id rejected");
check(!bad({ id: "" }).ok && !bad({ id: undefined }).ok && !bad({ id: "x".repeat(65) }).ok, "empty/missing/over-long id rejected");
check(!bad({ type: "Ping Pong" }).ok, "bad type rejected");
check(!bad({ vv: { [PH]: -1 } }).ok && !bad({ vv: {} }).ok && !bad({ vv: undefined }).ok, "bad/empty vv rejected");
check(!bad({ updatedAt: "yesterday-ish" }).ok, "bad date rejected");
check(!bad({ origin: "Phone!" }).ok, "bad origin rejected");
check(!bad({ data: [] }).ok && !bad({ data: "x" }).ok, "non-object data rejected");
check(!bad({ companyKey: "a/b" }).ok && !bad({ projectId: "a b" }).ok, "bad company/project ids rejected");
check(!bad({ fsp: undefined }).ok, "missing protocol version rejected");
const newer = bad({ fsp: 2 });
check(!newer.ok && /newer version/.test(newer.errors.join()), "a newer format is refused with a clear reason");
check(!P.validateEnvelope(null).ok && !P.validateEnvelope([]).ok && !P.validateEnvelope("x").ok, "non-objects rejected");
console.log("Confirmed: good envelopes pass; path tricks, bad ids/vectors/dates/types and newer formats are refused");

section("Bundles: partial acceptance, nothing dropped silently");
const bundle = P.makeBundle({
  origin: PH,
  envelopes: [good(), good({ id: "bad id!" }), good({ id: "rec-3" })],
  acks: [{ id: "r1", vv: { [DT]: 1 } }, { id: "bad id", vv: { [DT]: 1 } }, { id: "r2", vv: {} }],
  now: new Date("2026-10-05T10:00:00Z"),
});
const vb = P.validateBundle(bundle);
check(vb.ok && vb.envelopes.length === 2 && vb.invalid.length === 1 && vb.invalid[0].index === 1, "the 2 good envelopes pass and the bad one is reported with its index");
check(vb.acks.length === 1 && vb.invalidAcks === 2, "bad acks are counted, not silently ignored");
check(!P.validateBundle({ ...bundle, fsp: 9 }).ok, "a bundle from a newer format is refused");
check(!P.validateBundle({ ...bundle, kind: "other" }).ok && !P.validateBundle({ ...bundle, envelopes: "x" }).ok && !P.validateBundle({ ...bundle, origin: "X!" }).ok && !P.validateBundle(null).ok, "malformed bundles refused");
console.log("Confirmed: partial acceptance with every rejection reported");

section("Project list snapshots");
const snap = P.makeProjectsSnapshot({
  origin: DT, company: { key: "co-12345678-aaaa", name: "PI Projects" },
  projects: [{ id: "p1", displayNumber: "PRJ/26/001", clientName: "Chel", siteLocation: "Lekki", status: "Active" }, { id: "bad id", displayNumber: "x", clientName: "y" }, { id: "p3", displayNumber: "PRJ/26/003", clientName: "Z" }],
  now: new Date("2026-10-05T10:00:00Z"),
});
const vs = P.validateProjectsSnapshot(snap);
check(vs.ok && vs.projects.length === 2 && vs.invalid.length === 1, "good projects kept, bad one reported");
check(vs.projects[1].siteLocation === "" && vs.projects[1].status === "", "optional fields default to empty");
check(!P.validateProjectsSnapshot({ ...snap, company: { key: "bad key", name: "x" } }).ok, "bad company key refused");
check(!P.validateProjectsSnapshot({ ...snap, kind: "bundle" }).ok && !P.validateProjectsSnapshot({ ...snap, fsp: 2 }).ok, "wrong kind / newer format refused");
console.log("Confirmed: snapshot validation");

section("Connection test files");
const probe = P.makeProbe({ origin: PH, note: "download test", now: new Date("2026-10-05T10:00:00Z") });
check(P.validateProbe(probe).ok, "a probe validates");
check(P.probeFilename(probe) === "fsp-probe-ph-aaaaaa-20261005-100000.json" && P.isSyncFilename(P.probeFilename(probe)), "probe file name follows the sync naming (so the folder-sync filter picks it up)");
check(P.parseFileText(JSON.stringify(probe)).kind === "probe", "a probe is recognised as one");
check(!P.validateProbe({ ...probe, origin: "BAD!" }).ok && !P.validateProbe({ ...probe, createdAt: "x" }).ok && !P.validateProbe({ ...probe, kind: "bundle" }).ok && !P.validateProbe({ ...probe, fsp: 3 }).ok && !P.validateProbe(null).ok, "bad probes refused");
check(P.makeProbe({ origin: PH, note: "x".repeat(500) }).note.length === 200, "the note is capped");
console.log("Confirmed: probe files validate, are named for the sync filter, and are recognised");

section("Reading files");
check(P.parseFileText(JSON.stringify(bundle)).kind === "bundle", "bundle detected");
check(P.parseFileText(JSON.stringify(snap)).kind === "projects", "project list detected");
check(!P.parseFileText("{ not json").ok && P.parseFileText("{ not json").kind === "invalid", "garbage reported as invalid JSON");
check(P.parseFileText('{"hello":1}').kind === "unknown" && P.parseFileText("42").kind === "unknown" && P.parseFileText("null").kind === "unknown", "other JSON reported as not a sync file");
console.log("Confirmed: bundle / project list / invalid / unknown all told apart");

section("File names");
const fixed = new Date("2026-10-05T09:08:07Z");
check(P.bundleFilename(P.makeBundle({ origin: PH, now: fixed }), "ab12") === "fsp-bundle-ph-aaaaaa-20261005-090807-ab12.json", "bundle name format");
check(/^fsp-bundle-ph-aaaaaa-\d{8}-\d{6}-[0-9a-f]{4}\.json$/.test(P.bundleFilename(P.makeBundle({ origin: PH }))), "random suffix when none given");
check(P.projectsFilename("Co-1234 5678-aaaa") === "fsp-projects-co123456.json", "project list name derived from the company key");
["fsp-bundle-x.json", "fsp-projects-ab.json", "fsp-bundle-ph-aaaaaa-20261005-090807-ab12 (1).json"].forEach((n) => check(P.isSyncFilename(n), `${n} should be recognised (incl. Chrome's " (1)" suffix)`));
["../fsp-bundle.json", "fsp-bundle.txt", "bundle.json", "fsp-/etc.json", "fsp-a b.json", "", null, undefined, "xfsp-a.json"].forEach((n) => check(!P.isSyncFilename(n), `${JSON.stringify(n)} must NOT be recognised`));
console.log("Confirmed: names are recognised, including Chrome's duplicate suffix, and nothing path-like gets through");

section("Deciding what to do with an incoming version");
const rec = (vv, data, deleted) => ({ vv, data, deleted });
check(P.decideInbound(null, rec({ [PH]: 1 }, { a: 1 })) === "apply", "unknown record -> apply");
check(P.decideInbound(rec({ [PH]: 1 }, { a: 1 }), rec({ [PH]: 1 }, { a: 1 })) === "duplicate", "same version again -> duplicate");
check(P.decideInbound(rec({ [PH]: 1 }, { a: 1 }), rec({ [PH]: 2 }, { a: 2 })) === "apply", "newer -> apply");
check(P.decideInbound(rec({ [PH]: 2 }, { a: 2 }), rec({ [PH]: 1 }, { a: 1 })) === "stale", "older -> stale");
check(P.decideInbound(rec({ [PH]: 2 }, { a: 2 }), rec({ [PH]: 1, [DT]: 1 }, { a: 3 })) === "conflict", "independent different edits -> conflict");
check(P.decideInbound(rec({ [PH]: 2 }, { a: 2, b: [1, 2] }), rec({ [PH]: 1, [DT]: 1 }, { b: [1, 2], a: 2 })) === "merge", "independent but identical content -> merge (key order irrelevant)");
check(P.decideInbound(rec({ [PH]: 2 }, { a: 1 }, true), rec({ [DT]: 1 }, { a: 99 }, true)) === "merge", "both deleted -> merge regardless of leftover data");
check(P.decideInbound(rec({ [PH]: 2 }, { a: 1 }, true), rec({ [DT]: 1 }, { a: 1 }, false)) === "conflict", "deleted on one side but edited on the other -> conflict");
console.log("Confirmed: apply / duplicate / stale / conflict / merge");

section("Resolving a conflict");
const L = rec({ [PH]: 2 }, { a: "phone" });
const I = rec({ [PH]: 1, [DT]: 1 }, { a: "desktop" });
const keepLocal = P.resolveConflict({ local: L, incoming: I, keep: "local", deviceId: PH, now: fixed });
assert.deepStrictEqual(keepLocal.data, { a: "phone" });
check(P.vvCovers(keepLocal.vv, L.vv) && P.vvCovers(keepLocal.vv, I.vv) && P.vvCompare(keepLocal.vv, L.vv) === "a_after" && P.vvCompare(keepLocal.vv, I.vv) === "a_after", "the resolution supersedes BOTH sides");
check(P.decideInbound(rec(I.vv, I.data), rec(keepLocal.vv, keepLocal.data)) === "apply", "the other side applies the resolution cleanly");
check(P.decideInbound(rec(L.vv, L.data), rec(keepLocal.vv, keepLocal.data)) === "apply", "and so does the side that resolved it, if it ever sees it again");
const keepIncoming = P.resolveConflict({ local: L, incoming: I, keep: "incoming", deviceId: PH, now: fixed });
assert.deepStrictEqual(keepIncoming.data, { a: "desktop" });
const keepDeleted = P.resolveConflict({ local: rec({ [PH]: 2 }, { a: 1 }, true), incoming: I, keep: "local", deviceId: PH });
check(keepDeleted.deleted === true, "keeping a deletion stays deleted");
threw = false; try { P.resolveConflict({ local: L, incoming: I, keep: "both", deviceId: PH }); } catch (e) { threw = true; }
check(threw, "an unknown choice is refused");
const bothResolveSame = [
  P.resolveConflict({ local: L, incoming: I, keep: "local", deviceId: PH }),
  P.resolveConflict({ local: I, incoming: L, keep: "incoming", deviceId: DT }),
];
check(P.vvCompare(bothResolveSame[0].vv, bothResolveSame[1].vv) === "concurrent" && P.decideInbound(bothResolveSame[0], bothResolveSame[1]) === "merge",
  "if BOTH sides resolve the same conflict the same way, the two resolutions merge instead of conflicting again");
const bothResolveDifferently = P.resolveConflict({ local: I, incoming: L, keep: "local", deviceId: DT });
check(P.decideInbound(bothResolveSame[0], bothResolveDifferently) === "conflict", "if they resolve it DIFFERENTLY, that is a real conflict again (asked again, nothing lost)");
console.log("Confirmed: resolutions supersede both sides; double resolution merges; differing resolutions re-conflict rather than losing data");

section("Chaos simulation: two replicas always converge");
// Seeded, so any failure is reproducible.
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function simulate(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 9, 5, 10, 0, ++clock)).toISOString();
  const replicas = [
    { id: PH, recs: new Map() },
    { id: DT, recs: new Map() },
  ];
  const allIds = new Set();
  let nextId = 0;

  const toEnv = (r, rec, id) => ({ fsp: 1, type: "ping", id, vv: rec.vv, updatedAt: rec.updatedAt, deleted: !!rec.deleted, origin: r.id, data: rec.data });

  // Deterministic policy, identical on both sides for the same pair of versions.
  const winner = (a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    return P.vvSignature(a.vv) > P.vvSignature(b.vv) ? a : b;
  };

  function receive(r, env) {
    const local = r.recs.get(env.id);
    const incoming = { vv: env.vv, data: env.data, deleted: env.deleted, updatedAt: env.updatedAt };
    const action = P.decideInbound(local, incoming);
    if (action === "apply") r.recs.set(env.id, { ...incoming });
    else if (action === "merge") r.recs.set(env.id, { ...local, vv: P.vvMerge(local.vv, incoming.vv) });
    else if (action === "conflict") {
      const w = winner(local, incoming);
      const resolved = P.resolveConflict({ local, incoming, keep: w === local ? "local" : "incoming", deviceId: r.id, now: new Date(Date.UTC(2026, 9, 5, 10, 0, ++clock)) });
      r.recs.set(env.id, { ...resolved });
    }
  }

  const steps = 40 + Math.floor(rnd() * 80);
  for (let s = 0; s < steps; s++) {
    const r = pick(replicas);
    const other = replicas[0] === r ? replicas[1] : replicas[0];
    const op = rnd();
    if (op < 0.15 || r.recs.size === 0) {
      const id = `rec-${nextId++}`;
      allIds.add(id);
      r.recs.set(id, { vv: P.vvBump({}, r.id), data: { v: Math.floor(rnd() * 1000) }, deleted: false, updatedAt: tick() });
    } else if (op < 0.55) {
      const id = pick([...r.recs.keys()]);
      const cur = r.recs.get(id);
      r.recs.set(id, { vv: P.vvBump(cur.vv, r.id), data: { v: Math.floor(rnd() * 1000) }, deleted: false, updatedAt: tick() });
    } else if (op < 0.62) {
      const id = pick([...r.recs.keys()]);
      const cur = r.recs.get(id);
      r.recs.set(id, { vv: P.vvBump(cur.vv, r.id), data: cur.data, deleted: true, updatedAt: tick() });
    } else {
      // an unreliable delivery: each envelope may be lost, duplicated, and the order shuffled
      const envs = [];
      for (const [id, rec] of r.recs) {
        if (rnd() < 0.3) continue;
        envs.push(toEnv(r, rec, id));
        if (rnd() < 0.25) envs.push(toEnv(r, rec, id));
      }
      envs.sort(() => rnd() - 0.5);
      envs.forEach((e) => receive(other, e));
    }
  }

  // then reliable exchanges until stable (bounded: it must settle in a few rounds)
  for (let round = 0; round < 6; round++) {
    for (const [from, to] of [[replicas[0], replicas[1]], [replicas[1], replicas[0]]]) {
      for (const [id, rec] of [...from.recs]) receive(to, toEnv(from, rec, id));
    }
  }

  const [a, b] = replicas;
  check(a.recs.size === b.recs.size, `seed ${seed}: replicas hold a different number of records (${a.recs.size} vs ${b.recs.size})`);
  allIds.forEach((id) => check(a.recs.has(id) && b.recs.has(id), `seed ${seed}: record ${id} was lost`));
  for (const [id, ra] of a.recs) {
    const rb = b.recs.get(id);
    check(P.vvCompare(ra.vv, rb.vv) === "equal", `seed ${seed}: ${id} ended with different version vectors (${P.vvSignature(ra.vv)} vs ${P.vvSignature(rb.vv)})`);
    check(P.sameContent(ra, rb), `seed ${seed}: ${id} ended with different content`);
  }
  return { records: a.recs.size, steps };
}

let totalRecords = 0;
const RUNS = 500;
for (let seed = 1; seed <= RUNS; seed++) totalRecords += simulate(seed).records;
console.log(`Confirmed: ${RUNS} random histories (${totalRecords} records) -- with lost, duplicated and reordered deliveries -- all ended with both replicas identical and nothing lost`);

console.log("\n\u2705 ALL SYNC PROTOCOL TESTS PASSED");
