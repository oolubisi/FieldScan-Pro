// ===== tasks.js =====
// Quick field reminders. Two levels: individual tasks, and optional Groups
// (select 2+ tasks to bundle them). A group can be assigned to a project
// or deleted (cascading to its tasks, same convention as Take-Off Groups).
// A group only moves to "Done" once every task inside it is Done -- until
// then it stays visible in the open area even if some of its tasks are
// already checked off.

let tasksList = [];
let taskGroupsList = [];
let taskSelectedIds = new Set();
let tasksDoneExpanded = false;

function taskSortValue(t) {
  return t.sortOrder != null ? Number(t.sortOrder) : Number(t.lastModified) || 0;
}

async function initTasksPage() {
  const container = document.getElementById("tasks-list-view");
  if (container)
    container.innerHTML = '<div class="card"><span style="font-size:13px; color:var(--muted);">Loading tasks...</span></div>';
  const cache = getCache();
  const needProjects = !cache.projects || !cache.projects.length;
  taskSelectedIds = new Set();

  const results = await Promise.allSettled([
    callApi("getTasks", {}),
    callApi("getTaskGroups", {}),
    needProjects ? callApi("getProjects", {}) : Promise.resolve(null),
  ]);

  if (results[0].status === "fulfilled") {
    tasksList = Array.isArray(results[0].value) ? results[0].value : [];
    cache.tasks = tasksList;
  } else {
    console.error("getTasks failed", results[0].reason);
    tasksList = cache.tasks || [];
  }
  if (results[1].status === "fulfilled") {
    taskGroupsList = Array.isArray(results[1].value) ? results[1].value : [];
    cache.taskGroups = taskGroupsList;
  } else {
    console.error("getTaskGroups failed", results[1].reason);
    taskGroupsList = cache.taskGroups || [];
  }
  if (needProjects && results[2].status === "fulfilled") {
    cache.projects = results[2].value || [];
  }
  setCache(cache);
  renderTasksPage();
  if (typeof attachSwipeToDelete === "function") {
    attachSwipeToDelete("tasks-list-view", taskSwipeDelete);
  }
  if (typeof attachDragReorder === "function") {
    attachDragReorder("tasks-list-view", taskHandleReorder);
  }
}
window.initTasksPage = initTasksPage;

async function taskHandleReorder(orderedTaskIds) {
  // Descending scale so the top of the list gets the highest value,
  // matching the existing "newest/highest priority first" sort direction.
  const n = orderedTaskIds.length;
  const updates = [];
  orderedTaskIds.forEach((taskId, i) => {
    const task = tasksList.find((t) => t.taskId === taskId);
    if (!task) return;
    const newOrder = (n - i) * 1000;
    if (taskSortValue(task) === newOrder) return; // unchanged, skip
    task.sortOrder = newOrder;
    updates.push(task);
  });
  if (!updates.length) return;
  const cache = getCache();
  cache.tasks = tasksList;
  setCache(cache);
  renderTasksPage();
  const results = await Promise.allSettled(
    updates.map((task) =>
      callApi("updateTask", { taskId: task.taskId, title: task.title, notes: task.notes || "", projectId: task.projectId || "", status: task.status || "Open", groupId: task.groupId || "", sortOrder: task.sortOrder }),
    ),
  );
  const failCount = results.filter((r) => r.status === "rejected").length;
  if (failCount > 0) {
    console.error(failCount + " of " + updates.length + " reordered tasks failed to save");
  }
}

