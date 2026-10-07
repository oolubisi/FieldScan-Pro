// ===== App shell: boot, routing, and the Sync screen =====

const APP_VERSION = "0.5.0 (Photos)";
const fsp = { db: null, sync: null, storageError: null };
window.APP_VERSION = APP_VERSION;
window.fsp = fsp;

const ROUTES = {
  takeoff: { tab: "takeoff", render: () => renderTakeoffScreen() },
  tasks: { tab: "tasks", render: () => renderTasksScreen() },
  inspections: { tab: "inspections", render: () => renderInspectionsScreen() },
  conflicts: { tab: "takeoff", render: () => renderConflictsScreen() },
  calculators: { tab: "calculators", render: () => renderCalculatorsSection() },
  sync: { tab: "sync", render: () => renderSyncScreen() },
  "device-check": { tab: "sync", render: () => renderProbeScreen() },
};

function currentRoute() {
  const m = /^#\/([a-z-]+)/.exec(location.hash);
  return m && ROUTES[m[1]] ? m[1] : "takeoff";
}

function navigate() {
  const name = currentRoute();
  document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.route === ROUTES[name].tab));
  document.getElementById("main").scrollTop = 0;
  Promise.resolve(ROUTES[name].render()).catch((e) => {
    document.getElementById("main").innerHTML = `<div class="card"><h3>Something went wrong</h3><p class="muted">${escapeHtml(e.message || e)}</p></div>`;
  });
}

// ---------- start-up ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // A brand-new install also takes control once; only announce genuine updates.
    if (hadController) showStatus("App updated. Close and reopen it to use the new version.");
  });
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker not registered:", e));
}

/** Asks the browser not to evict the saved records when the phone is short of space. */
async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (e) { /* best effort; the device check reports the outcome */ }
}

async function boot() {
  registerServiceWorker();
  try {
    fsp.db = await FSPDb.open();
    fsp.sync = FSPSync.createSync({ db: fsp.db, protocol: FSPProtocol });
    await fsp.sync.getDeviceId();
    fsp.folder = FSPFolderSync.createFolderSync({ sync: fsp.sync, db: fsp.db, protocol: FSPProtocol });
    requestPersistentStorage();
  } catch (e) {
    // Calculators don't use storage, so they keep working; only Sync is affected.
    fsp.storageError = e;
  }
  window.addEventListener("hashchange", navigate);
  navigate();
}

// ---------- Sync screen ----------

const STATE_BADGE = {
  unsent: ["wait", "Not sent yet"],
  sent: ["wait", "Sent, waiting for desktop"],
  delivered: ["ok", "Delivered \u2713"],
};

/** Disables a button while its action runs, so a double tap can't run it twice. */
async function withBusy(button, fn) {
  button.disabled = true;
  try { return await fn(); } finally { button.disabled = false; }
}

function resultBox(lines, isError) {
  return `<div class="result-box${isError ? " error" : ""}">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`;
}

