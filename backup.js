// ===== backup.js =====
const GET_ACTION_BY_STORE = {
  projects: "getProjects",
  progressLogs: "getProgressLogs",
  snags: "getSnags",
  vendors: "getVendors",
  workorders: "getWorkOrders",
  payments: "getPayments",
  changeOrders: "getChangeOrders",
  inspections: "getInspections",
  estimates: "getEstimates",
  clients: "getClients",
  boqItems: "getBOQItems",
  units: "getUnits",
  tasks: "getTasks",
  taskGroups: "getTaskGroups",
  takeOffs: "getTakeOffs",
  takeOffGroups: "getTakeOffGroups",
  takeOffTemplates: "getTakeOffTemplates",
  documents: "getDocuments",
  photos: "getPhotos",
  photoLinks: "getPhotoLinks",
};

const MUTATION_MAP = {
  saveProject: { store: "projects", idKey: "projectId", mode: "upsert" },
  updateProject: { store: "projects", idKey: "projectId", mode: "upsert" },
  updateProjectScope: { store: "projects", idKey: "projectId", mode: "upsert" },
  saveProgressLog: { store: "progressLogs", idKey: "logId", mode: "upsert" },
  updateProgressLog: { store: "progressLogs", idKey: "logId", mode: "upsert" }, // ← ADD
  deleteProgressLog: { store: "progressLogs", idKey: "logId", mode: "delete" }, // ← ADD
  saveSnag: { store: "snags", idKey: "snagId", mode: "upsert" },
  updateSnag: { store: "snags", idKey: "snagId", mode: "upsert" },
  deleteSnag: { store: "snags", idKey: "snagId", mode: "delete" },
  saveVendor: { store: "vendors", idKey: "vendorId", mode: "upsert" },
  updateVendor: { store: "vendors", idKey: "vendorId", mode: "upsert" },
  deleteVendor: { store: "vendors", idKey: "vendorId", mode: "delete" },
  saveWorkOrder: { store: "workorders", idKey: "workOrderId", mode: "upsert" },
  updateWorkOrder: {
    store: "workorders",
    idKey: "workOrderId",
    mode: "upsert",
  },
  savePayment: { store: "payments", idKey: "paymentId", mode: "upsert" },
  updatePayment: { store: "payments", idKey: "paymentId", mode: "upsert" },
  saveChangeOrder: { store: "changeOrders", idKey: "changeOrderId", mode: "upsert" },
  updateChangeOrder: { store: "changeOrders", idKey: "changeOrderId", mode: "upsert" },
  deleteChangeOrder: { store: "changeOrders", idKey: "changeOrderId", mode: "delete" },
  saveInspection: { store: "inspections", idKey: "inspectionId", mode: "upsert" },
  updateInspection: { store: "inspections", idKey: "inspectionId", mode: "upsert" },
  deleteInspection: { store: "inspections", idKey: "inspectionId", mode: "delete" },
  saveEstimate: { store: "estimates", idKey: "estimateId", mode: "upsert" },
  updateEstimate: { store: "estimates", idKey: "estimateId", mode: "upsert" },
  deleteEstimate: { store: "estimates", idKey: "estimateId", mode: "delete" },
  saveClient: { store: "clients", idKey: "clientId", mode: "upsert" },
  updateClient: { store: "clients", idKey: "clientId", mode: "upsert" },
  deleteClient: { store: "clients", idKey: "clientId", mode: "delete" },
  saveBOQItem: { store: "boqItems", idKey: "boqItemId", mode: "upsert" },
  updateBOQItem: { store: "boqItems", idKey: "boqItemId", mode: "upsert" },
  deleteBOQItem: { store: "boqItems", idKey: "boqItemId", mode: "delete" },
  saveUnit: { store: "units", idKey: "unitId", mode: "upsert" },
  deleteUnit: { store: "units", idKey: "unitId", mode: "delete" },
  // Below: added for full offline-first coverage. Each one is called via
  // a direct `await callApi(...)` somewhere in the app (not runInBackground,
  // which manages its own optimistic updates independently and doesn't
  // need an entry here -- see the comment on applyLocalMutation).
  saveTask: { store: "tasks", idKey: "taskId", mode: "upsert" },
  updateTask: { store: "tasks", idKey: "taskId", mode: "upsert" },
  deleteTask: { store: "tasks", idKey: "taskId", mode: "delete" },
  saveTaskGroup: { store: "taskGroups", idKey: "groupId", mode: "upsert" },
  updateTaskGroup: { store: "taskGroups", idKey: "groupId", mode: "upsert" },
  deleteTaskGroup: { store: "taskGroups", idKey: "groupId", mode: "delete" },
  saveTakeOff: { store: "takeOffs", idKey: "takeOffId", mode: "upsert" },
  updateTakeOff: { store: "takeOffs", idKey: "takeOffId", mode: "upsert" },
  deleteTakeOff: { store: "takeOffs", idKey: "takeOffId", mode: "delete" },
  saveTakeOffGroup: { store: "takeOffGroups", idKey: "groupId", mode: "upsert" },
  updateTakeOffGroup: { store: "takeOffGroups", idKey: "groupId", mode: "upsert" },
  deleteTakeOffGroup: { store: "takeOffGroups", idKey: "groupId", mode: "delete" },
  saveTakeOffTemplate: { store: "takeOffTemplates", idKey: "templateId", mode: "upsert" },
  deleteTakeOffTemplate: { store: "takeOffTemplates", idKey: "templateId", mode: "delete" },
  saveDocument: { store: "documents", idKey: "documentId", mode: "upsert" },
  updateDocumentMetadata: { store: "documents", idKey: "documentId", mode: "upsert" },
  deleteDocument: { store: "documents", idKey: "documentId", mode: "delete" },
  savePhoto: { store: "photos", idKey: "photoId", mode: "upsert" },
  updatePhotoComment: { store: "photos", idKey: "photoId", mode: "upsert" },
  updatePhotoMeta: { store: "photos", idKey: "photoId", mode: "upsert" },
  deletePhoto: { store: "photos", idKey: "photoId", mode: "delete" },
  savePhotoLink: { store: "photoLinks", idKey: "linkId", mode: "upsert" },
  deletePhotoLink: { store: "photoLinks", idKey: "linkId", mode: "delete" },
  deletePayment: { store: "payments", idKey: "paymentId", mode: "delete" },
};

