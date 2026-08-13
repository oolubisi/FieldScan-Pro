// ===== PRINT LAYOUTS SYSTEM =====

const LAYOUT_STORAGE_KEY = "fb_printLayouts";
const LAYOUT_ASSIGN_KEY = "fb_layoutAssignments";

const DEFAULT_LAYOUTS = [
  {
    layoutId: "layout-letterhead-default",
    name: "Standard Letterhead",
    description:
      "Full letterhead with logo, company info, signature block and footer. Default for most reports.",
    config: {
      showLogo: true,
      showDate: true,
      showClientInfo: true,
      showProjectInfo: true,
      showSignatureBlock: true,
      showFooter: true,
      headerStyle: "banner",
      tableStyle: "bordered",
      primaryColor: "#000000",
      secondaryColor: "#495057",
      accentColor: "#adb5bd",
      companyName: "PI Projects",
      companyAddress:
        "Road 1 House 5B, Isheri-Brooks Estate, Isheri-Olofin, Ogun State",
      companyPhones: "+234 809 260 8103    +234 708 260 8103",
      companyEmail: "pi.projects20@gmail.com",
      footerText: "",
      signatureLabel: "Authorized Signatory",
      fontFamily: "Inter, sans-serif",
    },
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    layoutId: "layout-minimal-default",
    name: "Minimal",
    description:
      "Clean and minimal. No letterhead, no signature. Just title, data table, and subtle footer.",
    config: {
      showLogo: false,
      showDate: true,
      showClientInfo: false,
      showProjectInfo: true,
      showSignatureBlock: false,
      showFooter: true,
      headerStyle: "simple",
      tableStyle: "minimal",
      primaryColor: "#212529",
      secondaryColor: "#6c757d",
      accentColor: "#dee2e6",
      companyName: "",
      companyAddress: "",
      companyPhones: "",
      companyEmail: "",
      footerText: "FieldScan Pro Report",
      signatureLabel: "",
      fontFamily: "Inter, sans-serif",
    },
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    layoutId: "layout-detailed-default",
    name: "Detailed",
    description:
      "Comprehensive layout with all sections. Full letterhead, client info, project info, signature, and footer with page numbers.",
    config: {
      showLogo: true,
      showDate: true,
      showClientInfo: true,
      showProjectInfo: true,
      showSignatureBlock: true,
      showFooter: true,
      headerStyle: "banner",
      tableStyle: "striped",
      primaryColor: "#1a1a2e",
      secondaryColor: "#495057",
      accentColor: "#e9ecef",
      companyName: "Projects International",
      companyAddress:
        "Road 1 House 5B, Isheri-Brooks Estate, Isheri-Olofin, Ogun State",
      companyPhones: "+234 809 260 8103    +234 708 260 8103",
      companyEmail: "pi.projects20@gmail.com",
      footerText: "",
      signatureLabel: "Authorized Signatory",
      fontFamily: "Inter, sans-serif",
    },
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const REPORT_TYPES = [
  { key: "financial_all", label: "Financial Summary (All Projects)" },
  { key: "financial_project", label: "Financial Summary (Project)" },
  { key: "financial_client", label: "Financial Summary (Client)" },
  { key: "financial_vendor", label: "Financial Summary (Vendor)" },
  { key: "scope", label: "Project Scope" },
  { key: "takeoff", label: "Take-Off Report" },
  { key: "progress", label: "Progress Report" },
  { key: "snags", label: "Snags Report" },
  { key: "inspection", label: "Inspection Report" },
  { key: "workorders", label: "Work Orders Report" },
  { key: "pcr", label: "Project Completion Report" },
  { key: "changeOrder", label: "Change Order Report" },
];

const DEFAULT_ASSIGNMENTS = {
  financial_all: "layout-letterhead-default",
  financial_project: "layout-letterhead-default",
  financial_client: "layout-letterhead-default",
  financial_vendor: "layout-letterhead-default",
  scope: "layout-letterhead-default",
  takeoff: "layout-minimal-default",
  progress: "layout-letterhead-default",
  snags: "layout-detailed-default",
  workorders: "layout-letterhead-default",
  pcr: "layout-letterhead-default",
  changeOrder: "layout-letterhead-default",
};

// ===== STORAGE =====
function getLayouts() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUTS));
}