function renderTasksPage() {
  const container = document.getElementById("tasks-list-view");
  if (!container) return;
  const cache = getCache();
  const projects = cache.projects || [];

  // A group is "done" only once every one of its tasks is Done -- until
  // then the whole group stays in the open area, even with some tasks
  // already checked off.
  const groupIsDone = (groupId) => {
    const members = tasksList.filter((t) => t.groupId === groupId);
    return members.length > 0 && members.every((t) => t.status === "Done");
  };

  const ungrouped = tasksList.filter((t) => !t.groupId);
  const openUngrouped = ungrouped.filter((t) => t.status !== "Done").sort((a, b) => taskSortValue(b) - taskSortValue(a));
  const doneUngrouped = ungrouped.filter((t) => t.status === "Done").sort((a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0));

  const openGroups = taskGroupsList.filter((g) => !groupIsDone(g.groupId));
  const doneGroups = taskGroupsList.filter((g) => groupIsDone(g.groupId));

  // ---- Open groups (their own section, always shown regardless of project) ----
  const openGroupsHtml = openGroups.map((g) => taskGroupSectionHtml(g, projects)).join("");

  // ---- Ungrouped open tasks, by project (General first) ----
  const byProject = {};
  openUngrouped.forEach((t) => {
    const pid = t.projectId || "";
    byProject[pid] = byProject[pid] || [];
    byProject[pid].push(t);
  });
  const projectIds = Object.keys(byProject).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
  const openUngroupedHtml = projectIds.map((pid) => {
    const project = pid ? projects.find((p) => p.projectId === pid) : null;
    const groupLabel = pid ? escapeHtml(project ? (project.clientName || project.displayNumber || project.projectId) : pid) : "General";
    return (
      '<div style="margin-top:16px;">' +
      '<div style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;">' + groupLabel + ' (' + byProject[pid].length + ')</div>' +
      '<div class="console-cards-grid">' + byProject[pid].map((t) => taskCardHtml(t, !!pid)).join("") + '</div>' +
      '</div>'
    );
  }).join("");

  const hasAnyOpen = openGroups.length || openUngrouped.length;
  const openHtml = hasAnyOpen
    ? openGroupsHtml + openUngroupedHtml
    : '<p style="text-align:center; padding:20px; color:var(--muted);">Nothing on your list — add one above.</p>';

  // ---- Done (collapsed): completed groups + completed ungrouped tasks ----
  const doneCount = doneGroups.reduce((sum, g) => sum + tasksList.filter((t) => t.groupId === g.groupId).length, 0) + doneUngrouped.length;
  const doneHtml = doneCount
    ? '<div style="margin-top:20px;">' +
      '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.taskToggleDoneExpanded()">' +
      '<i class="fas ' + (tasksDoneExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> Done (' + doneCount + ')' +
      '</div>' +
      (tasksDoneExpanded
        ? doneGroups.map((g) => taskGroupSectionHtml(g, projects)).join("") +
          (doneUngrouped.length ? '<div class="console-cards-grid" style="margin-top:10px;">' + doneUngrouped.map((t) => taskCardHtml(t, false)).join("") + '</div>' : "")
        : "") +
      '</div>'
    : "";

  const selectionBar = taskSelectedIds.size
    ? '<div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:var(--card-light);">' +
      '<strong style="font-size:13px;">' + taskSelectedIds.size + ' selected</strong>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
      (taskSelectedIds.size >= 2 ? '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px;" onclick="window.taskGroupSelected()"><i class="fas fa-layer-group"></i> Group Selected</button>' : "") +
      '<button class="action-btn" style="width:auto; padding:6px 12px; font-size:12px; background:transparent; color:var(--danger);" onclick="window.taskClearSelection()"><i class="fas fa-xmark"></i> Clear</button>' +
      '</div></div>'
    : "";

  container.innerHTML =
    '<div style="display:flex; gap:10px; margin-bottom:15px;">' +
    '<input id="task-quick-add-input" type="text" placeholder="Type a task and hit Enter... (separate multiple with ;)" style="flex:1; font-size:16px; padding:12px;" onkeydown="if(event.key===\'Enter\') window.taskQuickAdd()">' +
    '<button class="action-btn" style="width:auto; padding:0 20px;" onclick="window.taskQuickAdd()"><i class="fas fa-plus"></i></button>' +
    '</div>' +
    selectionBar +
    openHtml + doneHtml;

  const input = document.getElementById("task-quick-add-input");
  if (input) input.focus();
}

function taskGroupSectionHtml(g, projects) {
  const project = g.projectId ? projects.find((p) => p.projectId === g.projectId) : null;
  const members = tasksList.filter((t) => t.groupId === g.groupId).sort((a, b) => taskSortValue(b) - taskSortValue(a));
  const key = "taskgroup:" + g.groupId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = g;
  return (
    '<div style="margin-top:16px;">' +
    '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">' +
    '<div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; cursor:pointer;" onclick="window.openTaskGroupModal(window.modalRecordCache[\'' + key + '\'])">' +
    '<i class="fas fa-layer-group"></i> ' + escapeHtml(g.name || "Untitled Group") + ' (' + members.length + ')' +
    (project ? ' <span style="color:var(--muted); font-weight:700;">· ' + escapeHtml(project.clientName || project.projectId) + '</span>' : "") +
    '</div>' +
    '</div>' +
    '<div class="console-cards-grid">' + members.map((t) => taskCardHtml(t, true)).join("") + '</div>' +
    '</div>'
  );
}

function taskToggleDoneExpanded() {
  tasksDoneExpanded = !tasksDoneExpanded;
  renderTasksPage();
}
window.taskToggleDoneExpanded = taskToggleDoneExpanded;

function taskCardHtml(t, hideProjectLabel) {
  const cache = getCache();
  const project = t.projectId ? (cache.projects || []).find((p) => p.projectId === t.projectId) : null;
  const isDone = t.status === "Done";
  const isSelected = taskSelectedIds.has(t.taskId);
  const key = "task:" + t.taskId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = t;
  return (
    '<div class="card ' + (isSelected ? "doc-card-selected" : "") + '" data-swipe-id="' + escapeAttr(t.taskId) + '" style="cursor:pointer; position:relative;' + (isDone ? " opacity:0.55;" : "") + '">' +
    '<div class="doc-card-select-badge ' + (isSelected ? "doc-card-select-badge-active" : "") + '" onclick="event.stopPropagation(); window.taskToggleSelect(\'' + escapeAttr(t.taskId) + '\')" title="Select"></div>' +
    (!isDone ? '<i class="fas fa-grip-vertical drag-grip" draggable="true" style="position:absolute; top:6px; right:6px;" title="Drag to reorder" onclick="event.stopPropagation()"></i>' : "") +
    '<div style="display:flex; align-items:flex-start; gap:10px; padding-left:20px;">' +
    '<input type="checkbox" ' + (isDone ? "checked" : "") + ' style="width:auto; margin-top:3px; cursor:pointer;" onclick="event.stopPropagation(); window.taskToggleDone(\'' + escapeAttr(t.taskId) + '\')">' +
    '<div style="flex:1; min-width:0;" onclick="window.openTaskModal(window.modalRecordCache[\'' + key + '\'])">' +
    '<strong style="font-size:14px;' + (isDone ? " text-decoration:line-through;" : "") + '">' + escapeHtml(t.title || "Untitled") + '</strong>' +
    (t.notes ? '<div style="font-size:12px; color:var(--muted); margin-top:2px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">' + escapeHtml(t.notes) + '</div>' : "") +
    (!hideProjectLabel && project ? '<div style="font-size:11px; color:var(--muted); margin-top:4px;"><i class="fas fa-diagram-project"></i> ' + escapeHtml(project.clientName || project.displayNumber || project.projectId) + '</div>' : "") +
    '</div></div></div>'
  );
}

function taskToggleSelect(taskId) {
  if (taskSelectedIds.has(taskId)) taskSelectedIds.delete(taskId);
  else taskSelectedIds.add(taskId);
  renderTasksPage();
}
window.taskToggleSelect = taskToggleSelect;

function taskClearSelection() {
  taskSelectedIds = new Set();
  renderTasksPage();
}
window.taskClearSelection = taskClearSelection;

/**
 * Splits on ";" and creates each as a task in parallel. Purely data-layer —
 * updates tasksList/cache but doesn't touch any specific page's DOM, so
 * this is safe to call from anywhere (the Tasks page's own quick-add, or
 * the Dashboard's quick-add FAB, both use this same path).
 * Returns { createdCount, failCount }.
 */
async function createTasksFromTitles(rawValue, overrideProjectId) {
  const titles = String(rawValue || "").split(";").map((t) => t.trim()).filter(Boolean);
  if (!titles.length) return { createdCount: 0, failCount: 0 };

  // The backend requires projectId on every saveTask call.
  const currentProjectId =
    overrideProjectId || (typeof getCurrentProjectId === "function" ? getCurrentProjectId() : "");
  const results = await Promise.allSettled(
    titles.map((title) => callApi("saveTask", { title: title, status: "Open", projectId: currentProjectId }))
  );
  const cache = getCache();
  let failCount = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      tasksList.push({ taskId: (result.value && result.value.taskId) || ("TASK-" + Date.now() + "-" + i), title: titles[i], notes: "", projectId: currentProjectId, status: "Open", groupId: "", sortOrder: Date.now() + i, lastModified: Date.now() + i });
    } else {
      failCount++;
      console.error("Could not add task:", titles[i], result.reason);
    }
  });
  cache.tasks = tasksList;
  setCache(cache);
  return { createdCount: titles.length - failCount, failCount: failCount };
}
window.createTasksFromTitles = createTasksFromTitles;

