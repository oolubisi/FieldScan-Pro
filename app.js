// ===== app.js =====
let appStarted = false;
let suppressPageRefresh = false;

function goToNewProjectViaEstimate() {
  showPage("estimates");
  if (typeof showSyncToast === "function") {
    showSyncToast("Projects are now created from an Accepted estimate — create or accept one, then use \"Create Project\" on it.");
  }
}
window.goToNewProjectViaEstimate = goToNewProjectViaEstimate;

function showPage(pageId) {
  document
    .querySelectorAll(".page-view:not(.console-tab-window)")
    .forEach((v) => v.classList.remove("active-view"));
  const target = document.getElementById(`view-${pageId}`);
  if (target) target.classList.add("active-view");

  // Active-state highlighting for both the desktop top nav and the mobile
  // bottom tab bar. Pages that live behind "More" on mobile (anything not
  // one of the 4 primary bottom tabs) highlight the More tab itself
  // instead, so there's still a visible indicator of where you are.
  const MOBILE_PRIMARY_PAGES = ["dashboard", "vendors", "inspections", "estimates"];
  document.querySelectorAll(".segment-btn[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });
  document.querySelectorAll(".mobile-tab-btn[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });
  const moreTabBtn = document.getElementById("mobile-more-tab-btn");
  if (moreTabBtn) {
    moreTabBtn.classList.toggle("active", !MOBILE_PRIMARY_PAGES.includes(pageId));
  }

  if (!suppressPageRefresh) {
    if (pageId === "dashboard") refreshMasterDashboard();
    if (pageId === "vendors") refreshVendorsListView();
    if (pageId === "takeoff") initTakeoffPage();
    if (pageId === "tasks") initTasksPage();
    if (pageId === "clients") initClientsPage();
    if (pageId === "inspections") initInspectionsPage();
    if (pageId === "estimates") initEstimatesPage();
    if (pageId === "accounts") loadAccountsView();
    if (pageId === "reports") initReportsConsoleEngine();
    if (pageId === "print-layouts") renderPrintLayoutsPage();
    if (pageId === "settings") {
      loadSettingsView();
      if (typeof loadUnitsSettingsPanel === "function") loadUnitsSettingsPanel();
    }
    if (pageId === "calculators") initCalculatorsPage();
    if (pageId === "help") renderHelpPage();
  }
  window.scrollTo(0, 0);
}

function showPageWithoutRefresh(pageId) {
  suppressPageRefresh = true;
  showPage(pageId);
  suppressPageRefresh = false;
}

function openMobileMoreSheet() {
  const overlay = document.getElementById("mobile-more-sheet-overlay");
  if (overlay) overlay.classList.add("open");
}
window.openMobileMoreSheet = openMobileMoreSheet;

function closeMobileMoreSheet() {
  const overlay = document.getElementById("mobile-more-sheet-overlay");
  if (overlay) overlay.classList.remove("open");
}
window.closeMobileMoreSheet = closeMobileMoreSheet;

// ===== PROGRESS LOG UPDATE =====
// NOTE (codebase health check): appears to have zero call sites across
// every frontend file reviewed -- likely superseded by modals.js's
// progress_entry branch, which calls callApi("updateProgressLog", ...)
// directly rather than through this wrapper. Also misplaced here
// regardless (app.js is otherwise navigation/shell/Electron-notification
// code; every other Progress Log function lives in console.js). Left
// in place rather than removed, since index.html wasn't available to
// fully confirm nothing still references it via an onclick handler.
async function updateProgressLog(logId, data) {
  try {
    const payload = {
      logId: logId,
      projectId: getCurrentProjectId(),
      tradeCategory: data.tradeCategory,
      completionPercentage: data.completionPercentage,
      commentNarrative: data.commentNarrative,
      progressPhotoUrl: data.progressPhotoUrl || "",
    };
    await callApi("updateProgressLog", payload);
    const cache = getCache();
    const idx = (cache.progressLogs || []).findIndex((l) => l.logId === logId);
    if (idx !== -1) {
      cache.progressLogs[idx] = { ...cache.progressLogs[idx], ...payload };
      setCache(cache);
    }
    loadProgressTimelineFeed(true);
    showSyncToast("✅ Progress log updated");
  } catch (e) {
    alert("Failed to update: " + (e.message || "Unknown error"));
  }
}
window.updateProgressLog = updateProgressLog;


// ===== WINDOW EXPORTS =====
window.showPage = showPage;
window.loadSettingsView = loadSettingsView;
window.savePreferences = savePreferences;
window.exportFieldScanBackup = exportFieldScanBackup;
window.restoreFieldScanBackup = restoreFieldScanBackup;
window.clearFieldScanBackups = clearFieldScanBackups;
window.loadProjectConsoleHub = loadProjectConsoleHub;
window.triggerEditProjectProfile = triggerEditProjectProfile;
window.switchConsoleSegment = switchConsoleSegment;
window.toggleScopeEdit = toggleScopeEdit;
window.saveProjectScope = saveProjectScope;
window.updateProjectContractSubtotal = updateProjectContractSubtotal;
window.openModal = openModal;
window.openModalWithRecord = openModalWithRecord;
window.closeModal = closeModal;
window.removeAttachmentByIndex = removeAttachmentByIndex;
window.clearVendorAvatarPhoto = clearVendorAvatarPhoto;
window.triggerManualSync = triggerManualSync;
window.refreshAllData = refreshAllData;
window.openSyncQueuePanel = openSyncQueuePanel;
window.retryQueuedRequest = retryQueuedRequest;
window.handleReportScopePopulation = handleReportScopePopulation;
window.handleReportFilterPopulation = handleReportFilterPopulation;
window.compileFieldReport = compileFieldReport;
window.loadAccountsView = loadAccountsView;
window.updateAccountsSummary = updateAccountsSummary;
window.saveReportPDF = saveReportPDF;
window.shareReport = shareReport;
window.onPaymentDirectionChange = onPaymentDirectionChange;
window.recalcPaymentBalance = recalcPaymentBalance;
window.validateStageAmount = validateStageAmount;
window.getPaymentGroupData = getPaymentGroupData;
window.getAllPaymentGroups = getAllPaymentGroups;
window.openAddStageModal = openAddStageModal;
window.addWorkOrderLineItem = addWorkOrderLineItem;
window.recalcWorkOrderTotal = recalcWorkOrderTotal;
window.populateWorkOrderDropdown = populateWorkOrderDropdown;
window.addTakeOffLineItem = addTakeOffLineItem;
window.addTakeOffHeader = addTakeOffHeader;
window.updatePcrFields = updatePcrFields;
window.saveProjectPcrFields = saveProjectPcrFields;
window.applyProgressChecklist = applyProgressChecklist;
window.startProgressVoiceNote = startProgressVoiceNote;
window.stampProgressLocation = stampProgressLocation;

// ===== REFRESH TEMPLATES =====

// ===== SERVICE WORKER =====
// Skip the service worker (and the "Install App" prompt) when running inside
// the Electron desktop shell — the app already has full offline file access
// there, and a cached SW can otherwise serve stale JS after an update.
const isElectronApp =
  typeof window.electronAPI !== "undefined" && window.electronAPI.isElectron;
if (isElectronApp) document.body.classList.add("electron-app");

// ===== NATIVE NOTIFICATIONS (Electron only) =====
// Chromium's web Notification API maps straight to native OS notifications
// in Electron, so no main-process code is needed here — just permission
// and a small wrapper so callers elsewhere (api.js) don't have to think
// about whether they're running on desktop or in the mobile PWA.
if (isElectronApp && typeof Notification !== "undefined") {
  if (Notification.permission === "default") Notification.requestPermission();
}
function notifyDesktop(title, body) {
  if (!isElectronApp) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "icon-512.png" });
  }
}
window.notifyDesktop = notifyDesktop;

