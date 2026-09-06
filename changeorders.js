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

let currentChangeOrderLineItems = [];
let coLastFocusedIndex = -1;

function coSetLastFocusedIndex(index) {
  coLastFocusedIndex = index;
}
window.coSetLastFocusedIndex = coSetLastFocusedIndex;

function coGetInsertPosition() {
  if (coLastFocusedIndex >= 0 && coLastFocusedIndex < currentChangeOrderLineItems.length) {
    return coLastFocusedIndex + 1;
  }
  return currentChangeOrderLineItems.length;
}

/** Same convention as estimates: a new group lands after the entire
 * current group's last member, not just after the focused row, so it
 * can't end up spliced into the middle of the group being worked on. */
function coGetGroupBoundaryInsertPosition() {
  if (coLastFocusedIndex < 0 || coLastFocusedIndex >= currentChangeOrderLineItems.length) {
    return currentChangeOrderLineItems.length;
  }
  const focusedGroup = currentChangeOrderLineItems[coLastFocusedIndex].groupName || null;
  if (!focusedGroup) return coLastFocusedIndex + 1;
  let lastIdx = coLastFocusedIndex;
  currentChangeOrderLineItems.forEach((it, i) => {
    if ((it.groupName || null) === focusedGroup) lastIdx = i;
  });
  return lastIdx + 1;
}

function coGroupNameExists(name) {
  return currentChangeOrderLineItems.some((it) => (it.groupName || "").toLowerCase() === name.toLowerCase());
}

/**
 * Builds one <tr> for the Change Order line items table. type is
 * "item" (normal, default), "header" (description only, spans where the
 * numeric columns would be -- used to break the list into named
 * sections), or "indented" (a normal item, just with its description
 * padded to visually nest under a preceding header). Unlike the earlier
 * version of this function, rows are now index-addressed against
 * currentChangeOrderLineItems (via coUpdateLineField) rather than
 * queried directly from the DOM at save time -- required for grouping,
 * since a group's own subtotal has to be recomputed and the whole table
 * re-rendered whenever any line in it changes, not just read once at
 * the end.
 */
function coLineItemRowHtml(item, index) {
  item = item || {};
  const type = item.type === "header" || item.type === "indented" ? item.type : "item";
  const descStyle =
    type === "header"
      ? "width:100%; padding:8px; font-size:14px; font-weight:800; border:1.5px solid var(--border); border-radius:8px; background:var(--card-light);"
      : type === "indented"
        ? "width:100%; padding:8px 8px 8px 24px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"
        : "width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;";
  const deleteBtnCell = `<td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="window.coRemoveLineItem(${index})" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>`;

  if (type === "header") {
    return `<tr class="co-line-row" onfocusin="window.coSetLastFocusedIndex(${index})">
    <td colspan="4" style="padding:4px; border-bottom:1px solid var(--border);"><input value="${escapeAttr(item.description || "")}" placeholder="Section heading" style="${descStyle}" oninput="window.coUpdateLineField(${index}, 'description', this.value)"></td>
    ${deleteBtnCell}
  </tr>`;
  }

  const amt = roundMoney((Number(item.qty) || 0) * (Number(item.rate) || 0));
  return `<tr class="co-line-row" onfocusin="window.coSetLastFocusedIndex(${index})">
    <td style="padding:4px; border-bottom:1px solid var(--border);"><input value="${escapeAttr(item.description || "")}" placeholder="Description" style="${descStyle}" oninput="window.coUpdateLineField(${index}, 'description', this.value)"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input type="number" value="${escapeAttr(item.qty != null ? item.qty : "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.coUpdateLineField(${index}, 'qty', this.value)"></td>
    <td style="padding:4px; border-bottom:1px solid var(--border); width:80px;"><input type="number" value="${escapeAttr(item.rate != null ? item.rate : "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.coUpdateLineField(${index}, 'rate', this.value)"></td>
    <td id="co-amt-${index}" style="padding:4px; border-bottom:1px solid var(--border); width:90px; text-align:right; font-weight:700; font-size:14px;">₦${moneyValue(amt)}</td>
    ${deleteBtnCell}
  </tr>`;
}