/**
 * The general/all-tasks view has no "current project" context at all --
 * getCurrentProjectId() correctly returns empty there, since there
 * genuinely isn't one. Every task still requires a project on the
 * backend, so this asks for one instead of silently sending an empty
 * value that would just fail with "projectId is required".
 * Self-contained inline styles, same reliable pattern as the undo
 * toast -- not dependent on external CSS that may be missing.
 */
function promptForProjectId() {
  return new Promise((resolve) => {
    const cache = getCache();
    const projects = (cache.projects || []).filter((p) => String(p.archived).toLowerCase() !== "yes" && p.archived !== true);
    if (!projects.length) {
      alert("No projects available to assign this task to.");
      resolve(null);
      return;
    }
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:8000;";
    const box = document.createElement("div");
    box.style.cssText =
      "background:#fff;border-radius:16px;padding:20px;max-width:320px;width:90%;box-shadow:0 8px 24px rgba(0,0,0,0.3);";
    const label = document.createElement("div");
    label.textContent = "Which project is this task for?";
    label.style.cssText = "font-weight:800;font-size:15px;margin-bottom:12px;";
    const select = document.createElement("select");
    select.style.cssText = "width:100%;padding:12px;font-size:16px;border-radius:10px;border:1.5px solid #ddd;margin-bottom:14px;";
    projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.projectId;
      opt.textContent = p.displayNumber || p.projectId;
      select.appendChild(opt);
    });
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:10px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "action-btn";
    cancelBtn.style.cssText = "flex:1;background:var(--card-light);color:var(--text);";
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Add Task";
    confirmBtn.className = "action-btn";
    confirmBtn.style.cssText = "flex:1;";
    cancelBtn.onclick = () => { overlay.remove(); resolve(null); };
    confirmBtn.onclick = () => { overlay.remove(); resolve(select.value); };
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    box.appendChild(label);
    box.appendChild(select);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}
