// ===== takeoff-helpers.js =====
// Split out of workorder-helpers.js during a codebase organization pass --
// these two functions are genuinely Take-Off UI helpers, not Work Order
// ones, and were only ever sharing that file by accident of when they were
// added, not because they belong together.

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
