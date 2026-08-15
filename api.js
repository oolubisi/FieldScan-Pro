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
 * the preload bridge (window.electronAuth) when running in Electron, or
 * localStorage directly when running as a plain browser/PWA deployment
 * of this same frontend -- multiple accounts can be cached at once on
 * either platform, this always fetches the token for whichever account
 * is CURRENTLY active (fieldscan_user_email). Falls back to null
 * (unauthenticated) if there's no session yet -- callers should show
 * the sign-in form in that case (see openSignInDialog() below).
 */
async function getSessionToken() {
  const email = localStorage.getItem("fieldscan_user_email");
  if (!email) return null;
  return getAccountTokenAnyPlatform(email);
}

/**
 * The three platform-abstracted account-storage primitives, each
 * branching on window.electronAuth vs. a parallel localStorage-based
 * store for the browser/PWA case. Every other account-related function
 * below builds on just these three, rather than each duplicating the
 * Electron-vs-PWA branch itself.
 */
async function getAccountTokenAnyPlatform(email) {
  email = String(email).toLowerCase().trim();
  if (window.electronAuth && typeof window.electronAuth.getAccountToken === "function") {
    try {
      const result = await window.electronAuth.getAccountToken(email);
      return result.success && result.token ? result.token : null;
    } catch (e) {
      console.warn("getAccountTokenAnyPlatform: could not read stored token", e);
      return null;
    }
  }
  const accounts = JSON.parse(localStorage.getItem("fieldscan_accounts") || "[]");
  const found = accounts.find((a) => String(a.email).toLowerCase().trim() === email);
  return found ? found.token : null;
}

async function saveAccountTokenAnyPlatform(email, token) {
  email = String(email).toLowerCase().trim();
  if (window.electronAuth && typeof window.electronAuth.saveAccountToken === "function") {
    await window.electronAuth.saveAccountToken(email, token);
    return;
  }
  const accounts = JSON.parse(localStorage.getItem("fieldscan_accounts") || "[]");
  const idx = accounts.findIndex((a) => String(a.email).toLowerCase().trim() === email);
  const entry = { email, token, lastUsedAt: Date.now() };
  if (idx === -1) accounts.push(entry);
  else accounts[idx] = entry;
  localStorage.setItem("fieldscan_accounts", JSON.stringify(accounts));
}

