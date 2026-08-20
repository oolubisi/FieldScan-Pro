// ===== dashboard.js =====
async function refreshMasterDashboard() {
  const container = document.getElementById("project-master-list");
  if (container)
    container.innerHTML =
      '<p style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading projects...</p>';
  try {
    const projects = await callApi("getProjects", {});
    console.log("getProjects response:", projects);

    const cache = getCache();

    // FIX: If server returns empty array but cache has projects, preserve cache
    if (
      Array.isArray(projects) &&
      projects.length === 0 &&
      Array.isArray(cache.projects) &&
      cache.projects.length > 0
    ) {
      console.warn(
        "Server returned empty projects; rendering from cache:",
        cache.projects.length,
        "projects",
      );
      if (typeof showSyncToast === "function")
        showSyncToast("⚠️ Showing saved data — could not confirm with server");
      renderProjects();
      return;
    }

    if (!Array.isArray(projects)) {
      console.error("getProjects returned non-array:", projects);
      // FIX: Try to render from cache instead of showing error
      if (Array.isArray(cache.projects) && cache.projects.length > 0) {
        console.warn("Rendering from cache instead");
        if (typeof showSyncToast === "function")
          showSyncToast("⚠️ Showing saved data — could not confirm with server");
        renderProjects();
        return;
      }
      if (container)
        container.innerHTML =
          '<p style="text-align:center;padding:20px;color:red;">Server returned invalid data. Check console.</p>';
      return;
    }
    cache.projects = projects;
    setCache(cache);
    renderProjects();
  } catch (e) {
    console.error("refreshMasterDashboard error:", e);
    // FIX: On error, try to render from existing cache
    const cache = getCache();
    if (Array.isArray(cache.projects) && cache.projects.length > 0) {
      console.warn(
        "Network error; rendering from cache:",
        cache.projects.length,
        "projects",
      );
      if (typeof showSyncToast === "function")
        showSyncToast("⚠️ Offline — showing saved data");
      renderProjects();
      return;
    }
    if (container)
      container.innerHTML =
        '<p style="text-align:center;padding:20px;color:red;">Failed to load projects. Check your connection.</p>';
  }
}

const PROJECT_STATUS_COLORS = {
  "Active": "var(--success)",
  "Handed Over": "var(--muted)",
  "Abandoned": "var(--danger)",
};

let dashHandedOverExpanded = false;
let dashArchivedProjectsExpanded = false;

