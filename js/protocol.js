/**
 * FieldScan Pro sync protocol, version 1.
 *
 * Shared, byte-for-byte, by the phone app and the desktop app: both sides
 * use exactly this file, so they cannot disagree about what a record, a
 * bundle, or a conflict is. No dependencies; works as a browser <script>
 * (global FSPProtocol) and as a Node module.
 *
 * Why version vectors and not timestamps: with two devices whose clocks
 * can differ, "newest edit wins" can silently throw away the wrong edit.
 * A version vector is a counter per device, bumped each time THAT device
 * edits the record. Comparing two vectors says for certain whether one
 * edit came after the other (it saw it) or whether they were made
 * independently -- which is the only real conflict, and the one you're
 * asked about.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSPProtocol = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  const TYPE_PATTERN = /^[a-z0-9-]{1,32}$/;
  const DEVICE_PATTERN = /^[a-z0-9-]{1,32}$/;

  // ---------- version vectors ----------

  function isValidVv(vv, { allowEmpty = false } = {}) {
    if (!vv || typeof vv !== "object" || Array.isArray(vv)) return false;
    const keys = Object.keys(vv);
    if (!keys.length && !allowEmpty) return false;
    return keys.every((k) => DEVICE_PATTERN.test(k) && Number.isSafeInteger(vv[k]) && vv[k] >= 0);
  }

  /** "equal" | "a_after" (a has seen everything b has, and more) | "b_after" | "concurrent" */
  function vvCompare(a, b) {
    a = a || {};
    b = b || {};
    let aAhead = false;
    let bAhead = false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const x = a[k] || 0;
      const y = b[k] || 0;
      if (x > y) aAhead = true;
      if (y > x) bAhead = true;
    }
    if (aAhead && bAhead) return "concurrent";
    if (aAhead) return "a_after";
    if (bAhead) return "b_after";
    return "equal";
  }

  /** true when a has seen everything b has (equal or ahead). */
  function vvCovers(a, b) {
    const c = vvCompare(a, b);
    return c === "equal" || c === "a_after";
  }

  function vvMerge(a, b) {
    const out = {};
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      out[k] = Math.max((a || {})[k] || 0, (b || {})[k] || 0);
    }
    return out;
  }

  function vvBump(vv, deviceId) {
    if (!DEVICE_PATTERN.test(deviceId || "")) throw new Error("vvBump: invalid device id");
    return { ...(vv || {}), [deviceId]: ((vv || {})[deviceId] || 0) + 1 };
  }

  function vvSignature(vv) {
    return Object.keys(vv || {}).sort().map((k) => k + "." + vv[k]).join("_");
  }

  // ---------- helpers ----------

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }

  function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (c && c.getRandomValues) c.getRandomValues(arr);
    else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function newDeviceId(prefix) {
    return `${prefix}-${randomHex(3)}`;
  }

  function isIsoDate(s) {
    return typeof s === "string" && !isNaN(new Date(s).getTime());
  }

  function tooNew(obj) {
    return Number.isInteger(obj && obj.fsp) && obj.fsp > PROTOCOL_VERSION;
  }

  // ---------- records ----------

  function makeEnvelope({ type, id, vv, updatedAt, deleted, data, origin, companyKey, projectId }) {
    const env = {
      fsp: PROTOCOL_VERSION,
      type,
      id,
      vv,
      updatedAt,
      deleted: !!deleted,
      origin,
      data: data || {},
    };
    if (companyKey) env.companyKey = companyKey;
    if (projectId) env.projectId = projectId;
    return env;
  }

  function validateEnvelope(env) {
    const errors = [];
    if (!env || typeof env !== "object" || Array.isArray(env)) return { ok: false, errors: ["not an object"] };
    if (!Number.isInteger(env.fsp) || env.fsp < 1) errors.push("missing protocol version");
    else if (env.fsp > PROTOCOL_VERSION) errors.push(`made by a newer version of the app (format ${env.fsp}, this app understands ${PROTOCOL_VERSION})`);
    if (typeof env.type !== "string" || !TYPE_PATTERN.test(env.type)) errors.push("bad or missing type");
    if (typeof env.id !== "string" || !ID_PATTERN.test(env.id)) errors.push("bad or missing id");
    if (!isValidVv(env.vv)) errors.push("bad or missing version vector");
    if (!isIsoDate(env.updatedAt)) errors.push("bad or missing updatedAt");
    if (typeof env.origin !== "string" || !DEVICE_PATTERN.test(env.origin)) errors.push("bad or missing origin");
    if (env.deleted !== undefined && typeof env.deleted !== "boolean") errors.push("deleted must be true or false");
    if (!env.deleted && (!env.data || typeof env.data !== "object" || Array.isArray(env.data))) errors.push("data must be an object");
    if (env.companyKey !== undefined && (typeof env.companyKey !== "string" || !ID_PATTERN.test(env.companyKey))) errors.push("bad companyKey");
    if (env.projectId !== undefined && (typeof env.projectId !== "string" || !ID_PATTERN.test(env.projectId))) errors.push("bad projectId");
    return { ok: errors.length === 0, errors };
  }

  // ---------- bundles ----------

  function makeBundle({ origin, envelopes, acks, now }) {
    return {
      fsp: PROTOCOL_VERSION,
      kind: "bundle",
      origin,
      createdAt: (now || new Date()).toISOString(),
      envelopes: envelopes || [],
      acks: acks || [],
    };
  }

  function validateAcks(acks) {
    const valid = [];
    let invalid = 0;
    (Array.isArray(acks) ? acks : []).forEach((a) => {
      if (a && typeof a.id === "string" && ID_PATTERN.test(a.id) && isValidVv(a.vv)) valid.push({ id: a.id, vv: a.vv });
      else invalid++;
    });
    return { valid, invalid };
  }

  /**
   * Partial acceptance: a bundle with one bad envelope still delivers the
   * good ones, and the bad one is REPORTED (never silently dropped).
   */
  function validateBundle(obj) {
    const errors = [];
    if (!obj || typeof obj !== "object") return { ok: false, errors: ["not an object"], envelopes: [], invalid: [], acks: [], invalidAcks: 0 };
    if (tooNew(obj)) errors.push(`made by a newer version of the app (format ${obj.fsp}, this app understands ${PROTOCOL_VERSION})`);
    else if (!Number.isInteger(obj.fsp) || obj.fsp < 1) errors.push("missing protocol version");
    if (obj.kind !== "bundle") errors.push("not a bundle");
    if (typeof obj.origin !== "string" || !DEVICE_PATTERN.test(obj.origin)) errors.push("bad or missing origin");
    if (!Array.isArray(obj.envelopes)) errors.push("envelopes must be a list");
    if (errors.length) return { ok: false, errors, envelopes: [], invalid: [], acks: [], invalidAcks: 0 };

    const envelopes = [];
    const invalid = [];
    obj.envelopes.forEach((env, index) => {
      const v = validateEnvelope(env);
      if (v.ok) envelopes.push(env);
      else invalid.push({ index, errors: v.errors });
    });
    const acks = validateAcks(obj.acks);
    return { ok: true, errors: [], envelopes, invalid, acks: acks.valid, invalidAcks: acks.invalid, origin: obj.origin };
  }

  // ---------- project list (desktop -> phone) ----------

  function makeProjectsSnapshot({ origin, company, projects, acks, now }) {
    return {
      fsp: PROTOCOL_VERSION,
      kind: "projects",
      origin,
      generatedAt: (now || new Date()).toISOString(),
      company: { key: company.key, name: company.name },
      projects: projects || [],
      acks: acks || [],
    };
  }

  function validateProjectsSnapshot(obj) {
    const errors = [];
    if (!obj || typeof obj !== "object") return { ok: false, errors: ["not an object"], projects: [], acks: [], invalidAcks: 0 };
    if (tooNew(obj)) errors.push(`made by a newer version of the app (format ${obj.fsp}, this app understands ${PROTOCOL_VERSION})`);
    else if (!Number.isInteger(obj.fsp) || obj.fsp < 1) errors.push("missing protocol version");
    if (obj.kind !== "projects") errors.push("not a project list");
    if (typeof obj.origin !== "string" || !DEVICE_PATTERN.test(obj.origin)) errors.push("bad or missing origin");
    if (!isIsoDate(obj.generatedAt)) errors.push("bad or missing generatedAt");
    if (!obj.company || typeof obj.company.key !== "string" || !ID_PATTERN.test(obj.company.key) || typeof obj.company.name !== "string") errors.push("bad or missing company");
    if (!Array.isArray(obj.projects)) errors.push("projects must be a list");
    if (errors.length) return { ok: false, errors, projects: [], acks: [], invalidAcks: 0 };

    const projects = [];
    const invalid = [];
    obj.projects.forEach((p, index) => {
      if (p && typeof p.id === "string" && ID_PATTERN.test(p.id) && typeof p.displayNumber === "string" && typeof p.clientName === "string") {
        projects.push({
          id: p.id,
          displayNumber: p.displayNumber,
          clientName: p.clientName,
          siteLocation: typeof p.siteLocation === "string" ? p.siteLocation : "",
          status: typeof p.status === "string" ? p.status : "",
        });
      } else invalid.push({ index });
    });
    const acks = validateAcks(obj.acks);
    return { ok: true, errors: [], company: obj.company, generatedAt: obj.generatedAt, origin: obj.origin, projects, invalid, acks: acks.valid, invalidAcks: acks.invalid };
  }

  // ---------- connection test file (phone -> desktop) ----------

  /** A tiny file with no data in it, used only to prove the download -> Drive -> desktop path works. */
  function makeProbe({ origin, note, now }) {
    return { fsp: PROTOCOL_VERSION, kind: "probe", origin, createdAt: (now || new Date()).toISOString(), note: String(note || "").slice(0, 200) };
  }

  function validateProbe(obj) {
    const errors = [];
    if (!obj || typeof obj !== "object") return { ok: false, errors: ["not an object"] };
    if (tooNew(obj)) errors.push(`made by a newer version of the app (format ${obj.fsp}, this app understands ${PROTOCOL_VERSION})`);
    else if (!Number.isInteger(obj.fsp) || obj.fsp < 1) errors.push("missing protocol version");
    if (obj.kind !== "probe") errors.push("not a connection test file");
    if (typeof obj.origin !== "string" || !DEVICE_PATTERN.test(obj.origin)) errors.push("bad or missing origin");
    if (!isIsoDate(obj.createdAt)) errors.push("bad or missing createdAt");
    return { ok: errors.length === 0, errors };
  }

  /** Parses file text and says what kind of sync file it is. */
  function parseFileText(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      return { ok: false, kind: "invalid", errors: ["not valid JSON"] };
    }
    if (value && value.kind === "bundle") return { ok: true, kind: "bundle", value };
    if (value && value.kind === "projects") return { ok: true, kind: "projects", value };
    if (value && value.kind === "probe") return { ok: true, kind: "probe", value };
    return { ok: false, kind: "unknown", errors: ["not a FieldScan Pro sync file"] };
  }

  // ---------- file names ----------

  function stamp(date) {
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
  }

  function bundleFilename(bundle, rand) {
    return `fsp-bundle-${bundle.origin}-${stamp(new Date(bundle.createdAt))}-${rand || randomHex(2)}.json`;
  }

  function probeFilename(probe) {
    return `fsp-probe-${probe.origin}-${stamp(new Date(probe.createdAt))}.json`;
  }

  function projectsFilename(companyKey) {
    return `fsp-projects-${String(companyKey).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase()}.json`;
  }

  /**
   * Files this protocol owns. Accepts the " (1)" suffix Chrome appends when a
   * download name already exists, and nothing that could escape a folder.
   */
  function isSyncFilename(name) {
    return /^fsp-[A-Za-z0-9._-]+( \(\d+\))?\.json$/.test(String(name || ""));
  }

  // ---------- merging ----------

  function sameContent(a, b) {
    if (!!a.deleted && !!b.deleted) return true;
    return !!a.deleted === !!b.deleted && stableStringify(a.data || {}) === stableStringify(b.data || {});
  }

  /**
   * What to do with an incoming version of a record, given what we hold.
   *   apply     -> incoming has seen everything we have: take it
   *   duplicate -> same version again: nothing to do
   *   stale     -> we already have something newer: ignore it
   *   merge     -> both edited independently but ended up with identical
   *                content (e.g. you resolved the same conflict on both
   *                sides): no data change, just join the two histories
   *   conflict  -> genuinely different independent edits: ask the user
   */
  function decideInbound(local, incoming) {
    if (!local) return "apply";
    const c = vvCompare(local.vv, incoming.vv);
    if (c === "equal") return "duplicate";
    if (c === "b_after") return "apply";
    if (c === "a_after") return "stale";
    return sameContent(local, incoming) ? "merge" : "conflict";
  }

  /**
   * The user's answer to a conflict. The new version's vector covers BOTH
   * sides, so once it is synced it supersedes both everywhere.
   */
  function resolveConflict({ local, incoming, keep, deviceId, now }) {
    if (keep !== "local" && keep !== "incoming") throw new Error("resolveConflict: keep must be 'local' or 'incoming'");
    const chosen = keep === "incoming" ? incoming : local;
    return {
      data: chosen.data || {},
      deleted: !!chosen.deleted,
      vv: vvBump(vvMerge(local.vv, incoming.vv), deviceId),
      updatedAt: (now || new Date()).toISOString(),
    };
  }

  return {
    PROTOCOL_VERSION,
    isValidVv, vvCompare, vvCovers, vvMerge, vvBump, vvSignature,
    stableStringify, randomHex, newDeviceId,
    makeEnvelope, validateEnvelope,
    makeBundle, validateBundle,
    makeProjectsSnapshot, validateProjectsSnapshot,
    makeProbe, validateProbe,
    parseFileText,
    bundleFilename, projectsFilename, probeFilename, isSyncFilename,
    sameContent, decideInbound, resolveConflict,
  };
});
