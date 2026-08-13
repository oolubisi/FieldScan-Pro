// ===== projectexport.js =====
// Desktop-only, complete project export: every linked data record plus
// the actual files (local Documents + Photos resolved from Drive),
// packaged into a single .zip. Shows real progress throughout rather
// than a single opaque spinner, since this can genuinely take a while
// for a project with a lot of photos.

async function openExportProjectFlow() {
  if (!isElectronApp) {
    alert("Project export is only available on desktop.");
    return;
  }
  const projectId = getCurrentProjectId();
  const cache = getCache();
  const project = (cache.projects || []).find((p) => p.projectId === projectId);
  if (!project) return;

  const overlay = document.createElement("div");
  overlay.id = "export-progress-overlay";
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9500; display:flex; align-items:center; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:24px; max-width:420px; width:90%;">' +
    '<h3 style="margin-top:0;"><i class="fas fa-box-archive"></i> Exporting "' + escapeHtml(project.clientName || project.projectId) + '"</h3>' +
    '<div id="export-progress-status" style="font-size:13px; color:var(--muted); margin-bottom:10px;">Starting...</div>' +
    '<div style="background:var(--card-light); border-radius:8px; height:10px; overflow:hidden;">' +
    '<div id="export-progress-bar" style="background:var(--primary); height:100%; width:0%; transition:width 0.2s;"></div>' +
    '</div>' +
    '<div id="export-progress-count" style="font-size:11px; color:var(--muted); margin-top:6px; text-align:right;"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  const setProgress = (pct, statusText, countText) => {
    const bar = document.getElementById("export-progress-bar");
    const status = document.getElementById("export-progress-status");
    const count = document.getElementById("export-progress-count");
    if (bar) bar.style.width = pct + "%";
    if (status && statusText) status.innerText = statusText;
    if (count) count.innerText = countText || "";
  };

  try {
    setProgress(5, "Fetching project data...");
    const resp = await callApi("getProjectFullExportData", { projectId: projectId });
    if (!resp || typeof resp !== "object" || resp.success === false || !resp.data) {
      throw new Error(
        (resp && (resp.message || resp.error)) ||
        "Could not fetch project data — check your connection and try again. If this keeps happening, the request may be timing out for a project with a lot of records."
      );
    }
    const exportData = resp.data;

    const zip = new JSZip();
    zip.file("data.json", JSON.stringify(exportData, null, 2));

    // ---- Local Documents (read directly off disk, no network needed) ----
    setProgress(15, "Reading local documents...");
    let localFiles = [];
    try {
      localFiles = (await window.electronAPI.attachments.list(projectId, "Documents")) || [];
    } catch (e) {
      console.warn("Could not list local documents for export", e);
    }
    const docsFolder = zip.folder("Documents");
    for (let i = 0; i < localFiles.length; i++) {
      const f = localFiles[i];
      setProgress(15 + Math.round((i / Math.max(localFiles.length, 1)) * 25), "Adding documents...", (i + 1) + " / " + localFiles.length);
      try {
        const base64 = await window.electronAPI.attachments.readFileBytes(f.path);
        if (base64) docsFolder.file(f.name, base64, { base64: true });
      } catch (e) {
        console.warn("Could not read document for export:", f.name, e);
      }
    }

    // ---- Photos (resolved from Drive -- these aren't stored locally) ----
    setProgress(40, "Downloading photos...");
    const photos = exportData.Photos || [];
    const photosFolder = zip.folder("Photos");
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      setProgress(40 + Math.round((i / Math.max(photos.length, 1)) * 45), "Downloading photos...", (i + 1) + " / " + photos.length);
      try {
        const dataUrl = await resolveImageToDataUrl(p.storagePath);
        if (dataUrl && dataUrl.startsWith("data:")) {
          const base64 = dataUrl.split(",")[1];
          const ext = dataUrl.includes("image/png") ? "png" : "jpg";
          photosFolder.file((p.photoId || "photo_" + i) + "." + ext, base64, { base64: true });
        }
      } catch (e) {
        console.warn("Could not download photo for export:", p.photoId, e);
      }
    }

    setProgress(87, "Building zip file...");
    const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
      setProgress(87 + Math.round(metadata.percent * 0.1), "Compressing...");
    });

    setProgress(98, "Saving...");
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "FieldScanExport_" + (project.projectId || projectId) + "_" + Date.now() + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setProgress(100, "Done!");
    setTimeout(() => overlay.remove(), 700);
    if (typeof showSyncToast === "function") showSyncToast("✅ Project exported");
  } catch (e) {
    console.error("Project export failed", e);
    overlay.remove();
    alert("Export failed: " + (e.message || "Unknown error"));
  }
}
window.openExportProjectFlow = openExportProjectFlow;
