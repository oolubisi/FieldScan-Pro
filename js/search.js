// ===== Search across tasks, inspections and take-offs =====

/** Lower-case text of a record's own content (no photo data), for matching. */
function srText(r) {
  const parts = [];
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.keys(v).forEach((k) => { if (k !== "b64") walk(v[k]); });
  };
  walk(r.data);
  return parts.join(" \n ").toLowerCase();
}

/** Every word typed must appear somewhere in the record. */
function srMatch(query, r) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const text = srText(r);
  return words.every((w) => text.includes(w));
}

const SR_KINDS = {
  task: { icon: "✅", label: "Task", href: (r) => `#/tasks/${r.id}` },
  inspection: { icon: "🔍", label: "Inspection", href: (r) => `#/inspections/${r.id}` },
  takeoff: { icon: "📐", label: "Take-off", href: (r) => `#/takeoff/${r.data.groupId}/${r.id}` },
  "takeoff-group": { icon: "📁", label: "Take-off group", href: (r) => `#/takeoff/${r.id}` },
};

async function srLoad() {
  const projects = coFilter(await fsp.sync.listProjects());
  const recs = [];
  for (const t of Object.keys(SR_KINDS)) recs.push(...coFilter(await fsp.sync.getRecords(t)));
  return { projects, recs };
}

function srTitle(r) { return r.data.title || r.data.name || "Untitled"; }

async function renderSearchScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Search</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const m = await srLoad();
  main.innerHTML = `<h2>Search</h2>
    <input id="srBox" type="search" placeholder="Search tasks, inspections, take-offs…" autocomplete="off" value="${escapeHtml(renderSearchScreen.last || "")}">
    <div id="srOut" style="margin-top:12px;"></div>`;
  const out = document.getElementById("srOut"), box = document.getElementById("srBox");
  const show = () => {
    const q = box.value.trim();
    renderSearchScreen.last = q;
    if (!q) { out.innerHTML = `<div class="empty-state">Type a word or two. Every word must match.</div>`; return; }
    const hits = m.recs.filter((r) => srMatch(q, r)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 50);
    out.innerHTML = hits.length ? `<div class="card feed">${hits.map((r) => {
      const k = SR_KINDS[r.type], p = m.projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
      return `<a class="row" href="${escapeHtml(k.href(r))}" style="color:inherit;text-decoration:none;"><div class="ico">${k.icon}</div><div class="grow"><b>${escapeHtml(srTitle(r))}</b><div class="sub">${escapeHtml([k.label, p ? p.displayNumber : ""].filter(Boolean).join(" · "))}</div></div></a>`;
    }).join("")}</div>` : `<div class="empty-state">Nothing matches “${escapeHtml(q)}”.</div>`;
  };
  box.oninput = show;
  show();
}
