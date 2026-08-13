// ===== templates.js =======
const MASTER_ROOM_TYPES = [
  "Living Room",
  "Master Bedroom",
  "Bedroom",
  "Kitchen",
  "Bathroom/Toilet",
  "En-suite",
  "Dining Room",
  "Corridor/Hallway",
  "Staircase",
  "Store/Pantry",
  "Balcony/Terrace",
  "Entrance/Foyer",
  "Garage",
  "External Works",
];

const MASTER_TRADE_CATEGORIES = [
  "Civil/Structural",
  "Masonry/Blockwork",
  "Carpentry/Joinery",
  "Electrical",
  "Plumbing/Mechanical",
  "Tiling/Flooring",
  "Painting/Decorating",
  "Roofing",
  "Aluminum/Glazing",
  "Ironmongery",
  "Landscaping",
  "Security/Access Control",
  "Fire Protection",
  "HVAC/AC",
  "Waterproofing",
];

const MASTER_UNITS = [
  { value: "sqm", label: "sqm — Square Metres" },
  { value: "m", label: "m — Metres" },
  { value: "pcs", label: "pcs — Pieces" },
  { value: "set", label: "set — Set" },
  { value: "lot", label: "lot — Lot" },
  { value: "kg", label: "kg — Kilograms" },
  { value: "bag", label: "bag — Bag" },
  { value: "drum", label: "drum — Drum" },
  { value: "roll", label: "roll — Roll" },
  { value: "m³", label: "m³ — Cubic Metres" },
];

// Shared <option> list for any unit dropdown that should be restricted to
// MASTER_UNITS (as opposed to a freeform text field a user could mistype).
function buildUnitOptionsHtml(selectedUnit) {
  return MASTER_UNITS.map(
    (u) =>
      `<option value="${escapeAttr(u.value)}" ${selectedUnit === u.value ? "selected" : ""}>${escapeHtml(u.label)}</option>`,
  ).join("");
}

const BUILT_IN_TEMPLATES = [];

// Search term for the templates segment list. Templates are not project-scoped,
// so this search is already "global" across every saved template.
let templateSearchTerm = "";

function getBuiltInTemplates() {
  return [];
}
function getCustomTemplates() {
  try {
    const raw = localStorage.getItem("fb_customTemplates");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// Persist to localStorage AND sync each template to the backend sheet.
// Pass syncToSheet=false for bulk-replace operations that call syncTemplatesToSheet() themselves.
function saveCustomTemplates(templates, syncToSheet = true) {
  localStorage.setItem("fb_customTemplates", JSON.stringify(templates));
  if (syncToSheet) {
    // Fire-and-forget — don't block the UI
    syncTemplatesToSheet(templates).catch((e) =>
      console.warn("Template sheet sync failed:", e),
    );
  }
}

// Push every custom template to the backend sheet (upsert).
// Called after any create/edit/import operation.
async function syncTemplatesToSheet(templates) {
  if (!navigator.onLine) return; // will naturally re-sync next time user is online
  const results = await Promise.allSettled(
    templates.map((t) =>
      callApi("saveTakeOffTemplate", {
        templateId: t.id,
        name: t.name,
        description: t.description || "",
        items: t.items || [],
      }),
    ),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn("syncTemplatesToSheet: failed for", templates[i].id, result.reason);
    }
  });
}

