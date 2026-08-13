// ===== api.js =====
let cache = {
  projects: [],
  takeoffs: [],
  progressLogs: [],
  snags: [],
  vendors: [],
  workorders: [],
  payments: [],
  settings: {},
};
let currentSelectedProjectId = null;
const API_TIMEOUT_MS = 30000;

// Seed in-memory cache from localStorage backups so the app has data
// immediately on page load without waiting for the network.
// Must run here, after `let cache` is declared, to avoid temporal dead zone.
(function seedCacheFromBackup() {
  const seeds = [
    { key: "projects", action: "getProjects", isArray: true },
    { key: "progressLogs", action: "getProgressLogs", isArray: true },
    { key: "snags", action: "getSnags", isArray: true },
    { key: "vendors", action: "getVendors", isArray: true },
    { key: "workorders", action: "getWorkOrders", isArray: true },
    { key: "payments", action: "getPayments", isArray: true },
    { key: "settings", action: "getSettings", isArray: false },
  ];
  seeds.forEach(({ key, action, isArray }) => {
    try {
      const raw = localStorage.getItem(`fb_${action}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          isArray ? Array.isArray(parsed) : parsed && typeof parsed === "object"
        ) {
          cache[key] = parsed;
        }
      }
    } catch (e) {
      console.warn("seedCacheFromBackup failed for", key, e);
    }
  });
})();

function setCache(newCache) {
  // Deep-merge settings so individual keys (VAT, WHT, Logo…) are never lost
  // by a partial update. All other top-level keys are replaced as before.
  if (newCache.settings && cache.settings) {
    newCache = {
      ...newCache,
      settings: Object.assign({}, cache.settings, newCache.settings),
    };
  }
  cache = { ...cache, ...newCache };
}
function getCache() {
  return cache;
}
function setCurrentProjectId(id) {
  currentSelectedProjectId = id;
}
function getCurrentProjectId() {
  return currentSelectedProjectId;
}

const ROLE_PERMISSIONS = {
  admin: ["*"],
  manager: [
    "get",
    "saveProject",
    "updateProject",
    "updateProjectScope",
    "saveTakeOffItem",
    "updateTakeOffItem",
    "deleteTakeOffItem",
    "saveProgressLog",
    "updateProgressLog",
    "deleteProgressLog",
    "saveSnag",
    "updateSnag",
    "deleteSnag",
    "saveVendor",
    "updateVendor",
    "saveWorkOrder",
    "updateWorkOrder",
    "saveVariation",
    "updateVariation",
    "deleteVariation",
    "saveTakeOff",
    "updateTakeOff",
    "deleteTakeOff",
    "updateProjectPcrFields",
    "savePhoto",
    "updatePhotoComment",
    "updatePhotoMeta",
    "deletePhoto",
    "restorePhoto",
    "purgePhoto",
    "savePhotoLink",
    "deletePhotoLink",
    "getPhotoLinks",
    "saveDocument",
    "updateDocumentMetadata",
    "deleteDocument",
    "restoreDocument",
    "getDocuments",
  ],
  accountant: ["get", "savePayment", "updatePayment"],
  viewer: ["get"],
};

function getFieldScanUser() {
  return {
    email: localStorage.getItem("fieldscan_user_email") || FIELD_SCAN_USER.email || "",
    role: localStorage.getItem("fieldscan_user_role") || FIELD_SCAN_USER.role || "viewer",
  };
}

function canPerformAction(action) {
  const role = getFieldScanUser().role;
  const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
  return (
    allowed.includes("*") ||
    allowed.includes(action) ||
    (action.startsWith("get") && allowed.includes("get"))
  );
}

function buildRequestEnvelope(action, data) {
  // mutationId (attached by queueOfflineRequest for queued writes) travels
  // at the envelope's top level, not inside `data` -- it's plumbing for
  // the server's idempotent-replay check, not part of the business
  // payload any handler should see.
  const { mutationId, ...restData } = data || {};
  const envelope = {
    action,
    data: restData,
    user: getFieldScanUser(),
  };
  if (mutationId) envelope.mutationId = mutationId;
  if (AUTH_TOKEN) envelope.token = AUTH_TOKEN;
  return envelope;
}

/**
 * Real server-side auth (replacing the old shared-secret model) requires
 * every request to carry a verified Google ID token. Wherever Google
 * Sign-In / One Tap is wired up on this client, it should keep this
 * populated (e.g. on successful sign-in and on token refresh) --
 * everything below just reads whatever's currently there.
 */
/**
 * Real server-side auth requires every request to carry a verified Google
 * ID token. On desktop, this comes from main.js's OAuth loopback flow via
 * the preload bridge (window.electronAuth) -- silently refreshed from the
 * saved refresh token when possible, so most calls never need the user to
 * interact with anything. Falls back to null (unauthenticated) if there's
 * no session yet; callers should prompt signInWithGoogle() in that case.
 */
async function getGoogleIdToken() {
  if (window.electronAuth && typeof window.electronAuth.getIdToken === "function") {
    try {
      const result = await window.electronAuth.getIdToken();
      if (result.success && result.idToken) return result.idToken;
    } catch (e) {
      console.warn("getGoogleIdToken: silent refresh failed", e);
    }
    return null; // no saved session -- caller should trigger signInWithGoogle()
  }
  // Non-Electron fallback (e.g. a plain browser deployment of this same
  // frontend) -- nothing populates this today, but kept so the app
  // doesn't hard-fail if window.electronAuth isn't present.
  return localStorage.getItem("fieldscan_google_id_token") || null;
}

/**
 * Runs the interactive Google sign-in (opens the system browser). Call
 * this from a "Sign in" button, or automatically on startup if
 * getGoogleIdToken() comes back null.
 */
async function signInWithGoogle() {
  if (!window.electronAuth || typeof window.electronAuth.signInWithGoogle !== "function") {
    throw new Error("Google sign-in is only available in the desktop app.");
  }
  const result = await window.electronAuth.signInWithGoogle();
  if (!result.success) throw new Error(result.error || "Sign-in failed");
  if (result.email) {
    localStorage.setItem("fieldscan_user_email", result.email);
    FIELD_SCAN_USER.email = result.email;
  }
  if (typeof showSyncToast === "function") showSyncToast(`✅ Signed in as ${result.email}`);
  hideSignInBanner();
  return result;
}
window.signInWithGoogle = signInWithGoogle;

/**
 * A small, non-blocking banner shown at the top of the app when there's no
 * valid session -- the app stays fully usable underneath (offline-first:
 * reads still fall back to local cache, writes still queue), this is just
 * a visible nudge to sign in rather than a wall blocking everything.
 *
 * Self-contained (creates its own DOM element, no dependency on the rest
 * of the app's UI structure) so it works regardless of what page/layout
 * conventions the surrounding app uses.
 */
function showSignInBanner() {
  let banner = document.getElementById("fieldscan-signin-banner");
  if (banner) { banner.style.display = "flex"; return; } // already shown
  banner = document.createElement("div");
  banner.id = "fieldscan-signin-banner";
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:8000;" +
    "background:#b45309;color:#fff;padding:10px 16px;" +
    "display:flex;align-items:center;justify-content:center;gap:12px;" +
    "font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.2);";
  const text = document.createElement("span");
  text.textContent = "You're not signed in — some data may be out of date.";
  const btn = document.createElement("button");
  btn.textContent = "Sign In";
  btn.style.cssText =
    "background:#fff;color:#b45309;border:none;border-radius:6px;" +
    "padding:6px 14px;font-weight:700;font-size:13px;cursor:pointer;";
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Signing in...";
    try {
      await signInWithGoogle();
      // signInWithGoogle() only clears the banner -- it doesn't tell
      // whatever page you're currently looking at to refetch its data,
      // and there's no single "refresh the current view" hook this file
      // can call generically across every page. A full reload is blunt,
      // but it's the one thing guaranteed to make every page re-fetch
      // with the now-valid token, rather than silently continuing to
      // show whatever empty/stale result it got before you signed in.
      window.location.reload();
    } catch (e) {
      alert("Sign-in failed: " + (e.message || "Unknown error"));
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  };
  banner.appendChild(text);
  banner.appendChild(btn);
  document.body.appendChild(banner);
}

function hideSignInBanner() {
  const banner = document.getElementById("fieldscan-signin-banner");
  if (banner) banner.style.display = "none";
}

/**
 * Runs once when the app loads: checks whether there's a valid session
 * (silently, via the main process's saved refresh token -- no browser
 * popup unless the user clicks the banner's button) and shows the banner
 * if not. This is what was missing before -- signInWithGoogle() existed
 * but nothing ever called it or getGoogleIdToken() proactively, so an
 * expired/missing session only ever showed up as silent 401s in the
 * console instead of something the user could actually act on.
 */
async function checkAuthOnStartup() {
  try {
    const token = await getGoogleIdToken();
    if (token) hideSignInBanner();
    else showSignInBanner();
  } catch (e) {
    showSignInBanner();
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkAuthOnStartup);
} else {
  checkAuthOnStartup();
}

async function apiRequestHeaders() {
  const headers = { "Content-Type": "application/json" };
  const idToken = await getGoogleIdToken();
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  return headers;
}

async function callApi(action, data = {}) {
  const isGet = action.startsWith("get");
  if (!canPerformAction(action)) {
    throw new Error(`Your current role cannot perform ${action}`);
  }
  // Strip the auth token from the data payload so it never reaches sheet rows.
  // The token is sent at the top-level of the request envelope instead.
  const { token: _stripped, ...cleanData } = data;
  let response;
  // A handful of actions genuinely need to scan or modify many sheets in
  // one server-side execution (export gathers ~15 sheets' worth of data,
  // permanent delete cascades across the same set) -- the normal 12s
  // budget is tuned for single-sheet operations and isn't enough for these.
  const HEAVY_ACTIONS = { getProjectFullExportData: 120000, permanentlyDeleteProject: 120000 };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEAVY_ACTIONS[action] || API_TIMEOUT_MS);
  try {
    const payload = buildRequestEnvelope(action, cleanData);
    response = await fetch(GAS_URL, {
      method: "POST",
      headers: await apiRequestHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn(`callApi [${action}] network error:`, err);
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    await queueOfflineRequest(action, cleanData);
    applyLocalMutation(action, cleanData);
    updateSyncStatus();
    showSyncToast("📴 Offline: saved locally. Will sync when back online.");
    return { status: "queued" };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.warn(`callApi [${action}] HTTP ${response.status}`);
    if (response.status === 401) showSignInBanner();
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    throw new Error(`HTTP ${response.status}`);
  }

  // Check if response is plain text (like "Unauthorized") instead of JSON
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.clone().text();
    console.warn(
      `callApi [${action}] non-JSON response:`,
      text.substring(0, 200),
    );
    if (text.trim().toLowerCase() === "unauthorized") {
      if (isGet)
        return readBackup(
          action,
          action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        );
      throw new Error(
        "Unauthorized - check AUTH_TOKEN matches Script Properties",
      );
    }
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    throw new Error("Server returned non-JSON: " + text.substring(0, 100));
  }
  let result;
  try {
    result = await response.json();
  } catch (err) {
    console.warn(`callApi [${action}] JSON parse error:`, err);
    // FIX: Try to read the response as text to diagnose the issue
    try {
      const text = await response.clone().text();
      console.warn(`callApi [${action}] raw response:`, text.substring(0, 200));
    } catch (e) {
      // ignore
    }
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    throw new Error("Invalid response from server");
  }
  // FIX: Handle non-JSON responses (e.g., "Unauthorized", HTML error pages)
  if (typeof result === "string") {
    console.warn(
      `callApi [${action}] server returned string instead of JSON:`,
      result,
    );
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    alert(`⚠️ Save failed: ${result}`);
    throw new Error(result);
  }

  if (result && (result.status === "error" || result.success === false)) {
    const message =
      result.message || result.error || "Server rejected the request";
    console.warn(`callApi [${action}] server error:`, message);
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    alert(`⚠️ Save failed: ${message}`);
    throw new Error(message);
  }
  const returnValue =
    isGet && result && result.data !== undefined ? result.data : result;

  // Protect backup from being wiped by empty server responses. Scoped to
  // this exact request's parameters (see backupKey) -- otherwise this
  // guard is what was substituting a completely different group/project's
  // stale cached data into a genuinely empty response for a new one.
  if (isGet) {
    if (Array.isArray(returnValue) && returnValue.length === 0) {
      const backupRaw = localStorage.getItem(backupKey(action, cleanData));
      if (backupRaw) {
        try {
          const backupParsed = JSON.parse(backupRaw);
          if (Array.isArray(backupParsed) && backupParsed.length > 0) {
            console.warn(
              `callApi [${action}] server returned empty; preserving ${backupParsed.length} backed-up items`,
            );
            writeBackup(action, backupParsed, cleanData);
            return backupParsed;
          }
        } catch (e) {
          // ignore parse error, fall through to normal behavior
        }
      }
    }
    writeBackup(action, returnValue, cleanData);
  }
  return returnValue;
}

const DEPENDENCY_ORDER = {
  saveProject: 1,
  updateProject: 1,
  saveVendor: 2,
  updateVendor: 2,
  saveWorkOrder: 3,
  updateWorkOrder: 3,
  saveTakeOffItem: 5,
  updateTakeOffItem: 5,
  deleteTakeOffItem: 5,
  saveProgressLog: 6,
  saveSnag: 7,
  updateSnag: 7,
  deleteSnag: 7,
  savePayment: 8,
  updatePayment: 8,
  trashProject: 99,
  restoreProject: 1, // should happen early -- other pending saves for a just-restored project shouldn't be blocked behind it
  permanentlyDeleteProject: 100,
};

/**
 * For actions the UI wants to feel instant regardless of network speed:
 * queue it (so it shows up in the sync indicator immediately, same as a
 * genuine offline action would) and kick off processing right away,
 * without the caller waiting for it. syncQueuedRequests() already retries
 * with backoff and clears the item on success, so this reuses that
 * exact machinery rather than building a parallel one.
 */
async function runInBackground(action, data) {
  await queueOfflineRequest(action, data);
  await updateSyncStatus();
  syncQueuedRequests().catch((e) => console.error("Background action failed, will remain in sync queue for retry:", action, e));
}
window.runInBackground = runInBackground;

async function syncQueuedRequests() {
  await updateSyncStatus();
  let queue = await getQueuedRequests();
  if (!queue.length) return;
  showSyncToast("🔄 Syncing offline data...", 10000);
  queue.sort(
    (a, b) =>
      (DEPENDENCY_ORDER[a.action] || 99) - (DEPENDENCY_ORDER[b.action] || 99),
  );
  const failedActions = [];
  for (let item of queue) {
    let retries = 3,
      delay = 1000,
      success = false;
    while (retries > 0 && !success) {
      try {
        const payload = buildRequestEnvelope(item.action, item.data);
        const response = await fetch(GAS_URL, {
          method: "POST",
          headers: await apiRequestHeaders(),
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          const result = await response.json();
          if (
            !result.error &&
            result.success !== false &&
            result.status !== "error"
          ) {
            await deleteQueuedRequest(item.id);
            success = true;
            break;
          }
          throw new Error(
            result.message || result.error || "Server rejected request",
          );
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        retries--;
        await updateQueuedRequest(item.id, {
          retryCount: (item.retryCount || 0) + 1,
          lastError: err.message || "Sync failed",
          lastAttempt: new Date().toISOString(),
        });
        if (retries === 0) {
          console.error("Failed to sync", item.action, item.data);
          showSyncToast(
            `⚠️ Failed to sync ${item.action}. Will retry later.`,
            4000,
          );
          failedActions.push(item.action);
        } else {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        }
      }
    }
  }
  await refreshMasterDashboard();
  const vendorsView = document.getElementById("view-vendors");
  if (vendorsView && vendorsView.classList.contains("active-view"))
    refreshVendorsListView();
  if (currentSelectedProjectId) {
    loadProgressTimelineFeed(true);
    loadSnagsListings(true);
    loadWorkOrdersListings(true);
    loadPaymentsListings(true);
  }
  await updateSyncStatus();
  if (typeof window.notifyDesktop === "function") {
    if (failedActions.length) {
      window.notifyDesktop(
        "Sync finished with errors",
        `${failedActions.length} of ${queue.length} item(s) failed and will retry later.`,
      );
    } else {
      window.notifyDesktop(
        "Sync complete",
        `${queue.length} item(s) synced successfully.`,
      );
    }
  }
}

async function updateSyncStatus() {
  const badge = document.getElementById("sync-status");
  const pendingBadge = document.getElementById("sync-pending-badge");
  const queue = await getQueuedRequests();
  if (pendingBadge) {
    pendingBadge.textContent = queue.length;
    pendingBadge.style.display = queue.length ? "inline-block" : "none";
  }
  if (!badge) return;
  if (!navigator.onLine) {
    badge.innerHTML = `<i class="fas fa-wifi"></i> Offline${queue.length ? ` • ${queue.length} pending` : ""}`;
    badge.style.display = "block";
    return;
  }
  if (queue.length) {
    badge.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> ${queue.length} pending`;
    badge.style.display = "block";
    return;
  }
  badge.style.display = "none";
}

async function openSyncQueuePanel() {
  const panelId = "sync-queue-panel";
  openFullPagePanel(panelId, "Sync Queue");
  const body = document.getElementById(panelId + "-body");
  const footer = document.getElementById(panelId + "-footer");
  if (footer) footer.style.display = "none";
  await renderSyncQueuePanelBody(panelId);
}
window.openSyncQueuePanel = openSyncQueuePanel;

async function renderSyncQueuePanelBody(panelId) {
  const body = document.getElementById(panelId + "-body");
  if (!body) return;
  const queue = (await getQueuedRequests()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (!queue.length) {
    body.innerHTML = '<p style="text-align:center; padding:20px; color:var(--muted);">No pending sync items.</p>';
    return;
  }

  window.syncQueueItemsById = window.syncQueueItemsById || {};
  const rows = queue.map((item) => {
    window.syncQueueItemsById[item.id] = item;
    const when = item.timestamp ? new Date(item.timestamp).toLocaleString() : "Unknown time";
    const errorLine = item.lastError
      ? '<div style="font-size:12px; color:var(--danger); margin-top:4px;">' + escapeHtml(item.lastError) + '</div>'
      : "";
    return (
      '<div class="card" style="margin-bottom:8px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">' +
      '<div><strong style="font-size:13px;">' + escapeHtml(item.action) + '</strong><div style="font-size:11px; color:var(--muted);">' + escapeHtml(when) + (item.retryCount ? ' · retried ' + item.retryCount + 'x' : '') + '</div></div>' +
      '<div style="display:flex; gap:6px; flex-shrink:0;">' +
      '<button class="action-btn" style="width:auto; padding:6px 10px; font-size:11px;" onclick="window.retrySingleQueuedItem(' + item.id + ', \'' + panelId + '\')"><i class="fas fa-rotate-right"></i></button>' +
      '<button class="action-btn" style="width:auto; padding:6px 10px; font-size:11px; background:var(--danger);" onclick="window.deleteSingleQueuedItem(' + item.id + ', \'' + panelId + '\')"><i class="fas fa-trash"></i></button>' +
      '</div></div>' +
      errorLine +
      '</div>'
    );
  }).join("");

  body.innerHTML =
    '<button class="action-btn" style="width:auto; padding:8px 16px; font-size:12px; background:var(--danger); margin-bottom:14px;" onclick="window.clearAllQueuedItems(\'' + panelId + '\')"><i class="fas fa-trash-can"></i> Clear All (' + queue.length + ')</button>' +
    rows;
}

async function retrySingleQueuedItem(id, panelId) {
  try {
    await retryQueuedRequest(id);
    if (typeof showSyncToast === "function") showSyncToast("✅ Synced");
  } catch (e) {
    if (typeof showSyncToast === "function") showSyncToast("⚠️ Still failing: " + (e.message || "Unknown error"));
  }
  await renderSyncQueuePanelBody(panelId);
}
window.retrySingleQueuedItem = retrySingleQueuedItem;

async function deleteSingleQueuedItem(id, panelId) {
  const item = window.syncQueueItemsById ? window.syncQueueItemsById[id] : null;
  if (!confirm('Discard this queued "' + (item ? item.action : "sync") + '" action? This can\'t be undone — the change it represents will never reach the server.')) return;
  await deleteQueuedRequest(id);
  await updateSyncStatus();
  await renderSyncQueuePanelBody(panelId);
}
window.deleteSingleQueuedItem = deleteSingleQueuedItem;

async function clearAllQueuedItems(panelId) {
  const queue = await getQueuedRequests();
  if (!queue.length) return;
  if (!confirm("Discard all " + queue.length + " pending sync item(s)? This can't be undone — none of these changes will ever reach the server.")) return;
  for (const item of queue) {
    await deleteQueuedRequest(item.id);
  }
  await updateSyncStatus();
  await renderSyncQueuePanelBody(panelId);
  if (typeof showSyncToast === "function") showSyncToast("🗑️ Sync queue cleared");
}
window.clearAllQueuedItems = clearAllQueuedItems;

async function retryQueuedRequest(id) {
  const queue = await getQueuedRequests();
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  const payload = buildRequestEnvelope(item.action, item.data);
  const response = await fetch(GAS_URL, {
    method: "POST",
    headers: await apiRequestHeaders(),
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.error ||
    result.success === false ||
    result.status === "error"
  ) {
    const message = result.message || result.error || `HTTP ${response.status}`;
    await updateQueuedRequest(id, {
      retryCount: (item.retryCount || 0) + 1,
      lastError: message,
      lastAttempt: new Date().toISOString(),
    });
    throw new Error(message);
  }
  await deleteQueuedRequest(id);
  await updateSyncStatus();
}

function setButtonState(buttonId, html, disabled) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.innerHTML = html;
  button.disabled = disabled;
  button.style.opacity = disabled ? "0.65" : "";
  button.style.pointerEvents = disabled ? "none" : "";
}

function showFinishedButtonState(buttonId, doneHtml, normalHtml) {
  setButtonState(buttonId, doneHtml, false);
  setTimeout(() => {
    setButtonState(buttonId, normalHtml, false);
    updateSyncStatus();
  }, 1200);
}

async function triggerManualSync() {
  if (!navigator.onLine) {
    alert("You are offline. Please connect to internet.");
    return;
  }
  const normalHtml = `<i class="fas fa-sync-alt"></i> Sync Now <span id="sync-pending-badge" class="sync-count-badge" style="display:none;">0</span>`;
  try {
    setButtonState(
      "sync-now-btn",
      `<i class="fas fa-sync-alt fa-spin"></i> Syncing...`,
      true,
    );
    await syncQueuedRequests();
    showFinishedButtonState(
      "sync-now-btn",
      `<i class="fas fa-check"></i> Synced`,
      normalHtml,
    );
  } catch (err) {
    setButtonState("sync-now-btn", normalHtml, false);
    throw err;
  } finally {
    await updateSyncStatus();
  }
}

async function refreshAllData() {
  if (!navigator.onLine) {
    alert("Offline – cannot refresh from server.");
    return;
  }
  const normalHtml = `<i class="fas fa-database"></i> Refresh`;
  try {
    setButtonState(
      "refresh-data-btn",
      `<i class="fas fa-spinner fa-spin"></i> Refreshing...`,
      true,
    );
    // Fetch all endpoints and update both localStorage backup AND in-memory cache
    const endpoints = [
      { action: "getProjects", key: "projects", isArray: true },
      { action: "getProgressLogs", key: "progressLogs", isArray: true },
      { action: "getSnags", key: "snags", isArray: true },
      { action: "getVendors", key: "vendors", isArray: true },
      { action: "getWorkOrders", key: "workorders", isArray: true },
      { action: "getPayments", key: "payments", isArray: true },
    ];
    for (const ep of endpoints) {
      const res = await callApi(ep.action, {});
      const c = getCache();
      c[ep.key] = ep.isArray ? res || [] : res || {};
      // Reset loaded flags so console segments re-render with fresh data
      const loadedFlag = ep.key + "Loaded";
      c[loadedFlag] = true;
      setCache(c);
    }
    const settingsRes = await callApi("getSettings", {});
    if (settingsRes && typeof settingsRes === "object") {
      const c = getCache();
      // Deep-merge settings so individual keys are preserved
      c.settings = Object.assign(
        {},
        c.settings,
        settingsRes.data || settingsRes,
      );
      setCache(c);
    }
    await refreshMasterDashboard();
    if (currentSelectedProjectId) {
      loadProgressTimelineFeed(true);
      loadSnagsListings(true);
      loadWorkOrdersListings(true);
      loadPaymentsListings(true);
    }
    showFinishedButtonState(
      "refresh-data-btn",
      `<i class="fas fa-check"></i> Refreshed`,
      normalHtml,
    );
  } catch (err) {
    setButtonState("refresh-data-btn", normalHtml, false);
    if (typeof window.notifyDesktop === "function") {
      window.notifyDesktop(
        "Refresh failed",
        err.message || "Could not refresh data from the server.",
      );
    }
    throw err;
  }
}