async function listAccountsAnyPlatform() {
  if (window.electronAuth && typeof window.electronAuth.listAccounts === "function") {
    try {
      const result = await window.electronAuth.listAccounts();
      return result.success ? result.accounts : [];
    } catch (e) {
      return [];
    }
  }
  const accounts = JSON.parse(localStorage.getItem("fieldscan_accounts") || "[]");
  return accounts
    .map((a) => ({ email: a.email, lastUsedAt: a.lastUsedAt }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

async function removeAccountAnyPlatform(email) {
  email = String(email).toLowerCase().trim();
  if (window.electronAuth && typeof window.electronAuth.removeAccount === "function") {
    await window.electronAuth.removeAccount(email);
    return;
  }
  const accounts = JSON.parse(localStorage.getItem("fieldscan_accounts") || "[]").filter((a) => String(a.email).toLowerCase().trim() !== email);
  localStorage.setItem("fieldscan_accounts", JSON.stringify(accounts));
}

/**
 * Decodes (never verifies -- that's the server's job) a session
 * token's payload just far enough to read its expiry, so a cached
 * account can be checked for "still good" entirely offline, with no
 * network call. Treats anything malformed as expired -- a safe default
 * that just falls through to requiring a real login instead of risking
 * treating a broken token as valid.
 */
function isTokenExpired(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp;
  } catch (e) {
    return true;
  }
}

/**
 * POSTs email+password directly to /api/login (NOT the main GAS_URL
 * dispatcher -- that one requires a token, which is exactly what this
 * call is trying to obtain) and caches the returned token as THIS
 * account's entry -- alongside, not replacing, any other accounts
 * already cached on this device.
 */
async function login(email, password) {
  const loginUrl = GAS_URL.replace(/\/api\/?$/, "") + "/api/login";
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Invalid email or password");
  }

  await saveAccountTokenAnyPlatform(result.email, result.token);
  localStorage.setItem("fieldscan_user_email", String(result.email).toLowerCase().trim());
  FIELD_SCAN_USER.email = result.email;
  FIELD_SCAN_USER.role = result.role;

  if (typeof showSyncToast === "function") showSyncToast(`✅ Signed in as ${result.email}`);
  setSignInMenuState(true);
  return result;
}
window.login = login;

/**
 * Switches to an account already cached on this device -- entirely
 * offline if its cached token hasn't expired, no password re-entry.
 * Clears the fb_* local display cache either way (this is what
 * actually guarantees no visible mixing between accounts, independent
 * of whether the switch was instant or required a fresh login).
 * Returns true if the instant switch worked; false means the caller
 * should fall back to the normal email/password sign-in flow for this
 * account instead (cached token missing or expired).
 */
async function switchToAccount(email) {
  email = String(email).toLowerCase().trim();
  const token = await getAccountTokenAnyPlatform(email);
  if (!token || isTokenExpired(token)) return false;

  // No cache-wiping needed here anymore -- backupKey() in backup.js is
  // namespaced per account, so changing which email is active
  // automatically reveals THAT account's own previously-synced data
  // (if any), rather than an empty app until network returns. This is
  // what makes offline switching actually useful, not just safe.
  localStorage.setItem("fieldscan_user_email", email);
  window.location.reload();
  return true;
}
window.switchToAccount = switchToAccount;

/**
 * A small, non-blocking banner shown at the top of the app when there's
 * no valid session -- the app stays fully usable underneath (offline-
 * first: reads still fall back to local cache, writes still queue).
 * Rather than a fixed banner (which risked covering page controls),
 * this updates the existing "Sign In" sidebar/mobile-menu items to a
 * visible not-signed-in state, and opens a small centered dialog with
 * the actual email/password form only when clicked -- nothing fixed or
 * overlapping sits on screen the rest of the time.
 */
function setSignInMenuState(signedIn) {
  const desktopBtn = document.getElementById("sidebar-signin-btn");
  const mobileBtn = document.getElementById("mobile-signin-btn");
  for (const btn of [desktopBtn, mobileBtn]) {
    if (!btn) continue;
    if (signedIn) {
      btn.style.color = "#16a34a";
      btn.innerHTML = '<i class="fas fa-circle-check"></i> Signed In';
    } else {
      btn.style.color = "#b45309";
      btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Sign In';
    }
  }
  if (signedIn) resetInactivityTimer();
  else {
    isCurrentlySignedIn = false;
    clearInactivityTimers();
  }
}

/**
 * Clicking the same sidebar/mobile menu item does different things
 * depending on current state: opens the sign-in dialog if signed out,
 * or signs out (with confirmation) if currently signed in.
 */
function handleSignInMenuClick() {
  if (isCurrentlySignedIn) logout(false);
  else openSignInDialog();
}
window.handleSignInMenuClick = handleSignInMenuClick;

/**
 * Clears the session (Electron's encrypted token file via IPC, or plain
 * localStorage for the browser/PWA case) and reloads. Deliberately does
 * NOT clear the remembered email -- that's a separate, independent
 * convenience (see openSignInDialog's pre-fill) that should survive a
 * normal sign-out, same as most apps remember your username across
 * logins.
 *
 * @param {boolean} silent - true for an automatic (inactivity) logout,
 *   which should never block on a confirm() dialog; false for a manual
 *   click on the "Signed In" menu item, which does confirm first since
 *   an accidental click shouldn't silently sign someone out mid-task.
 */
async function logout(silent) {
  if (!silent && !confirm("Sign out?")) return;
  clearInactivityTimers();
  const email = localStorage.getItem("fieldscan_user_email");
  // Deliberately different from a normal account switch: this REMOVES
  // the account from the cache entirely, both for an explicit "Sign
  // Out" click and an automatic inactivity timeout -- both are cases
  // where the security intent is "prove who you are again next time,"
  // not "keep this cached for instant switching back." A normal
  // switch-away (see switchToAccount above) leaves the account cached.
  if (email) await removeAccountAnyPlatform(email);
  // No cache-wiping needed here either, same reasoning as switchToAccount
  // above: backupKey() in backup.js is namespaced per account, so this
  // account's cached data simply becomes inert once its token is
  // removed -- it can't surface under any OTHER account, and signing
  // back into this exact one requires the real password again anyway.
  window.location.reload();
}
window.logout = logout;

// ===== Inactivity auto-logout =====
// 15 minutes total: a warning appears at the 14-minute mark with a 60s
// countdown, giving a chance to cancel before the actual logout at the
// 15-minute mark. Only runs while actually signed in (see
// setSignInMenuState above) -- there's nothing to time out otherwise.
const INACTIVITY_WARNING_MS = 14 * 60 * 1000;
const INACTIVITY_LOGOUT_MS = 60 * 1000;
let inactivityWarnTimer = null;
let inactivityLogoutTimer = null;
let inactivityCountdownInterval = null;
let isCurrentlySignedIn = false;

function clearInactivityTimers() {
  if (inactivityWarnTimer) clearTimeout(inactivityWarnTimer);
  if (inactivityLogoutTimer) clearTimeout(inactivityLogoutTimer);
  if (inactivityCountdownInterval) clearInterval(inactivityCountdownInterval);
  inactivityWarnTimer = null;
  inactivityLogoutTimer = null;
  inactivityCountdownInterval = null;
  hideInactivityWarning();
}

function resetInactivityTimer() {
  isCurrentlySignedIn = true;
  clearInactivityTimers();
  inactivityWarnTimer = setTimeout(showInactivityWarning, INACTIVITY_WARNING_MS);
}

function showInactivityWarning() {
  // Explicit request: someone actively working OFFLINE (no signal, e.g.
  // filling inspection forms on site) should never get logged out --
  // rather than guess at every possible "still working" event, the
  // simplest robust rule is: don't even start the warning while
  // offline, just check again later. Real user activity (typing,
  // tapping, scrolling) resets the timer as normal regardless of
  // connection state; this only guards the case where someone is
  // reading/reviewing something for a while without triggering one of
  // the tracked events.
  if (!navigator.onLine) {
    inactivityWarnTimer = setTimeout(showInactivityWarning, INACTIVITY_WARNING_MS);
    return;
  }

  let secondsLeft = Math.floor(INACTIVITY_LOGOUT_MS / 1000);
  const banner = document.createElement("div");
  banner.id = "inactivity-warning-banner";
  banner.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:9000;background:#111827;color:#fff;" +
    "padding:12px 16px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);" +
    "font-size:13px;display:flex;align-items:center;gap:12px;max-width:300px;";
  const text = document.createElement("span");
  text.id = "inactivity-warning-text";
  text.textContent = `Signing out in ${secondsLeft}s due to inactivity`;
  const stayBtn = document.createElement("button");
  stayBtn.textContent = "Stay signed in";
  stayBtn.style.cssText = "background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;";
  stayBtn.onclick = resetInactivityTimer;
  banner.appendChild(text);
  banner.appendChild(stayBtn);
  document.body.appendChild(banner);

  inactivityCountdownInterval = setInterval(() => {
    secondsLeft--;
    const textEl = document.getElementById("inactivity-warning-text");
    if (textEl) textEl.textContent = `Signing out in ${secondsLeft}s due to inactivity`;
    if (secondsLeft <= 0) clearInterval(inactivityCountdownInterval);
  }, 1000);

  inactivityLogoutTimer = setTimeout(() => {
    // Same offline exception applies here -- if connectivity dropped
    // during the 60s warning itself, don't log out; just go back to
    // watching for real inactivity.
    if (!navigator.onLine) {
      resetInactivityTimer();
      return;
    }
    logout(true);
  }, INACTIVITY_LOGOUT_MS);
}

function hideInactivityWarning() {
  const banner = document.getElementById("inactivity-warning-banner");
  if (banner) banner.remove();
}

// Any real user activity resets the timer -- throttled to at most once
// every 5s so a held-down key or a mouse being moved across the screen
// doesn't churn through timer resets on every single event.
let lastActivityResetAt = 0;
function onUserActivity() {
  if (!isCurrentlySignedIn) return;
  const now = Date.now();
  if (now - lastActivityResetAt < 5000) return;
  lastActivityResetAt = now;
  resetInactivityTimer();
}
["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((evt) =>
  document.addEventListener(evt, onUserActivity, { passive: true }),
);

/**
 * A small centered modal (not a fixed banner) with the actual email/
 * password form. Opened by clicking the "Sign In" menu item, or
 * automatically the first time a 401 is hit if it isn't already open.
 */
function openEmailPasswordDialog(prefillEmail) {
  if (document.getElementById("fieldscan-signin-dialog")) return; // already open

  const overlay = document.createElement("div");
  overlay.id = "fieldscan-signin-dialog";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.5);" +
    "display:flex;align-items:center;justify-content:center;";

  const box = document.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:12px;padding:24px;max-width:340px;width:90%;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.3);";

  const title = document.createElement("h3");
  title.textContent = "Sign In";
  title.style.cssText = "margin:0 0 16px 0;";

  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.placeholder = "Email";
  emailInput.autocomplete = "username";
  emailInput.value = prefillEmail || localStorage.getItem("fieldscan_user_email") || "";
  emailInput.style.cssText = "width:100%;box-sizing:border-box;padding:10px;margin-bottom:10px;border-radius:8px;border:1.5px solid var(--border, #ccc);font-size:14px;";

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.placeholder = "Password";
  passwordInput.autocomplete = "current-password";
  passwordInput.style.cssText = "width:100%;box-sizing:border-box;padding:10px 40px 10px 10px;margin-bottom:10px;border-radius:8px;border:1.5px solid var(--border, #ccc);font-size:14px;";

  const passwordWrap = document.createElement("div");
  passwordWrap.style.cssText = "position:relative;";
  const togglePasswordBtn = document.createElement("button");
  togglePasswordBtn.type = "button";
  togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
  togglePasswordBtn.setAttribute("aria-label", "Show password");
  togglePasswordBtn.style.cssText =
    "position:absolute;right:8px;top:50%;transform:translateY(-50%);" +
    "background:none;border:none;color:#64748b;cursor:pointer;padding:4px;font-size:14px;";
  togglePasswordBtn.onclick = () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    togglePasswordBtn.innerHTML = showing ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
    togglePasswordBtn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  };
  passwordWrap.appendChild(passwordInput);
  passwordWrap.appendChild(togglePasswordBtn);

  const errorText = document.createElement("div");
  errorText.style.cssText = "color:#b91c1c;font-size:12px;display:none;margin-bottom:10px;";

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "flex:1;padding:10px;border-radius:8px;border:none;background:#f1f5f9;color:#334155;font-weight:600;cursor:pointer;";
  cancelBtn.onclick = () => overlay.remove();

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.textContent = "Sign In";
  submitBtn.style.cssText = "flex:1;padding:10px;border-radius:8px;border:none;background:#b45309;color:#fff;font-weight:700;cursor:pointer;";

  const attemptLogin = async () => {
    errorText.style.display = "none";
    if (!emailInput.value || !passwordInput.value) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    try {
      await login(emailInput.value.trim(), passwordInput.value);
      // Same reasoning as before: a full reload is the one thing
      // guaranteed to make every page re-fetch with the now-valid
      // token, rather than continuing to show stale/empty results.
      window.location.reload();
    } catch (e) {
      errorText.textContent = e.message || "Sign-in failed";
      errorText.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  };
  submitBtn.onclick = attemptLogin;
  passwordInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") attemptLogin(); });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  box.appendChild(title);
  box.appendChild(emailInput);
  box.appendChild(passwordWrap);
  box.appendChild(errorText);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  (emailInput.value ? passwordInput : emailInput).focus();
}
window.openEmailPasswordDialog = openEmailPasswordDialog;