// Load templates from the backend sheet and merge into localStorage.
// Sheet is the source of truth; localStorage is the cache.
// Returns the merged array so callers can re-render immediately.
async function loadTemplatesFromSheet() {
  try {
    const res = await callApi("getTakeOffTemplates", {});
    // Backend returns an array directly (or wrapped in { data: [...] })
    const sheetTemplates = Array.isArray(res)
      ? res
      : Array.isArray(res?.data)
        ? res.data
        : [];

    if (!sheetTemplates.length) return getCustomTemplates();

    const local = getCustomTemplates();
    const localMap = new Map(local.map((t) => [t.id, t]));

    // Merge: sheet wins on conflicts (sheet is source of truth)
    sheetTemplates.forEach((s) => {
      localMap.set(s.templateId || s.id, {
        id: s.templateId || s.id,
        name: s.name || "",
        description: s.description || "",
        items: Array.isArray(s.items) ? s.items : [],
      });
    });

    const merged = Array.from(localMap.values());
    // Write merged result back to localStorage without re-syncing to sheet
    saveCustomTemplates(merged, false);
    return merged;
  } catch (e) {
    console.warn("loadTemplatesFromSheet failed:", e);
    return getCustomTemplates();
  }
}
function getHiddenBuiltInIds() {
  return new Set();
}
function saveHiddenBuiltInIds(ids) {
  localStorage.setItem(
    "fb_hiddenBuiltInTemplates",
    JSON.stringify(Array.from(ids)),
  );
}
function hideBuiltInTemplate(id) {
  const hidden = getHiddenBuiltInIds();
  hidden.add(id);
  saveHiddenBuiltInIds(hidden);
  loadTemplatesSegment();
}
function hideAllBuiltInTemplates() {
  saveHiddenBuiltInIds(new Set(getBuiltInTemplates().map((t) => t.id)));
  loadTemplatesSegment();
}
function showAllBuiltInTemplates() {
  localStorage.setItem("fb_hiddenBuiltInTemplates", JSON.stringify([]));
  loadTemplatesSegment();
}
function getAllTemplates() {
  return getCustomTemplates();
}
function findTemplateById(id) {
  return getAllTemplates().find((t) => t.id === id);
}
function deleteCustomTemplate(id) {
  const filtered = getCustomTemplates().filter((t) => t.id !== id);
  saveCustomTemplates(filtered, false); // localStorage only — sheet deletion is separate
  selectedTemplateIds.delete(id);
  // Delete from sheet (fire-and-forget)
  callApi("deleteTakeOffTemplate", { templateId: id }).catch((e) =>
    console.warn("deleteTakeOffTemplate sheet sync failed:", e),
  );
}
function generateTemplateId() {
  return "TMPL-CUST-" + Date.now();
}

// Clone an existing template as a starting point for a new one.
// Quantities are reset to 0, same as any freshly saved/imported template.
function duplicateTemplate(id) {
  const t = findTemplateById(id);
  if (!t) return;
  const newTemplate = {
    id: generateTemplateId(),
    name: t.name + " (Copy)",
    description: t.description || "",
    items: (t.items || []).map((i) => ({ ...i, quantity: 0 })),
  };
  const custom = getCustomTemplates();
  custom.push(newTemplate);
  saveCustomTemplates(custom, false); // localStorage immediately
  loadTemplatesSegment();
  callApi("saveTakeOffTemplate", {
    templateId: newTemplate.id,
    name: newTemplate.name,
    description: newTemplate.description,
    items: newTemplate.items,
  })
    .then(() => showSyncToast(`✅ Duplicated "${t.name}"`))
    .catch((e) => {
      console.warn("duplicateTemplate sheet sync failed:", e);
      showSyncToast("⚠️ Duplicated locally. Sheet sync failed.");
    });
}

