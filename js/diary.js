// ===== Site diary =====
//   "diary"  data: { date, weather, labour, deliveries, instructions, progress, notes }
// One entry per day per project is the habit, but nothing forces it. Photos attach to an entry like any other record.

const DIARY = "diary";
const DY_WEATHER = ["Sunny", "Cloudy", "Light rain", "Heavy rain", "Windy", "Hot and humid"];

async function dyLoad() {
  const status = await fsp.sync.getStatus();
  const projects = coFilter(await fsp.sync.listProjects());
  const items = coFilter(await fsp.sync.getRecords(DIARY));
  const conflicts = await fsp.sync.getConflicts();
  const companies = coCompanies(Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name })));
  return { projects, items, companies, conflicts, conflicted: new Set(conflicts.map((c) => c.id)) };
}

const dyToday = () => (typeof tsToday === "function" ? tsToday() : new Date().toISOString().slice(0, 10));

async function renderDiaryScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Site diary</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const hash = /^#\/diary\/(.+)$/.exec(location.hash);
  return hash ? renderDiaryForm(hash[1] === "new" ? null : hash[1]) : renderDiaryList();
}

async function renderDiaryList() {
  const main = document.getElementById("main");
  const m = await dyLoad();
  const filter = renderDiaryList.filter || "all";
  const shown = m.items.filter((r) => filter === "all" || (filter === "none" ? !r.projectId : `${r.companyKey}:${r.projectId}` === filter))
    .sort((a, b) => String(b.data.date || "").localeCompare(String(a.data.date || "")) || (a.updatedAt < b.updatedAt ? 1 : -1));
  main.innerHTML = `
    <h2>Site diary</h2>
    ${toBanner(m)}
    <div class="toolbar">
      <select id="dyFilter" aria-label="Project"><option value="all">All projects</option><option value="none" ${filter === "none" ? "selected" : ""}>No project</option>${m.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select>
      <a class="btn" href="#/diary/new" ${m.companies.length ? "" : 'aria-disabled="true" style="pointer-events:none;opacity:.5;"'}>New entry</a>
    </div>
    ${shown.length ? `<div class="card feed">${shown.map((r) => {
      const p = m.projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
      const [kind, label] = m.conflicted.has(r.id) ? ["bad", "Needs decision"] : TO_BADGE[fsp.sync.recordState(r)];
      return `<a class="row" href="#/diary/${escapeHtml(r.id)}" style="color:inherit;text-decoration:none;"><div class="ico" style="--c:#0891b2">📒</div><div class="grow"><b>${escapeHtml(r.data.date || "No date")}</b>${r.data.weather ? ` <span class="muted">· ${escapeHtml(r.data.weather)}</span>` : ""}<div class="sub">${escapeHtml([p ? p.displayNumber : "", String(r.data.progress || r.data.notes || "").slice(0, 70)].filter(Boolean).join(" · "))}</div></div><span class="badge ${kind}">${label}</span></a>`;
    }).join("")}</div>` : `<div class="empty-state">No diary entries${filter === "all" ? " yet" : " for this project"}.</div>`}
    ${shown.length ? `<button class="btn secondary block" id="dyWeek">Weekly report (last 7 days, print / save)</button><button class="btn secondary block" id="dyWeekShare" style="margin-top:8px;">Share weekly report (PDF)</button>` : ""}`;
  document.getElementById("dyFilter").onchange = (ev) => { renderDiaryList.filter = ev.target.value; renderDiaryList(); };
  const lastWeek = () => {
    const from = new Date(); from.setDate(from.getDate() - 6);
    const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
    return shown.filter((r) => (r.data.date || "") >= f).sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)));
  };
  const wk = document.getElementById("dyWeek");
  if (wk) wk.onclick = async () => {
    const week = lastWeek();
    if (!week.length) { showStatus("No entries in the last 7 days.", true); return; }
    rpPrintDiary(week, m.projects, await fsp.sync.getRecords("photo"));
  };
  const wks = document.getElementById("dyWeekShare");
  if (wks) wks.onclick = async () => {
    const week = lastWeek();
    if (!week.length) { showStatus("No entries in the last 7 days.", true); return; }
    await rpShareDiary(week, m.projects, await fsp.sync.getRecords("photo"));
  };
}