async function renderSyncScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) {
    main.innerHTML = `<h2>Sync</h2><div class="card"><h3>Storage isn't available</h3>
      <p class="muted">This browser isn't letting the app save data (${escapeHtml((fsp.storageError && fsp.storageError.message) || "unknown reason")}), so syncing can't work here. The Calculators still do.</p></div>`;
    return;
  }

  const status = await fsp.sync.getStatus();
  const folder = await fsp.folder.status();
  const canPickFolder = typeof window.showDirectoryPicker === "function";
  const projects = await fsp.sync.listProjects();
  const pings = await fsp.sync.getRecords("ping");
  const c = status.counts;
  const waiting = c.unsent + c.sent;

  const companies = Object.keys(status.projectsMeta).map((k) => status.projectsMeta[k]);
  const byCompany = {};
  projects.forEach((p) => { (byCompany[p.companyName] = byCompany[p.companyName] || []).push(p); });

  const projectCard = companies.length
    ? companies.map((m) => `<div class="row"><div class="grow"><b>${escapeHtml(m.name)}</b><div class="sub">${m.count} project${m.count === 1 ? "" : "s"} \u00b7 list made ${escapeHtml(formatWhen(m.generatedAt))}</div></div></div>`).join("") +
      `<details style="margin-top:8px;"><summary class="muted">Show the projects</summary>${Object.keys(byCompany).map((n) =>
        `<div style="margin-top:8px;"><b>${escapeHtml(n)}</b>${byCompany[n].map((p) => `<div class="sub">${escapeHtml(p.displayNumber)} \u2014 ${escapeHtml(p.clientName)}${p.siteLocation ? ", " + escapeHtml(p.siteLocation) : ""}</div>`).join("")}</div>`).join("")}</details>`
    : `<p class="muted">No project list yet. On the desktop, open Sync and press <b>Write project list</b>, wait for it to reach your phone, then import it here.</p>`;

  const pingRows = pings.length
    ? pings.map((r) => {
        const fromDesktop = (r.origin || "").indexOf("dt-") === 0;
        const [kind, label] = fromDesktop ? ["info", "From desktop"] : STATE_BADGE[fsp.sync.recordState(r)];
        return `<div class="row"><div class="grow">${escapeHtml((r.data && r.data.note) || "(no note)")}<div class="sub">${fromDesktop ? "Reply from the desktop" : "From this phone"} \u00b7 ${escapeHtml(formatWhen(r.updatedAt))}</div></div><span class="badge ${kind}">${label}</span></div>`;
      }).join("")
    : `<p class="muted">None yet.</p>`;

  const FOLDER_STATE = {
    granted: "Ready to sync.",
    prompt: "Chrome will ask you to allow access when you tap Sync now.",
    denied: "Access was refused. Tap Sync now and choose Allow, or choose the folder again.",
    error: "The folder can't be reached. Choose it again.",
  };
  const folderCard = !canPickFolder
    ? `<p class="muted">This browser can't open a folder directly. Use the file steps below instead.</p>`
    : folder.state === "none"
      ? `<p class="muted">Choose the folder your sync app (Syncthing) keeps in step with the desktop. After that, one tap on Sync now does everything.</p>
         <button class="btn block" id="folderChoose">Choose sync folder</button>`
      : `<p><b>${escapeHtml(folder.name)}</b></p>
         <p class="muted">${escapeHtml(FOLDER_STATE[folder.state] || "")}${folder.lastSync ? ` Last sync ${escapeHtml(formatWhen(folder.lastSync))}: ${escapeHtml(folder.lastSummary || "")}` : ""}</p>
         <button class="btn block" id="folderSync">Sync now</button>
         <button class="btn secondary block" id="folderChoose" style="margin-top:8px;">Choose a different folder</button>
         <button class="btn secondary block" id="folderForget" style="margin-top:8px;">Forget folder</button>`;

  main.innerHTML = `
    <h2>Sync</h2>


    <div class="card">
      <h3>Sync folder</h3>
      ${folderCard}
      <div id="folderCardResult"></div>
    </div>

    <div class="card">
      <h3>Project list from the desktop</h3>
      ${projectCard}
    </div>

    <div class="card">
      <h3>Get files from the desktop</h3>
      <p class="muted">When your sync app has brought the desktop's files to this phone, pick them here. You can pick several at once; pick the same ones again any time, it's safe.</p>
      <button class="btn block" id="syncImport">Choose files to import</button>
      <input type="file" id="syncImportInput" multiple hidden>
      <div id="syncImportResult"></div>
    </div>

    <div class="card">
      <h3>Send to the desktop</h3>
      <p class="muted">${waiting
        ? `${c.unsent} not sent yet, ${c.sent} sent and waiting for the desktop to confirm. Everything not yet confirmed goes in the file.`
        : c.delivered ? "Everything has been confirmed by the desktop." : "Nothing to send yet."}</p>
      <button class="btn block" id="syncExport">Save file for the desktop</button>
      <div id="syncExportResult"></div>
    </div>

    <div class="card">
      <h3>Check the connection</h3>
      <p class="muted">Create a test note, send it, and see it arrive on the desktop (and a reply come back). This proves the whole path works before real records depend on it.</p>
      <input id="pingNote" placeholder="Test note, e.g. hello from site" maxlength="200">
      <button class="btn block" id="pingCreate" style="margin-top:8px;">Create test note</button>
      <div style="margin-top:8px;">${pingRows}</div>
      ${status.conflicts ? `<div class="result-box error"><div>${status.conflicts} record${status.conflicts === 1 ? "" : "s"} changed on both phone and desktop and need a decision. <a href="#/conflicts">Decide now</a></div></div>` : ""}
    </div>

    <div class="card">
      <h3>Recent activity</h3>
      ${status.log.length ? status.log.slice(0, 8).map((l) => `<div class="row"><div class="grow sub">${escapeHtml(l.text)}<div>${escapeHtml(formatWhen(l.at))}</div></div></div>`).join("") : `<p class="muted">Nothing yet.</p>`}
    </div>

    <div class="card">
      <h3>This phone</h3>
      <p class="muted">Device ID <b>${escapeHtml(status.deviceId)}</b> \u00b7 App version ${escapeHtml(APP_VERSION)}</p>
      <a class="btn secondary block" href="#/device-check" style="text-align:center; text-decoration:none;">Device check</a>
    </div>`;

  const chooseBtn = document.getElementById("folderChoose");
  if (chooseBtn) chooseBtn.onclick = async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const r = await fsp.folder.chooseFolder((opts) => window.showDirectoryPicker(opts));
      await renderSyncScreen();
      if (r.cancelled) return;
      const lines = r.ok
        ? [`Using the folder \u201c${r.name}\u201d.`].concat(r.remembered ? [] : ["Chrome would not remember it, so you'll need to choose it again next time."])
        : [r.error];
      document.getElementById("folderCardResult").innerHTML = resultBox(lines, !r.ok);
    });
  };
  const syncBtn = document.getElementById("folderSync");
  if (syncBtn) syncBtn.onclick = async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const r = await fsp.folder.syncNow();
      await renderSyncScreen();
      const lines = r.ok ? r.lines.concat(r.problems.map((p) => `${p.file}: ${p.reason}`)) : [r.error];
      document.getElementById("folderCardResult").innerHTML = resultBox(lines, !r.ok || r.problems.length > 0);
    });
  };
  const forgetBtn = document.getElementById("folderForget");
  if (forgetBtn) forgetBtn.onclick = async () => {
    await fsp.folder.forgetFolder();
    await renderSyncScreen();
  };

  document.getElementById("syncImport").onclick = () => document.getElementById("syncImportInput").click();

  // No file-type filter on purpose: Android's picker hides files whose type it
  // doesn't recognise, and files from sync apps often arrive untyped. Anything
  // that isn't ours is reported, never silently ignored.
  document.getElementById("syncImportInput").onchange = async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const btn = document.getElementById("syncImport");
    await withBusy(btn, async () => {
      const out = await fsp.sync.importFiles(files);
      const problems = out.results.some((r) => !r.ok);
      await renderSyncScreen();
      document.getElementById("syncImportResult").innerHTML = resultBox(out.lines, problems);
    });
  };

  document.getElementById("syncExport").onclick = async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      try {
        const r = await fsp.sync.exportBundle();
        await renderSyncScreen();
        document.getElementById("syncExportResult").innerHTML = r.empty
          ? resultBox(["Nothing to send yet."])
          : resultBox([`Saved ${r.filename} to your Downloads folder (${r.sent} record${r.sent === 1 ? "" : "s"}).`, "Your sync app will upload it to Drive."]);
      } catch (e) {
        document.getElementById("syncExportResult").innerHTML = resultBox([`Could not save the file: ${e.message}`, "Your records are safe and still waiting to be sent."], true);
      }
    });
  };

  document.getElementById("pingCreate").onclick = async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const note = document.getElementById("pingNote").value.trim() || "Test note";
      await fsp.sync.createPing(note);
      await renderSyncScreen();
      showStatus("Test note created. Now press \u201cSave file for the desktop\u201d.");
    });
  };
}

boot();