function exportAllTemplatesJSON() {
  const templates = getCustomTemplates();
  if (!templates.length) {
    alert("No custom templates to export.");
    return;
  }
  const data = {
    exportedAt: new Date().toISOString(),
    app: "FieldScan Pro",
    version: "1.0",
    templates: templates,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FieldScan_Templates_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSingleTemplateJSON(templateId) {
  const t = findTemplateById(templateId);
  if (!t) {
    alert("Template not found.");
    return;
  }
  const data = {
    exportedAt: new Date().toISOString(),
    app: "FieldScan Pro",
    version: "1.0",
    templates: [t],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FieldScan_Template_${t.name.replace(/[^a-z0-9]/gi, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importTemplatesFromJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || !Array.isArray(data.templates)) {
          reject(
            new Error("Invalid template file. Missing 'templates' array."),
          );
          return;
        }
        const incoming = data.templates.filter(
          (t) => t && t.id && t.name && Array.isArray(t.items),
        );
        if (!incoming.length) {
          reject(new Error("No valid templates found in file."));
          return;
        }
        const existing = getCustomTemplates();
        const existingIds = new Set(existing.map((t) => t.id));
        // Only values from MASTER_UNITS are allowed. Anything else in the
        // imported file (typos, freeform text, units from another app) is
        // defaulted to "pcs" rather than trusted verbatim.
        const VALID_UNITS = new Set(MASTER_UNITS.map((u) => u.value));
        let added = 0,
          skipped = 0,
          correctedUnits = 0;
        incoming.forEach((t) => {
          if (existingIds.has(t.id)) {
            skipped++;
          } else {
            // Strip any non-template fields and ensure clean structure
            const clean = {
              id: t.id,
              name: t.name,
              description: t.description || "Imported template",
              items: (t.items || []).map((i) => {
                const rawUnit = String(i.unit || "")
                  .trim()
                  .toLowerCase();
                const isValidUnit = VALID_UNITS.has(rawUnit);
                if (!isValidUnit && i.unit) correctedUnits++;
                return {
                  roomArea: i.roomArea || "",
                  tradeCategory: i.tradeCategory || "",
                  description: i.description || "",
                  unit: isValidUnit ? rawUnit : "pcs",
                  // Quantities are always reset to 0 on import — templates
                  // define scope/structure, not project-specific amounts.
                  quantity: 0,
                };
              }),
            };
            existing.push(clean);
            added++;
          }
        });
        saveCustomTemplates(existing, false); // localStorage
        // Sync only the newly added templates to the sheet
        const newOnes = existing.filter((t) => !existingIds.has(t.id));
        syncTemplatesToSheet(newOnes).catch((e) =>
          console.warn("Import sheet sync failed:", e),
        );
        resolve({ added, skipped, total: incoming.length, correctedUnits });
      } catch (e) {
        reject(
          new Error("Failed to parse JSON: " + (e.message || "Unknown error")),
        );
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

function openImportTemplatesModal() {
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Import Templates";
  overlay.style.display = "flex";
  body.innerHTML = `<p style="font-size:14px; color:var(--muted); margin-bottom:12px;">Select a JSON file exported from FieldScan Pro. Templates with duplicate IDs will be skipped.</p><input type="file" id="tmpl_import_file" accept="application/json" style="width:100%; padding:12px; font-size:16px;"><div id="tmpl_import_result" style="margin-top:12px; font-size:13px; font-weight:700; display:none;"></div>`;
  submit.style.display = "block";
  submit.innerText = "Import";
  submit.onclick = async () => {
    const fileInput = document.getElementById("tmpl_import_file");
    if (!fileInput.files || !fileInput.files[0]) {
      alert("Select a JSON file");
      return;
    }
    submit.disabled = true;
    submit.innerText = "Importing...";
    try {
      const result = await importTemplatesFromJSON(fileInput.files[0]);
      const resultDiv = document.getElementById("tmpl_import_result");
      resultDiv.style.display = "block";
      resultDiv.innerHTML = `<span style="color:var(--success);">✓ ${result.added} imported</span>${result.skipped > 0 ? `, <span style="color:#fd7e14;">${result.skipped} skipped (duplicate)</span>` : ""}${result.correctedUnits > 0 ? `<br><span style="color:#fd7e14;">⚠ ${result.correctedUnits} item unit${result.correctedUnits !== 1 ? "s" : ""} not recognized — defaulted to "pcs"</span>` : ""}`;
      loadTemplatesSegment();
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (e) {
      alert("⚠️ " + e.message);
      submit.disabled = false;
      submit.innerText = "Import";
    }
  };
}

// Matches on template name/description AND on each item's description,
// room area, and trade category — so searching "tiling" surfaces any
// template that contains a tiling item, not just templates named "Tiling".
function templateMatchesSearch(t, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  if ((t.name || "").toLowerCase().includes(q)) return true;
  if ((t.description || "").toLowerCase().includes(q)) return true;
  return (t.items || []).some(
    (i) =>
      (i.description || "").toLowerCase().includes(q) ||
      (i.roomArea || "").toLowerCase().includes(q) ||
      (i.tradeCategory || "").toLowerCase().includes(q),
  );
}

// Re-renders the list on every keystroke (loadTemplatesSegment rebuilds
// innerHTML), so we manually restore focus + cursor position afterward.
function handleTemplateSearchInput(value) {
  templateSearchTerm = value;
  loadTemplatesSegment();
  const input = document.getElementById("tmpl-search-input");
  if (input) {
    input.focus();
    const pos = value.length;
    input.setSelectionRange(pos, pos);
  }
}

function loadTemplatesSegment() {
  const container = document.getElementById("console-templates-list");
  if (!container) return;
  const all = getAllTemplates();
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const projectItems = (cache.takeoffs || []).filter(
    (i) => i.projectId === projectId,
  );

  let html = "";
  if (projectItems.length > 0) {
    html += `<div class="card" style="background: var(--card-light); border-style: dashed;"><div style="display:flex; justify-content:space-between; align-items:center; gap:10px;"><div><strong style="font-size:15px;">Save Current Take-Offs as Template</strong><div style="font-size:12px; color:var(--muted); margin-top:2px;">${projectItems.length} items in this project</div></div><button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px;" onclick="openSaveAsTemplateModal()"><i class="fas fa-save"></i> Save</button></div></div>`;
  }

  // Templates aren't project-scoped, so this list — and the search below —
  // already spans every template regardless of the currently open project.
  const allCustomTemplates = getCustomTemplates();
  const allIds = new Set(all.map((t) => t.id));
  for (const id of selectedTemplateIds) {
    if (!allIds.has(id)) selectedTemplateIds.delete(id);
  }

  if (!allCustomTemplates.length) {
    html += `<p style="text-align:center; padding:20px; color:var(--muted);">No templates available.</p>`;
    container.innerHTML = html;
    selectedTemplateIds.clear();
    return;
  }

  html += `<div style="margin-top:8px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted);">Templates</div>`;
  html += `<div style="display:flex; gap:6px; flex-wrap:wrap; margin:8px 0;">
    <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.refreshTemplatesFromSheet()"><i class="fas fa-sync-alt"></i> Refresh Templates</button>
    <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.exportAllTemplatesJSON()"><i class="fas fa-download"></i> Export All</button>
    <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--primary);" onclick="window.openImportTemplatesModal()"><i class="fas fa-upload"></i> Import</button>
  </div>`;

  html += `<div style="position:relative; margin:10px 0;">
    <input type="text" id="tmpl-search-input" value="${escapeAttr(templateSearchTerm)}" placeholder="Search all templates by name, description, or item..." oninput="window.handleTemplateSearchInput(this.value)" style="padding-right:36px;">
    ${templateSearchTerm ? `<button type="button" onclick="window.handleTemplateSearchInput('')" title="Clear search" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--muted); font-size:18px; line-height:1; cursor:pointer; padding:4px;">&times;</button>` : ""}
  </div>`;

  const customTemplates = allCustomTemplates.filter((t) =>
    templateMatchesSearch(t, templateSearchTerm),
  );

  if (templateSearchTerm) {
    html += `<div style="font-size:12px; color:var(--muted); margin-bottom:8px;">${customTemplates.length} of ${allCustomTemplates.length} template${allCustomTemplates.length !== 1 ? "s" : ""} match "${escapeHtml(templateSearchTerm)}"</div>`;
  }

  if (customTemplates.length > 0 && selectedTemplateIds.size > 0) {
    html += `<div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0;"><span style="font-size:13px; font-weight:700;">${selectedTemplateIds.size} selected</span><button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--danger);" onclick="window.deleteSelectedTemplates()"><i class="fas fa-trash"></i> Delete Selected</button></div>`;
  }
  if (customTemplates.length) {
    html += customTemplates
      .map((t) => {
        const isChecked = selectedTemplateIds.has(t.id);
        return `<div class="card" style="cursor: default;"><div style="display:flex; justify-content:space-between; align-items:start; gap:12px;"><div style="flex:1;"><div style="display:flex; align-items:center; gap:8px;"><input type="checkbox" style="width:auto; cursor:pointer;" ${isChecked ? "checked" : ""} onclick="window.toggleTemplateSelection('${escapeAttr(t.id)}', this.checked)"><strong style="font-size:16px;">${escapeHtml(t.name)}</strong><span style="font-size:10px; background:var(--primary); color:#fff; padding:2px 6px; border-radius:4px; text-transform:uppercase;">Sheet</span></div><div style="font-size:12px; color:var(--muted); margin-top:3px;">${escapeHtml(t.description)}</div><div style="font-size:11px; color:var(--muted); margin-top:4px;">${t.items.length} items</div></div><div style="display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap;"><button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="previewTemplate('${escapeAttr(t.id)}')" title="Preview"><i class="fas fa-eye"></i></button><button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:#495057;" onclick="openEditTemplateModal('${escapeAttr(t.id)}')" title="Edit"><i class="fas fa-edit"></i></button><button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.duplicateTemplate('${escapeAttr(t.id)}')" title="Duplicate"><i class="fas fa-copy"></i></button><button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.exportSingleTemplateJSON('${escapeAttr(t.id)}')" title="Export"><i class="fas fa-download"></i></button><button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="applyTemplateToProject('${escapeAttr(t.id)}')" title="Apply to current project"><i class="fas fa-check"></i> Apply</button></div></div></div>`;
      })
      .join("");
  } else {
    html += `<p style="text-align:center; padding:12px; color:var(--muted); font-size:13px;">${templateSearchTerm ? "No templates match your search." : "No templates found. Click Refresh Templates to load from sheet."}</p>`;
  }

  container.innerHTML = html;
}

function openSaveAsTemplateModal() {
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Save as Template";
  overlay.style.display = "flex";
  body.innerHTML = `<label style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;">Template Name</label><input id="tmpl_name" style="width:100%; padding:12px; font-size:16px;" placeholder="e.g. My Standard Flat"><label style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;">Description</label><textarea id="tmpl_desc" rows="2" style="width:100%; padding:12px; font-size:16px;" placeholder="Brief description..."></textarea>`;
  submit.style.display = "block";
  submit.innerText = "Save Template";
  submit.onclick = async () => {
    const name = document.getElementById("tmpl_name").value.trim();
    const desc = document.getElementById("tmpl_desc").value.trim();
    if (!name) {
      alert("Enter a template name");
      return;
    }
    const cache = getCache();
    const projectId = getCurrentProjectId();
    const items = (cache.takeoffs || []).filter(
      (i) => i.projectId === projectId,
    );
    if (!items.length) {
      alert("No items to save");
      return;
    }
    const stripped = items.map((i) => ({
      roomArea: i.roomArea,
      tradeCategory: i.tradeCategory,
      description: i.description,
      unit: i.unit,
      quantity: 0,
    }));
    const newTemplate = {
      id: generateTemplateId(),
      name,
      description: desc || "Custom template",
      items: stripped,
    };
    const custom = getCustomTemplates();
    custom.push(newTemplate);
    // Save to localStorage immediately
    saveCustomTemplates(custom, false);
    closeModal();
    loadTemplatesSegment();
    // Sync to sheet in background, show toast on result
    try {
      submit.disabled = true;
      await callApi("saveTakeOffTemplate", {
        templateId: newTemplate.id,
        name: newTemplate.name,
        description: newTemplate.description,
        items: newTemplate.items,
      });
      showSyncToast("✅ Template saved to sheet");
    } catch (e) {
      console.warn("saveTakeOffTemplate sheet sync failed:", e);
      showSyncToast(
        "⚠️ Saved locally. Sheet sync failed — will retry on next refresh.",
      );
    }
  };
}

function openEditTemplateModal(id) {
  const t = findTemplateById(id);
  if (!t) return;

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Edit Template";
  overlay.style.display = "flex";
  const roomOptions = MASTER_ROOM_TYPES.map(
    (r) => `<option value="${escapeAttr(r)}">`,
  ).join("");
  const tradeOptions = MASTER_TRADE_CATEGORIES.map(
    (t) => `<option value="${escapeAttr(t)}">`,
  ).join("");
  const itemsHtml = t.items
    .map(
      (item, idx) =>
        `<div class="tmpl-edit-row" style="display:grid; grid-template-columns: 1fr 1fr 1fr 90px 30px; gap:6px; margin-bottom:8px; align-items:center;"><input list="edit-room-types" value="${escapeAttr(item.roomArea)}" placeholder="Room" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><input list="edit-trade-cats" value="${escapeAttr(item.tradeCategory)}" placeholder="Trade" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><input value="${escapeAttr(item.description)}" placeholder="Description" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><select class="tmpl-edit-unit" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><option value="" disabled ${!item.unit ? "selected" : ""}>Unit</option>${buildUnitOptionsHtml(item.unit)}</select><button onclick="this.parentElement.remove()" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; height:32px; font-size:16px;">×</button></div>`,
    )
    .join("");
  body.innerHTML = `<datalist id="edit-room-types">${roomOptions}</datalist><datalist id="edit-trade-cats">${tradeOptions}</datalist><label style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;">Template Name</label><input id="edit_tmpl_name" value="${escapeAttr(t.name)}" style="width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:12px;"><label style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;">Description</label><textarea id="edit_tmpl_desc" rows="2" style="width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:12px;">${escapeHtml(t.description)}</textarea><div style="margin-top:16px; margin-bottom:8px; font-weight:800; font-size:13px; text-transform:uppercase;">Items</div><div id="edit_tmpl_items">${itemsHtml}</div><button class="action-btn" style="margin-top:10px; background:var(--card-light); color:var(--text);" onclick="addEditTemplateItemRow()"><i class="fas fa-plus"></i> Add Item</button>`;
  submit.style.display = "block";
  submit.innerText = "Save Changes";
  submit.onclick = async () => {
    const name = document.getElementById("edit_tmpl_name").value.trim();
    const desc = document.getElementById("edit_tmpl_desc").value.trim();
    if (!name) {
      alert("Enter a template name");
      return;
    }
    const rows = document.querySelectorAll("#edit_tmpl_items > .tmpl-edit-row");
    const newItems = [];
    rows.forEach((row) => {
      const inputs = row.querySelectorAll("input");
      const description = inputs[2].value.trim();
      const unit = row.querySelector(".tmpl-edit-unit")?.value || "";
      if (description)
        newItems.push({
          roomArea: inputs[0].value.trim(),
          tradeCategory: inputs[1].value.trim(),
          description: description,
          unit: unit || "pcs",
          quantity: 0,
        });
    });
    if (!newItems.length) {
      alert("Template must have at least one item with a description");
      return;
    }
    const custom = getCustomTemplates();
    const idx = custom.findIndex((c) => c.id === id);
    if (idx !== -1) {
      custom[idx].name = name;
      custom[idx].description = desc || "Custom template";
      custom[idx].items = newItems;
      saveCustomTemplates(custom, false); // localStorage immediately
      closeModal();
      loadTemplatesSegment();
      // Sync to sheet in background
      try {
        await callApi("saveTakeOffTemplate", {
          templateId: custom[idx].id,
          name: custom[idx].name,
          description: custom[idx].description,
          items: custom[idx].items,
        });
        showSyncToast("✅ Template updated on sheet");
      } catch (e) {
        console.warn("saveTakeOffTemplate edit sync failed:", e);
        showSyncToast("⚠️ Saved locally. Sheet sync failed.");
      }
    }
  };
}

function addEditTemplateItemRow() {
  const container = document.getElementById("edit_tmpl_items");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "tmpl-edit-row";
  div.style.cssText =
    "display:grid; grid-template-columns: 1fr 1fr 1fr 90px 30px; gap:6px; margin-bottom:8px; align-items:center;";
  div.innerHTML = `<input list="edit-room-types" placeholder="Room" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><input list="edit-trade-cats" placeholder="Trade" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><input placeholder="Description" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><select class="tmpl-edit-unit" style="padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;"><option value="" disabled selected>Unit</option>${buildUnitOptionsHtml("")}</select><button onclick="this.parentElement.remove()" style="background:var(--danger); color:white; border:none; border-radius:6px; cursor:pointer; height:32px; font-size:16px;">×</button>`;
  container.appendChild(div);
}

function previewTemplate(id) {
  const t = findTemplateById(id);
  if (!t) return;
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Template Preview: " + t.name;
  overlay.style.display = "flex";
  const rows = t.items
    .map(
      (i) =>
        `<tr><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(i.roomArea)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(i.tradeCategory)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px;">${escapeHtml(i.description)}</td><td style="border-bottom:1px solid #adb5bd; padding:8px; font-size:12px; text-align:right; font-weight:700;">${escapeHtml(i.quantity)} ${escapeHtml(i.unit)}</td></tr>`,
    )
    .join("");
  body.innerHTML = `<p style="color:var(--muted); font-size:13px; margin-bottom:10px;">${escapeHtml(t.description)} — ${t.items.length} items</p><div style="max-height:50vh; overflow-y:auto;"><table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#000; color:#fff;"><th style="padding:8px; text-align:left; font-size:10px; text-transform:uppercase;">Room</th><th style="padding:8px; text-align:left; font-size:10px; text-transform:uppercase;">Trade</th><th style="padding:8px; text-align:left; font-size:10px; text-transform:uppercase;">Description</th><th style="padding:8px; text-align:right; font-size:10px; text-transform:uppercase;">Qty</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  submit.style.display = "block";
  submit.innerText = "Close";
  submit.onclick = closeModal;
}

async function applyTemplateToProject(templateId) {
  const t = findTemplateById(templateId);
  if (!t) return;
  const projectId = getCurrentProjectId();
  if (!projectId) {
    alert("No project selected");
    return;
  }

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const titleEl = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");

  titleEl.innerText = "Apply Template";
  overlay.style.display = "flex";
  body.innerHTML = "";
  submit.disabled = false;
  submit.innerText = "Add Selected Items";
  submit.style.display = "block";
  currentModalFiles = [];

  const unitOptions = MASTER_UNITS.map(
    (u) =>
      `<option value="${escapeAttr(u.value)}">${escapeHtml(u.label)}</option>`,
  ).join("");

  const itemRowsHtml = t.items
    .map(
      (item, idx) => `
    <tr class="to-tmpl-row" data-idx="${idx}">
      <td style="padding:6px 4px; border-bottom:1px solid var(--border); width:32px; vertical-align:middle; text-align:center;">
        <input type="checkbox" class="to-tmpl-chk" checked
          style="width:auto; cursor:pointer;"
          onchange="window.updateTmplGroupCheckbox()">
      </td>
      <td style="padding:4px; border-bottom:1px solid var(--border);">
        <input class="to-line-desc" value="${escapeAttr(item.description)}"
          placeholder="Description"
          style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">
      </td>
      <td style="padding:4px; border-bottom:1px solid var(--border); width:64px;">
        <input class="to-line-qty" type="number" value="0" min="0" step="0.01"
          style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px; text-align:right;">
      </td>
      <td style="padding:4px; border-bottom:1px solid var(--border); width:96px;">
        <select class="to-line-unit"
          style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">
          <option value="" disabled>Unit</option>
          ${unitOptions}
        </select>
      </td>
      <td style="padding:4px; border-bottom:1px solid var(--border);">
        <input class="to-line-notes" value="${escapeAttr(item.tradeCategory || "")}"
          placeholder="Notes / trade"
          style="width:100%; padding:8px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">
      </td>
    </tr>`,
    )
    .join("");

  body.innerHTML = `
    <div style="background:var(--card-light); border:1.5px solid var(--border); border-radius:12px; padding:10px 14px; margin-bottom:10px; display:flex; align-items:center; gap:10px;">
      <input type="checkbox" id="tmpl-group-chk" checked style="width:auto; cursor:pointer;"
        onchange="window.toggleAllTmplRows(this.checked)">
      <div style="flex:1; min-width:0;">
        <strong style="font-size:15px;">${escapeHtml(t.name)}</strong>
        <span id="tmpl-sel-count" style="font-size:12px; color:var(--muted); margin-left:8px;">${t.items.length} of ${t.items.length} selected</span>
      </div>
      <span style="font-size:10px; font-weight:900; background:var(--primary); color:#fff; padding:3px 8px; border-radius:4px; text-transform:uppercase; flex-shrink:0;">Template</span>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; font-size:13px; border-collapse:collapse; margin-bottom:10px;">
        <thead>
          <tr style="background:#000; color:#fff;">
            <th style="width:32px; padding:6px;"></th>
            <th style="padding:6px; text-align:left; font-size:10px; text-transform:uppercase;">Description</th>
            <th style="padding:6px; text-align:right; font-size:10px; text-transform:uppercase; width:64px;">Qty</th>
            <th style="padding:6px; text-align:left; font-size:10px; text-transform:uppercase; width:96px;">U/M</th>
            <th style="padding:6px; text-align:left; font-size:10px; text-transform:uppercase;">Notes / Trade</th>
          </tr>
        </thead>
        <tbody id="to_tmpl_body">${itemRowsHtml}</tbody>
      </table>
    </div>
    <div style="display:flex; align-items:center; gap:8px; margin-top:4px; flex-wrap:wrap;">
      <span style="font-size:12px; font-weight:700; color:var(--muted);">Set unit for selected:</span>
      <select id="tmpl-bulk-unit" style="padding:6px 10px; font-size:13px; border:1.5px solid var(--border); border-radius:8px;">
        <option value="">— choose —</option>${unitOptions}
      </select>
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);"
        onclick="window.applyBulkUnitToTmpl()">Apply to selected</button>
    </div>`;

  // Pre-select unit on each row from template data
  body.querySelectorAll(".to-tmpl-row").forEach((row, idx) => {
    const unit = t.items[idx]?.unit || "";
    const sel = row.querySelector(".to-line-unit");
    if (sel && unit) sel.value = unit;
  });

  submit.onclick = async () => {
    const tableRows = document.querySelectorAll("#to_tmpl_body tr.to-tmpl-row");
    const selected = Array.from(tableRows).filter(
      (row) => row.querySelector(".to-tmpl-chk")?.checked,
    );
    if (!selected.length) {
      alert("Select at least one item");
      return;
    }
    for (const row of selected) {
      if (!row.querySelector(".to-line-unit").value) {
        alert("Select a unit for all ticked items");
        return;
      }
    }
    submit.disabled = true;
    submit.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving…`;

    // Build line items in Take-Off format (description, qty, unit only)
    const lineItems = selected
      .map((row) => ({
        description: row.querySelector(".to-line-desc").value.trim(),
        qty: Number(row.querySelector(".to-line-qty").value) || 0,
        unit: row.querySelector(".to-line-unit").value,
      }))
      .filter((item) => item.description);

    if (!lineItems.length) {
      alert("No valid items to save");
      submit.disabled = false;
      submit.innerText = "Add Selected Items";
      return;
    }

    const payload = {
      projectId: projectId,
      title: t.name,
      lineItems: lineItems,
      notes: `Applied from template: ${t.name}${t.description ? " — " + t.description : ""}`,
      date: todayFormatted(),
    };

    try {
      const result = await callApi("saveTakeOff", payload);
      closeModal();
      // Refresh the Take-Off tab (take-offs data)
      const cache = getCache();
      cache.takeOffsLoaded = false;
      setCache(cache);
      if (typeof loadTakeOff2Listings === "function") {
        await loadTakeOff2Listings(true);
      }
      showSyncToast(
        `✅ ${lineItems.length} item${lineItems.length !== 1 ? "s" : ""} added to Take-Off from "${t.name}"`,
      );
    } catch (e) {
      submit.disabled = false;
      submit.innerText = "Add Selected Items";
      alert("Failed to save: " + (e.message || "Unknown error"));
    }
  };
}

