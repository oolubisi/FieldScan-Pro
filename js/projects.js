// ===== Projects tab (phone) =====
// A project screen with the same sub-tabs as the desktop: Progress, Snags, Photos, plus the project's
// Tasks, Inspections, Take-off and Diary entries.
//   "progress"  data: { title, trade, percent, comment, date, parentId }   (parentId = a sub-task of another log)
//   "snag"      data: { title, notes, assigned, dateLogged, status: "Open"|"Completed", dateCompleted }
// A photo's Before/During/After tag is stored on its parent record: parent.data.photoStages[photoId].
// Fields the phone doesn't show are carried along untouched.

const PJ_PROGRESS = "progress";
const PJ_SNAG = "snag";
const PJ_STAGES = ["Before", "During", "After"];
const PJ_TABS = [["progress", "Progress"], ["snags", "Snags"], ["photos", "Photos"], ["tasks", "Tasks"], ["inspections", "Inspections"], ["takeoff", "Take-off"], ["diary", "Diary"]];
const PJ_PHOTO_PARENTS = ["progress", "snag", "task", "inspection", "diary", "takeoff"];

const pjToday = () => new Date().toISOString().slice(0, 10);
const pjClamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/** Sets (or clears) one photo's stage on its parent record. */
async function pjSetStage(parentId, photoId, stage) {
  for (const type of PJ_PHOTO_PARENTS) {
    const rec = (await fsp.sync.getRecords(type)).find((r) => r.id === parentId);
    if (!rec) continue;
    const stages = { ...(rec.data.photoStages || {}) };
    if (stage) stages[photoId] = stage; else delete stages[photoId];
    const data = { ...rec.data };
    if (Object.keys(stages).length) data.photoStages = stages; else delete data.photoStages;
    await fsp.sync.saveRecord(rec.id, data);
    return;
  }
}

async function pjLoad() {
  const projects = coFilter(await fsp.sync.listProjects({ excludeProspects: true }));
  const conflicts = await fsp.sync.getConflicts();
  return { projects, conflicts };
}

async function renderProjectsScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Projects</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const m = /^#\/projects\/([^/]+)(?:\/([a-z]+))?(?:\/(.+))?$/.exec(location.hash);
  return m ? renderProjectDetail(decodeURIComponent(m[1]), m[2] || "progress", m[3]) : renderProjectList();
}

async function renderProjectList() {
  const main = document.getElementById("main");
  const m = await pjLoad();
  const counts = {};
  for (const type of ["progress", "snag"]) for (const r of coFilter(await fsp.sync.getRecords(type))) {
    const k = `${r.companyKey}:${r.projectId}`; counts[k] = counts[k] || { progress: 0, snag: 0 }; counts[k][type]++;
  }
  main.innerHTML = `<h2>Projects</h2>${toBanner(m)}
    <div class="toolbar"><a class="btn secondary" href="#/prospects">Prospects</a><a class="btn" href="#/prospects/new">＋ New prospect</a></div>
    ${m.projects.length ? m.projects.map((p) => {
      const c = counts[p.key] || { progress: 0, snag: 0 };
      return `<a class="card link-card" href="#/projects/${encodeURIComponent(p.key)}" style="display:block;color:inherit;text-decoration:none;">
        <h3>${escapeHtml(p.displayNumber + " — " + (p.clientName || ""))}</h3>
        <p class="muted" style="margin:0;">${escapeHtml(p.companyName || "")}${p.siteLocation ? " · " + escapeHtml(p.siteLocation) : ""}</p>
        <p class="muted" style="margin:4px 0 0;">${c.progress} progress log${c.progress === 1 ? "" : "s"} · ${c.snag} snag${c.snag === 1 ? "" : "s"}</p></a>`;
    }).join("") : `<div class="card"><h3>No projects yet</h3><p class="muted">Projects arrive from the desktop app through Sync.</p></div>`}`;
}

