// ===== Photos: every photo in the current company, newest first (the Home "Photos" tile opens this) =====

const GL_PARENTS = ["progress", "snag", "task", "inspection", "diary", "takeoff", "expense"];
const GL_KIND = { progress: "Progress", snag: "Snag", task: "Task", inspection: "Inspection", diary: "Diary", takeoff: "Take-off", expense: "Receipt" };

async function renderPhotosScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Photos</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const projects = coFilter(await fsp.sync.listProjects());
  const parents = [];
  for (const type of GL_PARENTS) for (const r of coFilter(await fsp.sync.getRecords(type))) if (!pjGone(projects, r)) parents.push(r);
  const byId = new Map(parents.map((r) => [r.id, r]));
  const all = (await fsp.sync.getRecords("photo")).filter((r) => byId.has(r.data.parentId))
    .sort((a, b) => String(b.data.takenAt || "").localeCompare(String(a.data.takenAt || "")));
  const filter = renderPhotosScreen.filter || "all";
  const pOf = (ph) => byId.get(ph.data.parentId);
  const shown = all.filter((ph) => filter === "all" || (filter === "none" ? !pOf(ph).projectId : `${pOf(ph).companyKey}:${pOf(ph).projectId}` === filter));
  const label = (par) => par.data.title || par.data.name || par.data.payee || par.data.date || GL_KIND[par.type] || "Photo";
  main.innerHTML = `<h2>Photos</h2>
    <div class="toolbar"><select id="glFilter" aria-label="Project"><option value="all">All photos (${all.length})</option><option value="none" ${filter === "none" ? "selected" : ""}>No project</option>${pjLive(projects, null).map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></div>
    ${shown.length ? `<div class="ph-grid">${shown.map((ph) => { const par = pOf(ph); return `<div class="ph-item" data-id="${escapeHtml(ph.id)}"><img src="data:${escapeHtml(ph.data.mime)};base64,${ph.data.b64}" alt="Photo">
      <div class="ph-cap">${escapeHtml(GL_KIND[par.type] || "")} · ${escapeHtml(label(par))}</div></div>`; }).join("")}</div>
      <p class="muted" style="font-size:12px;">Tap a photo to view, rotate or delete it. Add photos from a task, inspection, take-off, diary entry or expense.</p>`
      : `<div class="card empty-state"><h3>No photos yet</h3><p class="muted">Photos you take on a task, inspection, take-off, diary entry or expense show up here.</p></div>`}`;
  document.getElementById("glFilter").onchange = (ev) => { renderPhotosScreen.filter = ev.target.value; renderPhotosScreen(); };
  main.querySelectorAll(".ph-item img").forEach((img) => {
    img.onclick = async () => {
      const id = img.closest(".ph-item").dataset.id;
      const ph = shown.find((x) => x.id === id), par = pOf(ph);
      const list = await phList(par);
      phOpenViewer(par, label(par), Math.max(0, list.findIndex((r) => r.id === id)), () => renderPhotosScreen());
    };
  });
}