/**
 * The actual "Sign In" menu entry point. Shows a switcher listing
 * every account cached on this device (each one tap away from an
 * instant, fully offline switch if its cached token hasn't expired),
 * plus a "Sign in as someone else" option that falls through to the
 * plain email/password form above. Skips straight to that form if
 * there's nothing cached yet at all -- no point showing an empty list.
 */
async function openSignInDialog() {
  if (document.getElementById("fieldscan-signin-dialog")) return; // already open

  const currentEmail = (localStorage.getItem("fieldscan_user_email") || "").toLowerCase().trim();
  const accounts = (await listAccountsAnyPlatform()).filter((a) => String(a.email).toLowerCase().trim() !== currentEmail);

  if (!accounts.length) {
    openEmailPasswordDialog();
    return;
  }

  const pendingCounts = await getPendingCountsByOtherAccounts();

  const overlay = document.createElement("div");
  overlay.id = "fieldscan-signin-dialog";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.5);" +
    "display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;";

  const box = document.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:12px;padding:22px;max-width:340px;width:100%;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.3);";

  const title = document.createElement("h3");
  title.textContent = "Switch Account";
  title.style.cssText = "margin:0 0 14px 0;";
  box.appendChild(title);

  for (const account of accounts) {
    const pending = pendingCounts[account.email] || 0;
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText =
      "display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;" +
      "padding:10px 12px;margin-bottom:8px;border-radius:8px;border:1.5px solid var(--border,#ddd);" +
      "background:#fff;cursor:pointer;font-size:14px;";
    row.innerHTML =
      `<span style="font-weight:600;">${escapeHtml(account.email)}</span>` +
      (pending > 0
        ? `<span style="font-size:12px;color:#b45309;margin-top:2px;">${pending} item${pending === 1 ? "" : "s"} waiting to sync</span>`
        : "");
    row.onclick = async () => {
      row.disabled = true;
      const switched = await switchToAccount(account.email);
      if (!switched) {
        // Cached token missing or expired -- fall back to a real login,
        // pre-filled, rather than failing silently.
        overlay.remove();
        openEmailPasswordDialog(account.email);
      }
    };
    box.appendChild(row);
  }

  const otherBtn = document.createElement("button");
  otherBtn.type = "button";
  otherBtn.textContent = "Sign in as someone else";
  otherBtn.style.cssText =
    "width:100%;padding:10px;margin-top:4px;border-radius:8px;border:none;" +
    "background:#f1f5f9;color:#334155;font-weight:600;cursor:pointer;font-size:13px;";
  otherBtn.onclick = () => {
    overlay.remove();
    openEmailPasswordDialog();
  };
  box.appendChild(otherBtn);

  overlay.appendChild(box);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
