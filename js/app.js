// ===== App shell: boot, routing, and the Sync screen =====

const APP_VERSION = "0.9.0 (Receipts, PDF share, GPS)";
const fsp = { db: null, sync: null, storageError: null };
window.APP_VERSION = APP_VERSION;
window.fsp = fsp;

const ROUTES = {
  diary: { tab: "home", render: () => renderDiaryScreen() },
  expenses: { tab: "home", render: () => renderExpensesScreen() },
  search: { tab: "home", render: () => renderSearchScreen() },
  projects: { tab: "projects", render: () => renderProjectsScreen() },
  prospects: { tab: "projects", render: () => renderProspectsScreen() },
  home: { tab: "home", render: () => renderHomeScreen() },
  takeoff: { tab: "takeoff", render: () => renderTakeoffScreen() },
  tasks: { tab: "tasks", render: () => renderTasksScreen() },
  inspections: { tab: "inspections", render: () => renderInspectionsScreen() },
  conflicts: { tab: "takeoff", render: () => renderConflictsScreen() },
  calculators: { tab: "calculators", render: () => renderCalculatorsSection() },
  sync: { tab: "sync", render: () => renderSyncScreen() },
  safety: { tab: "sync", render: () => renderSafetyScreen() },
  help: { tab: "sync", render: () => renderHelpScreen() },
  "device-check": { tab: "sync", render: () => renderProbeScreen() },
};

/** The Help screen (guides for both the desktop and the phone). */
function renderHelpScreen() { helpRender(document.getElementById("main"), escapeHtml); }

function currentRoute() {
  const m = /^#\/([a-z-]+)/.exec(location.hash);
  return m && ROUTES[m[1]] ? m[1] : "home";
}

