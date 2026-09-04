// ===== estimates.js =====
// Desktop-only creation/editing; mobile can view, print, and comment.
// An accepted estimate can spin off a new Project. Line items are drawn
// from a searchable BOQ (Bill of Quantities) database - cached locally
// for fast/offline search, synced to its own sheet so it's shared across
// devices/sessions. A BOQ entry is either a single reusable line ("item")
// or a template block of several lines under one heading ("group", e.g.
// "A/C Group").

let estimatesList = [];
let boqItemsList = [];
let currentEstimateLineItems = [];
let estDiscountEnabled = false;

async function initEstimatesPage() {
  const container = document.getElementById("estimates-list-view");
  if (container)
    container.innerHTML = '<div class="card"><span style="font-size:13px; color:var(--muted);">Loading estimates...</span></div>';
  const cache = getCache();
  const needClients = !cache.clients || !cache.clients.length;
  const needUnits = !cache.units || !cache.units.length;

  // These four calls are independent of each other -- awaiting them one at
  // a time meant each one waited for the previous to fully round-trip
  // before even starting, which stacks up fast on Apps Script's per-call
  // latency. Firing them together cuts load time to roughly the slowest
  // single call instead of the sum of all four.
  const results = await Promise.allSettled([
    callApi("getEstimates", {}),
    callApi("getBOQItems", {}),
    needClients ? callApi("getClients", {}) : Promise.resolve(null),
    needUnits ? callApi("getUnits", {}) : Promise.resolve(null),
  ]);
  const estimatesResult = results[0];
  const boqResult = results[1];
  const clientsResult = results[2];
  const unitsResult = results[3];

  if (estimatesResult.status === "fulfilled") {
    estimatesList = Array.isArray(estimatesResult.value) ? estimatesResult.value : [];
    cache.estimates = estimatesList;
  } else {
    console.error("getEstimates failed", estimatesResult.reason);
    estimatesList = cache.estimates || [];
  }

  if (boqResult.status === "fulfilled") {
    boqItemsList = Array.isArray(boqResult.value) ? boqResult.value : [];
    cache.boqItems = boqItemsList;
  } else {
    console.error("getBOQItems failed", boqResult.reason);
    boqItemsList = cache.boqItems || [];
  }

  if (needClients) {
    if (clientsResult.status === "fulfilled") {
      cache.clients = Array.isArray(clientsResult.value) ? clientsResult.value : [];
    } else {
      console.error("getClients failed", clientsResult.reason);
    }
  }

  if (needUnits) {
    if (unitsResult.status === "fulfilled") {
      cache.units = Array.isArray(unitsResult.value) ? unitsResult.value : [];
    } else {
      console.error("getUnits failed", unitsResult.reason);
    }
  }

  setCache(cache);
  renderEstimatesPage();
}
window.initEstimatesPage = initEstimatesPage;

let estArchivedExpanded = false;

