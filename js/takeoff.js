// ===== Take-Off on the phone =====
// Two kinds of synced record:
//   "takeoff-group"  data: { name }                       (belongs to one project)
//   "takeoff"        data: { groupId, title, notes, date, lineItems: [...] }
// A line item is { id, kind: "item" | "header", description, quantity, unit, notes }.
// Anything else the desktop puts in a record's data is carried along untouched,
// so the phone never loses fields it doesn't show.

const TO_GROUP = "takeoff-group";
const TO_CARD = "takeoff";
const TO_UNITS = ["Lot", "Sum", "Item", "No", "Set", "Pair", "m", "m²", "m³", "mm", "Length", "kg", "Ton", "Litre", "Bag", "Roll", "Sheet", "Coil"];
const TO_BADGE = {
  unsent: ["wait", "Not sent"],
  sent: ["wait", "Sent"],
  delivered: ["ok", "Delivered ✓"],
};

// ---------- pure helpers (also used by the tests) ----------

function toNewLineId() {
  return "ln-" + Math.random().toString(36).slice(2, 10);
}

/** Turns what the form holds into clean line items, keeping any extra fields the line already had. */
function toCleanLines(rows, previous) {
  const before = new Map((previous || []).map((l) => [l.id, l]));
  const out = [];
  (rows || []).forEach((r) => {
    const kind = r.kind === "header" ? "header" : "item";
    const description = String(r.description || "").trim();
    const notes = String(r.notes || "").trim();
    const qtyText = String(r.quantity == null ? "" : r.quantity).trim();
    if (kind === "header") {
      if (!description) return;
    } else if (!description && !qtyText && !notes) {
      return; // an untouched blank row
    }
    const id = r.id || toNewLineId();
    const quantity = qtyText === "" || isNaN(Number(qtyText)) ? "" : Number(qtyText);
    const line = kind === "header"
      ? { ...(before.get(id) || {}), id, kind, description }
      : { ...(before.get(id) || {}), id, kind, description, quantity, unit: r.unit || "", notes };
    out.push(line);
  });
  return out;
}

function toCountItems(lines) {
  return (lines || []).filter((l) => l && l.kind !== "header").length;
}

/** Plain-language lines describing one side of a record, for the conflict screen. */
function toDescribe(type, snap) {
  if (!snap) return [];
  if (snap.deleted) return ["Deleted"];
  const d = snap.data || {};
  if (type === TO_GROUP) return [`Group: ${d.name || "(no name)"}`];
  if (type === TO_CARD) {
    const lines = [`Sector: ${d.title || "(no name)"}`];
    if (d.date) lines.push(`Date: ${d.date}`);
    const items = (d.lineItems || []).filter((l) => l.kind !== "header");
    lines.push(`${items.length} item${items.length === 1 ? "" : "s"}`);
    items.slice(0, 6).forEach((l) => lines.push(`• ${l.description || "(no description)"}${l.quantity !== "" && l.quantity != null ? ` — ${l.quantity}${l.unit ? " " + l.unit : ""}` : ""}`));
    if (items.length > 6) lines.push(`…and ${items.length - 6} more`);
    if (d.notes) lines.push(`Notes: ${d.notes}`);
    return lines;
  }
  return Object.keys(d).slice(0, 8).map((k) => `${k}: ${typeof d[k] === "object" ? "…" : String(d[k])}`);
}

// ---------- loading ----------

async function toLoad() {
  const projects = await fsp.sync.listProjects();
  const groups = await fsp.sync.getRecords(TO_GROUP);
  const cards = await fsp.sync.getRecords(TO_CARD);
  const conflicts = await fsp.sync.getConflicts();
  const conflicted = new Set(conflicts.map((c) => c.id));
  return { projects, groups, cards, conflicts, conflicted };
}

const toProjectLabel = (p) => `${p.displayNumber} — ${p.clientName || ""}${p.siteLocation ? ", " + p.siteLocation : ""}`;
const toFindProject = (projects, rec) => projects.find((p) => p.id === rec.projectId && p.companyKey === rec.companyKey);

function toBanner(model) {
  return model.conflicts.length
    ? `<a class="notice" href="#/conflicts">${model.conflicts.length} record${model.conflicts.length === 1 ? "" : "s"} changed on both phone and desktop. Tap to decide.</a>`
    : "";
}

function toBackLink(href, label) {
  return `<a class="back" href="${href}">‹ ${escapeHtml(label)}</a>`;
}

// ---------- screens ----------

async function renderTakeoffScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) {
    main.innerHTML = `<h2>Take-Off</h2><div class="card"><h3>Storage isn't available</h3><p class="muted">This browser isn't letting the app save data, so Take-Off can't work here. The Calculators still do.</p></div>`;
    return;
  }
  const parts = /^#\/takeoff\//.test(location.hash) ? location.hash.replace(/^#\/takeoff\//, "").split("/").filter(Boolean) : [];
  if (!parts.length) return renderTakeoffGroups();
  if (parts.length === 1) return renderTakeoffGroup(parts[0]);
  return renderTakeoffCard(parts[0], parts[1]);
}