window.promptForProjectId = promptForProjectId;

async function taskQuickAdd() {
  const input = document.getElementById("task-quick-add-input");
  if (!input) return;
  const rawValue = input.value.trim();
  if (!rawValue) {
    input.focus();
    input.style.transition = "box-shadow 0.15s";
    input.style.boxShadow = "0 0 0 2px var(--danger)";
    setTimeout(() => { input.style.boxShadow = ""; }, 400);
    return;
  }
  let overrideProjectId;
  const hasCurrentProject = typeof getCurrentProjectId === "function" && getCurrentProjectId();
  if (!hasCurrentProject) {
    overrideProjectId = await promptForProjectId();
    if (!overrideProjectId) return; // cancelled
  }
  input.disabled = true;
  try {
    const { failCount } = await createTasksFromTitles(rawValue, overrideProjectId);
    renderTasksPage();
    if (failCount > 0) {
      const total = rawValue.split(";").filter((t) => t.trim()).length;
      alert(failCount + " of " + total + " tasks could not be saved — check your connection and try again for those.");
    }
    input.value = "";
    input.disabled = false;
  } catch (e) {
    alert("Could not add tasks: " + (e.message || "Unknown error"));
    input.disabled = false;
  }
}
window.taskQuickAdd = taskQuickAdd;

