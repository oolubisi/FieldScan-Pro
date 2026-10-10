// ===== Prospects: temporary project codes made while chasing a job =====
// A prospect is a record that syncs to the desktop, where it waits in Prospects until you convert it into a real project.
// Take-offs, inspections, diary entries and tasks can be filed under it like any project.

const PS_TYPE = "prospect";

function psCode(existing) {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const n = existing.filter((r) => (r.data.code || "").startsWith("PROS-" + ymd)).length + 1;
  return `PROS-${ymd}-${n}`;
}

async function psLoad() {
  const all = coFilter(await fsp.sync.getRecords(PS_TYPE));
  const status = await fsp.sync.getStatus();
  const companies = coCompanies(Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name })));
  return { all, companies, names: Object.fromEntries(companies.map((c) => [c.key, c.name])) };
}

async function renderProspectsScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Prospects</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const m = /^#\/prospects\/([^/]+)$/.exec(location.hash);
  return m ? renderProspectForm(decodeURIComponent(m[1])) : renderProspectList();
}

async function renderProspectList() {
  const main = document.getElementById("main");
  const m = await psLoad();
  const shown = m.all.filter((r) => r.data.status !== "converted").sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  main.innerHTML = `${toBackLink("#/projects", "Projects")}<h2>Prospects</h2>
    <p class="muted">Temporary project codes for jobs you are still chasing. They go to the desktop on sync; convert one there when you win the job.</p>
    <div class="toolbar"><a class="btn" href="#/prospects/new">＋ New prospect</a></div>
    ${shown.length ? shown.map((r) => `<a class="card link-card" href="#/prospects/${encodeURIComponent(r.id)}" style="display:block;color:inherit;text-decoration:none;">
      <h3>${escapeHtml(r.data.code || "")} — ${escapeHtml(r.data.client || "")}</h3>
      <p class="muted" style="margin:0;">${escapeHtml(m.names[r.companyKey] || "")}${r.data.location ? " · " + escapeHtml(r.data.location) : ""}${r.data.status === "lost" ? " · lost" : ""}</p></a>`).join("")
      : `<div class="card"><h3>No prospects</h3><p class="muted">Tap New prospect to get a code you can use in Take-Off and Inspections right away.</p></div>`}`;
}

async function renderProspectForm(id) {
  const main = document.getElementById("main");
  const m = await psLoad();
  const r = id === "new" ? null : m.all.find((x) => x.id === id);
  if (id !== "new" && !r) { main.innerHTML = `${toBackLink("#/prospects", "Prospects")}<div class="card"><h3>Prospect not found</h3></div>`; return; }
  if (r && r.data.status === "converted") { main.innerHTML = `${toBackLink("#/prospects", "Prospects")}<div class="card"><h3>Converted</h3><p class="muted">This is now project ${escapeHtml(r.data.convertedNumber || "")}. Find it under Projects after the next sync.</p></div>`; return; }
  const d = r ? r.data : {};
  const companyKey = r ? r.companyKey : (m.companies[0] || {}).key;
  if (!companyKey) { main.innerHTML = `${toBackLink("#/prospects", "Prospects")}<div class="card"><h3>Sync with the desktop first</h3><p class="muted">The app needs to know your companies before you can create a prospect.</p></div>`; return; }
  main.innerHTML = `${toBackLink("#/prospects", "Prospects")}<h2>${r ? escapeHtml(d.code) : "New prospect"}</h2>
    <div class="card">
      ${r ? "" : `<label class="field">Company<select id="psCompany">${m.companies.map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.name)}</option>`).join("")}</select></label>`}
      <label class="field">Client / prospect name<input id="psClient" maxlength="120" value="${escapeHtml(d.client || "")}"></label>
      <label class="field">Site location<input id="psLocation" maxlength="160" value="${escapeHtml(d.location || "")}"></label>
      <label class="field">Notes<textarea id="psNotes" rows="3" data-dictate>${escapeHtml(d.notes || "")}</textarea></label>
    </div>
    <div class="toolbar"><button class="btn" id="psSave">Save</button>${r ? `<button class="btn secondary" id="psLost">${d.status === "lost" ? "Reopen" : "Mark lost"}</button><button class="btn secondary" id="psDelete">Delete</button>` : ""}</div>
    <div id="psResult"></div>`;
  dtAttach(main);
  const v = (i) => document.getElementById(i).value;
  document.getElementById("psSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const client = v("psClient").trim();
    if (!client) { document.getElementById("psResult").innerHTML = `<div class="notice">Enter the client or prospect name.</div>`; return; }
    const data = { ...d, client, location: v("psLocation").trim(), notes: v("psNotes"), status: d.status || "open" };
    if (r) await fsp.sync.saveRecord(r.id, data);
    else {
      const key = document.getElementById("psCompany").value;
      data.code = psCode(m.all);
      await fsp.sync.createRecord({ type: PS_TYPE, data, companyKey: key });
    }
    location.hash = "#/prospects";
  });
  if (r) {
    document.getElementById("psLost").onclick = async () => {
      await fsp.sync.saveRecord(r.id, { ...d, status: d.status === "lost" ? "open" : "lost" });
      location.hash = "#/prospects";
    };
    document.getElementById("psDelete").onclick = async () => {
      if (!confirm("Delete this prospect and everything filed under it? This also removes it from the desktop.")) return;
      for (const t of ["takeoff", "takeoff-group", "inspection", "diary", "task", "task-group"]) {
        for (const x of await fsp.sync.getRecords(t)) if (x.projectId === r.id && x.companyKey === r.companyKey) await fsp.sync.deleteRecord(x.id);
      }
      await fsp.sync.deleteRecord(r.id);
      location.hash = "#/prospects";
    };
  }
}