async function renderTakeoffGroups() {
  const main = document.getElementById("main");
  const model = await toLoad();
  const filter = renderTakeoffGroups.filter || "all";
  const shown = model.groups.filter((g) => filter === "all" || `${g.companyKey}:${g.projectId}` === filter);
  const projectOptions = `<option value="all">All projects</option>` + model.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === filter ? "selected" : ""}>${escapeHtml(toProjectLabel(p))}</option>`).join("");

  main.innerHTML = `
    <h2>Take-Off</h2>
    ${toBanner(model)}
    ${model.projects.length ? "" : `<div class="card"><h3>No projects yet</h3><p class="muted">Take-off groups belong to a project. On the desktop, press <b>Write project list</b>, then open <b>Sync</b> here and tap <b>Sync now</b>.</p></div>`}
    <div class="toolbar">
      <select id="toFilter" aria-label="Project">${projectOptions}</select>
      <button class="btn" id="toNewGroup" ${model.projects.length ? "" : "disabled"}>New group</button>
    </div>
    ${shown.length ? shown.map((g) => {
      const project = toFindProject(model.projects, g);
      const count = model.cards.filter((c) => c.data.groupId === g.id).length;
      const [kind, label] = model.conflicted.has(g.id) ? ["bad", "Needs decision"] : TO_BADGE[fsp.sync.recordState(g)];
      return `<a class="card link-card" href="#/takeoff/${escapeHtml(g.id)}">
        <div class="row"><div class="grow"><b>${escapeHtml(g.data.name || "Untitled group")}</b>
        <div class="sub">${escapeHtml(project ? toProjectLabel(project) : "Project not in your list")} · ${count} take-off${count === 1 ? "" : "s"}</div></div>
        <span class="badge ${kind}">${label}</span></div></a>`;
    }).join("") : `<div class="empty-state">No take-off groups${filter === "all" ? " yet" : " for this project"}.</div>`}`;

  document.getElementById("toFilter").onchange = (ev) => { renderTakeoffGroups.filter = ev.target.value; renderTakeoffGroups(); };
  document.getElementById("toNewGroup").onclick = () => {
    const preset = filter !== "all" ? filter : "";
    openModal("New take-off group",
      `<label class="field">Group name<input id="tgName" maxlength="120" placeholder="e.g. Ground floor finishes"></label>
       <label class="field">Project<select id="tgProject"><option value="">Choose a project</option>${model.projects.map((p) => `<option value="${escapeHtml(p.key)}" ${p.key === preset ? "selected" : ""}>${escapeHtml(toProjectLabel(p))}</option>`).join("")}</select></label>`,
      async () => {
        const name = document.getElementById("tgName").value.trim();
        const project = model.projects.find((p) => p.key === document.getElementById("tgProject").value);
        if (!name) return showStatus("Enter a group name.", true);
        if (!project) return showStatus("Choose a project.", true);
        await fsp.sync.createRecord({ type: TO_GROUP, data: { name }, companyKey: project.companyKey, projectId: project.id });
        closeModal();
        renderTakeoffGroups();
      });
  };
}

async function renderTakeoffGroup(groupId) {
  const main = document.getElementById("main");
  const model = await toLoad();
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) {
    main.innerHTML = `${toBackLink("#/takeoff", "Take-Off")}<div class="card"><h3>Group not found</h3><p class="muted">It may have been deleted.</p></div>`;
    return;
  }
  const project = toFindProject(model.projects, group);
  const cards = model.cards.filter((c) => c.data.groupId === groupId).sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""));
  const conflicted = model.conflicted.has(group.id);

  main.innerHTML = `
    ${toBackLink("#/takeoff", "Take-Off")}
    <h2>${escapeHtml(group.data.name || "Untitled group")}</h2>
    <p class="muted">${escapeHtml(project ? toProjectLabel(project) : "Project not in your list")}</p>
    ${toBanner(model)}
    <div class="toolbar">
      <a class="btn" id="toAddCard" href="#/takeoff/${escapeHtml(groupId)}/new">Add take-off</a>
      <button class="btn secondary" id="toRenameGroup" ${conflicted ? "disabled" : ""}>Rename</button>
      <button class="btn danger" id="toDeleteGroup" ${conflicted ? "disabled" : ""}>Delete</button>
    </div>
    ${cards.length ? cards.map((c) => {
      const [kind, label] = model.conflicted.has(c.id) ? ["bad", "Needs decision"] : TO_BADGE[fsp.sync.recordState(c)];
      const n = toCountItems(c.data.lineItems);
      return `<a class="card link-card" href="#/takeoff/${escapeHtml(groupId)}/${escapeHtml(c.id)}">
        <div class="row"><div class="grow"><b>${escapeHtml(c.data.title || "Untitled")}</b>
        <div class="sub">${n} item${n === 1 ? "" : "s"}${c.data.date ? " · " + escapeHtml(c.data.date) : ""}${c.data.notes ? " · " + escapeHtml(c.data.notes.slice(0, 60)) : ""}</div></div>
        <span class="badge ${kind}">${label}</span></div></a>`;
    }).join("") : `<div class="empty-state">No take-offs in this group yet.</div>`}`;

  document.getElementById("toRenameGroup").onclick = () => {
    openModal("Rename group", `<label class="field">Group name<input id="tgName" maxlength="120" value="${escapeHtml(group.data.name || "")}"></label>`, async () => {
      const name = document.getElementById("tgName").value.trim();
      if (!name) return showStatus("Enter a group name.", true);
      await fsp.sync.saveRecord(group.id, { ...group.data, name });
      closeModal();
      renderTakeoffGroup(groupId);
    });
  };
  document.getElementById("toDeleteGroup").onclick = () => {
    openModal("Delete group?", `<p>“${escapeHtml(group.data.name || "Untitled group")}” and its ${cards.length} take-off${cards.length === 1 ? "" : "s"} will be deleted here and on the desktop.</p>`, async () => {
      for (const c of cards) await fsp.sync.deleteRecord(c.id);
      await fsp.sync.deleteRecord(group.id);
      closeModal();
      location.hash = "#/takeoff";
    }, "Delete");
  };
}

function toLineRowHtml(l) {
  if (l.kind === "header") {
    return `<div class="to-line header" data-id="${escapeHtml(l.id)}" data-kind="header">
      <input class="to-desc" placeholder="Heading" value="${escapeHtml(l.description || "")}">
      <button class="btn danger small to-remove" type="button" aria-label="Remove heading">×</button></div>`;
  }
  const unitList = TO_UNITS.includes(l.unit) || !l.unit ? TO_UNITS : TO_UNITS.concat([l.unit]);
  return `<div class="to-line" data-id="${escapeHtml(l.id)}" data-kind="item">
    <input class="to-desc" placeholder="Description" value="${escapeHtml(l.description || "")}">
    <div class="to-qtyrow">
      <input class="to-qty" type="number" inputmode="decimal" step="any" min="0" placeholder="Qty" value="${l.quantity === "" || l.quantity == null ? "" : escapeHtml(l.quantity)}">
      <select class="to-unit"><option value="">Unit</option>${unitList.map((u) => `<option ${u === l.unit ? "selected" : ""}>${escapeHtml(u)}</option>`).join("")}</select>
      <button class="btn danger small to-remove" type="button" aria-label="Remove item">×</button>
    </div>
    <input class="to-notes" placeholder="Notes" value="${escapeHtml(l.notes || "")}"></div>`;
}

function toReadRows(root) {
  return [...root.querySelectorAll(".to-line")].map((el) => ({
    id: el.dataset.id,
    kind: el.dataset.kind,
    description: el.querySelector(".to-desc").value,
    quantity: el.querySelector(".to-qty") ? el.querySelector(".to-qty").value : "",
    unit: el.querySelector(".to-unit") ? el.querySelector(".to-unit").value : "",
    notes: el.querySelector(".to-notes") ? el.querySelector(".to-notes").value : "",
  }));
}

async function renderTakeoffCard(groupId, cardId) {
  const main = document.getElementById("main");
  const model = await toLoad();
  const group = model.groups.find((g) => g.id === groupId);
  const isNew = cardId === "new";
  const card = isNew ? null : model.cards.find((c) => c.id === cardId && c.data.groupId === groupId);
  if (!group || (!isNew && !card)) {
    main.innerHTML = `${toBackLink("#/takeoff", "Take-Off")}<div class="card"><h3>Not found</h3><p class="muted">It may have been deleted.</p></div>`;
    return;
  }
  if (card && model.conflicted.has(card.id)) {
    main.innerHTML = `${toBackLink("#/takeoff/" + groupId, group.data.name || "Group")}<div class="card"><h3>Needs your decision</h3><p class="muted">This take-off was changed on both the phone and the desktop. Choose which version to keep before editing it.</p><a class="btn block" href="#/conflicts">Decide now</a></div>`;
    return;
  }
  const d = card ? card.data : { title: "", notes: "", date: new Date().toISOString().slice(0, 10), lineItems: [] };
  const lines = d.lineItems && d.lineItems.length ? d.lineItems : [];

  main.innerHTML = `
    ${toBackLink("#/takeoff/" + groupId, group.data.name || "Group")}
    <h2>${isNew ? "New take-off" : "Edit take-off"}</h2>
    <div class="card">
      <label class="field">Sector<input id="toTitle" maxlength="120" placeholder="e.g. Tiling / Flooring" value="${escapeHtml(d.title || "")}"></label>
      <label class="field">Date<input id="toDate" type="date" value="${escapeHtml(d.date || "")}"></label>
      <label class="field">Notes<textarea id="toNotes" rows="3">${escapeHtml(d.notes || "")}</textarea></label>
    </div>
    <div class="card"><h3>Items</h3>
      <div id="toLines">${lines.map(toLineRowHtml).join("")}</div>
      <div class="toolbar">
        <button class="btn secondary" id="toAddItem" type="button">Add item</button>
        <button class="btn secondary" id="toAddHeader" type="button">Add heading</button>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn" id="toSave">Save</button>
      ${isNew ? "" : `<button class="btn danger" id="toDelete">Delete</button>`}
    </div>
    <div id="toResult"></div>`;

  const box = document.getElementById("toLines");
  if (!lines.length) box.insertAdjacentHTML("beforeend", toLineRowHtml({ id: toNewLineId(), kind: "item" }));
  box.onclick = (ev) => { const b = ev.target.closest(".to-remove"); if (b) b.closest(".to-line").remove(); };
  document.getElementById("toAddItem").onclick = () => box.insertAdjacentHTML("beforeend", toLineRowHtml({ id: toNewLineId(), kind: "item" }));
  document.getElementById("toAddHeader").onclick = () => box.insertAdjacentHTML("beforeend", toLineRowHtml({ id: toNewLineId(), kind: "header" }));

  document.getElementById("toSave").onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const title = document.getElementById("toTitle").value.trim();
    if (!title) { document.getElementById("toResult").innerHTML = resultBox(["Enter a sector name."], true); return; }
    const data = {
      ...(card ? card.data : {}),
      groupId,
      title,
      date: document.getElementById("toDate").value,
      notes: document.getElementById("toNotes").value,
      lineItems: toCleanLines(toReadRows(box), card ? card.data.lineItems : []),
    };
    if (card) await fsp.sync.saveRecord(card.id, data);
    else await fsp.sync.createRecord({ type: TO_CARD, data, companyKey: group.companyKey, projectId: group.projectId });
    location.hash = "#/takeoff/" + groupId;
  });

  const del = document.getElementById("toDelete");
  if (del) del.onclick = () => {
    openModal("Delete take-off?", `<p>“${escapeHtml(d.title || "Untitled")}” will be deleted here and on the desktop.</p>`, async () => {
      await fsp.sync.deleteRecord(card.id);
      closeModal();
      location.hash = "#/takeoff/" + groupId;
    }, "Delete");
  };
}

// ---------- conflicts ("ask me each time") ----------

async function renderConflictsScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Decisions</h2><div class="card"><p class="muted">Storage isn't available.</p></div>`; return; }
  const conflicts = await fsp.sync.getConflicts();
  const sideHtml = (title, snap, type) => `<div class="side"><div class="side-title">${escapeHtml(title)}</div><div class="sub">${escapeHtml(formatWhen(snap.updatedAt))}</div>${toDescribe(type, snap).map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`;
  const records = {};
  for (const c of conflicts) records[c.id] = await fsp.db.get("records", c.id);

  main.innerHTML = `
    ${toBackLink("#/takeoff", "Take-Off")}
    <h2>Decisions</h2>
    ${conflicts.length ? `<p class="muted">These were changed on both the phone and the desktop. Choose the version to keep; your choice replaces both.</p>` : `<div class="empty-state">Nothing to decide.</div>`}
    ${conflicts.map((c) => {
      const mine = records[c.id] ? { vv: records[c.id].vv, data: records[c.id].data, deleted: records[c.id].deleted, updatedAt: records[c.id].updatedAt } : c.local;
      return `<div class="card conflict" data-id="${escapeHtml(c.id)}">
        ${sideHtml("On this phone", mine, c.type)}
        ${sideHtml("On the desktop", c.incoming, c.type)}
        <div class="toolbar">
          <button class="btn keep-local" type="button">Keep the phone's</button>
          <button class="btn secondary keep-incoming" type="button">Keep the desktop's</button>
        </div></div>`;
    }).join("")}
    <div id="conflictResult"></div>`;

  main.querySelectorAll(".conflict").forEach((el) => {
    const resolve = (keep) => (ev) => withBusy(ev.currentTarget, async () => {
      await fsp.sync.resolveConflict(el.dataset.id, keep);
      await renderConflictsScreen();
      document.getElementById("conflictResult").innerHTML = resultBox(["Done. Your choice goes to the desktop on the next sync."]);
    });
    el.querySelector(".keep-local").onclick = resolve("local");
    el.querySelector(".keep-incoming").onclick = resolve("incoming");
  });
}