window.openSignInDialog = openSignInDialog;

/**
 * Runs once when the app loads: checks whether there's a saved session
 * token and updates the menu indicator accordingly. An expired/missing
 * session only ever showing up as silent 401s in the console (instead
 * of something the user can act on) is exactly the gap this closes.
 */
async function checkAuthOnStartup() {
  try {
    const token = await getSessionToken();
    setSignInMenuState(!!token);

    // Show the right company name immediately, from whatever's already
    // cached locally for THIS company (namespaced per-account, so this
    // is correct even offline and even right after switching). This is
    // gated on fieldscan_user_email, deliberately NOT on having a valid
    // token -- "signed out" in this offline-first app only means "no
    // live connection to sync with," not "no active company context."
    // The local cache (and the ability to keep queuing offline writes
    // against it) stays fully alive and correctly scoped to whichever
    // company you were last working in, sign-out or not.
    const activeEmail = localStorage.getItem("fieldscan_user_email");
    if (activeEmail) {
      const cache = getCache();
      cache.settings = readBackup("getSettings", cache.settings || {}, {});
      setCache(cache);
      if (typeof applyCompanyNameToSidebar === "function") applyCompanyNameToSidebar();
    }

    // Runs on every launch AND right after a successful sign-in (login()
    // reloads the page, which re-runs this from scratch) -- so this is
    // the one place that naturally covers both "app just launched with
    // pending queue items from a previous offline session" and "just
    // signed in, flush anything that got queued while unauthenticated."
    // Auto-sync and the live settings refresh below DO still require an
    // actual valid token -- unlike the local-only seeding above, these
    // genuinely need a real connection to the server.
    if (token && navigator.onLine) {
      syncQueuedRequests().catch((e) => console.error("Startup auto-sync failed, items remain queued for retry:", e));
      // Also refresh settings from the server -- the local backup above
      // is a good-enough instant guess, but the real company name (or
      // logo, or anything else settings-driven) may have changed since
      // it was last cached.
      callApi("getSettings", {}).then((res) => {
        if (res && typeof res === "object") {
          const c = getCache();
          c.settings = Object.assign({}, c.settings, res.data || res);
          setCache(c);
          if (typeof applyCompanyNameToSidebar === "function") applyCompanyNameToSidebar();
        }
      }).catch((e) => console.warn("Startup settings refresh failed, using cached value:", e));
    }
  } catch (e) {
    setSignInMenuState(false);
  }
}
/**
 * Only meaningful for the browser/PWA case -- Electron's equivalent
 * lives in main.js's app.whenReady(), which has a genuine "real launch
 * vs. renderer-triggered reload" signal that a plain webpage doesn't
 * have access to. sessionStorage is the closest browser equivalent: it
 * survives page reloads within the same tab (so switchToAccount()'s and
 * login()'s own reloads don't trigger this), but is cleared the moment
 * the tab/window actually closes -- exactly the distinction needed to
 * apply the same "real password required on every genuine app open"
 * rule consistently on mobile/PWA too, not just desktop.
 */