function renderEstimatesPage() {
  const container = document.getElementById("estimates-list-view");
  if (!container) return;
  const sorted = [...estimatesList].sort((a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0));
  const notArchived = sorted.filter((e) => !e.archived);
  const archived = sorted.filter((e) => e.archived);

  const cardsHtml = notArchived.length
    ? '<div class="console-cards-grid">' + notArchived.map(estimateCardHtml).join("") + '</div>'
    : (archived.length
        ? '' // nothing active, but there ARE archived ones -- skip the "no estimates" message, the archive section below covers it
        : '<p style="text-align:center; padding:20px; color:var(--muted);">No estimates yet — use "New Estimate" above to create one.</p>');

  // Plain block-level div outside the card grid -- starts on its own
  // row underneath, same pattern as the dashboard's Archived Projects
  // section, collapsed by default.
  const archivedHtml = archived.length
    ? '<div style="margin-top:16px;">' +
      '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.toggleEstimatesArchivedExpanded()">' +
      '<i class="fas ' + (estArchivedExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> <i class="fas fa-box-archive"></i> Archived (' + archived.length + ')' +
      '</div>' +
      (estArchivedExpanded ? '<div class="console-cards-grid">' + archived.map(estimateCardHtml).join("") + '</div>' : "") +
      '</div>'
    : "";

  container.innerHTML =
    (isElectronApp
      ? '<div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap; justify-content:flex-end;">' +
        '<button class="action-btn" style="width:auto; padding:0 20px; background:var(--card-light); color:var(--text);" onclick="window.openBOQManagerModal()">' +
        '<i class="fas fa-database"></i> BOQ Library</button>' +
        '<button class="action-btn" style="width:auto; padding:0 20px;" onclick="window.openEstimateModal(null)">' +
        '<i class="fas fa-plus"></i> New Estimate</button></div>'
      : '') +
    cardsHtml + archivedHtml;
}

function toggleEstimatesArchivedExpanded() {
  estArchivedExpanded = !estArchivedExpanded;
  renderEstimatesPage();
}
window.toggleEstimatesArchivedExpanded = toggleEstimatesArchivedExpanded;

const EST_STATUS_COLORS = {
  Draft: "var(--muted)",
  Sent: "#0056b3",
  Accepted: "var(--success)",
  Declined: "var(--danger)",
};

function estimateCardHtml(est) {
  const key = "estimate:" + est.estimateId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = est;
  const totals = estComputeTotals(safeParseJsonArray(est.lineItems), est.subtotalMode, Number(est.discountAmount) || 0, String(est.discountEnabled) === "true");
  let actionsHtml = isElectronApp
    ? '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.openEstimateModal(window.modalRecordCache[\'' + key + '\'])">' +
      '<i class="fas fa-edit"></i> Edit</button>' +
      '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.duplicateEstimate(\'' + escapeAttr(est.estimateId) + '\')">' +
      '<i class="fas fa-copy"></i> Duplicate</button>' +
      '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--primary);" onclick="window.previewEstimateReport(\'' + escapeAttr(est.estimateId) + '\')">' +
      '<i class="fas fa-print"></i> Print</button>'
    : '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.viewEstimateMobile(\'' + escapeAttr(est.estimateId) + '\')">' +
      '<i class="fas fa-eye"></i> View</button>';
  if (est.status === "Accepted" && !est.projectIdCreated) {
    actionsHtml +=
      '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--success);" onclick="window.createProjectFromEstimate(\'' + escapeAttr(est.estimateId) + '\')">' +
      '<i class="fas fa-arrow-right"></i> Create Project</button>';
  } else if (est.projectIdCreated) {
    actionsHtml += '<span style="font-size:11px; color:var(--success); font-weight:800; align-self:center;"><i class="fas fa-check-circle"></i> Project ' + escapeHtml(est.projectIdCreated) + '</span>';
  }
  actionsHtml +=
    '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.toggleArchiveEstimate(\'' + escapeAttr(est.estimateId) + '\')">' +
    (est.archived ? '<i class="fas fa-box-open"></i> Unarchive' : '<i class="fas fa-box-archive"></i> Archive') + '</button>';
  return (
    '<div class="card" style="border-left:6px solid ' + (EST_STATUS_COLORS[est.status] || "var(--muted)") + ';">' +
    '<div style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;">' + escapeHtml(est.estimateNumber || "DRAFT") + ' — ' + escapeHtml(est.status || "Draft") + '</div>' +
    '<strong style="font-size:16px;">' + escapeHtml(est.clientName || "Untitled") + '</strong><br>' +
    '<span style="font-size:13px; color:var(--muted);">' +
    (est.estimateDate ? escapeHtml(new Date(est.estimateDate).toLocaleDateString()) : "") +
    (est.validUntilDate ? " · Valid until " + escapeHtml(new Date(est.validUntilDate).toLocaleDateString()) : "") +
    '</span><br>' +
    '<span style="font-size:15px; font-weight:800;">₦' + moneyValue(totals.total) + '</span>' +
    '<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">' + actionsHtml + '</div></div>'
  );
}

function safeParseJsonArray(str) {
  if (Array.isArray(str)) return str;
  try {
    const parsed = JSON.parse(str || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function estComputeTotals(lineItems, subtotalMode, discountAmount, discountEnabled) {
  const groups = {};
  let subtotal = 0;
  lineItems.forEach((item) => {
    const amt = roundMoney((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
    subtotal = roundMoney(subtotal + amt);
    const gKey = item.groupName || "";
    groups[gKey] = roundMoney((groups[gKey] || 0) + amt);
  });
  const afterDiscount = discountEnabled ? roundMoney(subtotal - discountAmount) : subtotal;
  const vatRate = typeof getTaxRate === "function" ? getTaxRate("VAT") || 0.075 : 0.075;
  const vat = roundMoney(afterDiscount * vatRate);
  const total = roundMoney(afterDiscount + vat);
  return { subtotal: subtotal, groups: groups, afterDiscount: afterDiscount, vatRate: vatRate, vat: vat, total: total };
}

/**
 * Draft -> Sent -> (Accepted | Declined). No skipping straight from Draft
 * to a terminal state, and Accepted/Declined are terminal (no further
 * transitions offered) — matches the numbering rule too, since the real
 * estimate number is only issued the moment status first leaves Draft.
 */
function estGetAllowedStatuses(currentStatus) {
  if (!currentStatus || currentStatus === "Draft") return ["Draft", "Sent"];
  if (currentStatus === "Sent") return ["Sent", "Accepted", "Declined"];
  return [currentStatus];
}

// Called by clients.js after a client is added/edited from inside the
// Estimate editor, so the client dropdown reflects it without a full page reload.
function estOnClientsRefreshed() {
  const select = document.getElementById("est_client_select");
  if (!select) return; // editor isn't open right now
  const cache = getCache();
  const clients = (cache.clients || []).filter((c) => !(String(c.archived).toLowerCase() === "yes" || c.archived === true));
  const currentValue = select.value;
  select.innerHTML =
    '<option value="">-- Select Client --</option>' +
    clients
      .map(function (c) {
        return '<option value="' + escapeAttr(c.clientId) + '">' + escapeHtml(c.name) + '</option>';
      })
      .join("");
  // Prefer selecting the newest client (just added) if nothing was picked yet.
  if (currentValue && select.querySelector('option[value="' + CSS.escape(currentValue) + '"]')) {
    select.value = currentValue;
  } else if (!currentValue && clients.length) {
    select.value = clients[clients.length - 1].clientId;
  }
}
window.estOnClientsRefreshed = estOnClientsRefreshed;

// ===== new/edit modal (desktop only) =====

/**
 * Fills the app's own white content area (the space beside the sidebar in
 * the Electron window) rather than opening as a small centered dialog with
 * a dark backdrop — same treatment as the BOQ Library panel. Returns the
 * panel element; body/footer content go into the returned ids.
 */
function openFullPagePanel(panelId, panelTitle) {
  let overlay = document.getElementById(panelId);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = panelId;
    overlay.className = "full-page-panel";
    overlay.style.cssText = "position:absolute; inset:0; background:#fff; z-index:2000; display:flex; flex-direction:column; overflow:hidden;";
    const mainContent = document.querySelector(".main") || document.body;
    mainContent.style.position = mainContent.style.position || "relative";
    mainContent.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--border); flex-shrink:0;">' +
    '<h3 style="margin:0;">' + escapeHtml(panelTitle) + '</h3>' +
    '<span onclick="window.closeFullPagePanel(\'' + panelId + '\')" style="cursor:pointer; font-size:22px; padding:0 6px; color:var(--muted);">&times;</span></div>' +
    '<div id="' + panelId + '-body" style="flex:1; overflow-y:auto; padding:20px;"></div>' +
    '<div id="' + panelId + '-footer" style="padding:14px 20px; border-top:1px solid var(--border); flex-shrink:0; display:flex; gap:10px;"></div>';
  return overlay;
}

function closeFullPagePanel(panelId) {
  const el = document.getElementById(panelId);
  if (el) el.remove();
}
window.closeFullPagePanel = closeFullPagePanel;

function openEstimateModal(editData) {
  editData = editData || null;
  const isEdit = !!editData;
  const isLocked = isEdit && !!editData.projectId;
  const cache = getCache();
  const settings = cache.settings && cache.settings.data ? cache.settings.data : cache.settings || {};
  const validityDays = Number(settings.EstimateValidityDays) || 7;
  const currentClientIdForFilter = isEdit ? editData.clientId || "" : "";
  const clients = (cache.clients || []).filter(
    (c) => c.clientId === currentClientIdForFilter || !(String(c.archived).toLowerCase() === "yes" || c.archived === true),
  );

  currentEstimateLineItems = isEdit ? safeParseJsonArray(editData.lineItems) : [];
  estLastFocusedIndex = -1;
  estDiscountEnabled = isEdit ? String(editData.discountEnabled) === "true" : false;

  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultValidUntil = new Date(Date.now() + validityDays * 86400000).toISOString().slice(0, 10);

  const panelId = "estimate-editor-panel";
  openFullPagePanel(panelId, isEdit ? "Edit Estimate" : "New Estimate");
  const body = document.getElementById(panelId + "-body");
  const footer = document.getElementById(panelId + "-footer");
  const labelStyle = 'style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;"';
  const largeInput = "width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;";

  const currentStatus = isEdit ? editData.status || "Draft" : "Draft";
  const allowedStatuses = estGetAllowedStatuses(currentStatus);
  const statusOptions = allowedStatuses
    .map(function (s) {
      return '<option value="' + s + '" ' + (s === currentStatus ? "selected" : "") + '>' + s + '</option>';
    })
    .join("");

  const currentClientId = isEdit ? editData.clientId || "" : "";
  const clientOptions =
    '<option value="">-- Select Client --</option>' +
    clients
      .map(function (c) {
        return '<option value="' + escapeAttr(c.clientId) + '" ' + (c.clientId === currentClientId ? "selected" : "") + '>' + escapeHtml(c.name) + '</option>';
      })
      .join("") +
    // Legacy fallback: an older estimate saved before Clients existed has
    // a clientName/clientAddress but no matching clientId — keep it
    // selectable/visible rather than silently losing it.
    (isEdit && editData.clientName && !currentClientId
      ? '<option value="__legacy__" selected>' + escapeHtml(editData.clientName) + ' (not in Clients list)</option>'
      : "");

  body.innerHTML =
    '<input type="hidden" id="est_id" value="' + escapeAttr(isEdit ? editData.estimateId : "") + '">' +
    '<input type="hidden" id="est_legacy_client_name" value="' + escapeAttr(isEdit ? editData.clientName || "" : "") + '">' +
    '<input type="hidden" id="est_legacy_client_address" value="' + escapeAttr(isEdit ? editData.clientAddress || "" : "") + '">' +
    '<label ' + labelStyle + '>Client</label>' +
    '<div style="display:flex; gap:8px; align-items:center;">' +
    '<select id="est_client_select" style="' + largeInput + ' flex:1;">' + clientOptions + '</select>' +
    '<button type="button" class="action-btn" style="width:auto; padding:12px 14px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.openClientModal(null)">+ New</button>' +
    '</div>' +
    '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-top:10px;">' +
    '<div><label ' + labelStyle + '>Date</label><input id="est_date" type="date" value="' + escapeAttr(isEdit && editData.estimateDate ? editData.estimateDate : todayStr) + '" ' + largeInput + '></div>' +
    '<div><label ' + labelStyle + '>Valid Until</label><input id="est_valid_until" type="date" value="' + escapeAttr(isEdit && editData.validUntilDate ? editData.validUntilDate : defaultValidUntil) + '" ' + largeInput + '></div>' +
    '<div><label ' + labelStyle + '>Status</label><select id="est_status" ' + largeInput + '>' + statusOptions + '</select></div>' +
    '<div><label ' + labelStyle + '>Estimate Number</label><input value="' + escapeAttr(isEdit && editData.estimateNumber ? editData.estimateNumber : "Assigned once sent") + '" disabled style="' + largeInput + ' background:#f0f0f0;"></div>' +
    '</div>' +
    '<label ' + labelStyle + '>Header Line <span style="font-weight:400; color:var(--muted); font-size:12px;">(printed just below the column headers, above the line items)</span></label>' +
    '<input id="est_header_line" value="' + escapeAttr(isEdit ? editData.headerLine || "" : "") + '" placeholder="e.g. POP Ceiling - Dining, Anteroom, Stairs Lobby" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Subtotals</label>' +
    '<div style="display:flex; gap:14px; margin-bottom:6px;">' +
    '<label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:13px; cursor:pointer;">' +
    '<input type="radio" name="est_subtotal_mode" value="single" style="width:auto;" ' + (!isEdit || editData.subtotalMode !== "grouped" ? "checked" : "") + ' onchange="window.renderEstLineItemsTable()"> One subtotal for the whole estimate</label>' +
    '<label style="display:flex; align-items:center; gap:5px; font-weight:700; font-size:13px; cursor:pointer;">' +
    '<input type="radio" name="est_subtotal_mode" value="grouped" style="width:auto;" ' + (isEdit && editData.subtotalMode === "grouped" ? "checked" : "") + ' onchange="window.renderEstLineItemsTable()"> Subtotal per group</label>' +
    '</div>' +
    '<div style="overflow-x:auto; margin-top:8px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr style="background:#000; color:#fff;">' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase;">Description</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; width:70px;">Qty</th>' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase; width:70px;">Unit</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; width:100px;">Unit Price</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; width:100px;">Amount</th>' +
    '<th style="width:30px;"></th></tr></thead><tbody id="est_line_items_body"></tbody></table></div>' +
    '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">' +
    '<button type="button" class="action-btn" style="width:auto; padding:8px 14px; font-size:12px;" onclick="window.estAddLineItem()"><i class="fas fa-plus"></i> Add Line</button>' +
    '<button type="button" class="action-btn" style="width:auto; padding:8px 14px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.estOpenGroupPicker()"><i class="fas fa-layer-group"></i> Add Group Block</button>' +
    '<button type="button" class="action-btn" style="width:auto; padding:8px 14px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.estAddBlankGroup()"><i class="fas fa-plus"></i> Add Blank Group</button>' +
    '</div>' +
    '<div style="max-width:340px; margin:16px 0 0 auto;">' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span>Subtotal</span><span id="est-disp-subtotal">₦0.00</span></div>' +
    '<label style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:12px; cursor:pointer; margin-top:8px;">' +
    '<input type="checkbox" id="est_discount_enabled" style="width:auto;" ' + (estDiscountEnabled ? "checked" : "") + ' onchange="window.estOnDiscountToggle()">' +
    'Apply discount (hidden from printout by default)</label>' +
    '<div id="est_discount_wrap" style="display:' + (estDiscountEnabled ? "block" : "none") + '; margin-top:6px;">' +
    '<label style="font-size:12px; font-weight:700;">Discount Amount (₦)</label>' +
    '<input id="est_discount_amount" type="number" step="0.01" value="' + escapeAttr(isEdit && editData.discountAmount ? editData.discountAmount : 0) + '" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;" oninput="window.estRecalcTotals()">' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; margin-top:6px;"><span>Subtotal after discount</span><span id="est-disp-subtotal2">₦0.00</span></div>' +
    '</div>' +
    '<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span id="est-disp-vat-label">VAT (7.5%)</span><span id="est-disp-vat">₦0.00</span></div>' +
    '<div style="display:flex; justify-content:space-between; padding:8px 0; font-size:16px; font-weight:900; border-top:2px solid #000; margin-top:4px;"><span>Total</span><span id="est-disp-total">₦0.00</span></div>' +
    '</div>' +
    '<label style="display:flex; align-items:center; gap:8px; margin-top:14px; cursor:pointer; font-weight:800;">' +
    '<input type="checkbox" id="est_show_account_details" ' + (isEdit && editData.showAccountDetails === false ? "" : "checked") + ' style="width:auto;">' +
    'Show account details on printed estimate</label>' +
    '<label ' + labelStyle + '>Please Note: <span style="font-weight:400; color:var(--muted); font-size:12px;">(conditions — one per line, numbered automatically)</span></label>' +
    '<textarea id="est_conditions" rows="4" ' + largeInput + '>' + escapeHtml(isEdit ? editData.conditions || "" : "") + '</textarea>';

  if (isLocked) {
    const linkedProject = (cache.projects || []).find(function (p) { return p.projectId === editData.projectId; });
    const projectLabel = linkedProject ? (linkedProject.displayNumber || linkedProject.projectId) : editData.projectId;
    body.innerHTML =
      '<div style="background:#fff3cd; border:1px solid #ffc107; border-radius:8px; padding:12px 14px; margin-bottom:16px; font-size:13px; font-weight:700; color:#856404;">' +
      '<i class="fas fa-lock"></i> This estimate has already created Project ' + escapeHtml(projectLabel) + ' and can no longer be edited.' +
      '</div>' +
      '<div style="pointer-events:none; opacity:0.6;">' + body.innerHTML + '</div>';
  }

  renderEstLineItemsTable();

  const submit = document.createElement("button");
  submit.className = "action-btn";
  submit.style.cssText = "flex:1;";
  footer.appendChild(submit);

  if (isEdit) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "action-btn";
    deleteBtn.style.cssText = "width:auto; background:var(--danger);";
    deleteBtn.innerText = "Delete";
    footer.appendChild(deleteBtn);
    deleteBtn.onclick = function () {
      if (confirm("Delete this estimate?")) {
        deleteBtn.disabled = true;
        callApi("deleteEstimate", { estimateId: editData.estimateId }).then(function () {
          estimatesList = estimatesList.filter(function (e) { return e.estimateId !== editData.estimateId; });
          const cache2 = getCache();
          cache2.estimates = estimatesList;
          setCache(cache2);
          closeFullPagePanel(panelId);
          renderEstimatesPage();
        }).catch(function (e) {
          const message = e && e.message ? e.message : "";
          if (message.includes("404") || message.toLowerCase().includes("not found")) {
            // Already gone server-side (e.g. cascade-deleted along with
            // a project that was since purged from Trash, or removed by
            // a bulk clear) -- the local list was just stale. The end
            // state the user wants is already true, so this isn't
            // really a failure worth alarming them about.
            estimatesList = estimatesList.filter(function (est) { return est.estimateId !== editData.estimateId; });
            const cache2 = getCache();
            cache2.estimates = estimatesList;
            setCache(cache2);
            closeFullPagePanel(panelId);
            renderEstimatesPage();
            if (typeof showSyncToast === "function") showSyncToast("Already removed — your local view was out of date");
            return;
          }
          alert("Could not delete: " + (message || "Unknown error"));
          deleteBtn.disabled = false;
        });
      }
    };
  }

  submit.innerText = "Save";

  // Shared by the Save button and the close (x) button's autosave-on-exit
  // — silent=true skips validation alerts and just closes either way,
  // since leaving the editor shouldn't be blocked the way clicking Save
  // deliberately is.
  function attemptSave(silent) {
    const clientSelect = document.getElementById("est_client_select");
    const selectedClientId = clientSelect ? clientSelect.value : "";
    let clientId = "";
    let clientName = "";
    let clientAddress = "";
    if (selectedClientId === "__legacy__") {
      clientName = document.getElementById("est_legacy_client_name").value;
      clientAddress = document.getElementById("est_legacy_client_address").value;
    } else if (selectedClientId) {
      const clientsNow = (getCache().clients || []);
      const selectedClient = clientsNow.find(function (c) { return c.clientId === selectedClientId; });
      if (selectedClient) {
        clientId = selectedClient.clientId;
        clientName = selectedClient.name || "";
        clientAddress = selectedClient.address || "";
      }
    }
    if (!clientName) {
      if (!silent) alert("Select a client");
      return Promise.resolve(false);
    }
    if (!currentEstimateLineItems.length) {
      if (!silent) alert("Add at least one line item");
      return Promise.resolve(false);
    }
    const subtotalMode = document.querySelector('input[name="est_subtotal_mode"]:checked').value;
    submit.disabled = true;
    submit.innerText = "Saving...";
    const discountEl = document.getElementById("est_discount_amount");
    const payload = {
      estimateId: document.getElementById("est_id").value || undefined,
      clientId: clientId,
      clientName: clientName,
      clientAddress: clientAddress,
      estimateDate: document.getElementById("est_date").value,
      validUntilDate: document.getElementById("est_valid_until").value,
      headerLine: document.getElementById("est_header_line").value,
      lineItems: currentEstimateLineItems,
      subtotalMode: subtotalMode,
      discountAmount: Number(discountEl ? discountEl.value : 0) || 0,
      discountEnabled: estDiscountEnabled,
      status: document.getElementById("est_status").value,
      conditions: document.getElementById("est_conditions").value,
      showAccountDetails: document.getElementById("est_show_account_details").checked,
      projectIdCreated: isEdit ? editData.projectIdCreated || "" : "",
    };
    return callApi(isEdit ? "updateEstimate" : "saveEstimate", payload)
      .then(function (resp) {
        const cache2 = getCache();
        const cachedRecord = Object.assign({}, payload, {
          lineItems: JSON.stringify(currentEstimateLineItems),
          discountEnabled: estDiscountEnabled ? "true" : "false",
          estimateNumber: (resp && resp.estimateNumber) || (isEdit ? editData.estimateNumber : "") || "",
        });
        if (isEdit) {
          const idx = estimatesList.findIndex(function (e) { return e.estimateId === editData.estimateId; });
          if (idx !== -1) estimatesList[idx] = Object.assign({}, estimatesList[idx], cachedRecord);
        } else {
          estimatesList.push(Object.assign({}, cachedRecord, { estimateId: (resp && resp.estimateId) || ("EST-" + Date.now()) }));
        }
        cache2.estimates = estimatesList;
        setCache(cache2);
        renderEstimatesPage();
        return true;
      })
      .catch(function (e) {
        if (!silent) alert("Failed to save: " + (e.message || "Unknown error"));
        submit.disabled = false;
        submit.innerText = "Save";
        return false;
      });
  }

  submit.onclick = function () {
    attemptSave(false).then(function (saved) {
      if (saved) closeFullPagePanel(panelId);
    });
  };

  // Autosave on exit — override the panel's default close (x), which would
  // otherwise just discard whatever was typed since the last manual Save.
  const closeIcon = document.querySelector("#" + panelId + " > div:first-child > span");
  if (closeIcon) {
    closeIcon.onclick = function () {
      attemptSave(true).then(function () {
        closeFullPagePanel(panelId);
      });
    };
  }

  // Lock overrides applied last, after Save and the autosave-on-exit
  // behavior above are both fully wired up -- otherwise either one would
  // silently win over an earlier disabled state, since they're assigned
  // further down in this same function.
  if (isLocked) {
    submit.disabled = true;
    submit.innerText = "Locked";
    submit.style.opacity = "0.6";
    submit.onclick = null;
    if (closeIcon) {
      closeIcon.onclick = function () {
        closeFullPagePanel(panelId);
      };
    }
  }
}
window.openEstimateModal = openEstimateModal;

function estOnDiscountToggle() {
  estDiscountEnabled = document.getElementById("est_discount_enabled").checked;
  const wrap = document.getElementById("est_discount_wrap");
  if (wrap) wrap.style.display = estDiscountEnabled ? "block" : "none";
  estRecalcTotals();
}
window.estOnDiscountToggle = estOnDiscountToggle;

// ===== line items table =====

function renderEstLineItemsTable() {
  const tbody = document.getElementById("est_line_items_body");
  if (!tbody) return;
  const modeEl = document.querySelector('input[name="est_subtotal_mode"]:checked');
  const mode = modeEl ? modeEl.value : "single";

  let rowsHtml = "";
  if (mode === "grouped") {
    const seenGroups = [];
    currentEstimateLineItems.forEach(function (item) {
      const g = item.groupName || "";
      if (seenGroups.indexOf(g) === -1) seenGroups.push(g);
    });
    seenGroups.forEach(function (g) {
      if (g) rowsHtml += '<tr><td colspan="6" style="padding:8px 4px 4px;"><span class="est-group-name-label" data-group-name="' + escapeAttr(g) + '" ondblclick="window.estStartRenameGroup(this)" style="font-weight:800; text-decoration:underline; font-size:13px; cursor:text;" title="Double-click to rename">' + escapeHtml(g) + '</span> <i class="fas fa-cloud-arrow-up" style="color:var(--primary); cursor:pointer; font-size:12px; margin-left:6px;" title="Save this group to the BOQ Library" onclick="window.estSaveGroupToLibrary(this.previousElementSibling.dataset.groupName)"></i></td></tr>';
      currentEstimateLineItems.forEach(function (item, idx) {
        if ((item.groupName || "") === g) rowsHtml += estLineRowHtml(item, idx);
      });
      const groupTotal = currentEstimateLineItems
        .filter(function (item) { return (item.groupName || "") === g; })
        .reduce(function (s, item) { return roundMoney(s + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0)); }, 0);
      rowsHtml += '<tr><td colspan="4" style="text-align:right; padding:4px; font-weight:700; font-size:12px; color:var(--muted);">Group Subtotal</td><td style="text-align:right; padding:4px; font-weight:700; font-size:12px;">₦' + moneyValue(groupTotal) + '</td><td></td></tr>';
    });
  } else {
    currentEstimateLineItems.forEach(function (item, idx) {
      rowsHtml += estLineRowHtml(item, idx);
    });
  }

  tbody.innerHTML = rowsHtml || '<tr><td colspan="6" style="text-align:center; padding:14px; color:var(--muted); font-size:12px;">No line items yet.</td></tr>';
  estRecalcTotals();
}
window.renderEstLineItemsTable = renderEstLineItemsTable;

function estUnitOptionsHtml(currentUnit) {
  const cache = getCache();
  const units = cache.units || [];
  const names = units.map(function (u) { return u.name; });
  let options = '<option value=""></option>';
  options += names
    .map(function (name) {
      return '<option value="' + escapeAttr(name) + '" ' + (name === currentUnit ? "selected" : "") + '>' + escapeHtml(name) + '</option>';
    })
    .join("");
  // A unit typed/saved before it existed in the managed list (or since
  // removed) — keep it selectable rather than silently blanking it out.
  if (currentUnit && names.indexOf(currentUnit) === -1) {
    options += '<option value="' + escapeAttr(currentUnit) + '" selected>' + escapeHtml(currentUnit) + '</option>';
  }
  return options;
}

let estDragSourceIndex = null;

function estRowDragStart(ev, index) {
  estDragSourceIndex = index;
  ev.dataTransfer.effectAllowed = "move";
}
window.estRowDragStart = estRowDragStart;

function estRowDragOver(ev) {
  ev.preventDefault(); // required to allow a drop
  ev.dataTransfer.dropEffect = "move";
}
window.estRowDragOver = estRowDragOver;

function estRowDrop(ev, targetIndex) {
  ev.preventDefault();
  if (estDragSourceIndex === null || estDragSourceIndex === targetIndex) return;
  const [moved] = currentEstimateLineItems.splice(estDragSourceIndex, 1);
  // Removing the source item shifts every later index down by one, so
  // correct for that before inserting at the target's position.
  let insertAt = estDragSourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  // Adopt whichever group the row lands in/next to — dragging a line from
  // one group's section into another's should actually move it into that
  // group, not just visually reorder while keeping its old groupName.
  const neighbor = currentEstimateLineItems[insertAt] || currentEstimateLineItems[insertAt - 1];
  moved.groupName = neighbor ? (neighbor.groupName || null) : moved.groupName;
  currentEstimateLineItems.splice(insertAt, 0, moved);
  estDragSourceIndex = null;
  renderEstLineItemsTable();
}
window.estRowDrop = estRowDrop;

function estLineRowHtml(item, index) {
  const amt = roundMoney((Number(item.qty) || 0) * (Number(item.unitPrice) || 0));
  return (
    '<tr style="position:relative;" ondragover="window.estRowDragOver(event)" ondrop="window.estRowDrop(event, ' + index + ')" onfocusin="window.estSetLastFocusedIndex(' + index + ')">' +
    '<td style="padding:4px; border-bottom:1px solid var(--border); position:relative;">' +
    '<div style="display:flex; align-items:center; gap:6px;">' +
    '<i class="fas fa-grip-vertical" draggable="true" ondragstart="window.estRowDragStart(event, ' + index + ')" style="color:var(--muted); cursor:grab; flex-shrink:0;" title="Drag to reorder"></i>' +
    '<div style="flex:1; position:relative;">' +
    '<input value="' + escapeAttr(item.description || "") + '" placeholder="Search BOQ or type a new item..." style="width:100%; padding:6px; font-size:13px; border:1px solid var(--border); border-radius:6px;" ' +
    'oninput="window.estOnDescriptionInput(' + index + ', this.value)" onfocus="window.estOnDescriptionInput(' + index + ', this.value)" onblur="setTimeout(() => window.estHideBoqDropdown(' + index + '), 150)">' +
    '<div id="est-boq-dropdown-' + index + '" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:20; background:#fff; border:1px solid var(--border); border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.18); max-height:180px; overflow-y:auto;"></div>' +
    '</div></div>' +
    '</td>' +
    '<td style="padding:4px; border-bottom:1px solid var(--border);"><input type="number" value="' + escapeAttr(item.qty != null ? item.qty : "") + '" min="0" step="0.01" style="width:100%; padding:6px; font-size:13px; border:1px solid var(--border); border-radius:6px; text-align:right;" oninput="window.estUpdateLineField(' + index + ", 'qty', this.value)\"></td>" +
    '<td style="padding:4px; border-bottom:1px solid var(--border);"><select style="width:100%; padding:6px; font-size:13px; border:1px solid var(--border); border-radius:6px;" onchange="window.estUpdateLineField(' + index + ", 'unit', this.value)\">" + estUnitOptionsHtml(item.unit || "") + "</select></td>" +
    '<td style="padding:4px; border-bottom:1px solid var(--border);"><input type="number" value="' + escapeAttr(item.unitPrice != null ? item.unitPrice : "") + '" min="0" step="0.01" style="width:100%; padding:6px; font-size:13px; border:1px solid var(--border); border-radius:6px; text-align:right;" oninput="window.estUpdateLineField(' + index + ", 'unitPrice', this.value)\"></td>" +
    '<td id="est-amt-' + index + '" style="padding:4px; border-bottom:1px solid var(--border); text-align:right; font-weight:700; font-size:13px;">₦' + moneyValue(amt) + '</td>' +
    '<td style="padding:4px; border-bottom:1px solid var(--border); text-align:center;"><span onclick="window.estRemoveLineItem(' + index + ')" style="cursor:pointer; color:var(--danger);"><i class="fas fa-trash"></i></span></td>' +
    '</tr>'
  );
}

let estLastFocusedIndex = -1;

function estSetLastFocusedIndex(index) {
  estLastFocusedIndex = index;
}
window.estSetLastFocusedIndex = estSetLastFocusedIndex;

/** Where a new insertion should land: right after whichever row last had
 * focus, or at the end if nothing's been focused yet (e.g. an empty estimate). */
function estGetInsertPosition() {
  if (estLastFocusedIndex >= 0 && estLastFocusedIndex < currentEstimateLineItems.length) {
    return estLastFocusedIndex + 1;
  }
  return currentEstimateLineItems.length;
}

/** For inserting a whole new GROUP: lands after the *entire* current group,
 * not just after the single focused row — otherwise a new group could end
 * up spliced into the middle of the one you're currently working in. Scans
 * the whole list for that group's last member rather than assuming its
 * items are contiguous, since drag-reordering could already have them
 * interleaved. */
function estGetGroupBoundaryInsertPosition() {
  if (estLastFocusedIndex < 0 || estLastFocusedIndex >= currentEstimateLineItems.length) {
    return currentEstimateLineItems.length;
  }
  const focusedGroup = currentEstimateLineItems[estLastFocusedIndex].groupName || null;
  if (!focusedGroup) return estLastFocusedIndex + 1; // ungrouped line — just go right after it
  let lastIdx = estLastFocusedIndex;
  currentEstimateLineItems.forEach(function (it, i) {
    if ((it.groupName || null) === focusedGroup) lastIdx = i;
  });
  return lastIdx + 1;
}

function estAddLineItem() {
  const insertAt = estGetInsertPosition();
  const inheritedGroup = insertAt > 0 ? currentEstimateLineItems[insertAt - 1].groupName || null : null;
  currentEstimateLineItems.splice(insertAt, 0, { groupName: inheritedGroup, description: "", qty: 1, unit: "", unitPrice: 0 });
  estLastFocusedIndex = insertAt;
  renderEstLineItemsTable();
}
window.estAddLineItem = estAddLineItem;

function estRemoveLineItem(index) {
  currentEstimateLineItems.splice(index, 1);
  renderEstLineItemsTable();
}
window.estRemoveLineItem = estRemoveLineItem;

function estUpdateLineField(index, field, value) {
  if (!currentEstimateLineItems[index]) return;
  currentEstimateLineItems[index][field] = (field === "qty" || field === "unitPrice") ? (Number(value) || 0) : value;
  if (field === "qty" || field === "unitPrice") {
    const amt = roundMoney((Number(currentEstimateLineItems[index].qty) || 0) * (Number(currentEstimateLineItems[index].unitPrice) || 0));
    const amtCell = document.getElementById("est-amt-" + index);
    if (amtCell) amtCell.innerText = "₦" + moneyValue(amt);
    estRecalcTotals();
  }
}
window.estUpdateLineField = estUpdateLineField;

function estRecalcTotals() {
  const modeEl = document.querySelector('input[name="est_subtotal_mode"]:checked');
  const mode = modeEl ? modeEl.value : "single";
  const discountEl = document.getElementById("est_discount_amount");
  const discountAmount = discountEl ? Number(discountEl.value) || 0 : 0;
  const totals = estComputeTotals(currentEstimateLineItems, mode, discountAmount, estDiscountEnabled);

  const subtotalEl = document.getElementById("est-disp-subtotal");
  if (subtotalEl) subtotalEl.innerText = "₦" + moneyValue(totals.subtotal);
  const subtotal2El = document.getElementById("est-disp-subtotal2");
  if (subtotal2El) subtotal2El.innerText = "₦" + moneyValue(totals.afterDiscount);
  const vatLabelEl = document.getElementById("est-disp-vat-label");
  if (vatLabelEl) vatLabelEl.innerText = "VAT (" + (totals.vatRate * 100).toFixed(1) + "%)";
  const vatEl = document.getElementById("est-disp-vat");
  if (vatEl) vatEl.innerText = "₦" + moneyValue(totals.vat);
  const totalEl = document.getElementById("est-disp-total");
  if (totalEl) totalEl.innerText = "₦" + moneyValue(totals.total);
}
window.estRecalcTotals = estRecalcTotals;

// ===== BOQ search (local, cached) =====

let estSearchPool = [];

function estOnDescriptionInput(index, value) {
  estUpdateLineField(index, "description", value);
  const dropdown = document.getElementById("est-boq-dropdown-" + index);
  if (!dropdown) return;
  const term = value.trim().toLowerCase();
  if (!term) {
    dropdown.style.display = "none";
    return;
  }

  // Standalone items search directly. Group items are nested inside each
  // group's own template, so they don't show up unless we flatten them
  // in too — otherwise search only ever finds items added one at a time
  // via "Add Item", never anything imported/organized as a group.
  const pool = [];
  boqItemsList.forEach(function (b) {
    if (b.type === "item") {
      pool.push({ description: b.description, unit: b.unit, unitPrice: b.unitPrice, groupName: null });
    } else if (b.type === "group") {
      safeParseJsonArray(b.groupItems).forEach(function (gi) {
        pool.push({ description: gi.description, unit: gi.unit, unitPrice: gi.unitPrice, groupName: b.description });
      });
    }
  });

  const matches = pool
    .filter(function (p) { return String(p.description || "").toLowerCase().indexOf(term) !== -1; })
    .slice(0, 8);
  if (!matches.length) {
    dropdown.style.display = "none";
    return;
  }
  estSearchPool = matches;
  dropdown.innerHTML = matches
    .map(function (p, i) {
      return (
        '<div style="padding:8px; font-size:12.5px; cursor:pointer; border-bottom:1px solid var(--border);" onmousedown="window.estSelectBoqSuggestion(' + index + ", " + i + ')">' +
        '<div style="font-weight:700;">' + escapeHtml(p.description) + '</div>' +
        '<div style="color:var(--muted); font-size:11px;">' + escapeHtml(p.unit || "") + ' — ₦' + moneyValue(p.unitPrice) + (p.groupName ? ' · from "' + escapeHtml(p.groupName) + '"' : "") + '</div>' +
        '</div>'
      );
    })
    .join("");
  dropdown.style.display = "block";
}
window.estOnDescriptionInput = estOnDescriptionInput;

function estHideBoqDropdown(index) {
  const dropdown = document.getElementById("est-boq-dropdown-" + index);
  if (dropdown) dropdown.style.display = "none";
}
window.estHideBoqDropdown = estHideBoqDropdown;

function estSelectBoqSuggestion(index, poolIndex) {
  const match = estSearchPool[poolIndex];
  if (!match || !currentEstimateLineItems[index]) return;
  currentEstimateLineItems[index].description = match.description;
  currentEstimateLineItems[index].unit = match.unit || "";
  currentEstimateLineItems[index].unitPrice = Number(match.unitPrice) || 0;
  renderEstLineItemsTable();
}
window.estSelectBoqSuggestion = estSelectBoqSuggestion;

// ===== group blocks =====

function estOpenGroupPicker() {
  const groups = boqItemsList.filter(function (b) { return b.type === "group"; });
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center;";
  const groupsHtml = groups.length
    ? groups.map(function (g) {
        return (
          '<div class="est-group-pick-item" style="padding:10px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; cursor:pointer;" data-boq-id="' + escapeAttr(g.boqItemId) + '">' +
          '<strong>' + escapeHtml(g.description) + '</strong>' +
          '<div style="font-size:11px; color:var(--muted);">' + safeParseJsonArray(g.groupItems).length + ' line item(s)</div>' +
          '</div>'
        );
      }).join("")
    : '<p style="color:var(--muted); font-size:13px;">No group blocks in the BOQ library yet. Add one via BOQ Library.</p>';

  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:20px; max-width:400px; width:90%; max-height:70vh; overflow-y:auto;">' +
    '<h3 style="margin-top:0;">Add Group Block</h3>' + groupsHtml +
    '<button type="button" class="action-btn est-group-pick-cancel" style="margin-top:8px; background:var(--card-light); color:var(--text);">Cancel</button>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector(".est-group-pick-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelectorAll(".est-group-pick-item").forEach(function (el) {
    el.onclick = function () {
      estInsertGroup(el.dataset.boqId);
      overlay.remove();
    };
  });
}
window.estOpenGroupPicker = estOpenGroupPicker;

/**
 * Saves a group currently in the estimate back to the BOQ Library, so it
 * can be reused on future estimates. Quantities are zeroed on the way in
 * — library groups are templates, not a record of what was actually
 * ordered on this specific job.
 */
function estSaveGroupToLibrary(groupName) {
  if (!groupName) return;
  const items = currentEstimateLineItems
    .filter(function (it) { return (it.groupName || "") === groupName; })
    .map(function (it) { return { description: it.description || "", qty: 0, unit: it.unit || "", unitPrice: Number(it.unitPrice) || 0 }; });
  if (!items.length) {
    alert("This group has no line items to save.");
    return;
  }

  const existing = boqItemsList.find(function (b) {
    return b.type === "group" && String(b.description || "").trim().toLowerCase() === groupName.trim().toLowerCase();
  });

  if (existing) {
    if (!confirm('"' + groupName + '" already exists in the BOQ Library. Update it with this estimate\'s current items?')) return;
    callApi("updateBOQItem", { boqItemId: existing.boqItemId, type: "group", description: groupName, groupItems: items })
      .then(function () {
        const idx = boqItemsList.findIndex(function (b) { return b.boqItemId === existing.boqItemId; });
        if (idx !== -1) boqItemsList[idx] = Object.assign({}, boqItemsList[idx], { groupItems: JSON.stringify(items) });
        const cache = getCache();
        cache.boqItems = boqItemsList;
        setCache(cache);
        if (typeof showSyncToast === "function") showSyncToast('"' + groupName + '" updated in the BOQ Library');
      })
      .catch(function (e) { alert("Could not update the library: " + (e.message || "Unknown error")); });
    return;
  }

  callApi("saveBOQItem", { type: "group", description: groupName, groupItems: items })
    .then(function (resp) {
      boqItemsList.push({ boqItemId: resp.boqItemId, type: "group", description: groupName, unit: "", unitPrice: 0, groupItems: JSON.stringify(items) });
      const cache = getCache();
      cache.boqItems = boqItemsList;
      setCache(cache);
      if (typeof showSyncToast === "function") showSyncToast('"' + groupName + '" saved to the BOQ Library');
    })
    .catch(function (e) { alert("Could not save to the library: " + (e.message || "Unknown error")); });
}
window.estSaveGroupToLibrary = estSaveGroupToLibrary;

function estGroupNameExists(name) {
  const target = String(name || "").trim().toLowerCase();
  return currentEstimateLineItems.some(function (it) {
    return String(it.groupName || "").trim().toLowerCase() === target;
  });
}

function estStartRenameGroup(labelEl) {
  const oldName = labelEl.dataset.groupName;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldName;
  input.style.cssText = "font-weight:800; font-size:13px; padding:2px 6px; border:1.5px solid var(--primary); border-radius:6px; width:100%; max-width:320px;";
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  function commit() {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (!newName || newName === oldName) {
      renderEstLineItemsTable(); // no real change (or emptied) — just redraw as before
      return;
    }
    // Renaming into a name that collides with a DIFFERENT existing group
    // isn't allowed, same rule as inserting a duplicate group.
    const collides = currentEstimateLineItems.some(function (it) {
      return String(it.groupName || "").trim().toLowerCase() === newName.toLowerCase() &&
        String(it.groupName || "").trim().toLowerCase() !== oldName.trim().toLowerCase();
    });
    if (collides) {
      alert('"' + newName + '" is already the name of another group in this estimate.');
      renderEstLineItemsTable();
      return;
    }
    currentEstimateLineItems.forEach(function (it) {
      if ((it.groupName || "") === oldName) it.groupName = newName;
    });
    renderEstLineItemsTable();
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") {
      settled = true; // discard without committing
      renderEstLineItemsTable();
    }
  });
}
window.estStartRenameGroup = estStartRenameGroup;

