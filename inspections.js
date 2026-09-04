// ===== inspections.js =====
// Standalone Inspections module — an inspection can exist with or without
// a project attached. When linked to a project, its number is derived
// from the project's own number (same convention as Change Orders/Work
// Orders); when general, it gets its own "INSP-GEN-NN" sequence. This
// replaces the old per-project, photo-tag-based Inspection Report (tagging
// a photo "Site Inspection" inside a project's photo library) — that
// approach couldn't represent an inspection with no project at all, and
// maintaining two different ways to produce an "Inspection Report" wasn't
// worth it. Attachments here are cloud-synced (same processAttachments
// pipeline as Work Orders/Change Orders), not local-only like the
// Documents module — inspection photos get taken on a phone in the field
// and need to show up when the report is printed from desktop later.

let inspList = [];
let inspFilterProjectId = "All";
let inspAttachmentComments = []; // index-aligned with currentModalFiles

/**
 * attachmentComments comes back from the backend as a JSON string (that's
 * what's actually stored in the sheet), but a save can leave the LOCAL
 * cache entry holding the raw array instead (see the save handler below —
 * fixed to stringify now, but this stays defensive in case anything else
 * ever writes the wrong shape into cache). JSON.parse() throws on an
 * actual array rather than a string, which silently dropped comments
 * after a save/edit without a full reload.
 */