function wipeAccountsIfGenuinelyFreshBrowserSession() {
  if (window.electronAuth) return; // Electron handles this itself, in main.js
  if (sessionStorage.getItem("fieldscan_session_active")) return; // just an in-page reload, not a real reopen
  localStorage.removeItem("fieldscan_accounts");
  sessionStorage.setItem("fieldscan_session_active", "1");
}
wipeAccountsIfGenuinelyFreshBrowserSession();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkAuthOnStartup);
} else {
  checkAuthOnStartup();
}

/**
 * Shared by both failure modes that should queue a write for later
 * rather than lose it: a genuine network failure (fetch() itself
 * throws), and a 401 (no valid session at all) on a write action.
 * These are DIFFERENT problems -- one is connectivity, the other is
 * authentication -- but the user experience should be identical either
 * way: the save happens locally right away, exactly as if it had
 * succeeded, and the actual server write is retried automatically once
 * whatever was blocking it (connectivity, or someone signing back in)
 * is resolved. A write that's destined to keep failing with the exact
 * same 401 until a human re-authenticates isn't a reason to lose the
 * data someone just typed -- it's exactly the kind of thing offline
 * queueing already exists to protect against.
 */
async function queueWriteLocally(action, cleanData, reason) {
  const { id: queuedItemId, mutationId } = await queueOfflineRequest(action, cleanData);
  const tempIdInfo = applyLocalMutation(action, cleanData);
  // A brand-new item's own queued request never carries its own future
  // id (the server assigns it) -- only OTHER items that reference it
  // do. Without writing the generated temp id back into THIS item's own
  // persisted payload too, reconciliation has nothing to find in the
  // succeeding request's own data when it's this item's turn to sync,
  // so any OTHER queued item referencing the same temp id (e.g. an
  // updateEstimate or createProjectFromEstimate for an estimate that
  // was just created) never gets corrected -- exactly the remaining
  // bug behind "invalid input syntax for type uuid" on a downstream
  // action, even after the create itself succeeds. Harmless to the
  // server either way: the backend's insert never reads this field
  // from a create payload, it only ever returns the real one.
  //
  // Critically: this preserves the SAME mutationId queueOfflineRequest
  // already generated and stored -- not a fresh/missing one -- since
  // that's what the idempotent-replay guard keys on; silently losing it
  // here would have broken that entirely.
  if (tempIdInfo && queuedItemId != null) {
    try {
      await updateQueuedRequest(queuedItemId, {
        data: { ...cleanData, mutationId, [tempIdInfo.idKey]: tempIdInfo.idVal },
      });
    } catch (e) {
      console.error("Failed to write temp id back into queued request", e);
    }
  }
  updateSyncStatus();
  showSyncToast(
    reason === "auth"
      ? "🔒 Not signed in: saved locally. Will sync once you sign in."
      : "📴 Offline: saved locally. Will sync when back online.",
  );
  // success:true (not just status:"queued") so the many existing call
  // sites across the app that check `if (!resp.success)` keep working
  // unchanged instead of misreporting a successful queue as a failure.
  // When this was a brand-new item (not an update/delete), the temp id
  // from applyLocalMutation is echoed back under its real field name
  // (e.g. estimateId, taskId) so the calling code can keep going --
  // opening or referencing the new item -- exactly as if the save had
  // returned from the server normally.
  return {
    success: true,
    status: "queued",
    ...(tempIdInfo ? { [tempIdInfo.idKey]: tempIdInfo.idVal } : {}),
  };
}

