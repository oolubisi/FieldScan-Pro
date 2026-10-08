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
  const projects = coFilter(await fsp.sync.listProjects());
  const groups = coFilter(await fsp.sync.getRecords(TASK_GROUP));
  const tasks = coFilter(await fsp.sync.getRecords(TASK));
  const conflicts = await fsp.sync.getConflicts();
  const companies = coCompanies(Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name })));
  return { projects, groups, tasks, companies, conflicts, conflicted: new Set(conflicts.map((c) => c.id)) };
}

/** Today in this phone's own time zone, as YYYY-MM-DD. */
function tsToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
/** "overdue" | "today" | "soon" (within 3 days) | "" */
function tsDueStatus(due, today) {
  if (!due) return "";
  const t = today || tsToday();
  if (due < t) return "overdue";
  if (due === t) return "today";
  return (new Date(due) - new Date(t)) / 86400000 <= 3 ? "soon" : "";
}
function tsDueChip(t) {
  if (!t.data.dueDate || t.data.status === "Done") return "";
  const s = tsDueStatus(t.data.dueDate);
  const kind = s === "overdue" ? "bad" : s === "today" ? "wait" : s === "soon" ? "info" : "";
  const label = s === "overdue" ? "Overdue · " : s === "today" ? "Due today · " : "Due ";
  return `<span class="badge ${kind}" style="margin-top:3px;">${label}${escapeHtml(t.data.dueDate)}</span>`;
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
  return `<div class="row task-row" data-id="${escapeHtml(t.id)}" style="${p ? `--c:${hmColor(p.key || p.id)}` : ""}">
    <button class="btn ${done ? "" : "secondary"} small ts-toggle" type="button" aria-label="${done ? "Reopen" : "Mark done"}" ${m.conflicted.has(t.id) ? "disabled" : ""}>${done ? "✓" : "○"}</button>
    <a class="grow ts-open" href="#/tasks/${escapeHtml(t.id)}" style="color:inherit;text-decoration:none;">
      <b style="${done ? "text-decoration:line-through;" : ""}">${escapeHtml(t.data.title || "Untitled")}</b>
      ${t.data.notes ? `<div class="sub">${escapeHtml(t.data.notes.slice(0, 80))}</div>` : ""}
      ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}${tsDueChip(t)}</a>
    <span class="badge ${kind}">${label}</span></div>`;
}

async function renderTaskList() {
  const main = document.getElementById("main");
  const m = await tsLoad();
  const filter = renderTaskList.filter || "all";
  const lastCompany = renderTaskList.company && m.companies.some((c) => c.key === renderTaskList.company) ? renderTaskList.company : (m.companies[0] || {}).key;
  const shown = m.tasks.filter((t) => filter === "all" || (filter === "none" ? !t.projectId : `${t.companyKey}:${t.projectId}` === filter));
  const dueOnly = renderTaskList.due === "overdue";
  const open = shown.filter((t) => t.data.status !== "Done" && (!dueOnly || tsDueStatus(t.data.dueDate) === "overdue"))
    .sort((a, b) => (a.data.dueDate || "9999").localeCompare(b.data.dueDate || "9999") || tsOrder(b) - tsOrder(a));
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
      <label class="field">Project<select id="tsAddProject"></select></label>
      <button class="btn block" id="tsAdd" style="margin-top:10px;" ${m.companies.length ? "" : "disabled"}>Add</button>
    </div>
    <div class="toolbar"><select id="tsFilter" aria-label="Project"><option value="all">All tasks</option><option value="none" ${filter === "none" ? "selected" : ""}>No project</option>${m.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select>
      <select id="tsDueFilter" aria-label="Due"><option value="">Any due date</option><option value="overdue" ${dueOnly ? "selected" : ""}>Overdue only</option></select></div>
    ${groupsWithOpen.map((g) => `<div class="card"><h3>${escapeHtml(g.data.name || "Untitled group")}</h3>${open.filter((t) => t.data.groupId === g.id).map((t) => tsRow(m, t)).join("")}</div>`).join("")}
    ${ungrouped.length ? `<div class="card">${ungrouped.map((t) => tsRow(m, t)).join("")}</div>` : (groupsWithOpen.length ? "" : `<div class="empty-state">${shown.length ? "Nothing open. Well done." : "No tasks yet."}</div>`)}
    ${done.length ? `<details class="card"><summary><b>Done (${done.length})</b></summary>${done.map((t) => tsRow(m, t)).join("")}</details>` : ""}`;

  document.getElementById("tsFilter").onchange = (ev) => { renderTaskList.filter = ev.target.value; renderTaskList(); };
  document.getElementById("tsDueFilter").onchange = (ev) => { renderTaskList.due = ev.target.value; renderTaskList(); };
  const company = document.getElementById("tsCompany");
  // the project for new tasks: the one being viewed, else the one used for the latest task (it can be changed here)
  const latestTask = [...m.tasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const fillAddProjects = (preferred) => {
    const key = company ? company.value : lastCompany;
    const list = m.projects.filter((p) => p.companyKey === key);
    const want = preferred !== undefined ? preferred : (m.projects.find((p) => p.key === filter) || {}).id || (latestTask && latestTask.companyKey === key ? latestTask.projectId : "") || "";
    document.getElementById("tsAddProject").innerHTML = `<option value="">No project</option>` + list.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === want ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("");
  };
  fillAddProjects();
  if (company) company.onchange = (ev) => { renderTaskList.company = ev.target.value; fillAddProjects(""); };
  document.getElementById("tsAdd").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const titles = tsSplitTitles(document.getElementById("tsNew").value);
    if (!titles.length) { showStatus("Type a task first.", true); return; }
    const companyKey = company ? company.value : lastCompany;
    const chosen = document.getElementById("tsAddProject").value;
    const project = m.projects.find((p) => p.id === chosen && p.companyKey === companyKey);
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
      <label class="field">Notes<textarea id="tsNotes" rows="4" data-dictate>${escapeHtml(t.data.notes || "")}</textarea></label>
      <label class="field">Project<select id="tsProject"><option value="">No project</option>${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === t.projectId ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></label>
      <label class="field">Group<select id="tsGroup"><option value="">No group</option>${groups.map((g) => `<option value="${escapeHtml(g.id)}" ${g.id === t.data.groupId ? "selected" : ""}>${escapeHtml(g.data.name || "Untitled group")}</option>`).join("")}</select></label>
      <label class="field">Due date<input id="tsDueDate" type="date" value="${escapeHtml(t.data.dueDate || "")}"></label>
      <label class="field"><input id="tsDone" type="checkbox" ${t.data.status === "Done" ? "checked" : ""}> Done</label>
    </div>
    <div class="card" id="tsPhotos"></div>
    <div class="toolbar"><button class="btn" id="tsSave">Save</button><button class="btn danger" id="tsDelete">Delete</button></div>
    <div id="tsResult"></div>`;
  dtAttach(main);
  phMount(document.getElementById("tsPhotos"), t, t.data.title);
  document.getElementById("tsSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("tsTitle").value.trim();
    if (!title) { document.getElementById("tsResult").innerHTML = resultBox(["Enter a title."], true); return; }
    const due = document.getElementById("tsDueDate").value;
    const next = { ...t.data, title, notes: document.getElementById("tsNotes").value,
      groupId: document.getElementById("tsGroup").value, status: document.getElementById("tsDone").checked ? "Done" : "Open" };
    if (due) next.dueDate = due; else delete next.dueDate;
    await fsp.sync.saveRecord(t.id, next, { projectId: document.getElementById("tsProject").value });
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