function parseInspAttachmentComments(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function initInspectionsPage() {
  const container = document.getElementById("inspections-list-view");
  if (container)
    container.innerHTML = `<div class="card"><span style="font-size:13px; color:var(--muted);">Loading inspections...</span></div>`;
  const cache = getCache();
  const needProjects = !cache.projects || !cache.projects.length;

  // Independent calls -- run together instead of one blocking the other.
  const results = await Promise.allSettled([
    callApi("getInspections", {}),
    needProjects ? callApi("getProjects", {}) : Promise.resolve(null),
  ]);
  const inspResult = results[0];
  const projectsResult = results[1];

  if (inspResult.status === "fulfilled") {
    inspList = Array.isArray(inspResult.value) ? inspResult.value : [];
    cache.inspections = inspList;
  } else {
    console.error("getInspections failed", inspResult.reason);
    inspList = cache.inspections || [];
  }

  if (needProjects && projectsResult.status === "fulfilled") {
    cache.projects = projectsResult.value || [];
  }

  setCache(cache);
  renderInspectionsPage();
}
window.initInspectionsPage = initInspectionsPage;

function inspSetFilter(projectId) {
  inspFilterProjectId = projectId;
  renderInspectionsPage();
}
window.inspSetFilter = inspSetFilter;

function renderInspectionsPage() {
  const container = document.getElementById("inspections-list-view");
  if (!container) return;
  const cache = getCache();
  const projects = cache.projects || [];

  const filtered =
    inspFilterProjectId === "All"
      ? inspList
      : inspFilterProjectId === ""
        ? inspList.filter((i) => !i.projectId)
        : inspList.filter((i) => i.projectId === inspFilterProjectId);

  const filterOptions = [
    `<option value="All" ${inspFilterProjectId === "All" ? "selected" : ""}>All Inspections</option>`,
    `<option value="" ${inspFilterProjectId === "" ? "selected" : ""}>General (no project)</option>`,
    ...projects.map(
      (p) =>
        `<option value="${escapeAttr(p.projectId)}" ${inspFilterProjectId === p.projectId ? "selected" : ""}>${escapeHtml(p.clientName || p.projectId)}</option>`,
    ),
  ].join("");

  const sorted = [...filtered].sort((a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0));

  const cardsHtml = sorted.length
    ? `<div class="console-cards-grid">${sorted.map(inspectionCardHtml).join("")}</div>`
    : `<p style="text-align:center; padding:20px; color:var(--muted);">No inspections yet${inspFilterProjectId !== "All" ? " for this filter" : ' — use "New Inspection" above to add one'}.</p>`;

  container.innerHTML = `
    <div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
      <select style="flex:1; min-width:180px; font-size:16px;" onchange="window.inspSetFilter(this.value)">${filterOptions}</select>
      <button class="action-btn" style="width:auto; padding:0 20px;" onclick="window.openInspectionModal(null)">
        <i class="fas fa-plus"></i> New Inspection
      </button>
    </div>
    ${cardsHtml}
  `;
}

function inspectionCardHtml(insp) {
  const cache = getCache();
  const project = insp.projectId ? (cache.projects || []).find((p) => p.projectId === insp.projectId) : null;
  const key = `inspection:${insp.inspectionId}`;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = insp;
  const dateStr = insp.inspectionDate
    ? new Date(insp.inspectionDate).toLocaleDateString()
    : "";
  return `<div class="card" style="border-left:6px solid var(--primary);">
    <div style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;">${escapeHtml(insp.inspectionId)}${dateStr ? " — " + escapeHtml(dateStr) : ""}</div>
    <strong style="font-size:16px;">${escapeHtml(insp.title || "Untitled Inspection")}</strong><br>
    <span style="font-size:13px; color:var(--muted);">${project ? escapeHtml(project.clientName || project.projectId) : "General (no project)"}</span><br>
    <span style="font-size:13px;">${escapeHtml(insp.inspectorName || "—")}</span>
    <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--card-light); color:var(--text);" onclick="window.openInspectionModal(window.modalRecordCache['${key}'])">
        <i class="fas fa-edit"></i> Edit
      </button>
      <button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:var(--primary);" onclick="window.previewInspectionReport('${escapeAttr(insp.inspectionId)}')">
        <i class="fas fa-print"></i> Print
      </button>
    </div>
  </div>`;
}

// ===== next-number preview (mirrors backend getNextInspectionNumber_) =====
function getNextInspectionNumber(projectId) {
  const cache = getCache();
  const prefix = projectId
    ? "INSP-" + (String(projectId).match(/(\d{1,3})\D*$/)?.[1] || "0").padStart(3, "0") + "-"
    : "INSP-GEN-";
  let max = 0;
  (cache.inspections || []).forEach((i) => {
    if (String(i.inspectionId).startsWith(prefix)) {
      const num = parseInt(String(i.inspectionId).substring(prefix.length));
      if (!isNaN(num) && num > max) max = num;
    }
  });
  return prefix + String(max + 1).padStart(2, "0");
}

// ===== new/edit modal =====

function openInspectionModal(editData = null) {
  const isEdit = !!editData;
  const cache = getCache();
  const projects = cache.projects || [];
  const projectId = isEdit ? editData.projectId || "" : "";
  const nextNumber = getNextInspectionNumber(projectId);
  const lastInspectorName = localStorage.getItem("lastInspectorName") || "";

  currentModalFiles = isEdit ? splitAttachments(editData.attachments) : [];
  inspAttachmentComments = isEdit ? parseInspAttachmentComments(editData.attachmentComments) : [];
  while (inspAttachmentComments.length < currentModalFiles.length) inspAttachmentComments.push("");

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const labelStyle = 'style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;"';
  const largeInput = "width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;";

  title.innerText = isEdit ? "Edit Inspection" : "New Inspection";
  overlay.style.display = "flex";

  const projectOptions = [
    `<option value="">General (no project)</option>`,
    ...projects.map(
      (p) => `<option value="${escapeAttr(p.projectId)}" ${projectId === p.projectId ? "selected" : ""}>${escapeHtml(p.clientName || p.projectId)}</option>`,
    ),
  ].join("");

  body.innerHTML = `
    <label ${labelStyle}>Inspection Number</label>
    <input value="${escapeAttr(isEdit ? editData.inspectionId : nextNumber)}" disabled style="${largeInput} background:#f0f0f0;">
    <input type="hidden" id="insp_id" value="${escapeAttr(isEdit ? editData.inspectionId : "")}">

    <label ${labelStyle}>Project</label>
    <select id="insp_project" ${largeInput} onchange="window.inspOnProjectChange()">${projectOptions}</select>

    <label ${labelStyle}>Title</label>
    <input id="insp_title" value="${escapeAttr(isEdit ? editData.title : "")}" placeholder="e.g. Monthly Site Inspection" ${largeInput}>

    <label ${labelStyle}>Location</label>
    <input id="insp_location" value="${escapeAttr(isEdit ? editData.location || "" : "")}" placeholder="Site / address" ${largeInput}>

    <label ${labelStyle}>Inspector Name</label>
    <input id="insp_inspector" value="${escapeAttr(isEdit ? editData.inspectorName || "" : lastInspectorName)}" placeholder="Inspector name" ${largeInput}>

    <label ${labelStyle}>Inspection Date</label>
    <input id="insp_date" type="date" value="${escapeAttr(isEdit && editData.inspectionDate ? editData.inspectionDate : new Date().toISOString().slice(0, 10))}" ${largeInput}>

    <label ${labelStyle}>Introduction</label>
    <textarea id="insp_intro" rows="4" placeholder="Purpose and scope of this inspection..." ${largeInput}>${escapeHtml(isEdit ? editData.intro || "" : "")}</textarea>

    <label ${labelStyle}>Observations / Conclusions</label>
    <textarea id="insp_conclusion" rows="4" placeholder="Overall findings and recommendations..." ${largeInput}>${escapeHtml(isEdit ? editData.conclusion || "" : "")}</textarea>

    <label ${labelStyle}>Photos / Attachments</label>
    <div id="inspectionAttachmentsPreviews" style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;"></div>
    ${
      isElectronApp
        ? `<div id="insp_attach_dropzone" class="attach-drop-zone" onclick="document.getElementById('insp_files').click()">
        <i class="fas fa-cloud-arrow-up"></i>
        <span>Drag &amp; drop photos, or click to browse</span>
        <input type="file" id="insp_files" accept="image/*,application/pdf" multiple style="display:none">
      </div>`
        : `<label class="icon-upload-label" style="width:auto; display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:10px; margin-top:10px;">
        <i class="fas fa-camera"></i>
        <span style="font-weight:800; font-size:13px;">Add Photo</span>
        <input type="file" id="insp_files" accept="image/*" capture="environment" style="display:none">
      </label>`
    }

    ${isEdit ? `<button class="action-btn" id="insp_delete_btn" style="background:var(--danger); margin-top:10px;">Delete Inspection</button>` : ""}
  `;

  renderInspAttachmentPreviews();
  document.getElementById("insp_files").onchange = (e) => inspHandleFiles(e.target.files);
  if (isElectronApp) {
    const zone = document.getElementById("insp_attach_dropzone");
    if (zone) {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("attach-drop-zone-active");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("attach-drop-zone-active"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("attach-drop-zone-active");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          inspHandleFiles(e.dataTransfer.files);
        }
      });
    }
  }

  if (isEdit) {
    document.getElementById("insp_delete_btn").onclick = () => {
      if (confirm("Delete this inspection?")) {
        callApi("deleteInspection", { inspectionId: editData.inspectionId }).then(() => {
          inspList = inspList.filter((i) => i.inspectionId !== editData.inspectionId);
          const cache2 = getCache();
          cache2.inspections = inspList;
          setCache(cache2);
          closeModal();
          renderInspectionsPage();
        });
      }
    };
  }

  submit.style.display = "block";
  submit.innerText = "Save";
  submit.onclick = () => {
    const projectSel = document.getElementById("insp_project").value;
    const titleVal = document.getElementById("insp_title").value.trim();
    if (!titleVal) {
      alert("Enter a title for this inspection");
      return;
    }
    const inspectorVal = document.getElementById("insp_inspector").value;
    if (inspectorVal) localStorage.setItem("lastInspectorName", inspectorVal);

    submit.disabled = true;
    submit.innerText = "Saving...";
    const payload = {
      inspectionId: document.getElementById("insp_id").value || undefined,
      projectId: projectSel,
      title: titleVal,
      location: document.getElementById("insp_location").value,
      inspectorName: inspectorVal,
      inspectionDate: document.getElementById("insp_date").value,
      intro: document.getElementById("insp_intro").value,
      conclusion: document.getElementById("insp_conclusion").value,
      attachments: normalizeAttachments(currentModalFiles),
      attachmentComments: inspAttachmentComments,
    };
    callApi(isEdit ? "updateInspection" : "saveInspection", payload)
      .then((resp) => {
        const cache2 = getCache();
        // Match the shape getInspections would return (attachmentComments
        // as a JSON string, same as what's actually in the sheet) so a
        // print or re-edit right after saving — without a full reload —
        // doesn't choke on JSON.parse(actual array).
        const cachedRecord = { ...payload, attachmentComments: JSON.stringify(inspAttachmentComments) };
        if (isEdit) {
          const idx = inspList.findIndex((i) => i.inspectionId === editData.inspectionId);
          if (idx !== -1) inspList[idx] = { ...inspList[idx], ...cachedRecord };
        } else {
          inspList.push({ ...cachedRecord, inspectionId: (resp && resp.inspectionId) || nextNumber });
        }
        cache2.inspections = inspList;
        setCache(cache2);
        closeModal();
        renderInspectionsPage();
      })
      .catch((e) => {
        alert("Failed to save: " + (e.message || "Unknown error"));
        submit.disabled = false;
        submit.innerText = "Save";
      });
  };
}
window.openInspectionModal = openInspectionModal;