// ===== DESKTOP SHELL (Electron only) =====
// Turns the mobile top segment-bar into a persistent left sidebar. This
// reparents the *existing* nav buttons (same ids, same onclick handlers,
// same sync-pending badge) rather than rebuilding them, so nothing about
// how syncing/refresh/etc. work has to change — only where the DOM nodes
// live and how they're styled.
function buildDesktopShell() {
  const mainEl = document.querySelector(".main");
  const headerGroup = document.querySelector(".page-header .header-group");
  const segmentBar = document.querySelector(".segment-bar");
  if (!mainEl || !headerGroup || !segmentBar) return;

  const shell = document.createElement("div");
  shell.className = "desktop-shell";

  const sidebar = document.createElement("nav");
  sidebar.className = "desktop-sidebar";

  sidebar.appendChild(headerGroup); // logo + "FieldScan Pro" wordmark
  sidebar.appendChild(segmentBar); // Projects/Estimates/Tasks/.../Print Layouts/Settings/Help

  document.body.insertBefore(shell, mainEl);
  shell.appendChild(sidebar);
  shell.appendChild(mainEl);

  // Highlight the current section in the sidebar. showPage() itself has no
  // notion of "active nav item" (the mobile UI never needed one), so wrap
  // it rather than edit its internals. Matched by each button's own
  // data-page attribute -- not by its label text -- so this never goes
  // stale again as pages get added, renamed, or reordered.
  const navButtons = () => Array.from(segmentBar.querySelectorAll(".segment-btn[data-page]"));
  function setActiveNav(pageId) {
    navButtons().forEach((btn) => {
      btn.classList.toggle("nav-active", btn.dataset.page === pageId);
    });
  }
  const originalShowPage = window.showPage;
  window.showPage = function (pageId) {
    originalShowPage(pageId);
    setActiveNav(pageId);
  };
  setActiveNav("dashboard");
}
if (isElectronApp) buildDesktopShell();

