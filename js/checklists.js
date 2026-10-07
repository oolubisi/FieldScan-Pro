// ===== Inspection checklists =====
// The same file runs on the phone and the desktop. An inspection holds a list of items:
//   { id, text, result: "" | "pass" | "fail" | "na", note, wantTask, taskId }
// A failed item can ask for a task ("wantTask"); the app that saves the inspection creates it and records its id in "taskId".

const CL_TEMPLATES = {
  "Foundation / strip footing": ["Excavation depth and width as drawings", "Bottom clean, free of loose soil and water", "Blinding concrete placed", "Reinforcement size, spacing and cover", "Formwork secure, plumb and level", "Concrete grade confirmed", "Curing arrangements"],
  "Slab pour": ["Hardcore compacted and blinded", "DPM laid and lapped", "Reinforcement size and spacing", "Cover blocks in place", "Edge formwork level", "Services and conduits sleeved before pour", "Concrete mix and slump test", "Curing planned"],
  "Blockwork": ["Block size and strength", "Mortar mix", "Joint thickness", "Plumb and level", "Bonding and laps", "Lintels over openings", "Starter bars tied to columns"],
  "Roofing": ["Timber sizes and spacing", "Trusses or rafters fixed", "Straps and fixings", "Roof sheets laid and lapped", "Ridge and flashings", "Gutters and fascia", "Leak check"],
  "Plumbing first fix": ["Pipe size and material to spec", "Falls on waste pipes", "Joints sealed", "Pressure test", "Clips and fixings", "Sleeves through walls", "Isolation valves"],
  "Electrical first fix": ["Conduit routes", "Box positions and heights", "Cable sizes", "Earthing continuity", "Distribution board location", "Conduit joints", "Insulation test"],
  "Handover / snag list": ["Wall paint finish", "Floor tiles: lippage and hollow spots", "Doors and windows operate", "Plumbing fixtures work", "Electrical points work", "Ceiling finish", "External works and drainage", "Cleanliness"],
};

function clId() { return "i" + Math.random().toString(36).slice(2, 10); }

function clFromTemplate(name) {
  return (CL_TEMPLATES[name] || []).map((text) => ({ id: clId(), text, result: "", note: "", wantTask: true, taskId: "" }));
}

function clSummary(items) {
  const s = { pass: 0, fail: 0, na: 0, open: 0 };
  (items || []).forEach((i) => { if (i.result === "pass") s.pass++; else if (i.result === "fail") s.fail++; else if (i.result === "na") s.na++; else s.open++; });
  return s;
}

/** Keeps only well-formed items (used when reading data from the other device). */
function clClean(items) {
  return (Array.isArray(items) ? items : []).filter((i) => i && typeof i.text === "string" && i.text.trim()).map((i) => ({
    id: String(i.id || clId()), text: i.text.trim().slice(0, 200), result: ["pass", "fail", "na"].includes(i.result) ? i.result : "",
    note: String(i.note || "").slice(0, 500), wantTask: i.wantTask !== false, taskId: String(i.taskId || ""),
  }));
}

function clEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function clStyle() {
  if (document.getElementById("clStyle")) return;
  const st = document.createElement("style");
  st.id = "clStyle";
  st.textContent = `.cl-item{border:1px solid var(--line,#dde1e7);border-left-width:5px;border-radius:10px;padding:8px 10px;margin:8px 0;background:var(--card,#fff)}
.cl-item.pass{border-left-color:#16a34a}.cl-item.fail{border-left-color:#dc2626}.cl-item.na{border-left-color:#94a3b8}
.cl-top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.cl-text{font-weight:600;flex:1}
.cl-seg{display:flex;gap:6px;margin-top:6px}.cl-seg button{flex:1;padding:8px 4px;border-radius:8px;border:1px solid var(--input-line,#c9ced6);background:var(--card,#fff);color:inherit;font-weight:600;cursor:pointer}
.cl-seg button.on.pass{background:#16a34a;color:#fff;border-color:#16a34a}.cl-seg button.on.fail{background:#dc2626;color:#fff;border-color:#dc2626}.cl-seg button.on.na{background:#64748b;color:#fff;border-color:#64748b}
.cl-x{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer;opacity:.6}
.cl-sum{font-size:13px;margin:6px 0;opacity:.85}.cl-add{display:flex;gap:6px;margin:6px 0;flex-wrap:wrap}.cl-add input,.cl-add select{flex:1;min-width:120px}`;
  document.head.appendChild(st);
}

