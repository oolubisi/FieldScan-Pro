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
};

function backupKey(action, params) {
  // Scoped so that e.g. getTakeOffs({groupId: A}) and getTakeOffs({groupId: B})
  // never collide in the fallback cache — without this, a genuinely empty
  // response for one group could get silently replaced by cached data
  // belonging to a completely different group (see the "protect against
  // empty responses" guard in callApi). Global, unparameterized actions
  // (getProjects, getVendors, etc.) keep the old plain key.
  const hasParams = params && typeof params === "object" && Object.keys(params).length > 0;
  return hasParams ? `fb_${action}:${JSON.stringify(params)}` : `fb_${action}`;
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
  if (!cfg) return;
  const getAction = GET_ACTION_BY_STORE[cfg.store];
  let current = readBackup(getAction, []);
  const idVal = String(data[cfg.idKey] || "").trim();
  if (cfg.mode === "delete")
    current = current.filter((item) => !idsMatch(item[cfg.idKey], idVal));
  else {
    const idx = current.findIndex((item) => idsMatch(item[cfg.idKey], idVal));
    const record = { ...data, offlinePending: true, lastModified: Date.now() };
    if (idx === -1) current = [record, ...current];
    else current[idx] = { ...current[idx], ...record };
  }
  writeBackup(getAction, current);
  if (cfg.store === "vendors") recomputeLocalStats();
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
  const userEmail = document.getElementById("pref-user-email");
  const userRole = document.getElementById("pref-user-role");
  if (workingFolder)
    workingFolder.value = localStorage.getItem("fieldscan_working_folder") || "";
  if (backendUrl)
    backendUrl.value =
      localStorage.getItem("fieldscan_backend_url") ||
      (typeof DEFAULT_GAS_URL !== "undefined" ? DEFAULT_GAS_URL : "");
  if (userEmail)
    userEmail.value = localStorage.getItem("fieldscan_user_email") || "";
  if (userRole)
    userRole.value = localStorage.getItem("fieldscan_user_role") || "admin";
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

function savePreferences() {
  const workingFolder = document.getElementById("pref-working-folder");
  const backendUrl = document.getElementById("pref-backend-url");
  const userEmail = document.getElementById("pref-user-email");
  const userRole = document.getElementById("pref-user-role");
  if (workingFolder)
    localStorage.setItem("fieldscan_working_folder", workingFolder.value.trim());
  if (backendUrl) {
    const url = backendUrl.value.trim();
    if (url) {
      localStorage.setItem("fieldscan_backend_url", url);
      if (typeof GAS_URL !== "undefined") GAS_URL = url;
    }
  }
  if (userEmail)
    localStorage.setItem("fieldscan_user_email", userEmail.value.trim());
  if (userRole)
    localStorage.setItem("fieldscan_user_role", userRole.value || "admin");
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
