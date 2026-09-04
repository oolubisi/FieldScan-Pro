// ===== CHANGE ORDERS =====

// Still needed -- used throughout the Change Order report preview/print
// flow below (attachment picker state). Was accidentally removed along
// with the dead IIFE code that used to sit right above it.
let coReportSelectedAttachmentIndex = 0;

/**
 * Change order line items come back from the backend already as a real
 * array in practice (a jsonb column is auto-deserialized by the pg
 * driver on the way out) -- but every call site here used to assume it
 * was still a JSON string and unconditionally called JSON.parse() on it.
 * JSON.parse() on an actual array throws (its .toString() isn't valid
 * JSON), and every call site silently swallowed that into an empty
 * array. That's why line items looked fine right after typing them in
 * (still a live in-memory array, matched to save the same way in the
 * payload) but vanished the moment the change order was reloaded from
 * the server -- editing, reopening, printing, anywhere this ran.
 */
function coParseLineItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.error("coParseLineItems: failed to parse line items string", e);
    }
  }
  return [];
}

// NOTE: switchConsoleSegment is defined in projects.js (loaded before changeorders.js)
// changeorders.js just needs to export its own loader functions.
// The console.js version will call loadChangeOrdersListings() when seg === "changeorders".

function getNextChangeOrderNumber(projectId) {
  const suffix = (
    String(projectId).match(/(\d{1,3})\D*$/)?.[1] || "0"
  ).padStart(3, "0");
  const prefix = "CO-" + suffix + "-";
  const cache = getCache();
  const changeOrdersList = cache.changeOrders || [];
  let max = 0;
  changeOrdersList.forEach((v) => {
    if (String(v.changeOrderId).startsWith(prefix)) {
      const num = parseInt(String(v.changeOrderId).substring(prefix.length));
      if (!isNaN(num) && num > max) max = num;
    }
  });
  return prefix + String(max + 1).padStart(2, "0");
}

async function loadChangeOrdersListings(forceRefresh = false) {
  const container = document.getElementById("console-changeorders-list");
  let cache = getCache();
  if (forceRefresh || !cache.changeOrdersLoaded) {
    container.innerHTML = `<p style="text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading change orders...</p>`;
    try {
      const items = await callApi("getChangeOrders", {
        projectId: getCurrentProjectId(),
      });
      cache = getCache();
      cache.changeOrders = items || [];
      cache.changeOrdersLoaded = true;
      setCache(cache);
    } catch (e) {
      console.warn("loadChangeOrdersListings failed:", e);
    }
  }
  const projectId = getCurrentProjectId();
  const projectChangeOrders = (cache.changeOrders || []).filter(
    (v) => v.projectId === projectId,
  );
  if (!projectChangeOrders.length) {
    container.innerHTML = `<p style="text-align:center;padding:20px; color:var(--muted);">No change orders yet — use "New Change Order" above to add one.</p>`;
    return;
  }
  container.innerHTML =
    `<div class="console-cards-grid">` +
    projectChangeOrders
      .map((v) => {
        const key = `changeorder:${v.changeOrderId}`;
        window.modalRecordCache = window.modalRecordCache || {};
        window.modalRecordCache[key] = v;
        const statusColors = {
          Draft: "var(--muted)",
          Submitted: "#fd7e14",
          Approved: "var(--success)",
          Rejected: "var(--danger)",
        };
        return `<div class="card" style="border-left:6px solid ${statusColors[v.status] || "var(--muted)"}; cursor:pointer;" onclick="${isElectronApp ? `window.openChangeOrderModal(window.modalRecordCache['${key}'])` : `window.previewChangeOrderReport('${escapeAttr(v.changeOrderId)}')`}" title="${isElectronApp ? "Click to edit" : "Open printable report"}">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
          <div>
            <strong style="font-size:18px;">${escapeHtml(v.changeOrderNumber || v.changeOrderId)}</strong>
            <div style="font-size:13px; font-weight:700; margin-top:2px;">${escapeHtml(v.title)}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">${escapeHtml(v.date)} · ${escapeHtml(v.status)}${v.approvedBy ? " · By: " + escapeHtml(v.approvedBy) : ""}</div>
          </div>
          <span style="font-size:16px; font-weight:900;">₦${moneyValue(v.total)}</span>
        </div>
        ${v.notes ? `<div style="margin-top:8px; font-size:13px; color:var(--muted);">${escapeHtml(v.notes)}</div>` : ""}
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;" onclick="event.stopPropagation()">
          ${
            isElectronApp
              ? `<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.openChangeOrderModal(window.modalRecordCache['${key}'])">
            <i class="fas fa-edit"></i> Edit
          </button>`
              : ""
          }
          <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--primary);" onclick="window.previewChangeOrderReport('${escapeAttr(v.changeOrderId)}')">
            <i class="fas fa-print"></i> Print
          </button>
        </div>
      </div>`;
      })
      .join("") +
    `</div>`;
}