function inspOnProjectChange() {
  const projectSel = document.getElementById("insp_project");
  const locationEl = document.getElementById("insp_location");
  if (!projectSel || !locationEl) return;
  const cache = getCache();
  const project = (cache.projects || []).find((p) => p.projectId === projectSel.value);
  if (project && !locationEl.value) locationEl.value = project.siteLocation || "";
}
window.inspOnProjectChange = inspOnProjectChange;

// ===== attachments with per-photo comments =====

function inspHandleFiles(fileList) {
  Array.from(fileList).forEach((file) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let data = ev.target.result;
      try {
        data = file.type.includes("pdf")
          ? await compressPdfToTargetLimit(data, 300000)
          : await compressImageToTargetLimit(data, 190000);
        currentModalFiles.push(data);
        inspAttachmentComments.push("");
        renderInspAttachmentPreviews();
      } catch (err) {
        alert("⚠️ " + (err.message || "Failed to process file."));
      }
    };
    reader.readAsDataURL(file);
  });
}

function inspUpdateComment(idx, value) {
  inspAttachmentComments[idx] = value;
}
window.inspUpdateComment = inspUpdateComment;

function inspRemoveAttachment(idx) {
  currentModalFiles.splice(idx, 1);
  inspAttachmentComments.splice(idx, 1);
  renderInspAttachmentPreviews();
}
window.inspRemoveAttachment = inspRemoveAttachment;

