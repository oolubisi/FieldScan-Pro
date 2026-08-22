// ===== projects.js =====
// Project-core UI logic: the dashboard project list, the project console
// hub, project attachments, scope editing, PCR fields, trash/archive, and
// invoice generation. Consolidated from dashboard.js and console.js during
// a codebase organization pass -- Projects are the central entity in this
// app, but previously had no dedicated frontend home of their own, unlike
// Clients, Estimates, or Tasks. Snags, Work Orders, Payments, and Progress
// Logs remain in console.js -- they're genuinely separate entities that
// just happen to share the same project console hub UI, not project-core
// logic themselves.

async function refreshMasterDashboard() {
  const container = document.getElementById("project-master-list");
  if (container)
    container.innerHTML =
      '<p style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading projects...</p>';
  try {
    const projects = await callApi("getProjects", {});
    console.log("getProjects response:", projects);

    const cache = getCache();

    // FIX: If server returns empty array but cache has projects, preserve cache
    if (
      Array.isArray(projects) &&
      projects.length === 0 &&
      Array.isArray(cache.projects) &&
      cache.projects.length > 0
    ) {
      console.warn(
        "Server returned empty projects; rendering from cache:",
        cache.projects.length,
        "projects",
      );
      if (typeof showSyncToast === "function")
        showSyncToast("⚠️ Showing saved data — could not confirm with server");
      renderProjects();
      return;
    }

    if (!Array.isArray(projects)) {
      console.error("getProjects returned non-array:", projects);
      // FIX: Try to render from cache instead of showing error
      if (Array.isArray(cache.projects) && cache.projects.length > 0) {
        console.warn("Rendering from cache instead");
        if (typeof showSyncToast === "function")
          showSyncToast("⚠️ Showing saved data — could not confirm with server");
        renderProjects();
        return;
      }
      if (container)
        container.innerHTML =
          '<p style="text-align:center;padding:20px;color:red;">Server returned invalid data. Check console.</p>';
      return;
    }
    cache.projects = projects;
    setCache(cache);
    renderProjects();
  } catch (e) {
    console.error("refreshMasterDashboard error:", e);
    // FIX: On error, try to render from existing cache
    const cache = getCache();
    if (Array.isArray(cache.projects) && cache.projects.length > 0) {
      console.warn(
        "Network error; rendering from cache:",
        cache.projects.length,
        "projects",
      );
      if (typeof showSyncToast === "function")
        showSyncToast("⚠️ Offline — showing saved data");
      renderProjects();
      return;
    }
    if (container)
      container.innerHTML =
        '<p style="text-align:center;padding:20px;color:red;">Failed to load projects. Check your connection.</p>';
  }
}

const PROJECT_STATUS_COLORS = {
  "Active": "var(--success)",
  "Handed Over": "var(--muted)",
  "Abandoned": "var(--danger)",
};

let dashHandedOverExpanded = false;
let dashArchivedProjectsExpanded = false;

function renderProjects() {
  if (typeof renderDashboardSummary === "function") renderDashboardSummary();
  const container = document.getElementById("project-master-list");
  const searchEl = document.getElementById("search-projects");
  if (!container || !searchEl) return;
  const term = searchEl.value.toLowerCase();
  const cache = getCache();
  if (!Array.isArray(cache.projects)) {
    console.error(
      "renderProjects: cache.projects is not an array",
      cache.projects,
    );
    container.innerHTML =
      '<p style="text-align:center;padding:20px;color:red;">Data error: projects corrupted. Try Refresh.</p>';
    return;
  }
  const filtered = cache.projects.filter(
    (p) =>
      p &&
      (p.clientName?.toLowerCase().includes(term) ||
        p.projectId?.toLowerCase().includes(term)),
  );
  if (!filtered.length) {
    container.innerHTML = term
      ? '<p style="text-align:center;padding:20px; color:var(--muted);">No projects match your search.</p>'
      : '<p style="text-align:center;padding:20px; color:var(--muted);">No projects yet — build or accept an Estimate, then create a project from it.</p>';
    return;
  }
  try {
    // Archived is purely a manual declutter flag, orthogonal to status --
    // pulled out of BOTH the active and Handed Over groups into its own
    // section, same collapsed-by-default pattern as Handed Over.
    const notArchived = filtered.filter((p) => !p.archived);
    const archivedProjects = filtered.filter((p) => p.archived);
    const active = notArchived.filter((p) => p.projectStatus !== "Handed Over");
    const handedOver = notArchived.filter((p) => p.projectStatus === "Handed Over");

    const activeHtml = active.length
      ? active.map(dashProjectCardHtml).join("")
      : '<p style="text-align:center;padding:20px;color:var(--muted);">No projects match this filter.</p>';

    const handedOverHtml = handedOver.length
      ? '<div style="margin-top:16px;">' +
        '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.dashToggleHandedOverExpanded()">' +
        '<i class="fas ' + (dashHandedOverExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> Handed Over (' + handedOver.length + ')' +
        '</div>' +
        (dashHandedOverExpanded ? handedOver.map(dashProjectCardHtml).join("") : "") +
        '</div>'
      : "";

    // A plain block-level div outside the card grid/flex flow, same as
    // Handed Over above -- naturally starts on its own row underneath
    // everything else, no extra layout work needed.
    const archivedHtml = archivedProjects.length
      ? '<div style="margin-top:16px;">' +
        '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.dashToggleArchivedProjectsExpanded()">' +
        '<i class="fas ' + (dashArchivedProjectsExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> <i class="fas fa-box-archive"></i> Archived (' + archivedProjects.length + ')' +
        '</div>' +
        (dashArchivedProjectsExpanded ? archivedProjects.map(dashProjectCardHtml).join("") : "") +
        '</div>'
      : "";

    container.innerHTML = activeHtml + handedOverHtml + archivedHtml;
  } catch (e) {
    console.error("renderProjects error:", e);
    container.innerHTML =
      '<p style="text-align:center;padding:20px;color:red;">Error rendering projects. Check console.</p>';
  }
}

function dashToggleArchivedProjectsExpanded() {
  dashArchivedProjectsExpanded = !dashArchivedProjectsExpanded;
  renderProjects();
}
window.dashToggleArchivedProjectsExpanded = dashToggleArchivedProjectsExpanded;

function dashProjectCardHtml(p) {
  const statusColor = PROJECT_STATUS_COLORS[p.projectStatus] || "var(--muted)";
  return `<div class="card" data-project-id="${escapeAttr(p.projectId)}" onclick="window.loadProjectConsoleHub('${escapeAttr(p.projectId)}')" style="border-left:5px solid ${statusColor}; cursor:pointer;"><strong style="font-size:20px;">${escapeHtml(p.clientName)}</strong><div style="font-size:12px; color:var(--muted); margin-top:4px;">${escapeHtml(p.displayNumber || p.projectId)}</div></div>`;
}

function dashToggleHandedOverExpanded() {
  dashHandedOverExpanded = !dashHandedOverExpanded;
  renderProjects();
}
window.dashToggleHandedOverExpanded = dashToggleHandedOverExpanded;


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