function estInsertGroup(boqItemId) {
  const boqGroup = boqItemsList.find(function (b) { return b.boqItemId === boqItemId; });
  if (!boqGroup) return;
  if (estGroupNameExists(boqGroup.description)) {
    alert('"' + boqGroup.description + '" has already been added to this estimate. A group can only be inserted once.');
    return;
  }
  const items = safeParseJsonArray(boqGroup.groupItems);
  const newItems = items.map(function (tpl) {
    return {
      groupName: boqGroup.description,
      description: tpl.description || "",
      qty: Number(tpl.qty) || 1,
      unit: tpl.unit || "",
      unitPrice: Number(tpl.unitPrice) || 0,
    };
  });
  const insertAt = estGetGroupBoundaryInsertPosition();
  currentEstimateLineItems.splice.apply(currentEstimateLineItems, [insertAt, 0].concat(newItems));
  estLastFocusedIndex = insertAt + newItems.length - 1;
  const groupedRadio = document.querySelector('input[name="est_subtotal_mode"][value="grouped"]');
  if (groupedRadio) groupedRadio.checked = true;
  renderEstLineItemsTable();
}
window.estInsertGroup = estInsertGroup;

function estAddBlankGroup() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:20px; max-width:360px; width:90%;">' +
    '<h3 style="margin-top:0;">Name This Group</h3>' +
    '<input id="est-blank-group-name-input" placeholder="e.g. Miscellaneous" style="width:100%; padding:10px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">' +
    '<div style="display:flex; gap:8px; margin-top:14px;">' +
    '<button type="button" class="action-btn est-blank-group-cancel" style="background:var(--card-light); color:var(--text);">Cancel</button>' +
    '<button type="button" class="action-btn est-blank-group-confirm">Add Group</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#est-blank-group-name-input");
  input.focus();

  const confirmAdd = function () {
    const name = input.value.trim();
    if (!name) return;
    if (estGroupNameExists(name)) {
      alert('"' + name + '" has already been added to this estimate. Choose a different name, or edit the existing group.');
      return;
    }
    const insertAt = estGetGroupBoundaryInsertPosition();
    currentEstimateLineItems.splice(insertAt, 0, { groupName: name, description: "", qty: 1, unit: "", unitPrice: 0 });
    estLastFocusedIndex = insertAt;
    const groupedRadio = document.querySelector('input[name="est_subtotal_mode"][value="grouped"]');
    if (groupedRadio) groupedRadio.checked = true;
    renderEstLineItemsTable();
    overlay.remove();
  };

  overlay.querySelector(".est-blank-group-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelector(".est-blank-group-confirm").onclick = confirmAdd;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") confirmAdd();
  });
}
window.estAddBlankGroup = estAddBlankGroup;

