// ===== photos.js =====
// Cloud-synced project photos. Replaces the old LAN-based photo-transfer.js.
// Both mobile and desktop run this same code (Electron's renderer is just
// Chromium, so IndexedDB works identically on both) — the only difference
// between platforms is which controls are shown: mobile can capture and
// edit comments, desktop can view and delete. Metadata (comment, capture
// time, etc.) lives in the Photos sheet via Apps Script; images live in
// Drive; both sides keep a local IndexedDB cache of already-seen photos so
// re-opening the page doesn't re-download anything unchanged.

const PH_DB_NAME = "fieldscan_photos_v1";
const PH_META_STORE = "meta";
const PH_BLOB_STORE = "blobs";
const PH_MAX_BYTES = 600 * 1024;

// Tag taxonomy: a photo's tags are [stage, ...selected sub-stages]. Only one
// stage is active at a time (radio), each stage has its own set of allowed
// sub-stages (checkboxes, multi-select). This replaced the earlier
// category/stage/area/trade/activity fields and the manual multi-type
// link picker — tags are now the single source of truth for what a photo
// "is", and category/area/trade/activity/linked-records are gone.
const PH_STAGES = ["Before", "During", "After"];
const PH_SUBSTAGES = {
  Before: ["Miscellaneous"],
  During: ["Progress", "Snags", "Miscellaneous"],
  After: ["Snags", "Miscellaneous"],
};

let phDbPromise = null;
let phProjectId = null;
let phList = [];
let phIndex = 0;
let phTagFilter = "All";
let phShowDeleted = false; // desktop recycle-bin toggle
let phDeletedList = [];
const phBlobUrlCache = {}; // photoId -> object URL, so we don't recreate/leak repeatedly
const phFetchFailures = {}; // photoId -> error message, so a failed fetch is distinguishable from "still loading"