function backupKey(action, params) {
  // Scoped so that e.g. getTakeOffs({groupId: A}) and getTakeOffs({groupId: B})
  // never collide in the fallback cache — without this, a genuinely empty
  // response for one group could get silently replaced by cached data
  // belonging to a completely different group (see the "protect against
  // empty responses" guard in callApi). Global, unparameterized actions
  // (getProjects, getVendors, etc.) keep the old plain key.
  //
  // Also namespaced by which ACCOUNT is currently active. Without this,
  // switching between two companies on the same device would need to
  // either wipe the whole cache (safe, but means offline switching shows
  // an empty app until network returns -- exactly the wrong experience)
  // or risk one company's cached data staying visible after switching
  // to another. Namespacing avoids the tradeoff entirely: each account's
  // cache is a genuinely separate set of keys, so switching just makes a
  // different, already-correct set of keys become the active ones --
  // nothing to clear, and each account's own previously-synced data is
  // there waiting for it, online or off.
  const email = (localStorage.getItem("fieldscan_user_email") || "").toLowerCase().trim();
  const hasParams = params && typeof params === "object" && Object.keys(params).length > 0;
  return hasParams
    ? `fb_${email}__${action}:${JSON.stringify(params)}`
    : `fb_${email}__${action}`;
}
function readBackup(action, fallback = [], params) {
  const raw = localStorage.getItem(backupKey(action, params));
  return raw ? JSON.parse(raw) : fallback;
}
function writeBackup(action, value, params) {
  try {
    localStorage.setItem(backupKey(action, params), JSON.stringify(value));
  } catch (err) {
    console.error("writeBackup failed:", action, err);
    if (err && err.name === "QuotaExceededError")
      alert("⚠️ Local storage is full. Try syncing and clearing attachments.");
  }
}

function recomputeLocalStats() {
  const vendors = readBackup("getVendors", []);
  writeBackup("getStats", {
    activeVendors: vendors.filter((v) => v.archived !== "Yes").length,
  });
}

