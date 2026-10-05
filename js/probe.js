/**
 * Device check.
 *
 * The sync design deliberately doesn't depend on anything this page can't
 * confirm on YOUR phone: it reports what the browser actually supports (by
 * feature detection, never by assumption) and has three hands-on tests --
 * a download, folder access, and importing picked files -- so what works
 * (and what doesn't) is known before real data depends on it.
 *
 * collectCapabilities() and formatReport() are plain functions (testable
 * without a phone); renderProbeScreen() is the screen itself.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.FSPProbe = api;
    root.renderProbeScreen = api.renderProbeScreen;
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const mb = (bytes) => (typeof bytes === "number" ? Math.round((bytes / (1024 * 1024)) * 10) / 10 : null);

  async function collectCapabilities(env) {
    const win = env.window;
    const nav = env.navigator;
    const attempt = async (fn, fallback) => {
      try { return await fn(); } catch (e) { return fallback; }
    };

    const features = {
      secureContext: !!win.isSecureContext,
      installedStandalone: !!((win.matchMedia && win.matchMedia("(display-mode: standalone)").matches) || nav.standalone),
      serviceWorkerSupported: "serviceWorker" in nav,
      serviceWorkerControlling: !!(nav.serviceWorker && nav.serviceWorker.controller),
      indexedDB: !!win.indexedDB,
      clipboardWrite: !!(nav.clipboard && nav.clipboard.writeText),
      camera: !!(nav.mediaDevices && nav.mediaDevices.getUserMedia),
      webShare: !!nav.share,
      webShareJsonFile: await attempt(() => !!(nav.canShare && nav.canShare({ files: [new win.File(["{}"], "probe.json", { type: "application/json" })] })), false),
      webShareTextFile: await attempt(() => !!(nav.canShare && nav.canShare({ files: [new win.File(["x"], "probe.txt", { type: "text/plain" })] })), false),
      showOpenFilePicker: "showOpenFilePicker" in win,
      showSaveFilePicker: "showSaveFilePicker" in win,
      showDirectoryPicker: "showDirectoryPicker" in win,
    };

    const storage = { persistSupported: !!(nav.storage && nav.storage.persist), persisted: null, quotaMB: null, usageMB: null };
    if (nav.storage && nav.storage.persisted) storage.persisted = await attempt(() => nav.storage.persisted(), null);
    if (nav.storage && nav.storage.estimate) {
      const est = await attempt(() => nav.storage.estimate(), null);
      if (est) { storage.quotaMB = mb(est.quota); storage.usageMB = mb(est.usage); }
    }

    const environment = {
      online: nav.onLine,
      userAgent: nav.userAgent || "",
      platform: nav.platform || "",
      language: nav.language || "",
      timeZone: await attempt(() => Intl.DateTimeFormat().resolvedOptions().timeZone, ""),
      cacheNames: win.caches ? await attempt(() => win.caches.keys(), []) : [],
    };

    return { features, storage, environment };
  }

  const yn = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");

  function formatReport({ appVersion, when, capabilities, tests }) {
    const f = capabilities.features;
    const s = capabilities.storage;
    const e = capabilities.environment;
    const lines = [
      `FieldScan Pro device check -- ${when}`,
      `App: ${appVersion}   Cached build: ${(e.cacheNames || []).filter((n) => n.indexOf("fsp-shell-") === 0).join(", ") || "none"}`,
      `Phone: ${e.userAgent}`,
      `Online: ${yn(e.online)}   Time zone: ${e.timeZone}`,
      "",
      "Capabilities",
      `  Installed as an app (standalone): ${yn(f.installedStandalone)}`,
      `  Works offline (service worker controlling): ${yn(f.serviceWorkerControlling)}`,
      `  Secure context (https): ${yn(f.secureContext)}`,
      `  IndexedDB: ${yn(f.indexedDB)}`,
      `  Storage kept permanently: ${yn(s.persisted)}   Used/quota (MB): ${s.usageMB}/${s.quotaMB}`,
      `  Pick a folder (showDirectoryPicker): ${yn(f.showDirectoryPicker)}`,
      `  Save-file dialog (showSaveFilePicker): ${yn(f.showSaveFilePicker)}`,
      `  Open-file dialog (showOpenFilePicker): ${yn(f.showOpenFilePicker)}`,
      `  Share sheet: ${yn(f.webShare)}   .json files: ${yn(f.webShareJsonFile)}   text files: ${yn(f.webShareTextFile)}`,
      `  Camera: ${yn(f.camera)}   Clipboard: ${yn(f.clipboardWrite)}`,
      "",
      "Hands-on tests",
    ];
    ["download", "folder", "savedFolder", "fileImport"].forEach((k) => {
      const t = (tests || {})[k];
      const label = { download: "Download", folder: "Folder access", savedFolder: "Remembered folder", fileImport: "File picker" }[k];
      lines.push(`  ${label}: ${t ? (t.ok ? "OK -- " : "PROBLEM -- ") + t.message : "not run"}`);
    });
    return lines.join("\n");
  }

  // ---------- the screen ----------

  function renderProbeScreen() {
    const win = root;
    const doc = win.document;
    const main = doc.getElementById("main");
    const state = { capabilities: null, tests: {} };
    const app = win.fsp || {};

    main.innerHTML = `
      <h2>Device check</h2>
      <p class="muted">Finds out what this phone and browser can do, so the sync is built on what really works here. Nothing on this screen changes your data.</p>

      <div class="card"><h3>This phone</h3><table class="checks" id="probeChecks"><tr><td>Checking...</td></tr></table></div>

      <div class="card">
        <h3>1. Download</h3>
        <p class="muted">Saves a small test file named like the real sync files. Check it lands in your Downloads folder, and that your folder-sync app uploads it to Drive.</p>
        <button class="btn" id="probeDownload">Save a test file</button>
        <div id="probeDownloadResult"></div>
      </div>

      <div class="card">
        <h3>2. Folder access</h3>
        <p class="muted">If the browser allows it, the app can read and write a folder directly (no picking files by hand). Choose the folder your sync app uses.</p>
        <div class="toolbar"><button class="btn" id="probeFolder">Choose a folder</button><button class="btn secondary" id="probeSavedFolder">Check remembered folder</button></div>
        <div id="probeFolderResult"></div>
      </div>

      <div class="card">
        <h3>3. Picking files</h3>
        <p class="muted">Choose one or more files (for example, ones your sync app downloaded from Drive). Nothing is imported; this only shows what the app can read.</p>
        <input type="file" id="probeFiles" multiple>
        <div id="probeFilesResult"></div>
      </div>

      <div class="card">
        <h3>Report</h3>
        <p class="muted">Copy this and send it back, so the next step is built around what your phone can really do.</p>
        <textarea id="probeReport" rows="14" readonly style="font-family:monospace; font-size:12px;"></textarea>
        <button class="btn block" id="probeCopy" style="margin-top:8px;">Copy report</button>
      </div>`;

    const show = (id, test) => {
      const el = doc.getElementById(id);
      el.innerHTML = `<div class="result-box${test.ok ? "" : " error"}">${(test.html || escapeHtml(test.message))}</div>`;
    };
    const refreshReport = () => {
      if (!state.capabilities) return;
      doc.getElementById("probeReport").value = formatReport({
        appVersion: win.APP_VERSION || "",
        when: new Date().toISOString(),
        capabilities: state.capabilities,
        tests: state.tests,
      });
    };

    const row = (label, value, kind) => `<tr><td>${escapeHtml(label)}</td><td class="${kind}">${escapeHtml(value)}</td></tr>`;
    const tri = (v) => (v === true ? ["yes", "yes"] : v === false ? ["no", "no"] : ["unknown", "maybe"]);

    collectCapabilities({ window: win, navigator: win.navigator, document: doc }).then((caps) => {
      state.capabilities = caps;
      const f = caps.features;
      const s = caps.storage;
      const r = (label, v) => row(label, ...tri(v));
      doc.getElementById("probeChecks").innerHTML = [
        r("Installed as an app", f.installedStandalone),
        r("Works offline", f.serviceWorkerControlling),
        r("Storage kept permanently", s.persisted),
        row("Storage used / quota (MB)", `${s.usageMB} / ${s.quotaMB}`, "maybe"),
        r("Can choose a folder", f.showDirectoryPicker),
        r("Save-file dialog", f.showSaveFilePicker),
        r("Open-file dialog", f.showOpenFilePicker),
        r("Share sheet", f.webShare),
        r("Camera", f.camera),
      ].join("");
      refreshReport();
    });

    doc.getElementById("probeDownload").onclick = async () => {
      try {
        const deviceId = app.sync ? await app.sync.getDeviceId() : "ph-unknown";
        const probe = FSPProtocol.makeProbe({ origin: deviceId, note: "download test" });
        const name = FSPProtocol.probeFilename(probe);
        await FSPSync.browserDownload(name, JSON.stringify(probe, null, 2), "application/json");
        state.tests.download = { ok: true, message: `asked the browser to save ${name}`, html: `Asked the browser to save <b>${escapeHtml(name)}</b>. Check your Downloads folder, then watch for it in Drive.` };
      } catch (e) {
        state.tests.download = { ok: false, message: `${e.name}: ${e.message}` };
      }
      show("probeDownloadResult", state.tests.download);
      refreshReport();
    };

    doc.getElementById("probeFolder").onclick = async () => {
      if (!("showDirectoryPicker" in win)) {
        state.tests.folder = { ok: false, message: "this browser can't open a folder directly (that's fine: importing picked files covers it)" };
      } else {
        try {
          const dir = await win.showDirectoryPicker({ mode: "readwrite" });
          const fileName = "fsp-probe-folder.json";
          const handle = await dir.getFileHandle(fileName, { create: true });
          const writable = await handle.createWritable();
          const payload = JSON.stringify({ fsp: 1, kind: "folder-test", at: new Date().toISOString() });
          await writable.write(payload);
          await writable.close();
          const readBack = await (await handle.getFile()).text();
          let items = 0;
          for await (const _ of dir.entries()) items++; // eslint-disable-line no-unused-vars
          // Using a folder and REMEMBERING it are separate abilities; report each on its own.
          let saved = "not remembered (no storage)";
          if (app.db) {
            try {
              await app.db.kvSet("probeFolderHandle", dir);
              saved = "remembered for the next check";
            } catch (e) {
              saved = `not remembered (${e.name})`;
            }
          }
          const perm = dir.queryPermission ? await dir.queryPermission({ mode: "readwrite" }) : "unknown";
          state.tests.folder = {
            ok: readBack === payload,
            message: `wrote and read back ${fileName} in "${dir.name}" (${items} items there); permission now ${perm}; folder ${saved}`,
          };
        } catch (e) {
          state.tests.folder = { ok: false, message: `${e.name}: ${e.message}` };
        }
      }
      show("probeFolderResult", state.tests.folder);
      refreshReport();
    };

    doc.getElementById("probeSavedFolder").onclick = async () => {
      try {
        const handle = app.db ? await app.db.kvGet("probeFolderHandle") : null;
        if (!handle) {
          state.tests.savedFolder = { ok: false, message: "no folder remembered yet -- run the folder test above first, then come back after closing and reopening the app" };
        } else {
          let perm = await handle.queryPermission({ mode: "readwrite" });
          if (perm !== "granted") perm = await handle.requestPermission({ mode: "readwrite" });
          state.tests.savedFolder = perm === "granted"
            ? { ok: true, message: `"${handle.name}" is still usable (permission ${perm})` }
            : { ok: false, message: `"${handle.name}" needs permission again each time (${perm}), so folder access would mean a tap every session` };
        }
      } catch (e) {
        state.tests.savedFolder = { ok: false, message: `${e.name}: ${e.message}` };
      }
      show("probeFolderResult", state.tests.savedFolder);
      refreshReport();
    };

    doc.getElementById("probeFiles").onchange = async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      const lines = [];
      let allOk = true;
      for (const f of files.slice(0, 30)) {
        try {
          const text = await f.text();
          const parsed = FSPProtocol.parseFileText(text);
          lines.push(`${f.name} (${f.size} bytes, type "${f.type || "unknown"}"): ${parsed.ok ? "a FieldScan " + parsed.kind + " file" : "not a sync file (" + parsed.errors[0] + ")"}`);
        } catch (e) {
          allOk = false;
          lines.push(`${f.name}: could not be read (${e.name})`);
        }
      }
      state.tests.fileImport = { ok: allOk, message: `${files.length} file(s) picked; ${lines.join("; ")}`, html: lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("") };
      show("probeFilesResult", state.tests.fileImport);
      refreshReport();
      ev.target.value = "";
    };

    doc.getElementById("probeCopy").onclick = async () => {
      const text = doc.getElementById("probeReport").value;
      try {
        await win.navigator.clipboard.writeText(text);
        showStatus("Report copied");
      } catch (e) {
        const box = doc.getElementById("probeReport");
        box.select();
        showStatus("Select all and copy by hand", true);
      }
    };
  }

  return { collectCapabilities, formatReport, renderProbeScreen };
});