// ===== printable report =====

async function previewEstimateReport(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  if (modalContent) modalContent.classList.remove("modal-fullscreen");
  title.innerText = "Estimate: " + (est.estimateNumber || "Draft");
  overlay.style.display = "flex";

  const html = await renderEstimateReportDoc(est);
  body.innerHTML = '<div id="est-report-preview" style="max-height:60vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">' + html + '</div>';
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) {
    printContainer.innerHTML = html;
  }

  submit.style.display = "block";
  submit.innerText = isElectronApp ? "Print" : "Save PDF";
  submit.onclick = async function () {
    const freshHtml = await renderEstimateReportDoc(est);
    if (printContainer) {
      printContainer.innerHTML = freshHtml;
    }
    if (isElectronApp) {
      printPreRenderedReport();
      return;
    }
    submit.disabled = true;
    submit.innerText = "Generating...";
    const pdf = await generateReportPDF("portrait");
    if (pdf) pdf.save("Estimate_" + (est.estimateNumber || est.estimateId).replace(/\//g, "-") + ".pdf");
    submit.disabled = false;
    submit.innerText = "Save PDF";
  };
}
window.previewEstimateReport = previewEstimateReport;


async function renderEstimateReportDoc(est) {
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
      if (g) bodyRowsHtml += '<tr><td colspan="5" style="padding:8px 6px 4px; font-weight:800; text-decoration:underline; font-size:12.5px;">' + escapeHtml(g) + '</td></tr>';
      lineItems.filter(function (item) { return (item.groupName || "") === g; }).forEach(function (item) { bodyRowsHtml += rowHtml(item); });
      const groupTotal = totals.groups[g] || 0;
      bodyRowsHtml += '<tr><td colspan="4" style="text-align:right; padding:6px; font-weight:700; font-size:12px;">Subtotal</td><td style="text-align:right; padding:6px; font-weight:700; font-size:12px; border-bottom:1px solid #000;">₦' + moneyValue(groupTotal) + '</td></tr>';
    });
  } else {
    lineItems.forEach(function (item) { bodyRowsHtml += rowHtml(item); });
  }

  const discountRows = [];
  discountRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; font-weight:700;"><span>Subtotal :</span><span>₦' + moneyValue(totals.subtotal) + '</span></div>');
  if (discountEnabled) {
    discountRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span>Discount :</span><span>₦' + moneyValue(discountAmount) + '</span></div>');
    discountRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px; font-weight:700; border-top:1px solid #000;"><span>Subtotal :</span><span>₦' + moneyValue(totals.afterDiscount) + '</span></div>');
  }
  const totalRows = [];
  totalRows.push('<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;"><span>VAT :</span><span>₦' + moneyValue(totals.vat) + '</span></div>');
  totalRows.push('<div style="display:flex; justify-content:space-between; padding:8px 0; font-size:16px; font-weight:900; border-top:2px solid #000;"><span>Total :</span><span>₦' + moneyValue(totals.total) + '</span></div>');

  const conditionLines = String(est.conditions || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  const conditionsHtml = conditionLines.length
    ? (
        '<div style="page-break-inside:avoid;">' +
        '<div style="font-weight:800; font-size:13px; margin-bottom:6px;">Please Note:</div>' +
        '<ol style="font-size:12px; line-height:1.6; padding-left:20px; margin:0;">' +
        conditionLines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join("") +
        '</ol></div>'
      )
    : "";

  const signatureHtml = await generateInspectionSignatureBlocks((await _getSignatoryName()) || "Kayode Olubisi");
  // Defaults to shown (matches showAccountDetails !== false everywhere
  // else) so estimates saved before this toggle existed still show it,
  // rather than silently losing it for every estimate created so far.
  const accountDetailsHtml = est.showAccountDetails !== false
    ? '<div style="border:1px solid #000; padding:8px 12px; font-size:11px; line-height:1.7; align-self:flex-end; min-width:120px; margin-left:20mm;">' +
      (settings.Account_Name ? '<div>' + escapeHtml(settings.Account_Name) + '</div>' : '') +
      (settings.Bank_Name ? '<div>' + escapeHtml(settings.Bank_Name) + '</div>' : '') +
      (settings.Account_Number ? '<div>' + escapeHtml(settings.Account_Number) + '</div>' : '') +
      '</div>'
    : '';
  const addressLines = String(est.clientAddress || "").split("\n").map(escapeHtml).join("<br>");

  return (
    '<div class="report-page-wrapper"><div class="report-content" style="padding-bottom:22mm;">' +
    '<div style="display:flex; justify-content:flex-end;">' +
    '<div style="text-align:right; flex-shrink:0;">' +
    (logoUrl ? '<img src="' + escapeAttr(logoUrl) + '" style="max-height:' + Math.round(80 * logoSizeFactor) + 'px; max-width:' + Math.round(200 * logoSizeFactor) + 'px; object-fit:contain;" onerror="this.style.display=\'none\'">' : "") +
    '<div style="font-size:10px; color:#495057; margin-top:4px;">' + contactLine + '<br>' + escapeHtml(contactLine2) + '</div></div></div>' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:18px; gap:20px;">' +
    '<div style="font-size:12px; line-height:1.6; max-width:63mm; overflow-wrap:break-word; word-wrap:break-word;"><strong style="font-size:14px;">' + escapeHtml(est.clientName || "") + '</strong><br>' + addressLines + '</div>' +
    '<div style="font-size:12px; flex-shrink:0;"><div><strong>Estimate No:</strong> ' + escapeHtml(est.estimateNumber || "DRAFT") + '</div>' +
    '<div><strong>Date:</strong> ' + (est.estimateDate ? escapeHtml(new Date(est.estimateDate).toLocaleDateString()) : "") + '</div>' +
    '<div><strong>Valid Until:</strong> ' + (est.validUntilDate ? escapeHtml(new Date(est.validUntilDate).toLocaleDateString()) : "") + '</div></div>' +
    '<div style="font-size:28px; font-weight:900; letter-spacing:1px; flex-shrink:0;">ESTIMATE</div></div>' +
    '<table style="width:100%; border-collapse:collapse; margin-top:16px;"><thead><tr>' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Description</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Qty</th>' +
    '<th style="text-align:left; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Unit</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Unit Price</th>' +
    '<th style="text-align:right; padding:6px; font-size:10px; text-transform:uppercase; border-bottom:2px solid #000;">Amount</th>' +
    '</tr></thead><tbody>' +
    (est.headerLine ? '<tr><td colspan="5" style="padding:8px 6px 4px; font-weight:800; text-transform:uppercase; font-size:13px;">' + escapeHtml(est.headerLine) + '</td></tr>' : "") +
    bodyRowsHtml + '</tbody></table>' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin:0; padding:0; page-break-inside:avoid;">' +
    '<div style="align-self:flex-end; display:flex; align-items:flex-end; gap:14px;" id="est-signature-block">' + signatureHtml + accountDetailsHtml + '</div>' +
    '<div style="max-width:320px; flex-shrink:0; padding-top:10px; align-self:flex-end;"><div id="est-discount-block">' + discountRows.join("") + '</div><div id="est-vat-line" style="margin-top:10px;">' + totalRows.join("") + '</div></div>' +
    '</div>' +
    '<div style="width:80mm; max-width:80mm; box-sizing:content-box; overflow-wrap:break-word; word-wrap:break-word; margin-top:-60px; padding-left:200px;">' + conditionsHtml + '</div>' +
    '</div>' + generateReportFooter() + '</div>'
  );
}