async function apiRequestHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
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
    return queueWriteLocally(action, cleanData, "offline");
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.warn(`callApi [${action}] HTTP ${response.status}`);
    if (response.status === 401) setSignInMenuState(false);
    if (isGet)
      return readBackup(
        action,
        action === "getStats" ? { activeVendors: "--" } : action === "getProjectFullExportData" ? { success: false, error: "offline-fallback", data: null } : [],
        cleanData,
      );
    if (response.status === 401) return queueWriteLocally(action, cleanData, "auth");
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
  // Foundational -- other things reference these by id, so they need
  // to sync (and get their real server-assigned id) before anything
  // that depends on them is attempted.
  // NOTE: never use 0 as a priority here -- the sort below is
  // `DEPENDENCY_ORDER[action] || 99`, and 0 is falsy in JS, so a
  // priority of 0 gets silently treated as "missing" and falls back to
  // 99 instead of sorting first. Found via testing, not by inspection.
  saveClient: 0.1,
  updateClient: 0.1,
  saveEstimate: 0.5,
  updateEstimate: 0.5,
  saveProject: 1,
  updateProject: 1,
  saveVendor: 2,
  updateVendor: 2,
  saveWorkOrder: 3,
  updateWorkOrder: 3,
  // Parent groups before the items that reference them via groupId --
  // a Task/TakeOff created inside a brand-new offline group would
  // otherwise face the exact same stale-temp-id problem as the
  // client/estimate bug above.
  saveTaskGroup: 4,
  updateTaskGroup: 4,
  saveTakeOffGroup: 4,
  updateTakeOffGroup: 4,
  saveTask: 4.5,
  updateTask: 4.5,
  deleteTask: 4.5,
  // Was "saveTakeOffItem"/"updateTakeOffItem"/"deleteTakeOffItem" here
  // before -- those never matched any real action name (the actual
  // backend actions are saveTakeOff/updateTakeOff/deleteTakeOff, no
  // "Item" suffix), so this ordering silently never applied at all;
  // every take-off save was defaulting to the fallback priority 99.
  saveTakeOff: 4.5,
  updateTakeOff: 4.5,
  deleteTakeOff: 4.5,
  saveInspection: 5,
  updateInspection: 5,
  saveProgressLog: 6,
  saveSnag: 7,
  updateSnag: 7,
  deleteSnag: 7,
  // Photo before anything that references it (PhotoLink), same
  // group-before-child reasoning as TaskGroup/TakeOffGroup above.
  savePhoto: 7.5,
  updatePhotoComment: 7.5,
  updatePhotoMeta: 7.5,
  savePayment: 8,
  updatePayment: 8,
  savePhotoLink: 8.5,
  saveDocument: 8.5,
  updateDocumentMetadata: 8.5,
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