function coUpdateLineField(index, field, value) {
  if (!currentChangeOrderLineItems[index]) return;
  currentChangeOrderLineItems[index][field] = (field === "qty" || field === "rate") ? (Number(value) || 0) : value;
  if (field === "qty" || field === "rate") {
    const item = currentChangeOrderLineItems[index];
    const amt = roundMoney((Number(item.qty) || 0) * (Number(item.rate) || 0));
    const amtCell = document.getElementById("co-amt-" + index);
    if (amtCell) amtCell.innerText = "₦" + moneyValue(amt);
    recalcChangeOrderTotals();
  }
}
window.coUpdateLineField = coUpdateLineField;

function coRemoveLineItem(index) {
  currentChangeOrderLineItems.splice(index, 1);
  renderCoLineItemsTable();
}
window.coRemoveLineItem = coRemoveLineItem;

/**
 * Central re-render for the Change Order line items table -- always
 * rendered in the same "mixed" layout regardless of whether any groups
 * exist yet: items with no groupName render inline in original order,
 * and any groupName that appears gets its own heading + subtotal row,
 * with all of that group's members shown together underneath it
 * (grouped by name, not by their position in the array -- same
 * convention estimates.js already uses).
 */
function renderCoLineItemsTable() {
  const tbody = document.getElementById("co_line_items_body");
  if (!tbody) return;

  let rowsHtml = "";
  const seenGroups = [];
  currentChangeOrderLineItems.forEach((item) => {
    const g = item.groupName || "";
    if (seenGroups.indexOf(g) === -1) seenGroups.push(g);
  });
  seenGroups.forEach((g) => {
    if (g) {
      rowsHtml += `<tr><td colspan="4" style="padding:8px 4px 4px;"><span style="font-weight:800; text-decoration:underline; font-size:13px;">${escapeHtml(g)}</span></td><td></td></tr>`;
    }
    currentChangeOrderLineItems.forEach((item, idx) => {
      if ((item.groupName || "") === g) rowsHtml += coLineItemRowHtml(item, idx);
    });
    if (g) {
      const groupTotal = currentChangeOrderLineItems
        .filter((item) => (item.groupName || "") === g)
        .reduce((s, item) => roundMoney(s + (Number(item.qty) || 0) * (Number(item.rate) || 0)), 0);
      rowsHtml += `<tr><td colspan="3" style="text-align:right; padding:4px; font-weight:700; font-size:12px; color:var(--muted);">Group Subtotal</td><td style="text-align:right; padding:4px; font-weight:700; font-size:12px;">₦${moneyValue(groupTotal)}</td><td></td></tr>`;
    }
  });

  tbody.innerHTML = rowsHtml || '<tr><td colspan="5" style="text-align:center; padding:14px; color:var(--muted); font-size:12px;">No line items yet.</td></tr>';
  recalcChangeOrderTotals();
}
window.renderCoLineItemsTable = renderCoLineItemsTable;