// ===== accepted estimate -> new project =====

async function createProjectFromEstimate(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;
  if (est.projectIdCreated) {
    alert("A project has already been created from this estimate (" + est.projectIdCreated + ").");
    return;
  }
  if (est.status !== "Accepted") {
    alert("This estimate must be Accepted before a project can be created from it.");
    return;
  }
  if (!confirm('Create a new project for "' + est.clientName + '" from this estimate?')) return;

  try {
    // The duplicate-prevention check and the project creation itself both
    // happen server-side in one call now, rather than split across two
    // separate requests from here — that split left a real window where
    // two near-simultaneous clicks could each pass the "not yet created"
    // check and create two projects from the same estimate.
    const resp = await callApi("createProjectFromEstimate", { estimateId: est.estimateId });
    if (!resp || !resp.success) {
      if (resp && resp.existingProjectId) {
        alert("A project has already been created from this estimate (" + resp.existingProjectId + ").");
        est.projectIdCreated = resp.existingProjectId;
      } else {
        alert(resp && resp.error ? resp.error : "Could not create project.");
      }
      renderEstimatesPage();
      return;
    }
    est.projectIdCreated = resp.projectId;
    const cache = getCache();
    cache.estimates = estimatesList;
    cache.projectsLoaded = false;
    setCache(cache);
    if (typeof showSyncToast === "function") showSyncToast("Project " + resp.projectId + " created");

    renderEstimatesPage();
  } catch (e) {
    console.error("createProjectFromEstimate failed", e);
    alert("Failed to create project: " + (e.message || "Unknown error"));
  }
}
window.createProjectFromEstimate = createProjectFromEstimate;