function applyLocalMutation(action, data) {
  const cfg = MUTATION_MAP[action];
  if (!cfg) return null;
  const getAction = GET_ACTION_BY_STORE[cfg.store];
  let current = readBackup(getAction, []);
  let idVal = String(data[cfg.idKey] || "").trim();
  if (cfg.mode === "delete") {
    current = current.filter((item) => !idsMatch(item[cfg.idKey], idVal));
    writeBackup(getAction, current);
    if (cfg.store === "vendors") recomputeLocalStats();
    return null;
  }
  // A brand-new item (create, not update) has no server-issued id yet --
  // the server generates it once the queued request actually syncs.
  // Without a stable per-item id here, every offline create in the same
  // session would share the same empty idVal, and each new one would
  // silently overwrite the previous one's local record instead of
  // adding a new one. A temp id keeps them distinct until the real
  // sync reconciles it with the server's actual id -- and is handed
  // back to callApi() below so it can be echoed into the response,
  // letting the calling page code keep working (e.g. showing/opening
  // the new item) exactly as if the save had succeeded normally.
  const isNew = !idVal;
  if (isNew) {
    idVal = "temp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    data = { ...data, [cfg.idKey]: idVal };
  }
  const record = { ...data, offlinePending: true, lastModified: Date.now() };
  const idx = current.findIndex((item) => idsMatch(item[cfg.idKey], idVal));
  if (idx === -1) current = [record, ...current];
  else current[idx] = { ...current[idx], ...record };
  writeBackup(getAction, current);
  if (cfg.store === "vendors") recomputeLocalStats();
  return isNew ? { idKey: cfg.idKey, idVal } : null;
}

function fieldScanLocalKeys() {
  return Object.keys(localStorage).filter(
    (key) =>
      key.startsWith("fb_") ||
      key.startsWith("fieldscan_") ||
      key.startsWith("project_attachments_"),
  );
}

function loadSettingsView() {
  const workingFolder = document.getElementById("pref-working-folder");
  const backendUrl = document.getElementById("pref-backend-url");
  if (workingFolder)
    workingFolder.value = localStorage.getItem("fieldscan_working_folder") || "";
  if (backendUrl)
    backendUrl.value =
      localStorage.getItem("fieldscan_backend_url") ||
      (typeof DEFAULT_GAS_URL !== "undefined" ? DEFAULT_GAS_URL : "");
  renderBackupSummary();
  populatePaymentDetailsSettings();
  populateMySignatureSettings();
}

async function populatePaymentDetailsSettings() {
  const bankNameEl = document.getElementById("settings-bank-name");
  const accountNameEl = document.getElementById("settings-account-name");
  const accountNumberEl = document.getElementById("settings-account-number");
  if (!bankNameEl && !accountNameEl && !accountNumberEl) return;

  let cache = getCache();
  let settings = cache.settings && cache.settings.data ? cache.settings.data : cache.settings || {};
  if (!settings || Object.keys(settings).length === 0) {
    try {
      const resp = await callApi("getSettings", {});
      cache = getCache();
      cache.settings = resp || {};
      setCache(cache);
      settings = resp && resp.data ? resp.data : resp || {};
    } catch (e) {}
  }
  if (bankNameEl) bankNameEl.value = settings.Bank_Name || "";
  if (accountNameEl) accountNameEl.value = settings.Account_Name || "";
  if (accountNumberEl) accountNumberEl.value = settings.Account_Number || "";
}

// ===== My Signature (per-user, not company-wide -- see profile.js on the backend) =====

let mySignatureImageData = ""; // holds the currently-selected (possibly unsaved) signature image as a data URI

async function populateMySignatureSettings() {
  const nameEl = document.getElementById("my-signature-name");
  const previewEl = document.getElementById("my-signature-preview");
  if (!nameEl && !previewEl) return;
  try {
    const resp = await callApi("getMyProfile", {});
    if (resp && resp.success) {
      if (nameEl) nameEl.value = resp.signatureName || "";
      mySignatureImageData = resp.signatureImage || "";
      if (previewEl) {
        if (mySignatureImageData) {
          previewEl.src = mySignatureImageData;
          previewEl.style.display = "inline-block";
        } else {
          previewEl.style.display = "none";
        }
      }
    }
  } catch (e) {
    console.error("populateMySignatureSettings failed", e);
  }
}

