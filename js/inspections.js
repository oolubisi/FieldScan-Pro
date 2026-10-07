// ===== Inspections on the phone =====
//   "inspection"  data: { title, location, inspectorName, inspectionDate, intro, conclusion }
// The phone form is the short one (title, project, location, inspector, date, observations).
// "intro" and any other field the phone doesn't show are carried along untouched.
// An inspection belongs to a company (so the right desktop file gets it); the project is optional.

const INSP = "inspection";

async function inLoad() {
  const status = await fsp.sync.getStatus();
  const projects = await fsp.sync.listProjects();
  const items = await fsp.sync.getRecords(INSP);
  const conflicts = await fsp.sync.getConflicts();
  const companies = Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name }));
  return { projects, items, companies, conflicts, conflicted: new Set(conflicts.map((c) => c.id)) };
}

const inToday = () => new Date().toISOString().slice(0, 10);
function inLastInspector(set) {
  try {
    if (set !== undefined) { if (set) localStorage.setItem("fsp-last-inspector", set); return set; }
    return localStorage.getItem("fsp-last-inspector") || "";
  } catch (e) { return ""; }
}

async function renderInspectionsScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) {
    main.innerHTML = `<h2>Inspections</h2><div class="card"><h3>Storage isn't available</h3><p class="muted">This browser isn't letting the app save data, so Inspections can't work here.</p></div>`;
    return;
  }
  const hash = /^#\/inspections\/(.+)$/.exec(location.hash);
  if (!hash) return renderInspectionList();
  return renderInspectionForm(hash[1] === "new" ? null : hash[1]);
}

function inRow(m, r) {
  const p = m.projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
  const [kind, label] = m.conflicted.has(r.id) ? ["bad", "Needs decision"] : TO_BADGE[fsp.sync.recordState(r)];
  const sub = [r.data.inspectionDate || "", p ? p.displayNumber : "", r.data.location || ""].filter(Boolean).join(" · ");
  return `<a class="row link-row" href="#/inspections/${escapeHtml(r.id)}" style="color:inherit;text-decoration:none;">
    <div class="grow"><b>${escapeHtml(r.data.title || "Untitled inspection")}</b>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</div>
    <span class="badge ${kind}">${label}</span></a>`;
}