/**
 * Archive is deliberately independent of status and independent of
 * project archiving -- a purely cosmetic manual flag to declutter the
 * Estimates page, matching the same pattern used for projects.
 */
function toggleArchiveEstimate(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;
  est.archived = !est.archived;
  const cache = getCache();
  cache.estimates = estimatesList;
  setCache(cache);
  if (typeof writeBackup === "function") writeBackup("getEstimates", estimatesList, {});
  if (typeof showSyncToast === "function") showSyncToast(est.archived ? "📥 Estimate archived" : "📤 Estimate unarchived");
  renderEstimatesPage();
  runInBackground(est.archived ? "archiveEstimate" : "unarchiveEstimate", { estimateId: estimateId });
}
window.toggleArchiveEstimate = toggleArchiveEstimate;

async function duplicateEstimate(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;
  if (!confirm('Duplicate "' + (est.clientName || "this estimate") + '"?')) return;

  const cache = getCache();
  const settings = cache.settings && cache.settings.data ? cache.settings.data : cache.settings || {};
  const validityDays = Number(settings.EstimateValidityDays) || 7;
  const todayStr = new Date().toISOString().slice(0, 10);
  const validUntil = new Date(Date.now() + validityDays * 86400000).toISOString().slice(0, 10);

  const payload = {
    clientId: est.clientId || "",
    clientName: est.clientName,
    clientAddress: est.clientAddress,
    estimateDate: todayStr,
    validUntilDate: validUntil,
    headerLine: est.headerLine || "",
    lineItems: safeParseJsonArray(est.lineItems),
    subtotalMode: est.subtotalMode,
    discountAmount: Number(est.discountAmount) || 0,
    discountEnabled: est.discountEnabled,
    status: "Draft",
    conditions: est.conditions || "",
  };

  try {
    const resp = await callApi("saveEstimate", payload);
    if (!resp || !resp.success) {
      alert("Could not duplicate estimate.");
      return;
    }
    const cache2 = getCache();
    const cachedRecord = Object.assign({}, payload, {
      lineItems: JSON.stringify(payload.lineItems),
      discountEnabled: String(payload.discountEnabled) === "true" ? "true" : "false",
      comments: "[]",
      projectIdCreated: "",
      estimateId: resp.estimateId,
      estimateNumber: resp.estimateNumber || "",
    });
    estimatesList.push(cachedRecord);
    cache2.estimates = estimatesList;
    setCache(cache2);
    if (typeof showSyncToast === "function") showSyncToast("Estimate duplicated");
    renderEstimatesPage();
  } catch (e) {
    console.error("duplicateEstimate failed", e);
    alert("Failed to duplicate: " + (e.message || "Unknown error"));
  }
}
window.duplicateEstimate = duplicateEstimate;


// ===== mobile: read-only view + comments =====