// ===== KEYBOARD SHORTCUTS (Electron only) =====
// The actual accelerators (Cmd/Ctrl+N, +F, +R) live in the native app menu
// in main.js — they arrive here as menu-action events over the preload
// bridge, then just call the same functions the on-screen buttons use.
if (isElectronApp && window.electronAPI.onMenuAction) {
  window.electronAPI.onMenuAction((action) => {
    if (action === "new-project") {
      window.openModal("project", null);
    } else if (action === "focus-search") {
      window.showPage("dashboard");
      setTimeout(() => {
        const el = document.getElementById("search-projects");
        if (el) {
          el.focus();
          el.select();
        }
      }, 50);
    } else if (action === "refresh") {
      window.refreshAllData();
    }
  });
}

if ("serviceWorker" in navigator && !isElectronApp) {
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("./sw.js?v=28")
      .catch((e) => console.warn(e)),
  );
}
window.addEventListener("online", () => {
  updateSyncStatus();
  // Only meaningful if actually signed in -- if not, there's a valid
  // reason nothing's queued yet to retry (see checkAuthOnStartup in
  // api.js, which also covers the "just signed in" case on its own).
  if (typeof getSessionToken === "function") {
    getSessionToken().then((token) => {
      if (token) syncQueuedRequests().catch((e) => console.error("Reconnect auto-sync failed, items remain queued for retry:", e));
    });
  }
});
window.addEventListener("offline", updateSyncStatus);

// ===== PWA INSTALL =====
let installPromptEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  if (isElectronApp) return;
  e.preventDefault();
  installPromptEvent = e;
  const btn = document.getElementById("pwa-install-btn");
  if (btn) btn.style.display = "inline-flex";
});
window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  const btn = document.getElementById("pwa-install-btn");
  if (btn) btn.style.display = "none";
});