function toggleAllTmplRows(checked) {
  document.querySelectorAll("#to_tmpl_body .to-tmpl-chk").forEach((chk) => {
    chk.checked = checked;
  });
  updateTmplGroupCheckbox();
}

function updateTmplGroupCheckbox() {
  const all = document.querySelectorAll("#to_tmpl_body .to-tmpl-chk");
  const ticked = Array.from(all).filter((c) => c.checked);
  const grpChk = document.getElementById("tmpl-group-chk");
  const countEl = document.getElementById("tmpl-sel-count");
  if (grpChk) {
    grpChk.checked = ticked.length === all.length;
    grpChk.indeterminate = ticked.length > 0 && ticked.length < all.length;
  }
  if (countEl)
    countEl.textContent = `${ticked.length} of ${all.length} selected`;
}

function applyBulkUnitToTmpl() {
  const unit = document.getElementById("tmpl-bulk-unit")?.value;
  if (!unit) return;
  document.querySelectorAll("#to_tmpl_body tr.to-tmpl-row").forEach((row) => {
    if (row.querySelector(".to-tmpl-chk")?.checked)
      row.querySelector(".to-line-unit").value = unit;
  });
}

// Select or deselect all items in a named template group in the take-off list
function toggleGroupSelection(groupLabel, checked) {
  const cache = getCache();
  const projectId = getCurrentProjectId();
  const TMPL_PREFIX = "From template: ";
  (cache.takeoffs || [])
    .filter((i) => {
      if (i.projectId !== projectId) return false;
      const note = String(i.scopeNotes || "");
      const itemGroup = note.startsWith(TMPL_PREFIX)
        ? note.slice(TMPL_PREFIX.length).split("\n")[0].trim()
        : null;
      return itemGroup === groupLabel;
    })
    .forEach((i) => {
      if (checked) selectedTakeOffIds.add(i.itemId);
      else selectedTakeOffIds.delete(i.itemId);
    });
  loadTakeOffListings();
}