async function taskToggleDone(taskId) {
  const task = tasksList.find((t) => t.taskId === taskId);
  if (!task) return;
  const newStatus = task.status === "Done" ? "Open" : "Done";
  task.status = newStatus; // optimistic
  renderTasksPage();
  try {
    await callApi("updateTask", { taskId: taskId, title: task.title, notes: task.notes || "", projectId: task.projectId || "", groupId: task.groupId || "", status: newStatus });
    const cache = getCache();
    cache.tasks = tasksList;
    setCache(cache);
  } catch (e) {
    task.status = newStatus === "Done" ? "Open" : "Done"; // revert
    renderTasksPage();
    alert("Could not update task: " + (e.message || "Unknown error"));
  }
}
window.taskToggleDone = taskToggleDone;

// ===== group selected tasks =====

function taskGroupSelected() {
  if (taskSelectedIds.size < 2) return;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center;";
  overlay.innerHTML =
    '<div style="background:#fff; border-radius:12px; padding:20px; max-width:360px; width:90%;">' +
    '<h3 style="margin-top:0;">Name This Group</h3>' +
    '<input id="task-group-name-input" placeholder="e.g. Site Visit Follow-ups" style="width:100%; padding:10px; font-size:14px; border:1.5px solid var(--border); border-radius:8px;">' +
    '<div style="display:flex; gap:8px; margin-top:14px;">' +
    '<button type="button" class="action-btn task-group-cancel" style="background:var(--card-light); color:var(--text);">Cancel</button>' +
    '<button type="button" class="action-btn task-group-confirm">Create Group</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  const input = document.getElementById("task-group-name-input");
  input.focus();

  const confirmCreate = async function () {
    const name = input.value.trim();
    const confirmBtn = overlay.querySelector(".task-group-confirm");
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Creating...";
    try {
      const resp = await callApi("saveTaskGroup", { name: name, projectId: "" });
      const groupId = (resp && resp.groupId) || ("TASKGRP-" + Date.now());
      const taskIds = Array.from(taskSelectedIds);
      const updates = await Promise.allSettled(
        taskIds.map((taskId) => {
          const task = tasksList.find((t) => t.taskId === taskId);
          return callApi("updateTask", { taskId: taskId, title: task.title, notes: task.notes || "", projectId: task.projectId || "", status: task.status || "Open", groupId: groupId });
        })
      );
      taskIds.forEach((taskId, i) => {
        if (updates[i].status === "fulfilled") {
          const task = tasksList.find((t) => t.taskId === taskId);
          if (task) task.groupId = groupId;
        }
      });
      taskGroupsList.push({ groupId: groupId, name: name, projectId: "", lastModified: Date.now() });
      const cache = getCache();
      cache.tasks = tasksList;
      cache.taskGroups = taskGroupsList;
      setCache(cache);
      taskSelectedIds = new Set();
      overlay.remove();
      renderTasksPage();
    } catch (e) {
      alert("Could not create group: " + (e.message || "Unknown error"));
      confirmBtn.disabled = false;
      confirmBtn.innerText = "Create Group";
    }
  };

  overlay.querySelector(".task-group-cancel").onclick = function () { overlay.remove(); };
  overlay.querySelector(".task-group-confirm").onclick = confirmCreate;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") confirmCreate();
  });
}
window.taskGroupSelected = taskGroupSelected;

// ===== group management: rename, assign project, delete =====

