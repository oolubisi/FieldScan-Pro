/**
 * Folder sync: the "Sync now" button.
 *
 * The phone app reads and writes one folder directly (the Android folder that
 * Syncthing keeps in step with the Mac), so no Downloads folder and no file
 * picking is involved. This module only moves files; every decision about
 * records, versions, conflicts and delivery confirmation stays in sync.js, so
 * a folder sync and a manual import behave identically.
 *
 * One tap does, in this order:
 *   1. read the sync files in the folder that are new or changed
 *   2. merge them in (this also receives the desktop's delivery receipts)
 *   3. write one file with whatever the desktop has not yet confirmed
 *   4. tidy away this phone's own old files the desktop has confirmed
 *
 * Reading comes first so receipts arrive before the export decides what is
 * still unconfirmed. Nothing is ever marked sent unless the file was really
 * written, and a failure at any step leaves the records waiting, not lost.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSPFolderSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HANDLE_KEY = "syncFolderHandle";
  const META_KEY = "syncFolderMeta";
  const MODE = { mode: "readwrite" };

  const errText = (e) => `${(e && e.name) || "Error"}${e && e.message ? ": " + e.message : ""}`;

  function createFolderSync({ sync, db, protocol, now, handleStore }) {
    const P = protocol;
    const clock = now || (() => new Date());
    // Folder handles can only be kept in IndexedDB; the store is injectable so the
    // engine can be tested without a real browser.
    // If Chrome refuses to keep the handle, it still works until the app is closed.
    let inMemory = null;
    const store = handleStore || {
      get: async () => (await db.kvGet(HANDLE_KEY, null)) || inMemory,
      set: async (h) => { inMemory = h; await db.kvSet(HANDLE_KEY, h); },
      clear: async () => { inMemory = null; await db.kvSet(HANDLE_KEY, null); },
    };
    let running = null;

    const loadMeta = () => db.kvGet(META_KEY, { processed: {}, lastSync: null, lastSummary: "" });
    const saveMeta = (m) => db.kvSet(META_KEY, m);

    // ---------- choosing and checking the folder ----------

    /** Opens Chrome's folder chooser, proves the folder can be written, and remembers it. */
    async function chooseFolder(picker) {
      let handle;
      try {
        handle = await picker(MODE);
      } catch (e) {
        if (e && e.name === "AbortError") return { ok: true, cancelled: true };
        return { ok: false, error: `Chrome would not open the folder chooser (${errText(e)}).` };
      }
      try {
        // A harmless test write: better to find out now than on the first real sync.
        const probe = await handle.getFileHandle(".fsp-write-test", { create: true });
        const w = await probe.createWritable();
        await w.write("ok");
        await w.close();
        await handle.removeEntry(".fsp-write-test").catch(() => {});
      } catch (e) {
        return { ok: false, error: `That folder can't be written to (${errText(e)}). Choose the folder your sync app uses.` };
      }
      let remembered = true;
      try {
        await store.set(handle);
      } catch (e) {
        remembered = false; // works this session; Chrome refused to keep it
      }
      await saveMeta({ processed: {}, lastSync: null, lastSummary: "" }); // a different folder: start fresh
      return { ok: true, cancelled: false, name: handle.name, remembered };
    }

    async function forgetFolder() {
      await store.clear();
      await saveMeta({ processed: {}, lastSync: null, lastSummary: "" });
    }

    /** state: none | granted | prompt | denied | error */
    async function status() {
      const meta = await loadMeta();
      let handle = null;
      try { handle = await store.get(); } catch (e) { handle = null; }
      if (!handle) return { state: "none", lastSync: meta.lastSync, lastSummary: meta.lastSummary };
      let state = "error";
      try { state = await handle.queryPermission(MODE); } catch (e) { state = "error"; }
      return { state, name: handle.name, lastSync: meta.lastSync, lastSummary: meta.lastSummary };
    }

    // ---------- the sync itself ----------

    async function listSyncFiles(handle) {
      const found = [];
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "file" && P.isSyncFilename(name)) found.push({ name, entry });
      }
      return found.sort((a, b) => (a.name < b.name ? -1 : 1));
    }

    async function writeFile(handle, filename, text) {
      const fh = await handle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable(); // Chrome writes to a hidden swap file and swaps it in on close
      await w.write(text);
      await w.close();
    }

    /** This phone's own bundle files still in the folder, parsed: [{name, envelopes}]. */
    async function readOwnFiles(files, deviceId) {
      const own = [];
      for (const { name, entry } of files) {
        if (name.indexOf(`fsp-bundle-${deviceId}-`) !== 0) continue;
        try {
          const parsed = P.parseFileText(await (await entry.getFile()).text());
          if (!parsed.ok || parsed.kind !== "bundle") continue;
          const v = P.validateBundle(parsed.value);
          if (v.ok && v.origin === deviceId) own.push({ name, envelopes: v.envelopes });
        } catch (e) { /* unreadable for now (maybe still arriving): treat as not there */ }
      }
      return own;
    }

    /**
     * Removes our own files once they are no longer needed.
     *  - a file carrying records goes once the desktop has confirmed every one of them;
     *  - a receipts-only file carries nothing to confirm, so it can't be judged that way. A newer
     *    file of ours holds all the same receipts and more, so older ones go only when a newer
     *    file exists (just written, or already there). The newest one always stays.
     */
    async function pruneOwnFiles(handle, own, wroteName) {
      let pruned = 0;
      const sorted = own.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
      const newestName = wroteName || (sorted.length ? sorted[sorted.length - 1].name : null);
      for (const f of sorted) {
        try {
          let removable;
          if (!f.envelopes.length) {
            removable = f.name !== newestName && newestName !== null;
          } else {
            removable = true;
            for (const env of f.envelopes) {
              const rec = await db.get("records", env.id);
              if (!rec || !P.vvCovers(rec.deliveredVv || {}, env.vv)) { removable = false; break; }
            }
          }
          if (removable) { await handle.removeEntry(f.name); pruned++; }
        } catch (e) { /* leave anything we can't be sure about */ }
      }
      return pruned;
    }

    async function runSync(opts) {
      const auto = !!(opts && opts.auto); // a timer run: there is no tap to ask permission with, so it must not ask
      const handle = await store.get().catch(() => null);
      if (!handle) return { ok: false, code: "no-folder", error: "Choose the sync folder first." };

      let perm;
      try {
        perm = await handle.queryPermission(MODE);
        if (perm !== "granted" && !auto) perm = await handle.requestPermission(MODE); // needs this tap, which it has
      } catch (e) {
        return { ok: false, code: "permission", error: `Chrome could not check folder permission (${errText(e)}).` };
      }
      if (perm !== "granted" && auto) return { ok: false, code: "permission", error: "Automatic sync is paused: Chrome needs you to allow the folder again. Tap Sync now once." };
      if (perm !== "granted") {
        return { ok: false, code: "permission", error: "Chrome needs your permission to use the folder. Tap Sync now again and choose Allow." };
      }

      const meta = await loadMeta();
      const out = { ok: true, read: 0, skippedUnchanged: 0, applied: 0, duplicates: 0, conflicts: 0, acked: 0, problems: [], sent: 0, filename: null, pruned: 0, lines: [] };

      let files;
      try {
        files = await listSyncFiles(handle);
      } catch (e) {
        if (e && e.name === "NotFoundError") return { ok: false, code: "missing", error: "The folder can't be found any more. Choose it again." };
        return { ok: false, code: "read", error: `Could not read the folder (${errText(e)}).` };
      }

      // 1 + 2: read what is new or changed, and merge it in.
      const toRead = [];
      for (const { name, entry } of files) {
        if (name.indexOf("fsp-probe-") === 0) continue; // connection tests, not data
        let file;
        try { file = await entry.getFile(); } catch (e) { out.problems.push({ file: name, reason: `could not be read (${errText(e)})` }); continue; }
        const signature = `${file.size}:${file.lastModified}`;
        if (meta.processed[name] === signature) { out.skippedUnchanged++; continue; }
        toRead.push({ name, signature, file });
      }
      if (toRead.length) {
        const imported = await sync.importFiles(toRead.map((f) => f.file.name === f.name ? f.file : { name: f.name, text: () => f.file.text() }));
        imported.results.forEach((r, i) => {
          const f = toRead[i];
          out.read++;
          if (r.ok) {
            meta.processed[f.name] = f.signature; // fully understood: no need to read it again unless it changes
            out.applied += r.applied || 0;
            out.duplicates += (r.duplicate || 0) + (r.stale || 0);
            out.conflicts += r.conflicts || 0;
            out.acked += r.acked || 0;
            (r.rejected || []).forEach((bad) => out.problems.push({ file: f.name, reason: `record #${bad.index + 1}: ${bad.errors.join(", ")}` }));
          } else {
            // Not marked as read, so it is tried again next time (it may still be arriving from Syncthing).
            out.problems.push({ file: f.name, reason: r.reason });
          }
        });
      }

      // 3: send whatever the desktop has not confirmed and that isn't already waiting in the folder
      //    (plus receipts for what just arrived).
      const deviceId = await sync.getDeviceId();
      let own = [];
      try { own = await readOwnFiles(files, deviceId); } catch (e) { own = []; }
      const waitingInFolder = {};
      own.forEach((f) => f.envelopes.forEach((env) => { waitingInFolder[env.id] = P.vvMerge(waitingInFolder[env.id] || {}, env.vv); }));
      let wroteName = null;
      try {
        const sent = await sync.exportBundle({
          onlyIfNeeded: true,
          waitingInFolder,
          includeAcks: out.applied > 0,
          deliver: async (filename, text) => { await writeFile(handle, filename, text); wroteName = filename; },
        });
        out.sent = sent.sent || 0;
        out.filename = wroteName;
        if (wroteName) { // our own new file needs no reading back
          try { const f = await (await handle.getFileHandle(wroteName)).getFile(); meta.processed[wroteName] = `${f.size}:${f.lastModified}`; } catch (e) { /* it will just be read once */ }
        }
      } catch (e) {
        out.ok = false;
        out.code = "write";
        out.error = `Could not write to the folder (${errText(e)}). Your records are safe and still waiting to be sent.`;
      }

      // 4: tidy.
      try {
        out.pruned = await pruneOwnFiles(handle, own, wroteName);
        const live = new Set(files.map((f) => f.name));
        if (wroteName) live.add(wroteName);
        Object.keys(meta.processed).forEach((n) => { if (!live.has(n)) delete meta.processed[n]; });
      } catch (e) { /* tidying is optional */ }

      out.lines = describe(out);
      meta.lastSync = clock().toISOString();
      meta.lastSummary = out.ok ? out.lines[0] : out.error;
      await saveMeta(meta);
      return out;
    }

    function describe(o) {
      const lines = [];
      const bits = [];
      if (o.applied) bits.push(`${o.applied} new or updated record${o.applied === 1 ? "" : "s"} received`);
      if (o.sent) bits.push(`${o.sent} record${o.sent === 1 ? "" : "s"} sent`);
      if (o.acked) bits.push(`desktop confirmed ${o.acked}`);
      lines.push(bits.length ? bits.join(", ") + "." : "Everything is up to date.");
      if (o.conflicts) lines.push(`${o.conflicts} record${o.conflicts === 1 ? "" : "s"} changed on both phone and desktop and need your decision.`);
      if (o.problems.length) lines.push(`${o.problems.length} file${o.problems.length === 1 ? "" : "s"} or record${o.problems.length === 1 ? "" : "s"} could not be used.`);
      return lines;
    }

    /** One sync at a time: a second tap while one is running just waits for that one. */
    function syncNow(opts) {
      if (!running) running = runSync(opts).catch((e) => ({ ok: false, code: "unexpected", error: `Unexpected problem: ${errText(e)}` })).finally(() => { running = null; });
      return running;
    }

    return { chooseFolder, forgetFolder, status, syncNow };
  }

  return { createFolderSync, HANDLE_KEY, META_KEY };
});