async function renderInspAttachmentPreviews() {
  const box = document.getElementById("inspectionAttachmentsPreviews");
  if (!box) return;
  if (!currentModalFiles.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = currentModalFiles
    .map((url, idx) => {
      const isDataUrl = url.startsWith("data:");
      return `<div style="display:flex; gap:10px; align-items:center; border:1px solid var(--border); border-radius:8px; padding:6px;" data-attach-idx="${idx}">
        <div style="position:relative; width:56px; height:56px; flex-shrink:0;">
          ${
            isDataUrl
              ? `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">`
              : `<div class="attach-thumb-loading" style="width:100%; height:100%; background:#eee; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:9px; color:#999;">…</div>`
          }
        </div>
        <input type="text" value="${escapeAttr(inspAttachmentComments[idx] || "")}" placeholder="Comment for this photo (optional)" style="flex:1; padding:8px; font-size:13px; border:1px solid var(--border); border-radius:6px;" oninput="window.inspUpdateComment(${idx}, this.value)">
        <div onclick="window.inspRemoveAttachment(${idx})" style="flex-shrink:0; width:24px; height:24px; border-radius:50%; background:var(--danger); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px;"><i class="fas fa-trash"></i></div>
      </div>`;
    })
    .join("");

  // Resolve already-uploaded (non-data-URL) attachments to real thumbnails —
  // same fix as everywhere else: the bare Drive file ID doesn't render as
  // an <img src> until it's actually fetched and resolved.
  currentModalFiles.forEach((url, idx) => {
    if (url.startsWith("data:")) return;
    resolveImageToDataUrl(url).then((resolved) => {
      if (!resolved) return;
      const wrapper = box.querySelector(`[data-attach-idx="${idx}"]`);
      const loadingEl = wrapper && wrapper.querySelector(".attach-thumb-loading");
      if (loadingEl) loadingEl.outerHTML = `<img src="${resolved}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">`;
    });
  });
}

// ===== printable report =====

async function previewInspectionReport(inspectionId) {
  const insp = inspList.find((i) => i.inspectionId === inspectionId);
  if (!insp) return;
  const cache = getCache();
  const project = insp.projectId ? (cache.projects || []).find((p) => p.projectId === insp.projectId) : null;

  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  title.innerText = "Inspection Report: " + insp.inspectionId;
  overlay.style.display = "flex";

  const html = await renderInspectionReportDoc(insp, project);
  body.innerHTML = `<div id="insp-report-preview" style="max-height:60vh; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">${html}</div>`;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = html;

  submit.style.display = "block";
  submit.innerText = isElectronApp ? "Print" : "Save PDF";
  submit.onclick = async () => {
    const freshHtml = await renderInspectionReportDoc(insp, project);
    if (printContainer) printContainer.innerHTML = freshHtml;
    if (isElectronApp) {
      printPreRenderedReport();
      return;
    }
    submit.disabled = true;
    submit.innerText = "Generating...";
    const pdf = await generateReportPDF("portrait");
    if (pdf) pdf.save(`Inspection_${insp.inspectionId}.pdf`);
    submit.disabled = false;
    submit.innerText = "Save PDF";
  };
}
window.previewInspectionReport = previewInspectionReport;

function inspectionAttachmentBoxHtml(url, index, comment) {
  return `<div class="snag-report-card">
    <div class="snag-photo-box-img"><img src="${escapeAttr(url)}" onerror="this.parentElement.style.display='none'"></div>
    <div class="snag-photo-index">Photo ${index + 1}</div>
    ${comment ? `<div class="snag-photo-caption-sub">${escapeHtml(comment)}</div>` : ""}
  </div>`;
}

async function renderInspectionReportDoc(insp, project) {
  const introHtml = insp.intro && insp.intro.trim()
    ? escapeHtml(insp.intro).replace(/\n/g, "<br>")
    : `<em style="color:#adb5bd;">No introduction provided.</em>`;
  const conclusionHtml = insp.conclusion && insp.conclusion.trim()
    ? escapeHtml(insp.conclusion).replace(/\n/g, "<br>")
    : `<em style="color:#adb5bd;">No conclusion provided.</em>`;
  const inspectionDate = formatInspectionDate(insp.inspectionDate);
  const inspectorName = (insp.inspectorName || "Kayode Olubisi").trim();

  const headerProject = project || {
    clientName: insp.title || "General Inspection",
    projectId: insp.inspectionId,
    siteLocation: insp.location || "—",
  };

  const introSection = `
    <div style="margin-top:20px;">
      ${renderSectionHeading(1, "Introduction")}
      <p style="font-size:13px; line-height:1.6; margin-top:10px;">${introHtml}</p>
    </div>`;

  const resolvedAttachments = await resolveAttachmentList(insp.attachments);
  const comments = parseInspAttachmentComments(insp.attachmentComments);
  const photoGridHtml = resolvedAttachments.length
    ? `<div class="inspection-report-grid">${resolvedAttachments.map((a, i) => inspectionAttachmentBoxHtml(a.url, i, comments[i])).join("")}</div>`
    : `<p style="text-align:center; color:#495057; padding:24px 0;">No photos attached to this inspection.</p>`;

  const photosSection = `
    <div style="margin-top:22px;">
      ${renderSectionHeading(2, "Photographic Record")}
      <div style="margin-top:14px;">${photoGridHtml}</div>
    </div>`;

  const conclusionSection = `
    <div style="margin-top:22px;">
      ${renderSectionHeading(3, "Observations / Conclusions")}
      <p style="font-size:13px; line-height:1.6; margin-top:10px;">${conclusionHtml}</p>
      ${await generateInspectionSignatureBlocks(inspectorName)}
    </div>`;

  return `<div class="report-page-wrapper inspection-report-flow">
    <div class="report-content">
      ${await generateFlowReportHeader("Inspection Report", headerProject, {
        dateLine: inspectionDate,
        extraFieldsHtml: `<div><strong style="color:#000;">Inspector:</strong> ${escapeHtml(inspectorName)}</div><div><strong style="color:#000;">Inspection No:</strong> ${escapeHtml(insp.inspectionId)}</div>`,
      })}
      ${introSection}
      ${photosSection}
      ${conclusionSection}
    </div>
  </div>`;
}