function openTaskGroupModal(group) {
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  overlay.style.display = "flex";
  submit.style.display = "block";
  submit.disabled = false;
  submit.innerText = "Save";

  const cache = getCache();
  const projects = cache.projects || [];
  const labelStyle = 'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  title.innerText = "Task Group";

  const projectOptions = ['<option value="">No project</option>'].concat(
    projects.map((p) => '<option value="' + escapeAttr(p.projectId) + '" ' + (group.projectId === p.projectId ? "selected" : "") + '>' + escapeHtml(p.clientName || p.projectId) + '</option>')
  ).join("");

  const memberCount = tasksList.filter((t) => t.groupId === group.groupId).length;

  body.innerHTML =
    '<label ' + labelStyle + '>Group Name</label>' +
    '<input id="task_group_name" value="' + escapeAttr(group.name || "") + '" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Assign to Project</label>' +
    '<select id="task_group_project" ' + largeInput + '>' + projectOptions + '</select>' +
    '<p style="font-size:12px; color:var(--muted); margin-top:10px;">' + memberCount + ' task(s) in this group.</p>' +
    '<button class="action-btn" id="task_group_delete_btn" style="background:var(--danger); margin-top:8px;"><i class="fas fa-trash"></i> Delete Group (and its tasks)</button>';

  document.getElementById("task_group_delete_btn").onclick = function () {
    const removedTasks = tasksList.filter((t) => t.groupId === group.groupId);
    closeModal();
    tasksList = tasksList.filter((t) => t.groupId !== group.groupId);
    taskGroupsList = taskGroupsList.filter((g) => g.groupId !== group.groupId);
    const cache1 = getCache();
    cache1.tasks = tasksList;
    cache1.taskGroups = taskGroupsList;
    setCache(cache1);
    renderTasksPage();
    scheduleUndoableDelete(
      "taskgroup:" + group.groupId,
      '"' + (group.name || "Group") + '" and ' + removedTasks.length + ' task(s) deleted',
      function () {
        callApi("deleteTaskGroup", { groupId: group.groupId }).catch(function (e) {
          console.error("Delete failed after undo window expired", e);
        });
      },
      function () {
        taskGroupsList.push(group);
        tasksList = tasksList.concat(removedTasks);
        const cache2 = getCache();
        cache2.tasks = tasksList;
        cache2.taskGroups = taskGroupsList;
        setCache(cache2);
        renderTasksPage();
      },
    );
  };

  submit.onclick = function () {
    const name = document.getElementById("task_group_name").value.trim();
    if (!name) {
      alert("Enter a group name");
      return;
    }
    const projectId = document.getElementById("task_group_project").value;
    submit.disabled = true;
    submit.innerText = "Saving...";
    callApi("updateTaskGroup", { groupId: group.groupId, name: name, projectId: projectId })
      .then(function () {
        const idx = taskGroupsList.findIndex((g) => g.groupId === group.groupId);
        if (idx !== -1) taskGroupsList[idx] = Object.assign({}, taskGroupsList[idx], { name: name, projectId: projectId });
        const cache2 = getCache();
        cache2.taskGroups = taskGroupsList;
        setCache(cache2);
        closeModal();
        renderTasksPage();
      })
      .catch(function (e) {
        submit.disabled = false;
        submit.innerText = "Save";
        alert("Save failed: " + (e.message || "Unknown error"));
      });
  };
}
window.openTaskGroupModal = openTaskGroupModal;

// ===== shared delete-with-undo (used by both the modal's Delete button and swipe) =====

