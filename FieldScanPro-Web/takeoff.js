// ===== takeoff.js =====
// Groups are the top-level entity here: each group can optionally be tied
// to a project, and can be deleted (which cascades to its cards, since a
// card has no meaning without its parent group). Take-off cards
// themselves are only ever created/viewed from inside a group.

let takeoffGroups = [];
let takeoffFilterProjectId = "All";
let currentTakeoffGroupId = null;
let currentTakeoffGroupCards = [];

async function initTakeoffPage() {
  const container = document.getElementById("takeoff-list-view");
  if (container)
    container.innerHTML = '<div class="card"><span style="font-size:13px; color:var(--muted);">Loading take-off groups...</span></div>';
  const cache = getCache();
  const needProjects = !cache.projects || !cache.projects.length;

  const results = await Promise.allSettled([
    callApi("getTakeOffGroups", {}),
    needProjects ? callApi("getProjects", {}) : Promise.resolve(null),
  ]);

  if (results[0].status === "fulfilled") {
    takeoffGroups = Array.isArray(results[0].value) ? results[0].value : [];
    cache.takeoffGroups = takeoffGroups;
  } else {
    console.error("getTakeOffGroups failed", results[0].reason);
    takeoffGroups = cache.takeoffGroups || [];
  }
  if (needProjects && results[1].status === "fulfilled") {
    cache.projects = results[1].value || [];
  }
  setCache(cache);
  renderTakeoffPage();
}
window.initTakeoffPage = initTakeoffPage;

function takeoffSetFilter(projectId) {
  takeoffFilterProjectId = projectId;
  renderTakeoffPage();
}
window.takeoffSetFilter = takeoffSetFilter;

function renderTakeoffPage() {
  const container = document.getElementById("takeoff-list-view");
  if (!container) return;
  const cache = getCache();
  const projects = cache.projects || [];

  const filtered =
    takeoffFilterProjectId === "All"
      ? takeoffGroups
      : takeoffFilterProjectId === ""
        ? takeoffGroups.filter(function (g) { return !g.projectId; })
        : takeoffGroups.filter(function (g) { return g.projectId === takeoffFilterProjectId; });

  const filterOptions = [
    '<option value="All" ' + (takeoffFilterProjectId === "All" ? "selected" : "") + '>All Groups</option>',
    '<option value="" ' + (takeoffFilterProjectId === "" ? "selected" : "") + '>General (no project)</option>',
  ].concat(
    projects.map(function (p) {
      return '<option value="' + escapeAttr(p.projectId) + '" ' + (takeoffFilterProjectId === p.projectId ? "selected" : "") + '>' + escapeHtml(p.clientName || p.projectId) + '</option>';
    })
  ).join("");

  const sorted = [...filtered].sort(function (a, b) { return (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0); });
  const cardsHtml = sorted.length
    ? '<div class="console-cards-grid">' + sorted.map(takeoffGroupCardHtml).join("") + '</div>'
    : '<p style="text-align:center; padding:20px; color:var(--muted);">No take-off groups yet' + (takeoffFilterProjectId !== "All" ? " for this filter" : ' — use "New Group" above to add one') + '.</p>';

  container.innerHTML =
    '<div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">' +
    '<select style="flex:1; min-width:180px; font-size:16px;" onchange="window.takeoffSetFilter(this.value)">' + filterOptions + '</select>' +
    '<button class="action-btn" style="width:auto; padding:0 20px;" onclick="window.openTakeoffGroupForm(null)">' +
    '<i class="fas fa-plus"></i> New Group</button></div>' +
    cardsHtml;
}