function saveLayouts(layouts) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
}

function getAssignments() {
  try {
    const raw = localStorage.getItem(LAYOUT_ASSIGN_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { ...DEFAULT_ASSIGNMENTS };
}

function saveAssignments(assignments) {
  localStorage.setItem(LAYOUT_ASSIGN_KEY, JSON.stringify(assignments));
}

function getLayoutForReport(reportType) {
  const assignments = getAssignments();
  const layoutId = assignments[reportType] || assignments["financial_all"];
  const layouts = getLayouts();
  return (
    layouts.find((l) => l.layoutId === layoutId) ||
    layouts[0] ||
    DEFAULT_LAYOUTS[0]
  );
}

// ===== CRUD =====
function createLayout(name, description, baseLayoutId) {
  const layouts = getLayouts();
  let config;
  if (baseLayoutId) {
    const base = layouts.find((l) => l.layoutId === baseLayoutId);
    config = base
      ? JSON.parse(JSON.stringify(base.config))
      : JSON.parse(JSON.stringify(DEFAULT_LAYOUTS[0].config));
  } else {
    config = JSON.parse(JSON.stringify(DEFAULT_LAYOUTS[0].config));
  }
  const newLayout = {
    layoutId: "layout-" + Date.now(),
    name: name || "New Layout",
    description: description || "",
    config,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  layouts.push(newLayout);
  saveLayouts(layouts);
  return newLayout;
}

function updateLayout(layoutId, updates) {
  const layouts = getLayouts();
  const idx = layouts.findIndex((l) => l.layoutId === layoutId);
  if (idx === -1) return null;
  layouts[idx] = { ...layouts[idx], ...updates, updatedAt: Date.now() };
  saveLayouts(layouts);
  return layouts[idx];
}

function deleteLayout(layoutId) {
  let layouts = getLayouts();
  const target = layouts.find((l) => l.layoutId === layoutId);
  if (target && target.isDefault) {
    alert("Cannot delete a default layout. Clone it instead.");
    return false;
  }
  layouts = layouts.filter((l) => l.layoutId !== layoutId);
  saveLayouts(layouts);
  // Reassign any report types using this layout to the first available
  const assignments = getAssignments();
  let changed = false;
  for (const [rt, lid] of Object.entries(assignments)) {
    if (lid === layoutId) {
      assignments[rt] = layouts[0]?.layoutId || "";
      changed = true;
    }
  }
  if (changed) saveAssignments(assignments);
  return true;
}

function cloneLayout(layoutId) {
  const layouts = getLayouts();
  const base = layouts.find((l) => l.layoutId === layoutId);
  if (!base) return null;
  const clone = {
    layoutId: "layout-" + Date.now(),
    name: base.name + " (Copy)",
    description: base.description,
    config: JSON.parse(JSON.stringify(base.config)),
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  layouts.push(clone);
  saveLayouts(layouts);
  return clone;
}

function setDefaultLayout(layoutId) {
  const layouts = getLayouts();
  layouts.forEach((l) => (l.isDefault = l.layoutId === layoutId));
  saveLayouts(layouts);
}

// ===== REPORT HEADER / FOOTER / SIGNATURE GENERATORS =====
async function generateLayoutHeader(title, project, layout) {
  if (!layout) layout = DEFAULT_LAYOUTS[0];
  const cfg = layout.config;
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (cfg.headerStyle === "none") {
    let html = "";
    if (cfg.showDate)
      html += `<div style="font-size:11px; color:#495057; margin-bottom:4px;">${escapeHtml(dateStr)}</div>`;
    html += `<div style="font-size:18px; font-weight:700; text-transform:uppercase; margin-bottom:12px; color:#000;">${escapeHtml(title)}</div>`;
    return html;
  }

  if (cfg.headerStyle === "simple") {
    let html = `<div style="border-bottom:1.5px solid ${cfg.primaryColor}; padding-bottom:8px; margin-bottom:16px;">`;
    if (cfg.showDate)
      html += `<div style="font-size:11px; color:#495057; margin-bottom:2px;">${escapeHtml(dateStr)}</div>`;
    html += `<div style="font-size:16px; font-weight:700; text-transform:uppercase; color:#000; line-height:1.2;">${escapeHtml(title)}</div>`;
    html += `</div>`;
    return html;
  }

  // Banner style (full letterhead)
  // Resolve logo from settings cache when showLogo is enabled
  let logoHtml = "";
  if (cfg.showLogo) {
    const cache = typeof getCache === "function" ? getCache() : {};
    const settingsData =
      cache.settings && cache.settings.data
        ? cache.settings.data
        : cache.settings || {};
    const logoId = settingsData.Logo || "";
    if (logoId) {
      const logoUrl =
        typeof resolveImageToDataUrl === "function"
          ? await resolveImageToDataUrl(logoId)
          : "";
      if (logoUrl) {
        logoHtml = `<div style="flex-shrink:0; margin-left:16px; text-align:right;"><img src="${logoUrl}" style="max-height:80px; max-width:150px; object-fit:contain;" onerror="this.style.display='none'"></div>`;
      }
    }
  }

  let html = `<div style="border-bottom:2.5px solid ${cfg.primaryColor}; padding-bottom:8px; margin-bottom:18px;">`;
  html += `<div style="display:flex; justify-content:space-between; align-items:flex-end;">`;
  html += `<div style="flex:1;">`;
  if (cfg.showDate)
    html += `<div style="font-size:11px; color:#495057; font-weight:600; margin-bottom:2px;">${escapeHtml(dateStr)}</div>`;
  html += `<div style="font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#495057; line-height:1.1;">${escapeHtml(title)}</div>`;
  html += `</div>`;
  html += logoHtml;
  html += `</div>`;

  if (cfg.showClientInfo || cfg.showProjectInfo) {
    html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid ${cfg.accentColor}; font-size:12px; line-height:1.6;">`;
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 20px;">`;
    if (cfg.showClientInfo && project) {
      html += `<div><strong style="color:#000;">Client:</strong> ${escapeHtml(project.clientName || "—")}</div>`;
    }
    if (cfg.showProjectInfo && project) {
      html += `<div><strong style="color:#000;">Project ID:</strong> ${escapeHtml(project.projectId || "—")}</div>`;
      html += `<div><strong style="color:#000;">Location:</strong> ${escapeHtml(project.siteLocation || "—")}</div>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}

function generateLayoutFooter(layout) {
  if (!layout) layout = DEFAULT_LAYOUTS[0];
  const cfg = layout.config;
  if (!cfg.showFooter) return "";

  const addressLine = cfg.companyAddress
    ? `<div>${escapeHtml(cfg.companyAddress)}</div>`
    : "";
  const contactLine =
    cfg.companyPhones || cfg.companyEmail
      ? `<div>${escapeHtml(cfg.companyPhones || "")}${cfg.companyPhones && cfg.companyEmail ? "&nbsp;&nbsp;&nbsp;" : ""}${escapeHtml(cfg.companyEmail || "")}</div>`
      : "";

  if (cfg.footerText) {
    return `<div class="report-footer"><div>${escapeHtml(cfg.footerText)}</div></div>`;
  }
  return `<div class="report-footer">${addressLine}${contactLine}</div>`;
}

function generateLayoutSignature(layout) {
  if (!layout) layout = DEFAULT_LAYOUTS[0];
  const cfg = layout.config;
  if (!cfg.showSignatureBlock) return "";
  return `<div style="margin-top:32px; page-break-inside:avoid;">
    <div style="font-size:12px; font-weight:700; text-transform:uppercase; margin-bottom:12px; color:#495057;">${escapeHtml(cfg.signatureLabel || "Authorized Signatory")}</div>
    <div style="display:inline-block; text-align:center;">
      <div style="border-bottom:1.5px solid #000; width:200px; margin:0 auto 4px auto;"></div>
      <div style="font-size:12px; font-weight:700;">_________________________</div>
    </div>
  </div>`;
}

// ===== TABLE STYLE CSS =====
function getTableStyleCSS(layout) {
  if (!layout) layout = DEFAULT_LAYOUTS[0];
  const style = layout.config.tableStyle;
  if (style === "minimal") {
    return `style="width:100%; border-collapse:collapse; font-size:12px;"`;
  }
  if (style === "striped") {
    return `style="width:100%; border-collapse:collapse; font-size:12px;"`;
  }
  // bordered default
  return `style="width:100%; border-collapse:collapse; font-size:12px;"`;
}

function getTableRowStyle(layout, index) {
  if (!layout) layout = DEFAULT_LAYOUTS[0];
  const style = layout.config.tableStyle;
  if (style === "striped" && index % 2 === 1) {
    return `background:#f8f9fa;`;
  }
  return "";
}

// ===== UI =====
function openPrintLayoutsPage() {
  showPageWithoutRefresh("print-layouts");
  renderPrintLayoutsPage();
}

function renderPrintLayoutsPage() {
  const container = document.getElementById("print-layouts-container");
  if (!container) return;
  const layouts = getLayouts();
  const assignments = getAssignments();

  let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
    <h2 style="margin:0; font-size:20px; font-weight:900;">Print Layouts</h2>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--primary);" onclick="window.openLayoutEditor(null)">
      <i class="fas fa-plus"></i> New Layout
    </button>
  </div>
  <p style="color:var(--muted); font-size:13px; margin-bottom:16px;">Create and manage print layouts. Clone existing layouts to customize. Assign layouts to report types.</p>`;

  // Layout cards
  html += `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">`;
  layouts.forEach((layout) => {
    const assignedTo = REPORT_TYPES.filter(
      (rt) => assignments[rt.key] === layout.layoutId,
    ).map((rt) => rt.label);
    const badgeStyle = layout.isDefault
      ? "background:var(--success);"
      : "background:var(--primary);";
    const badgeText = layout.isDefault ? "Default" : "Custom";
    html += `<div class="card" style="display:flex; flex-direction:column;">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
        <strong style="font-size:15px;">${escapeHtml(layout.name)}</strong>
        <span style="font-size:10px; color:#fff; padding:2px 8px; border-radius:4px; text-transform:uppercase; ${badgeStyle}">${badgeText}</span>
      </div>
      <div style="font-size:12px; color:var(--muted); flex:1; margin-bottom:8px;">${escapeHtml(layout.description || "No description")}</div>
      ${assignedTo.length ? `<div style="font-size:11px; color:var(--muted); margin-bottom:8px;"><i class="fas fa-file-alt"></i> ${assignedTo.length} report type${assignedTo.length > 1 ? "s" : ""}</div>` : ""}
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.openLayoutEditor('${escapeAttr(layout.layoutId)}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.cloneLayoutAndRefresh('${escapeAttr(layout.layoutId)}')">
          <i class="fas fa-clone"></i> Clone
        </button>
        ${
          !layout.isDefault
            ? `<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--danger);" onclick="window.deleteLayoutAndRefresh('${escapeAttr(layout.layoutId)}')">
          <i class="fas fa-trash"></i>
        </button>`
            : ""
        }
      </div>
    </div>`;
  });
  html += `</div>`;

  // Assignments section
  html += `<h3 style="font-size:16px; font-weight:900; margin-top:24px; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px;">Layout Assignments</h3>
  <p style="color:var(--muted); font-size:13px; margin-bottom:12px;">Choose which layout to use for each report type.</p>
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">`;
  REPORT_TYPES.forEach((rt) => {
    const currentId = assignments[rt.key] || "";
    html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--card-light); border-radius:8px;">
      <span style="font-size:13px;">${escapeHtml(rt.label)}</span>
      <select class="layout-assign-sel" data-report-type="${escapeAttr(rt.key)}" style="padding:6px 8px; font-size:12px; border:1px solid var(--border); border-radius:6px; background:var(--card-light); min-width:140px;" onchange="window.onLayoutAssignmentChange(this)">
        ${layouts.map((l) => `<option value="${escapeAttr(l.layoutId)}" ${l.layoutId === currentId ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("")}
      </select>
    </div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

// ===== LAYOUT EDITOR =====
async function openLayoutEditor(layoutId) {
  const isEdit = !!layoutId;
  const layout = isEdit
    ? getLayouts().find((l) => l.layoutId === layoutId)
    : null;

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  overlay.style.display = "flex";
  body.innerHTML = "";
  submit.style.display = "none";
  title.innerText = isEdit ? `Edit Layout: ${layout.name}` : "New Print Layout";

  const cfg = isEdit
    ? JSON.parse(JSON.stringify(layout.config))
    : JSON.parse(JSON.stringify(DEFAULT_LAYOUTS[0].config));

  const labelStyle =
    'style="display:block; font-weight:800; margin-top:10px; margin-bottom:3px; font-size:12px;"';
  const inputStyle =
    'style="width:100%; padding:8px; font-size:14px; border:1px solid var(--border); border-radius:6px;"';
  const checkboxStyle = 'style="width:auto; margin-right:6px; cursor:pointer;"';

  body.innerHTML = `
    <div style="display:flex; gap:12px; max-height:70vh;">
      <!-- Left: Editor -->
      <div style="flex:1; overflow-y:auto; padding-right:8px;">
        <input type="hidden" id="le_layoutId" value="${escapeAttr(layoutId || "")}">

        <label ${labelStyle}>Layout Name</label>
        <input id="le_name" value="${escapeAttr(isEdit ? layout.name : "")}" placeholder="e.g. Corporate Letterhead" ${inputStyle}>

        <label ${labelStyle}>Description</label>
        <input id="le_desc" value="${escapeAttr(isEdit ? layout.description : "")}" placeholder="Brief description..." ${inputStyle}>

        <div style="margin-top:12px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:4px;">Header</div>

        <label ${labelStyle}>Header Style</label>
        <select id="le_headerStyle" ${inputStyle}>
          <option value="banner" ${cfg.headerStyle === "banner" ? "selected" : ""}>Full Banner (letterhead)</option>
          <option value="simple" ${cfg.headerStyle === "simple" ? "selected" : ""}>Simple Line</option>
          <option value="none" ${cfg.headerStyle === "none" ? "selected" : ""}>No Header</option>
        </select>

        <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px;">
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showLogo" type="checkbox" ${checkboxStyle} ${cfg.showLogo !== false ? "checked" : ""}> Show Logo</label>
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showDate" type="checkbox" ${checkboxStyle} ${cfg.showDate ? "checked" : ""}> Show Date</label>
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showClientInfo" type="checkbox" ${checkboxStyle} ${cfg.showClientInfo ? "checked" : ""}> Show Client Info</label>
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showProjectInfo" type="checkbox" ${checkboxStyle} ${cfg.showProjectInfo ? "checked" : ""}> Show Project Info</label>
        </div>

        <div style="margin-top:12px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:4px;">Company Info</div>

        <label ${labelStyle}>Company Name</label>
        <input id="le_companyName" value="${escapeAttr(cfg.companyName)}" ${inputStyle}>
        <label ${labelStyle}>Address</label>
        <input id="le_companyAddress" value="${escapeAttr(cfg.companyAddress)}" ${inputStyle}>
        <label ${labelStyle}>Phone Numbers</label>
        <input id="le_companyPhones" value="${escapeAttr(cfg.companyPhones)}" ${inputStyle}>
        <label ${labelStyle}>Email</label>
        <input id="le_companyEmail" value="${escapeAttr(cfg.companyEmail)}" ${inputStyle}>

        <div style="margin-top:12px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:4px;">Footer & Signature</div>

        <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px;">
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showFooter" type="checkbox" ${checkboxStyle} ${cfg.showFooter ? "checked" : ""}> Show Footer</label>
          <label style="display:flex; align-items:center; font-size:13px; cursor:pointer;"><input id="le_showSignature" type="checkbox" ${checkboxStyle} ${cfg.showSignatureBlock ? "checked" : ""}> Show Signature Block</label>
        </div>

        <label ${labelStyle}>Footer Text (optional, overrides company info)</label>
        <input id="le_footerText" value="${escapeAttr(cfg.footerText)}" placeholder="Leave blank to use company info" ${inputStyle}>
        <label ${labelStyle}>Signature Label</label>
        <input id="le_signatureLabel" value="${escapeAttr(cfg.signatureLabel)}" ${inputStyle}>

        <div style="margin-top:12px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:4px;">Table Style</div>

        <select id="le_tableStyle" ${inputStyle}>
          <option value="bordered" ${cfg.tableStyle === "bordered" ? "selected" : ""}>Bordered (default)</option>
          <option value="minimal" ${cfg.tableStyle === "minimal" ? "selected" : ""}>Minimal</option>
          <option value="striped" ${cfg.tableStyle === "striped" ? "selected" : ""}>Striped</option>
        </select>

        <div style="margin-top:12px; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); padding-bottom:4px;">Colors</div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <div><label ${labelStyle}>Primary</label><input id="le_primaryColor" type="color" value="${escapeAttr(cfg.primaryColor)}" style="width:60px; height:36px; border:none; border-radius:6px; cursor:pointer;"></div>
          <div><label ${labelStyle}>Secondary</label><input id="le_secondaryColor" type="color" value="${escapeAttr(cfg.secondaryColor)}" style="width:60px; height:36px; border:none; border-radius:6px; cursor:pointer;"></div>
          <div><label ${labelStyle}>Accent</label><input id="le_accentColor" type="color" value="${escapeAttr(cfg.accentColor)}" style="width:60px; height:36px; border:none; border-radius:6px; cursor:pointer;"></div>
        </div>
      </div>

      <!-- Right: Preview -->
      <div style="width:320px; flex-shrink:0; border:1px solid var(--border); border-radius:8px; overflow:hidden;">
        <div style="background:#000; color:#fff; padding:6px 10px; font-size:11px; font-weight:700; text-transform:uppercase;">Preview</div>
        <div id="le_preview" style="padding:12px; font-size:10px; line-height:1.4; overflow-y:auto; max-height:60vh; background:#fff;">
          ${await buildLayoutPreview(cfg)}
        </div>
      </div>
    </div>

    <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px;">
      ${isEdit && !layout.isDefault ? `<button class="action-btn" id="le_delete" style="background:var(--danger);"><i class="fas fa-trash"></i> Delete</button>` : ""}
      ${isEdit ? `<button class="action-btn" id="le_clone" style="background:var(--card-light); color:var(--text);"><i class="fas fa-clone"></i> Clone</button>` : ""}
      <button class="action-btn" id="le_preview_btn" style="background:var(--card-light); color:var(--text);"><i class="fas fa-eye"></i> Preview</button>
      <button class="action-btn" id="le_save"><i class="fas fa-save"></i> Save</button>
    </div>
  `;

  // Bind save
  document.getElementById("le_save").onclick = () =>
    saveLayoutFromEditor(isEdit, layoutId);

  // Bind preview
  document.getElementById("le_preview_btn").onclick = () =>
    openLayoutFullPreview();

  // Bind delete
  if (isEdit && !layout.isDefault) {
    document.getElementById("le_delete").onclick = () => {
      if (confirm("Delete this layout?")) {
        deleteLayout(layoutId);
        closeModal();
        renderPrintLayoutsPage();
      }
    };
  }

  // Bind clone
  if (isEdit) {
    document.getElementById("le_clone").onclick = () => {
      cloneLayout(layoutId);
      closeModal();
      renderPrintLayoutsPage();
    };
  }

  // Live preview update
  const previewFields = [
    "le_name",
    "le_showLogo",
    "le_headerStyle",
    "le_showDate",
    "le_showClientInfo",
    "le_showProjectInfo",
    "le_companyName",
    "le_companyAddress",
    "le_companyPhones",
    "le_companyEmail",
    "le_showFooter",
    "le_showSignature",
    "le_footerText",
    "le_signatureLabel",
    "le_tableStyle",
    "le_primaryColor",
    "le_secondaryColor",
    "le_accentColor",
  ];
  previewFields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(
        el.type === "checkbox" ? "change" : "input",
        updateLayoutPreview,
      );
    }
  });
}

async function updateLayoutPreview() {
  const cfg = readLayoutConfigFromEditor();
  const preview = document.getElementById("le_preview");
  if (preview) preview.innerHTML = await buildLayoutPreview(cfg);
}

function readLayoutConfigFromEditor() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    if (!el) return "";
    return el.type === "checkbox" ? el.checked : el.value;
  };
  return {
    showLogo: getVal("le_showLogo"),
    headerStyle: getVal("le_headerStyle"),
    showDate: getVal("le_showDate"),
    showClientInfo: getVal("le_showClientInfo"),
    showProjectInfo: getVal("le_showProjectInfo"),
    companyName: getVal("le_companyName"),
    companyAddress: getVal("le_companyAddress"),
    companyPhones: getVal("le_companyPhones"),
    companyEmail: getVal("le_companyEmail"),
    showFooter: getVal("le_showFooter"),
    showSignatureBlock: getVal("le_showSignature"),
    footerText: getVal("le_footerText"),
    signatureLabel: getVal("le_signatureLabel"),
    tableStyle: getVal("le_tableStyle"),
    primaryColor: getVal("le_primaryColor"),
    secondaryColor: getVal("le_secondaryColor"),
    accentColor: getVal("le_accentColor"),
  };
}

async function buildLayoutPreview(cfg) {
  // Resolve logo from settings cache
  let logoHtml = "";
  if (cfg.showLogo) {
    const cache = typeof getCache === "function" ? getCache() : {};
    const settingsData =
      cache.settings && cache.settings.data
        ? cache.settings.data
        : cache.settings || {};
    const logoId = settingsData.Logo || "";
    if (logoId) {
      const logoUrl =
        typeof resolveImageToDataUrl === "function"
          ? await resolveImageToDataUrl(logoId)
          : "";
      if (logoUrl) {
        logoHtml = `<div style="flex-shrink:0; margin-left:10px;"><img src="${logoUrl}" style="max-height:48px; max-width:90px; object-fit:contain;" onerror="this.style.display='none'"></div>`;
      }
    }
  }

  const layout = { config: cfg };
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  let header = "";
  if (cfg.headerStyle === "banner") {
    header = `<div style="border-bottom:2px solid ${cfg.primaryColor}; padding-bottom:6px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <div style="flex:1;">
          ${cfg.showDate ? `<div style="font-size:8px; color:#495057; margin-bottom:2px;">${escapeHtml(dateStr)}</div>` : ""}
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#495057;">Sample Report</div>
        </div>
        ${logoHtml}
      </div>
      ${
        cfg.showClientInfo || cfg.showProjectInfo
          ? `<div style="margin-top:6px; font-size:8px; line-height:1.6; display:grid; grid-template-columns:1fr 1fr; gap:2px 10px;">
        ${cfg.showClientInfo ? "<div><strong>Client:</strong> John Doe</div>" : ""}
        ${cfg.showProjectInfo ? "<div><strong>Project ID:</strong> PRJ/25/001</div><div><strong>Location:</strong> Lagos</div>" : ""}
      </div>`
          : ""
      }
    </div>`;
  } else if (cfg.headerStyle === "simple") {
    header = `<div style="border-bottom:1.5px solid ${cfg.primaryColor}; padding-bottom:5px; margin-bottom:10px;">
      ${cfg.showDate ? `<div style="font-size:8px; color:#495057; margin-bottom:2px;">${escapeHtml(dateStr)}</div>` : ""}
      <div style="font-size:11px; font-weight:700; text-transform:uppercase;">Sample Report</div>
    </div>`;
  } else {
    header = `<div style="font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:10px;">Sample Report</div>`;
  }

  const sampleTable = `<table style="width:100%; font-size:9px; border-collapse:collapse; margin-top:8px;">
    <thead><tr style="background:${cfg.primaryColor}; color:#fff;"><th style="padding:4px; text-align:left;">Item</th><th style="padding:4px; text-align:right;">Qty</th></tr></thead>
    <tbody>
      <tr><td style="border-bottom:1px solid ${cfg.accentColor}; padding:4px;">Floor tiles</td><td style="border-bottom:1px solid ${cfg.accentColor}; padding:4px; text-align:right;">24</td></tr>
      <tr><td style="border-bottom:1px solid ${cfg.accentColor}; padding:4px;">Wall paint</td><td style="border-bottom:1px solid ${cfg.accentColor}; padding:4px; text-align:right;">18</td></tr>
    </tbody>
  </table>`;
  const signature = cfg.showSignatureBlock
    ? `<div style="margin-top:16px; font-size:9px;"><div style="font-weight:700; text-transform:uppercase; color:#495057; margin-bottom:4px;">${escapeHtml(cfg.signatureLabel || "Authorized Signatory")}</div><div style="border-bottom:1px solid #000; width:100px;"></div></div>`
    : "";
  const footer = cfg.showFooter
    ? `<div style="margin-top:12px; border-top:1px solid ${cfg.accentColor}; padding-top:4px; font-size:8px; color:#495057;">${escapeHtml(cfg.companyName || cfg.footerText || "Footer")}</div>`
    : "";
  return header + sampleTable + signature + footer;
}

async function openLayoutFullPreview() {
  // window.open must happen synchronously, in the same tick as the click
  // that triggered this function -- once execution crosses an `await`,
  // browsers no longer treat it as a trusted user gesture and silently
  // block it. This is what "Preview blocked by browser" actually was.
  const win = window.open("", "_blank", "width=860,height=700,scrollbars=yes");
  if (!win) {
    alert("Preview blocked by browser. Please allow popups for this site.");
    return;
  }
  win.document.write("<!DOCTYPE html><html><head><title>Loading preview...</title></head><body style=\"font-family:sans-serif; padding:40px; text-align:center; color:#868e96;\">Loading preview...</body></html>");

  const cfg = readLayoutConfigFromEditor();
  const previewHtml = await buildLayoutPreview(cfg);

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Layout Preview — ${escapeHtml(document.getElementById("le_name")?.value || "Layout")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #e9ecef;
      font-family: ${cfg.fontFamily || "Inter, sans-serif"};
      padding: 24px;
    }
    .page {
      background: #fff;
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 18mm 15mm 22mm 15mm;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      position: relative;
    }
    .report-footer {
      position: absolute;
      bottom: 8px;
      left: 15mm;
      right: 15mm;
      padding-top: 12px;
      border-top: 1px solid #adb5bd;
      font-size: 10px;
      color: #495057;
      line-height: 1.5;
      text-align: center;
    }
    .preview-badge {
      position: fixed;
      top: 12px;
      right: 12px;
      background: #000;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 20px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      opacity: 0.85;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page { box-shadow: none; padding: 18mm 15mm; }
      .preview-badge { display: none; }
    }
  </style>
</head>
<body>
  <div class="preview-badge">Preview</div>
  <div class="page">
    ${previewHtml}
  </div>
</body>
</html>`);
  win.document.close();
}

function saveLayoutFromEditor(isEdit, layoutId) {
  const name = document.getElementById("le_name").value.trim();
  if (!name) {
    alert("Enter a layout name");
    return;
  }
  const cfg = readLayoutConfigFromEditor();
  const updates = {
    name,
    description: document.getElementById("le_desc").value.trim(),
    config: cfg,
  };
  if (isEdit) {
    updateLayout(layoutId, updates);
  } else {
    const newLayout = createLayout(name, updates.description);
    updateLayout(newLayout.layoutId, { config: cfg });
  }
  closeModal();
  renderPrintLayoutsPage();
}

// ===== HANDLERS =====
function onLayoutAssignmentChange(selectEl) {
  const reportType = selectEl.dataset.reportType;
  const layoutId = selectEl.value;
  const assignments = getAssignments();
  assignments[reportType] = layoutId;
  saveAssignments(assignments);
}

function cloneLayoutAndRefresh(layoutId) {
  cloneLayout(layoutId);
  renderPrintLayoutsPage();
}

function deleteLayoutAndRefresh(layoutId) {
  if (
    confirm("Delete this layout? Any report types using it will be reassigned.")
  ) {
    deleteLayout(layoutId);
    renderPrintLayoutsPage();
  }
}

// ===== EXPOSE =====
window.openPrintLayoutsPage = openPrintLayoutsPage;
window.renderPrintLayoutsPage = renderPrintLayoutsPage;
window.openLayoutEditor = openLayoutEditor;
window.onLayoutAssignmentChange = onLayoutAssignmentChange;
window.cloneLayoutAndRefresh = cloneLayoutAndRefresh;
window.deleteLayoutAndRefresh = deleteLayoutAndRefresh;
window.getLayoutForReport = getLayoutForReport;
window.generateLayoutHeader = generateLayoutHeader;
window.generateLayoutFooter = generateLayoutFooter;
window.generateLayoutSignature = generateLayoutSignature;
