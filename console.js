// ===== console.js =====
async function loadProjectConsoleHub(projectId) {
  setCurrentProjectId(projectId);
  woSelectedIds = new Set();
  paymentSelectedIds = new Set();
  const cache = getCache();
  const proj = cache.projects.find((p) => p.projectId === projectId);
  if (!proj) return;
  document.getElementById("console-title-text").innerText = proj.displayNumber || proj.projectId;
  document.getElementById("c-meta-name").innerText = proj.clientName;
  document.getElementById("c-meta-loc").innerText = proj.siteLocation;
  document.getElementById("c-meta-phone").innerHTML =
    proj.clientPhone || "No phone";
  document.getElementById("c-meta-phone").href = proj.clientPhone
    ? "tel:" + proj.clientPhone
    : "#";
  document.getElementById("c-meta-notes").value = proj.notes || "";
  renderProjectProfileAttachments(projectId);
  const subtotal = roundMoney(Number(proj.contractSubtotal) || 0);
  const vat = calculateTax(subtotal, "VAT");
  const wht = calculateTax(subtotal, "WHT");
  const totalContract = roundMoney(subtotal + vat);
  const netReceivable = roundMoney(totalContract - wht);
  const subtotalEl = document.getElementById("c-meta-subtotal");
  if (subtotalEl) subtotalEl.innerText = "₦" + moneyValue(subtotal);
  const vatEl = document.getElementById("c-meta-vat");
  if (vatEl) vatEl.innerText = "₦" + moneyValue(vat);
  const vatRateEl = document.getElementById("c-meta-vat-rate");
  if (vatRateEl) vatRateEl.innerText = formatTaxRate(getTaxRate("VAT"));
  const whtEl = document.getElementById("c-meta-wht");
  if (whtEl) whtEl.innerText = "₦" + moneyValue(wht);
  const whtRateEl = document.getElementById("c-meta-wht-rate");
  if (whtRateEl) whtRateEl.innerText = formatTaxRate(getTaxRate("WHT"));
  const totalEl = document.getElementById("c-meta-total");
  if (totalEl) totalEl.innerText = "₦" + moneyValue(totalContract);
  const netEl = document.getElementById("c-meta-net");
  if (netEl) netEl.innerText = "₦" + moneyValue(netReceivable);
  const vatPaidEl = document.getElementById("c-meta-vat-paid");
  if (vatPaidEl) vatPaidEl.innerText = "₦" + moneyValue(Number(proj.vatPaid) || 0);
  const invoiceBtn = document.getElementById("generate-invoice-btn");
  if (invoiceBtn) {
    const alreadyInvoiced = String(proj.invoiceGenerated) === "true";
    invoiceBtn.disabled = alreadyInvoiced;
    invoiceBtn.innerHTML = alreadyInvoiced
      ? '<i class="fas fa-check-circle"></i> Invoice Generated' + (proj.invoiceNumber ? " (" + escapeHtml(proj.invoiceNumber) + ")" : "")
      : '<i class="fas fa-file-invoice"></i> Generate Invoice';
    invoiceBtn.style.opacity = alreadyInvoiced ? "0.6" : "1";
    invoiceBtn.style.cursor = alreadyInvoiced ? "default" : "pointer";
  }
  const archiveBtn = document.getElementById("archive-project-btn");
  if (archiveBtn) {
    archiveBtn.innerHTML = proj.archived
      ? '<i class="fas fa-box-open"></i> Unarchive Project'
      : '<i class="fas fa-box-archive"></i> Archive Project';
  }
  const scopeEl = document.getElementById("c-meta-scope");
  if (scopeEl) {
    scopeEl.value = proj.scope || "";
    scopeEl.readOnly = true;
    scopeEl.style.background = "#f5f5f5";
  }
  const scopeToggle = document.getElementById("scope-edit-toggle");
  if (scopeToggle) scopeToggle.checked = false;
  const scopeSaveBtn = document.getElementById("scope-save-btn");
  if (scopeSaveBtn) scopeSaveBtn.style.display = "none";
  showPage("project-console");
  switchConsoleSegment("profile");
  if (document.getElementById("pcr-status")) populatePcrFields(proj);
}

async function renderProjectProfileAttachments(projectId) {
  const box = document.getElementById("c-meta-attachments");
  if (!box) return;
  if (!isElectronApp || !window.electronAPI || !window.electronAPI.attachments) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.style.display = "block";
  box.innerHTML = `<div class="calc-columns">
    ${buildAttachmentColumnHtml(projectId, "", "Attachments", "general")}
    ${buildAttachmentColumnHtml(projectId, "Post Project", "Post Project Attachments", "postproject")}
  </div>`;
  await Promise.all([
    refreshProjectAttachmentsList(projectId, "", "general"),
    refreshProjectAttachmentsList(projectId, "Post Project", "postproject"),
  ]);
}

function buildAttachmentColumnHtml(projectId, subfolder, label, key) {
  const listId = `c-meta-attachments-list-${key}`;
  return `<div>
    <strong>${escapeHtml(label)}</strong>
    <div style="display:flex; gap:8px; margin:8px 0; flex-wrap:wrap;">
      <button class="action-btn" style="width:auto; padding:8px 14px; font-size:13px;" onclick="window.addProjectAttachments('${escapeAttr(projectId)}','${escapeAttr(subfolder)}','${key}')"><i class="fas fa-paperclip"></i> Add Files</button>
      <button class="action-btn" style="width:auto; padding:8px 14px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.openProjectAttachmentsFolder('${escapeAttr(projectId)}','${escapeAttr(subfolder)}')"><i class="fas fa-folder-open"></i> Open Folder</button>
    </div>
    <div id="${listId}" style="display:flex; gap:8px; flex-wrap:wrap;"><span style="font-size:12px; color:var(--muted);">Loading...</span></div>
  </div>`;
}

async function refreshProjectAttachmentsList(projectId, subfolder, key) {
  const list = document.getElementById(`c-meta-attachments-list-${key}`);
  if (!list) return;
  let files = [];
  try {
    files = await window.electronAPI.attachments.list(projectId, subfolder || undefined);
  } catch (e) {
    console.error("attachments.list failed", e);
  }
  if (!files.length) {
    list.innerHTML =
      '<span style="font-size:12px; color:var(--muted);">No files attached yet</span>';
    return;
  }
  list.innerHTML = files
    .map((file) => {
      const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
      const safePath = escapeAttr(file.path);
      return `<div title="${escapeAttr(file.name)}" style="display:flex;align-items:center;gap:6px;background:var(--card-light);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;">
        <span style="cursor:pointer;" onclick="window.openProjectAttachment('${safePath}')"><i class="fas ${isImage ? "fa-image" : "fa-file"}"></i> ${escapeHtml(file.name)}</span>
        <span style="cursor:pointer;color:var(--danger,red);" onclick="window.removeProjectAttachment('${escapeAttr(projectId)}','${escapeAttr(subfolder)}','${safePath}','${key}')">&times;</span>
      </div>`;
    })
    .join("");
}

async function addProjectAttachments(projectId, subfolder, key) {
  try {
    await window.electronAPI.attachments.add(projectId, subfolder || undefined);
  } catch (e) {
    console.error("attachments.add failed", e);
    alert("Could not add files. Check console.");
  }
  await refreshProjectAttachmentsList(projectId, subfolder, key);
}

async function openProjectAttachment(filePath) {
  try {
    const result = await window.electronAPI.attachments.open(filePath);
    if (result) console.warn("attachments.open:", result);
  } catch (e) {
    console.error("attachments.open failed", e);
  }
}

async function removeProjectAttachment(projectId, subfolder, filePath, key) {
  if (!confirm("Remove this attachment? This deletes the file from disk.")) return;
  try {
    await window.electronAPI.attachments.remove(filePath);
  } catch (e) {
    console.error("attachments.remove failed", e);
  }
  await refreshProjectAttachmentsList(projectId, subfolder, key);
}

async function openProjectAttachmentsFolder(projectId, subfolder) {
  try {
    await window.electronAPI.attachments.openFolder(projectId, subfolder || undefined);
  } catch (e) {
    console.error("attachments.openFolder failed", e);
  }
}

