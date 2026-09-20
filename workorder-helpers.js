// ===== workorder-helpers.js =====
function addTakeOffLineItem(rowData) {
  const tbody = document.getElementById("to_line_items_body");
  if (!tbody) return;
  const unitOptions = MASTER_UNITS.map(
    (u) =>
      `<option value="${escapeAttr(u.value)}" ${rowData && rowData.unit === u.value ? "selected" : ""}>${escapeHtml(u.label)}</option>`,
  ).join("");
  const row = document.createElement("tr");
  row.className = "to-line-row";
  row.dataset.itemId =
    rowData && rowData.itemId ? escapeAttr(rowData.itemId) : "";
  row.innerHTML = `<td style="padding:4px; border-bottom:1px solid var(--border);"><input class="to-line-desc" value="${escapeAttr(rowData && rowData.description ? rowData.description : "")}" placeholder="Description" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input class="to-line-qty" type="number" value="${escapeAttr(rowData && rowData.quantity ? rowData.quantity : "")}" placeholder="Qty" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><select class="to-line-unit" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><option value="" disabled ${!(rowData && rowData.unit) ? "selected" : ""}>Select unit</option>${unitOptions}</select></td>
  <td style="padding:4px; border-bottom:1px solid var(--border);"><input class="to-line-notes" value="${escapeAttr(rowData && rowData.notes ? rowData.notes : "")}" placeholder="Notes" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="this.closest('tr').remove();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>`;
  tbody.appendChild(row);
}

function addTakeOffHeader() {
  const tbody = document.getElementById("to_line_items_body");
  if (!tbody) return;
  const row = document.createElement("tr");
  row.className = "to-line-row to-header-row";
  row.innerHTML = `<td colspan="4" style="padding:4px; border-bottom:1px solid var(--border); background:#e9ecef;"><input class="to-line-desc" value="" placeholder="Header text..." style="width:100%; padding:10px; font-size:15px; font-weight:800; border:1.5px solid var(--border); border-radius:8px; background:#fff;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center; background:#e9ecef;"><button onclick="this.closest('tr').remove();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>`;
  tbody.appendChild(row);
}

function addWorkOrderLineItem(desc, qty, um, rate) {
  const tbody = document.getElementById("wo_line_items_body");
  if (!tbody) return;
  const row = document.createElement("tr");
  row.className = "wo-line-row";
  row.innerHTML = `<td style="padding:4px; border-bottom:1px solid var(--border);"><input class="wo-line-desc" value="${escapeAttr(desc || "")}" placeholder="Description" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:60px;"><input class="wo-line-qty" type="number" value="${escapeAttr(qty || 1)}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcWorkOrderTotal()"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:70px;"><input class="wo-line-um" value="${escapeAttr(um || "")}" placeholder="U/M" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:center;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="wo-line-rate" type="number" value="${escapeAttr(rate || "")}" min="0" step="0.01" style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;" oninput="window.recalcWorkOrderTotal()"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:90px;"><input class="wo-line-amt" type="number" value="0" disabled style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right; background:#f5f5f5;"></td>
  <td style="padding:4px; border-bottom:1px solid var(--border); width:30px; text-align:center;"><button onclick="this.closest('tr').remove(); window.recalcWorkOrderTotal();" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; width:28px; height:28px; font-size:14px;">×</button></td>`;
  tbody.appendChild(row);
  recalcWorkOrderTotal();
}

function recalcWorkOrderTotal() {
  const rows = document.querySelectorAll("#wo_line_items_body tr");
  let total = 0;
  rows.forEach((row) => {
    const qty = Number(row.querySelector(".wo-line-qty").value) || 0;
    const rate = Number(row.querySelector(".wo-line-rate").value) || 0;
    const amt = roundMoney(qty * rate);
    row.querySelector(".wo-line-amt").value = amt;
    total += amt;
  });
  total = roundMoney(total);
  const totalDisplay = document.getElementById("wo_total_display");
  if (totalDisplay) totalDisplay.innerText = "₦" + moneyValue(total);
  const hiddenAmount = document.getElementById("wo_amount_hidden");
  if (hiddenAmount) hiddenAmount.value = total;
}

function formatWorkOrderDescription(description) {
  if (!description) return "—";
  try {
    const parsed = JSON.parse(description);
    if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
      const count = parsed.lineItems.length;
      const firstItem = parsed.lineItems[0]?.description || "";
      return `${count} item${count !== 1 ? "s" : ""}${firstItem ? ": " + firstItem : ""}`;
    }
  } catch (e) {}
  return description.length > 60
    ? description.substring(0, 60) + "..."
    : description;
}

function populateWorkOrderDropdown() {
  const filterSel = document.getElementById("rep-filter-sel");
  const woWrap = document.getElementById("rep-workorder-wrap");
  const woSel = document.getElementById("rep-workorder-sel");
  if (!filterSel || !woWrap || !woSel) return;
  const projectId = filterSel.value;
  if (!projectId) {
    woWrap.style.display = "none";
    return;
  }
  const cache = getCache();
  const projectWOs = (cache.workorders || []).filter(
    (w) => w.projectId === projectId,
  );
  if (!projectWOs.length) {
    woSel.innerHTML = '<option value="">No work orders</option>';
    woWrap.style.display = "block";
    return;
  }
  woSel.innerHTML =
    '<option value="">-- Select Work Order --</option>' +
    projectWOs
      .map((w) => {
        const vendor = (cache.vendors || []).find(
          (v) => v.vendorId === w.vendorId,
        );
        const vendorName = vendor ? vendor.company : w.vendorId;
        return `<option value="${escapeAttr(w.workOrderId)}">${escapeHtml(vendorName)} — ${escapeHtml(w.workOrderId)} (₦${moneyValue(w.amount)})</option>`;
      })
      .join("");
  woWrap.style.display = "block";
}