/**
 * Propagates a newly-assigned real server id to every OTHER item still
 * sitting in the offline queue that referenced the old temp id --
 * generically, via a stringify/replace/parse round-trip rather than
 * needing an exhaustive map of which field name means "client id" in
 * every possible action's payload. Persists each changed item back to
 * IndexedDB immediately (not just the in-memory copy), so the fix
 * survives even if the app closes partway through a sync.
 */
/**
 * Persistent map of temp id -> real id, per account (namespaced like
 * everything else). This is what closes a real gap the two functions
 * below don't cover on their own: they only fix OTHER items already
 * sitting in the SAME sync batch. If a parent (e.g. a client created
 * offline) happens to sync successfully in an earlier, separate
 * syncQueuedRequests() run -- entirely plausible, since auto-sync fires
 * independently on reconnect, on sign-in, and via manual "Sync Now" --
 * and a child item (e.g. an estimate referencing that client) only
 * gets queued or only gets its turn to sync LATER, nothing would ever
 * go back and fix it. Recording every reconciliation here, and
 * consulting it before every single send (not just within one batch),
 * means the fix applies no matter how far apart in time the parent and
 * child end up syncing.
 */
function recordIdMapping(oldIdVal, newIdVal) {
  const key = backupKey("__idMappings", {});
  const mappings = JSON.parse(localStorage.getItem(key) || "{}");
  mappings[oldIdVal] = newIdVal;
  localStorage.setItem(key, JSON.stringify(mappings));
}