function toggleMySignatureEdit() {
  const nameEl = document.getElementById("my-signature-name");
  const uploadLabel = document.getElementById("my-signature-upload-label");
  const saveBtn = document.getElementById("my-signature-save-btn");
  const editBtn = document.getElementById("my-signature-edit-btn");
  const nowEditing = nameEl.disabled; // currently locked -> unlock

  nameEl.disabled = !nowEditing;
  if (uploadLabel) uploadLabel.style.display = nowEditing ? "inline-flex" : "none";
  if (saveBtn) saveBtn.style.display = nowEditing ? "block" : "none";
  if (editBtn) editBtn.innerHTML = nowEditing ? '<i class="fas fa-xmark"></i> Cancel' : '<i class="fas fa-pen"></i> Edit';
  if (nowEditing) nameEl.focus();
  if (!nowEditing) populateMySignatureSettings(); // cancel -> discard any unsaved edits (including a chosen-but-unsaved image)
}
window.toggleMySignatureEdit = toggleMySignatureEdit;

function lockMySignatureFields() {
  const nameEl = document.getElementById("my-signature-name");
  const uploadLabel = document.getElementById("my-signature-upload-label");
  const saveBtn = document.getElementById("my-signature-save-btn");
  const editBtn = document.getElementById("my-signature-edit-btn");
  if (nameEl) nameEl.disabled = true;
  if (uploadLabel) uploadLabel.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";
  if (editBtn) editBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
}

// Same compression approach already used for other image uploads in the
// app (see modals.js's processIncomingMultiAttachments) -- keeps the
// signature small enough to store as a plain data URI on the users row,
// no Storage upload needed for something this small.
async function handleMySignatureFileSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const compressed = await compressImageToTargetLimit(ev.target.result, 190000);
      mySignatureImageData = compressed;
      const previewEl = document.getElementById("my-signature-preview");
      if (previewEl) {
        previewEl.src = compressed;
        previewEl.style.display = "inline-block";
      }
    } catch (err) {
      alert("⚠️ " + (err.message || "Failed to process image."));
    }
  };
  reader.readAsDataURL(file);
}
window.handleMySignatureFileSelect = handleMySignatureFileSelect;

function saveMySignatureSettings() {
  const nameEl = document.getElementById("my-signature-name");
  const btn = document.getElementById("my-signature-save-btn");
  const signatureName = nameEl ? nameEl.value.trim() : "";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }

  callApi("updateMySignature", { signatureImage: mySignatureImageData, signatureName })
    .then(function () {
      lockMySignatureFields();
      // Documents generated later in this session should pick up the
      // change immediately, not just after a restart.
      if (typeof invalidateMyProfileCache === "function") invalidateMyProfileCache();
      if (typeof showSyncToast === "function") showSyncToast("✅ Signature saved");
    })
    .catch(function (e) {
      alert("Failed to save: " + (e.message || "Unknown error"));
    })
    .finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save My Signature';
      }
    });
}
window.saveMySignatureSettings = saveMySignatureSettings;

function togglePaymentDetailsEdit() {
  const bankNameEl = document.getElementById("settings-bank-name");
  const accountNameEl = document.getElementById("settings-account-name");
  const accountNumberEl = document.getElementById("settings-account-number");
  const saveBtn = document.getElementById("payment-details-save-btn");
  const editBtn = document.getElementById("payment-details-edit-btn");
  const nowEditing = bankNameEl.disabled; // currently locked -> unlock

  [bankNameEl, accountNameEl, accountNumberEl].forEach((el) => {
    if (el) el.disabled = !nowEditing;
  });
  if (saveBtn) saveBtn.style.display = nowEditing ? "block" : "none";
  if (editBtn) editBtn.innerHTML = nowEditing ? '<i class="fas fa-xmark"></i> Cancel' : '<i class="fas fa-pen"></i> Edit';
  if (nowEditing && bankNameEl) bankNameEl.focus();
  if (!nowEditing) populatePaymentDetailsSettings(); // cancel -> discard any unsaved edits
}
window.togglePaymentDetailsEdit = togglePaymentDetailsEdit;

function lockPaymentDetailsFields() {
  const bankNameEl = document.getElementById("settings-bank-name");
  const accountNameEl = document.getElementById("settings-account-name");
  const accountNumberEl = document.getElementById("settings-account-number");
  const saveBtn = document.getElementById("payment-details-save-btn");
  const editBtn = document.getElementById("payment-details-edit-btn");
  [bankNameEl, accountNameEl, accountNumberEl].forEach((el) => {
    if (el) el.disabled = true;
  });
  if (saveBtn) saveBtn.style.display = "none";
  if (editBtn) editBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
}