async function renderProjectDetail(key, tab, sub) {
  const main = document.getElementById("main");
  const m = await pjLoad();
  const p = m.projects.find((x) => x.key === key);
  if (!p) { main.innerHTML = `${toBackLink("#/projects", "Projects")}<div class="card"><h3>Project not found</h3><p class="muted">It may not have synced yet.</p></div>`; return; }
  if (sub && (tab === "progress" || tab === "snags")) return tab === "progress" ? renderProgressEdit(p, sub) : renderSnagEdit(p, sub);
  const base = "#/projects/" + encodeURIComponent(key);
  main.innerHTML = `${toBackLink("#/projects", "Projects")}
    <h2>${escapeHtml(p.displayNumber + " — " + (p.clientName || ""))}</h2>
    <div class="pj-tabs">${PJ_TABS.map(([id, label]) => `<a href="${base}/${id}" class="${id === tab ? "active" : ""}" data-tab="${id}">${label}</a>`).join("")}</div>
    <div id="pjBody"></div>`;
  const body = document.getElementById("pjBody");
  const mine = (r) => r.companyKey === p.companyKey && r.projectId === p.id;
  if (tab === "progress") return pjProgressTab(body, p, base, mine);
  if (tab === "snags") return pjSnagsTab(body, p, base, mine);
  if (tab === "photos") return pjPhotosTab(body, p, mine);
  const linked = { tasks: ["task", (r) => r.data.title || "Untitled", (r) => r.data.status || "Open", (r) => "#/tasks/" + r.id, "tasks"],
    inspections: ["inspection", (r) => r.data.title || "Untitled", (r) => r.data.inspectionDate || "", (r) => "#/inspections/" + r.id, "inspections"],
    takeoff: ["takeoff", (r) => r.data.name || r.data.title || r.data.description || "Take-off", (r) => "", (r) => "#/takeoff/" + r.data.groupId + "/" + r.id, "take-off cards"],
    diary: ["diary", (r) => r.data.date || "Entry", (r) => r.data.weather || "", (r) => "#/diary/" + r.id, "diary entries"] }[tab];
  if (!linked) return;
  const rows = (await fsp.sync.getRecords(linked[0])).filter(mine);
  body.innerHTML = rows.length ? `<div class="card feed">${rows.map((r) => `<a class="row link-row" href="${escapeHtml(linked[3](r))}" style="color:inherit;text-decoration:none;"><div class="grow"><strong>${escapeHtml(linked[1](r))}</strong><div class="muted">${escapeHtml(linked[2](r))}</div></div></a>`).join("")}</div>`
    : `<div class="card"><p class="muted">No ${linked[4]} for this project yet.</p></div>`;
}

// ---------- Progress ----------

const pjLogPct = (log, subs) => (subs.length ? Math.round(subs.reduce((s, x) => s + pjClamp(x.data.percent), 0) / subs.length) : pjClamp(log.data.percent));

async function pjProgressTab(body, p, base, mine) {
  const all = (await fsp.sync.getRecords(PJ_PROGRESS)).filter(mine);
  const tops = all.filter((r) => !r.data.parentId).sort((a, b) => String(b.data.date || "").localeCompare(String(a.data.date || "")));
  const subsOf = (id) => all.filter((r) => r.data.parentId === id);
  const overall = tops.length ? Math.round(tops.reduce((s, r) => s + pjLogPct(r, subsOf(r.id)), 0) / tops.length) : 0;
  body.innerHTML = `<div class="toolbar"><a class="btn" id="pjNewProgress" href="${base}/progress/new">Add progress</a><span class="muted">Overall ${overall}%</span></div>
    ${tops.length ? `<div class="card feed">${tops.map((r) => { const s = subsOf(r.id); return `<a class="row link-row" href="${base}/progress/${escapeHtml(r.id)}" style="color:inherit;text-decoration:none;"><div class="grow"><strong>${escapeHtml(r.data.title || "Untitled")}</strong>
      <div class="muted">${escapeHtml([r.data.trade, r.data.date, s.length ? s.length + " sub-task" + (s.length === 1 ? "" : "s") : ""].filter(Boolean).join(" · "))}</div></div><strong>${pjLogPct(r, s)}%</strong></a>`; }).join("")}</div>`
      : `<div class="card"><p class="muted">No progress logged yet.</p></div>`}`;
}