async function renderDiaryForm(id) {
  const main = document.getElementById("main");
  const m = await dyLoad();
  const r = id ? m.items.find((x) => x.id === id) : null;
  if (id && !r) { main.innerHTML = `${toBackLink("#/diary", "Site diary")}<div class="card"><h3>Entry not found</h3></div>`; return; }
  if (r && m.conflicted.has(r.id)) { main.innerHTML = `${toBackLink("#/diary", "Site diary")}<div class="card"><h3>Needs your decision</h3><p class="muted">This entry was changed on both the phone and the desktop.</p><a class="btn block" href="#/conflicts">Decide now</a></div>`; return; }
  const latest = !r ? [...m.items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] : null;
  const d = r ? r.data : {};
  const companyKey = r ? r.companyKey : (latest && m.companies.some((c) => c.key === latest.companyKey) ? latest.companyKey : (m.companies[0] || {}).key);
  const projects = m.projects.filter((p) => p.companyKey === companyKey);
  const selected = r ? r.projectId : (latest && latest.companyKey === companyKey ? latest.projectId : "") || "";
  const area = (idn, label, val, ph, rows) => `<label class="field">${label}<textarea id="${idn}" rows="${rows || 3}" data-dictate placeholder="${ph}">${escapeHtml(val || "")}</textarea></label>`;
  main.innerHTML = `
    ${toBackLink("#/diary", "Site diary")}
    <h2>${r ? "Edit entry" : "New diary entry"}</h2>
    <div class="card">
      <label class="field">Date<input id="dyDate" type="date" value="${escapeHtml(d.date || dyToday())}"></label>
      <label class="field">Project<select id="dyProject"><option value="">No project</option>${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></label>
      <label class="field">Weather<input id="dyWeather" list="dyWeatherList" maxlength="60" value="${escapeHtml(d.weather || "")}"><datalist id="dyWeatherList">${DY_WEATHER.map((w) => `<option value="${w}">`).join("")}</datalist></label>
      ${area("dyLabour", "Labour on site", d.labour, "e.g. 4 bricklayers, 6 labourers, 2 carpenters")}
      ${area("dyDeliveries", "Deliveries", d.deliveries, "e.g. 200 bags cement from supplier")}
      ${area("dyInstructions", "Instructions received", d.instructions, "From the architect, engineer or client")}
      ${area("dyProgress", "Progress today", d.progress, "What was done", 4)}
      ${area("dyNotes", "Other notes", d.notes, "Delays, visitors, safety, anything else")}
    </div>
    ${r ? `<div class="card" id="dyPhotos"></div>` : `<p class="muted">Save the entry first, then add photos.</p>`}
    <div class="toolbar"><button class="btn" id="dySave">Save</button>${r ? `<button class="btn secondary" id="dyReport">Report (print)</button><button class="btn secondary" id="dyShare">Share PDF</button><button class="btn danger" id="dyDelete">Delete</button>` : ""}</div>
    <div id="dyResult"></div>`;
  dtAttach(main);
  if (r) phMount(document.getElementById("dyPhotos"), r, `Diary ${d.date || ""}`.trim());
  document.getElementById("dySave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const v = (i) => document.getElementById(i).value;
    const data = { ...d, date: v("dyDate") || dyToday(), weather: v("dyWeather").trim(), labour: v("dyLabour"), deliveries: v("dyDeliveries"), instructions: v("dyInstructions"), progress: v("dyProgress"), notes: v("dyNotes") };
    const projectId = v("dyProject");
    if (r) await fsp.sync.saveRecord(r.id, data, { projectId });
    else await fsp.sync.createRecord({ type: DIARY, data, companyKey, projectId: projectId || undefined });
    location.hash = "#/diary";
  });
  const rep = document.getElementById("dyReport");
  if (rep) rep.onclick = async () => rpPrintDiary([r], m.projects, await fsp.sync.getRecords("photo"));
  const shr = document.getElementById("dyShare");
  if (shr) shr.onclick = async () => rpShareDiary([r], m.projects, await fsp.sync.getRecords("photo"));
  const del = document.getElementById("dyDelete");
  if (del) del.onclick = () => openModal("Delete entry?", `<p>The entry for ${escapeHtml(d.date || "this day")} will be deleted here and on the desktop.</p>`, async () => { await fsp.sync.deleteRecord(r.id); closeModal(); location.hash = "#/diary"; }, "Delete");
}