function viewEstimateMobile(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  if (modalContent) modalContent.classList.remove("modal-fullscreen");
  title.innerText = "Estimate: " + (est.estimateNumber || "Draft");
  overlay.style.display = "flex";
  submit.style.display = "none";

  const lineItems = safeParseJsonArray(est.lineItems);
  const totals = estComputeTotals(lineItems, est.subtotalMode, Number(est.discountAmount) || 0, String(est.discountEnabled) === "true");

  const lineItemsHtml = lineItems.length
    ? lineItems.map(function (item) {
        return (
          '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); font-size:13px;">' +
          '<div>' + escapeHtml(item.description || "") + (item.groupName ? '<div style="font-size:11px; color:var(--muted);">' + escapeHtml(item.groupName) + '</div>' : "") + '</div>' +
          '<div style="text-align:right; flex-shrink:0; margin-left:10px;">' + escapeHtml(item.qty != null ? item.qty : "") + ' ' + escapeHtml(item.unit || "") + '<br>₦' + moneyValue((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)) + '</div>' +
          '</div>'
        );
      }).join("")
    : '<p style="color:var(--muted); font-size:13px;">No line items.</p>';

  const comments = safeParseJsonArray(est.comments);
  const commentsHtml = comments.length
    ? comments.map(function (c) {
        return (
          '<div style="padding:8px; background:var(--card-light); border-radius:8px; margin-bottom:6px;">' +
          '<div style="font-size:13px;">' + escapeHtml(c.text) + '</div>' +
          '<div style="font-size:10px; color:var(--muted); margin-top:2px;">' + escapeHtml(c.date ? new Date(c.date).toLocaleString() : "") + '</div>' +
          '</div>'
        );
      }).join("")
    : '<p style="color:var(--muted); font-size:12px;">No comments yet.</p>';

  body.innerHTML =
    '<div style="font-size:12px; color:var(--muted); font-weight:800; text-transform:uppercase;">' + escapeHtml(est.status || "Draft") + '</div>' +
    '<h3 style="margin:2px 0 10px;">' + escapeHtml(est.clientName || "") + '</h3>' +
    '<div style="font-size:12px; color:var(--muted); margin-bottom:14px;">' +
    (est.estimateDate ? "Date: " + escapeHtml(new Date(est.estimateDate).toLocaleDateString()) : "") +
    (est.validUntilDate ? " - Valid until " + escapeHtml(new Date(est.validUntilDate).toLocaleDateString()) : "") +
    '</div>' +
    '<div>' + lineItemsHtml + '</div>' +
    '<div style="max-width:260px; margin:14px 0 0 auto; font-size:13px;">' +
    '<div style="display:flex; justify-content:space-between; font-weight:900; padding-top:8px; border-top:2px solid #000;"><span>Total</span><span>₦' + moneyValue(totals.total) + '</span></div>' +
    '</div>' +
    '<h4 style="margin:20px 0 8px;">Comments</h4>' +
    '<div id="est-mobile-comments-list">' + commentsHtml + '</div>' +
    '<textarea id="est-mobile-comment-input" rows="3" placeholder="Add a comment..." style="width:100%; padding:10px; font-size:14px; margin-top:8px; border:1.5px solid var(--border); border-radius:10px;"></textarea>' +
    '<button type="button" class="action-btn" style="margin-top:8px;" onclick="window.addEstimateComment(\'' + escapeAttr(est.estimateId) + '\')">Add Comment</button>';
}
window.viewEstimateMobile = viewEstimateMobile;

async function addEstimateComment(estimateId) {
  const est = estimatesList.find(function (e) { return e.estimateId === estimateId; });
  if (!est) return;
  const textarea = document.getElementById("est-mobile-comment-input");
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) return;

  const existingComments = safeParseJsonArray(est.comments);
  const newComments = existingComments.concat([{ text: text, date: new Date().toISOString() }]);

  try {
    const payload = Object.assign({}, est, {
      lineItems: safeParseJsonArray(est.lineItems),
      comments: newComments,
    });
    await callApi("updateEstimate", payload);
    est.comments = JSON.stringify(newComments);
    const cache = getCache();
    cache.estimates = estimatesList;
    setCache(cache);
    textarea.value = "";
    if (typeof showSyncToast === "function") showSyncToast("Comment added");
    viewEstimateMobile(estimateId);
  } catch (e) {
    console.error("addEstimateComment failed", e);
    alert("Could not add comment: " + (e.message || "Unknown error"));
  }
}
window.addEstimateComment = addEstimateComment;

// ===== BOQ library manager (desktop only) =====

function openBOQManagerModal() {
  renderBOQManagerOverlay();
}
window.openBOQManagerModal = openBOQManagerModal;

function renderBOQManagerOverlay() {
  let overlay = document.getElementById("boq-manager-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "boq-manager-overlay";
    // Fills the app's own content area (the white space to the right of
    // the sidebar), not a small centered dialog box — matches how the
    // Estimate editor's full-screen treatment reads, but this panel isn't
    // built on the shared modal system, so it's styled directly.
    overlay.style.cssText = "position:absolute; inset:0; background:#fff; z-index:2000; display:flex; flex-direction:column; overflow:hidden;";
    const mainContent = document.querySelector(".main") || document.body;
    mainContent.style.position = mainContent.style.position || "relative";
    mainContent.appendChild(overlay);
  }
  const items = boqItemsList.filter(function (b) { return b.type === "item"; });
  const groups = boqItemsList.filter(function (b) { return b.type === "group"; });

  const itemsHtml = items.length
    ? items.map(function (b) {
        return (
          '<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border); font-size:13px;">' +
          '<div><strong>' + escapeHtml(b.description) + '</strong><div style="color:var(--muted); font-size:11px;">' + escapeHtml(b.unit || "") + ' - \u20a6' + moneyValue(b.unitPrice) + '</div></div>' +
          '<div style="display:flex; gap:10px; flex-shrink:0;">' +
          '<span class="boq-edit-btn" data-id="' + escapeAttr(b.boqItemId) + '" style="cursor:pointer; color:var(--primary);"><i class="fas fa-edit"></i></span>' +
          '<span class="boq-delete-btn" data-id="' + escapeAttr(b.boqItemId) + '" style="cursor:pointer; color:var(--danger);"><i class="fas fa-trash"></i></span>' +
          '</div></div>'
        );
      }).join("")
    : '<p style="color:var(--muted); font-size:13px;">No individual items yet.</p>';

  const groupsHtml = groups.length
    ? '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">' +
      groups.map(function (g) {
        return (
          '<div class="card boq-group-card" data-id="' + escapeAttr(g.boqItemId) + '" style="cursor:pointer; position:relative; margin:0;">' +
          '<span class="boq-delete-btn" data-id="' + escapeAttr(g.boqItemId) + '" style="position:absolute; top:10px; right:10px; cursor:pointer; color:var(--danger); z-index:1;"><i class="fas fa-trash"></i></span>' +
          '<i class="fas fa-layer-group" style="color:var(--primary); font-size:18px;"></i>' +
          '<div style="font-weight:800; margin-top:8px;">' + escapeHtml(g.description) + '</div>' +
          '<div style="color:var(--muted); font-size:12px; margin-top:2px;">' + safeParseJsonArray(g.groupItems).length + ' line item(s)</div>' +
          '</div>'
        );
      }).join("") +
      '</div>'
    : '<p style="color:var(--muted); font-size:13px;">No group blocks yet.</p>';

  overlay.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--border); flex-shrink:0;">' +
    '<h3 style="margin:0;">BOQ Library</h3>' +
    '<span id="boq-manager-close" style="cursor:pointer; font-size:22px; padding:0 6px; color:var(--muted);">&times;</span></div>' +
    '<div style="flex:1; overflow-y:auto; padding:20px;">' +
    '<div style="display:flex; gap:8px; margin-bottom:16px;">' +
    '<button type="button" class="action-btn" id="boq-add-item-btn" style="width:auto; padding:8px 14px; font-size:12px;"><i class="fas fa-plus"></i> Add Item</button>' +
    '<button type="button" class="action-btn" id="boq-add-group-btn" style="width:auto; padding:8px 14px; font-size:12px; background:var(--card-light); color:var(--text);"><i class="fas fa-layer-group"></i> Add Group</button>' +
    '</div><div id="boq-add-form-slot"></div>' +
    '<h4 style="margin:16px 0 6px;">Items (' + items.length + ')</h4><div>' + itemsHtml + '</div>' +
    '<h4 style="margin:24px 0 10px;">Group Blocks (' + groups.length + ')</h4>' + groupsHtml +
    '</div>';

  overlay.querySelector("#boq-manager-close").onclick = function () { overlay.remove(); };
  overlay.querySelector("#boq-add-item-btn").onclick = function () { renderBOQAddItemForm(null); };
  overlay.querySelector("#boq-add-group-btn").onclick = function () { renderBOQAddGroupForm(null); };
  overlay.querySelectorAll(".boq-edit-btn").forEach(function (el) {
    el.onclick = function () {
      const item = boqItemsList.find(function (b) { return b.boqItemId === el.dataset.id; });
      if (item) renderBOQAddItemForm(item);
    };
  });
  overlay.querySelectorAll(".boq-group-card").forEach(function (el) {
    el.onclick = function () {
      const group = boqItemsList.find(function (b) { return b.boqItemId === el.dataset.id; });
      if (group) renderBOQAddGroupForm(group);
    };
  });
  overlay.querySelectorAll(".boq-delete-btn").forEach(function (el) {
    el.onclick = async function (ev) {
      ev.stopPropagation(); // don't also trigger the card's own click-to-edit
      if (!confirm("Delete this BOQ entry?")) return;
      await callApi("deleteBOQItem", { boqItemId: el.dataset.id });
      boqItemsList = boqItemsList.filter(function (b) { return b.boqItemId !== el.dataset.id; });
      const cache = getCache();
      cache.boqItems = boqItemsList;
      setCache(cache);
      renderBOQManagerOverlay();
    };
  });
}