window.addProjectAttachments = addProjectAttachments;
window.openProjectAttachment = openProjectAttachment;
window.removeProjectAttachment = removeProjectAttachment;
window.openProjectAttachmentsFolder = openProjectAttachmentsFolder;

function toggleScopeEdit(isEditing) {
  const scopeEl = document.getElementById("c-meta-scope");
  const saveBtn = document.getElementById("scope-save-btn");
  if (!scopeEl) return;
  scopeEl.readOnly = !isEditing;
  scopeEl.style.background = isEditing ? "#fff" : "#f5f5f5";
  if (saveBtn) saveBtn.style.display = isEditing ? "block" : "none";
  if (isEditing) scopeEl.focus();
}

async function saveProjectScope() {
  const btn = document.getElementById("scope-save-btn");
  const scopeEl = document.getElementById("c-meta-scope");
  const toggle = document.getElementById("scope-edit-toggle");
  const projectId = getCurrentProjectId();
  if (!projectId || !scopeEl) return;
  const newScope = scopeEl.value;
  btn.disabled = true;
  btn.innerText = "Saving...";
  try {
    await callApi("updateProjectScope", { projectId, scope: newScope });
    const cache = getCache();
    const proj = cache.projects.find((p) => p.projectId === projectId);
    if (proj) proj.scope = newScope;
    setCache(cache);
    btn.innerText = "Save Scope";
    btn.disabled = false;
    if (toggle) toggle.checked = false;
    toggleScopeEdit(false);
  } catch (e) {
    btn.innerText = "Save Scope";
    btn.disabled = false;
    alert("Failed to save scope: " + (e.message || "Unknown error"));
  }
}

// Dedicated subtotal-only update — calls the backend's updateProjectContractSubtotal action
async function updateProjectContractSubtotal(projectId, contractSubtotal) {
  const payload = {
    projectId,
    contractSubtotal: roundMoney(Number(contractSubtotal) || 0),
  };
  const result = await callApi("updateProjectContractSubtotal", payload);
  if (result && result.success !== false) {
    const cache = getCache();
    const proj = cache.projects.find((p) => p.projectId === projectId);
    if (proj) proj.contractSubtotal = payload.contractSubtotal;
    setCache(cache);
  }
  return result;
}

function triggerEditProjectProfile() {
  const cache = getCache();
  const id = getCurrentProjectId();
  openModal(
    "project",
    cache.projects.find((p) => p.projectId === id),
  );
}

function switchConsoleSegment(seg) {
  document
    .querySelectorAll(".console-tab-window")
    .forEach((w) => w.classList.remove("active-view"));
  document
    .querySelectorAll(".project-tabs .segment-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(`console-seg-${seg}`).classList.add("active-view");
  document.getElementById(`seg-btn-${seg}`).classList.add("active");
  if (seg === "progress" && typeof loadProgressTimelineFeed === "function")
    loadProgressTimelineFeed();
  if (seg === "snags" && typeof loadSnagsListings === "function")
    loadSnagsListings();
  if (seg === "workorders" && typeof loadWorkOrdersListings === "function")
    loadWorkOrdersListings();
  if (seg === "payments" && typeof loadPaymentsListings === "function")
    loadPaymentsListings();
  if (seg === "changeorders" && typeof loadChangeOrdersListings === "function")
    loadChangeOrdersListings();
  if (seg === "pcr" && typeof loadPcrView === "function") loadPcrView();
  if (seg === "photos" && typeof initPhotosPage === "function")
    initPhotosPage(getCurrentProjectId());
  if (seg === "documents" && typeof initDocumentsPage === "function")
    initDocumentsPage(getCurrentProjectId());
}

/**
 * A top-level progress log's displayed percentage is either its own
 * entered value, or -- once it has sub-tasks -- the average of those
 * sub-tasks' percentages instead. Shared by both the overall project
 * completion calculation and the card rendering, so they can never
 * disagree with each other.
 */
function computeLogDisplayPercentage(log, allLogs) {
  const children = allLogs.filter((l) => l.parentLogId === log.logId);
  if (!children.length) return Number(log.completionPercentage) || 0;
  const total = children.reduce((sum, c) => sum + (Number(c.completionPercentage) || 0), 0);
  return Math.round((total / children.length) * 10) / 10; // 1 decimal place
}

function getProjectProgressCompletion(projectId = getCurrentProjectId()) {
  const cache = getCache();
  const projectLogs = (cache.progressLogs || []).filter(
    (l) => l.projectId === projectId,
  );
  if (!projectLogs.length) return 0;
  // Only top-level logs count toward the overall figure -- a sub-log's
  // own percentage is already folded into its parent's displayed value
  // above, so including it again here would double-count that trade and
  // unfairly weight any trade that's been broken into sub-tasks versus
  // one that hasn't.
  const topLevelLogs = projectLogs.filter((l) => !l.parentLogId);
  if (!topLevelLogs.length) return 0;
  const total = topLevelLogs.reduce(
    (sum, log) => sum + computeLogDisplayPercentage(log, projectLogs),
    0,
  );
  return Math.round((total / topLevelLogs.length) * 10) / 10; // 1 decimal place
}

function setPcrStatusMessage(message, type = "info") {
  const el = document.getElementById("pcr-status-message");
  if (!el) return;
  el.style.display = message ? "block" : "none";
  el.textContent = message || "";
  el.style.background =
    type === "success"
      ? "rgba(40, 167, 69, 0.12)"
      : type === "error"
        ? "rgba(220, 53, 69, 0.12)"
        : "var(--card-light)";
  el.style.color = type === "error" ? "var(--danger)" : "var(--text)";
}

function updatePcrFields() {
  const pcrCompletion = document.getElementById("pcr-completion");
  const pcrStatus = document.getElementById("pcr-status");
  if (!pcrCompletion || !pcrStatus) return;
  const pct = getProjectProgressCompletion();
  pcrCompletion.value = pct.toFixed(1) + "%";
  if (pct < 95) {
    pcrStatus.value = "Partial Completion";
    pcrStatus.disabled = true;
  } else {
    pcrStatus.disabled = false;
    if (pcrStatus.value === "Partial Completion") {
      pcrStatus.value = "Substantially Complete";
    }
  }
}

function populatePcrFields(project) {
  const pcrStatus = document.getElementById("pcr-status");
  const pcrSummary = document.getElementById("pcr-summary");
  const pcrDeclaration = document.getElementById("pcr-declaration");
  const pcrShowWht = document.getElementById("pcr-show-wht");
  const pcrCompletionDate = document.getElementById("pcr-completion-date");
  const pcrHandoverDate = document.getElementById("pcr-handover-date");
  const pcrDefectsPeriod = document.getElementById("pcr-defects-period");
  const pcrRequestedAmount = document.getElementById("pcr-requested-amount");
  if (pcrStatus && project?.pcrStatus) pcrStatus.value = project.pcrStatus;
  if (pcrSummary) pcrSummary.value = project?.pcrSummary || "";
  if (pcrDeclaration) pcrDeclaration.value = project?.pcrDeclaration || "";
  if (pcrShowWht) pcrShowWht.checked = String(project?.pcrShowWht) === "true";
  if (pcrCompletionDate)
    pcrCompletionDate.value = project?.pcrCompletionDate || "";
  if (pcrHandoverDate) pcrHandoverDate.value = project?.pcrHandoverDate || "";
  if (pcrDefectsPeriod)
    pcrDefectsPeriod.value = project?.pcrDefectsPeriod || "6";
  if (pcrRequestedAmount)
    pcrRequestedAmount.value = project?.pcrRequestedAmount || "";
  updatePcrFields();
  setPcrMobileReadOnlyState();
}

function setPcrMobileReadOnlyState() {
  const ids = [
    "pcr-status",
    "pcr-show-wht",
    "pcr-completion-date",
    "pcr-handover-date",
    "pcr-defects-period",
    "pcr-summary",
    "pcr-declaration",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !isElectronApp;
    if (!isElectronApp) el.style.background = "#f0f0f0";
  });
  const saveBtn = document.getElementById("pcr-save-btn");
  if (saveBtn) saveBtn.style.display = isElectronApp ? "block" : "none";
}