async function renderWorkOrderDetailReport(workorder, project, vendors, settings, selectedAttachmentIndex) {
  const vendor = vendors.find((v) => v.vendorId === workorder.vendorId);
  const terms = [];
  for (let i = 1; i <= 10; i++) {
    const key = `WO${i}`;
    if (settings && settings[key]) terms.push({ num: i, text: settings[key] });
  }

  let lineItems = [];
  let notes = workorder.description || "";
  try {
    const parsed = JSON.parse(workorder.description);
    if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
      lineItems = parsed.lineItems;
      notes = parsed.notes || "";
    }
  } catch (e) {}

  if (!lineItems.length) {
    lineItems = [
      {
        description: workorder.description || "—",
        qty: 1,
        rate: Number(workorder.amount) || 0,
        amount: Number(workorder.amount) || 0,
      },
    ];
  }

  const itemRows = lineItems
    .map(
      (item) =>
        `<tr>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; vertical-align:top;">${escapeHtml(item.description)}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">${escapeHtml(String(item.qty))}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:center; vertical-align:top;">${escapeHtml(item.um || "—")}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top;">₦${moneyValue(item.rate)}</td>
      <td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; vertical-align:top; font-weight:700;">₦${moneyValue(item.amount)}</td>
    </tr>`,
    )
    .join("");

  const totalWO = Number(workorder.amount) || 0;

  let termsHtml = "";
  if (terms.length) {
    termsHtml = `<div style="margin-top: 24px; page-break-inside: avoid;">
      <h3 style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #000; padding-bottom: 4px;">Terms & Conditions</h3>
      <ol style="font-size: 12px; line-height: 1.6; padding-left: 20px;">
        ${terms.map((t) => `<li style="margin-bottom: 6px;">${escapeHtml(t.text)}</li>`).join("")}
      </ol>
    </div>`;
  }

  let notesHtml = "";
  if (notes) {
    notesHtml = `<div style="margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px; border: 1px solid #adb5bd;">
      <strong style="font-size: 12px; text-transform: uppercase;">Notes</strong>
      <p style="font-size: 12px; margin-top: 4px; line-height: 1.5;">${escapeHtml(notes)}</p>
    </div>`;
  }

  const resolvedAttachments = await resolveSingleAttachment(workorder.attachments, selectedAttachmentIndex);
  const attachmentsHtml = renderAttachmentsSectionHtml(resolvedAttachments, "Attachment");

  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const logoUrl =
    settings && settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";

  let headerHtml = `<div class="report-header" style="border-bottom: 2.5px solid #000; padding-bottom: 2px; margin-bottom: 18px;"><div style="display: flex; justify-content: space-between; align-items: flex-end;">`;
  headerHtml += `<div style="flex:1;"><div style="font-size: 11px; color: #495057; font-weight: 600; margin-bottom: 2px;">${escapeHtml(dateStr)}</div><div style="font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #495057; line-height: 1.1;">Work Order</div></div>`;
  if (logoUrl) {
    headerHtml += `<div style="flex-shrink:0; margin-left:16px; text-align:right;"><img src="${escapeAttr(logoUrl)}" style="max-height:120px; max-width:280px; object-fit:contain;" onerror="this.style.display='none'"></div>`;
  }
  headerHtml += `</div>`;
  headerHtml += `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #adb5bd; font-size: 12px; line-height: 1.6;"><div style="display: flex; justify-content: flex-end; align-items: baseline;"><div style="font-size:16px;"><strong style="color:#000;">Work Order ID:</strong> ${escapeHtml(workorder.workOrderId || "—")}</div></div></div>`;
  headerHtml += `</div>`;

  let signatureBlock = await generateInspectionSignatureBlocks((await _getSignatoryName()) || "Kayode Olubisi");

  return `<div class="report-page-wrapper">
    <div class="report-content">
      ${headerHtml}
      <div style="margin-bottom: 16px; font-size: 12px; line-height: 1.6;">
        <div><strong>Vendor:</strong> ${escapeHtml(vendor ? vendor.company : workorder.vendorId)}${vendor && vendor.trade ? ` (${escapeHtml(vendor.trade)})` : ""}</div>
        <div><strong>Contact:</strong> ${escapeHtml(vendor ? vendor.contactName : "—")}</div>
        <div><strong>Phone:</strong> ${escapeHtml(vendor ? vendor.phone1 : "—")}</div>
        <div><strong>Status:</strong> ${escapeHtml(workorder.status)}</div>
      </div>
      <table class="report-table" style="width:100%; border-collapse: collapse; font-size:12px; margin-bottom: 16px;">
        <thead>
          <tr>
            <th style="background:#000; color:#fff; text-align:left; padding:8px; font-size:10px; text-transform:uppercase;">Description</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:60px;">Qty</th>
            <th style="background:#000; color:#fff; text-align:center; padding:8px; font-size:10px; text-transform:uppercase; width:70px;">U/M</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:90px;">Rate (₦)</th>
            <th style="background:#000; color:#fff; text-align:right; padding:8px; font-size:10px; text-transform:uppercase; width:90px;">Amount (₦)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr style="background:#e9ecef; font-weight:900;">
            <td colspan="4" style="border-bottom:2px solid #000; padding:8px; font-size:12px;"><strong>TOTAL WORK ORDER VALUE</strong></td>
            <td style="border-bottom:2px solid #000; padding:8px; font-size:12px; text-align:right;">₦${moneyValue(totalWO)}</td>
          </tr>
        </tbody>
      </table>
      ${notesHtml}
      ${attachmentsHtml}
      ${termsHtml}
      ${signatureBlock}
    </div>
    ${generateReportFooter()}
  </div>`;
}