function savePaymentDetailsSettings() {
  const bankName = document.getElementById("settings-bank-name").value.trim();
  const accountName = document.getElementById("settings-account-name").value.trim();
  const accountNumber = document.getElementById("settings-account-number").value.trim();
  const btn = document.getElementById("payment-details-save-btn");

  if (accountNumber && !/^\d{10}$/.test(accountNumber)) {
    alert("Account Number must be exactly 10 digits.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }

  Promise.all([
    callApi("updateSetting", { key: "Bank_Name", value: bankName }),
    callApi("updateSetting", { key: "Account_Name", value: accountName }),
    callApi("updateSetting", { key: "Account_Number", value: accountNumber }),
  ])
    .then(function () {
      const cache = getCache();
      cache.settings = cache.settings || {};
      const target = cache.settings.data ? cache.settings.data : cache.settings;
      target.Bank_Name = bankName;
      target.Account_Name = accountName;
      target.Account_Number = accountNumber;
      setCache(cache);
      lockPaymentDetailsFields();
      if (typeof showSyncToast === "function") showSyncToast("✅ Payment details saved");
    })
    .catch(function (e) {
      alert("Failed to save: " + (e.message || "Unknown error"));
    })
    .finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Payment Details';
      }
    });
}

async function runPaymentVendorBackfill() {
  const btn = document.getElementById("backfill-vendor-links-btn");
  const resultEl = document.getElementById("backfill-vendor-links-result");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Linking...';
  }
  if (resultEl) resultEl.innerText = "";
  try {
    const resp = await callApi("backfillPaymentVendorIds", {});
    if (resultEl) {
      resultEl.innerText =
        "Linked " + resp.matched + " payment(s). " +
        resp.alreadyLinked + " were already linked. " +
        resp.unmatched + " could not be matched (vendor likely renamed before this ran).";
    }
    if (typeof showSyncToast === "function") showSyncToast("✅ Payment links updated");
  } catch (e) {
    if (resultEl) resultEl.innerText = "Failed: " + (e.message || "Unknown error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-link"></i> Link Existing Payments to Vendors';
    }
  }
}
window.runPaymentVendorBackfill = runPaymentVendorBackfill;

async function runPaymentPayeeNameSync() {
  const btn = document.getElementById("sync-payee-names-btn");
  const resultEl = document.getElementById("sync-payee-names-result");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
  }
  if (resultEl) resultEl.innerText = "";
  try {
    const resp = await callApi("syncPaymentPayeeNames", {});
    if (resultEl) {
      resultEl.innerText = "Updated " + resp.updated + " payment(s) to match their vendor's current name.";
    }
    if (typeof showSyncToast === "function") showSyncToast("✅ Payee names synced");
  } catch (e) {
    if (resultEl) resultEl.innerText = "Failed: " + (e.message || "Unknown error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-arrows-rotate"></i> Sync Payee Names to Current Vendor Names';
    }
  }
}
window.runPaymentPayeeNameSync = runPaymentPayeeNameSync;

function savePreferences() {
  const workingFolder = document.getElementById("pref-working-folder");
  const backendUrl = document.getElementById("pref-backend-url");
  if (workingFolder)
    localStorage.setItem("fieldscan_working_folder", workingFolder.value.trim());
  if (backendUrl) {
    const url = backendUrl.value.trim();
    if (url) {
      localStorage.setItem("fieldscan_backend_url", url);
      if (typeof GAS_URL !== "undefined") GAS_URL = url;
    }
  }
  showSyncToast("✅ Preferences saved");
  renderBackupSummary();
}

function renderBackupSummary() {
  const el = document.getElementById("backup-summary");
  if (!el) return;
  const keys = fieldScanLocalKeys();
  const bytes = keys.reduce(
    (sum, key) => sum + key.length + (localStorage.getItem(key) || "").length,
    0,
  );
  el.textContent = `${keys.length} local item(s), approximately ${Math.round(bytes / 1024)} KB stored on this device.`;
}

function exportFieldScanBackup() {
  const data = {};
  fieldScanLocalKeys().forEach((key) => {
    data[key] = localStorage.getItem(key);
  });
  const payload = {
    app: "FieldScan Pro",
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fieldscan-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function restoreFieldScanBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = payload && payload.data ? payload.data : payload;
    if (!data || typeof data !== "object") throw new Error("Invalid backup");
    Object.entries(data).forEach(([key, value]) => {
      if (
        key.startsWith("fb_") ||
        key.startsWith("fieldscan_") ||
        key.startsWith("project_attachments_")
      ) {
        localStorage.setItem(key, String(value ?? ""));
      }
    });
    if (localStorage.getItem("fieldscan_backend_url"))
      GAS_URL = localStorage.getItem("fieldscan_backend_url");
    showSyncToast("✅ Backup restored");
    seedRestoredCacheFromBackups();
    renderBackupSummary();
    refreshMasterDashboard();
  } catch (err) {
    alert("Restore failed: " + (err.message || "Invalid file"));
  }
}