async function previewPcrReport(mode) {
  mode = mode === "payment_request" ? "payment_request" : "pcr";
  const saved = await saveProjectPcrFields();
  if (!saved) return; // don't print against data that failed to save
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);
  if (!project) return;
  try {
    const needChangeOrders = !cache.changeOrdersLoaded;
    const needPayments = !cache.paymentsLoaded;
    const needSettings = !cache.settings || !cache.settings.VAT;
    const results = await Promise.allSettled([
      needChangeOrders ? callApi("getChangeOrders", { projectId }) : Promise.resolve(null),
      needPayments ? callApi("getPayments", {}) : Promise.resolve(null),
      needSettings ? callApi("getSettings", {}) : Promise.resolve(null),
    ]);
    if (needChangeOrders) {
      cache.changeOrders = (results[0].status === "fulfilled" ? results[0].value : null) || [];
      cache.changeOrdersLoaded = true;
    }
    if (needPayments) {
      cache.payments = (results[1].status === "fulfilled" ? results[1].value : null) || [];
      cache.paymentsLoaded = true;
    }
    if (needSettings) {
      cache.settings = (results[2].status === "fulfilled" ? results[2].value : null) || cache.settings || {};
    }
    setCache(cache);
  } catch (e) {}
  const changeOrders = (cache.changeOrders || []).filter(
    (v) => v.projectId === projectId && v.status === "Approved",
  );
  const payments = (cache.payments || []).filter((p) => p.projectId === projectId);
  const html = await renderPcrReport(project, changeOrders, payments, mode);
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = mode === "payment_request" ? "Payment Request" : "Project Completion Report";
  overlay.style.display = "flex";
  body.innerHTML = `<div style="max-height:60vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">${html}</div>`;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = html;
  submit.style.display = "block";
  submit.innerText = isElectronApp ? "Print" : "Save PDF";
  submit.onclick = async () => {
    if (printContainer) printContainer.innerHTML = html;
    if (isElectronApp) {
      printReport();
      return;
    }
    submit.disabled = true;
    submit.innerText = "Generating...";
    const pdf = await generateReportPDF("portrait");
    if (pdf) pdf.save(`${mode === "payment_request" ? "PaymentRequest" : "PCR"}_${project.projectId}.pdf`);
    submit.disabled = false;
    submit.innerText = "Save PDF";
  };
}
window.previewPcrReport = previewPcrReport;

// Add delete function for progress logs
async function deleteProgressLog(logId) {
  const cache = getCache();
  const childCount = (cache.progressLogs || []).filter((l) => l.parentLogId === logId).length;
  const warning = childCount
    ? `Delete this progress log? This will also delete its ${childCount} sub-task${childCount > 1 ? "s" : ""}.`
    : "Delete this progress log?";
  if (!confirm(warning)) return;
  try {
    await callApi("deleteProgressLog", { logId });
    const freshCache = getCache();
    freshCache.progressLogs = (freshCache.progressLogs || []).filter(
      (l) => l.logId !== logId && l.parentLogId !== logId,
    );
    setCache(freshCache);
    if (typeof closeModal === "function") closeModal();
    loadProgressTimelineFeed(true);
    showSyncToast("✅ Progress log deleted");
  } catch (e) {
    alert("Failed to delete: " + (e.message || "Unknown error"));
  }
}
window.deleteProgressLog = deleteProgressLog;

async function loadSnagsListings(forceRefresh = false) {
  const container = document.getElementById("console-snags-list");
  let cache = getCache();
  if (forceRefresh || !cache.snagsLoaded) {
    container.innerHTML = `<p style="text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading snags...</p>`;
    const items = await callApi("getSnags", {});
    cache = getCache();
    cache.snags = items || [];
    cache.snagsLoaded = true;
    setCache(cache);
  }
  const projectId = getCurrentProjectId();
  const projectSnags = cache.snags.filter((s) => s.projectId === projectId);
  if (!projectSnags.length) {
    container.innerHTML = `<p style="text-align:center;padding:20px; color:var(--muted);">No snags yet — use "New Snag" above to add one.</p>`;
    return;
  }
  container.innerHTML =
    `<div class="console-cards-grid">` +
    projectSnags
      .map((s) => {
        const key = `snag:${s.snagId}`;
        window.modalRecordCache = window.modalRecordCache || {};
        window.modalRecordCache[key] = s;
        const isOpen = s.status !== "Completed";
        return `<div class="card" data-modal-type="snag" data-modal-key="${key}" onclick="window.openModalWithRecord('snag', window.modalRecordCache['${key}'])" style="cursor:pointer; border-left:6px solid ${isOpen ? "var(--danger)" : "var(--success)"}; display:flex; flex-direction:column; height:100%; min-height:100px;"><div style="display:flex; justify-content:space-between; align-items:start; gap:6px; flex:1;"><p style="margin:0; font-size:13px; flex:1;">${escapeHtml(s.notes)}</p><span style="font-size:10px; font-weight:900; background:${isOpen ? "var(--danger)" : "var(--success)"}; color:#fff; padding:2px 6px; border-radius:4px; text-transform:uppercase; flex-shrink:0;">${escapeHtml(s.status || "Open")}</span></div>${s.assigned ? `<div style="margin-top:4px; font-size:11px; color:var(--muted);"><strong>Assigned:</strong> ${escapeHtml(s.assigned)}</div>` : ""}<div style="margin-top:4px; font-size:10px; color:var(--muted);">${escapeHtml(s.dateLogged)}${s.dateCompleted ? ` · ✓ ${escapeHtml(s.dateCompleted)}` : ""}</div></div>`;
      })
      .join("") +
    `</div>`;
}

let woSelectedIds = new Set();

async function loadWorkOrdersListings(forceRefresh = false) {
  const container = document.getElementById("console-workorders-list");
  let cache = getCache();
  if (forceRefresh || !cache.workordersLoaded) {
    container.innerHTML = `<p style="text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading work orders...</p>`;
    const orders = await callApi("getWorkOrders", {});
    cache = getCache();
    cache.workorders = orders || [];
    cache.workordersLoaded = true;
    setCache(cache);
  }
  const projectId = getCurrentProjectId();
  const projectOrders = cache.workorders.filter(
    (w) => w.projectId === projectId,
  );
  if (!projectOrders.length) {
    container.innerHTML = `<p style="text-align:center;padding:20px; color:var(--muted);">No work orders yet — use "New Work Order" above to add one.</p>`;
    return;
  }
  const selectionBar = woSelectedIds.size
    ? `<div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:var(--card-light);">
        <strong style="font-size:13px;">${woSelectedIds.size} selected</strong>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--success);" onclick="window.woBulkSetStatus('Approved')"><i class="fas fa-check"></i> Mark Approved</button>
          <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:#fd7e14;" onclick="window.woBulkSetStatus('Draft')"><i class="fas fa-rotate-left"></i> Mark Draft</button>
          <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:transparent; color:var(--danger);" onclick="window.woClearSelection()"><i class="fas fa-xmark"></i> Clear</button>
        </div>
      </div>`
    : "";

  container.innerHTML =
    selectionBar +
    `<div class="console-cards-grid">` +
    projectOrders
      .map((w) => {
        const key = `workorder:${w.workOrderId}`;
        window.modalRecordCache = window.modalRecordCache || {};
        window.modalRecordCache[key] = w;
        const vendor = (cache.vendors || []).find(
          (v) => v.vendorId === w.vendorId,
        );
        const statusColor = w.status === "Approved" ? "var(--success)" : "#fd7e14";
        const isSelected = woSelectedIds.has(w.workOrderId);
        return `<div class="card ${isSelected ? "doc-card-selected" : ""}" data-modal-type="workorder" data-modal-key="${key}" onclick="${isElectronApp ? `window.openModalWithRecord('workorder', window.modalRecordCache['${key}'])` : `window.previewWorkOrderReport('${escapeAttr(w.workOrderId)}')`}" style="cursor:pointer; border-left:5px solid ${statusColor}; position:relative;">
          <div class="doc-card-select-badge ${isSelected ? "doc-card-select-badge-active" : ""}" onclick="event.stopPropagation(); window.woToggleSelect('${escapeAttr(w.workOrderId)}')" title="Select"></div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; padding-left:20px;"><strong>${escapeHtml(vendor ? vendor.company : w.vendorId)}</strong><span style="font-size:10px; font-weight:800; padding:2px 9px; border-radius:999px; background:${statusColor}; color:#fff; flex-shrink:0;">${escapeHtml(w.status)}</span></div>
          <div style="padding-left:20px;">${escapeHtml(formatWorkOrderDescription(w.description))}<br>₦${moneyValue(w.amount)}</div>
          <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; padding-left:20px;" onclick="event.stopPropagation()">
            ${
              isElectronApp
                ? `<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.openModalWithRecord('workorder', window.modalRecordCache['${key}'])">
              <i class="fas fa-edit"></i> Edit
            </button>`
                : ""
            }
            <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--primary);" onclick="window.previewWorkOrderReport('${escapeAttr(w.workOrderId)}')">
              <i class="fas fa-print"></i> Print
            </button>
          </div>
        </div>`;
      })
      .join("") +
    `</div>`;
}