function renderBOQAddItemForm(editItem) {
  const isEdit = !!editItem;
  const slot = document.getElementById("boq-add-form-slot");
  if (!slot) return;
  slot.innerHTML =
    '<div style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px;">' +
    '<label style="font-weight:700; font-size:12px;">Description</label>' +
    '<input id="boq-new-desc" value="' + escapeAttr(isEdit ? editItem.description : "") + '" style="width:100%; padding:8px; font-size:13px; margin-bottom:6px;">' +
    '<div style="display:flex; gap:8px;">' +
    '<div style="flex:1;"><label style="font-weight:700; font-size:12px;">Unit</label><select id="boq-new-unit" style="width:100%; padding:8px; font-size:13px;">' + estUnitOptionsHtml(isEdit ? editItem.unit || "" : "") + '</select></div>' +
    '<div style="flex:1;"><label style="font-weight:700; font-size:12px;">Unit Price</label><input id="boq-new-price" type="number" step="0.01" value="' + escapeAttr(isEdit ? editItem.unitPrice : "") + '" style="width:100%; padding:8px; font-size:13px;"></div>' +
    '</div><button type="button" class="action-btn" id="boq-save-item-btn" style="margin-top:8px; padding:8px 14px; width:auto; font-size:12px;">' + (isEdit ? "Update Item" : "Save Item") + '</button></div>';
  document.getElementById("boq-save-item-btn").onclick = async function () {
    const description = document.getElementById("boq-new-desc").value.trim();
    if (!description) return alert("Enter a description");
    const unit = document.getElementById("boq-new-unit").value;
    const unitPrice = Number(document.getElementById("boq-new-price").value) || 0;
    const saveBtn = document.getElementById("boq-save-item-btn");
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";
    try {
      if (isEdit) {
        await callApi("updateBOQItem", { boqItemId: editItem.boqItemId, type: "item", description: description, unit: unit, unitPrice: unitPrice });
        const idx = boqItemsList.findIndex(function (b) { return b.boqItemId === editItem.boqItemId; });
        if (idx !== -1) boqItemsList[idx] = Object.assign({}, boqItemsList[idx], { description: description, unit: unit, unitPrice: unitPrice });
      } else {
        const resp = await callApi("saveBOQItem", { type: "item", description: description, unit: unit, unitPrice: unitPrice });
        boqItemsList.push({ boqItemId: resp.boqItemId, type: "item", description: description, unit: unit, unitPrice: unitPrice, groupItems: "[]" });
      }
      const cache = getCache();
      cache.boqItems = boqItemsList;
      setCache(cache);
      renderBOQManagerOverlay();
    } catch (e) {
      alert("Save failed: " + (e.message || "Unknown error"));
      saveBtn.disabled = false;
      saveBtn.innerText = isEdit ? "Update Item" : "Save Item";
    }
  };
}

let boqGroupDraftItems = [];
let boqGroupEditId = null;

function renderBOQAddGroupForm(editGroup) {
  const isEdit = !!editGroup;
  boqGroupEditId = isEdit ? editGroup.boqItemId : null;
  boqGroupDraftItems = isEdit ? safeParseJsonArray(editGroup.groupItems) : [{ description: "", qty: 1, unit: "", unitPrice: 0 }];
  if (!boqGroupDraftItems.length) boqGroupDraftItems = [{ description: "", qty: 1, unit: "", unitPrice: 0 }];
  const slot = document.getElementById("boq-add-form-slot");
  if (!slot) return;
  slot.innerHTML =
    '<div style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px;">' +
    '<label style="font-weight:700; font-size:12px;">Group Name</label>' +
    '<input id="boq-new-group-name" value="' + escapeAttr(isEdit ? editGroup.description : "") + '" placeholder="e.g. A/C Group" style="width:100%; padding:8px; font-size:13px; margin-bottom:8px;">' +
    '<div id="boq-group-draft-rows"></div>' +
    '<button type="button" class="action-btn" id="boq-group-add-row-btn" style="width:auto; padding:6px 12px; font-size:11px; background:var(--card-light); color:var(--text); margin-top:4px;">+ Add Row</button>' +
    '<button type="button" class="action-btn" id="boq-save-group-btn" style="margin-top:10px; padding:8px 14px; width:auto; font-size:12px; display:block;">' + (isEdit ? "Update Group" : "Save Group") + '</button></div>';
  renderBOQGroupDraftRows();
  document.getElementById("boq-group-add-row-btn").onclick = function () {
    boqGroupDraftItems.push({ description: "", qty: 1, unit: "", unitPrice: 0 });
    renderBOQGroupDraftRows();
  };
  document.getElementById("boq-save-group-btn").onclick = async function () {
    const groupName = document.getElementById("boq-new-group-name").value.trim();
    if (!groupName) return alert("Enter a group name");
    const validItems = boqGroupDraftItems.filter(function (i) { return i.description.trim(); });
    if (!validItems.length) return alert("Add at least one line item to the group");
    const saveBtn = document.getElementById("boq-save-group-btn");
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";
    try {
      if (isEdit) {
        await callApi("updateBOQItem", { boqItemId: boqGroupEditId, type: "group", description: groupName, groupItems: validItems });
        const idx = boqItemsList.findIndex(function (b) { return b.boqItemId === boqGroupEditId; });
        if (idx !== -1) boqItemsList[idx] = Object.assign({}, boqItemsList[idx], { description: groupName, groupItems: JSON.stringify(validItems) });
      } else {
        const resp = await callApi("saveBOQItem", { type: "group", description: groupName, groupItems: validItems });
        boqItemsList.push({ boqItemId: resp.boqItemId, type: "group", description: groupName, unit: "", unitPrice: 0, groupItems: JSON.stringify(validItems) });
      }
      const cache = getCache();
      cache.boqItems = boqItemsList;
      setCache(cache);
      renderBOQManagerOverlay();
    } catch (e) {
      alert("Save failed: " + (e.message || "Unknown error"));
      saveBtn.disabled = false;
      saveBtn.innerText = isEdit ? "Update Group" : "Save Group";
    }
  };
}

function renderBOQGroupDraftRows() {
  const wrap = document.getElementById("boq-group-draft-rows");
  if (!wrap) return;
  wrap.innerHTML = boqGroupDraftItems
    .map(function (item, idx) {
      return (
        '<div style="display:flex; gap:6px; margin-bottom:6px;">' +
        '<input placeholder="Description" value="' + escapeAttr(item.description) + '" style="flex:3; padding:6px; font-size:12px;" oninput="window.boqUpdateGroupDraftField(' + idx + ", 'description', this.value)\">" +
        '<input type="number" placeholder="Qty" value="' + escapeAttr(item.qty) + '" style="flex:1; padding:6px; font-size:12px;" oninput="window.boqUpdateGroupDraftField(' + idx + ", 'qty', this.value)\">" +
        '<select style="flex:1; padding:6px; font-size:12px;" onchange="window.boqUpdateGroupDraftField(' + idx + ", 'unit', this.value)\">" + estUnitOptionsHtml(item.unit || "") + "</select>" +
        '<input type="number" placeholder="Price" value="' + escapeAttr(item.unitPrice) + '" style="flex:1; padding:6px; font-size:12px;" oninput="window.boqUpdateGroupDraftField(' + idx + ", 'unitPrice', this.value)\">" +
        '<span onclick="window.boqRemoveGroupDraftRow(' + idx + ')" style="cursor:pointer; color:var(--danger); align-self:center; padding:0 4px;"><i class="fas fa-trash"></i></span>' +
        '</div>'
      );
    })
    .join("");
}

function boqUpdateGroupDraftField(idx, field, value) {
  if (!boqGroupDraftItems[idx]) return;
  boqGroupDraftItems[idx][field] = (field === "qty" || field === "unitPrice") ? (Number(value) || 0) : value;
}
window.boqUpdateGroupDraftField = boqUpdateGroupDraftField;

function boqRemoveGroupDraftRow(idx) {
  boqGroupDraftItems.splice(idx, 1);
  if (!boqGroupDraftItems.length) boqGroupDraftItems.push({ description: "", qty: 1, unit: "", unitPrice: 0 });
  renderBOQGroupDraftRows();
}
window.boqRemoveGroupDraftRow = boqRemoveGroupDraftRow;

// ===== Units of Measurement (Settings page) =====

let unitsList = [];

async function loadUnitsSettingsPanel() {
  const container = document.getElementById("units-settings-list");
  if (!container) return;
  container.innerHTML = '<span style="font-size:13px; color:var(--muted);">Loading units...</span>';
  const cache = getCache();
  try {
    const resp = await callApi("getUnits", {});
    unitsList = Array.isArray(resp) ? resp : [];
    cache.units = unitsList;
    setCache(cache);
  } catch (e) {
    console.error("getUnits failed", e);
    unitsList = cache.units || [];
  }
  renderUnitsSettingsList();
}
window.loadUnitsSettingsPanel = loadUnitsSettingsPanel;

function renderUnitsSettingsList() {
  const container = document.getElementById("units-settings-list");
  if (!container) return;
  const sorted = [...unitsList].sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
  container.innerHTML = sorted.length
    ? sorted
        .map(function (u) {
          return (
            '<span style="display:inline-flex; align-items:center; gap:6px; background:var(--card-light); border-radius:999px; padding:4px 6px 4px 12px; margin:0 6px 6px 0; font-size:13px;">' +
            escapeHtml(u.name) +
            '<span onclick="window.deleteUnitFromSettings(\'' + escapeAttr(u.unitId) + '\')" style="cursor:pointer; color:var(--danger); width:18px; height:18px; border-radius:50%; background:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:11px;"><i class="fas fa-times"></i></span>' +
            '</span>'
          );
        })
        .join("")
    : '<p style="color:var(--muted); font-size:13px;">No units yet.</p>';
}

async function addUnitFromSettings() {
  const input = document.getElementById("new-unit-input");
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  if (unitsList.some(function (u) { return u.name.toLowerCase() === name.toLowerCase(); })) {
    alert("That unit already exists");
    return;
  }
  const btn = document.getElementById("add-unit-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
  }
  try {
    const resp = await callApi("saveUnit", { name: name });
    unitsList.push({ unitId: resp.unitId, name: name });
    const cache = getCache();
    cache.units = unitsList;
    setCache(cache);
    input.value = "";
    renderUnitsSettingsList();
  } catch (e) {
    alert("Could not add unit: " + (e.message || "Unknown error"));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i> Add';
    }
  }
}
window.addUnitFromSettings = addUnitFromSettings;

async function deleteUnitFromSettings(unitId) {
  if (!confirm("Delete this unit?")) return;
  try {
    await callApi("deleteUnit", { unitId: unitId });
    unitsList = unitsList.filter(function (u) { return u.unitId !== unitId; });
    const cache = getCache();
    cache.units = unitsList;
    setCache(cache);
    renderUnitsSettingsList();
  } catch (e) {
    alert("Could not delete unit: " + (e.message || "Unknown error"));
  }
}
window.deleteUnitFromSettings = deleteUnitFromSettings;