function clearFieldScanBackups() {
  if (!confirm("Clear local backups and desktop-only attachments from this device?"))
    return;
  fieldScanLocalKeys()
    .filter((key) => key.startsWith("fb_") || key.startsWith("project_attachments_"))
    .forEach((key) => localStorage.removeItem(key));
  renderBackupSummary();
  showSyncToast("✅ Local backups cleared");
}

function seedRestoredCacheFromBackups() {
  const c = getCache();
  Object.entries(GET_ACTION_BY_STORE).forEach(([store, action]) => {
    c[store] = readBackup(action, c[store] || []);
  });
  c.settings = readBackup("getSettings", c.settings || {});
  setCache(c);
}

// ===== Company Details dialog =====
// A modal (not an inline Settings section, per request) covering the
// letterhead fields every generated document actually reads: Name,
// Logo, Address, Phone1/2, Email, TIN, VAT registration number, Slogan,
// Registration number. Backed by the same updateSetting action as
// everything else in Settings -- these just happen to be brand-new keys.

let companyDetailsLogoData = ""; // holds the currently-selected (possibly unsaved) logo as a data URI

function openCompanyDetailsDialog() {
  if (document.getElementById("company-details-dialog")) return; // already open

  const cache = getCache();
  const settings = cache.settings && cache.settings.data ? cache.settings.data : cache.settings || {};
  companyDetailsLogoData = settings.Logo || "";
  const logoSizeFactorValue = Number(settings.LogoSizeFactor) > 0 ? Number(settings.LogoSizeFactor) : 1.0;

  const overlay = document.createElement("div");
  overlay.id = "company-details-dialog";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.5);" +
    "display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;";

  const fieldDef = [
    ["cd-name", "Company Name", settings.CompanyName || "", "text"],
    ["cd-slogan", "Slogan", settings.CompanySlogan || "", "text"],
    ["cd-address", "Address", settings.CompanyAddress || "", "textarea"],
    ["cd-phone1", "Phone 1", settings.CompanyPhone1 || "", "text"],
    ["cd-phone2", "Phone 2", settings.CompanyPhone2 || "", "text"],
    ["cd-email", "Email", settings.CompanyEmail || "", "email"],
    ["cd-tin", "TIN", settings.CompanyTIN || "", "text"],
    ["cd-vat-number", "VAT Registration Number", settings.CompanyVatNumber || "", "text"],
    ["cd-reg-number", "Registration Number", settings.CompanyRegistrationNumber || "", "text"],
  ];

  const fieldsHtml = fieldDef.map(([id, label, value, type]) => {
    const escapedValue = escapeAttr(value);
    const input = type === "textarea"
      ? `<textarea id="${id}" rows="2" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1.5px solid var(--border,#ccc);font-size:13px;font-family:inherit;">${escapeHtml(value)}</textarea>`
      : `<input id="${id}" type="${type}" value="${escapedValue}" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1.5px solid var(--border,#ccc);font-size:13px;">`;
    return `<div style="margin-bottom:10px;"><label style="display:block;font-size:12px;font-weight:700;margin-bottom:3px;">${escapeHtml(label)}</label>${input}</div>`;
  }).join("");

  const box = document.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:12px;padding:22px;max-width:440px;width:100%;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.3);max-height:90vh;overflow:auto;";

  box.innerHTML = `
    <h3 style="margin:0 0 16px 0;">Company Details</h3>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;">Logo</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <img id="cd-logo-preview" src="${companyDetailsLogoData ? escapeAttr(companyDetailsLogoData) : ""}" style="max-height:50px;max-width:130px;object-fit:contain;border:1px solid var(--border,#ccc);border-radius:6px;padding:2px;background:#fff;${companyDetailsLogoData ? "" : "display:none;"}">
        <label class="action-btn" style="width:auto;padding:6px 14px;font-size:12px;cursor:pointer;background:var(--card-light,#f1f5f9);color:var(--text,#333);">
          <i class="fas fa-upload"></i> Choose Logo
          <input id="cd-logo-file-input" type="file" accept="image/*" style="display:none;" onchange="window.handleCompanyDetailsLogoSelect(this.files[0])">
        </label>
        <div style="display:flex;align-items:center;gap:6px;">
          <label for="cd-logo-size-factor" style="font-size:11px;color:var(--muted,#666);white-space:nowrap;">Size ×</label>
          <input id="cd-logo-size-factor" type="number" min="0.1" max="3.0" step="0.1" value="${escapeAttr(String(logoSizeFactorValue))}" style="width:64px;padding:6px;border-radius:6px;border:1.5px solid var(--border,#ccc);font-size:12px;">
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted,#666);margin:4px 0 0 0;">Scales the logo up or down on every printed document. 1.0 is the original size.</p>
    </div>
    ${fieldsHtml}
    <div id="company-details-error" style="color:#b91c1c;font-size:12px;display:none;margin-bottom:10px;"></div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button type="button" id="company-details-cancel" style="flex:1;padding:10px;border-radius:8px;border:none;background:#f1f5f9;color:#334155;font-weight:600;cursor:pointer;">Cancel</button>
      <button type="button" id="company-details-save" style="flex:1;padding:10px;border-radius:8px;border:none;background:#111827;color:#fff;font-weight:700;cursor:pointer;">Save</button>
    </div>
  `;

  overlay.appendChild(box);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  document.getElementById("company-details-cancel").onclick = () => overlay.remove();
  document.getElementById("company-details-save").onclick = saveCompanyDetails;
}
window.openCompanyDetailsDialog = openCompanyDetailsDialog;

async function handleCompanyDetailsLogoSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const compressed = await compressImageToTargetLimit(ev.target.result, 190000);
      companyDetailsLogoData = compressed;
      const previewEl = document.getElementById("cd-logo-preview");
      if (previewEl) {
        previewEl.src = compressed;
        previewEl.style.display = "inline-block";
      }
    } catch (err) {
      alert("⚠️ " + (err.message || "Failed to process image."));
    }
  };
  reader.readAsDataURL(file);
}
window.handleCompanyDetailsLogoSelect = handleCompanyDetailsLogoSelect;

async function saveCompanyDetails() {
  const saveBtn = document.getElementById("company-details-save");
  const errorEl = document.getElementById("company-details-error");
  errorEl.style.display = "none";
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const logoSizeFactorInput = Number(document.getElementById("cd-logo-size-factor").value);
  const fieldsToSave = [
    ["Logo", companyDetailsLogoData],
    ["LogoSizeFactor", logoSizeFactorInput > 0 ? logoSizeFactorInput : 1.0],
    ["CompanyName", document.getElementById("cd-name").value.trim()],
    ["CompanySlogan", document.getElementById("cd-slogan").value.trim()],
    ["CompanyAddress", document.getElementById("cd-address").value.trim()],
    ["CompanyPhone1", document.getElementById("cd-phone1").value.trim()],
    ["CompanyPhone2", document.getElementById("cd-phone2").value.trim()],
    ["CompanyEmail", document.getElementById("cd-email").value.trim()],
    ["CompanyTIN", document.getElementById("cd-tin").value.trim()],
    ["CompanyVatNumber", document.getElementById("cd-vat-number").value.trim()],
    ["CompanyRegistrationNumber", document.getElementById("cd-reg-number").value.trim()],
  ];

  try {
    // Sequential, not Promise.all -- these all write to the same
    // company_settings row; firing them concurrently risks a lost
    // update if two requests race on the same row (last-write-wins
    // per-column is fine, but there's no reason to risk it for what's
    // a one-time save, not a hot path).
    for (const [key, value] of fieldsToSave) {
      await callApi("updateSetting", { key, value });
    }
    const cache = getCache();
    if (!cache.settings) cache.settings = {};
    if (!cache.settings.data) cache.settings.data = {};
    for (const [key, value] of fieldsToSave) cache.settings.data[key] = value;
    setCache(cache);
    if (typeof writeBackup === "function") writeBackup("getSettings", cache.settings, {});
    if (typeof applyCompanyNameToSidebar === "function") applyCompanyNameToSidebar();

    document.getElementById("company-details-dialog").remove();
    if (typeof showSyncToast === "function") showSyncToast("✅ Company details saved");
  } catch (e) {
    errorEl.textContent = e.message || "Failed to save company details";
    errorEl.style.display = "block";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}
window.saveCompanyDetails = saveCompanyDetails;