function woToggleSelect(workOrderId) {
  if (woSelectedIds.has(workOrderId)) woSelectedIds.delete(workOrderId);
  else woSelectedIds.add(workOrderId);
  loadWorkOrdersListings(false);
}
window.woToggleSelect = woToggleSelect;

function woClearSelection() {
  woSelectedIds = new Set();
  loadWorkOrdersListings(false);
}
window.woClearSelection = woClearSelection;

async function woBulkSetStatus(newStatus) {
  if (!woSelectedIds.size) return;
  const ids = Array.from(woSelectedIds);
  const cache = getCache();
  const results = await Promise.allSettled(
    ids.map((id) => {
      const wo = (cache.workorders || []).find((w) => w.workOrderId === id);
      if (!wo) return Promise.resolve();
      return callApi("updateWorkOrder", Object.assign({}, wo, { status: newStatus }));
    }),
  );
  const cache2 = getCache();
  let failCount = 0;
  ids.forEach((id, i) => {
    if (results[i].status === "fulfilled") {
      const wo = (cache2.workorders || []).find((w) => w.workOrderId === id);
      if (wo) wo.status = newStatus;
    } else {
      failCount++;
    }
  });
  setCache(cache2);
  woSelectedIds = new Set();
  loadWorkOrdersListings(false);
  refreshMasterDashboard();
  if (failCount > 0) {
    alert(failCount + " of " + ids.length + " work order(s) could not be updated — check your connection and try again.");
  } else if (typeof showSyncToast === "function") {
    showSyncToast(ids.length + " work order(s) marked " + newStatus);
  }
}
window.woBulkSetStatus = woBulkSetStatus;

let woReportSelectedAttachmentIndex = 0;

async function previewWorkOrderReport(workOrderId) {
  const cache = getCache();
  const workorder = (cache.workorders || []).find(
    (w) => w.workOrderId === workOrderId,
  );
  if (!workorder) return;
  const project = (cache.projects || []).find(
    (p) => p.projectId === workorder.projectId,
  );
  if (!cache.vendors || !cache.vendors.length) {
    try {
      const vendors = await callApi("getVendors", {});
      cache.vendors = vendors || [];
      setCache(cache);
    } catch (e) {}
  }
  woReportSelectedAttachmentIndex = 0;
  const resolvedAttachments = await resolveAttachmentList(workorder.attachments);
  const html = await renderWorkOrderDetailReport(
    workorder,
    project,
    cache.vendors || [],
    cache.settings || {},
    woReportSelectedAttachmentIndex,
  );
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Work Order Report";
  overlay.style.display = "flex";
  body.innerHTML = `
    <div id="wo-report-picker">${renderAttachmentPickerHtml(resolvedAttachments, woReportSelectedAttachmentIndex, "window.regenerateWorkOrderReportPreview", `'${escapeAttr(workOrderId)}'`)}</div>
    <div id="wo-report-preview" style="max-height:60vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">${html}</div>
  `;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = html;
  submit.style.display = "block";
  submit.innerText = isElectronApp ? "Print" : "Save PDF";
  submit.onclick = async () => {
    const freshHtml = await renderWorkOrderDetailReport(
      workorder,
      project,
      cache.vendors || [],
      cache.settings || {},
      woReportSelectedAttachmentIndex,
    );
    if (printContainer) printContainer.innerHTML = freshHtml;
    if (isElectronApp) {
      printReport();
      return;
    }
    submit.disabled = true;
    submit.innerText = "Generating...";
    const pdf = await generateReportPDF("portrait");
    if (pdf) pdf.save(`Work_Order_${workorder.workOrderId}.pdf`);
    submit.disabled = false;
    submit.innerText = "Save PDF";
  };
}
window.previewWorkOrderReport = previewWorkOrderReport;

async function regenerateWorkOrderReportPreview(workOrderId, index) {
  woReportSelectedAttachmentIndex = index;
  const cache = getCache();
  const workorder = (cache.workorders || []).find((w) => w.workOrderId === workOrderId);
  if (!workorder) return;
  const project = (cache.projects || []).find((p) => p.projectId === workorder.projectId);
  const resolvedAttachments = await resolveAttachmentList(workorder.attachments);
  const pickerEl = document.getElementById("wo-report-picker");
  if (pickerEl)
    pickerEl.innerHTML = renderAttachmentPickerHtml(resolvedAttachments, index, "window.regenerateWorkOrderReportPreview", `'${escapeAttr(workOrderId)}'`);
  const preview = document.getElementById("wo-report-preview");
  if (preview)
    preview.innerHTML = await renderWorkOrderDetailReport(
      workorder,
      project,
      cache.vendors || [],
      cache.settings || {},
      index,
    );
}
window.regenerateWorkOrderReportPreview = regenerateWorkOrderReportPreview;

let paymentSelectedIds = new Set();