function openChangeOrderModal(editData = null) {
  if (!isElectronApp) {
    if (typeof showSyncToast === "function")
      showSyncToast("Change Orders can only be edited on desktop");
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
  currentModalFiles = isEdit ? splitAttachments(editData.attachments) : [];

  const labelStyle =
    'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  const projectId = getCurrentProjectId();
  const nextNumber = isEdit
    ? editData.changeOrderNumber
    : getNextChangeOrderNumber(projectId);

  const lineItems = isEdit ? coParseLineItems(editData.lineItems) : [];

  const lineItemsHtml = lineItems
    .map((item) => {
      const amt = roundMoney(
        (Number(item.qty) || 0) * (Number(item.rate) || 0),
      );
      return `<tr class="co-line-row">
    <td style="padding:4px; border-bottom:1px solid var(--border);"><input class="co-line-desc" value="${escapeAttr(item.description || "")}" placeholder="Description" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input class="co-line-qty" type="number" value="${escapeAttr(item.qty != null ? item.qty : "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcChangeOrderTotals()"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:80px;"><input class="co-line-rate" type="number" value="${escapeAttr(item.rate != null ? item.rate : "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcChangeOrderTotals()"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="co-line-amt" type="number" value="${escapeAttr(amt)}" disabled style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right; background:#f5f5f5;"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="this.closest('tr').remove(); window.recalcChangeOrderTotals();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>
  </tr>`;
    })
    .join("");

  title.innerText = isEdit ? "Edit Change Order" : "New Change Order";
  body.innerHTML = `
    <label ${labelStyle}>Change Order Number</label>
    <input value="${escapeAttr(nextNumber)}" disabled style="${largeInput} background:#f0f0f0;">
    <input type="hidden" id="co_id" value="${escapeAttr(isEdit ? editData.changeOrderId : "")}">

    <label ${labelStyle}>Date</label>
    <input id="co_date" type="text" value="${escapeAttr(isEdit ? editData.date : todayFormatted())}" ${largeInput}>

    <label ${labelStyle}>Title</label>
    <input id="co_title" value="${escapeAttr(isEdit ? editData.title : "")}" placeholder="e.g. Additional Balcony Tiling" ${largeInput}>

    <label ${labelStyle}>Status</label>
    <select id="co_status" ${largeInput}>
      <option value="Draft" ${isEdit && editData.status === "Draft" ? "selected" : ""}>Draft</option>
      <option value="Submitted" ${isEdit && editData.status === "Submitted" ? "selected" : ""}>Submitted</option>
      <option value="Approved" ${isEdit && editData.status === "Approved" ? "selected" : ""}>Approved</option>
      <option value="Rejected" ${isEdit && editData.status === "Rejected" ? "selected" : ""}>Rejected</option>
    </select>

    <label ${labelStyle}>Line Items</label>
    <table style="width:100%; font-size:13px; border-collapse:collapse; margin-bottom:10px;">
      <thead>
        <tr style="background:#000; color:#fff;">
          <th style="padding:6px; text-align:left; font-size:10px; text-transform:uppercase;">Description</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:60px;">Qty</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:80px;">Rate (₦)</th>
          <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:90px;">Amount (₦)</th>
          <th style="width:30px;"></th>
        </tr>
      </thead>
      <tbody id="co_line_items_body">${lineItemsHtml}</tbody>
    </table>
    <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.addChangeOrderLineItem()">
      <i class="fas fa-plus"></i> Add Line Item
    </button>

    <div style="margin-top:16px; padding:12px; background:var(--card-light); border-radius:12px; border:1.5px solid var(--border);">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-weight:700; font-size:13px;">Subtotal</span>
        <span id="co_subtotal_display" style="font-weight:700; font-size:14px;">₦0.00</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-weight:700; font-size:13px;">VAT (<span id="co_vat_rate_display">7.5%</span>)</span>
        <span id="co_vat_display" style="font-weight:700; font-size:14px;">₦0.00</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:2px solid var(--border);">
        <span style="font-weight:900; font-size:15px;">Total</span>
        <span id="co_total_display" style="font-weight:900; font-size:18px; color:var(--primary);">₦0.00</span>
      </div>
    </div>

    <label ${labelStyle}>Notes</label>
    <textarea id="co_notes" rows="2" ${largeInput}>${escapeHtml(isEdit ? editData.notes : "")}</textarea>

    <label ${labelStyle}>Approved By</label>
    <input id="co_approved_by" value="${escapeAttr(isEdit ? editData.approvedBy : "")}" placeholder="Name of approver" ${largeInput}>

    <div id="changeOrderAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div>
    <div id="co_attach_dropzone" class="attach-drop-zone" onclick="document.getElementById('co_files').click()">
      <i class="fas fa-cloud-arrow-up"></i>
      <span>Drag &amp; drop files, or click to browse</span>
      <input type="file" id="co_files" accept="image/*,application/pdf" multiple style="display:none">
    </div>

    ${isEdit ? `<button class="action-btn" id="co_delete_btn" style="background:var(--danger); margin-top:10px;">Delete Change Order</button>` : ""}
  `;

  if (currentModalFiles.length)
    populateModalInlineImageGalleryPreviews("changeOrderAttachmentsPreviews");
  document.getElementById("co_files").onchange = (e) =>
    processIncomingMultiAttachments(
      e.target.files,
      "changeOrderAttachmentsPreviews",
    );
  if (typeof wireAttachmentDropZone === "function")
    wireAttachmentDropZone(
      "co_attach_dropzone",
      "changeOrderAttachmentsPreviews",
    );

  if (isEdit) {
    document.getElementById("co_delete_btn").onclick = () => {
      const cache = getCache();
      closeModal();
      cache.changeOrders = (cache.changeOrders || []).filter(
        (c) => c.changeOrderId !== editData.changeOrderId,
      );
      setCache(cache);
      loadChangeOrdersListings(false);
      refreshMasterDashboard();
      scheduleUndoableDelete(
        "changeorder:" + editData.changeOrderId,
        "Change Order deleted",
        function () {
          callApi("deleteChangeOrder", {
            changeOrderId: editData.changeOrderId,
          }).catch(function (err) {
            console.error("Delete failed after undo window expired", err);
          });
        },
        function () {
          const cache2 = getCache();
          cache2.changeOrders = (cache2.changeOrders || []).concat([editData]);
          setCache(cache2);
          loadChangeOrdersListings(false);
          refreshMasterDashboard();
          loadProjectConsoleHub(projectId);
        },
      );
    };
  }

  recalcChangeOrderTotals();

  submit.onclick = () => {
    const title = document.getElementById("co_title").value.trim();
    if (!title) {
      alert("Enter a change order title");
      return;
    }

    const rows = document.querySelectorAll("#co_line_items_body tr");
    const lineItems = [];
    rows.forEach((row) => {
      const desc = row.querySelector(".co-line-desc").value.trim();
      if (desc) {
        const qty = Number(row.querySelector(".co-line-qty").value) || 0;
        const rate = Number(row.querySelector(".co-line-rate").value) || 0;
        lineItems.push({
          description: desc,
          qty: qty,
          rate: rate,
          amount: roundMoney(qty * rate),
        });
      }
    });

    if (!lineItems.length) {
      alert("Add at least one line item");
      return;
    }

    const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
    const vat = calculateTax(subtotal, "VAT");
    const total = roundMoney(subtotal + vat);

    submit.disabled = true;
    submit.innerText = "Saving...";

    const payload = {
      changeOrderId: isEdit
        ? editData.changeOrderId
        : getNextChangeOrderNumber(projectId),
      projectId: projectId,
      changeOrderNumber: isEdit
        ? editData.changeOrderNumber
        : getNextChangeOrderNumber(projectId),
      date: document.getElementById("co_date").value,
      title: title,
      status: document.getElementById("co_status").value,
      lineItems: lineItems,
      subtotal: subtotal,
      vat: vat,
      total: total,
      notes: document.getElementById("co_notes").value,
      approvedBy: document.getElementById("co_approved_by").value,
      attachments: normalizeAttachments(currentModalFiles),
    };

    callApi(isEdit ? "updateChangeOrder" : "saveChangeOrder", payload)
      .then(() => {
        // The backend already adjusts the project's contractSubtotal when
        // a change order is/was Approved (see adjustProjectSubtotal_ in
        // Code.gs) — but the local cache doesn't know that happened, so
        // the Contract Subtotal / Net Receivable shown in the console
        // would otherwise still show the stale figure until a full
        // reload. Mirror the same delta locally so it updates immediately.
        const wasApproved =
          isEdit && editData && editData.status === "Approved";
        const oldTotal = isEdit && editData ? Number(editData.total || 0) : 0;
        let delta = 0;
        if (payload.status === "Approved") {
          delta = wasApproved ? total - oldTotal : total;
        } else if (wasApproved) {
          delta = -oldTotal;
        }
        if (delta !== 0) {
          const cache = getCache();
          const proj = (cache.projects || []).find(
            (p) => p.projectId === projectId,
          );
          if (proj) {
            proj.contractSubtotal = roundMoney(
              (Number(proj.contractSubtotal) || 0) + delta,
            );
            setCache(cache);
          }
        }

        closeModal();
        loadChangeOrdersListings(true);
        if (
          payload.status === "Approved" ||
          (isEdit && editData.status === "Approved")
        ) {
          refreshMasterDashboard();
          loadProjectConsoleHub(projectId);
        }
      })
      .catch(resetSubmitOnError(submit));
  };
}

function addChangeOrderLineItem() {
  const tbody = document.getElementById("co_line_items_body");
  if (!tbody) return;
  const row = document.createElement("tr");
  row.className = "co-line-row";
  row.innerHTML = `<td style="padding:4px; border-bottom:1px solid var(--border);"><input class="co-line-desc" value="" placeholder="Description" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input class="co-line-qty" type="number" value="" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcChangeOrderTotals()"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:80px;"><input class="co-line-rate" type="number" value="" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcChangeOrderTotals()"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="co-line-amt" type="number" value="0" disabled style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right; background:#f5f5f5;"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="this.closest('tr').remove(); window.recalcChangeOrderTotals();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>`;
  tbody.appendChild(row);
}

function recalcChangeOrderTotals() {
  const rows = document.querySelectorAll("#co_line_items_body tr");
  let subtotal = 0;
  rows.forEach((row) => {
    const qty = Number(row.querySelector(".co-line-qty").value) || 0;
    const rate = Number(row.querySelector(".co-line-rate").value) || 0;
    const amt = roundMoney(qty * rate);
    row.querySelector(".co-line-amt").value = amt;
    subtotal += amt;
  });
  subtotal = roundMoney(subtotal);
  const vat = calculateTax(subtotal, "VAT");
  const total = roundMoney(subtotal + vat);

  const subEl = document.getElementById("co_subtotal_display");
  const vatEl = document.getElementById("co_vat_display");
  const totalEl = document.getElementById("co_total_display");
  const vatRateEl = document.getElementById("co_vat_rate_display");

  if (subEl) subEl.innerText = "₦" + moneyValue(subtotal);
  if (vatEl) vatEl.innerText = "₦" + moneyValue(vat);
  if (totalEl) totalEl.innerText = "₦" + moneyValue(total);
  if (vatRateEl) vatRateEl.innerText = formatTaxRate(getTaxRate("VAT"));
}

async function renderChangeOrderReport(
  changeOrder,
  project,
  settings,
  selectedAttachmentIndex,
) {
  if (settings && settings.data) settings = settings.data;

  const lineItems = coParseLineItems(changeOrder.lineItems);

  const itemRows = lineItems
    .map(
      (item) =>
        `<tr>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(item.description || "")}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">${escapeHtml(item.qty != null ? item.qty : "")}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(item.rate)}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700;">₦${moneyValue(item.amount)}</td>
        </tr>`,
    )
    .join("");

  const subtotal = Number(changeOrder.subtotal) || 0;
  const vat = Number(changeOrder.vat) || 0;
  const total = Number(changeOrder.total) || 0;

  // Per-user signature first, falling back to the company-wide one.
  const signName = escapeHtml(await _getSignatoryName());
  const signImg = await _getSignImageUrl();
  const includeClientSig =
    document.getElementById("co-rep-client-sig")?.checked;

  let clientSigBlock = "";
  if (includeClientSig) {
    clientSigBlock = `<div style="margin-top: 32px; page-break-inside: avoid; text-align: left; flex:1;">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; color: #495057;">Client Signatory</div>
      <div style="display: inline-block; text-align: center;">
        <div style="font-size: 12px; font-weight: 700;">${escapeHtml(project.clientName || "_________________________")}</div>
      </div>
    </div>`;
  }

  return `<div class="report-page-wrapper">
    <div class="report-content">
      ${await generateReportHeader("Change Order", project, settings)}
      <div style="margin-bottom: 16px; font-size: 12px; line-height: 1.6;">
        <div><strong>Change Order No:</strong> ${escapeHtml(changeOrder.changeOrderNumber || changeOrder.changeOrderId)}</div>
        <div><strong>Date:</strong> ${escapeHtml(typeof ymd === "function" ? ymd(changeOrder.date) : String(changeOrder.date || "").slice(0, 10))}</div>
        <div><strong>Title:</strong> ${escapeHtml(changeOrder.title)}</div>
        <div><strong>Status:</strong> ${escapeHtml(changeOrder.status)}${changeOrder.approvedBy ? " · Approved by: " + escapeHtml(changeOrder.approvedBy) : ""}</div>
      </div>
      <table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-bottom: 16px;">
        <thead>
          <tr>
            <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Description</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:60px;">Qty</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:90px;">Rate (₦)</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:90px;">Amount (₦)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || '<tr><td colspan="4" style="padding:20px; text-align:center; color:#495057;">No line items</td></tr>'}
          <tr style="font-weight:900;">
            <td colspan="3" style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;"><strong>Subtotal</strong></td>
            <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(subtotal)}</td>
          </tr>
          <tr>
            <td colspan="3" style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;"><strong>VAT (${formatTaxRate(getTaxRate("VAT"))})</strong></td>
            <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(vat)}</td>
          </tr>
          <tr style="font-weight:900;">
            <td colspan="3" style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;"><strong>TOTAL</strong></td>
            <td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right; font-weight:900;">₦${moneyValue(total)}</td>
          </tr>
        </tbody>
      </table>
      ${changeOrder.notes ? `<div style="margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px; border: 1px solid #adb5bd;"><strong style="font-size: 12px; text-transform: uppercase;">Notes</strong><p style="font-size: 12px; margin-top: 4px; line-height: 1.5;">${escapeHtml(changeOrder.notes)}</p></div>` : ""}
      ${renderAttachmentsSectionHtml(await resolveSingleAttachment(changeOrder.attachments, selectedAttachmentIndex), "Attachment")}
      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div style="margin-top: 32px; page-break-inside: avoid; text-align: left; flex:1;">
          <div style="display: inline-block; text-align: center;">
            ${signImg ? `<div style="margin-bottom: 4px;"><img src="${escapeAttr(signImg)}" style="max-height:50px; max-width:150px; object-fit:contain;" onerror="this.style.display='none'"></div>` : ""}
            <div style="font-size: 12px; font-weight: 700;">${signName || "_________________________"}</div>
          </div>
        </div>
        ${clientSigBlock}
      </div>
    </div>
    ${generateReportFooter()}
  </div>`;
}

async function previewChangeOrderReport(changeOrderId) {
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const project = cache.projects.find((p) => p.projectId === projectId);
  const changeOrder = (cache.changeOrders || []).find(
    (v) => v.changeOrderId === changeOrderId,
  );
  if (!changeOrder) return;

  if (!cache.settings || !cache.settings.VAT) {
    try {
      const res = await callApi("getSettings", {});
      cache.settings = res || cache.settings || {};
      setCache(cache);
    } catch (e) {}
  }

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");

  title.innerText = "Change Order Report: " + changeOrder.changeOrderNumber;
  overlay.style.display = "flex";

  coReportSelectedAttachmentIndex = 0;
  const resolvedAttachments = await resolveAttachmentList(
    changeOrder.attachments,
  );
  const changeOrderReportHtml = await renderChangeOrderReport(
    changeOrder,
    project,
    cache.settings || {},
    coReportSelectedAttachmentIndex,
  );
  body.innerHTML = `
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:700; cursor:pointer;">
      <input type="checkbox" id="co-rep-client-sig" style="width:auto;" onchange="window.regenerateChangeOrderPreview('${escapeAttr(changeOrderId)}')">
      Include client signature line
    </label>
    <div id="co-report-picker">${renderAttachmentPickerHtml(resolvedAttachments, coReportSelectedAttachmentIndex, "window.regenerateChangeOrderAttachment", `'${escapeAttr(changeOrderId)}'`)}</div>
    <div id="co-report-preview" style="max-height:60vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
      ${changeOrderReportHtml}
    </div>
  `;

  const isDesktop = document.body.classList.contains("electron-app");

  submit.style.display = "block";
  submit.innerText = isDesktop ? "Print" : "Save PDF";
  submit.onclick = async () => {
    const html = await renderChangeOrderReport(
      changeOrder,
      project,
      cache.settings || {},
      coReportSelectedAttachmentIndex,
    );
    const printContainer = document.getElementById("report-print-container");
    if (printContainer) printContainer.innerHTML = html;

    if (isDesktop) {
      printPreRenderedReport();
      return;
    }

    submit.disabled = true;
    submit.innerText = "Generating...";
    const pdf = await generateReportPDF("portrait");
    if (pdf) {
      pdf.save(
        `ChangeOrder_${changeOrder.changeOrderNumber || changeOrderId}.pdf`,
      );
    }
    submit.disabled = false;
    submit.innerText = "Save PDF";
  };
}

async function regenerateChangeOrderPreview(changeOrderId) {
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const project = cache.projects.find((p) => p.projectId === projectId);
  const changeOrder = (cache.changeOrders || []).find(
    (v) => v.changeOrderId === changeOrderId,
  );
  if (!changeOrder) return;
  const preview = document.getElementById("co-report-preview");
  if (preview)
    preview.innerHTML = await renderChangeOrderReport(
      changeOrder,
      project,
      cache.settings || {},
      coReportSelectedAttachmentIndex,
    );
}

async function regenerateChangeOrderAttachment(changeOrderId, index) {
  coReportSelectedAttachmentIndex = index;
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const project = cache.projects.find((p) => p.projectId === projectId);
  const changeOrder = (cache.changeOrders || []).find(
    (v) => v.changeOrderId === changeOrderId,
  );
  if (!changeOrder) return;
  const resolvedAttachments = await resolveAttachmentList(
    changeOrder.attachments,
  );
  const pickerEl = document.getElementById("co-report-picker");
  if (pickerEl)
    pickerEl.innerHTML = renderAttachmentPickerHtml(
      resolvedAttachments,
      index,
      "window.regenerateChangeOrderAttachment",
      `'${escapeAttr(changeOrderId)}'`,
    );
  const preview = document.getElementById("co-report-preview");
  if (preview)
    preview.innerHTML = await renderChangeOrderReport(
      changeOrder,
      project,
      cache.settings || {},
      index,
    );
}
window.regenerateChangeOrderAttachment = regenerateChangeOrderAttachment;

async function loadPcrView() {
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);

  window.setPcrStatusMessage("Loading PCR fields...");
  window.populatePcrFields(project);

  if (!cache.changeOrdersLoaded) {
    try {
      const changeOrdersList = await callApi("getChangeOrders", { projectId });
      cache.changeOrders = changeOrdersList || [];
      cache.changeOrdersLoaded = true;
      setCache(cache);
    } catch (e) {}
  }

  const projectChangeOrders = (cache.changeOrders || []).filter(
    (v) => v.projectId === projectId && v.status === "Approved",
  );
  const varContainer = document.getElementById("pcr-changeorders-list");
  if (!varContainer) {
    window.setPcrStatusMessage("");
    return;
  }

  if (!projectChangeOrders.length) {
    varContainer.innerHTML =
      '<p style="color:var(--muted); font-size:13px; font-style:italic;">No approved change orders.</p>';
  } else {
    varContainer.innerHTML = projectChangeOrders
      .map((v) => {
        const lineItems = coParseLineItems(v.lineItems);
        return `<div style="padding:10px; background:var(--card-light); border-radius:8px; margin-bottom:8px; border:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <strong style="font-size:14px;">${escapeHtml(v.changeOrderNumber || v.changeOrderId)}</strong>
            <span style="font-size:14px; font-weight:700;">₦${moneyValue(v.total)}</span>
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">${escapeHtml(v.title)} · ${escapeHtml(v.date)}</div>
          ${
            lineItems.length
              ? `<div style="margin-top:6px; font-size:12px; line-height:1.5;">
            ${lineItems.map((i) => `• ${escapeHtml(i.description)} (${i.qty} × ₦${moneyValue(i.rate)})`).join("<br>")}
          </div>`
              : ""
          }
        </div>`;
      })
      .join("");
  }
  window.setPcrStatusMessage("PCR fields loaded.", "success");
}

window.openChangeOrderModal = openChangeOrderModal;
window.addChangeOrderLineItem = addChangeOrderLineItem;
window.recalcChangeOrderTotals = recalcChangeOrderTotals;
window.previewChangeOrderReport = previewChangeOrderReport;
window.regenerateChangeOrderPreview = regenerateChangeOrderPreview;
window.loadPcrView = loadPcrView;

// Pre-load all data lists in the background so reports and dropdowns work immediately