/**
 * Applies every KNOWN mapping (not just ones from this batch) to a
 * single queued item's data before it's sent -- resolving a temp id
 * that became real in a completely separate, earlier sync run.
 */
function applyKnownIdMappings(item) {
  const key = backupKey("__idMappings", {});
  const mappings = JSON.parse(localStorage.getItem(key) || "{}");
  if (!Object.keys(mappings).length) return;
  let json = JSON.stringify(item.data);
  let changed = false;
  for (const [oldIdVal, newIdVal] of Object.entries(mappings)) {
    if (json.includes(oldIdVal)) {
      json = json.split(oldIdVal).join(newIdVal);
      changed = true;
    }
  }
  if (changed) item.data = JSON.parse(json);
}

async function reconcileQueuedIdReferences(queue, justCompletedItemId, oldIdVal, newIdVal) {
  recordIdMapping(oldIdVal, newIdVal);
  for (const item of queue) {
    if (item.id === justCompletedItemId) continue;
    const before = JSON.stringify(item.data);
    if (!before.includes(oldIdVal)) continue;
    const after = before.split(oldIdVal).join(newIdVal);
    item.data = JSON.parse(after);
    try {
      await updateQueuedRequest(item.id, { data: item.data });
    } catch (e) {
      console.error("Failed to persist id reconciliation for queued item", item.id, e);
    }
  }
}

/**
 * Same idea, applied to the local cached/backup copies of every store
 * (not the queue itself) -- so anything already rendered on screen
 * referencing the old temp id (e.g. an estimate's client reference)
 * shows the correct final id too, not just what eventually gets sent
 * to the server.
 */
function reconcileLocalCacheIdReferences(oldIdVal, newIdVal) {
  for (const getAction of Object.values(GET_ACTION_BY_STORE)) {
    const current = readBackup(getAction, null);
    if (!current) continue;
    const before = JSON.stringify(current);
    if (!before.includes(oldIdVal)) continue;
    const after = before.split(oldIdVal).join(newIdVal);
    writeBackup(getAction, JSON.parse(after));
  }
}

async function syncQueuedRequests() {
  await updateSyncStatus();
  let queue = await getQueuedRequestsForCurrentAccount();
  if (!queue.length) return;
  showSyncToast("🔄 Syncing offline data...", 10000);
  queue.sort(
    (a, b) =>
      (DEPENDENCY_ORDER[a.action] || 99) - (DEPENDENCY_ORDER[b.action] || 99),
  );
  const failedActions = [];
  for (let item of queue) {
    // Resolve any reference this item has to something that turned out
    // to be a temp id whose real id is already known -- from THIS
    // batch's reconciliations, or from any earlier, separate sync run.
    applyKnownIdMappings(item);
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
            // If this was a brand-new item created while offline/
            // unauthenticated (see applyLocalMutation's temp id), the
            // server has now assigned its real id. Any OTHER still-
            // queued item that referenced the old temp id (e.g. an
            // estimate's clientId pointing at a client that hadn't
            // synced yet) needs that reference updated to the real id
            // -- otherwise it goes on to fail every single retry with
            // the exact same "references a client/project/etc that
            // doesn't exist" error, since retrying with the same
            // stale temp id can never succeed no matter how many times
            // it's attempted.
            const cfg = typeof MUTATION_MAP !== "undefined" ? MUTATION_MAP[item.action] : null;
            if (cfg && cfg.mode === "upsert") {
              const oldIdVal = String(item.data[cfg.idKey] || "");
              const newIdVal = result[cfg.idKey];
              if (oldIdVal.startsWith("temp_") && newIdVal && oldIdVal !== String(newIdVal)) {
                await reconcileQueuedIdReferences(queue, item.id, oldIdVal, String(newIdVal));
                reconcileLocalCacheIdReferences(oldIdVal, String(newIdVal));
              }
            }
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
  const queue = await getQueuedRequestsForCurrentAccount();
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
  const queue = (await getQueuedRequestsForCurrentAccount()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

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
  const queue = await getQueuedRequestsForCurrentAccount();
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
  const queue = await getQueuedRequestsForCurrentAccount();
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
      if (typeof applyCompanyNameToSidebar === "function") applyCompanyNameToSidebar();
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