async function loadPaymentsListings(forceRefresh = false) {
  const container = document.getElementById("console-payments-list");
  let cache = getCache();
  if (forceRefresh || !cache.paymentsLoaded) {
    container.innerHTML = `<p style="text-align:center; font-size:14px; font-weight:700;"><i class="fas fa-spinner fa-spin"></i> Loading payment records...</p>`;
    const payments = await callApi("getPayments", {});
    cache = getCache();
    cache.payments = payments || [];
    cache.paymentsLoaded = true;
    setCache(cache);
  }
  const projectId = getCurrentProjectId();
  const groups = getAllPaymentGroups(projectId);
  if (groups.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); font-style:italic; text-align:center; padding:20px; font-size:14px;">No payment records yet — use "Log Payment" above to add one.</p>`;
    return;
  }
  let totalReceived = 0,
    totalOutgoing = 0,
    smallExpenses = 0,
    totalPending = 0,
    totalOutstanding = 0;
  groups.forEach((g) => {
    if (g.direction === "Client Receipt") {
      totalReceived += g.paymentsToDate;
      totalOutstanding += g.balance;
    } else if (g.direction === "Small Expense")
      smallExpenses += g.paymentsToDate;
    else {
      totalOutgoing += g.paymentsToDate;
      totalPending += g.balance;
    }
  });
  const netBalance = roundMoney(
    totalReceived - totalOutgoing - smallExpenses - totalPending,
  );
  const totalsHtml = `<div class="card" style="background:var(--card); border-color:#000; padding:12px;"><div style="display: flex; flex-direction: column; gap: 12px;"><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0;"><span style="font-weight:800; text-transform:uppercase; font-size:13px; flex-shrink:0;">Inflow</span><span style="font-size:18px; font-weight:900; color:var(--success); text-align:right; word-break:break-word;">₦${moneyValue(totalReceived)}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0;"><span style="font-weight:800; text-transform:uppercase; font-size:13px; flex-shrink:0;">Inflow Balance</span><span style="font-size:16px; font-weight:900; color:var(--primary); text-align:right; word-break:break-word;">₦${moneyValue(totalOutstanding)}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0;"><span style="font-weight:800; text-transform:uppercase; font-size:13px; flex-shrink:0;">Expenses</span><span style="font-size:18px; font-weight:900; color:var(--danger); text-align:right; word-break:break-word;">₦${moneyValue(totalOutgoing)}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0;"><span style="font-weight:800; text-transform:uppercase; font-size:13px; flex-shrink:0;">Pending</span><span style="font-size:16px; font-weight:900; color:#fd7e14; text-align:right; word-break:break-word;">₦${moneyValue(totalPending)}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0;"><span style="font-weight:800; text-transform:uppercase; font-size:13px; flex-shrink:0;">Small Expenses</span><span style="font-size:16px; font-weight:900; text-align:right; word-break:break-word;">₦${moneyValue(smallExpenses)}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0; border-top: 1px solid var(--border); padding-top: 8px;"><span style="font-weight:800; text-transform:uppercase; font-size:14px; flex-shrink:0;">Net Balance</span><span style="font-size:18px; font-weight:900; color:${netBalance >= 0 ? "var(--success)" : "var(--danger)"}; text-align:right; word-break:break-word;">₦${moneyValue(netBalance)}</span></div></div></div>`;
  const groupSortInfo = (g) => {
    const balance = g.direction === "Small Expense" ? 0 : g.balance;
    const statusPriority = balance > 0 ? 0 : g.direction === "Small Expense" ? 1 : 2; // Active, then Logged, then Complete
    const mostRecentDate = g.stages.reduce((latest, s) => {
      const d = Date.parse(s.paymentDate) || 0;
      return d > latest ? d : latest;
    }, 0);
    return { statusPriority, mostRecentDate };
  };
  groups.sort((a, b) => {
    const infoA = groupSortInfo(a);
    const infoB = groupSortInfo(b);
    if (infoA.statusPriority !== infoB.statusPriority) return infoA.statusPriority - infoB.statusPriority;
    return infoB.mostRecentDate - infoA.mostRecentDate;
  });

  const paymentsHtml = groups
    .map((g) => {
      const incoming = g.direction === "Client Receipt";
      const isSmall = g.direction === "Small Expense";
      const isStaged = !isSmall && g.stages.length > 0;
      const hasBalance = g.balance > 0;
      const canAddStage = isStaged && hasBalance && g.stages.length < 4;
      const stageRows = g.stages
        .map((s, idx) => {
          const key = `payment:${s.paymentId}`;
          window.modalRecordCache = window.modalRecordCache || {};
          window.modalRecordCache[key] = s;
          return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--card-light); ${idx === g.stages.length - 1 ? "border-bottom:none;" : ""}"><div style="display:flex; align-items:center; gap:8px;"><input type="checkbox" style="width:auto; margin:0;" ${paymentSelectedIds.has(s.paymentId) ? "checked" : ""} onclick="event.stopPropagation(); window.paymentToggleSelect('${escapeAttr(s.paymentId)}')"><div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="event.stopPropagation(); window.openModalWithRecord('payment', window.modalRecordCache['${key}'])"><span style="font-size:11px; font-weight:900; background:var(--primary); color:#fff; padding:2px 8px; border-radius:4px; text-transform:uppercase;">${s.stage ? "Stage " + escapeHtml(s.stage) : "Full"}</span><span style="font-size:13px; color:var(--muted);">${escapeHtml(s.paymentDate)}</span></div></div><span style="font-size:14px; font-weight:900; color:${incoming ? "var(--success)" : "var(--danger)"}; cursor:pointer;" onclick="event.stopPropagation(); window.openModalWithRecord('payment', window.modalRecordCache['${key}'])">${incoming ? "+" : "-"}₦${moneyValue(s.amount)}</span></div>`;
        })
        .join("");
      const statusText =
        g.balance <= 0 ? "Complete" : isSmall ? "Logged" : "Active";
      const statusColor =
        g.balance <= 0
          ? "var(--success)"
          : isSmall
            ? "var(--muted)"
            : "#fd7e14";
      const firstKey = g.stages.length ? `payment:${g.stages[0].paymentId}` : null;
      return `<div class="card" style="background:#fff; border-color:#000; border-left:6px solid ${incoming ? "var(--success)" : isSmall ? "var(--muted)" : "var(--danger)"}; padding:10px 14px; ${firstKey ? "cursor:pointer;" : ""}"${firstKey ? ` onclick="window.openModalWithRecord('payment', window.modalRecordCache['${firstKey}'])"` : ""}><div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><strong style="font-size:16px;">${escapeHtml(g.payee || "Payment")}</strong><div style="display:flex; align-items:center; gap:6px; flex-shrink:0;"><span style="font-size:11px; font-weight:900; background:${statusColor}; color:#fff; padding:3px 8px; border-radius:4px; text-transform:uppercase;">${statusText}</span><i class="fas fa-trash" style="color:var(--danger); cursor:pointer; font-size:13px; padding:4px;" title="Delete this card" onclick="event.stopPropagation(); window.deletePaymentGroupWithUndo('${escapeAttr(g.paymentGroupId)}', '${escapeAttr(g.payee || "Payment")}')"></i></div></div>${stageRows ? `<div style="margin-top:4px;">${stageRows}</div>` : ""}${canAddStage ? `<button class="action-btn" style="margin-top:10px; width:auto; padding:6px 14px; font-size:12px; background:var(--primary);" onclick="event.stopPropagation(); window.openAddStageModal('${escapeAttr(g.paymentGroupId)}')"><i class="fas fa-plus"></i> Add Stage ${g.stages.length + 1}</button>` : ""}</div>`;
    })
    .join("");
  container.innerHTML =
    paymentSelectionBarHtml() + totalsHtml + `<div class="console-payments-grid">` + paymentsHtml + `</div>`;
}

function paymentSelectionBarHtml() {
  if (!paymentSelectedIds.size) return "";
  return `<div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:var(--card-light);">
    <strong style="font-size:13px;">${paymentSelectedIds.size} selected</strong>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="window.paymentExportSelectedCSV()"><i class="fas fa-file-csv"></i> Export CSV</button>
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:transparent; color:var(--danger);" onclick="window.paymentClearSelection()"><i class="fas fa-xmark"></i> Clear</button>
    </div>
  </div>`;
}

function paymentToggleSelect(paymentId) {
  if (paymentSelectedIds.has(paymentId)) paymentSelectedIds.delete(paymentId);
  else paymentSelectedIds.add(paymentId);
  loadPaymentsListings(false);
}
window.paymentToggleSelect = paymentToggleSelect;

function deletePaymentWithUndo(payment) {
  closeModal(); // harmless no-op if no modal is open
  const cache = getCache();
  cache.payments = (cache.payments || []).filter((p) => p.paymentId !== payment.paymentId);
  setCache(cache);
  loadPaymentsListings(false);
  scheduleUndoableDelete(
    "payment:" + payment.paymentId,
    "Payment stage deleted",
    function () {
      callApi("deletePayment", { paymentId: payment.paymentId }).catch(function (err) {
        console.error("Delete failed after undo window expired", err);
      });
    },
    function () {
      const cache2 = getCache();
      cache2.payments = (cache2.payments || []).concat([payment]);
      setCache(cache2);
      loadPaymentsListings(false);
    },
  );
}
window.deletePaymentWithUndo = deletePaymentWithUndo;

function deletePaymentGroupWithUndo(paymentGroupId, payeeLabel) {
  const cache = getCache();
  const removedStages = (cache.payments || []).filter((p) => p.paymentGroupId === paymentGroupId);
  if (!removedStages.length) return;
  cache.payments = (cache.payments || []).filter((p) => p.paymentGroupId !== paymentGroupId);
  setCache(cache);
  loadPaymentsListings(false);
  scheduleUndoableDelete(
    "paymentgroup:" + paymentGroupId,
    '"' + (payeeLabel || "Payment") + '" and ' + removedStages.length + " stage(s) deleted",
    function () {
      callApi("deletePaymentGroup", { paymentGroupId: paymentGroupId }).catch(function (err) {
        console.error("Delete failed after undo window expired", err);
      });
    },
    function () {
      const cache2 = getCache();
      cache2.payments = (cache2.payments || []).concat(removedStages);
      setCache(cache2);
      loadPaymentsListings(false);
    },
  );
}
window.deletePaymentGroupWithUndo = deletePaymentGroupWithUndo;