async function renderInspectionList() {
  const main = document.getElementById("main");
  const m = await inLoad();
  const filter = renderInspectionList.filter || "all";
  const shown = m.items
    .filter((r) => filter === "all" || (filter === "none" ? !r.projectId : `${r.companyKey}:${r.projectId}` === filter))
    .sort((a, b) => String(b.data.inspectionDate || "").localeCompare(String(a.data.inspectionDate || "")) || (a.updatedAt < b.updatedAt ? 1 : -1));
  main.innerHTML = `
    <h2>Inspections</h2>
    ${toBanner(m)}
    ${m.companies.length ? "" : `<div class="card"><h3>No project list yet</h3><p class="muted">Inspections are sent to the right company on the desktop. On the desktop, press <b>Write project list</b> (or <b>Sync now</b>), then tap <b>Sync now</b> on this phone's Sync tab.</p></div>`}
    <div class="toolbar">
      <select id="inFilter" aria-label="Project"><option value="all">All inspections</option><option value="none" ${filter === "none" ? "selected" : ""}>No project</option>${m.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select>
      <a class="btn" id="inNew" href="#/inspections/new" ${m.companies.length ? "" : 'aria-disabled="true" style="pointer-events:none;opacity:.5;"'}>New inspection</a>
    </div>
    ${shown.length ? `<div class="card">${shown.map((r) => inRow(m, r)).join("")}</div>` : `<div class="empty-state">No inspections yet.</div>`}`;
  document.getElementById("inFilter").onchange = (ev) => { renderInspectionList.filter = ev.target.value; renderInspectionList(); };
}

async function renderInspectionForm(id) {
  const main = document.getElementById("main");
  const m = await inLoad();
  const r = id ? m.items.find((x) => x.id === id) : null;
  if (id && !r) { main.innerHTML = `${toBackLink("#/inspections", "Inspections")}<div class="card"><h3>Inspection not found</h3><p class="muted">It may have been deleted.</p></div>`; return; }
  if (r && m.conflicted.has(r.id)) {
    main.innerHTML = `${toBackLink("#/inspections", "Inspections")}<div class="card"><h3>Needs your decision</h3><p class="muted">This inspection was changed on both the phone and the desktop. Choose which version to keep before editing it.</p><a class="btn block" href="#/conflicts">Decide now</a></div>`;
    return;
  }
  // A new inspection starts from the previous one: same company, project, location and inspector (all can be changed).
  const latest = !r ? [...m.items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] : null;
  const d = r ? r.data : {};
  const companyKey = r ? r.companyKey : (renderInspectionList.company && m.companies.some((c) => c.key === renderInspectionList.company) ? renderInspectionList.company : (latest && m.companies.some((c) => c.key === latest.companyKey) ? latest.companyKey : (m.companies[0] || {}).key));
  const filterProject = !r ? m.projects.find((p) => p.key === renderInspectionList.filter) : null;
  const projects = m.projects.filter((p) => p.companyKey === companyKey);
  const sameCompany = latest && latest.companyKey === companyKey ? latest : null;
  const selectedProject = r ? r.projectId : filterProject ? filterProject.id : sameCompany && sameCompany.projectId ? sameCompany.projectId : "";
  const prefillLocation = r ? d.location || "" : sameCompany && sameCompany.projectId === selectedProject ? sameCompany.data.location || "" : "";
  const prefillInspector = r ? d.inspectorName || "" : (latest && latest.data.inspectorName) || inLastInspector();
  const uniq = (list) => [...new Set(list.map((x) => String(x || "").trim()).filter(Boolean))];
  const locations = uniq(m.items.filter((x) => x.companyKey === companyKey).map((x) => x.data.location));
  const inspectors = uniq(m.items.map((x) => x.data.inspectorName));
  main.innerHTML = `
    ${toBackLink("#/inspections", "Inspections")}
    <h2>${r ? "Edit inspection" : "New inspection"}</h2>
    <div class="card">
      ${!r && m.companies.length > 1 ? `<label class="field">Company<select id="inCompany">${m.companies.map((c) => `<option value="${escapeHtml(c.key)}" ${c.key === companyKey ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>` : ""}
      <label class="field">Title<input id="inTitle" maxlength="200" value="${escapeHtml(d.title || "")}" placeholder="e.g. Monthly site inspection"></label>
      <label class="field">Project<select id="inProject"><option value="">No project</option>${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedProject ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></label>
      <label class="field">Location<input id="inLocation" list="inLocations" maxlength="200" value="${escapeHtml(prefillLocation)}" placeholder="Site / address"><datalist id="inLocations">${locations.map((x) => `<option value="${escapeHtml(x)}">`).join("")}</datalist></label>
      <label class="field">Inspector<input id="inInspector" list="inInspectors" maxlength="120" value="${escapeHtml(prefillInspector)}"><datalist id="inInspectors">${inspectors.map((x) => `<option value="${escapeHtml(x)}">`).join("")}</datalist></label>
      <label class="field">Date<input id="inDate" type="date" value="${escapeHtml(d.inspectionDate || inToday())}"></label>
      <label class="field">Observations<textarea id="inConclusion" rows="7" placeholder="Findings and recommendations">${escapeHtml(d.conclusion || "")}</textarea></label>
    </div>
    ${r ? `<div class="card" id="inPhotos"></div>` : `<p class="muted">Save the inspection first, then add photos.</p>`}
    <div class="toolbar"><button class="btn" id="inSave">Save</button>${r ? `<button class="btn danger" id="inDelete">Delete</button>` : ""}</div>
    <div id="inResult"></div>`;

  if (r) phMount(document.getElementById("inPhotos"), r, r.data.title);
  const projSel = document.getElementById("inProject");
  if (!r) projSel.onchange = () => {
    const loc = document.getElementById("inLocation");
    const prev = [...m.items].filter((x) => x.companyKey === companyKey && (x.projectId || "") === projSel.value && x.data.location).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (prev && (!loc.value || locations.includes(loc.value))) loc.value = prev.data.location;
  };
  const company = document.getElementById("inCompany");
  if (company) company.onchange = (ev) => { renderInspectionList.company = ev.target.value; renderInspectionForm(null); };
  document.getElementById("inSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("inTitle").value.trim();
    if (!title) { document.getElementById("inResult").innerHTML = resultBox(["Enter a title."], true); return; }
    const inspector = document.getElementById("inInspector").value.trim();
    const data = {
      ...d, title, location: document.getElementById("inLocation").value.trim(), inspectorName: inspector,
      inspectionDate: document.getElementById("inDate").value || inToday(), intro: d.intro || "",
      conclusion: document.getElementById("inConclusion").value,
    };
    const projectId = document.getElementById("inProject").value;
    inLastInspector(inspector);
    if (r) await fsp.sync.saveRecord(r.id, data, { projectId });
    else await fsp.sync.createRecord({ type: INSP, data, companyKey, projectId: projectId || undefined });
    location.hash = "#/inspections";
  });
  const del = document.getElementById("inDelete");
  if (del) del.onclick = () => {
    openModal("Delete inspection?", `<p>“${escapeHtml(d.title || "Untitled")}” will be deleted here and on the desktop.</p>`, async () => {
      await fsp.sync.deleteRecord(r.id);
      closeModal();
      location.hash = "#/inspections";
    }, "Delete");
  };
}