function coAddBlankGroup() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:20px; max-width:360px; width:90%;">' +
    '<h3 style="margin-top:0;">Name This Group</h3>' +
    '<input id="co-blank-group-name-input" placeholder="e.g. Miscellaneous" style="width:100%; padding:10px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">' +
    '<div style="display:flex; gap:8px; margin-top:14px;">' +
    '<button type="button" class="action-btn co-blank-group-cancel" style="background:var(--card-light); color:var(--text);">Cancel</button>' +
    '<button type="button" class="action-btn co-blank-group-confirm">Add Group</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#co-blank-group-name-input");
  input.focus();

  const confirmAdd = function () {
    const name = input.value.trim();
    if (!name) return;
    if (coGroupNameExists(name)) {
      alert('"' + name + '" has already been added to this change order. Choose a different name.');
      return;
    }
    const insertAt = coGetGroupBoundaryInsertPosition();
    currentChangeOrderLineItems.splice(insertAt, 0, { groupName: name, description: "", qty: 1, rate: 0, type: "item" });
    coLastFocusedIndex = insertAt;
    renderCoLineItemsTable();
    overlay.remove();
  };

  overlay.querySelector(".co-blank-group-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelector(".co-blank-group-confirm").onclick = confirmAdd;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") confirmAdd();
  });
}
window.coAddBlankGroup = coAddBlankGroup;



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

  currentChangeOrderLineItems = isEdit ? coParseLineItems(editData.lineItems) : [];
  coLastFocusedIndex = -1;

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
      <tbody id="co_line_items_body"></tbody>
    </table>
    <div style="position:relative; display:inline-block;">
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.coToggleAddMenu(event)">
        <i class="fas fa-plus"></i> Add
      </button>
      <div id="co_add_menu" style="display:none; position:absolute; top:100%; left:0; margin-top:4px; background:#fff; border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.18); z-index:50; min-width:160px; overflow:hidden;">
        <div class="co-add-menu-item" onclick="window.coAddMenuAction('item')" style="padding:10px 14px; font-size:13px; cursor:pointer;">Line Item</div>
        <div class="co-add-menu-item" onclick="window.coAddMenuAction('indented')" style="padding:10px 14px; font-size:13px; cursor:pointer;">Indented Line</div>
        <div class="co-add-menu-item" onclick="window.coAddMenuAction('header')" style="padding:10px 14px; font-size:13px; cursor:pointer;">Header</div>
        <div class="co-add-menu-item" onclick="window.coAddMenuAction('group')" style="padding:10px 14px; font-size:13px; cursor:pointer; border-top:1px solid var(--border);">Group</div>
      </div>
    </div>

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

  renderCoLineItemsTable();

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

    const lineItems = currentChangeOrderLineItems
      .filter((item) => (item.description || "").trim())
      .map((item) => {
        const type = item.type === "header" || item.type === "indented" ? item.type : "item";
        const base = {
          description: item.description.trim(),
          type: type,
          groupName: item.groupName || null,
        };
        if (type === "header") return base;
        const qty = Number(item.qty) || 0;
        const rate = Number(item.rate) || 0;
        return { ...base, qty, rate, amount: roundMoney(qty * rate) };
      });

    if (!lineItems.length) {
      alert("Add at least one line item");
      return;
    }

    const subtotal = lineItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
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

function coToggleAddMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById("co_add_menu");
  if (!menu) return;
  const opening = menu.style.display === "none";
  menu.style.display = opening ? "block" : "none";
  if (opening) {
    // Close on any click elsewhere -- registered fresh each time the
    // menu opens, and removes itself the moment it fires, so it never
    // piles up duplicate listeners across repeated opens.
    const closeOnOutsideClick = function (e) {
      if (!menu.contains(e.target)) {
        menu.style.display = "none";
        document.removeEventListener("click", closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
  }
}
window.coToggleAddMenu = coToggleAddMenu;

function coAddMenuAction(action) {
  const menu = document.getElementById("co_add_menu");
  if (menu) menu.style.display = "none";
  if (action === "group") {
    coAddBlankGroup();
    return;
  }
  addChangeOrderLineItem(action);
}
window.coAddMenuAction = coAddMenuAction;

function addChangeOrderLineItem(type) {
  type = type === "header" || type === "indented" ? type : "item";
  const insertAt = coGetInsertPosition();
  const inheritedGroup = insertAt > 0 ? currentChangeOrderLineItems[insertAt - 1].groupName || null : null;
  const newItem = type === "header"
    ? { groupName: inheritedGroup, description: "", type: "header" }
    : { groupName: inheritedGroup, description: "", qty: 1, rate: 0, type: type };
  currentChangeOrderLineItems.splice(insertAt, 0, newItem);
  coLastFocusedIndex = insertAt;
  renderCoLineItemsTable();
}

function recalcChangeOrderTotals() {
  const subtotal = roundMoney(
    currentChangeOrderLineItems.reduce(
      (s, item) => s + (Number(item.qty) || 0) * (Number(item.rate) || 0),
      0,
    ),
  );
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

  function coRowHtml(item) {
    if (item.type === "header") {
      return `<tr>
          <td colspan="4" style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(item.description || "")}</td>
        </tr>`;
    }
    const descPadding = item.type === "indented" ? "padding:8px 8px 8px 24px;" : "padding:8px;";
    return `<tr>
          <td style="border-bottom:1px solid #adb5bd; ${descPadding} font-size:12px;">${escapeHtml(item.description || "")}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">${escapeHtml(item.qty != null ? item.qty : "")}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(item.rate)}</td>
          <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700;">₦${moneyValue(item.amount)}</td>
        </tr>`;
  }

  let itemRows = "";
  const coSeenGroups = [];
  lineItems.forEach((item) => {
    const g = item.groupName || "";
    if (coSeenGroups.indexOf(g) === -1) coSeenGroups.push(g);
  });
  coSeenGroups.forEach((g) => {
    if (g) {
      itemRows += `<tr><td colspan="4" style="padding:8px 8px 4px; font-weight:800; text-decoration:underline; font-size:12.5px;">${escapeHtml(g)}</td></tr>`;
    }
    lineItems.filter((item) => (item.groupName || "") === g).forEach((item) => {
      itemRows += coRowHtml(item);
    });
    if (g) {
      const groupTotal = roundMoney(
        lineItems
          .filter((item) => (item.groupName || "") === g)
          .reduce((s, item) => s + (Number(item.amount) || 0), 0),
      );
      itemRows += `<tr><td colspan="3" style="text-align:right; padding:8px; font-weight:700; font-size:12px; border-bottom:1px solid #000;">Group Subtotal</td><td style="text-align:right; padding:8px; font-weight:700; font-size:12px; border-bottom:1px solid #000;">₦${moneyValue(groupTotal)}</td></tr>`;
    }
  });

  const subtotal = Number(changeOrder.subtotal) || 0;
  const vat = Number(changeOrder.vat) || 0;
  const total = Number(changeOrder.total) || 0;

  // Per-user signature first, falling back to the company-wide one --
  // same shared function estimates.js uses, rather than the simpler
  // inline signature HTML this report built on its own before, which
  // didn't have the same layered name/image fallbacks.
  const signatureHtml = await generateInspectionSignatureBlocks((await _getSignatoryName()) || "Kayode Olubisi");
  const includeClientSig =
    document.getElementById("co-rep-client-sig")?.checked;
  const includeBankDetails =
    document.getElementById("co-rep-bank-details")?.checked;

  let clientSigBlock = "";
  if (includeClientSig) {
    clientSigBlock = `<div style="margin-top: 32px; page-break-inside: avoid; text-align: left; flex:1;">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; color: #495057;">Client Signatory</div>
      <div style="display: inline-block; text-align: center;">
        <div style="font-size: 12px; font-weight: 700;">${escapeHtml(project.clientName || "_________________________")}</div>
      </div>
    </div>`;
  }

  // Same structure and defaults as estimates.js's own account details
  // block, just gated by a print-time checkbox here rather than a
  // persisted per-record toggle, since change orders don't carry a
  // showAccountDetails field of their own.
  const accountDetailsHtml = includeBankDetails
    ? '<div style="border:1px solid #000; padding:8px 12px; font-size:11px; line-height:1.7; max-width:220px;">' +
      (settings.Account_Name ? '<div>' + escapeHtml(settings.Account_Name) + '</div>' : '') +
      (settings.Bank_Name ? '<div>' + escapeHtml(settings.Bank_Name) + '</div>' : '') +
      (settings.Account_Number ? '<div>' + escapeHtml(settings.Account_Number) + '</div>' : '') +
      '</div>'
    : '';

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
      <div style="display:flex; gap:24px; flex-wrap:wrap; margin-top:16px;">
        <div style="display:flex; align-items:flex-end; gap:50mm;">${signatureHtml}${accountDetailsHtml}</div>
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
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:700; cursor:pointer;">
      <input type="checkbox" id="co-rep-bank-details" style="width:auto;" onchange="window.regenerateChangeOrderPreview('${escapeAttr(changeOrderId)}')">
      Include banking details
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
