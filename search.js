// ===== search.js =====
// Global search across Projects, Vendors, Clients, Estimates, Inspections,
// Change Orders, and Work Orders. Searches whatever's already cached, plus
// background-fetches the entity types that aren't part of the app's
// startup preload (Clients/Estimates/Inspections/Change Orders) the first
// time the panel opens, so search works well even before the user has
// visited those pages individually.

let searchDataEnsured = false;

async function ensureSearchDataLoaded() {
  if (searchDataEnsured) return;
  searchDataEnsured = true;
  const cache = getCache();
  const needClients = !cache.clients || !cache.clients.length;
  const needEstimates = !cache.estimates || !cache.estimates.length;
  const needInspections = !cache.inspections || !cache.inspections.length;
  const needChangeOrders = !cache.changeOrders || !cache.changeOrders.length;

  const results = await Promise.allSettled([
    needClients ? callApi("getClients", {}) : Promise.resolve(null),
    needEstimates ? callApi("getEstimates", {}) : Promise.resolve(null),
    needInspections ? callApi("getInspections", {}) : Promise.resolve(null),
    needChangeOrders ? callApi("getChangeOrders", {}) : Promise.resolve(null),
  ]);

  const cache2 = getCache();
  if (needClients && results[0].status === "fulfilled") cache2.clients = results[0].value || [];
  if (needEstimates && results[1].status === "fulfilled") cache2.estimates = results[1].value || [];
  if (needInspections && results[2].status === "fulfilled") cache2.inspections = results[2].value || [];
  if (needChangeOrders && results[3].status === "fulfilled") cache2.changeOrders = results[3].value || [];
  setCache(cache2);
}

function globalSearchQuery(term) {
  term = String(term || "").trim().toLowerCase();
  if (!term) return [];
  const cache = getCache();
  const results = [];

  (cache.projects || []).forEach(function (p) {
    const hay = [p.clientName, p.projectId, p.siteLocation].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Project",
        title: p.clientName || p.displayNumber || p.projectId,
        subtitle: (p.displayNumber || "") + (p.siteLocation ? " · " + p.siteLocation : ""),
        action: function () { showPage("dashboard"); window.loadProjectConsoleHub(p.projectId); },
      });
    }
  });

  (cache.vendors || []).forEach(function (v) {
    const hay = [v.company, v.trade, v.contactName].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Vendor",
        title: v.company,
        subtitle: v.trade || "",
        action: function () {
          showPage("vendors");
          setTimeout(function () { window.openModalWithRecord("vendor", v); }, 60);
        },
      });
    }
  });

  (cache.clients || []).forEach(function (c) {
    const hay = [c.name, c.address, c.phone, c.email].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Client",
        title: c.name,
        subtitle: c.address || c.phone || "",
        action: function () {
          showPage("clients");
          setTimeout(function () { window.openClientModal(c); }, 60);
        },
      });
    }
  });

  (cache.estimates || []).forEach(function (e) {
    const hay = [e.clientName, e.estimateNumber, e.estimateId].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Estimate",
        title: e.clientName || "Untitled",
        subtitle: e.estimateNumber || "Draft",
        action: function () {
          showPage("estimates");
          setTimeout(function () {
            if (isElectronApp) window.openEstimateModal(e);
            else window.viewEstimateMobile(e.estimateId);
          }, 60);
        },
      });
    }
  });

  (cache.inspections || []).forEach(function (i) {
    const hay = [i.title, i.inspectionNumber, i.location].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Inspection",
        title: i.title || "Untitled Inspection",
        subtitle: i.inspectionNumber || "",
        action: function () { showPage("inspections"); },
      });
    }
  });

  (cache.changeOrders || []).forEach(function (co) {
    const hay = [co.title, co.changeOrderNumber].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Change Order",
        title: co.title || co.changeOrderNumber,
        subtitle: co.changeOrderNumber || "",
        action: function () { window.loadProjectConsoleHub(co.projectId); },
      });
    }
  });

  (cache.workorders || []).forEach(function (w) {
    const hay = [w.description, w.workOrderId].join(" ").toLowerCase();
    if (hay.indexOf(term) !== -1) {
      results.push({
        category: "Work Order",
        title: (w.description || "Work Order").slice(0, 60),
        subtitle: w.workOrderId || "",
        action: function () { window.loadProjectConsoleHub(w.projectId); },
      });
    }
  });

  return results.slice(0, 60); // cap for readability/performance
}

// ===== UI =====

async function openGlobalSearch() {
  await ensureSearchDataLoaded();
  const panelId = "global-search-panel";
  openFullPagePanel(panelId, "Search");
  const body = document.getElementById(panelId + "-body");
  const footer = document.getElementById(panelId + "-footer");
  if (footer) footer.style.display = "none"; // no Save/action button needed for search

  body.innerHTML =
    '<input id="global-search-input" type="text" placeholder="Search projects, vendors, clients, estimates..." ' +
    'style="width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;" oninput="window.renderGlobalSearchResults(this.value)">' +
    '<div id="global-search-results" style="margin-top:16px;"></div>';

  const input = document.getElementById("global-search-input");
  input.focus();
}
window.openGlobalSearch = openGlobalSearch;

function renderGlobalSearchResults(term) {
  const resultsEl = document.getElementById("global-search-results");
  if (!resultsEl) return;
  if (!term || !term.trim()) {
    resultsEl.innerHTML = '<p style="color:var(--muted); font-size:13px; text-align:center; padding:20px;">Start typing to search.</p>';
    return;
  }
  const results = globalSearchQuery(term);
  if (!results.length) {
    resultsEl.innerHTML = '<p style="color:var(--muted); font-size:13px; text-align:center; padding:20px;">No matches for "' + escapeHtml(term) + '".</p>';
    return;
  }

  const byCategory = {};
  results.forEach(function (r) {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push(r);
  });

  let html = "";
  Object.keys(byCategory).forEach(function (cat) {
    html += '<div style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin:14px 0 6px;">' + escapeHtml(cat) + '</div>';
    byCategory[cat].forEach(function (r, i) {
      const resultKey = cat + "-" + i;
      window.globalSearchResultActions = window.globalSearchResultActions || {};
      window.globalSearchResultActions[resultKey] = r.action;
      html +=
        '<div class="card" style="cursor:pointer; margin-bottom:8px;" onclick="window.runGlobalSearchResult(\'' + resultKey + '\')">' +
        '<strong>' + escapeHtml(r.title || "") + '</strong>' +
        (r.subtitle ? '<div style="font-size:12px; color:var(--muted);">' + escapeHtml(r.subtitle) + '</div>' : "") +
        '</div>';
    });
  });
  resultsEl.innerHTML = html;
}
window.renderGlobalSearchResults = renderGlobalSearchResults;

function runGlobalSearchResult(resultKey) {
  const action = window.globalSearchResultActions && window.globalSearchResultActions[resultKey];
  if (!action) return;
  closeFullPagePanel("global-search-panel");
  action();
}
window.runGlobalSearchResult = runGlobalSearchResult;