/**
 * Draws the checklist into `box` and keeps `items` up to date as the person works.
 * Returns { getItems() }. `opts.onChange` runs after every change.
 */
function clMount(box, initial, opts) {
  clStyle();
  const items = clClean(initial);
  const onChange = (opts && opts.onChange) || (() => {});
  const draw = () => {
    const s = clSummary(items);
    box.innerHTML = `<h3>Checklist${items.length ? ` (${items.length})` : ""}</h3>
      ${items.length ? `<div class="cl-sum">${s.pass} pass · ${s.fail} fail · ${s.na} n/a · ${s.open} to check</div>` : ""}
      <div class="cl-add"><select class="cl-tpl"><option value="">Add a checklist from a template…</option>${Object.keys(CL_TEMPLATES).map((n) => `<option>${clEsc(n)}</option>`).join("")}</select></div>
      ${items.map((i, n) => `<div class="cl-item ${i.result}" data-n="${n}">
        <div class="cl-top"><div class="cl-text">${clEsc(i.text)}</div><button type="button" class="cl-x" aria-label="Remove item">×</button></div>
        <div class="cl-seg">${["pass", "fail", "na"].map((r) => `<button type="button" data-r="${r}" class="${r} ${i.result === r ? "on" : ""}">${r === "na" ? "N/A" : r[0].toUpperCase() + r.slice(1)}</button>`).join("")}</div>
        ${i.result === "fail" || i.note ? `<input class="cl-note" placeholder="Note: what is wrong?" maxlength="500" value="${clEsc(i.note)}" style="margin-top:6px;width:100%;">` : ""}
        ${i.result === "fail" ? (i.taskId ? `<div class="cl-sum">✓ Task created for this defect</div>` : `<label style="display:flex;gap:8px;align-items:center;font-weight:400;font-size:13px;margin:6px 0 0;"><input type="checkbox" class="cl-want" ${i.wantTask ? "checked" : ""} style="width:auto;"> Create a task for this when saved</label>`) : ""}
      </div>`).join("")}
      <div class="cl-add"><input class="cl-new" placeholder="Add your own item" maxlength="200"><button type="button" class="btn secondary cl-addbtn">Add</button></div>`;
    box.querySelector(".cl-tpl").onchange = (ev) => { clFromTemplate(ev.target.value).forEach((i) => items.push(i)); onChange(); draw(); };
    const add = () => { const v = box.querySelector(".cl-new").value.trim(); if (!v) return; items.push({ id: clId(), text: v.slice(0, 200), result: "", note: "", wantTask: true, taskId: "" }); onChange(); draw(); };
    box.querySelector(".cl-addbtn").onclick = add;
    box.querySelector(".cl-new").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } };
    box.querySelectorAll(".cl-item").forEach((el) => {
      const i = items[Number(el.dataset.n)];
      el.querySelector(".cl-x").onclick = () => { items.splice(items.indexOf(i), 1); onChange(); draw(); };
      el.querySelectorAll(".cl-seg button").forEach((b) => { b.onclick = () => { i.result = i.result === b.dataset.r ? "" : b.dataset.r; onChange(); draw(); }; });
      const note = el.querySelector(".cl-note"); if (note) note.oninput = () => { i.note = note.value; onChange(); };
      const want = el.querySelector(".cl-want"); if (want) want.onchange = () => { i.wantTask = want.checked; onChange(); };
    });
  };
  draw();
  return { getItems: () => clClean(items).map((c) => { const o = items.find((x) => x.id === c.id); return { ...c, result: o.result, note: o.note, wantTask: o.wantTask, taskId: o.taskId }; }) };
}