function renderProjects() {
  if (typeof renderDashboardSummary === "function") renderDashboardSummary();
  const container = document.getElementById("project-master-list");
  const searchEl = document.getElementById("search-projects");
  if (!container || !searchEl) return;
  const term = searchEl.value.toLowerCase();
  const cache = getCache();
  if (!Array.isArray(cache.projects)) {
    console.error(
      "renderProjects: cache.projects is not an array",
      cache.projects,
    );
    container.innerHTML =
      '<p style="text-align:center;padding:20px;color:red;">Data error: projects corrupted. Try Refresh.</p>';
    return;
  }
  const filtered = cache.projects.filter(
    (p) =>
      p &&
      (p.clientName?.toLowerCase().includes(term) ||
        p.projectId?.toLowerCase().includes(term)),
  );
  if (!filtered.length) {
    container.innerHTML = term
      ? '<p style="text-align:center;padding:20px; color:var(--muted);">No projects match your search.</p>'
      : '<p style="text-align:center;padding:20px; color:var(--muted);">No projects yet — build or accept an Estimate, then create a project from it.</p>';
    return;
  }
  try {
    // Archived is purely a manual declutter flag, orthogonal to status --
    // pulled out of BOTH the active and Handed Over groups into its own
    // section, same collapsed-by-default pattern as Handed Over.
    const notArchived = filtered.filter((p) => !p.archived);
    const archivedProjects = filtered.filter((p) => p.archived);
    const active = notArchived.filter((p) => p.projectStatus !== "Handed Over");
    const handedOver = notArchived.filter((p) => p.projectStatus === "Handed Over");

    const activeHtml = active.length
      ? active.map(dashProjectCardHtml).join("")
      : '<p style="text-align:center;padding:20px;color:var(--muted);">No projects match this filter.</p>';

    const handedOverHtml = handedOver.length
      ? '<div style="margin-top:16px;">' +
        '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.dashToggleHandedOverExpanded()">' +
        '<i class="fas ' + (dashHandedOverExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> Handed Over (' + handedOver.length + ')' +
        '</div>' +
        (dashHandedOverExpanded ? handedOver.map(dashProjectCardHtml).join("") : "") +
        '</div>'
      : "";

    // A plain block-level div outside the card grid/flex flow, same as
    // Handed Over above -- naturally starts on its own row underneath
    // everything else, no extra layout work needed.
    const archivedHtml = archivedProjects.length
      ? '<div style="margin-top:16px;">' +
        '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.dashToggleArchivedProjectsExpanded()">' +
        '<i class="fas ' + (dashArchivedProjectsExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> <i class="fas fa-box-archive"></i> Archived (' + archivedProjects.length + ')' +
        '</div>' +
        (dashArchivedProjectsExpanded ? archivedProjects.map(dashProjectCardHtml).join("") : "") +
        '</div>'
      : "";

    container.innerHTML = activeHtml + handedOverHtml + archivedHtml;
  } catch (e) {
    console.error("renderProjects error:", e);
    container.innerHTML =
      '<p style="text-align:center;padding:20px;color:red;">Error rendering projects. Check console.</p>';
  }
}

function dashToggleArchivedProjectsExpanded() {
  dashArchivedProjectsExpanded = !dashArchivedProjectsExpanded;
  renderProjects();
}
window.dashToggleArchivedProjectsExpanded = dashToggleArchivedProjectsExpanded;

function dashProjectCardHtml(p) {
  const statusColor = PROJECT_STATUS_COLORS[p.projectStatus] || "var(--muted)";
  return `<div class="card" data-project-id="${escapeAttr(p.projectId)}" onclick="window.loadProjectConsoleHub('${escapeAttr(p.projectId)}')" style="border-left:5px solid ${statusColor}; cursor:pointer;"><strong style="font-size:20px;">${escapeHtml(p.clientName)}</strong><div style="font-size:12px; color:var(--muted); margin-top:4px;">${escapeHtml(p.displayNumber || p.projectId)}</div></div>`;
}

function dashToggleHandedOverExpanded() {
  dashHandedOverExpanded = !dashHandedOverExpanded;
  renderProjects();
}
window.dashToggleHandedOverExpanded = dashToggleHandedOverExpanded;

function toggleVendorsArchivedExpanded() {
  vendorsArchivedExpanded = !vendorsArchivedExpanded;
  renderVendors();
}
window.toggleVendorsArchivedExpanded = toggleVendorsArchivedExpanded;

async function refreshVendorsListView() {
  const vendors = await callApi("getVendors", {});
  const cache = getCache();
  cache.vendors = vendors || [];
  setCache(cache);
  renderVendors();
}

let vendorsArchivedExpanded = false;

function renderVendors() {
  const term = document.getElementById("search-vendor").value.toLowerCase();
  const cache = getCache();
  const filtered = cache.vendors.filter(
    (v) =>
      !term ||
      v.company?.toLowerCase().includes(term) ||
      v.trade?.toLowerCase().includes(term),
  );
  const container = document.getElementById("vendor-master-list");
  const isArchived = (v) => String(v.archived).toLowerCase() === "yes" || v.archived === true;
  const active = filtered.filter((v) => !isArchived(v));
  const archived = filtered.filter(isArchived);

  if (!filtered.length) {
    container.innerHTML = '<p style="padding:20px; color:var(--muted);">No vendors match your search.</p>';
    return;
  }

  const PLACEHOLDER_AVATAR =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E";

  const vendorCardHtml = (v) => {
    const key = `vendor:${v.vendorId}`;
    window.modalRecordCache = window.modalRecordCache || {};
    window.modalRecordCache[key] = v;
    return `<div class="card" data-modal-type="vendor" data-modal-key="${key}" data-vendor-avatar-id="${escapeAttr(v.vendorId)}" onclick="window.openModalWithRecord('vendor', window.modalRecordCache['${key}'])" style="display:flex; gap:12px; align-items:center;"><img id="vendor-avatar-${escapeAttr(v.vendorId)}" src="${PLACEHOLDER_AVATAR}" style="width:50px; height:50px; border-radius:50%; object-fit:cover; flex-shrink:0;"><div style="flex:1;"><strong>${escapeHtml(v.company)}</strong><br>${escapeHtml(v.trade)}<br>${escapeHtml(v.phone1)}</div></div>`;
  };

  const activeHtml = active.length
    ? active.map(vendorCardHtml).join("")
    : '<p style="padding:20px; color:var(--muted);">No active vendors match this search.</p>';

  const archivedHtml = archived.length
    ? '<div style="margin-top:16px;">' +
      '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.toggleVendorsArchivedExpanded()">' +
      '<i class="fas ' + (vendorsArchivedExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> Archived (' + archived.length + ')' +
      '</div>' +
      (vendorsArchivedExpanded ? '<div style="opacity:0.6;">' + archived.map(vendorCardHtml).join("") + '</div>' : "") +
      '</div>'
    : "";

  container.innerHTML = activeHtml + archivedHtml;

  // Passport photos are stored as bare Drive file IDs — the doGet endpoint
  // returns that as text/plain, not real image bytes, so using it directly
  // as an <img src> renders blank (same recurring issue fixed elsewhere:
  // photos, documents, attachment previews). Resolve each one properly and
  // swap in the real thumbnail once it arrives.
  filtered.forEach((v) => {
    // Same jsonb-array-default issue as the edit modal: a vendor with no
    // photo has passport = [] (truthy, so the old `if (!v.passport)`
    // guard let it straight through), not "" or null -- crashing the
    // moment resolveImageToDataUrl tried a string method on an array.
    if (typeof v.passport !== "string" || !v.passport) return;
    resolveImageToDataUrl(v.passport).then((resolved) => {
      if (!resolved) return;
      const img = document.getElementById(`vendor-avatar-${v.vendorId}`);
      if (img) img.src = resolved;
    });
  });
}

// ===== dashboard summary: stat cards + recent activity =====

let dashTasksFetchAttempted = false;

function renderDashboardSummary() {
  const statsEl = document.getElementById("dashboard-stats");
  if (!statsEl) return;

  const cache = getCache();
  if (!dashTasksFetchAttempted && (!cache.tasks || !cache.tasks.length)) {
    dashTasksFetchAttempted = true;
    callApi("getTasks", {})
      .then(function (resp) {
        const c2 = getCache();
        c2.tasks = Array.isArray(resp) ? resp : [];
        setCache(c2);
        renderDashboardSummary();
      })
      .catch(function (e) { console.error("Background getTasks fetch failed", e); });
  }
  const projects = cache.projects || [];
  const snags = cache.snags || [];

  // Active projects
  const activeCount = projects.filter(function (p) { return p.projectStatus === "Active"; }).length;

  // Total outstanding (money owed BY clients) and total pending (money
  // owed TO vendors/contractors) — same balance logic already used on the
  // Accounts page, just summed across every project instead of one, and
  // computed together since they both come from the same payment-group
  // pass. "Small Expense" groups count toward neither (they're one-off
  // paid-in-full items, not an open balance either way).
  let totalOutstanding = 0;
  let totalPending = 0;
  const outstandingByProject = [];
  const pendingByProject = [];
  if (typeof getAllPaymentGroups === "function") {
    projects.forEach(function (p) {
      const groups = getAllPaymentGroups(p.projectId);
      let projOutstanding = 0;
      let projPending = 0;
      groups.forEach(function (g) {
        if (g.direction === "Client Receipt") projOutstanding += g.balance;
        else if (g.direction !== "Small Expense") projPending += g.balance;
      });
      if (roundMoney(projOutstanding) > 0) {
        outstandingByProject.push({ projectId: p.projectId, label: (p.clientName || p.projectId), amount: roundMoney(projOutstanding) });
      }
      if (roundMoney(projPending) > 0) {
        pendingByProject.push({ projectId: p.projectId, label: (p.clientName || p.projectId), amount: roundMoney(projPending) });
      }
      totalOutstanding += projOutstanding;
      totalPending += projPending;
    });
    totalOutstanding = roundMoney(totalOutstanding);
    totalPending = roundMoney(totalPending);
  }

  // Open snags — anything not marked Completed (blank/missing status counts as Open too)
  const openSnags = snags.filter(function (s) { return s.status !== "Completed"; });
  const openSnagsCount = openSnags.length;
  const snagsByProjectMap = {};
  openSnags.forEach(function (s) {
    snagsByProjectMap[s.projectId] = (snagsByProjectMap[s.projectId] || 0) + 1;
  });
  const openSnagsByProject = Object.keys(snagsByProjectMap).map(function (pid) {
    const p = projects.find(function (pr) { return pr.projectId === pid; });
    return { projectId: pid, label: (p ? p.clientName : null) || pid, count: snagsByProjectMap[pid] };
  });

  const openTasksCount = (cache.tasks || []).filter(function (t) { return t.status !== "Done"; }).length;

  if (statsEl) {
    statsEl.innerHTML = [
      dashStatCardHtml("Active Projects", activeCount, "fa-diagram-project", "var(--success)"),
      dashStatCardHtml("Outstanding", "₦" + moneyValue(totalOutstanding), "fa-naira-sign", "var(--danger)",
        outstandingByProject.map(function (o) { return { label: o.label, value: "₦" + moneyValue(o.amount) }; })),
      dashStatCardHtml("Open Snags", openSnagsCount, "fa-triangle-exclamation", "#fd7e14",
        openSnagsByProject.map(function (o) { return { label: o.label, value: String(o.count) }; })),
      dashStatCardHtml("Pending Payments", "₦" + moneyValue(totalPending), "fa-hourglass-half", "#0056b3",
        pendingByProject.map(function (o) { return { label: o.label, value: "₦" + moneyValue(o.amount) }; })),
      dashStatCardHtml("Open Tasks", openTasksCount, "fa-list-check", "#6f42c1"),
    ].join("");
  }

}
window.renderDashboardSummary = renderDashboardSummary;

function dashStatCardHtml(label, value, icon, color, tooltipItems) {
  const hasTooltip = Array.isArray(tooltipItems) && tooltipItems.length > 0;
  const tooltipHtml = hasTooltip
    ? '<div class="dash-stat-tooltip">' +
      '<div style="font-weight:800; font-size:11px; text-transform:uppercase; color:var(--muted); margin-bottom:6px; text-align:left;">Projects Involved</div>' +
      tooltipItems.map(function (t) {
        return '<div style="display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:3px 0; text-align:left;"><span>' + escapeHtml(t.label) + '</span><span style="font-weight:700; flex-shrink:0;">' + escapeHtml(t.value) + '</span></div>';
      }).join("") +
      '</div>'
    : "";
  return (
    '<div class="card dash-stat-card" style="text-align:center; margin:0; position:relative;' + (hasTooltip ? " cursor:default;" : "") + '">' +
    '<i class="fas ' + icon + '" style="color:' + color + '; font-size:18px;"></i>' +
    '<div style="font-size:20px; font-weight:900; margin-top:6px;">' + escapeHtml(String(value)) + '</div>' +
    '<div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase; margin-top:2px;">' + escapeHtml(label) + '</div>' +
    tooltipHtml +
    '</div>'
  );
}

// ===== quick-add task FAB (mobile dashboard) =====
// Reuses createTasksFromTitles (tasks.js) so this shares the exact same
// creation logic as the Tasks page's own quick-add -- no separate path.

function openDashboardQuickAddTask() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:flex-end; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:16px 16px 0 0; padding:20px; width:100%; max-width:480px; padding-bottom:calc(20px + env(safe-area-inset-bottom, 0px));">' +
    '<h3 style="margin-top:0;">Quick Add Task</h3>' +
    '<input id="dash-quick-task-input" type="text" placeholder="Type a task... (separate multiple with ;)" style="width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;">' +
    '<div style="display:flex; gap:8px; margin-top:14px;">' +
    '<button type="button" class="action-btn dash-quick-task-cancel" style="background:var(--card-light); color:var(--text);">Cancel</button>' +
    '<button type="button" class="action-btn dash-quick-task-confirm">Add</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const input = document.getElementById("dash-quick-task-input");
  input.focus();

  const confirmAdd = async function () {
    const rawValue = input.value.trim();
    if (!rawValue) {
      input.style.transition = "box-shadow 0.15s";
      input.style.boxShadow = "0 0 0 2px var(--danger)";
      setTimeout(() => { input.style.boxShadow = ""; }, 400);
      return;
    }
    const confirmBtn = overlay.querySelector(".dash-quick-task-confirm");
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Adding...";
    try {
      const { createdCount, failCount } = await createTasksFromTitles(rawValue);
      overlay.remove();
      if (createdCount > 0 && typeof showSyncToast === "function") {
        showSyncToast(createdCount > 1 ? createdCount + " tasks added" : "Task added");
      }
      if (failCount > 0) {
        alert(failCount + " task(s) could not be saved — check your connection and try again.");
      }
    } catch (e) {
      alert("Could not add task: " + (e.message || "Unknown error"));
      confirmBtn.disabled = false;
      confirmBtn.innerText = "Add";
    }
  };

  overlay.querySelector(".dash-quick-task-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelector(".dash-quick-task-confirm").onclick = confirmAdd;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") confirmAdd();
  });
}
window.openDashboardQuickAddTask = openDashboardQuickAddTask;