async function renderProgressEdit(p, id) {
  const main = document.getElementById("main");
  const base = "#/projects/" + encodeURIComponent(p.key);
  const back = toBackLink(base + "/progress", "Progress");
  const isNew = id === "new";
  const rec = isNew ? null : (await fsp.sync.getRecords(PJ_PROGRESS)).find((r) => r.id === id);
  if (!isNew && !rec) { main.innerHTML = `${back}<div class="card"><h3>Not found</h3><p class="muted">It may have been deleted.</p></div>`; return; }
  const d = rec ? rec.data : {};
  const subs = rec ? (await fsp.sync.getRecords(PJ_PROGRESS)).filter((r) => r.data.parentId === rec.id) : [];
  const isSub = !!d.parentId;
  main.innerHTML = `${back}<h2>${isNew ? "Add progress" : isSub ? "Edit sub-task" : "Edit progress"}</h2>
    <div class="card">
      <label class="field">Title<input id="pgTitle" maxlength="300" data-dictate value="${escapeHtml(d.title || "")}"></label>
      ${isSub ? "" : `<label class="field">Trade<input id="pgTrade" maxlength="100" value="${escapeHtml(d.trade || "")}"></label>`}
      <label class="field">Percent complete${subs.length ? " (average of sub-tasks)" : ""}<input id="pgPercent" type="number" min="0" max="100" inputmode="numeric" value="${subs.length ? pjLogPct(rec, subs) : pjClamp(d.percent)}" ${subs.length ? "disabled" : ""}></label>
      <label class="field">Date<input id="pgDate" type="date" value="${escapeHtml(d.date || pjToday())}"></label>
      <label class="field">Comment<textarea id="pgComment" rows="3" data-dictate>${escapeHtml(d.comment || "")}</textarea></label>
    </div>
    ${rec ? `<div class="card" id="pgPhotos"></div>` : `<p class="muted">Save first, then you can add photos and tag them Before, During or After.</p>`}
    ${rec && !isSub ? `<div class="card"><h3>Sub-tasks</h3>${subs.map((s) => `<a class="row link-row" href="${base}/progress/${escapeHtml(s.id)}" style="color:inherit;text-decoration:none;"><div class="grow">${escapeHtml(s.data.title || "Untitled")}</div><strong>${pjClamp(s.data.percent)}%</strong></a>`).join("") || `<p class="muted">None.</p>`}
      <button class="btn secondary" id="pgAddSub" type="button">Add sub-task</button></div>` : ""}
    <div class="toolbar"><button class="btn" id="pgSave">Save</button>${rec ? `<button class="btn danger" id="pgDelete">Delete</button>` : ""}</div><div id="pgResult"></div>`;
  if (typeof dtAttach === "function") dtAttach(main);
  if (rec) phMount(document.getElementById("pgPhotos"), rec, d.title, { stages: true });
  const exit = () => { location.hash = isSub ? base + "/progress/" + d.parentId : base + "/progress"; };
  document.getElementById("pgSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("pgTitle").value.trim();
    if (!title) { document.getElementById("pgResult").innerHTML = resultBox(["Enter a title."], true); return; }
    const next = { ...d, title, comment: document.getElementById("pgComment").value, date: document.getElementById("pgDate").value };
    const trade = document.getElementById("pgTrade"); if (trade) next.trade = trade.value.trim();
    if (!subs.length) next.percent = pjClamp(document.getElementById("pgPercent").value);
    if (rec) { await fsp.sync.saveRecord(rec.id, next); exit(); }
    else { const c = await fsp.sync.createRecord({ type: PJ_PROGRESS, companyKey: p.companyKey, projectId: p.id, data: next }); location.hash = base + "/progress/" + c.id; }
  });
  const del = document.getElementById("pgDelete");
  if (del) del.onclick = () => openModal("Delete progress?", `<p>“${escapeHtml(d.title || "Untitled")}”${subs.length ? " and its sub-tasks" : ""} will be deleted here and on the desktop.</p>`, async () => {
    for (const s of subs) await fsp.sync.deleteRecord(s.id);
    await fsp.sync.deleteRecord(rec.id); closeModal(); exit();
  }, "Delete");
  const add = document.getElementById("pgAddSub");
  if (add) add.onclick = () => openModal("Add sub-task", `<label class="field">Title<input id="subTitle" maxlength="300"></label><label class="field">Percent<input id="subPct" type="number" min="0" max="100" value="0"></label>`, async () => {
    const title = document.getElementById("subTitle").value.trim();
    if (!title) return;
    await fsp.sync.createRecord({ type: PJ_PROGRESS, companyKey: p.companyKey, projectId: p.id, data: { title, percent: pjClamp(document.getElementById("subPct").value), date: pjToday(), parentId: rec.id } });
    closeModal(); renderProgressEdit(p, id);
  });
}