function deleteTaskWithUndo(task) {
  closeModal(); // harmless no-op if no modal is open (e.g. triggered by a swipe)
  tasksList = tasksList.filter((t) => t.taskId !== task.taskId);
  const cache1 = getCache();
  cache1.tasks = tasksList;
  setCache(cache1);
  renderTasksPage();
  const isUnsyncedLocal = String(task.taskId || "").startsWith("temp_");
  scheduleUndoableDelete(
    "task:" + task.taskId,
    "Task deleted",
    async function () {
      if (isUnsyncedLocal) {
        // This task was created offline and never actually made it to the
        // server (its own create is presumably still queued, or failed) --
        // there's nothing there to delete. Sending a real deleteTask for
        // a temp_ id just produces "invalid input syntax for type uuid"
        // every time, forever. Instead, cancel whatever's still queued
        // for it (its create, or any edit), so it can't sync in later and
        // resurrect something the user already deleted.
        if (typeof getQueuedRequestsForCurrentAccount === "function" && typeof deleteQueuedRequest === "function") {
          try {
            const queue = await getQueuedRequestsForCurrentAccount();
            const related = queue.filter((item) => item.data && item.data.taskId === task.taskId);
            for (const item of related) {
              await deleteQueuedRequest(item.id);
            }
          } catch (e) {
            console.error("Could not cancel queued request for unsynced task", e);
          }
        }
        return;
      }
      callApi("deleteTask", { taskId: task.taskId }).catch(function (e) {
        console.error("Delete failed after undo window expired", e);
      });
    },
    function () {
      tasksList.push(task);
      const cache2 = getCache();
      cache2.tasks = tasksList;
      setCache(cache2);
      renderTasksPage();
    },
  );
}
window.deleteTaskWithUndo = deleteTaskWithUndo;

function taskSwipeDelete(taskId) {
  const task = tasksList.find((t) => t.taskId === taskId);
  if (task) deleteTaskWithUndo(task);
}
window.taskSwipeDelete = taskSwipeDelete;

// ===== individual task edit modal =====

function openTaskModal(editData) {
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  overlay.style.display = "flex";
  submit.style.display = "block";
  submit.disabled = false;
  submit.innerText = "Save";

  const cache = getCache();
  const projects = cache.projects || [];
  const labelStyle = 'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  title.innerText = "Edit Task";

  const projectOptions = ['<option value="">No project</option>'].concat(
    projects.map((p) => '<option value="' + escapeAttr(p.projectId) + '" ' + (editData.projectId === p.projectId ? "selected" : "") + '>' + escapeHtml(p.clientName || p.projectId) + '</option>')
  ).join("");

  const group = editData.groupId ? taskGroupsList.find((g) => g.groupId === editData.groupId) : null;

  body.innerHTML =
    '<label ' + labelStyle + '>Title</label>' +
    '<input id="task_title" value="' + escapeAttr(editData.title || "") + '" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Notes</label>' +
    '<textarea id="task_notes" rows="3" ' + largeInput + '>' + escapeHtml(editData.notes || "") + '</textarea>' +
    '<label ' + labelStyle + '>Project</label>' +
    '<select id="task_project" ' + largeInput + '>' + projectOptions + '</select>' +
    (group ? '<p style="font-size:12px; color:var(--muted); margin-top:10px;"><i class="fas fa-layer-group"></i> Part of group: ' + escapeHtml(group.name || "Untitled Group") + '</p>' : "") +
    '<button class="action-btn" id="task_delete_btn" style="background:var(--danger); margin-top:16px;"><i class="fas fa-trash"></i> Delete</button>';

  document.getElementById("task_delete_btn").onclick = function () {
    deleteTaskWithUndo(editData);
  };

  submit.onclick = function () {
    const titleVal = document.getElementById("task_title").value.trim();
    if (!titleVal) {
      alert("Enter a title");
      return;
    }
    submit.disabled = true;
    submit.innerText = "Saving...";
    const payload = {
      taskId: editData.taskId,
      title: titleVal,
      notes: document.getElementById("task_notes").value,
      projectId: document.getElementById("task_project").value,
      status: editData.status || "Open",
      groupId: editData.groupId || "",
    };
    callApi("updateTask", payload)
      .then(function () {
        const idx = tasksList.findIndex((t) => t.taskId === editData.taskId);
        if (idx !== -1) tasksList[idx] = Object.assign({}, tasksList[idx], payload);
        const cache2 = getCache();
        cache2.tasks = tasksList;
        setCache(cache2);
        closeModal();
        renderTasksPage();
      })
      .catch(function (e) {
        submit.disabled = false;
        submit.innerText = "Save";
        alert("Save failed: " + (e.message || "Unknown error"));
      });
  };
}
window.openTaskModal = openTaskModal;
