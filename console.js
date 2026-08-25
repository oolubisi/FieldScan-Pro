// ===== console.js =====
// Snags, Work Orders, Payments, and Progress Logs -- entities that share
// the project console hub UI, but are managed here as their own separate
// modules. Project-core logic (loadProjectConsoleHub, attachments, scope,
// PCR, trash/archive, invoicing) moved to projects.js during a codebase
// organization pass.



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


// Add delete function for progress logs
async function deleteProgressLog(logId) {
  if (!confirm("Delete this progress log?")) return;
  try {
    await callApi("deleteProgressLog", { logId });
    const cache = getCache();
    cache.progressLogs = (cache.progressLogs || []).filter(
      (l) => l.logId !== logId,
    );
    setCache(cache);
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
          return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--card-light); ${idx === g.stages.length - 1 ? "border-bottom:none;" : ""}"><div style="display:flex; align-items:center; gap:8px;"><input type="checkbox" style="width:auto; margin:0;" ${paymentSelectedIds.has(s.paymentId) ? "checked" : ""} onclick="event.stopPropagation(); window.paymentToggleSelect('${escapeAttr(s.paymentId)}')"><div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="event.stopPropagation(); window.openModalWithRecord('payment', window.modalRecordCache['${key}'])"><span style="font-size:11px; font-weight:900; background:var(--primary); color:#fff; padding:2px 8px; border-radius:4px; text-transform:uppercase;">${s.stage ? "Stage " + escapeHtml(s.stage) : "Full"}</span><span style="font-size:13px; color:var(--muted);">${escapeHtml(typeof ymd === "function" ? ymd(s.paymentDate) : String(s.paymentDate || "").slice(0, 10))}</span></div></div><span style="font-size:14px; font-weight:900; color:${incoming ? "var(--success)" : "var(--danger)"}; cursor:pointer;" onclick="event.stopPropagation(); window.openModalWithRecord('payment', window.modalRecordCache['${key}'])">${incoming ? "+" : "-"}₦${moneyValue(s.amount)}</span></div>`;
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
      date: typeof ymd === "function" ? ymd(record.paymentDate) : String(record.paymentDate || "").slice(0, 10),
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
    return `<div class="card" style="border-left:6px solid ${color}; cursor:pointer; margin-left:24px; margin-top:8px;" onclick="window.openModalWithRecord('progress_entry', window.modalRecordCache['${key}'])">
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
        return `<div class="card" style="border-left:6px solid ${color}; cursor:pointer;" onclick="window.openModalWithRecord('progress_entry', window.modalRecordCache['${key}'])">
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
      </div>` + children.map(subLogCardHtml).join("");
      })
      .join("") +
    `</div>`;
}

window.loadProgressTimelineFeed = loadProgressTimelineFeed;
window.getProjectProgressCompletion = getProjectProgressCompletion;