// ---------- Snags ----------

async function pjSnagsTab(body, p, base, mine) {
  const all = (await fsp.sync.getRecords(PJ_SNAG)).filter(mine).sort((a, b) => String(b.data.dateLogged || "").localeCompare(String(a.data.dateLogged || "")));
  const open = all.filter((r) => r.data.status !== "Completed").length;
  body.innerHTML = `<div class="toolbar"><a class="btn" id="pjNewSnag" href="${base}/snags/new">Add snag</a><span class="muted">${open} open · ${all.length - open} completed</span></div>
    ${all.length ? `<div class="card feed">${all.map((r) => `<a class="row link-row" href="${base}/snags/${escapeHtml(r.id)}" style="color:inherit;text-decoration:none;"><div class="grow"><strong>${escapeHtml(r.data.title || "Untitled")}</strong>
      <div class="muted">${escapeHtml([r.data.assigned, r.data.dateLogged].filter(Boolean).join(" · "))}</div></div><span class="muted">${r.data.status === "Completed" ? "Completed" : "Open"}</span></a>`).join("")}</div>`
      : `<div class="card"><p class="muted">No snags logged.</p></div>`}
    ${all.length ? `<div class="toolbar"><button class="btn secondary" id="pjSnagShare">Share snag report (PDF)</button><button class="btn secondary" id="pjSnagPrint">Print</button></div>` : ""}`;
  const withPhotos = async () => [all.slice().sort((a, b) => String(a.data.dateLogged || "").localeCompare(String(b.data.dateLogged || ""))), await fsp.sync.getRecords("photo")];
  const sh = document.getElementById("pjSnagShare");
  if (sh) sh.onclick = async () => { const [list, photos] = await withPhotos(); await rpShareSnags(p, list, photos); };
  const pr = document.getElementById("pjSnagPrint");
  if (pr) pr.onclick = async () => { const [list, photos] = await withPhotos(); rpPrintSnags(p, list, photos); };
}

