// ===== modals.js =====
let currentModalFiles = [];
let currentAvatarPhoto = "";
let modalRecordCache = {};

function resetSubmitOnError(submit) {
  return (err) => {
    submit.disabled = false;
    submit.innerText = "Save";
    // This used to reset the button and stop there -- silently, with
    // no indication anything went wrong at all. Affects every modal
    // that shares this same helper: Project, Vendor, Work Order, Snag,
    // Payment.
    const message = String((err && err.message) || err || "");
    if (message.includes("401")) {
      alert("You're not signed in. Please sign in and try again.");
    } else {
      alert("Failed to save: " + (message || "Unknown error"));
    }
  };
}

function openModalWithRecord(type, record) {
  if (type === "workorder" && !isElectronApp) return;
  if (record) {
    const idField = {
      project: "projectId",
      workorder: "workOrderId",
      payment: "paymentId",
      vendor: "vendorId",
      snag: "snagId",
    }[type];
    const cacheKey = `${type}:${record[idField]}`;
    modalRecordCache[cacheKey] = record;
  }
  return openModal(type, record);
}

function appendProgressNote(text) {
  const notes = document.getElementById("l_comm");
  if (!notes || !text) return;
  notes.value = [notes.value.trim(), text.trim()].filter(Boolean).join("\n");
}

function applyProgressChecklist(template) {
  const templates = {
    inspection:
      "- Work area inspected\n- Materials checked\n- Workmanship reviewed\n- Safety condition noted",
    delivery:
      "- Delivery received\n- Quantity checked\n- Damage/shortage noted\n- Stored in correct location",
    snag: "- Issue observed\n- Location recorded\n- Responsible party noted\n- Follow-up required",
  };
  appendProgressNote(templates[template] || "");
}

async function stampProgressLocation() {
  const button = document.getElementById("l_gps_btn");
  if (button) button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GPS';
  const gps = await getGPSLocation();
  if (gps !== "GPS Unavailable") appendProgressNote(`Location: ${gps}`);
  else alert("GPS unavailable on this device/browser.");
  if (button)
    button.innerHTML = '<i class="fas fa-location-crosshairs"></i> GPS';
}

function startProgressVoiceNote() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice notes are not supported in this browser.");
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (event) => {
    const text =
      event.results && event.results[0] && event.results[0][0]
        ? event.results[0][0].transcript
        : "";
    appendProgressNote(text);
  };
  rec.onerror = () => alert("Voice note could not be captured.");
  rec.start();
}

