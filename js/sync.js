/**
 * Phone-side sync engine.
 *
 * How data moves (no Google sign-in involved anywhere in this app):
 *   phone -> desktop : exportBundle() saves ONE .json file to the phone's
 *                      Downloads folder; a folder-sync app uploads it to
 *                      Drive; the desktop reads it.
 *   desktop -> phone : the desktop writes files into the shared Drive
 *                      folder; the sync app brings them to the phone; the
 *                      user picks them with Import and importFiles() merges
 *                      them in.
 *
 * Delivery is CONFIRMED, never assumed. Every file the desktop writes
 * carries acknowledgements ("I hold record X at version V"). Until a
 * record is acknowledged it counts as undelivered and is simply included
 * again in every export -- so a file that never made it through Drive can't
 * silently lose data. Re-sending is harmless because applying the same
 * version twice is a no-op.
 *
 * Each record carries a version vector (see protocol.js). Two independent
 * edits of the same record become a conflict that waits for the user; they
 * are never merged or overwritten silently.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSPSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOG_LIMIT = 50;

  /** Default delivery of an export file: an ordinary browser download. */
  function browserDownload(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 2000);
    return Promise.resolve();
  }

  function createSync({ db, protocol, download, now, uuid }) {
    const P = protocol;
    const clock = now || (() => new Date());
    const deliver = download || browserDownload;
    const newRecordId = uuid || (() => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : P.randomHex(16)));
    let deviceIdCache = null;

    async function getDeviceId() {
      if (deviceIdCache) return deviceIdCache;
      let id = await db.kvGet("deviceId");
      if (!id) {
        id = P.newDeviceId("ph");
        await db.kvSet("deviceId", id);
      }
      deviceIdCache = id;
      return id;
    }

    async function log(text) {
      const entries = await db.kvGet("syncLog", []);
      entries.unshift({ at: clock().toISOString(), text });
      await db.kvSet("syncLog", entries.slice(0, LOG_LIMIT));
    }

    // ---------- local records ----------

    /** "unsent" -> never exported; "sent" -> exported, awaiting confirmation; "delivered" -> confirmed by the desktop */
    function recordState(rec) {
      if (P.vvCovers(rec.deliveredVv || {}, rec.vv)) return "delivered";
      if (P.vvCovers(rec.exportedVv || {}, rec.vv)) return "sent";
      return "unsent";
    }

    async function createRecord({ type, data, companyKey, projectId }) {
      const deviceId = await getDeviceId();
      const rec = {
        id: newRecordId(),
        type,
        companyKey: companyKey || null,
        projectId: projectId || null,
        vv: P.vvBump({}, deviceId),
        data: data || {},
        deleted: false,
        updatedAt: clock().toISOString(),
        origin: deviceId,
        deliveredVv: {},
        exportedVv: {},
      };
      await db.put("records", rec);
      return rec;
    }

    async function saveRecord(id, data) {
      const deviceId = await getDeviceId();
      return db.readModifyWrite([{ store: "records", key: id }], ([rec]) => {
        if (!rec) throw new Error("No such record: " + id);
        const next = { ...rec, data, vv: P.vvBump(rec.vv, deviceId), updatedAt: clock().toISOString(), origin: deviceId, deleted: false };
        return { ops: [{ op: "put", store: "records", value: next }], result: next };
      });
    }

    /** Deleting is an edit like any other (a tombstone), so it syncs and can conflict. */
    async function deleteRecord(id) {
      const deviceId = await getDeviceId();
      return db.readModifyWrite([{ store: "records", key: id }], ([rec]) => {
        if (!rec) throw new Error("No such record: " + id);
        const next = { ...rec, deleted: true, vv: P.vvBump(rec.vv, deviceId), updatedAt: clock().toISOString(), origin: deviceId };
        return { ops: [{ op: "put", store: "records", value: next }], result: next };
      });
    }

    async function getRecords(type) {
      const rows = type ? await db.getAllByIndex("records", "byType", type) : await db.getAll("records");
      return rows.filter((r) => !r.deleted).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }

    // ---------- export (phone -> desktop) ----------

    function toEnvelope(rec, deviceId) {
      return P.makeEnvelope({
        type: rec.type,
        id: rec.id,
        vv: rec.vv,
        updatedAt: rec.updatedAt,
        deleted: rec.deleted,
        data: rec.data,
        origin: deviceId,
        companyKey: rec.companyKey || undefined,
        projectId: rec.projectId || undefined,
      });
    }

    /**
     * Saves one bundle file containing every record the desktop hasn't
     * confirmed yet, plus acknowledgements of everything this phone holds
     * (so the desktop can stop re-sending those).
     */
    async function exportBundle(options) {
      const opts = options || {};
      const send = opts.deliver || deliver;
      const deviceId = await getDeviceId();
      const all = await db.getAll("records");
      if (!all.length) return { empty: true };
      // Records already waiting inside a file of ours in the shared folder need no second copy.
      const waiting = opts.waitingInFolder || {};
      const undelivered = all.filter((r) => !P.vvCovers(r.deliveredVv || {}, r.vv) && !(waiting[r.id] && P.vvCovers(waiting[r.id], r.vv)));
      // Folder sync calls this every time; writing a file when there is nothing
      // new to say would only fill the folder with identical files.
      if (opts.onlyIfNeeded && !undelivered.length && !opts.includeAcks) return { nothingToSend: true, sent: 0, acks: 0 };
      const bundle = P.makeBundle({
        origin: deviceId,
        envelopes: undelivered.map((r) => toEnvelope(r, deviceId)),
        acks: all.map((r) => ({ id: r.id, vv: r.vv })),
        now: clock(),
      });
      const filename = P.bundleFilename(bundle);
      await send(filename, JSON.stringify(bundle, null, 2), "application/json");
      // Only mark as exported once the download has been handed to the browser.
      await db.putMany("records", undelivered.map((r) => ({ ...r, exportedVv: r.vv })));
      await log(`Saved ${filename} (${undelivered.length} record${undelivered.length === 1 ? "" : "s"}, ${all.length} acknowledgement${all.length === 1 ? "" : "s"})`);
      return { filename, sent: undelivered.length, acks: all.length };
    }

    // ---------- import (desktop -> phone) ----------

    function conflictSnapshot(x) {
      return { vv: x.vv, data: x.data, deleted: !!x.deleted, updatedAt: x.updatedAt, origin: x.origin };
    }

    /** Applies one incoming record version, atomically. Returns what happened. */
    function applyEnvelope(env) {
      return db.readModifyWrite(
        [{ store: "records", key: env.id }, { store: "conflicts", key: env.id }],
        ([local, conflict]) => {
          const incoming = { vv: env.vv, data: env.data, deleted: !!env.deleted, updatedAt: env.updatedAt, origin: env.origin };
          const action = P.decideInbound(local, incoming);
          const ops = [];
          const conflictObsolete = (newVv) =>
            conflict && P.vvCovers(newVv, conflict.incoming.vv) && P.vvCovers(newVv, conflict.local.vv);

          if (action === "apply") {
            ops.push({
              op: "put",
              store: "records",
              value: {
                id: env.id,
                type: env.type,
                companyKey: env.companyKey || null,
                projectId: env.projectId || null,
                vv: env.vv,
                data: env.data,
                deleted: !!env.deleted,
                updatedAt: env.updatedAt,
                origin: env.origin,
                deliveredVv: P.vvMerge(local ? local.deliveredVv : {}, env.vv),
                exportedVv: local ? local.exportedVv : {},
              },
            });
            if (conflictObsolete(env.vv)) ops.push({ op: "delete", store: "conflicts", key: env.id });
          } else if (action === "merge") {
            const mergedVv = P.vvMerge(local.vv, env.vv);
            ops.push({ op: "put", store: "records", value: { ...local, vv: mergedVv, deliveredVv: P.vvMerge(local.deliveredVv || {}, env.vv) } });
            if (conflictObsolete(mergedVv)) ops.push({ op: "delete", store: "conflicts", key: env.id });
          } else if (action === "conflict") {
            // Keep the newest incoming version per record; an older one never replaces a newer one.
            if (!conflict || !P.vvCovers(conflict.incoming.vv, env.vv)) {
              ops.push({
                op: "put",
                store: "conflicts",
                value: { id: env.id, type: env.type, local: conflictSnapshot(local), incoming: conflictSnapshot(incoming), detectedAt: clock().toISOString() },
              });
            }
          }
          return { ops, result: action };
        },
        ["records", "conflicts"],
      );
    }

    /** Marks records as delivered when the desktop says it holds them at (or beyond) our version. */
    function applyAcks(acks) {
      if (!acks.length) return Promise.resolve(0);
      return db.readModifyWrite(
        acks.map((a) => ({ store: "records", key: a.id })),
        (recs) => {
          const ops = [];
          recs.forEach((rec, i) => {
            if (!rec) return;
            const ack = acks[i];
            if (P.vvCovers(ack.vv, rec.vv) && !P.vvCovers(rec.deliveredVv || {}, rec.vv)) {
              ops.push({ op: "put", store: "records", value: { ...rec, deliveredVv: P.vvMerge(rec.deliveredVv || {}, ack.vv) } });
            }
          });
          return { ops, result: ops.length };
        },
        ["records"],
      );
    }

    async function importBundle(name, value) {
      const v = P.validateBundle(value);
      if (!v.ok) return { file: name, ok: false, reason: v.errors.join("; ") };
      const deviceId = await getDeviceId();
      if (v.origin === deviceId) {
        return { file: name, ok: true, kind: "bundle", own: true, applied: 0, duplicate: 0, stale: 0, merged: 0, conflicts: 0, acked: 0, rejected: [], invalidAcks: 0 };
      }
      // keyed by the protocol's decision names (apply / duplicate / stale / merge / conflict)
      const counts = { apply: 0, duplicate: 0, stale: 0, merge: 0, conflict: 0 };
      for (const env of v.envelopes) counts[await applyEnvelope(env)]++;
      const acked = await applyAcks(v.acks);
      return {
        file: name, ok: true, kind: "bundle", origin: v.origin,
        applied: counts.apply, duplicate: counts.duplicate, stale: counts.stale, merged: counts.merge, conflicts: counts.conflict,
        acked, rejected: v.invalid, invalidAcks: v.invalidAcks,
      };
    }

    async function importProjects(name, value) {
      const v = P.validateProjectsSnapshot(value);
      if (!v.ok) return { file: name, ok: false, reason: v.errors.join("; ") };
      const meta = await db.kvGet("projectsMeta", {});
      const known = meta[v.company.key];
      if (known && new Date(known.generatedAt) > new Date(v.generatedAt)) {
        return { file: name, ok: true, kind: "projects", company: v.company.name, stale: true, count: 0, acked: 0 };
      }
      await db.replaceByIndex(
        "projects", "byCompany", v.company.key,
        v.projects.map((p) => ({ key: `${v.company.key}:${p.id}`, companyKey: v.company.key, companyName: v.company.name, ...p })),
      );
      meta[v.company.key] = { name: v.company.name, generatedAt: v.generatedAt, importedAt: clock().toISOString(), count: v.projects.length };
      await db.kvSet("projectsMeta", meta);
      const acked = await applyAcks(v.acks);
      return { file: name, ok: true, kind: "projects", company: v.company.name, count: v.projects.length, skippedProjects: v.invalid.length, acked };
    }

    async function importText(name, text) {
      const parsed = P.parseFileText(text);
      if (!parsed.ok) return { file: name, ok: false, reason: parsed.errors[0] };
      if (parsed.kind === "probe") return { file: name, ok: true, kind: "probe" }; // a connection test: nothing to import
      return parsed.kind === "bundle" ? importBundle(name, parsed.value) : importProjects(name, parsed.value);
    }

    /** Reads and merges the files the user picked. One bad file never stops the others. */
    async function importFiles(files) {
      const results = [];
      for (const f of files) {
        let text;
        try {
          text = await f.text();
        } catch (e) {
          results.push({ file: f.name, ok: false, reason: "could not read the file" });
          continue;
        }
        try {
          results.push(await importText(f.name, text));
        } catch (e) {
          results.push({ file: f.name, ok: false, reason: "unexpected error: " + e.message });
        }
      }
      const lines = summarizeImport(results);
      await log("Imported: " + lines.join(" "));
      return { results, lines };
    }

    function summarizeImport(results) {
      const lines = [];
      const bad = results.filter((r) => !r.ok);
      const good = results.filter((r) => r.ok);
      lines.push(`${results.length} file${results.length === 1 ? "" : "s"} read.`);
      good.filter((r) => r.kind === "projects").forEach((r) =>
        lines.push(r.stale ? `Project list for ${r.company} was older than the one you already have, so it was left alone.` : `Project list for ${r.company}: ${r.count} project${r.count === 1 ? "" : "s"}.`));
      const sum = (k) => good.reduce((n, r) => n + (r[k] || 0), 0);
      if (good.some((r) => r.kind === "bundle" && !r.own)) {
        lines.push(`Records: ${sum("applied")} new or updated, ${sum("duplicate") + sum("stale")} already up to date${sum("merged") ? `, ${sum("merged")} merged` : ""}.`);
      }
      if (good.some((r) => r.own)) lines.push("One file was made by this phone, so it was skipped.");
      if (sum("conflicts")) lines.push(`${sum("conflicts")} conflict${sum("conflicts") === 1 ? "" : "s"} need your decision.`);
      if (sum("acked")) lines.push(`The desktop confirmed delivery of ${sum("acked")} record${sum("acked") === 1 ? "" : "s"}.`);
      const rejected = good.reduce((n, r) => n + (r.rejected ? r.rejected.length : 0), 0);
      if (rejected) lines.push(`${rejected} record${rejected === 1 ? "" : "s"} inside the files could not be used.`);
      bad.forEach((r) => lines.push(`Could not use ${r.file}: ${r.reason}.`));
      return lines;
    }

    // ---------- conflicts ----------

    function getConflicts() {
      return db.getAll("conflicts");
    }

    /** keep: "local" (this phone's version) or "incoming" (the desktop's). */
    async function resolveConflict(id, keep) {
      const deviceId = await getDeviceId();
      return db.readModifyWrite(
        [{ store: "records", key: id }, { store: "conflicts", key: id }],
        ([rec, conflict]) => {
          if (!rec || !conflict) throw new Error("There is no open conflict for " + id);
          // Resolve against the record AS IT IS NOW (it may have been edited again since the conflict was found).
          const resolved = P.resolveConflict({
            local: { vv: rec.vv, data: rec.data, deleted: rec.deleted },
            incoming: conflict.incoming,
            keep,
            deviceId,
            now: clock(),
          });
          const next = { ...rec, ...resolved, origin: deviceId };
          return {
            ops: [{ op: "put", store: "records", value: next }, { op: "delete", store: "conflicts", key: id }],
            result: next,
          };
        },
        ["records", "conflicts"],
      );
    }

    // ---------- status for the UI ----------

    async function listProjects() {
      const rows = await db.getAll("projects");
      return rows.sort((a, b) => (a.companyName + a.displayNumber).localeCompare(b.companyName + b.displayNumber));
    }

    async function getStatus() {
      const records = await db.getAll("records");
      const counts = { unsent: 0, sent: 0, delivered: 0 };
      records.filter((r) => !r.deleted).forEach((r) => counts[recordState(r)]++);
      return {
        deviceId: await getDeviceId(),
        counts,
        conflicts: (await getConflicts()).length,
        projectsMeta: await db.kvGet("projectsMeta", {}),
        log: await db.kvGet("syncLog", []),
      };
    }

    // ---------- Phase 1 diagnostics ----------

    /** A throwaway record that proves the whole pipeline works end to end before real data depends on it. */
    function createPing(note) {
      return createRecord({ type: "ping", data: { note: String(note || "").slice(0, 200) } });
    }

    return {
      getDeviceId, recordState,
      createRecord, saveRecord, deleteRecord, getRecords,
      exportBundle, importText, importFiles, summarizeImport,
      getConflicts, resolveConflict,
      listProjects, getStatus, createPing,
    };
  }

  return { createSync, browserDownload };
});