async function renderSnagEdit(p, id) {
  const main = document.getElementById("main");
  const base = "#/projects/" + encodeURIComponent(p.key);
  const back = toBackLink(base + "/snags", "Snags");
  const isNew = id === "new";
  const rec = isNew ? null : (await fsp.sync.getRecords(PJ_SNAG)).find((r) => r.id === id);
  if (!isNew && !rec) { main.innerHTML = `${back}<div class="card"><h3>Not found</h3><p class="muted">It may have been deleted.</p></div>`; return; }
  const d = rec ? rec.data : {};
  main.innerHTML = `${back}<h2>${isNew ? "Add snag" : "Edit snag"}</h2>
    <div class="card">
      <label class="field">Title<input id="sgTitle" maxlength="300" data-dictate value="${escapeHtml(d.title || "")}"></label>
      <label class="field">Notes<textarea id="sgNotes" rows="3" data-dictate>${escapeHtml(d.notes || "")}</textarea></label>
      <label class="field">Assigned to<input id="sgAssigned" maxlength="100" value="${escapeHtml(d.assigned || "")}"></label>
      <label class="field">Date logged<input id="sgDate" type="date" value="${escapeHtml(d.dateLogged || pjToday())}"></label>
      <label class="field"><input id="sgDone" type="checkbox" ${d.status === "Completed" ? "checked" : ""}> Completed</label>
    </div>
    ${rec ? `<div class="card" id="sgPhotos"></div>` : `<p class="muted">Save first, then you can add photos and tag them Before, During or After.</p>`}
    <div class="toolbar"><button class="btn" id="sgSave">Save</button>${rec ? `<button class="btn danger" id="sgDelete">Delete</button>` : ""}</div><div id="sgResult"></div>`;
  if (typeof dtAttach === "function") dtAttach(main);
  if (rec) phMount(document.getElementById("sgPhotos"), rec, d.title, { stages: true });
  document.getElementById("sgSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("sgTitle").value.trim();
    if (!title) { document.getElementById("sgResult").innerHTML = resultBox(["Enter a title."], true); return; }
    const done = document.getElementById("sgDone").checked;
    const next = { ...d, title, notes: document.getElementById("sgNotes").value, assigned: document.getElementById("sgAssigned").value.trim(),
      dateLogged: document.getElementById("sgDate").value, status: done ? "Completed" : "Open" };
    if (done) next.dateCompleted = d.dateCompleted || pjToday(); else delete next.dateCompleted;
    if (rec) { await fsp.sync.saveRecord(rec.id, next); location.hash = base + "/snags"; }
    else { const c = await fsp.sync.createRecord({ type: PJ_SNAG, companyKey: p.companyKey, projectId: p.id, data: next }); location.hash = base + "/snags/" + c.id; }
  });
  const del = document.getElementById("sgDelete");
  if (del) del.onclick = () => openModal("Delete snag?", `<p>“${escapeHtml(d.title || "Untitled")}” will be deleted here and on the desktop.</p>`, async () => {
    await fsp.sync.deleteRecord(rec.id); closeModal(); location.hash = base + "/snags";
  }, "Delete");
}

// ---------- Photos ----------

async function pjPhotosTab(body, p, mine) {
  const parents = [];
  for (const type of PJ_PHOTO_PARENTS) for (const r of (await fsp.sync.getRecords(type)).filter(mine)) parents.push(r);
  const byId = new Map(parents.map((r) => [r.id, r]));
  const photos = (await fsp.sync.getRecords("photo")).filter((r) => byId.has(r.data.parentId))
    .map((ph) => ({ ph, parent: byId.get(ph.data.parentId), stage: (byId.get(ph.data.parentId).data.photoStages || {})[ph.id] || "" }))
    .sort((a, b) => String(b.ph.data.takenAt || "").localeCompare(String(a.ph.data.takenAt || "")));
  const filter = pjPhotosTab.filter || "all";
  const shown = photos.filter((x) => filter === "all" || x.stage === filter);
  body.innerHTML = `<div class="toolbar"><select id="pjStage" aria-label="Stage"><option value="all">All stages (${photos.length})</option>${PJ_STAGES.map((s) => `<option value="${s}" ${filter === s ? "selected" : ""}>${s} (${photos.filter((x) => x.stage === s).length})</option>`).join("")}</select></div>
    ${shown.length ? `<div class="ph-grid">${shown.map((x) => `<div class="ph-item" data-id="${escapeHtml(x.ph.id)}"><img src="data:${escapeHtml(x.ph.data.mime)};base64,${x.ph.data.b64}" alt="Photo">
      <div class="ph-cap">${escapeHtml(x.stage || "Untagged")} · ${escapeHtml(x.parent.data.title || x.parent.data.date || x.parent.type)}</div></div>`).join("")}</div>`
      : `<div class="card"><p class="muted">No photos here. Add them from a progress log or snag.</p></div>`}`;
  document.getElementById("pjStage").onchange = (ev) => { pjPhotosTab.filter = ev.target.value; pjPhotosTab(body, p, mine); };
  body.querySelectorAll(".ph-item img").forEach((img) => {
    img.onclick = async () => {
      const pid = img.closest(".ph-item").dataset.id;
      const x = photos.find((y) => y.ph.id === pid);
      const list = await phList(x.parent);
      phOpenViewer(x.parent, x.parent.data.title || "photo", Math.max(0, list.findIndex((r) => r.id === pid)), () => pjPhotosTab(body, p, mine));
    };
  });
}
