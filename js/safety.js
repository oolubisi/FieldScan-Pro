// ===== Data & security: backup/restore, storage meter, app lock, change history =====

const BK_FORMAT = "fsp-backup";

// ---------- backup / restore ----------

/** Everything on the phone that is worth keeping, as one plain object. */
async function bkBuild() {
  const db = fsp.db;
  return {
    format: BK_FORMAT, version: 1, createdAt: new Date().toISOString(),
    deviceId: await fsp.sync.getDeviceId(),
    projects: await db.getAll("projects"),
    records: await db.getAll("records"),
    projectsMeta: await db.kvGet("projectsMeta", {}),
  };
}

/**
 * Puts a backup back WITHOUT overwriting newer work: a record is restored only if it is missing here
 * or the backup holds a strictly newer version of it. Restored records are re-sent to the desktop,
 * which ignores any it already has.
 */
async function bkRestore(obj) {
  if (!obj || obj.format !== BK_FORMAT || !Array.isArray(obj.records)) return { ok: false, error: "This is not a FieldScan Pro backup file." };
  const P = FSPProtocol, db = fsp.db;
  const counts = { restored: 0, kept: 0, same: 0, projects: 0 };
  for (const rec of obj.records) {
    if (!rec || !rec.id || !rec.vv || !rec.type) continue;
    const local = await db.get("records", rec.id);
    if (!local) { await db.put("records", { ...rec, deliveredVv: {}, exportedVv: {} }); counts.restored++; continue; }
    if (P.vvCovers(local.vv, rec.vv)) { counts[P.vvCovers(rec.vv, local.vv) ? "same" : "kept"]++; continue; }
    if (P.vvCovers(rec.vv, local.vv)) { await db.put("records", { ...rec, deliveredVv: {}, exportedVv: {} }); counts.restored++; }
    else counts.kept++; // changed on both sides: keep what is on the phone now
  }
  for (const p of obj.projects || []) {
    if (p && p.key && !(await db.get("projects", p.key))) { await db.put("projects", p); counts.projects++; }
  }
  return { ok: true, ...counts };
}