/** The company switch in the header: one company at a time. Shown only when the phone holds more than one. */
async function renderCompanySwitch() {
  const sel = document.getElementById("coSwitch");
  if (!sel || !fsp.sync) return;
  const meta = (await fsp.sync.getStatus()).projectsMeta || {};
  const keys = Object.keys(meta);
  if (!keys.includes(coCurrent())) coSet(keys[0] || ""); // first company until one is chosen
  sel.hidden = keys.length < 2;
  const nm = document.getElementById("coName");
  if (nm) nm.textContent = keys.length === 1 ? (meta[keys[0]].name || "") : "";
  if (keys.length < 2) return;
  sel.innerHTML = keys.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(meta[k].name || "Company")}</option>`).join("");
  sel.value = coCurrent();
  sel.onchange = () => { coSet(sel.value); navigate(); };
}

const PAGE_TITLES = { projects: "Projects", prospects: "Prospects", takeoff: "Take-Off", tasks: "Tasks", inspections: "Inspections", calculators: "Calculators", sync: "Sync", safety: "Safety", help: "Help", diary: "Site diary", expenses: "Expenses", search: "Search", conflicts: "Conflicts", "device-check": "Device check" };

// The top bar already names the page, so a screen's own matching heading is hidden.
function hideDupTitle() {
  const t = (document.querySelector("#appbar h1") || {}).textContent;
  document.querySelectorAll("#main h2").forEach((h) => h.classList.toggle("dup-title", h === document.querySelector("#main h2") && h.textContent.trim() === (t || "").trim() && t !== "FieldScan Pro"));
}
function watchTitles() {
  const m = document.getElementById("main");
  if (m && window.MutationObserver) new MutationObserver(hideDupTitle).observe(m, { childList: true });
}

let lastRouteName = null;

function navigate() {
  const name = currentRoute();
  const cameBackHome = name === "home" && lastRouteName && lastRouteName !== "home";
  lastRouteName = name;
  if (cameBackHome && window.fsp && fsp.autoSync && fsp.autoSync.tick) fsp.autoSync.tick(true).catch(() => {}); // returning to Home syncs (when automatic sync is on)
  document.querySelectorAll("#tabbar a[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === ROUTES[name].tab));
  const home = document.getElementById("homeBtn");
  if (home) home.hidden = name === "home";
  const bar = document.getElementById("tabbar"); if (bar) bar.hidden = name !== "home";
  const h1 = document.querySelector("#appbar h1"); if (h1) h1.textContent = name === "home" ? "FieldScan Pro" : (PAGE_TITLES[name] || "FieldScan Pro");
  const cn = document.getElementById("coName"); if (cn) cn.dataset.page = name === "home" ? "" : "1";
  closeMenu();
  document.getElementById("main").scrollTop = 0;
  Promise.resolve(renderCompanySwitch()).catch(() => {}).then(() => ROUTES[name].render()).catch((e) => {
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

/** Auto (follows the phone) -> Light -> Dark. Remembered on this phone. */
function setupTheme() {
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  const get = () => { try { return localStorage.getItem("fsp-theme") || "auto"; } catch (e) { return "auto"; } };
  const apply = (t) => {
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    btn.textContent = t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#1a2332" : "#0a0f16");
  };
  apply(get());
  btn.onclick = () => {
    const next = { auto: "light", light: "dark", dark: "auto" }[get()];
    try { localStorage.setItem("fsp-theme", next); } catch (e) { /* not saved */ }
    apply(next);
  };
}

/** The single Menu button at the bottom: opens the list of sections and the theme switch. */
function closeMenu() {
  const p = document.getElementById("menuPanel"), b = document.getElementById("menuBtn");
  if (p) p.hidden = true;
  if (b) b.setAttribute("aria-expanded", "false");
}
function setupMenu() {
  const btn = document.getElementById("menuBtn"), panel = document.getElementById("menuPanel");
  if (!btn || !panel) return;
  btn.onclick = (e) => { e.stopPropagation(); const open = panel.hidden; panel.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); };
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); e.stopPropagation(); });
  document.addEventListener("click", closeMenu);
}

async function boot() {
  setupMenu();
  setupTheme();
  setupLock();
  registerServiceWorker();
  try {
    fsp.db = await FSPDb.open();
    fsp.sync = FSPSync.createSync({ db: fsp.db, protocol: FSPProtocol });
    await fsp.sync.getDeviceId();
    fsp.folder = FSPFolderSync.createFolderSync({ sync: fsp.sync, db: fsp.db, protocol: FSPProtocol });
    requestPersistentStorage();
    startAutoSync();
  } catch (e) {
    // Calculators don't use storage, so they keep working; only Sync is affected.
    fsp.storageError = e;
  }
  window.addEventListener("hashchange", navigate);
  navigate();
  watchTitles();
  scStart();
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
         <label style="display:flex;gap:10px;align-items:center;font-weight:600;margin:10px 0;"><input type="checkbox" id="autoSyncBox" ${asEnabled() ? "checked" : ""}> Sync automatically (every 10 minutes, on opening and on closing)</label>
         <p class="muted" id="autoSyncNote" style="margin-top:0;">${asEnabled() ? (fsp.autoSync && fsp.autoSync.lastAt ? `Last automatic sync ${escapeHtml(formatWhen(new Date(fsp.autoSync.lastAt).toISOString()))}. ` : "") + "Chrome only allows syncing while the app is open, so closing it does one last quick sync as it goes." : "Automatic sync is off."}</p>
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
      <label style="display:flex;gap:10px;align-items:center;font-weight:600;margin:6px 0 10px;"><input type="checkbox" id="geoStampBox" ${phStampEnabled() ? "checked" : ""}> Stamp photos with date, time and GPS location</label>
      <a class="btn secondary block" href="#/help" style="text-align:center; text-decoration:none; margin-bottom:8px;">Help</a>
      <a class="btn secondary block" href="#/safety" style="text-align:center; text-decoration:none; margin-bottom:8px;">Backup, storage, lock &amp; history</a>
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
  const geoBox = document.getElementById("geoStampBox");
  if (geoBox) geoBox.onchange = () => { phStampEnabled(geoBox.checked); showStatus(geoBox.checked ? "New photos will carry the date, time and location." : "New photos will not be stamped."); };
  const autoBox = document.getElementById("autoSyncBox");
  if (autoBox) autoBox.onchange = () => { asEnabled(autoBox.checked); if (autoBox.checked && fsp.autoSync) fsp.autoSync.tick(true); renderSyncScreen(); };
  const syncBtn = document.getElementById("folderSync");
  if (syncBtn) syncBtn.onclick = async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const r = await fsp.folder.syncNow();
      await renderSyncScreen();
      scRefresh();
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
