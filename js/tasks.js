// ===== Tasks on the phone =====
//   "task-group"  data: { name }
//   "task"        data: { title, notes, status: "Open" | "Done", groupId, sortOrder }
// A task always belongs to a company (so the right desktop file receives it); the project is optional.
// Groups are created and renamed on the desktop; the phone shows them and can put a task in one.
// Fields the phone doesn't show are carried along untouched.

const TASK = "task";
const TASK_GROUP = "task-group";

async function tsLoad() {
  const status = await fsp.sync.getStatus();
  const projects = await fsp.sync.listProjects();
  const groups = await fsp.sync.getRecords(TASK_GROUP);
  const tasks = await fsp.sync.getRecords(TASK);
  const conflicts = await fsp.sync.getConflicts();
  const companies = Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name }));
  return { projects, groups, tasks, companies, conflicts, conflicted: new Set(conflicts.map((c) => c.id)) };
}

const tsOrder = (t) => Number(t.data.sortOrder) || 0;
const tsProject = (m, t) => m.projects.find((p) => p.id === t.projectId && p.companyKey === t.companyKey);

/** "a; b ;;c" -> ["a","b","c"] */
function tsSplitTitles(raw) {
  return String(raw || "").split(";").map((s) => s.trim()).filter(Boolean);
}

async function renderTasksScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) {
    main.innerHTML = `<h2>Tasks</h2><div class="card"><h3>Storage isn't available</h3><p class="muted">This browser isn't letting the app save data, so Tasks can't work here.</p></div>`;
    return;
  }
  const id = /^#\/tasks\/(.+)$/.exec(location.hash);
  return id ? renderTaskEdit(id[1]) : renderTaskList();
}

function tsRow(m, t) {
  const done = t.data.status === "Done";
  const p = tsProject(m, t);
  const g = t.data.groupId ? m.groups.find((x) => x.id === t.data.groupId) : null;
  const [kind, label] = m.conflicted.has(t.id) ? ["bad", "Needs decision"] : TO_BADGE[fsp.sync.recordState(t)];
  const sub = [p ? p.displayNumber : "", g ? g.data.name : ""].filter(Boolean).join(" · ");
  return `<div class="row task-row" data-id="${escapeHtml(t.id)}">
    <button class="btn ${done ? "" : "secondary"} small ts-toggle" type="button" aria-label="${done ? "Reopen" : "Mark done"}" ${m.conflicted.has(t.id) ? "disabled" : ""}>${done ? "✓" : "○"}</button>
    <a class="grow ts-open" href="#/tasks/${escapeHtml(t.id)}" style="color:inherit;text-decoration:none;">
      <b style="${done ? "text-decoration:line-through;" : ""}">${escapeHtml(t.data.title || "Untitled")}</b>
      ${t.data.notes ? `<div class="sub">${escapeHtml(t.data.notes.slice(0, 80))}</div>` : ""}
      ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</a>
    <span class="badge ${kind}">${label}</span></div>`;
}

async function renderTaskList() {
  const main = document.getElementById("main");
  const m = await tsLoad();
  const filter = renderTaskList.filter || "all";
  const lastCompany = renderTaskList.company && m.companies.some((c) => c.key === renderTaskList.company) ? renderTaskList.company : (m.companies[0] || {}).key;
  const shown = m.tasks.filter((t) => filter === "all" || (filter === "none" ? !t.projectId : `${t.companyKey}:${t.projectId}` === filter));
  const open = shown.filter((t) => t.data.status !== "Done").sort((a, b) => tsOrder(b) - tsOrder(a));
  const done = shown.filter((t) => t.data.status === "Done").sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const groupsWithOpen = m.groups.filter((g) => open.some((t) => t.data.groupId === g.id));
  const ungrouped = open.filter((t) => !t.data.groupId || !m.groups.some((g) => g.id === t.data.groupId));

  main.innerHTML = `
    <h2>Tasks</h2>
    ${toBanner(m)}
    ${m.companies.length ? "" : `<div class="card"><h3>No project list yet</h3><p class="muted">Tasks are sent to the right company on the desktop. On the desktop, press <b>Write project list</b> (or <b>Sync now</b>), then tap <b>Sync now</b> on this phone's Sync tab.</p></div>`}
    <div class="card">
      <label class="field">Add task<input id="tsNew" maxlength="300" placeholder="e.g. Order cement; Call surveyor"></label>
      ${m.companies.length > 1 ? `<label class="field">Company<select id="tsCompany">${m.companies.map((c) => `<option value="${escapeHtml(c.key)}" ${c.key === lastCompany ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>` : ""}
      <button class="btn block" id="tsAdd" style="margin-top:10px;" ${m.companies.length ? "" : "disabled"}>Add</button>
    </div>
    <div class="toolbar"><select id="tsFilter" aria-label="Project"><option value="all">All tasks</option><option value="none" ${filter === "none" ? "selected" : ""}>No project</option>${m.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></div>
    ${groupsWithOpen.map((g) => `<div class="card"><h3>${escapeHtml(g.data.name || "Untitled group")}</h3>${open.filter((t) => t.data.groupId === g.id).map((t) => tsRow(m, t)).join("")}</div>`).join("")}
    ${ungrouped.length ? `<div class="card">${ungrouped.map((t) => tsRow(m, t)).join("")}</div>` : (groupsWithOpen.length ? "" : `<div class="empty-state">${shown.length ? "Nothing open. Well done." : "No tasks yet."}</div>`)}
    ${done.length ? `<details class="card"><summary><b>Done (${done.length})</b></summary>${done.map((t) => tsRow(m, t)).join("")}</details>` : ""}`;

  document.getElementById("tsFilter").onchange = (ev) => { renderTaskList.filter = ev.target.value; renderTaskList(); };
  const company = document.getElementById("tsCompany");
  if (company) company.onchange = (ev) => { renderTaskList.company = ev.target.value; };
  document.getElementById("tsAdd").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const titles = tsSplitTitles(document.getElementById("tsNew").value);
    if (!titles.length) { showStatus("Type a task first.", true); return; }
    const companyKey = company ? company.value : lastCompany;
    const project = m.projects.find((p) => p.key === filter);
    const base = Date.now();
    for (let i = 0; i < titles.length; i++) {
      await fsp.sync.createRecord({
        type: TASK, data: { title: titles[i], notes: "", status: "Open", groupId: "", sortOrder: base + i },
        companyKey: project ? project.companyKey : companyKey, projectId: project ? project.id : undefined,
      });
    }
    await renderTaskList();
    showStatus(titles.length === 1 ? "Task added." : `${titles.length} tasks added.`);
  });
  main.querySelectorAll(".task-row").forEach((row) => {
    row.querySelector(".ts-toggle").onclick = (ev) => withBusy(ev.currentTarget, async () => {
      const t = m.tasks.find((x) => x.id === row.dataset.id);
      await fsp.sync.saveRecord(t.id, { ...t.data, status: t.data.status === "Done" ? "Open" : "Done" });
      await renderTaskList();
    });
  });
}