function takeoffGroupCardHtml(g) {
  const cache = getCache();
  const project = g.projectId ? (cache.projects || []).find(function (p) { return p.projectId === g.projectId; }) : null;
  const key = "takeoffgroup:" + g.groupId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = g;
  return (
    '<div class="card" style="cursor:pointer;" onclick="window.openTakeoffGroupDetail(\'' + escapeAttr(g.groupId) + '\')">' +
    '<strong style="font-size:16px;">' + escapeHtml(g.name || "Untitled Group") + '</strong><br>' +
    '<span style="font-size:13px; color:var(--muted);">' + (project ? escapeHtml(project.clientName || project.projectId) : "General (no project)") + '</span>' +
    '</div>'
  );
}

// ===== new/edit group =====

function openTakeoffGroupForm(editData) {
  editData = editData || null;
  const isEdit = !!editData;
  const cache = getCache();
  const projects = cache.projects || [];
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  overlay.style.display = "flex";
  submit.style.display = "block";
  submit.disabled = false;
  submit.innerText = "Save";

  const labelStyle = 'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  title.innerText = isEdit ? "Edit Take-Off Group" : "New Take-Off Group";

  const projectOptions = [
    '<option value="">General (no project)</option>',
  ].concat(
    projects.map(function (p) {
      return '<option value="' + escapeAttr(p.projectId) + '" ' + (isEdit && editData.projectId === p.projectId ? "selected" : "") + '>' + escapeHtml(p.clientName || p.projectId) + '</option>';
    })
  ).join("");

  body.innerHTML =
    '<label ' + labelStyle + '>Group Name</label>' +
    '<input id="tog_name" value="' + escapeAttr(isEdit ? editData.name : "") + '" placeholder="e.g. Ground Floor Finishes" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Project</label>' +
    '<select id="tog_project" ' + largeInput + '>' + projectOptions + '</select>';

  submit.onclick = function () {
    const name = document.getElementById("tog_name").value.trim();
    if (!name) {
      alert("Enter a group name");
      return;
    }
    const projectId = document.getElementById("tog_project").value;
    submit.disabled = true;
    submit.innerText = "Saving...";
    const payload = { name: name, projectId: projectId };
    if (isEdit) payload.groupId = editData.groupId;

    callApi(isEdit ? "updateTakeOffGroup" : "saveTakeOffGroup", payload)
      .then(function (resp) {
        const cache2 = getCache();
        if (isEdit) {
          const idx = takeoffGroups.findIndex(function (g) { return g.groupId === editData.groupId; });
          if (idx !== -1) takeoffGroups[idx] = Object.assign({}, takeoffGroups[idx], payload);
        } else {
          takeoffGroups.push(Object.assign({}, payload, { groupId: (resp && resp.groupId) || ("TOG-" + Date.now()), lastModified: Date.now() }));
        }
        cache2.takeoffGroups = takeoffGroups;
        setCache(cache2);
        closeModal();
        renderTakeoffPage();
      })
      .catch(function (err) {
        submit.disabled = false;
        submit.innerText = "Save";
        alert("Save failed: " + (err && err.message ? err.message : "Unknown error"));
      });
  };
}
window.openTakeoffGroupForm = openTakeoffGroupForm;

function deleteTakeoffGroup(groupId, btn) {
  const removedGroup = takeoffGroups.find(function (g) { return g.groupId === groupId; });
  const removedCards = currentTakeoffGroupCards.slice();
  takeoffGroups = takeoffGroups.filter(function (g) { return g.groupId !== groupId; });
  const cache = getCache();
  cache.takeoffGroups = takeoffGroups;
  setCache(cache);
  closeFullPagePanel("takeoff-group-detail-panel");
  renderTakeoffPage();
  scheduleUndoableDelete(
    "takeoffgroup:" + groupId,
    '"' + (removedGroup ? removedGroup.name : "Group") + '" and ' + removedCards.length + ' take-off(s) deleted',
    function () {
      callApi("deleteTakeOffGroup", { groupId: groupId }).catch(function (err) {
        console.error("Delete failed after undo window expired", err);
      });
    },
    function () {
      if (removedGroup) takeoffGroups.push(removedGroup);
      const cache2 = getCache();
      cache2.takeoffGroups = takeoffGroups;
      setCache(cache2);
      renderTakeoffPage();
      if (removedGroup) openTakeoffGroupDetail(groupId); // reopen so the restored cards are visible again
    },
  );
}
window.deleteTakeoffGroup = deleteTakeoffGroup;

