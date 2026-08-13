// ===== projecttrash.js =====
// Trashed projects live here, out of the normal project list but fully
// recoverable, until someone explicitly chooses to erase one for good.

async function openProjectTrashPanel() {
  const panelId = "project-trash-panel";
  openFullPagePanel(panelId, "Project Trash");
  const body = document.getElementById(panelId + "-body");
  const footer = document.getElementById(panelId + "-footer");
  if (footer) footer.style.display = "none";
  body.innerHTML = '<div class="card"><span style="font-size:13px; color:var(--muted);">Loading...</span></div>';

  try {
    const resp = await callApi("getTrashedProjects", {});
    window.trashedProjectsList = Array.isArray(resp) ? resp : [];
  } catch (e) {
    body.innerHTML = '<p style="text-align:center; padding:20px; color:var(--danger);">Could not load Project Trash: ' + escapeHtml(e.message || "Unknown error") + '</p>';
    return;
  }
  renderProjectTrashBody(panelId);
}
window.openProjectTrashPanel = openProjectTrashPanel;

function renderProjectTrashBody(panelId) {
  const body = document.getElementById(panelId + "-body");
  if (!body) return;
  const list = window.trashedProjectsList || [];
  if (!list.length) {
    body.innerHTML = '<p style="text-align:center; padding:20px; color:var(--muted);">Project Trash is empty.</p>';
    return;
  }
  const sorted = [...list].sort((a, b) => (Number(b.trashedAt) || 0) - (Number(a.trashedAt) || 0));
  body.innerHTML = sorted.map((p) => {
    const when = p.trashedAt ? new Date(Number(p.trashedAt)).toLocaleDateString() : "Unknown date";
    return (
      '<div class="card" style="margin-bottom:10px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">' +
      '<div><strong style="font-size:15px;">' + escapeHtml(p.clientName || p.projectId) + '</strong>' +
      '<div style="font-size:12px; color:var(--muted);">' + escapeHtml(p.displayNumber || p.projectId) + ' · deleted ' + when + '</div></div>' +
      '<div style="display:flex; gap:8px; flex-shrink:0;">' +
      '<button class="action-btn" style="width:auto; padding:8px 14px; font-size:12px;" onclick="window.restoreTrashedProject(\'' + escapeAttr(p.projectId) + '\', \'' + panelId + '\')"><i class="fas fa-rotate-left"></i> Restore</button>' +
      '<button class="action-btn" style="width:auto; padding:8px 14px; font-size:12px; background:var(--danger);" onclick="window.permanentlyEraseProject(\'' + escapeAttr(p.projectId) + '\', \'' + escapeAttr(p.clientName || p.projectId) + '\', \'' + panelId + '\')"><i class="fas fa-fire"></i> Erase Forever</button>' +
      '</div></div></div>'
    );
  }).join("");
}

function restoreTrashedProject(projectId, panelId) {
  window.trashedProjectsList = (window.trashedProjectsList || []).filter((p) => p.projectId !== projectId);
  renderProjectTrashBody(panelId);
  const cache = getCache();
  cache.projectsLoaded = false; // the main list should re-fetch and pick this project back up next time it's viewed
  setCache(cache);
  if (typeof writeBackup === "function") writeBackup("getTrashedProjects", window.trashedProjectsList, {});
  if (typeof showSyncToast === "function") showSyncToast("✅ Project restored");
  runInBackground("restoreProject", { projectId: projectId });
}
window.restoreTrashedProject = restoreTrashedProject;

function permanentlyEraseProject(projectId, label, panelId) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9500; display:flex; align-items:center; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:20px; max-width:420px; width:90%;">' +
    '<h3 style="margin-top:0; color:var(--danger);"><i class="fas fa-triangle-exclamation"></i> Erase Forever</h3>' +
    '<p style="font-size:13px; line-height:1.5;">This permanently erases <strong>"' + escapeHtml(label) + '"</strong> and every Estimate, Snag, Payment, Inspection, Change Order, Work Order, Progress Log, Task, Take-Off, Document, and Photo linked to it. This cannot be undone.</p>' +
    '<p style="font-size:13px; margin-bottom:6px;">Type the project ID <strong>' + escapeHtml(projectId) + '</strong> to confirm:</p>' +
    '<input id="erase-project-confirm-input" placeholder="' + escapeAttr(projectId) + '" style="width:100%; padding:10px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">' +
    '<div style="display:flex; gap:8px; margin-top:14px;">' +
    '<button type="button" class="action-btn erase-project-cancel" style="background:var(--card-light); color:var(--text);">Cancel</button>' +
    '<button type="button" class="action-btn erase-project-confirm" style="background:var(--danger);">Erase Forever</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const input = document.getElementById("erase-project-confirm-input");
  input.focus();

  const doErase = function () {
    if (input.value.trim() !== projectId) {
      input.style.transition = "box-shadow 0.15s";
      input.style.boxShadow = "0 0 0 2px var(--danger)";
      setTimeout(() => { input.style.boxShadow = ""; }, 400);
      return;
    }
    // Instant: drop it from the visible Trash list and close the dialog
    // right away -- the actual multi-sheet cascade continues in the
    // background, visible in the sync indicator like any other pending
    // change, rather than the user staring at a spinner for it.
    window.trashedProjectsList = (window.trashedProjectsList || []).filter((p) => p.projectId !== projectId);
    overlay.remove();
    renderProjectTrashBody(panelId);
    // Same fix as trashCurrentProject in console.js: without this, the
    // "protect against empty server responses" guard in api.js can't
    // tell "server is broken" apart from "we just correctly erased the
    // last trashed project," and keeps resurrecting it in Trash forever.
    if (typeof writeBackup === "function") writeBackup("getTrashedProjects", window.trashedProjectsList, {});
    if (typeof showSyncToast === "function") showSyncToast("🔥 Erasing \"" + label + "\" permanently...");
    runInBackground("permanentlyDeleteProject", { projectId: projectId });
  };

  overlay.querySelector(".erase-project-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelector(".erase-project-confirm").onclick = doErase;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") doErase();
  });
}
window.permanentlyEraseProject = permanentlyEraseProject;