function bkDownload(obj) {
  const name = `fieldscanpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return FSPSync.browserDownload(name, JSON.stringify(obj), "application/json").then(() => name);
}

// ---------- storage meter ----------

const ST_SHRINK_SIDE = 800;

async function stMeasure() {
  const photos = await fsp.sync.getRecords("photo");
  let bytes = 0, shrinkable = 0, shrinkBytes = 0, shrunk = 0;
  for (const p of photos) {
    const b = Math.floor(((p.data.b64 || "").length * 3) / 4);
    bytes += b;
    if (p.data.shrunk) shrunk++;
    else if (fsp.sync.recordState(p) === "delivered" && Math.max(p.data.width || 0, p.data.height || 0) > ST_SHRINK_SIDE) { shrinkable++; shrinkBytes += b; }
  }
  let usage = null, quota = null;
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = e.usage; quota = e.quota; } } catch (e) { /* unknown */ }
  return { photos: photos.length, bytes, shrinkable, shrinkBytes, shrunk, usage, quota };
}

/** File-free resize of a stored photo. Replaceable in tests (window.stShrinkImpl). */
function stResize(photo) {
  if (window.stShrinkImpl) return window.stShrinkImpl(photo);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, ST_SHRINK_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve({ mime: "image/jpeg", b64: c.toDataURL("image/jpeg", 0.6).split(",")[1], width: w, height: h });
    };
    img.onerror = () => reject(new Error("Could not read a photo"));
    img.src = `data:${photo.data.mime};base64,${photo.data.b64}`;
  });
}

/**
 * Shrinks photos the desktop has confirmed it holds. This changes only the copy on the phone: the version
 * stays the same, so nothing is re-sent and the desktop keeps the full-size picture.
 */
async function stShrinkDelivered() {
  const photos = await fsp.sync.getRecords("photo");
  let n = 0, saved = 0;
  for (const p of photos) {
    if (p.data.shrunk || fsp.sync.recordState(p) !== "delivered" || Math.max(p.data.width || 0, p.data.height || 0) <= ST_SHRINK_SIDE) continue;
    const small = await stResize(p);
    if (small.b64.length >= p.data.b64.length) continue;
    saved += Math.floor(((p.data.b64.length - small.b64.length) * 3) / 4);
    await fsp.db.put("records", { ...p, data: { ...p.data, ...small, shrunk: true } });
    n++;
  }
  return { shrunk: n, saved };
}

const stMB = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB";

// ---------- app lock ----------

const LK_KEY = "fsp-lock";
const LK_AWAY_MS = 60 * 1000;
let lkUnlocked = false;
let lkHiddenAt = 0;

function lkConfig() { try { return JSON.parse(localStorage.getItem(LK_KEY) || "null"); } catch (e) { return null; } }
function lkSave(cfg) { try { if (cfg) localStorage.setItem(LK_KEY, JSON.stringify(cfg)); else localStorage.removeItem(LK_KEY); } catch (e) { /* not saved */ } }
function lkEnabled() { return !!(lkConfig() && lkConfig().hash); }

async function lkHash(pin, salt) {
  const text = salt + ":" + pin;
  const subtle = window.crypto && window.crypto.subtle;
  if (subtle && window.TextEncoder) {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; // very old browsers only
  return "x" + (h >>> 0).toString(16);
}

async function lkSetPin(pin) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join("");
  lkSave({ salt, hash: await lkHash(pin, salt), bio: (lkConfig() || {}).bio || null });
  lkUnlocked = true;
}
async function lkCheckPin(pin) { const c = lkConfig(); return !!c && (await lkHash(pin, c.salt)) === c.hash; }
function lkRemove() { lkSave(null); lkUnlocked = true; lkHide(); }

function lkBioSupported() { return !!window.lkBioImpl || !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
const lkB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const lkFromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Registers this phone's fingerprint / face / screen lock as a second way in. The PIN always keeps working. */
async function lkEnableBio() {
  if (window.lkBioImpl) return window.lkBioImpl.enable();
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: "FieldScan Pro" },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "fieldscan", displayName: "FieldScan Pro" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
    timeout: 60000,
  } });
  const c = lkConfig(); c.bio = lkB64(cred.rawId); lkSave(c);
}
async function lkBioUnlock() {
  if (window.lkBioImpl) return window.lkBioImpl.unlock();
  const c = lkConfig();
  await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: "public-key", id: lkFromB64(c.bio) }],
    userVerification: "required", timeout: 60000,
  } });
  return true;
}

function lkHide() { const el = document.getElementById("lockScreen"); if (el) el.remove(); }

function lkShow() {
  if (document.getElementById("lockScreen")) return;
  lkUnlocked = false;
  const c = lkConfig() || {};
  const el = document.createElement("div");
  el.id = "lockScreen";
  el.innerHTML = `<div class="lk-box"><div class="lk-logo">🔒</div><h2>FieldScan Pro is locked</h2>
    <input id="lkPin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN" aria-label="PIN">
    <div id="lkMsg" class="lk-msg"></div>
    <button class="btn block" id="lkGo">Unlock</button>
    ${c.bio && lkBioSupported() ? `<button class="btn secondary block" id="lkBio" style="margin-top:8px;">Use fingerprint / face</button>` : ""}</div>`;
  document.body.appendChild(el);
  const done = () => { lkUnlocked = true; lkHide(); };
  const tryPin = async () => {
    const pin = el.querySelector("#lkPin").value;
    if (pin && (await lkCheckPin(pin))) return done();
    el.querySelector("#lkMsg").textContent = "Wrong PIN";
    el.querySelector("#lkPin").value = "";
  };
  el.querySelector("#lkGo").onclick = tryPin;
  el.querySelector("#lkPin").onkeydown = (e) => { if (e.key === "Enter") tryPin(); };
  const bio = el.querySelector("#lkBio");
  if (bio) bio.onclick = async () => { try { if (await lkBioUnlock()) done(); } catch (e) { el.querySelector("#lkMsg").textContent = "Fingerprint did not work; use the PIN"; } };
  setTimeout(() => { const i = el.querySelector("#lkPin"); if (i) i.focus(); }, 50);
}

/** Called once at start-up: lock if a PIN is set, and re-lock when the app comes back after a minute away. */
function setupLock() {
  if (lkEnabled()) lkShow(); else lkUnlocked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") lkHiddenAt = Date.now();
    else if (lkEnabled() && lkUnlocked && lkHiddenAt && Date.now() - lkHiddenAt > LK_AWAY_MS) lkShow();
  });
}

// ---------- the screen ----------

const SF_SOURCE = { desktop: "Changed from the desktop", edit: "Edited on this phone", delete: "Deleted on this phone" };
const SF_ICON = { task: "✅", inspection: "🔍", takeoff: "📐", "takeoff-group": "📁", diary: "📒" };

async function renderSafetyScreen() {
  const main = document.getElementById("main");
  const st = await stMeasure();
  const hist = await fsp.sync.getHistory();
  const lock = lkEnabled();
  const bio = lkConfig() && lkConfig().bio;
  const pct = st.usage && st.quota ? Math.max(1, Math.round((st.usage / st.quota) * 100)) : null;

  main.innerHTML = `
    <h2>Data &amp; security</h2>
    <div class="card"><h3>Storage</h3>
      <p class="muted">${st.photos} photo${st.photos === 1 ? "" : "s"} use ${stMB(st.bytes)}${st.usage != null ? ` · the app uses ${stMB(st.usage)} of the ${stMB(st.quota)} the browser allows (${pct}%)` : ""}.</p>
      ${pct != null ? `<div class="meter"><div style="width:${Math.min(100, pct)}%"></div></div>` : ""}
      <p class="muted">${st.shrinkable ? `${st.shrinkable} photo${st.shrinkable === 1 ? " is" : "s are"} already safe on the desktop and could be made smaller here (about ${stMB(Math.floor(st.shrinkBytes * 0.7))} saved). The desktop keeps the full-size pictures.` : "No photos can be shrunk yet. Photos become eligible once the desktop has confirmed it has them."}${st.shrunk ? ` ${st.shrunk} already shrunk.` : ""}</p>
      <button class="btn secondary block" id="stShrink" ${st.shrinkable ? "" : "disabled"}>Shrink photos the desktop already has</button>
      <div id="stResult"></div></div>

    <div class="card"><h3>Backup</h3>
      <p class="muted">Saves every task, inspection, take-off, diary entry and photo on this phone into one file. Keep a copy somewhere safe (Drive, email to yourself). Restoring never overwrites newer work.</p>
      <button class="btn block" id="bkMake">Back up now</button>
      <label class="btn secondary block" style="margin-top:8px;text-align:center;">Restore from a backup file<input type="file" id="bkFile" accept=".json,application/json" hidden></label>
      <div id="bkResult"></div></div>

    <div class="card"><h3>App lock</h3>
      <p class="muted">${lock ? "A PIN is needed to open the app, and again after it has been away for a minute." : "Ask for a PIN before showing your work. This keeps casual snoopers out; it does not encrypt the data."}</p>
      ${lock ? `<button class="btn secondary block" id="lkChange">Change PIN</button>
        ${lkBioSupported() ? `<button class="btn secondary block" id="lkBioBtn" style="margin-top:8px;">${bio ? "Fingerprint / face is on ✓" : "Also unlock with fingerprint / face"}</button>` : ""}
        <button class="btn secondary block" id="lkOff" style="margin-top:8px;">Turn lock off</button>`
        : `<button class="btn block" id="lkOn">Set a PIN</button>`}
      <div id="lkResult"></div></div>

    <div class="card"><h3>Change history</h3>
      <p class="muted">Edits that arrived from the desktop, and edits or deletions you made here. Undo puts the record back as it was (and sends that to the desktop). Photos of a deleted record are not restored.</p>
      ${hist.length ? hist.slice(0, 40).map((h) => `<div class="row" data-n="${escapeHtml(h.n)}"><div class="grow"><b>${SF_ICON[h.type] || "📄"} ${escapeHtml(h.title)}</b><div class="sub">${escapeHtml(SF_SOURCE[h.source] || h.source)} · ${escapeHtml(formatWhen(h.at))}</div></div><button class="btn secondary sf-undo">Undo</button></div>`).join("") : `<p class="muted">Nothing yet.</p>`}
      <div id="hsResult"></div></div>`;

  const q = (s) => main.querySelector(s);
  q("#stShrink").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const r = await stShrinkDelivered();
    await renderSafetyScreen();
    document.getElementById("stResult").innerHTML = resultBox([`Shrunk ${r.shrunk} photo${r.shrunk === 1 ? "" : "s"}, freed ${stMB(r.saved)}.`]);
  });
  q("#bkMake").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const obj = await bkBuild();
    const name = await bkDownload(obj);
    q("#bkResult").innerHTML = resultBox([`Saved ${obj.records.filter((r) => !r.deleted).length} records as ${name}. Look in your Downloads.`]);
  });
  q("#bkFile").onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    let obj; try { obj = JSON.parse(await f.text()); } catch (e) { obj = null; }
    const r = await bkRestore(obj);
    await renderSafetyScreen();
    document.getElementById("bkResult").innerHTML = r.ok
      ? resultBox([`Restored ${r.restored} record${r.restored === 1 ? "" : "s"}; kept ${r.kept} that were newer here; ${r.same} already identical.`])
      : resultBox([r.error], true);
  };
  const askPin = (title, then) => openModal(title, `<input id="lkNew" type="password" inputmode="numeric" maxlength="12" placeholder="4 to 12 digits"><input id="lkNew2" type="password" inputmode="numeric" maxlength="12" placeholder="Repeat PIN" style="margin-top:8px;">`, async () => {
    const a = document.getElementById("lkNew").value, b = document.getElementById("lkNew2").value;
    if (!/^\d{4,12}$/.test(a)) return showStatus("PIN must be 4 to 12 digits", true);
    if (a !== b) return showStatus("The two PINs do not match", true);
    await lkSetPin(a); closeModal(); await then();
  }, "Save PIN");
  if (q("#lkOn")) q("#lkOn").onclick = () => askPin("Set a PIN", async () => { await renderSafetyScreen(); showStatus("Lock is on"); });
  if (q("#lkChange")) q("#lkChange").onclick = () => askPin("New PIN", async () => { await renderSafetyScreen(); showStatus("PIN changed"); });
  if (q("#lkOff")) q("#lkOff").onclick = () => openModal("Turn lock off?", `<p>Enter your PIN to confirm.</p><input id="lkConfirm" type="password" inputmode="numeric" maxlength="12">`, async () => {
    if (await lkCheckPin(document.getElementById("lkConfirm").value)) { lkRemove(); closeModal(); await renderSafetyScreen(); } else showStatus("Wrong PIN", true);
  }, "Turn off");
  if (q("#lkBioBtn")) q("#lkBioBtn").onclick = async () => {
    try { await lkEnableBio(); await renderSafetyScreen(); showStatus("Fingerprint / face added"); }
    catch (e) { document.getElementById("lkResult").innerHTML = resultBox(["Could not set that up on this phone. The PIN still works."], true); }
  };
  main.querySelectorAll(".sf-undo").forEach((b) => { b.onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const r = await fsp.sync.undoHistory(b.closest(".row").dataset.n);
    await renderSafetyScreen();
    document.getElementById("hsResult").innerHTML = r.ok ? resultBox([`Put “${r.title}” back.`]) : resultBox([r.error], true);
  }); });
}