// ===== group detail view (shows the group's take-off cards) =====

async function openTakeoffGroupDetail(groupId) {
  const group = takeoffGroups.find(function (g) { return g.groupId === groupId; });
  if (!group) return;
  currentTakeoffGroupId = groupId;

  const panelId = "takeoff-group-detail-panel";
  openFullPagePanel(panelId, group.name || "Take-Off Group");
  const body = document.getElementById(panelId + "-body");
  const footer = document.getElementById(panelId + "-footer");

  body.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>';

  try {
    const resp = await callApi("getTakeOffs", { groupId: groupId });
    currentTakeoffGroupCards = Array.isArray(resp) ? resp : [];
  } catch (e) {
    console.error("getTakeOffs failed", e);
    currentTakeoffGroupCards = [];
  }

  renderTakeoffGroupDetailBody();
  if (typeof attachSwipeToDelete === "function") {
    attachSwipeToDelete(panelId + "-body", takeoffCardSwipeDelete);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "action-btn";
  deleteBtn.style.cssText = "width:auto; background:var(--danger);";
  deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Group';
  deleteBtn.onclick = function () { deleteTakeoffGroup(groupId, deleteBtn); };
  footer.appendChild(deleteBtn);
}
window.openTakeoffGroupDetail = openTakeoffGroupDetail;

function renderTakeoffGroupDetailBody() {
  const panelId = "takeoff-group-detail-panel";
  const body = document.getElementById(panelId + "-body");
  if (!body) return;
  const sorted = [...currentTakeoffGroupCards].sort(function (a, b) { return (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0); });
  const cardsHtml = sorted.length
    ? '<div class="console-cards-grid">' + sorted.map(takeoffCardHtml).join("") + '</div>'
    : '<p style="text-align:center; padding:20px; color:var(--muted);">No take-offs in this group yet — use "Add Take-Off" above to add one.</p>';

  body.innerHTML =
    '<button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; margin-bottom:14px;" onclick="window.openTakeOffCardModal(null)">' +
    '<i class="fas fa-plus"></i> Add Take-Off</button>' +
    cardsHtml;
}

function takeoffCardHtml(t) {
  const key = "takeoffcard:" + t.takeOffId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = t;
  return (
    '<div class="card" data-swipe-id="' + escapeAttr(t.takeOffId) + '" style="cursor:pointer;" onclick="window.openTakeOffCardModal(window.modalRecordCache[\'' + key + '\'])" title="Click to edit">' +
    '<div style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;">' + escapeHtml(t.takeOffId) + '</div>' +
    '<strong style="font-size:15px;">' + escapeHtml(t.title || "Untitled") + '</strong>' +
    (t.notes ? '<div style="font-size:12px; color:var(--muted); margin-top:4px;">' + escapeHtml(t.notes) + '</div>' : "") +
    '</div>'
  );
}

// ===== individual take-off card modal (create/edit, inside a group) =====

// ===== shared delete-with-undo (used by both the modal's Delete button and swipe) =====

function deleteTakeoffCardWithUndo(card) {
  currentTakeoffGroupCards = currentTakeoffGroupCards.filter(function (t) { return t.takeOffId !== card.takeOffId; });
  renderTakeoffGroupDetailBody();
  scheduleUndoableDelete(
    "takeoff:" + card.takeOffId,
    "Take-off deleted",
    function () {
      callApi("deleteTakeOff", { takeOffId: card.takeOffId }).catch(function (err) {
        console.error("Delete failed after undo window expired", err);
      });
    },
    function () {
      currentTakeoffGroupCards.push(card);
      renderTakeoffGroupDetailBody();
    },
  );
}
window.deleteTakeoffCardWithUndo = deleteTakeoffCardWithUndo;

function takeoffCardSwipeDelete(takeOffId) {
  const card = currentTakeoffGroupCards.find(function (t) { return t.takeOffId === takeOffId; });
  if (card) deleteTakeoffCardWithUndo(card);
}
window.takeoffCardSwipeDelete = takeoffCardSwipeDelete;

function openTakeOffCardModal(editData) {
  editData = editData || null;
  const isEdit = !!editData;
  const group = takeoffGroups.find(function (g) { return g.groupId === currentTakeoffGroupId; });
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  overlay.style.display = "flex";
  body.innerHTML = "";
  submit.style.display = "none"; // custom buttons live inside the body

  const labelStyle = 'style="display:block; font-weight:800; margin-top:12px; margin-bottom:4px;"';
  const largeInput = 'style="width:100%; padding:12px; font-size:16px;"';

  title.innerText = isEdit ? "Edit Take-Off" : "New Take-Off";

  const actionButtons = isEdit
    ? '<div style="display:flex; gap:10px; margin-top:16px;">' +
      '<button class="action-btn" id="to_delete_btn" style="background:var(--danger); flex:1;"><i class="fas fa-trash"></i> Delete</button>' +
      '<button class="action-btn" id="to_save_btn" style="flex:1;"><i class="fas fa-save"></i> Save</button></div>'
    : '<button class="action-btn" id="to_save_btn" style="margin-top:16px; width:100%;"><i class="fas fa-save"></i> Save</button>';

  body.innerHTML =
    '<input type="hidden" id="to_id" value="' + escapeAttr(isEdit ? editData.takeOffId : "") + '">' +
    '<label ' + labelStyle + '>Sector</label>' +
    '<input id="to_title" value="' + escapeAttr(isEdit ? editData.title : "") + '" placeholder="e.g. Tiling / Flooring" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Notes</label>' +
    '<textarea id="to_notes" rows="6" ' + largeInput + '>' + escapeHtml(isEdit ? editData.notes || "" : "") + '</textarea>' +
    actionButtons;

  document.getElementById("to_save_btn").onclick = function () {
    const titleVal = document.getElementById("to_title").value.trim();
    if (!titleVal) {
      alert("Enter a sector name");
      return;
    }
    const submitBtn = document.getElementById("to_save_btn");
    submitBtn.disabled = true;
    submitBtn.innerText = "Saving...";

    const payload = {
      groupId: currentTakeoffGroupId,
      projectId: group ? group.projectId : "",
      title: titleVal,
      lineItems: [],
      notes: document.getElementById("to_notes").value,
      date: typeof todayFormatted === "function" ? todayFormatted() : new Date().toISOString().slice(0, 10),
    };
    if (isEdit) payload.takeOffId = editData.takeOffId;

    callApi(isEdit ? "updateTakeOff" : "saveTakeOff", payload)
      .then(function (resp) {
        if (isEdit) {
          const idx = currentTakeoffGroupCards.findIndex(function (t) { return t.takeOffId === editData.takeOffId; });
          if (idx !== -1) currentTakeoffGroupCards[idx] = Object.assign({}, currentTakeoffGroupCards[idx], payload);
        } else {
          currentTakeoffGroupCards.push(Object.assign({}, payload, { takeOffId: (resp && resp.takeOffId) || ("TO-" + Date.now()), lastModified: Date.now() }));
        }
        closeModal();
        renderTakeoffGroupDetailBody();
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Save";
        alert("Save failed: " + (err && err.message ? err.message : "Unknown error"));
      });
  };

  if (isEdit) {
    const deleteBtn = document.getElementById("to_delete_btn");
    deleteBtn.onclick = function () {
      closeModal();
      deleteTakeoffCardWithUndo(editData);
    };
  }
}
window.openTakeOffCardModal = openTakeOffCardModal;