function phOpenDb() {
  if (phDbPromise) return phDbPromise;
  phDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PH_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PH_META_STORE))
        db.createObjectStore(PH_META_STORE, { keyPath: "photoId" });
      if (!db.objectStoreNames.contains(PH_BLOB_STORE))
        db.createObjectStore(PH_BLOB_STORE, { keyPath: "photoId" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return phDbPromise;
}

async function phGetAllMeta() {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PH_META_STORE, "readonly").objectStore(PH_META_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function phPutMeta(rec) {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PH_META_STORE, "readwrite");
    tx.objectStore(PH_META_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function phDeleteMetaRow(photoId) {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PH_META_STORE, "readwrite");
    tx.objectStore(PH_META_STORE).delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function phGetBlob(photoId) {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(PH_BLOB_STORE, "readonly").objectStore(PH_BLOB_STORE).get(photoId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function phPutBlob(photoId, blob) {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PH_BLOB_STORE, "readwrite");
    tx.objectStore(PH_BLOB_STORE).put({ photoId, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function phDeleteBlobRow(photoId) {
  const db = await phOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PH_BLOB_STORE, "readwrite");
    tx.objectStore(PH_BLOB_STORE).delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== image helpers =====

function phCompressImage(file, maxBytes, initialMaxDim = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let width = img.width;
        let height = img.height;
        const maxDim = initialMaxDim;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        let quality = 0.85;
        let attempts = 0;
        const attempt = () => {
          attempts++;
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("Compression failed"));
              if (blob.size <= maxBytes || attempts >= 10) return resolve(blob);
              if (quality > 0.35) quality -= 0.15;
              else {
                width = Math.round(width * 0.8);
                height = Math.round(height * 0.8);
                quality = 0.7;
              }
              attempt();
            },
            "image/jpeg",
            quality,
          );
        };
        attempt();
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function phBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Blob read failed"));
    reader.readAsDataURL(blob);
  });
}

// The new backend proxies a Supabase Storage read through its
// "getPhotoDataUrl" action (POST, same authenticated envelope as
// everything else -- the bucket is private, so the frontend can't read
// it directly). Returns a Blob for local caching, same as before.
async function phFetchRemoteImage(storagePath) {
  const resp = await callApi("getPhotoDataUrl", { storagePath });
  if (!resp || !resp.success || !resp.dataUrl) {
    throw new Error((resp && resp.error) || "Image not found");
  }
  const blob = await (await fetch(resp.dataUrl)).blob();
  return blob;
}

function phGenerateId() {
  return `PHOTO-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function phSortList(list) {
  return [...list].sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
}

function safeParseTags_(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && !raw.trim().startsWith("[")) {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function phFilteredList() {
  if (phTagFilter === "All") return phList;
  return phList.filter((p) => safeParseTags_(p.tags).includes(phTagFilter));
}

function phIsSnagPhoto(photo) {
  if (!photo) return false;
  const tags = safeParseTags_(photo.tags).map((t) => String(t).trim().toLowerCase());
  return tags.includes("snags");
}
window.phIsSnagPhoto = phIsSnagPhoto;

// ===== stage/substage tag picker (shared by capture + metadata editor) =====

/**
 * Renders the stage radios + all three sub-stage checkbox groups. All
 * three groups render at once so the person can see what's available
 * under each stage, but only the active stage's group is interactive —
 * the other two are visually disabled and their checkboxes stay unchecked.
 * `prefix` namespaces element ids so the capture form (mobile) and the
 * metadata editor (desktop) can both have one on the page without id
 * collisions (though in practice only one is ever shown at a time).
 */
function phRenderStagePicker(prefix, tags) {
  tags = tags || [];
  const activeStage = PH_STAGES.includes(tags[0]) ? tags[0] : "";
  const checkedSubstages = new Set(tags.slice(1));

  const radios = PH_STAGES.map(
    (s) => `
      <label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:13px; cursor:pointer;">
        <input type="radio" name="${prefix}-stage" value="${escapeAttr(s)}" style="width:auto;" ${activeStage === s ? "checked" : ""} onchange="window.phOnStageChange('${prefix}')">
        ${escapeHtml(s)}
      </label>`,
  ).join("");

  const groups = PH_STAGES.map((stage) => {
    const isActive = stage === activeStage;
    const options = PH_SUBSTAGES[stage]
      .map((sub) => {
        const checked = isActive && checkedSubstages.has(sub);
        return `
        <label class="ph-substage-option" style="display:flex; align-items:center; gap:5px; font-size:12.5px; ${isActive ? "" : "opacity:0.4;"}">
          <input type="checkbox" value="${escapeAttr(sub)}" style="width:auto;" ${checked ? "checked" : ""} ${isActive ? "" : "disabled"}>
          ${escapeHtml(sub)}
        </label>`;
      })
      .join("");
    return `
      <div class="ph-substage-group" data-stage="${escapeAttr(stage)}" data-prefix="${prefix}" style="margin-top:6px;">
        <div style="font-size:11px; font-weight:800; text-transform:uppercase; color:${isActive ? "var(--primary, #0056b3)" : "var(--muted)"};">${escapeHtml(stage)}</div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:4px;">${options}</div>
      </div>`;
  }).join("");

  return `
    <div class="ph-stage-picker" id="${prefix}-stage-picker">
      <label style="display:block; font-weight:800; margin-bottom:4px;">Stage</label>
      <div style="display:flex; gap:14px; flex-wrap:wrap;">${radios}</div>
      <label style="display:block; font-weight:800; margin-top:10px; margin-bottom:2px;">Sub-stage</label>
      ${groups}
    </div>
  `;
}

/** Re-renders just the substage groups' enabled/disabled state when the stage radio changes. */
function phOnStageChange(prefix) {
  const picker = document.getElementById(`${prefix}-stage-picker`);
  if (!picker) return;
  const checkedRadio = picker.querySelector(`input[name="${prefix}-stage"]:checked`);
  const activeStage = checkedRadio ? checkedRadio.value : "";
  picker.querySelectorAll(".ph-substage-group").forEach((group) => {
    const isActive = group.dataset.stage === activeStage;
    const label = group.querySelector("div");
    if (label) label.style.color = isActive ? "var(--primary, #0056b3)" : "var(--muted)";
    group.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.disabled = !isActive;
      if (!isActive) cb.checked = false;
      cb.closest("label").style.opacity = isActive ? "1" : "0.4";
    });
  });
}
window.phOnStageChange = phOnStageChange;

/** Reads the current picker state back out as a tags array: [stage, ...substages]. */
function phCollectStageTags(prefix) {
  const picker = document.getElementById(`${prefix}-stage-picker`);
  if (!picker) return [];
  const checkedRadio = picker.querySelector(`input[name="${prefix}-stage"]:checked`);
  if (!checkedRadio) return [];
  const substages = Array.from(
    picker.querySelectorAll(`.ph-substage-group[data-stage="${checkedRadio.value}"] input[type=checkbox]:checked`),
  ).map((cb) => cb.value);
  return [checkedRadio.value, ...substages];
}

/**
 * Auto-creates a Snag record (and links this photo to it) the moment
 * "Snags" newly appears in a photo's tags — this is what makes "tag a
 * photo as a snag" actually produce a snag card, rather than just a label.
 * Only fires on the Snags->added transition (not every re-save while it
 * stays checked), so it never creates duplicates.
 */
async function phMaybeCreateSnagForTags(photoRecord, oldTags, newTags) {
  const hadSnag = (oldTags || []).includes("Snags");
  const hasSnag = (newTags || []).includes("Snags");
  if (hasSnag && !hadSnag) {
    try {
      const resp = await callApi("saveSnag", {
        projectId: photoRecord.projectId,
        notes: photoRecord.comment || "Snag identified from a tagged photo.",
        assigned: "",
        status: "Open",
      });
      if (resp && resp.success && resp.snagId) {
        await callApi("savePhotoLink", {
          photoId: photoRecord.photoId,
          recordType: "Snag",
          recordId: resp.snagId,
          projectId: photoRecord.projectId,
        });
        if (typeof getCache === "function" && typeof setCache === "function") {
          const cache = getCache();
          cache.snags = (cache.snags || []).concat([
            {
              snagId: resp.snagId,
              projectId: photoRecord.projectId,
              notes: photoRecord.comment || "Snag identified from a tagged photo.",
              assigned: "",
              status: "Open",
              dateLogged: new Date().toISOString().slice(0, 10),
            },
          ]);
          setCache(cache);
        }
        if (typeof showSyncToast === "function") showSyncToast("🔧 Snag card created from this photo");
      }
    } catch (e) {
      console.error("Auto snag creation failed", e);
    }
  }
}

// ===== page init =====

function initPhotosPage(projectId) {
  phProjectId = projectId || (typeof getCurrentProjectId === "function" ? getCurrentProjectId() : null);
  phIndex = 0;
  const container = document.getElementById("ph-view");
  if (!container) return;
  container.innerHTML = `<div class="card"><span style="font-size:13px; color:var(--muted);">Loading photos...</span></div>`;
  phLoadAndRender().catch((e) => {
    console.error("phLoadAndRender failed unexpectedly", e);
    const c = document.getElementById("ph-view");
    if (c) {
      c.innerHTML = `<div class="card" style="text-align:center;">
        <span style="font-size:13px; color:var(--danger);">Something went wrong loading photos.</span><br>
        <button class="action-btn" style="width:auto; margin-top:10px; padding:8px 16px; font-size:12px;" onclick="window.initPhotosPage()"><i class="fas fa-rotate-right"></i> Retry</button>
      </div>`;
    }
  });
}
window.initPhotosPage = initPhotosPage;

async function phLoadAndRender() {
  if (!phProjectId) {
    const container = document.getElementById("ph-view");
    if (container)
      container.innerHTML = `<div class="card"><span style="font-size:13px; color:var(--muted);">No project selected — open Photos from within a project.</span></div>`;
    return;
  }
  try {
    const localMeta = (await phGetAllMeta()).filter((m) => m.projectId === phProjectId);
    phList = phSortList(localMeta);
    phRenderSlider();
  } catch (e) {
    console.error("Photos load failed (local read)", e);
    const container = document.getElementById("ph-view");
    if (container) {
      container.innerHTML = `<div class="card" style="text-align:center;">
        <span style="font-size:13px; color:var(--danger);">Could not load photos — ${escapeHtml(e && e.message ? e.message : "local storage error")}.</span><br>
        <button class="action-btn" style="width:auto; margin-top:10px; padding:8px 16px; font-size:12px;" onclick="window.initPhotosPage()"><i class="fas fa-rotate-right"></i> Retry</button>
      </div>`;
    }
    return; // don't attempt the network merge against a broken local read
  }

  if (navigator.onLine) {
    try {
      const serverPhotos = await callApi("getPhotos");
      if (Array.isArray(serverPhotos)) await phMergeServerPhotos(serverPhotos);
    } catch (e) {
      console.error("Photos refresh failed", e);
    }
  }
}

async function phMergeServerPhotos(serverPhotos) {
  const forProject = serverPhotos.filter((p) => String(p.projectId).trim() === String(phProjectId).trim());
  const serverIds = new Set(forProject.map((p) => p.photoId));
  const localMetaAll = await phGetAllMeta();
  const localMetaMap = {};
  localMetaAll.forEach((m) => (localMetaMap[m.photoId] = m));

  // Upsert server photos into local cache, fetching image bytes only for
  // ones we don't already have cached (or that changed).
  for (const p of forProject) {
    const existing = localMetaMap[p.photoId];
    const changed = !existing || Number(existing.lastModified || 0) !== Number(p.lastModified || 0);
    const merged = {
      photoId: p.photoId,
      projectId: p.projectId,
      storagePath: p.storagePath,
      comment: p.comment || "",
      postProject: String(p.postProject) === "true",
      capturedAt: Number(p.capturedAt) || 0,
      fileSizeBytes: Number(p.fileSizeBytes) || 0,
      lastModified: Number(p.lastModified) || 0,
      tags: safeParseTags_(p.tags),
      localOnly: false,
      synced: true,
    };
    if (changed) await phPutMeta(merged);

    const hasBlob = await phGetBlob(p.photoId);
    if (!hasBlob) {
      try {
        const blob = await phFetchRemoteImage(p.storagePath);
        await phPutBlob(p.photoId, blob);
        delete phFetchFailures[p.photoId];
      } catch (e) {
        console.error("Failed to fetch image for", p.photoId, e);
        phFetchFailures[p.photoId] = e.message || "Failed to load image";
      }
      // Re-render as soon as the currently-displayed photo's fetch settles,
      // rather than waiting for every photo in the project to finish —
      // otherwise a slow/failed fetch anywhere in the list leaves the
      // visible photo stuck on "Loading image..." with no feedback.
      if (phFilteredList()[phIndex] && phFilteredList()[phIndex].photoId === p.photoId) phRenderSlider();
    }
  }

  // Drop local copies of previously-synced photos that no longer exist on
  // the server (deleted from desktop). Never touch localOnly (pending
  // upload) entries — those aren't server-known yet.
  for (const m of localMetaAll) {
    if (m.projectId !== phProjectId) continue;
    if (m.localOnly) continue;
    if (!serverIds.has(m.photoId)) {
      await phDeleteMetaRow(m.photoId);
      await phDeleteBlobRow(m.photoId);
      if (phBlobUrlCache[m.photoId]) {
        URL.revokeObjectURL(phBlobUrlCache[m.photoId]);
        delete phBlobUrlCache[m.photoId];
      }
    }
  }

  const refreshed = (await phGetAllMeta()).filter((m) => m.projectId === phProjectId);
  const currentId = phFilteredList()[phIndex] ? phFilteredList()[phIndex].photoId : null;
  phList = phSortList(refreshed);
  if (currentId) {
    const newIdx = phFilteredList().findIndex((p) => p.photoId === currentId);
    if (newIdx !== -1) phIndex = newIdx;
  }
  phRenderSlider();
}

// ===== rendering =====

async function phGetBlobUrl(photoId) {
  if (phBlobUrlCache[photoId]) return phBlobUrlCache[photoId];
  const rec = await phGetBlob(photoId);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  phBlobUrlCache[photoId] = url;
  return url;
}

async function phRenderSlider() {
  const container = document.getElementById("ph-view");
  if (!container) return;

  if (phShowDeleted) return phRenderDeletedList();

  const displayList = phFilteredList();
  const filterBarHtml = phFilterBarHtml();

  if (!displayList.length) {
    container.innerHTML = `
      <div class="card">
        ${filterBarHtml}
        ${!isElectronApp ? phCaptureControlsHtml() : ""}
        <p style="color:var(--muted); font-size:13px; margin-top:12px;">No photos${phTagFilter !== "All" ? ` tagged "${escapeHtml(phTagFilter)}"` : " yet"}${isElectronApp ? "" : " — tap Take Photo to add one"}.</p>
      </div>`;
    return;
  }

  if (phIndex < 0) phIndex = displayList.length - 1;
  if (phIndex >= displayList.length) phIndex = 0;
  const item = displayList[phIndex];
  const blobUrl = await phGetBlobUrl(item.photoId);
  const fetchError = phFetchFailures[item.photoId];

  const imageAreaHtml = blobUrl
    ? `<img src="${blobUrl}" style="max-width:100%; max-height:60vh; object-fit:contain;" alt="photo">`
    : fetchError
      ? `<div style="text-align:center; padding:20px;">
           <div style="color:var(--danger); font-size:13px; margin-bottom:10px;">⚠️ Couldn't load this image${navigator.onLine ? "" : " — you're offline"}.</div>
           <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px;" onclick="window.phRetryImage('${escapeAttr(item.photoId)}')"><i class="fas fa-rotate"></i> Retry</button>
         </div>`
      : `<span style="color:var(--muted); font-size:13px;">Loading image...</span>`;

  const statusBadge = item.uploadError
    ? `<span style="color:var(--danger); font-size:12px; font-weight:700;">⚠️ ${escapeHtml(item.uploadError)}</span>`
    : item.localOnly
      ? `<span style="color:var(--muted); font-size:12px; font-weight:700;">⏳ Not synced yet</span>`
      : `<span style="color:var(--success); font-size:12px; font-weight:700;">✅ Synced</span>`;

  container.innerHTML = `
    ${filterBarHtml}
    ${!isElectronApp ? `<div class="card">${phCaptureControlsHtml()}</div>` : ""}
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:800; font-size:13px; color:var(--muted);">${phIndex + 1} / ${displayList.length}</span>
        <div style="display:flex; align-items:center; gap:10px;">
          ${statusBadge}
          ${isElectronApp ? `<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--danger); color:#fff;" onclick="window.phDeleteCurrent()"><i class="fas fa-trash"></i> Delete</button>` : ""}
        </div>
      </div>
      <div style="position:relative; background:var(--card-light); border-radius:12px; overflow:hidden; min-height:280px; display:flex; align-items:center; justify-content:center;">
        ${imageAreaHtml}
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:10px;">
        <button class="action-btn" style="width:auto; padding:8px 20px;" onclick="window.phSlidePrev()"><i class="fas fa-chevron-left"></i></button>
        <button class="action-btn" style="width:auto; padding:8px 20px;" onclick="window.phSlideNext()"><i class="fas fa-chevron-right"></i></button>
      </div>
      <label style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;">Comment</label>
      <textarea id="ph-comment-input" rows="3" style="width:100%; padding:10px; font-size:14px;" placeholder="Add a comment for this photo..." oninput="window.phScheduleCommentSave('${escapeAttr(item.photoId)}')">${escapeHtml(item.comment || "")}</textarea>
      ${item.postProject ? `<div style="font-size:12px; color:var(--muted); margin-top:6px;"><i class="fas fa-check-circle"></i> Marked as post-project</div>` : ""}
      ${isElectronApp ? phMetaEditorHtml(item) : phMetaReadOnlyHtml(item)}
    </div>
  `;
}

function phFilterBarHtml() {
  const allTagValues = ["All", ...PH_STAGES, ...new Set(Object.values(PH_SUBSTAGES).flat())];
  const options = allTagValues
    .map((c) => `<option value="${escapeAttr(c)}" ${phTagFilter === c ? "selected" : ""}>${escapeHtml(c)}</option>`)
    .join("");
  return `
    <div class="card" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <label style="font-weight:800; font-size:13px; margin:0;">Tag:</label>
      <select style="flex:1; min-width:140px; padding:6px 8px; font-size:13px;" onchange="window.phSetTagFilter(this.value)">
        ${options}
      </select>
      ${isElectronApp ? `<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="window.phToggleDeletedView()"><i class="fas fa-trash-can-arrow-up"></i> Recycle Bin</button>` : ""}
    </div>
  `;
}

/** Desktop: editable metadata block, saved via updatePhotoMeta. Category, stage, area/zone,
 *  trade/sector, activity, and manual record-linking are gone — tags (via the stage/substage
 *  picker) are now the only metadata besides the comment. */
function phMetaEditorHtml(item) {
  return `
    <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #e5e5e5);">
      ${phRenderStagePicker("meta", item.tags || [])}
      <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; margin-top:12px;" onclick="window.phSaveMeta('${escapeAttr(item.photoId)}')"><i class="fas fa-save"></i> Save tags</button>
    </div>
  `;
}

/** Mobile: read-only summary of the tags set at capture time. */
function phMetaReadOnlyHtml(item) {
  const tags = item.tags || [];
  if (!tags.length) return "";
  return `
    <div style="margin-top:10px; font-size:12px; color:var(--muted);">
      <div>🏷️ ${escapeHtml(tags.join(", "))}</div>
    </div>
  `;
}

function phCaptureControlsHtml() {
  return `
    <label class="icon-upload-label" style="width:40%; min-width:132px; height:auto; border-radius:10px; padding:10px 12px; flex-direction:row; gap:8px; margin-top:0; flex-wrap:nowrap; white-space:nowrap;">
      <i class="fas fa-camera" style="font-size:18px; flex:0 0 auto;"></i>
      <span style="font-weight:800; font-size:78%; white-space:nowrap;">Take Photo</span>
      <input type="file" accept="image/*" capture="environment" id="ph-camera-input" style="display:none;" onchange="window.phHandleCapture(this.files)">
    </label>
    <div style="margin-top:10px;">
      ${phRenderStagePicker("cap", [])}
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-weight:800; margin-top:10px;">
      <input type="checkbox" id="ph-photo-post-project" style="width:auto;">
      <span>Post project</span>
    </label>
    <div id="ph-capture-status-msg" style="font-size:12px; color:var(--muted); margin-top:8px;"></div>
  `;
}

// ===== navigation =====

async function phAutoSaveCurrentTags() {
  const current = phFilteredList()[phIndex];
  if (!current) return;

  // Flush a pending debounced comment save too — same risk as tags: a
  // quick edit followed immediately by Next/Prev could otherwise beat the
  // 600ms debounce and get lost.
  if (phCommentSaveTimer) {
    clearTimeout(phCommentSaveTimer);
    phCommentSaveTimer = null;
    await phSaveComment(current.photoId);
  }

  if (!isElectronApp) return; // only desktop has the editable tag picker
  if (!document.getElementById("meta-stage-picker")) return; // nothing rendered to save (e.g. recycle bin view)
  await phSaveMeta(current.photoId, /* silent */ true);
}

async function phSlidePrev() {
  await phAutoSaveCurrentTags();
  phIndex--;
  phRenderSlider();
}
window.phSlidePrev = phSlidePrev;

async function phSlideNext() {
  await phAutoSaveCurrentTags();
  phIndex++;
  phRenderSlider();
}
window.phSlideNext = phSlideNext;

function phSetTagFilter(value) {
  phTagFilter = value || "All";
  phIndex = 0;
  phRenderSlider();
}
window.phSetTagFilter = phSetTagFilter;

async function phRetryImage(photoId) {
  const item = phList.find((p) => p.photoId === photoId);
  if (!item || !item.storagePath) return;
  delete phFetchFailures[photoId];
  phRenderSlider(); // shows "Loading image..." while retry is in flight
  try {
    const blob = await phFetchRemoteImage(item.storagePath);
    await phPutBlob(photoId, blob);
  } catch (e) {
    console.error("Retry failed for", photoId, e);
    phFetchFailures[photoId] = e.message || "Failed to load image";
  }
  if (phFilteredList()[phIndex] && phFilteredList()[phIndex].photoId === photoId) phRenderSlider();
}
window.phRetryImage = phRetryImage;

// ===== quick capture (mobile, from the dashboard) =====
// Snap a photo immediately without navigating into a project first; the
// project + tags get picked in a follow-up step, using the same
// compress/save pipeline as the normal in-project capture flow (phPutMeta/
// phPutBlob/phUploadPhoto/phMaybeCreateSnagForTags) — just not tied to the
// phProjectId/ph-view globals, since this can be triggered from anywhere.

let quickCaptureBlob = null;

async function handleQuickCaptureFile(fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  const input = document.getElementById("quick-capture-input");
  if (input) input.value = "";

  if (typeof showSyncToast === "function") showSyncToast("Processing photo...");
  try {
    quickCaptureBlob = await phCompressImage(file, PH_MAX_BYTES);
  } catch (e) {
    console.error("Quick capture compress failed", e);
    alert("Could not process that photo.");
    return;
  }
  openQuickCaptureAssignModal();
}
window.handleQuickCaptureFile = handleQuickCaptureFile;

function openQuickCaptureAssignModal() {
  const cache = getCache();
  const projects = cache.projects || [];
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  if (modalContent) modalContent.classList.remove("modal-fullscreen");
  const labelStyle = 'style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;"';
  const largeInput = "width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;";

  title.innerText = "Assign Photo";
  overlay.style.display = "flex";

  const projectOptions = projects
    .map(function (p) {
      return '<option value="' + escapeAttr(p.projectId) + '">' + escapeHtml(p.clientName || p.projectId) + '</option>';
    })
    .join("");

  const previewUrl = quickCaptureBlob ? URL.createObjectURL(quickCaptureBlob) : "";

  body.innerHTML =
    (previewUrl
      ? '<div style="width:100%; max-height:220px; overflow:hidden; border-radius:10px; margin-bottom:12px;"><img src="' + previewUrl + '" style="width:100%; height:100%; object-fit:cover; display:block;"></div>'
      : "") +
    '<label ' + labelStyle + '>Project</label>' +
    '<select id="qc_project" ' + largeInput + '><option value="">-- Select Project --</option>' + projectOptions + '</select>' +
    phRenderStagePicker("qc", []) +
    '<label ' + labelStyle + '>Comment (optional)</label>' +
    '<textarea id="qc_comment" rows="2" ' + largeInput + '></textarea>';

  submit.style.display = "block";
  submit.innerText = "Save Photo";
  submit.onclick = saveQuickCapturePhoto;
}

async function saveQuickCapturePhoto() {
  const projectSel = document.getElementById("qc_project");
  const projectId = projectSel ? projectSel.value : "";
  if (!projectId) {
    alert("Select a project");
    return;
  }
  if (!quickCaptureBlob) {
    alert("No photo to save — please try capturing again.");
    return;
  }
  const submit = document.getElementById("modalSubmit");
  submit.disabled = true;
  submit.innerText = "Saving...";

  const tags = phCollectStageTags("qc");
  const commentEl = document.getElementById("qc_comment");
  const photoId = phGenerateId();
  const meta = {
    photoId,
    projectId,
    storagePath: null,
    comment: (commentEl && commentEl.value) || "",
    postProject: false,
    capturedAt: Date.now(),
    fileSizeBytes: quickCaptureBlob.size,
    lastModified: Date.now(),
    tags,
    localOnly: true,
    synced: false,
  };

  try {
    await phPutMeta(meta);
    await phPutBlob(photoId, quickCaptureBlob);
    quickCaptureBlob = null;
    closeModal();
    if (typeof showSyncToast === "function") showSyncToast("📸 Photo saved — uploading...");
    phUploadPhoto(meta);
    phMaybeCreateSnagForTags(meta, [], tags);
  } catch (e) {
    console.error("saveQuickCapturePhoto failed", e);
    alert("Could not save that photo — please try again.");
    submit.disabled = false;
    submit.innerText = "Save Photo";
  }
}
window.saveQuickCapturePhoto = saveQuickCapturePhoto;

// ===== capture (mobile) =====

async function phHandleCapture(fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  const statusEl = document.getElementById("ph-capture-status-msg");
  if (!phProjectId) {
    if (statusEl) statusEl.textContent = "No project selected — open Photos from within a project.";
    return;
  }
  const postProjectInput = document.getElementById("ph-photo-post-project");
  const tags = phCollectStageTags("cap");
  if (statusEl) statusEl.textContent = "Compressing photo...";
  try {
    const blob = await phCompressImage(file, PH_MAX_BYTES);
    const photoId = phGenerateId();
    const meta = {
      photoId,
      projectId: phProjectId,
      storagePath: null,
      comment: "",
      postProject: !!(postProjectInput && postProjectInput.checked),
      capturedAt: Date.now(),
      fileSizeBytes: blob.size,
      lastModified: Date.now(),
      tags,
      localOnly: true,
      synced: false,
    };
    await phPutMeta(meta);
    await phPutBlob(photoId, blob);

    const input = document.getElementById("ph-camera-input");
    if (input) input.value = "";
    phList = phSortList(phList.concat([meta]));
    if (phTagFilter !== "All" && !tags.includes(phTagFilter)) phTagFilter = "All";
    phIndex = phFilteredList().findIndex((p) => p.photoId === photoId);
    await phRenderSlider();
    if (typeof showSyncToast === "function")
      showSyncToast(`📸 Photo saved (${Math.round(blob.size / 1024)}KB)`);
    if (statusEl) statusEl.textContent = "";

    // Best-effort immediate upload. If offline, callApi's existing queue
    // mechanism handles retry automatically (same system every other
    // mutation in this app already uses) — no custom retry logic needed
    // here. Local state gets reconciled next time this page loads, once
    // the photo shows up in getPhotos().
    phUploadPhoto(meta);
    phMaybeCreateSnagForTags(meta, [], tags);
  } catch (e) {
    console.error("phHandleCapture failed", e);
    if (statusEl) statusEl.textContent = "❌ Could not process that photo.";
  }
}
window.phHandleCapture = phHandleCapture;

async function phUploadPhoto(meta) {
  try {
    const blobRec = await phGetBlob(meta.photoId);
    if (!blobRec) return;
    const dataUrl = await phBlobToDataUrl(blobRec.blob);
    const resp = await callApi("savePhoto", {
      photoId: meta.photoId,
      projectId: meta.projectId,
      imageBase64: dataUrl,
      comment: meta.comment || "",
      postProject: meta.postProject,
      capturedAt: meta.capturedAt,
      tags: meta.tags || [],
    });
    if (resp && resp.status === "queued") return; // will resolve on next page load once synced

    const stored = await phGetBlob(meta.photoId); // still current photo?
    if (!stored) return; // deleted locally in the meantime

    if (resp && resp.success) {
      const updated = { ...meta, storagePath: resp.storagePath, localOnly: false, synced: true, lastModified: Date.now() };
      await phPutMeta(updated);
    } else {
      const updated = { ...meta, uploadError: (resp && resp.error) || "Upload failed" };
      await phPutMeta(updated);
    }
    if (phProjectId === meta.projectId) {
      phList = phSortList((await phGetAllMeta()).filter((m) => m.projectId === phProjectId));
      phRenderSlider();
    }
  } catch (e) {
    console.error("phUploadPhoto failed", e);
  }
}

// ===== comment editing (mobile + desktop) =====

let phCommentSaveTimer = null;
function phScheduleCommentSave(photoId) {
  clearTimeout(phCommentSaveTimer);
  phCommentSaveTimer = setTimeout(() => phSaveComment(photoId), 600);
}
window.phScheduleCommentSave = phScheduleCommentSave;

async function phSaveComment(photoId) {
  const textarea = document.getElementById("ph-comment-input");
  if (!textarea) return;
  const comment = textarea.value;
  const meta = phList.find((p) => p.photoId === photoId);
  if (!meta) return;
  const updated = { ...meta, comment, lastModified: Date.now() };
  await phPutMeta(updated);
  const idx = phList.findIndex((p) => p.photoId === photoId);
  if (idx !== -1) phList[idx] = updated;

  if (updated.storagePath) {
    // Fire-and-forget — offline gets queued automatically via callApi,
    // same as every other mutation in this app. Now editable from both
    // mobile and desktop; last write wins on conflict (no merge logic),
    // same as every other field in this app.
    callApi("updatePhotoComment", { photoId, comment }).catch((e) =>
      console.error("updatePhotoComment failed", e),
    );
  }
}

// ===== delete (desktop) =====

async function phDeleteCurrent() {
  if (!isElectronApp) return;
  const item = phFilteredList()[phIndex];
  if (!item) return;
  const days = typeof getRecycleBinRetentionDays === "function" ? getRecycleBinRetentionDays() : 30;
  if (!window.confirm("Delete this photo? It will move to the Recycle Bin for " + days + " days before permanent removal.")) return;

  try {
    if (!item.localOnly) {
      const resp = await callApi("deletePhoto", { photoId: item.photoId });
      if (!resp || (resp.success === false && resp.status !== "queued")) {
        showSyncToast("⚠️ Could not delete photo — try again.");
        return;
      }
    }
    await phDeleteMetaRow(item.photoId);
    await phDeleteBlobRow(item.photoId);
    if (phBlobUrlCache[item.photoId]) {
      URL.revokeObjectURL(phBlobUrlCache[item.photoId]);
      delete phBlobUrlCache[item.photoId];
    }
    phList = phList.filter((p) => p.photoId !== item.photoId);
    if (phIndex >= phFilteredList().length) phIndex = phFilteredList().length - 1;
    await phRenderSlider();
    if (typeof showSyncToast === "function") showSyncToast("🗑️ Photo moved to Recycle Bin");
  } catch (e) {
    console.error("phDeleteCurrent failed", e);
    showSyncToast("⚠️ Could not delete photo — try again.");
  }
}
window.phDeleteCurrent = phDeleteCurrent;

// ===== metadata editing (desktop) =====

async function phSaveMeta(photoId, silent) {
  const meta = phList.find((p) => p.photoId === photoId);
  if (!meta) return;

  const oldTags = meta.tags || [];
  const tags = phCollectStageTags("meta");
  const updated = {
    ...meta,
    tags,
    lastModified: Date.now(),
  };
  await phPutMeta(updated);
  const idx = phList.findIndex((p) => p.photoId === photoId);
  if (idx !== -1) phList[idx] = updated;

  if (updated.storagePath) {
    callApi("updatePhotoMeta", {
      photoId,
      tags: updated.tags,
    }).catch((e) => console.error("updatePhotoMeta failed", e));
  }
  await phMaybeCreateSnagForTags(updated, oldTags, tags);
  if (silent) return;
  if (typeof showSyncToast === "function") showSyncToast("✅ Tags saved");
  phRenderSlider();
}
window.phSaveMeta = phSaveMeta;

// ===== recycle bin (desktop) =====

async function phToggleDeletedView() {
  phShowDeleted = !phShowDeleted;
  if (phShowDeleted) {
    const container = document.getElementById("ph-view");
    if (container) container.innerHTML = `<div class="card"><span style="font-size:13px; color:var(--muted);">Loading recycle bin...</span></div>`;
    try {
      const resp = await callApi("getDeletedPhotos", { projectId: phProjectId });
      phDeletedList = Array.isArray(resp) ? resp.filter((p) => String(p.projectId).trim() === String(phProjectId).trim()) : [];
    } catch (e) {
      console.error("getDeletedPhotos failed", e);
      phDeletedList = [];
    }
  }
  phRenderSlider();
}
window.phToggleDeletedView = phToggleDeletedView;

function phRenderDeletedList() {
  const container = document.getElementById("ph-view");
  if (!container) return;
  const rows = phDeletedList
    .map(
      (p) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border, #eee);">
          <div style="font-size:13px;">
            <div style="font-weight:700;">${escapeHtml((safeParseTags_(p.tags) || []).join(", ") || "Untagged")}${p.comment ? " — " + escapeHtml(p.comment) : ""}</div>
            <div style="color:var(--muted); font-size:12px;">Deleted by ${escapeHtml(p.deletedBy || "unknown")} on ${new Date(Number(p.deletedAt)).toLocaleDateString()}</div>
          </div>
          <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="window.phRestoreFromBin('${escapeAttr(p.photoId)}')"><i class="fas fa-rotate-left"></i> Restore</button>
        </div>`,
    )
    .join("");

  container.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
      <span style="font-weight:800;">Recycle Bin (${phDeletedList.length})</span>
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="window.phToggleDeletedView()"><i class="fas fa-arrow-left"></i> Back to Photos</button>
    </div>
    <div class="card">
      ${phDeletedList.length ? rows : `<p style="color:var(--muted); font-size:13px;">Recycle bin is empty.</p>`}
    </div>
  `;
}

async function phRestoreFromBin(photoId) {
  try {
    const resp = await callApi("restorePhoto", { photoId });
    if (!resp || resp.success === false) {
      showSyncToast("⚠️ Could not restore photo — try again.");
      return;
    }
    phDeletedList = phDeletedList.filter((p) => p.photoId !== photoId);
    if (typeof showSyncToast === "function") showSyncToast("♻️ Photo restored");
    // Pull it back into the active list without a full page reload.
    await phLoadAndRender();
    phShowDeleted = false;
  } catch (e) {
    console.error("phRestoreFromBin failed", e);
    showSyncToast("⚠️ Could not restore photo — try again.");
  }
}
window.phRestoreFromBin = phRestoreFromBin;