function initPwaInstall() {
  if (isElectronApp) return;
  const btn = document.getElementById("pwa-install-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!installPromptEvent) {
      showInstallFallback();
      return;
    }
    try {
      await installPromptEvent.prompt();
      const result = await installPromptEvent.userChoice;
      if (result.outcome === "accepted") {
        btn.style.display = "none";
      }
      installPromptEvent = null;
    } catch (err) {
      console.error("Install prompt failed:", err);
      showInstallFallback();
    }
  });
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  ) {
    btn.style.display = "none";
    return;
  }
  setTimeout(() => {
    if (!installPromptEvent && btn.style.display === "none") {
      btn.style.display = "inline-flex";
      btn.innerHTML = '<i class="fas fa-download"></i> Add to Home Screen';
    }
  }, 3000);
}

function showInstallFallback() {
  const isAndroid = /Android/.test(navigator.userAgent);
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Add to Home Screen";
  overlay.style.display = "flex";
  if (isAndroid) {
    body.innerHTML = `<p style="font-size:15px; line-height:1.5;">To install on Android:</p><ol style="font-size:15px; line-height:1.6; padding-left:20px;"><li>Tap the <strong>menu</strong> button <i class="fas fa-ellipsis-v" style="color:var(--primary);"></i> in Chrome.</li><li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li><li>Tap <strong>Add</strong> or <strong>Install</strong>.</li></ol><p style="font-size:13px; color:var(--muted); margin-top:10px;">Once added, open from your home screen for full-screen experience.</p>`;
  } else {
    body.innerHTML = `<p style="font-size:15px; line-height:1.5;">To install this app:</p><ol style="font-size:15px; line-height:1.6; padding-left:20px;"><li>Open your browser menu.</li><li>Look for <strong>Add to Home Screen</strong> or <strong>Install App</strong>.</li><li>Follow the prompts to add the icon to your home screen.</li></ol>`;
  }
  submit.style.display = "block";
  submit.innerText = "Close";
  submit.onclick = closeModal;
}

// ===== LOAD EVENT =====
window.addEventListener("load", () => {
  if (appStarted) return;
  appStarted = true;
  updateSyncStatus();
  showPageWithoutRefresh("dashboard");
  refreshMasterDashboard();
  initPwaInstall();
  if (typeof migrateLegacySnagPhotos === "function") migrateLegacySnagPhotos();

  (async function preloadAllData() {
    const endpoints = [
      { action: "getProjects", key: "projects", isArray: true },
      { action: "getVendors", key: "vendors", isArray: true },
      { action: "getPayments", key: "payments", isArray: true },
      { action: "getWorkOrders", key: "workorders", isArray: true },
      { action: "getSnags", key: "snags", isArray: true },
      { action: "getProgressLogs", key: "progressLogs", isArray: true },
      { action: "getSettings", key: "settings", isArray: false },
    ];
    // These 7 endpoints don't depend on each other — fetching them one at
    // a time in sequence meant each one waited on the full round-trip of
    // the previous before even starting. Running them together brings
    // total startup load time down to roughly the slowest single call
    // instead of the sum of all eight.
    // Apps Script's response mechanism (a redirect to a short-lived,
    // single-use "echo" URL) doesn't hold up well under a burst of fully
    // simultaneous requests -- some of those echo URLs expire before the
    // browser gets to follow them, which shows up as a 404 on a request
    // that actually executed fine server-side. Small batches keep most of
    // the speed benefit of running things in parallel without firing
    // everything at Apps Script at once.
    const BATCH_SIZE = 3;
    const results = [];
    for (let i = 0; i < endpoints.length; i += BATCH_SIZE) {
      const batch = endpoints.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map((ep) => callApi(ep.action, {})));
      results.push(...batchResults);
    }
    const cache = getCache();
    results.forEach((result, i) => {
      const ep = endpoints[i];
      if (result.status === "fulfilled") {
        cache[ep.key] = ep.isArray ? result.value || [] : result.value || {};
      } else {
        console.warn("Preload failed for " + ep.action + ":", result.reason);
      }
    });
    setCache(cache);
  })();

  updateSyncStatus();

  // The badge above only updates reactively (right after a sync-related
  // action) -- this catches the case where the app just sits open for a
  // while and the queue state could otherwise drift stale in the meantime.
  setInterval(() => {
    if (typeof updateSyncStatus === "function") updateSyncStatus();
  }, 45000);
});