function paymentClearSelection() {
  paymentSelectedIds = new Set();
  loadPaymentsListings(false);
}
window.paymentClearSelection = paymentClearSelection;

function paymentExportSelectedCSV() {
  if (!paymentSelectedIds.size) return;
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);
  const groups = getAllPaymentGroups(projectId);
  const rows = [];
  Array.from(paymentSelectedIds).forEach((paymentId) => {
    const record = window.modalRecordCache ? window.modalRecordCache["payment:" + paymentId] : null;
    if (!record) return;
    const group = groups.find((g) => g.stages.some((s) => s.paymentId === paymentId));
    rows.push({
      date: record.paymentDate || "",
      payee: group ? group.payee || "" : "",
      direction: group ? group.direction || "" : "",
      stage: record.stage ? "Stage " + record.stage : "Full",
      amount: record.amount || 0,
    });
  });
  if (!rows.length) {
    alert("Could not find data for the selected payments — try reselecting them.");
    return;
  }
  const header = ["Date", "Payee", "Direction", "Stage", "Amount"];
  const csvLines = [header.join(",")].concat(
    rows.map((r) =>
      [csvEscape(r.date), csvEscape(r.payee), csvEscape(r.direction), csvEscape(r.stage), r.amount].join(","),
    ),
  );
  const csvContent = csvLines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Payments_" + (project ? project.projectId : projectId) + "_" + Date.now() + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
window.paymentExportSelectedCSV = paymentExportSelectedCSV;

function csvEscape(value) {
  const str = String(value == null ? "" : value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ===== SAVE PCR FIELDS =====
async function saveProjectPcrFields() {
  const projectId = getCurrentProjectId();
  updatePcrFields();
  const saveBtn = document.getElementById("pcr-save-btn");
  const pcrStatus = document.getElementById("pcr-status");
  const pcrCompletion = document.getElementById("pcr-completion");
  const pcrSummary = document.getElementById("pcr-summary");
  const pcrDeclaration = document.getElementById("pcr-declaration");
  const pcrShowWht = document.getElementById("pcr-show-wht");
  const pcrCompletionDate = document.getElementById("pcr-completion-date");
  const pcrHandoverDate = document.getElementById("pcr-handover-date");
  const pcrDefectsPeriod = document.getElementById("pcr-defects-period");
  const pcrRequestedAmount = document.getElementById("pcr-requested-amount");

  if (!projectId) {
    alert("No project selected");
    return;
  }

  const payload = {
    projectId: projectId,
    pcrStatus: pcrStatus.value,
    pcrCompletion: pcrCompletion.value,
    pcrSummary: pcrSummary.value,
    pcrDeclaration: pcrDeclaration.value,
    pcrShowWht: pcrShowWht ? String(pcrShowWht.checked) : "false",
    pcrCompletionDate: pcrCompletionDate.value || "",
    pcrHandoverDate: pcrHandoverDate.value || "",
    pcrDefectsPeriod: pcrDefectsPeriod.value || "6",
    pcrRequestedAmount: Number(pcrRequestedAmount ? pcrRequestedAmount.value : 0) || 0,
  };

  // Requested Amount can't exceed what's actually still expected from the
  // client — same Balance Expected calculation used on the Accounts page
  // and in the PCR/Payment Request printout itself.
  if (payload.pcrRequestedAmount > 0) {
    const cacheForCheck = getCache();
    const projectForCheck = (cacheForCheck.projects || []).find((p) => p.projectId === projectId);
    if (projectForCheck) {
      const subtotal = roundMoney(Number(projectForCheck.contractSubtotal) || 0);
      const vat = calculateTax(subtotal, "VAT");
      const totalContract = roundMoney(subtotal + vat);
      let totalReceived = 0;
      if (typeof getAllPaymentGroups === "function") {
        getAllPaymentGroups(projectId).forEach((g) => {
          if (g.direction === "Client Receipt") totalReceived += g.paymentsToDate;
        });
      }
      const balanceExpected = roundMoney(totalContract - roundMoney(totalReceived));
      if (payload.pcrRequestedAmount > balanceExpected) {
        alert("Requested Amount (₦" + moneyValue(payload.pcrRequestedAmount) + ") cannot exceed the Balance Expected (₦" + moneyValue(balanceExpected) + ").");
        return false;
      }
    }
  }

  try {
    setPcrStatusMessage("Saving PCR fields...");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    await callApi("updateProjectPcrFields", payload);
    const cache = getCache();
    const project = (cache.projects || []).find((p) => p.projectId === projectId);
    if (project) Object.assign(project, payload);
    setCache(cache);
    setPcrStatusMessage("PCR fields saved.", "success");
    showSyncToast("✅ PCR fields saved");
    return true;
  } catch (e) {
    setPcrStatusMessage("PCR save failed.", "error");
    alert("Failed to save: " + (e.message || "Unknown error"));
    return false;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save PCR Fields';
    }
  }
}
window.saveProjectPcrFields = saveProjectPcrFields;

async function loadProgressTimelineFeed(forceRefresh = false) {
  const container = document.getElementById("console-progress-feed");
  if (!container) return;

  let cache = getCache();
  if (forceRefresh || !cache.progressLogsLoaded) {
    container.innerHTML = `<p style="text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading progress...</p>`;
    try {
      const items = await callApi("getProgressLogs", {});
      cache = getCache();
      cache.progressLogs = items || [];
      cache.progressLogsLoaded = true;
      setCache(cache);
    } catch (e) {
      console.warn("loadProgressTimelineFeed failed:", e);
    }
  }

  const projectId = getCurrentProjectId();
  const projectLogs = (cache.progressLogs || []).filter(
    (l) => l.projectId === projectId,
  );

  const overallEl = document.getElementById("console-progress-overall");
  if (overallEl)
    overallEl.innerText = getProjectProgressCompletion(projectId).toFixed(1) + "%";

  // Update PCR fields if on PCR tab
  if (typeof updatePcrFields === "function") updatePcrFields();

  if (!projectLogs.length) {
    container.innerHTML = `<p style="text-align:center;padding:20px; color:var(--muted);">No progress logs yet — use "Log Progress" above to add one.</p>`;
    return;
  }

  // Sort by date descending
  projectLogs.sort((a, b) => {
    const da = new Date(a.dateRecorded || 0);
    const db = new Date(b.dateRecorded || 0);
    return db - da;
  });

  const topLevelLogs = projectLogs.filter((l) => !l.parentLogId);
  const childrenByParent = {};
  projectLogs.forEach((l) => {
    if (l.parentLogId) {
      childrenByParent[l.parentLogId] = childrenByParent[l.parentLogId] || [];
      childrenByParent[l.parentLogId].push(l);
    }
  });

  function subLogCardHtml(l) {
    const key = `progress:${l.logId}`;
    window.modalRecordCache = window.modalRecordCache || {};
    window.modalRecordCache[key] = l;
    const pct = Number(l.completionPercentage) || 0;
    const color = pct >= 90 ? "var(--success)" : pct >= 50 ? "#fd7e14" : "var(--primary)";
    // Sits inside the parent's connector strip (see below) -- the strip's
    // own left border IS the vertical "spine" of the tree connector, so
    // this card only needs to sit indented within it, not draw its own
    // line. A small top-left notch (border-radius reset on that corner)
    // is what makes it read as "branching off" the spine rather than
    // just another independent card floating nearby.
    return `<div class="card" style="border-left:6px solid ${color}; border-top-left-radius:0; cursor:pointer; margin-top:8px;" onclick="window.openModalWithRecord('progress_entry', window.modalRecordCache['${key}'])">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(l.tradeCategory)}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">${escapeHtml(typeof ymd === "function" ? ymd(l.dateRecorded) : String(l.dateRecorded || "").slice(0, 10))}</div>
        </div>
        <span style="font-size:18px; font-weight:900; color:${color}; flex-shrink:0;">${pct}%</span>
      </div>
      ${l.commentNarrative ? `<div style="margin-top:6px; font-size:13px; line-height:1.4;">${escapeHtml(l.commentNarrative).substring(0, 120)}${l.commentNarrative.length > 120 ? "..." : ""}</div>` : ""}
      ${(Array.isArray(l.progressPhotoUrl) ? l.progressPhotoUrl.length > 0 : !!String(l.progressPhotoUrl || "").trim()) ? `<div style="margin-top:8px; font-size:11px; color:var(--muted);"><i class="fas fa-paperclip"></i> Has attachments</div>` : ""}
    </div>`;
  }

  container.innerHTML =
    `<div class="console-cards-grid">` +
    topLevelLogs
      .map((l) => {
        const key = `progress:${l.logId}`;
        window.modalRecordCache = window.modalRecordCache || {};
        window.modalRecordCache[key] = l;
        const pct = computeLogDisplayPercentage(l, projectLogs);
        const color =
          pct >= 90
            ? "var(--success)"
            : pct >= 50
              ? "#fd7e14"
              : "var(--primary)";
        const children = childrenByParent[l.logId] || [];
        const parentCardHtml = `<div class="card" style="border-left:6px solid ${color}; cursor:pointer;" onclick="window.openModalWithRecord('progress_entry', window.modalRecordCache['${key}'])">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div style="flex:1; min-width:0;">
            <div style="font-weight:800; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(l.tradeCategory)}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">${escapeHtml(typeof ymd === "function" ? ymd(l.dateRecorded) : String(l.dateRecorded || "").slice(0, 10))}</div>
          </div>
          <span style="font-size:18px; font-weight:900; color:${color}; flex-shrink:0;">${pct.toFixed(1)}%${children.length ? ` <span style="font-size:11px; font-weight:600; color:var(--muted);">(avg of ${children.length})</span>` : ""}</span>
        </div>
        ${l.commentNarrative ? `<div style="margin-top:6px; font-size:13px; line-height:1.4;">${escapeHtml(l.commentNarrative).substring(0, 120)}${l.commentNarrative.length > 120 ? "..." : ""}</div>` : ""}
        ${(Array.isArray(l.progressPhotoUrl) ? l.progressPhotoUrl.length > 0 : !!String(l.progressPhotoUrl || "").trim()) ? `<div style="margin-top:8px; font-size:11px; color:var(--muted);"><i class="fas fa-paperclip"></i> Has attachments</div>` : ""}
        <button class="action-btn" style="width:auto; padding:4px 12px; font-size:11px; margin-top:8px; background:var(--card-light); color:var(--text);" onclick="event.stopPropagation(); window.openModalWithRecord('progress_entry', {_isSubTask:true, projectId:'${l.projectId}', parentLogId:'${l.logId}'})"><i class="fas fa-plus"></i> Add Sub-task</button>
      </div>`;
        // The whole group (parent + its sub-logs) is wrapped in ONE outer
        // div, which is what actually becomes the single grid cell --
        // without this wrapper, each sub-log card would just flow as its
        // own independent grid item (possibly in a totally different row
        // or column), with no visual relationship to its parent at all.
        // The connector itself is just a continuous left border running
        // down a padded strip containing all the sub-logs -- the
        // straightforward, reliable way to draw a persistent "spine"
        // line without needing separate positioned elements per card.
        const childrenHtml = children.length
          ? `<div style="margin-left:20px; padding-left:16px; border-left:2px solid var(--border); margin-top:8px;">${children.map(subLogCardHtml).join("")}</div>`
          : "";
        return `<div>${parentCardHtml}${childrenHtml}</div>`;
      })
      .join("") +
    `</div>`;
}

window.loadProgressTimelineFeed = loadProgressTimelineFeed;
window.getProjectProgressCompletion = getProjectProgressCompletion;
window.renderProjectProfileAttachments = renderProjectProfileAttachments;
window.setPcrStatusMessage = setPcrStatusMessage;
window.updatePcrFields = updatePcrFields;
window.populatePcrFields = populatePcrFields;

// ===== generate invoice from a project's source estimate =====
// Desktop only (the Documents module the PDF attaches to is local-
// filesystem, Electron-only). One-shot: once generated, the button
// disables and the invoice number is recorded on the project so it can't
// be silently regenerated.

function trashCurrentProject() {
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);
  if (!project) return;
  if (!confirm('Delete "' + (project.clientName || project.projectId) + '"? It will move to Trash (Settings → Project Trash), where it can be restored or permanently erased later.')) return;

  // Instant: mark it gone locally, drop the card, and land back on a
  // refreshed dashboard -- all before anything touches the network.
  cache.projects = (cache.projects || []).filter((p) => p.projectId !== projectId);
  setCache(cache);
  // showPageWithoutRefresh, not showPage: showPage's normal dashboard
  // refresh does a LIVE getProjects fetch, which races the trashProject
  // write queued below -- if that fetch lands first, it returns the
  // project still un-trashed and overwrites the filter above, undoing
  // it. Rendering straight from the already-updated cache avoids the
  // race entirely.
  showPageWithoutRefresh("dashboard");
  renderProjects();
  // Also update the PERSISTED backup, not just the in-memory cache --
  // api.js has a guard that restores stale backed-up data whenever a
  // live getProjects response comes back empty (protection against a
  // broken server wiping good data). Without this, that guard can't
  // tell "server is broken" apart from "we just correctly deleted the
  // only project," and will keep resurrecting this project forever on
  // every subsequent getProjects call.
  if (typeof writeBackup === "function") writeBackup("getProjects", cache.projects, {});
  if (typeof showSyncToast === "function") showSyncToast("📦 Project moved to Trash");

  // The actual delete continues in the background, visible in the sync
  // indicator like any other pending change, rather than the user
  // waiting here for a round trip.
  runInBackground("trashProject", { projectId: projectId });
}
window.trashCurrentProject = trashCurrentProject;