async function renderTaskEdit(taskId) {
  const main = document.getElementById("main");
  const m = await tsLoad();
  const t = m.tasks.find((x) => x.id === taskId);
  if (!t) { main.innerHTML = `${toBackLink("#/tasks", "Tasks")}<div class="card"><h3>Task not found</h3><p class="muted">It may have been deleted.</p></div>`; return; }
  if (m.conflicted.has(t.id)) {
    main.innerHTML = `${toBackLink("#/tasks", "Tasks")}<div class="card"><h3>Needs your decision</h3><p class="muted">This task was changed on both the phone and the desktop. Choose which version to keep before editing it.</p><a class="btn block" href="#/conflicts">Decide now</a></div>`;
    return;
  }
  const projects = m.projects.filter((p) => p.companyKey === t.companyKey);
  const groups = m.groups.filter((g) => g.companyKey === t.companyKey);
  main.innerHTML = `
    ${toBackLink("#/tasks", "Tasks")}
    <h2>Edit task</h2>
    <div class="card">
      <label class="field">Title<input id="tsTitle" maxlength="300" value="${escapeHtml(t.data.title || "")}"></label>
      <label class="field">Notes<textarea id="tsNotes" rows="4">${escapeHtml(t.data.notes || "")}</textarea></label>
      <label class="field">Project<select id="tsProject"><option value="">No project</option>${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === t.projectId ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></label>
      <label class="field">Group<select id="tsGroup"><option value="">No group</option>${groups.map((g) => `<option value="${escapeHtml(g.id)}" ${g.id === t.data.groupId ? "selected" : ""}>${escapeHtml(g.data.name || "Untitled group")}</option>`).join("")}</select></label>
      <label class="field"><input id="tsDone" type="checkbox" ${t.data.status === "Done" ? "checked" : ""}> Done</label>
    </div>
    <div class="card" id="tsPhotos"></div>
    <div class="toolbar"><button class="btn" id="tsSave">Save</button><button class="btn danger" id="tsDelete">Delete</button></div>
    <div id="tsResult"></div>`;
  phMount(document.getElementById("tsPhotos"), t);
  document.getElementById("tsSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("tsTitle").value.trim();
    if (!title) { document.getElementById("tsResult").innerHTML = resultBox(["Enter a title."], true); return; }
    await fsp.sync.saveRecord(t.id, {
      ...t.data, title, notes: document.getElementById("tsNotes").value,
      groupId: document.getElementById("tsGroup").value, status: document.getElementById("tsDone").checked ? "Done" : "Open",
    }, { projectId: document.getElementById("tsProject").value });
    location.hash = "#/tasks";
  });
  document.getElementById("tsDelete").onclick = () => {
    openModal("Delete task?", `<p>“${escapeHtml(t.data.title || "Untitled")}” will be deleted here and on the desktop.</p>`, async () => {
      await fsp.sync.deleteRecord(t.id);
      closeModal();
      location.hash = "#/tasks";
    }, "Delete");
  };
}