function populateModalInlineImageGalleryPreviews(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  if (!currentModalFiles.length) {
    box.innerHTML = "";
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";
  box.innerHTML = currentModalFiles
    .map((url, idx) => {
      const isDataUrl = url.startsWith("data:");
      return `<div style="position:relative; width:60px; height:60px;" data-attach-idx="${idx}">
        ${
          isDataUrl
            ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid #000;">`
            : `<div class="attach-thumb-loading" style="width:100%;height:100%;background:#eee;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#999;">…</div>`
        }
        <div onclick="window.removeAttachmentByIndex(${idx}, '${containerId}')" style="position:absolute; top:-6px; right:-6px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; line-height:18px; cursor:pointer;">&times;</div>
      </div>`;
    })
    .join("");

  // Already-uploaded attachments are just a bare Drive file ID — the doGet
  // endpoint returns that as text/plain, not real image bytes, so using it
  // directly as an <img src> renders blank (same issue fixed elsewhere in
  // reports/photos/documents). Resolve each one to a real data URI and
  // swap in the actual thumbnail once it arrives, without blocking the
  // rest of the preview from showing immediately.
  currentModalFiles.forEach((url, idx) => {
    if (url.startsWith("data:")) return;
    resolveImageToDataUrl(url).then((resolved) => {
      if (!resolved) return;
      const wrapper = box.querySelector(`[data-attach-idx="${idx}"]`);
      const loadingEl = wrapper && wrapper.querySelector(".attach-thumb-loading");
      if (loadingEl) {
        loadingEl.outerHTML = `<img src="${resolved}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid #000;">`;
      }
    });
  });
}

function removeAttachmentByIndex(idx, containerId) {
  currentModalFiles.splice(idx, 1);
  populateModalInlineImageGalleryPreviews(containerId);
}

/**
 * Adds drag-and-drop support to an attachment upload zone, on top of the
 * existing click-to-browse file input. Drop just feeds the same file list
 * into processIncomingMultiAttachments() that the file input's onchange
 * already uses, so compression/upload behavior is identical either way.
 */
function wireAttachmentDropZone(zoneId, previewId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("attach-drop-zone-active");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("attach-drop-zone-active");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("attach-drop-zone-active");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) processIncomingMultiAttachments(files, previewId);
  });
}

function processIncomingMultiAttachments(files, previewId) {
  if (!files.length) return;
  Array.from(files).forEach((file) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let data = ev.target.result;
      try {
        if (!file.type.includes("pdf")) {
          data = await compressImageToTargetLimit(data, 190000);
        } else {
          data = await compressPdfToTargetLimit(data, 300000);
        }
        currentModalFiles.push(data);
        populateModalInlineImageGalleryPreviews(previewId);
      } catch (err) {
        alert("⚠️ " + (err.message || "Failed to process file."));
      }
    };
    reader.readAsDataURL(file);
  });
}

function clearVendorAvatarPhoto() {
  currentAvatarPhoto = "";
  const img = document.getElementById("passport_frame_view");
  if (img)
    img.src =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E";
  const btn = document.getElementById("v_pass_remove");
  if (btn) btn.style.display = "none";
}

function generateFrontendPreviewId(type) {
  const cache = getCache();
  const yy = new Date().getFullYear().toString().slice(-2);
  const prefix = type === "project" ? `PRJ/${yy}/` : `WKO/${yy}/`;
  const dataset = type === "project" ? cache.projects : cache.workorders;
  let max = 0;
  (dataset || []).forEach((item) => {
    const id = String(
      item[type === "project" ? "projectId" : "workOrderId"] || "",
    );
    if (id.startsWith(prefix)) {
      const num = parseInt(id.substring(prefix.length));
      if (!isNaN(num) && num > max) max = num;
    }
  });
  return prefix + String(max + 1).padStart(3, "0");
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  const content = document.getElementById("modalContent");
  if (content) content.classList.remove("modal-fullscreen");
  // Restore default submit button in case a custom modal replaced it
  const foot = document.getElementById("modalFoot");
  if (foot) {
    foot.innerHTML =
      '<button id="modalSubmit" class="action-btn">Save</button>';
  }
}

async function refreshPaymentAttachmentsList(projectId, paymentId) {
  const list = document.getElementById("payment-attachments-list");
  if (!list || !window.electronAPI || !window.electronAPI.attachments) return;
  let files = [];
  try {
    files = await window.electronAPI.attachments.list(projectId, "Payments");
  } catch (e) {
    console.error("attachments.list failed", e);
  }
  // Only show files belonging to this payment (renamed to start with its ID)
  const mine = files.filter((f) => f.name.startsWith(paymentId));
  if (!mine.length) {
    list.innerHTML =
      '<span style="font-size:12px; color:var(--muted);">No files attached yet</span>';
    return;
  }
  list.innerHTML = mine
    .map((file) => {
      const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
      const safePath = escapeAttr(file.path);
      return `<div title="${escapeAttr(file.name)}" style="display:flex;align-items:center;gap:6px;background:var(--card-light);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;">
        <span style="cursor:pointer;" onclick="window.openProjectAttachment('${safePath}')"><i class="fas ${isImage ? "fa-image" : "fa-file"}"></i> ${escapeHtml(file.name)}</span>
        <span style="cursor:pointer;color:var(--danger,red);" onclick="window.removePaymentAttachment('${escapeAttr(projectId)}','${escapeAttr(paymentId)}','${safePath}')">&times;</span>
      </div>`;
    })
    .join("");
}
window.refreshPaymentAttachmentsList = refreshPaymentAttachmentsList;

async function addPaymentAttachment(projectId, paymentId) {
  try {
    // renameTo = paymentId, so the file on disk is named after the payment
    // number regardless of what it was called on the user's computer.
    await window.electronAPI.attachments.add(projectId, "Payments", paymentId);
  } catch (e) {
    console.error("attachments.add failed", e);
    alert("Could not add file. Check console.");
  }
  await refreshPaymentAttachmentsList(projectId, paymentId);
}
window.addPaymentAttachment = addPaymentAttachment;

async function removePaymentAttachment(projectId, paymentId, filePath) {
  if (!confirm("Remove this attachment? This deletes the file from disk.")) return;
  try {
    await window.electronAPI.attachments.remove(filePath);
  } catch (e) {
    console.error("attachments.remove failed", e);
  }
  await refreshPaymentAttachmentsList(projectId, paymentId);
}
window.removePaymentAttachment = removePaymentAttachment;

// ===== Snag photos — unified into the Photos system (Phase 2) =====
// Previously snag photos lived in their own local-only IndexedDB store
// (SNAG_PHOTO_V2_STORE) and never left the device — the sync hook they
// called, ptTrySyncSnagPhoto, was never actually defined anywhere in the
// app, so photos captured on mobile silently never reached desktop or the
// backend. They also depended on ptCompressImage, which likewise doesn't
// exist — so capture was throwing (caught and swallowed) rather than
// working at all. This rewrite routes snag photos through the same
// cloud-synced Photos pipeline as the project photo library (category:
// "Snags", linked to the snag via PhotoLinks), which fixes both bugs as a
// side effect.

async function renderSnagPhotoGalleryV2(snagId) {
  const gallery = document.getElementById("snagPhotoGalleryV2");
  if (!gallery) return;
  let photos = [];
  try {
    const allMeta = await phGetAllMeta();
    // Photos captured directly through this snag's own capture flow carry
    // a local linkedSnagId tag (works offline, before the link round-trip
    // to the server completes).
    const locallyTagged = allMeta.filter((m) => m.linkedSnagId === snagId);

    // Photos linked from the general Photos library (via the link picker,
    // or tagged category:"Snags" and linked there) live in PhotoLinks on
    // the server — this is the authoritative many-to-many relationship.
    let linkedIds = [];
    try {
      const links = await callApi("getPhotoLinks", { recordType: "Snag", recordId: snagId });
      linkedIds = Array.isArray(links) ? links.map((l) => l.photoId) : [];
    } catch (e) {
      console.warn("getPhotoLinks failed (offline?):", e);
    }
    const linkedPhotos = allMeta.filter((m) => linkedIds.includes(m.photoId));

    const merged = new Map();
    [...locallyTagged, ...linkedPhotos].forEach((p) => merged.set(p.photoId, p));
    photos = Array.from(merged.values()).sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
  } catch (e) {
    console.warn("Could not load snag photos:", e);
  }
  if (!photos.length) {
    gallery.innerHTML = '<span style="font-size:12px; color:var(--muted);">No photos yet</span>';
    return;
  }
  const thumbHtml = await Promise.all(
    photos.map(async (p) => {
      const url = await phGetBlobUrl(p.photoId);
      return `
    <div style="position:relative; width:72px; height:72px;">
      ${url ? `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:8px; border:1px solid var(--border);">` : `<div style="width:100%; height:100%; border-radius:8px; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--muted);">…</div>`}
      ${p.localOnly ? '<div style="position:absolute; bottom:2px; left:2px; background:rgba(0,0,0,0.6); color:#fff; font-size:9px; padding:1px 4px; border-radius:4px;">Pending</div>' : ""}
      <div onclick="window.deleteSnagPhotoV2Ui('${escapeAttr(snagId)}','${escapeAttr(p.photoId)}')" style="position:absolute; top:-6px; right:-6px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; line-height:18px; cursor:pointer; font-weight:800; font-size:12px;">&times;</div>
    </div>`;
    }),
  );
  gallery.innerHTML = thumbHtml.join("");
}

async function handleSnagPhotoCapture(fileList, snagId) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const projectId = getCurrentProjectId();
  for (const file of files) {
    try {
      const blob = await phCompressImage(file, PH_MAX_BYTES);
      const photoId = phGenerateId();
      const meta = {
        photoId,
        projectId,
        driveFileId: null,
        comment: "",
        postProject: false,
        capturedAt: Date.now(),
        fileSizeBytes: blob.size,
        lastModified: Date.now(),
        category: "Snags",
        tags: [],
        area: "",
        trade: "",
        activity: "",
        stage: "",
        linkedSnagId: snagId, // local-only convenience field for gallery filtering
        localOnly: true,
        synced: false,
      };
      await phPutMeta(meta);
      await phPutBlob(photoId, blob);

      // Upload + link, best-effort (offline gets queued automatically via
      // callApi, same as every other mutation in this app).
      phUploadPhoto(meta).finally(() => {
        callApi("savePhotoLink", {
          photoId,
          recordType: "Snag",
          recordId: snagId,
          projectId,
        }).catch((e) => console.error("savePhotoLink failed", e));
      });
    } catch (e) {
      console.error("snag photo capture failed", e);
    }
  }
  const input = document.getElementById("sn_photo");
  if (input) input.value = "";
  await renderSnagPhotoGalleryV2(snagId);
}

async function deleteSnagPhotoV2Ui(snagId, photoId) {
  if (!confirm("Delete this photo? It will move to the Recycle Bin.")) return;
  try {
    await callApi("deletePhoto", { photoId }); // soft delete server-side
  } catch (e) {
    console.error("deletePhoto failed", e);
  }
  await phDeleteMetaRow(photoId);
  await phDeleteBlobRow(photoId);
  if (phBlobUrlCache[photoId]) {
    URL.revokeObjectURL(phBlobUrlCache[photoId]);
    delete phBlobUrlCache[photoId];
  }
  await renderSnagPhotoGalleryV2(snagId);
}
window.deleteSnagPhotoV2Ui = deleteSnagPhotoV2Ui;

/**
 * One-time migration: moves any photos still sitting in the legacy
 * SNAG_PHOTO_V2_STORE (device-local only, never synced — see note above)
 * into the unified Photos pipeline, then clears the old store. Safe to
 * call on every app start; it's a no-op once migration has completed.
 */
async function migrateLegacySnagPhotos() {
  const FLAG_KEY = "snagPhotoMigrationV1Done";
  if (localStorage.getItem(FLAG_KEY) === "true") return;
  try {
    const legacyRecords = await getAllSnagPhotosV2();
    for (const rec of legacyRecords) {
      try {
        const sourceDataUrl = rec.fullDataUrl || rec.thumbnailDataUrl;
        if (!sourceDataUrl) continue;
        const blob = await (await fetch(sourceDataUrl)).blob();
        const photoId = phGenerateId();
        const meta = {
          photoId,
          projectId: rec.projectId,
          driveFileId: null,
          comment: "",
          postProject: false,
          capturedAt: rec.createdAt || Date.now(),
          fileSizeBytes: blob.size,
          lastModified: Date.now(),
          category: "Snags",
          tags: [],
          area: "",
          trade: "",
          activity: "",
          stage: "",
          linkedSnagId: rec.snagId,
          localOnly: true,
          synced: false,
        };
        await phPutMeta(meta);
        await phPutBlob(photoId, blob);
        await phUploadPhoto(meta);
        await callApi("savePhotoLink", {
          photoId,
          recordType: "Snag",
          recordId: rec.snagId,
          projectId: rec.projectId,
        }).catch((e) => console.error("savePhotoLink failed during migration", e));
        await deleteSnagPhotoV2(rec.id);
      } catch (e) {
        console.error("Failed to migrate legacy snag photo", rec && rec.id, e);
        // Leave it in the legacy store so the next app start retries it,
        // rather than losing the photo silently.
      }
    }
    localStorage.setItem(FLAG_KEY, "true");
  } catch (e) {
    console.error("migrateLegacySnagPhotos failed", e);
    // Don't set the flag — retry on next app start.
  }
}
window.migrateLegacySnagPhotos = migrateLegacySnagPhotos;

function startNewProjectFlow() {
  const cache = getCache();
  const projects = (cache.projects || []).filter((p) => p.clientName);
  if (!projects.length) {
    openModal("project", null);
    return;
  }
  const overlay = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const foot = document.getElementById("modalFoot");
  if (!overlay || !body || !title || !foot) return;
  title.innerText = "New Project";
  overlay.style.display = "flex";
  foot.innerHTML = "";
  body.innerHTML = `
    <p style="margin-bottom:16px;">Copy client details from an existing project, or start with a blank form?</p>
    <button class="action-btn" style="margin-bottom:10px;" onclick="window.showCopyClientPicker()">
      <i class="fas fa-copy"></i> Copy Existing Client Details
    </button>
    <button class="action-btn" style="background:var(--card-light); color:var(--text);" onclick="closeModal(); openModal('project', null);">
      <i class="fas fa-plus"></i> Create New (Blank)
    </button>
  `;
}
window.startNewProjectFlow = startNewProjectFlow;

function showCopyClientPicker() {
  const cache = getCache();
  const projects = cache.projects || [];
  const seen = new Set();
  const clients = [];
  projects.forEach((p) => {
    const key = `${p.clientName}||${p.clientPhone}`;
    if (!p.clientName || seen.has(key)) return;
    seen.add(key);
    clients.push(p);
  });
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  if (!body || !title) return;
  title.innerText = "Select Client to Copy";
  body.innerHTML = clients.length
    ? clients
        .map(
          (p) => `
        <div class="card" style="cursor:pointer; margin-bottom:8px;" onclick="window.applyClientCopyAndOpenProjectModal('${escapeAttr(p.projectId)}')">
          <strong>${escapeHtml(p.clientName)}</strong><br>
          <span style="font-size:13px; color:var(--muted);">${escapeHtml(p.clientPhone || "")}${p.clientEmail ? " · " + escapeHtml(p.clientEmail) : ""}</span>
        </div>`,
        )
        .join("")
    : "<p>No existing clients found.</p>";
}
window.showCopyClientPicker = showCopyClientPicker;

async function applyClientCopyAndOpenProjectModal(sourceProjectId) {
  const cache = getCache();
  const source = (cache.projects || []).find((p) => p.projectId === sourceProjectId);
  closeModal();
  await openModal("project", null);
  if (source) {
    const clientInput = document.getElementById("p_client");
    const phoneInput = document.getElementById("p_phone");
    const emailInput = document.getElementById("p_email");
    if (clientInput) clientInput.value = source.clientName || "";
    if (phoneInput) phoneInput.value = source.clientPhone || "";
    if (emailInput) emailInput.value = source.clientEmail || "";
  }
}
window.applyClientCopyAndOpenProjectModal = applyClientCopyAndOpenProjectModal;

async function openModal(type, editData = null) {
  if (type === "workorder" && !isElectronApp) {
    if (typeof showSyncToast === "function")
      showSyncToast("Work Orders are view-only on mobile");
    return;
  }
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const isEdit = !!editData;
  overlay.style.display = "flex";
  body.innerHTML = "";
  submit.disabled = false;
  submit.innerText = "Save";
  submit.style.display = "block";
  // Restore default foot in case a previous custom modal changed it
  const foot = document.getElementById("modalFoot");
  if (foot && foot.innerHTML.indexOf('id="modalSubmit"') === -1) {
    foot.innerHTML =
      '<button id="modalSubmit" class="action-btn">Save</button>';
  }
  currentModalFiles = [];
  currentAvatarPhoto = "";
  const labelStyle =
    'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  if (type === "project") {
    title.innerText = isEdit ? "Edit Project" : "New Project";
    const projectId = isEdit ? editData.projectId : generateFrontendPreviewId("project");
    body.innerHTML = `<label ${labelStyle}>Project ID</label><input value="${escapeAttr(projectId)}" disabled style="${largeInput} background:#f0f0f0;"><label ${labelStyle}>Client Name</label><input id="p_client" value="${escapeAttr(isEdit ? editData.clientName : "")}" ${largeInput}><label ${labelStyle}>Site Location</label><input id="p_loc" value="${escapeAttr(isEdit ? editData.siteLocation : "")}" ${largeInput}><label ${labelStyle}>Client Phone (11 digits)</label><input id="p_phone" type="tel" maxlength="11" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeAttr(isEdit ? editData.clientPhone : "")}" ${largeInput}><label ${labelStyle}>Client Email</label><input id="p_email" type="email" value="${escapeAttr(isEdit ? editData.clientEmail : "")}" ${largeInput}><label ${labelStyle}>Status</label><select id="p_status" ${largeInput}><option value="Active" ${(!isEdit || editData.projectStatus === "Active") ? "selected" : ""}>Active</option><option value="Handed Over" ${isEdit && editData.projectStatus === "Handed Over" ? "selected" : ""}>Handed Over</option><option value="Abandoned" ${isEdit && editData.projectStatus === "Abandoned" ? "selected" : ""}>Abandoned</option></select><label ${labelStyle}>Contract Subtotal</label><input id="p_contract_subtotal" type="number" step="0.01" value="${escapeAttr(isEdit && editData.contractSubtotal != null ? editData.contractSubtotal : 0)}" ${largeInput}><label ${labelStyle}>VAT Paid</label><input id="p_vat_paid" type="number" step="0.01" value="${escapeAttr(isEdit && editData.vatPaid != null ? editData.vatPaid : 0)}" ${largeInput}><label ${labelStyle}>Notes</label><textarea id="p_notes" rows="2" ${largeInput}>${escapeHtml(isEdit ? editData.notes : "")}</textarea>`;
    submit.onclick = () => {
      const phone = document.getElementById("p_phone").value.trim();
      if (phone && !/^\d{11}$/.test(phone)) {
        alert("Phone must be 11 digits");
        return;
      }
      submit.disabled = true;
      submit.innerText = "Saving...";
      const payload = {
        projectId,
        clientName: document.getElementById("p_client").value,
        siteLocation: document.getElementById("p_loc").value,
        clientPhone: phone,
        clientEmail: document.getElementById("p_email").value,
        projectStatus: document.getElementById("p_status").value,
        contractSubtotal: roundMoney(
          Number(document.getElementById("p_contract_subtotal").value) || 0,
        ),
        vatPaid: roundMoney(
          Number(document.getElementById("p_vat_paid").value) || 0,
        ),
        notes: document.getElementById("p_notes").value,
      };
      callApi(isEdit ? "updateProject" : "saveProject", payload)
        .then(() => {
          const cache = getCache();
          const idx = (cache.projects || []).findIndex((p) =>
            idsMatch(p.projectId, payload.projectId),
          );
          if (idx === -1) cache.projects = [payload, ...(cache.projects || [])];
          else cache.projects[idx] = { ...cache.projects[idx], ...payload };
          setCache(cache);
          closeModal();
          refreshMasterDashboard();
          if (isEdit) loadProjectConsoleHub(payload.projectId);
        })
        .catch(resetSubmitOnError(submit));
    };
  } else if (type === "vendor") {
    const uniqueId = isEdit ? editData.vendorId : "VND-" + Date.now();
    title.innerText = isEdit ? "Edit Vendor" : "New Vendor";
    if (isEdit) {
      // The passport column is a single image, but the backend stores it
      // in a jsonb column defaulting to [] (an empty-array default meant
      // for list-shaped fields like attachments, not a single image) --
      // so a vendor with no photo comes back as [] rather than "" or
      // null. [] is truthy, so the .startsWith() check below used to
      // reach a real string method call on an array and crash instantly,
      // before the modal could even open. Coercing defensively here means
      // this can't crash regardless of what shape the database sends.
      currentAvatarPhoto = typeof editData.passport === "string" ? editData.passport : "";
      if (editData.attachments)
        currentModalFiles = splitAttachments(editData.attachments);
    }
    body.innerHTML = `<div class="passport-frame-container"><img id="passport_frame_view" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E" style="width:100%; height:100%; object-fit:cover;"><label style="position:absolute; bottom:0; right:0; background:#000; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-camera"></i><input type="file" id="v_pass" accept="image/*" style="display:none"></label><div id="v_pass_remove" onclick="window.clearVendorAvatarPhoto()" style="position:absolute; top:0; right:0; background:red; color:white; border-radius:50%; width:22px; text-align:center; cursor:pointer;">&times;</div></div><label ${labelStyle}>Company</label><input id="v_comp" value="${escapeAttr(isEdit ? editData.company : "")}" ${largeInput}><label ${labelStyle}>Trade</label><input id="v_trade" value="${escapeAttr(isEdit ? editData.trade : "")}" ${largeInput}><label ${labelStyle}>Contact Person</label><input id="v_contact" value="${escapeAttr(isEdit ? editData.contactName : "")}" ${largeInput}><label ${labelStyle}>Phone 1 (11 digits)</label><input id="v_phone1" type="tel" maxlength="11" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeAttr(isEdit ? editData.phone1 : "")}" ${largeInput}><label ${labelStyle}>Phone 2</label><input id="v_phone2" type="tel" maxlength="11" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeAttr(isEdit ? editData.phone2 : "")}" ${largeInput}><label ${labelStyle}>Email</label><input id="v_email" type="email" value="${escapeAttr(isEdit ? editData.email : "")}" ${largeInput}><label ${labelStyle}>Notes</label><textarea id="v_notes" rows="3" ${largeInput}>${escapeHtml(isEdit ? editData.notes || "" : "")}</textarea><div id="vendorAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div></div><label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="v_files" accept="image/*,application/pdf" multiple style="display:none"></label>${isEdit ? `<button class="action-btn" id="v_delete_btn" style="background:${(String(editData.archived).toLowerCase() === "yes" || editData.archived === true) ? "var(--success)" : "var(--danger)"}; margin-top:10px;">${(String(editData.archived).toLowerCase() === "yes" || editData.archived === true) ? "Unarchive" : "Archive"}</button>` : ""}`;
    if (currentAvatarPhoto && !currentAvatarPhoto.startsWith("data:")) {
      // Same recurring bug as everywhere else: a bare Drive file ID doesn't
      // render as an <img src> until it's actually fetched and resolved.
      resolveImageToDataUrl(currentAvatarPhoto).then((resolved) => {
        if (!resolved) return;
        const img = document.getElementById("passport_frame_view");
        if (img) img.src = resolved;
      });
    }
    if (currentModalFiles.length)
      populateModalInlineImageGalleryPreviews("vendorAttachmentsPreviews");
    document.getElementById("v_pass").onchange = (e) => {
      const f = e.target.files[0];
      if (f) {
        const r = new FileReader();
        r.onload = async (ev) => {
          currentAvatarPhoto = await compressImageToTargetLimit(
            ev.target.result,
            190000,
          );
          document.getElementById("passport_frame_view").src =
            currentAvatarPhoto;
          document.getElementById("v_pass_remove").style.display = "block";
        };
        r.readAsDataURL(f);
      }
    };
    document.getElementById("v_files").onchange = (e) =>
      processIncomingMultiAttachments(
        e.target.files,
        "vendorAttachmentsPreviews",
      );
    if (isEdit) {
      document.getElementById("v_delete_btn").onclick = () => {
        const isCurrentlyArchived = String(editData.archived).toLowerCase() === "yes" || editData.archived === true;
        const action = isCurrentlyArchived ? "unarchiveVendor" : "archiveVendor";
        const btn = document.getElementById("v_delete_btn");
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (isCurrentlyArchived ? "Unarchiving..." : "Archiving...");
        callApi(action, { vendorId: uniqueId })
          .then(() => {
            const cache = getCache();
            const vendor = (cache.vendors || []).find((v) => v.vendorId === uniqueId);
            if (vendor) vendor.archived = isCurrentlyArchived ? "No" : "Yes";
            setCache(cache);
            closeModal();
            refreshVendorsListView();
            if (typeof showSyncToast === "function") {
              showSyncToast(isCurrentlyArchived ? "✅ Vendor restored" : "📦 Vendor archived");
            }
          })
          .catch((err) => {
            alert("Could not " + (isCurrentlyArchived ? "restore" : "archive") + " vendor: " + (err && err.message ? err.message : "Unknown error"));
            btn.disabled = false;
            btn.innerHTML = isCurrentlyArchived ? "Unarchive" : "Archive";
          });
      };
    }
    submit.onclick = () => {
      const p1 = document.getElementById("v_phone1").value.trim();
      const p2 = document.getElementById("v_phone2").value.trim();
      if (p1 && !/^\d{11}$/.test(p1)) {
        alert("Phone 1 must be 11 digits");
        return;
      }
      if (p2 && !/^\d{11}$/.test(p2)) {
        alert("Phone 2 must be 11 digits");
        return;
      }
      submit.disabled = true;
      submit.innerText = "Saving...";
      const payload = {
        vendorId: uniqueId,
        company: document.getElementById("v_comp").value,
        trade: document.getElementById("v_trade").value,
        contactName: document.getElementById("v_contact").value,
        phone1: p1,
        phone2: p2,
        email: document.getElementById("v_email").value,
        notes: document.getElementById("v_notes").value,
        passport: currentAvatarPhoto,
        attachments: normalizeAttachments(currentModalFiles),
        archived: "No",
      };
      callApi(isEdit ? "updateVendor" : "saveVendor", payload)
        .then(() => {
          closeModal();
          refreshVendorsListView();
        })
        .catch(resetSubmitOnError(submit));
    };
  } else if (type === "progress_entry") {
    // This branch was entirely missing -- openModalWithRecord('progress_entry', ...)
    // had nothing to match against, so body.innerHTML never got set at
    // all, while the Save button (built by shared, type-independent code
    // further down) still appeared -- exactly "form not opening fully,
    // only shows the Save button".
    //
    // isEdit alone (!!editData) isn't enough here: creating a new
    // sub-task passes a minimal editData object (just to carry
    // parentLogId/projectId through), which would otherwise make the
    // global isEdit true and incorrectly show an "edit" form with mostly
    // blank fields instead of a genuine new-entry form.
    const isNewSubTask = isEdit && editData._isSubTask === true;
    const isEditingLog = isEdit && !isNewSubTask;
    const parentLogId = isEdit ? editData.parentLogId : undefined;

    // A log with sub-logs has its % computed from them (see
    // computeLogDisplayPercentage in console.js) -- manually typing a
    // different value here would just be silently overwritten and
    // ignored the next time the list re-renders, which is confusing.
    // Disabling it here makes that genuinely true instead of just
    // visually true.
    const allLogsForCheck = (typeof getCache === "function" && getCache().progressLogs) || [];
    const hasChildren = isEditingLog && allLogsForCheck.some((l) => l.parentLogId === editData.logId);
    const displayPercent = hasChildren && typeof computeLogDisplayPercentage === "function"
      ? computeLogDisplayPercentage(editData, allLogsForCheck)
      : isEditingLog && editData.completionPercentage != null ? editData.completionPercentage : "";

    title.innerText = isEditingLog ? "Edit Progress Entry" : isNewSubTask ? "Add Sub-task" : "Log Progress";
    body.innerHTML = `<label ${labelStyle}>Trade Category</label><input id="pl_trade" value="${escapeAttr(isEditingLog ? editData.tradeCategory || "" : "")}" ${largeInput}><label ${labelStyle}>Completion (%)</label><input id="pl_percent" type="number" min="0" max="100" value="${escapeAttr(displayPercent)}" ${hasChildren ? "disabled" : ""} ${largeInput}${hasChildren ? " style=\"background:#f0f0f0;\"" : ""}>${hasChildren ? `<p style="font-size:12px; color:var(--muted); margin-top:4px;">Computed from this entry's sub-tasks -- edit them individually to change it.</p>` : ""}<label ${labelStyle}>Comments</label><textarea id="pl_comment" rows="4" ${largeInput}>${escapeHtml(isEditingLog ? editData.commentNarrative || "" : "")}</textarea><div id="progressPhotoPreviews" class="modal-preview-grid" style="display:none;"></div><label class="icon-upload-label"><i class="fas fa-camera"></i><input type="file" id="pl_photo" accept="image/*" multiple style="display:none"></label>${isEditingLog ? `<button type="button" class="action-btn" id="pl_delete_btn" style="background:var(--danger); margin-top:14px;">Delete</button>` : ""}`;
    if (isEditingLog && editData.progressPhotoUrl)
      currentModalFiles = splitAttachments(editData.progressPhotoUrl);
    if (isEditingLog) {
      const deleteBtn = document.getElementById("pl_delete_btn");
      if (deleteBtn) deleteBtn.onclick = () => window.deleteProgressLog(editData.logId);
    }

    submit.style.display = "block";
    submit.innerText = "Save";
    submit.onclick = () => {
      const tradeCategory = document.getElementById("pl_trade").value.trim();
      if (!tradeCategory) {
        alert("Enter a trade category");
        return;
      }
      submit.disabled = true;
      submit.innerText = "Saving...";
      const payload = {
        logId: isEditingLog ? editData.logId : undefined,
        projectId: isEditingLog ? editData.projectId : isNewSubTask ? editData.projectId : getCurrentProjectId(),
        tradeCategory,
        completionPercentage: document.getElementById("pl_percent").value,
        commentNarrative: document.getElementById("pl_comment").value,
        progressPhotoUrl: normalizeAttachments(currentModalFiles),
        parentLogId: parentLogId,
      };
      callApi(isEditingLog ? "updateProgressLog" : "saveProgressLog", payload)
        .then(() => {
          closeModal();
          if (typeof loadProgressTimelineFeed === "function") loadProgressTimelineFeed(true);
        })
        .catch(resetSubmitOnError(submit));
    };
  } else if (type === "workorder") {
    const uniqueId = isEdit
      ? editData.workOrderId
      : generateFrontendPreviewId("workorder");
    title.innerText = isEdit ? "Edit Work Order" : "New Work Order";
    if (isEdit && editData.attachments)
      currentModalFiles = splitAttachments(editData.attachments);
    let vendors = getCache().vendors || [];
    if (!vendors.length) {
      try {
        const fetched = await callApi("getVendors", {});
        const cache = getCache();
        cache.vendors = fetched || [];
        setCache(cache);
        vendors = cache.vendors;
      } catch (e) {
        console.warn("Could not load vendors for work order modal:", e);
      }
    }
    vendors = vendors.filter(
      (v) => (isEdit && v.vendorId === editData.vendorId) || !(String(v.archived).toLowerCase() === "yes" || v.archived === true),
    );

    let lineItems = [];
    let woNotes = "";
    if (isEdit && editData.description) {
      try {
        const parsed = JSON.parse(editData.description);
        if (parsed && Array.isArray(parsed.lineItems)) {
          lineItems = parsed.lineItems;
          woNotes = parsed.notes || "";
        } else {
          lineItems = [
            {
              description: editData.description,
              qty: 1,
              rate: Number(editData.amount) || 0,
              amount: Number(editData.amount) || 0,
            },
          ];
        }
      } catch (e) {
        lineItems = [
          {
            description: editData.description,
            qty: 1,
            rate: Number(editData.amount) || 0,
            amount: Number(editData.amount) || 0,
          },
        ];
      }
    }

    const lineItemsHtml = lineItems
      .map(
        (item) =>
          `<tr class="wo-line-row">
        <td style="padding:4px; border-bottom:1px solid var(--border);"><input class="wo-line-desc" value="${escapeAttr(item.description || "")}" placeholder="Description" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
        <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input class="wo-line-qty" type="number" value="${escapeAttr(item.qty || 1)}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcWorkOrderTotal()"></td>
        <td style="padding:4px; border-bottom:1px solid var(--border); width:70px;"><input class="wo-line-um" value="${escapeAttr(item.um || "")}" placeholder="U/M" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:center;"></td>
        <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="wo-line-rate" type="number" value="${escapeAttr(item.rate || "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcWorkOrderTotal()"></td>
        <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="wo-line-amt" type="number" value="${escapeAttr(item.amount || 0)}" disabled style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right; background:#f5f5f5;"></td>
        <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="this.closest('tr').remove(); window.recalcWorkOrderTotal();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>
      </tr>`,
      )
      .join("");

    body.innerHTML = `<label ${labelStyle}>ID</label><input value="${uniqueId}" disabled style="${largeInput} background:#f0f0f0;"><label ${labelStyle}>Vendor</label><select id="wo_vendor" ${largeInput}>${vendors.map((v) => `<option value="${v.vendorId}" ${isEdit && v.vendorId === editData.vendorId ? "selected" : ""}>${escapeHtml(v.company)}</option>`).join("")}</select>
    <label ${labelStyle}>Line Items</label>
    <table style="width:100%; font-size:13px; border-collapse:collapse; margin-bottom:10px;">
      <thead>
        <tr style="background:#000; color:#fff;">
          <th style="padding:6px; text-align:left; font-size:10px; text-transform:uppercase;">Description</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:60px;">Qty</th>
          <th style="padding:6px; text-align:center; font-size:10px; text-transform:uppercase; width:70px;">U/M</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:90px;">Rate (₦)</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:90px;">Amount (₦)</th>
          <th style="width:30px;"></th>
        </tr>
      </thead>
      <tbody id="wo_line_items_body">${lineItemsHtml}</tbody>
    </table>
    <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.addWorkOrderLineItem()"><i class="fas fa-plus"></i> Add Line Item</button>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; margin-bottom:12px; padding:12px; background:var(--card-light); border-radius:12px; border:1.5px solid var(--border);">
      <span style="font-weight:800; font-size:14px;">Total Work Order Value</span>
      <span id="wo_total_display" style="font-weight:900; font-size:18px;">₦${moneyValue(isEdit ? Number(editData.amount) || 0 : 0)}</span>
    </div>
    <input type="hidden" id="wo_amount_hidden" value="${escapeAttr(isEdit ? editData.amount : 0)}">
    <label ${labelStyle}>Notes</label><textarea id="wo_notes" rows="2" ${largeInput}>${escapeHtml(woNotes)}</textarea>
    <label ${labelStyle}>Status</label><select id="wo_status" ${largeInput}><option value="Draft" ${!isEdit || editData.status === "Draft" ? "selected" : ""}>Draft</option><option value="Approved" ${isEdit && editData.status === "Approved" ? "selected" : ""}>Approved</option></select>
    <div id="woAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div>
    <div id="wo_attach_dropzone" class="attach-drop-zone" onclick="document.getElementById('wo_files').click()">
      <i class="fas fa-cloud-arrow-up"></i>
      <span>Drag &amp; drop files, or click to browse</span>
      <input type="file" id="wo_files" accept="image/*,application/pdf" multiple style="display:none">
    </div>`;
    if (currentModalFiles.length)
      populateModalInlineImageGalleryPreviews("woAttachmentsPreviews");
    document.getElementById("wo_files").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "woAttachmentsPreviews");
    wireAttachmentDropZone("wo_attach_dropzone", "woAttachmentsPreviews");
    submit.onclick = () => {
      const vendorId = document.getElementById("wo_vendor").value;
      if (!vendorId) {
        alert("Select a vendor");
        return;
      }
      const rows = document.querySelectorAll("#wo_line_items_body tr");
      const lineItems = [];
      rows.forEach((row) => {
        const desc = row.querySelector(".wo-line-desc").value.trim();
        if (desc) {
          const qty = Number(row.querySelector(".wo-line-qty").value) || 0;
          const um = row.querySelector(".wo-line-um").value.trim();
          const rate = Number(row.querySelector(".wo-line-rate").value) || 0;
          lineItems.push({
            description: desc,
            qty: qty,
            um: um,
            rate: rate,
            amount: roundMoney(qty * rate),
          });
        }
      });
      if (!lineItems.length) {
        alert("Add at least one line item");
        return;
      }
      const totalAmount = roundMoney(
        lineItems.reduce((s, i) => s + i.amount, 0),
      );
      const description = JSON.stringify({
        lineItems,
        notes: document.getElementById("wo_notes").value,
      });
      submit.disabled = true;
      submit.innerText = "Saving...";
      const payload = {
        workOrderId: uniqueId,
        projectId: getCurrentProjectId(),
        vendorId: vendorId,
        description: description,
        amount: totalAmount,
        status: document.getElementById("wo_status").value,
        attachments: normalizeAttachments(currentModalFiles),
      };
      callApi(isEdit ? "updateWorkOrder" : "saveWorkOrder", payload)
        .then(() => {
          closeModal();
          loadWorkOrdersListings(true);
        })
        .catch(resetSubmitOnError(submit));
    };
  } else if (type === "snag") {
    const uniqueId = isEdit ? editData.snagId : "SNAG-" + Date.now();
    title.innerText = isEdit ? "Edit Snag" : "New Snag";
    body.innerHTML = `<label ${labelStyle}>Notes</label><textarea id="sn_notes" rows="3" ${largeInput}>${escapeHtml(isEdit ? editData.notes : "")}</textarea><label ${labelStyle}>Assigned To</label><input id="sn_assigned" value="${escapeAttr(isEdit ? editData.assigned : "")}" ${largeInput}><label ${labelStyle}>Date Logged</label><input id="sn_date_logged" type="text" value="${escapeAttr(isEdit ? editData.dateLogged : todayFormatted())}" placeholder="YYYY/MM/DD" disabled style="${largeInput} background:#f0f0f0;"><label ${labelStyle}>Status</label><select id="sn_status" ${largeInput}><option value="Open" ${!isEdit || editData.status === "Open" ? "selected" : ""}>Open</option><option value="Completed" ${isEdit && editData.status === "Completed" ? "selected" : ""}>Completed</option></select><div id="sn_date_completed_wrap" style="display:${isEdit && editData.status === "Completed" ? "block" : "none"};"><label ${labelStyle}>Date Completed</label><input id="sn_date_completed" type="text" value="${escapeAttr(isEdit && editData.dateCompleted ? editData.dateCompleted : todayFormatted())}" placeholder="YYYY/MM/DD" disabled style="${largeInput} background:#f0f0f0;"></div><label ${labelStyle}>Photos</label><div id="snagPhotoGalleryV2" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;"></div><label class="icon-upload-label"><i class="fas fa-camera"></i><input type="file" id="sn_photo" accept="image/*" capture="environment" multiple style="display:none"></label><p style="font-size:11px; color:var(--muted); margin-top:4px;"><i class="fas fa-lock"></i> ${isElectronApp ? "Photos are stored with this project." : "Photos sync to this project automatically once you're online."}</p>${isEdit ? `<button class="action-btn" id="sn_delete_btn" style="background:var(--danger); margin-top:10px;">Delete</button>` : ""}`;
    await renderSnagPhotoGalleryV2(uniqueId);
    document.getElementById("sn_photo").onchange = (e) =>
      handleSnagPhotoCapture(e.target.files, uniqueId);
    document.getElementById("sn_status").onchange = (e) => {
      const wrap = document.getElementById("sn_date_completed_wrap");
      if (e.target.value === "Completed") {
        wrap.style.display = "block";
        const inp = document.getElementById("sn_date_completed");
        if (!inp.value) inp.value = todayFormatted();
      } else {
        wrap.style.display = "none";
      }
    };
    if (isEdit) {
      const snagDeleteBtn = document.getElementById("sn_delete_btn");
      snagDeleteBtn.onclick = () => {
        if (!confirm("Delete this snag? Any photos attached to it will be permanently deleted too — this can't be undone.")) return;
        snagDeleteBtn.disabled = true;
        snagDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        callApi("deleteSnag", { snagId: uniqueId })
          .then(async () => {
            try {
              const all = await phGetAllMeta();
              const photos = all.filter((m) => m.linkedSnagId === uniqueId);
              for (const p of photos) {
                await callApi("deletePhoto", { photoId: p.photoId }).catch((e) => console.warn(e));
                await phDeleteMetaRow(p.photoId);
                await phDeleteBlobRow(p.photoId);
              }
            } catch (e) {
              console.warn(e);
            }
            closeModal();
            loadSnagsListings(true);
          })
          .catch((err) => {
            alert("Could not delete snag: " + (err && err.message ? err.message : "Unknown error"));
            snagDeleteBtn.disabled = false;
            snagDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
          });
      };
    }
    submit.onclick = async () => {
      if (!document.getElementById("sn_notes").value.trim()) {
        alert("Enter snag notes");
        return;
      }
      submit.disabled = true;
      submit.innerText = "Saving...";
      const status = document.getElementById("sn_status").value;
      const payload = {
        snagId: uniqueId,
        projectId: getCurrentProjectId(),
        notes: document.getElementById("sn_notes").value,
        assigned: document.getElementById("sn_assigned").value,
        dateLogged: isEdit ? editData.dateLogged : todayFormatted(),
        dateCompleted:
          status === "Completed"
            ? document.getElementById("sn_date_completed").value
            : "",
        status: status,
      };
      // Photos save to local storage as soon as they're captured (and
      // sync to desktop in the background), so there's nothing photo
      // related left to persist here.
      callApi(isEdit ? "updateSnag" : "saveSnag", payload)
        .then(() => {
          closeModal();
          loadSnagsListings(true);
        })
        .catch(resetSubmitOnError(submit));
    };
  } else if (type === "payment") {
    title.innerText = isEdit ? "Edit Payment" : "New Payment";
    if (isEdit && editData.attachments)
      currentModalFiles = splitAttachments(editData.attachments);
    let vendors = getCache().vendors || [];
    if (!vendors.length) {
      try {
        const fetched = await callApi("getVendors", {});
        const cache = getCache();
        cache.vendors = fetched || [];
        setCache(cache);
        vendors = cache.vendors;
      } catch (e) {
        console.warn("Could not load vendors for payment modal:", e);
      }
    }
    vendors = vendors.filter(
      (v) => (isEdit && v.company === editData.payee) || !(String(v.archived).toLowerCase() === "yes" || v.archived === true),
    );
    const projects = getCache().projects || [];
    const currentDir = isEdit
      ? paymentDirectionOf(editData)
      : "Outgoing Payment";
    const isAddStage = isEdit && editData._addStage === true;
    const isEditStage = isEdit && !isAddStage && editData.stage;
    const isSmallExpense = currentDir === "Small Expense";
    let groupData = null;
    if ((isEditStage || isAddStage) && editData.paymentGroupId)
      groupData = getPaymentGroupData(
        editData.paymentGroupId,
        editData.paymentId,
      );
    function payeeFieldHtml(direction) {
      const currentPayee = isEdit ? editData.payee : "";
      if (direction === "Outgoing Payment") {
        const matchesCurrentVendor = vendors.some((v) => v.company === currentPayee);
        const legacyOption = currentPayee && !matchesCurrentVendor
          ? `<option value="${escapeAttr(currentPayee)}" selected>${escapeHtml(currentPayee)} (renamed or archived)</option>`
          : "";
        return `<select id="pay_payee" ${largeInput} onchange="window.recalcPaymentBalance()">
<option value="">-- Select Vendor --</option>
${legacyOption}
${vendors.map((v) => `<option value="${escapeAttr(v.company)}" ${currentPayee === v.company ? "selected" : ""}>${escapeHtml(v.company)}</option>`).join("")}
</select>`;
      } else if (direction === "Client Receipt") {
        const matchesCurrentProject = projects.some((p) => p.clientName === currentPayee);
        const legacyOption = currentPayee && !matchesCurrentProject
          ? `<option value="${escapeAttr(currentPayee)}" selected>${escapeHtml(currentPayee)} (renamed)</option>`
          : "";
        return `<select id="pay_payee" ${largeInput} onchange="window.recalcPaymentBalance()">
<option value="">-- Select Project --</option>
${legacyOption}
${projects.map((p) => `<option value="${escapeAttr(p.clientName)}" data-project-id="${escapeAttr(p.projectId)}" ${currentPayee === p.clientName ? "selected" : ""}>${escapeHtml(p.clientName)} (${escapeHtml(p.displayNumber || p.projectId)})</option>`).join("")}
</select>`;
      } else
        return `<input id="pay_payee" value="${escapeAttr(currentPayee)}" placeholder="Describe the expense" ${largeInput} onchange="window.recalcPaymentBalance()">`;
    }
    let stageOptions = "";
    if (isSmallExpense)
      stageOptions = `<option value="" selected>Full Payment</option>`;
    else if (isAddStage && groupData) {
      const nextStage = groupData.stages.length + 1;
      stageOptions = `<option value="${nextStage}" selected>Stage ${nextStage}</option>`;
    } else if (isEditStage)
      stageOptions = `<option value="${editData.stage}" selected>Stage ${editData.stage}</option>`;
    else stageOptions = `<option value="1" selected>Stage 1</option>`;
    const totalInvoiceEditable =
      !isEdit || (!isEditStage && !isAddStage) || isSmallExpense;
    const totalInvoiceValue = isEdit
      ? editData.totalInvoice || editData.amount || 0
      : isSmallExpense
        ? ""
        : "";
    body.innerHTML = `<label ${labelStyle}>ID</label><input value="${isEdit ? editData.paymentId || "Auto-generated" : "Auto-generated"}" disabled style="${largeInput} background:#f0f0f0;"><input type="hidden" id="pay_id_hidden" value="${escapeAttr(isEdit ? editData.paymentId : "")}"><input type="hidden" id="pay_group_id" value="${escapeAttr(isEdit && editData.paymentGroupId ? editData.paymentGroupId : "")}"><label ${labelStyle}>Date</label><input id="pay_date" type="date" value="${escapeAttr(isEdit && editData.paymentDate ? String(editData.paymentDate).slice(0, 10) : new Date().toISOString().slice(0, 10))}" ${largeInput}><label ${labelStyle}>Direction</label><select id="pay_dir" ${largeInput} onchange="window.onPaymentDirectionChange()">
<option value="Client Receipt" ${currentDir === "Client Receipt" ? "selected" : ""}>Client Receipt</option>
<option value="Outgoing Payment" ${currentDir === "Outgoing Payment" ? "selected" : ""}>Outgoing Payment</option>
<option value="Small Expense" ${currentDir === "Small Expense" ? "selected" : ""}>Small Expense</option>
</select><label ${labelStyle}>Payee</label><div id="pay_payee_wrap">${payeeFieldHtml(currentDir)}</div><label ${labelStyle}>Category</label><select id="pay_cat" ${largeInput}><option value="">--</option><option value="Labour" ${isEdit && editData.expenseCategory === "Labour" ? "selected" : ""}>Labour</option><option value="Materials" ${isEdit && editData.expenseCategory === "Materials" ? "selected" : ""}>Materials</option><option value="Subcontractor Cost" ${isEdit && editData.expenseCategory === "Subcontractor Cost" ? "selected" : ""}>Subcontractor Cost</option><option value="Professional Fees" ${isEdit && editData.expenseCategory === "Professional Fees" ? "selected" : ""}>Professional Fees</option><option value="Transport" ${isEdit && editData.expenseCategory === "Transport" ? "selected" : ""}>Transport</option><option value="Misc" ${isEdit && editData.expenseCategory === "Misc" ? "selected" : ""}>Misc</option></select><label ${labelStyle}>Total Invoice (₦)</label><input id="pay_total_invoice" type="number" step="0.01" value="${escapeAttr(totalInvoiceValue)}" ${totalInvoiceEditable ? largeInput : largeInput + ' style="' + largeInput.split('style="')[1].split('"')[0] + '; background:#f0f0f0;"'} ${totalInvoiceEditable ? "" : "disabled"} oninput="window.recalcPaymentBalance()"><div id="pay_staging_wrap" style="display:${isSmallExpense ? "none" : "block"};"><div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-light); padding:12px; border-radius:12px; margin-top:8px; border:1.5px solid var(--border);"><span style="font-weight:700; font-size:13px;">Payments to Date</span><span id="pay_payments_to_date" style="font-weight:900; font-size:18px; color:var(--muted);">₦0.00</span></div><div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-light); padding:12px; border-radius:12px; margin-top:8px; border:1.5px solid var(--border);"><span style="font-weight:700; font-size:13px;">${currentDir === "Client Receipt" ? "Outstanding Balance" : "Balance"}</span><span id="pay_balance" style="font-weight:900; font-size:18px; color:var(--primary);">₦0.00</span></div><div style="border-top: 2px solid var(--border); margin: 16px 0;"></div><label ${labelStyle}>Stage</label><select id="pay_stage" ${largeInput}>${stageOptions}</select></div><label ${labelStyle}>${isSmallExpense ? "Amount" : "Stage Amount"} (₦)</label><input id="pay_amount" type="number" step="0.01" value="${escapeAttr(isEdit ? editData.amount : "")}" ${largeInput} oninput="window.validateStageAmount()"><p id="pay_amount_hint" style="font-size:12px; color:var(--muted); margin-top:4px; display:none;"></p><label ${labelStyle}>Method</label><select id="pay_method" ${largeInput}><option value="Cash" ${isEdit && editData.paymentMethod === "Cash" ? "selected" : ""}>Cash</option><option value="Transfer" ${!isEdit || editData.paymentMethod === "Transfer" ? "selected" : ""}>Transfer</option><option value="POS" ${isEdit && editData.paymentMethod === "POS" ? "selected" : ""}>POS</option></select><label ${labelStyle}>Notes</label><textarea id="pay_notes" rows="2" ${largeInput}>${escapeHtml(isEdit ? editData.notes : "")}</textarea><div id="paymentAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div><label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="pay_files" accept="image/*,application/pdf" multiple style="display:none"></label>${
      isElectronApp && isEdit && editData.paymentId && editData.projectId
        ? `<div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
            <strong>Desktop Attachments</strong>
            <div style="font-size:11px; color:var(--muted); margin-bottom:6px;">Saved to disk, renamed to payment number "${escapeHtml(editData.paymentId)}"</div>
            <div style="display:flex; gap:8px; margin:8px 0; flex-wrap:wrap;">
              <button class="action-btn" style="width:auto; padding:8px 14px; font-size:13px;" onclick="window.addPaymentAttachment('${escapeAttr(editData.projectId)}','${escapeAttr(editData.paymentId)}')"><i class="fas fa-paperclip"></i> Add File</button>
              <button class="action-btn" style="width:auto; padding:8px 14px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.openProjectAttachmentsFolder('${escapeAttr(editData.projectId)}','Payments')"><i class="fas fa-folder-open"></i> Open Folder</button>
            </div>
            <div id="payment-attachments-list" style="display:flex; gap:8px; flex-wrap:wrap;"><span style="font-size:12px; color:var(--muted);">Loading...</span></div>
          </div>`
        : ""
    }${isEdit ? `<button type="button" class="action-btn" id="pay_delete_btn" style="background:var(--danger); margin-top:16px;"><i class="fas fa-trash"></i> Delete This Stage</button>` : ""}`;
    if (isEdit) {
      document.getElementById("pay_delete_btn").onclick = () => {
        deletePaymentWithUndo(editData);
      };
    }
    if (isElectronApp && isEdit && editData.paymentId && editData.projectId) {
      refreshPaymentAttachmentsList(editData.projectId, editData.paymentId);
    }
    if (currentModalFiles.length)
      populateModalInlineImageGalleryPreviews("paymentAttachmentsPreviews");
    document.getElementById("pay_files").onchange = (e) =>
      processIncomingMultiAttachments(
        e.target.files,
        "paymentAttachmentsPreviews",
      );
    document.getElementById("pay_dir").onchange = (e) => {
      document.getElementById("pay_payee_wrap").innerHTML = payeeFieldHtml(
        e.target.value,
      );
      window.onPaymentDirectionChange();
    };
    window.recalcPaymentBalance();
    document.getElementById("pay_amount").addEventListener("input", () => {
      if (document.getElementById("pay_dir").value === "Small Expense") {
        const amt = document.getElementById("pay_amount").value;
        document.getElementById("pay_total_invoice").value = amt;
        window.recalcPaymentBalance();
      }
    });
    submit.onclick = () => {
      const direction = document.getElementById("pay_dir").value;
      const isSmall = direction === "Small Expense";
      const totalInvoice = roundMoney(
        Number(document.getElementById("pay_total_invoice").value) || 0,
      );
      if (!isSmall && (!totalInvoice || totalInvoice <= 0)) {
        alert("Enter a valid Total Invoice amount");
        return;
      }
      const payee = document.getElementById("pay_payee").value;
      if (!payee) {
        alert("Select or enter a payee");
        return;
      }
      const stageAmount = roundMoney(
        Number(document.getElementById("pay_amount").value) || 0,
      );
      if (!stageAmount || stageAmount <= 0) {
        alert("Enter a valid payment amount");
        return;
      }
      const stage = isSmall ? "" : document.getElementById("pay_stage").value;
      if (!isSmall && stage) {
        const balanceText = document
          .getElementById("pay_balance")
          .innerText.replace(/[₦,]/g, "");
        const balance = roundMoney(Number(balanceText) || 0);
        if (stageAmount > balance) {
          alert(
            `Stage amount cannot exceed the ${direction === "Client Receipt" ? "Outstanding Balance" : "Balance"} (₦${moneyValue(balance)})`,
          );
          return;
        }
      }
      submit.disabled = true;
      submit.innerText = "Saving...";
      // A brand-new multi-stage payment (no existing group yet) used to
      // invent a fake client-side id here ("PAY-GRP-" + timestamp) and
      // send it as paymentGroupId -- but that column is a real uuid on
      // the server, and a string like that isn't one. The backend
      // already has the correct mechanism for this: send nothing, and
      // it inserts the payment then self-links payment_group_id to its
      // own real generated id. Leaving this empty (not inventing a
      // fake value) is what actually lets that happen.
      let paymentGroupId = document.getElementById("pay_group_id").value;

      // ✅ FIX: distinguish "Add Stage" (new record) from true edit
      const isRealEdit = isEdit && editData.paymentId;

      const payload = {
        paymentId: isRealEdit ? editData.paymentId : "PAY-" + Date.now(),
        projectId: getCurrentProjectId(),
        paymentDate: document.getElementById("pay_date").value || new Date().toISOString().slice(0, 10),
        paymentDirection: direction,
        payee: payee,
        vendorId: direction === "Outgoing Payment"
          ? ((vendors.find((v) => v.company === payee) || {}).vendorId || (isRealEdit && editData.payee === payee ? editData.vendorId : "") || "")
          : "",
        expenseCategory: document.getElementById("pay_cat").value,
        referenceId: "",
        amount: stageAmount,
        totalInvoice: isSmall ? stageAmount : totalInvoice,
        paymentMethod: document.getElementById("pay_method").value,
        status: "",
        stage: stage,
        paymentGroupId:
          paymentGroupId || (isRealEdit ? editData.paymentGroupId : ""),
        notes: document.getElementById("pay_notes").value,
        attachments: normalizeAttachments(currentModalFiles),
      };
      callApi(isRealEdit ? "updatePayment" : "savePayment", payload)
        .then(() => {
          closeModal();
          loadPaymentsListings(true);
        })
        .catch(resetSubmitOnError(submit));
    };
  }
}