/**
 * Archive is deliberately independent of trashed -- a purely cosmetic
 * manual flag to declutter the dashboard, not a soft-delete. The
 * project stays fully active and editable everywhere else; it just
 * moves into a collapsed "Archived" section on the dashboard.
 */
function toggleArchiveCurrentProject() {
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);
  if (!project) return;
  const wasArchived = !!project.archived;

  // Instant, same pattern as trashCurrentProject: flip it in the cache
  // right away and update this same button's label immediately.
  project.archived = !wasArchived;
  setCache(cache);
  const archiveBtn = document.getElementById("archive-project-btn");
  if (archiveBtn) {
    archiveBtn.innerHTML = project.archived
      ? '<i class="fas fa-box-open"></i> Unarchive Project'
      : '<i class="fas fa-box-archive"></i> Archive Project';
  }
  if (typeof writeBackup === "function") writeBackup("getProjects", cache.projects, {});
  if (typeof showSyncToast === "function") showSyncToast(project.archived ? "📥 Project archived" : "📤 Project unarchived");

  runInBackground(project.archived ? "archiveProject" : "unarchiveProject", { projectId: projectId });
}
window.toggleArchiveCurrentProject = toggleArchiveCurrentProject;

async function generateProjectInvoice() {
  if (!isElectronApp || !window.electronAPI || !window.electronAPI.attachments) {
    alert("Generating an invoice requires the desktop app (it saves the PDF into this project's Documents folder).");
    return;
  }
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const project = (cache.projects || []).find(function (p) { return p.projectId === projectId; });
  if (!project) return;
  if (String(project.invoiceGenerated) === "true") return; // guarded by the disabled button too

  if (!project.sourceEstimateId) {
    alert("This project has no linked estimate to generate an invoice from (it wasn't created from an Accepted estimate).");
    return;
  }

  const btn = document.getElementById("generate-invoice-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  }

  try {
    // Estimates aren't part of the app's general preload -- fetch if needed.
    let estimate = (cache.estimates || []).find(function (e) { return e.estimateId === project.sourceEstimateId; });
    if (!estimate) {
      const fetched = await callApi("getEstimates", {});
      cache.estimates = Array.isArray(fetched) ? fetched : [];
      setCache(cache);
      estimate = cache.estimates.find(function (e) { return e.estimateId === project.sourceEstimateId; });
    }
    if (!estimate) {
      alert("Could not find the source estimate for this project.");
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-invoice"></i> Generate Invoice'; }
      return;
    }

    const invoiceNumber = "INV-" + projectNumberSuffixFrontend_(projectId) + "-01";
    const html = await renderProjectInvoiceDoc(estimate, invoiceNumber);
    const printContainer = document.getElementById("report-print-container");
    if (printContainer) printContainer.innerHTML = html;
    const pdf = await generateReportPDF("portrait");
    if (!pdf) throw new Error("Could not generate the invoice PDF.");
    const bytes = pdf.output("arraybuffer");
    const fileName = invoiceNumber.replace(/\//g, "-") + ".pdf";
    await window.electronAPI.attachments.addFromData(projectId, "Documents", fileName, bytes);

    const resp = await callApi("markProjectInvoiced", { projectId: projectId, invoiceNumber: invoiceNumber });
    if (!resp || !resp.success) throw new Error("Could not save invoice status.");

    project.invoiceGenerated = "true";
    project.invoiceNumber = invoiceNumber;
    cache.projects = cache.projects.map(function (p) { return p.projectId === projectId ? project : p; });
    setCache(cache);

    if (typeof showSyncToast === "function") showSyncToast("Invoice generated and added to Documents");
    loadProjectConsoleHub(projectId); // re-render Profile so the button shows its final disabled state
  } catch (e) {
    console.error("generateProjectInvoice failed", e);
    alert("Failed to generate invoice: " + (e.message || "Unknown error"));
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-invoice"></i> Generate Invoice'; }
  }
}
window.generateProjectInvoice = generateProjectInvoice;

function projectNumberSuffixFrontend_(projectId) {
  const match = String(projectId).match(/(\d{1,3})\D*$/);
  return (match ? match[1] : "0").padStart(3, "0");
}

/**
 * The invoice is just the estimate, printed with a different label: no
 * "Valid Until" line, no "Please Note" section, and an actual invoice
 * number instead of the estimate's own number. Built from a copy of
 * renderEstimateReportDoc's structure rather than post-processing its
 * HTML output, since string-replacing "ESTIMATE"/"Estimate No:" after the
 * fact would be fragile if that text ever appears elsewhere (e.g. inside
 * a line item description).
 */
async function renderProjectInvoiceDoc(est, invoiceNumber) {
  const cache = getCache();
  const settings = cache.settings && cache.settings.data ? cache.settings.data : cache.settings || {};
  const logoUrl = settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";
  const logoSizeFactor = _getLogoSizeFactor();
  const c = _getCompanyDetails();
  const contactLine = escapeHtml(c.address).replace(/\n/g, "<br>");
  const contactLine2 = c.email + " | " + c.phone1; // escaped once, downstream

  const lineItems = safeParseJsonArray(est.lineItems);
  const mode = est.subtotalMode === "grouped" ? "grouped" : "single";
  const discountEnabled = String(est.discountEnabled) === "true";
  const discountAmount = Number(est.discountAmount) || 0;
  const totals = estComputeTotals(lineItems, mode, discountAmount, discountEnabled);

  function rowHtml(item) {
    return (
      '<tr><td style="padding:6px; font-size:12px; vertical-align:top;">' + escapeHtml(item.description || "") + '</td>' +
      '<td style="padding:6px; font-size:12px; text-align:right; vertical-align:top;">' + escapeHtml(item.qty != null ? item.qty : "") + '</td>' +
      '<td style="padding:6px; font-size:12px; vertical-align:top;">' + escapeHtml(item.unit || "") + '</td>' +
      '<td style="padding:6px; font-size:12px; text-align:right; vertical-align:top;">₦' + moneyValue(item.unitPrice) + '</td>' +
      '<td style="padding:6px; font-size:12px; text-align:right; font-weight:700; vertical-align:top;">₦' + moneyValue((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)) + '</td></tr>'
    );
  }

  let bodyRowsHtml = "";
  if (mode === "grouped") {
    const seenGroups = [];
    lineItems.forEach(function (item) {
      const g = item.groupName || "";
      if (seenGroups.indexOf(g) === -1) seenGroups.push(g);
    });
    seenGroups.forEach(function (g) {
      if (g) bodyRowsHtml += '<tr><td colspan="5" style="padding:8px 6px 4px; font-weight:800; text-transform:uppercase; font-size:12.5px;">' + escapeHtml(g) + '</td></tr>';
      lineItems.filter(function (item) { return (item.groupName || "") === g; }).forEach(function (item) { bodyRowsHtml += rowHtml(item); });
      const groupTotal = totals.groups[g] || 0;
      bodyRowsHtml += '<tr><td colspan="4" style="text-align:right; padding:6px; font-weight:700; font-size:12px;">Subtotal</td><td style="text-align:right; padding:6px; font-weight:700; font-size:12px; border-bottom:1px solid #000;">₦' + moneyValue(groupTotal) + '</td></tr>';
    });
  } else {
    lineItems.forEach(function (item) { bodyRowsHtml += rowHtml(item); });
  }

  const summaryRows = [];
  summaryRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; font-weight:700;"><span>Subtotal :</span><span>₦' + moneyValue(totals.subtotal) + '</span></div>');
  if (discountEnabled) {
    summaryRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span>Discount :</span><span>₦' + moneyValue(discountAmount) + '</span></div>');
    summaryRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; font-weight:700; border-top:1px solid #000;"><span>Subtotal :</span><span>₦' + moneyValue(totals.afterDiscount) + '</span></div>');
  }
  summaryRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span>VAT :</span><span>₦' + moneyValue(totals.vat) + '</span></div>');
  summaryRows.push('<div style="display:flex; justify-content:space-between; padding:8px 0; font-size:16px; font-weight:900; border-top:2px solid #000;"><span>Total Due :</span><span>₦' + moneyValue(totals.total) + '</span></div>');

  const signatureHtml = await generateInspectionSignatureBlocks((await _getSignatoryName()) || "Kayode Olubisi");
  const addressLines = String(est.clientAddress || "").split("\n").map(escapeHtml).join("<br>");

  return (
    '<div class="report-page-wrapper"><div class="report-content" style="padding-bottom:22mm;">' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:20px;">' +
    '<div style="font-size:12px;"><div><strong>Invoice No:</strong> ' + escapeHtml(invoiceNumber) + '</div>' +
    '<div><strong>Date:</strong> ' + escapeHtml(new Date().toLocaleDateString()) + '</div></div>' +
    '<div style="text-align:right; flex-shrink:0;">' +
    (logoUrl ? '<img src="' + escapeAttr(logoUrl) + '" style="max-height:' + Math.round(80 * logoSizeFactor) + 'px; max-width:' + Math.round(200 * logoSizeFactor) + 'px; object-fit:contain;" onerror="this.style.display=\'none\'">' : "") +
    '<div style="font-size:10px; color:#495057; margin-top:4px;">' + contactLine + '<br>' + escapeHtml(contactLine2) + '</div></div></div>' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:18px;">' +
    '<div style="font-size:12px; line-height:1.6; max-width:45mm; overflow-wrap:break-word;"><strong style="font-size:14px;">' + escapeHtml(est.clientName || "") + '</strong><br>' + addressLines + '</div>' +
    '<div style="font-size:28px; font-weight:900; letter-spacing:1px;">INVOICE</div></div>' +
    '<table style="width:100%; border-collapse:collapse; margin-top:16px;"><thead><tr>' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Description</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Qty</th>' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Unit</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Unit Price</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Amount</th>' +
    '</tr></thead><tbody>' + bodyRowsHtml + '</tbody></table>' +
    '<div style="max-width:320px; margin:14px 0 0 auto;">' + summaryRows.join("") + '</div>' +
    signatureHtml +
    '</div>' + generateReportFooter() + '</div>'
  );
}
