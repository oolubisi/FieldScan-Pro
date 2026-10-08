// ===== Home: today at a glance =====
// Read-only summary of what's on this phone: counts, things that need attention, each project, and recent activity.

const HM_PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#16a34a", "#0891b2", "#ea580c"];

/** The same project always gets the same accent colour. */
function hmColor(key) {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HM_PALETTE[h % HM_PALETTE.length];
}

function hmGreeting(now) {
  const h = (now || new Date()).getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
function hmAgo(iso, now) {
  const t = new Date(iso).getTime(), n = (now || new Date()).getTime();
  if (!t) return "";
  const m = Math.round((n - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 48) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Everything the Home screen shows, worked out from the stored records. */
async function hmLoad(now) {
  const n = now || new Date();
  const status = await fsp.sync.getStatus();
  const projects = coFilter(await fsp.sync.listProjects());
  const [tasks, inspections, cards, photos] = await Promise.all(["task", "inspection", "takeoff", "photo"].map(async (t) => coFilter(await fsp.sync.getRecords(t))));
  const month = n.toISOString().slice(0, 7);
  const open = tasks.filter((t) => t.data.status !== "Done");
  const overdue = open.filter((t) => tsDueStatus(t.data.dueDate) === "overdue").length;
  const dueToday = open.filter((t) => tsDueStatus(t.data.dueDate) === "today").length;
  const done = tasks.length - open.length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const perProject = projects.map((p) => {
    const mine = (r) => r.projectId === p.id && r.companyKey === p.companyKey;
    const t = tasks.filter(mine), openN = t.filter((x) => x.data.status !== "Done").length;
    return { project: p, color: hmColor(p.key || p.id), open: openN, done: t.length - openN, inspections: inspections.filter(mine).length, cards: cards.filter(mine).length, photos: photos.filter(mine).length };
  }).filter((x) => x.open + x.done + x.inspections + x.cards > 0)
    .sort((a, b) => b.open - a.open || b.inspections - a.inspections).slice(0, 6);
  const label = (r) => ({ task: ["✅", "Task"], inspection: ["🔍", "Inspection"], takeoff: ["📐", "Take-off"] }[r.type]);
  const link = (r) => r.type === "task" ? `#/tasks/${r.id}` : r.type === "inspection" ? `#/inspections/${r.id}` : `#/takeoff/${r.data.groupId}/${r.id}`;
  const activity = [...tasks, ...inspections, ...cards].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8).map((r) => {
    const p = projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
    return { icon: label(r)[0], kind: label(r)[1], title: r.data.title || "Untitled", project: p ? p.displayNumber : "", when: hmAgo(r.updatedAt, n), href: link(r) };
  });
  return {
    overdue, dueToday, status, hasProjects: Object.keys(status.projectsMeta).length > 0,
    openTasks: open.length, pct, inspectionsThisMonth: inspections.filter((r) => String(r.data.inspectionDate || r.updatedAt).startsWith(month)).length,
    cards: cards.length, photos: photos.length, waiting: status.counts.unsent, conflicts: status.conflicts, perProject, activity,
  };
}

async function renderHomeScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Home</h2><div class="card"><h3>Storage isn't available</h3><p class="muted">This browser isn't letting the app save data.</p></div>`; return; }
  const m = await hmLoad();
  const now = new Date();
  try { if (navigator.setAppBadge) (m.overdue + m.dueToday) ? navigator.setAppBadge(m.overdue + m.dueToday) : navigator.clearAppBadge(); } catch (e) { /* not supported */ }
  const alerts = [
    m.conflicts ? `<a class="alert" style="--c:var(--bad)" href="#/conflicts">⚠️ <span>${m.conflicts} record${m.conflicts === 1 ? "" : "s"} changed on both phone and desktop. Tap to decide.</span></a>` : "",
    m.overdue ? `<a class="alert" style="--c:var(--bad)" href="#/tasks" data-overdue>⏰ <span>${m.overdue} task${m.overdue === 1 ? " is" : "s are"} overdue.</span></a>` : "",
    m.dueToday ? `<a class="alert" style="--c:var(--warn)" href="#/tasks">📅 <span>${m.dueToday} task${m.dueToday === 1 ? " is" : "s are"} due today.</span></a>` : "",
    m.waiting ? `<a class="alert" style="--c:var(--warn)" href="#/sync">⏳ <span>${m.waiting} record${m.waiting === 1 ? "" : "s"} waiting to be sent to the desktop.</span></a>` : "",
    m.hasProjects ? "" : `<a class="alert" style="--c:var(--accent)" href="#/sync">📂 <span>No project list yet. Open Sync to receive it from the desktop.</span></a>`,
  ].join("");
  const tile = (href, num, lbl, color, ico) => `<a class="tile" href="${href}" style="--c:${color}"><div class="ico">${ico}</div><div><div class="num">${num}</div><div class="lbl">${lbl}</div></div></a>`;
  main.innerHTML = `
    <div class="hero"><h2>${hmGreeting(now)}</h2>
      <div class="date">${escapeHtml(now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }))}</div>
      <div class="chips"><a class="chip" href="#/sync">${m.waiting || m.conflicts ? "↻ Needs syncing" : "✓ All synced"}</a><span class="chip">${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}</span></div></div>
    ${alerts}
    <div class="tiles">
      <a class="tile" href="#/tasks" style="--c:#16a34a"><div class="ring" style="--p:${m.pct}"><span>${m.pct}%</span></div><div><div class="num">${m.openTasks}</div><div class="lbl">Open tasks</div></div></a>
      ${tile("#/inspections", m.inspectionsThisMonth, "Inspections this month", "#7c3aed", "🔍")}
      ${tile("#/takeoff", m.cards, "Take-off cards", "#d97706", "📐")}
      ${tile("#/inspections", m.photos, "Photos", "#0891b2", "📷")}
    </div>
    <div class="section-title">Quick add</div>
    <div class="quick"><a href="#/diary/new"><span>📒</span>Diary</a><a href="#/tasks"><span>✅</span>Task</a><a href="#/inspections/new"><span>🔍</span>Inspection</a><a href="#/takeoff"><span>📐</span>Take-off</a></div>
    ${m.perProject.length ? `<div class="section-title">Projects</div>${m.perProject.map((x) => {
      const total = x.open + x.done;
      return `<div class="card proj" style="--c:${x.color}"><b>${escapeHtml(x.project.displayNumber)}</b> <span class="muted">${escapeHtml(x.project.clientName || "")}</span>
        <div class="stats"><span><b>${x.open}</b> open</span><span><b>${x.done}</b> done</span><span><b>${x.inspections}</b> inspections</span><span><b>${x.cards}</b> take-offs</span><span><b>${x.photos}</b> photos</span></div>
        ${total ? `<div class="bar" title="${x.done} of ${total} tasks done"><i style="width:${Math.round((x.done / total) * 100)}%"></i></div>` : ""}</div>`;
    }).join("")}` : ""}
    <div class="section-title">Recent activity</div>
    ${m.activity.length ? `<div class="card feed">${m.activity.map((a) => `<a class="row" href="${escapeHtml(a.href)}" style="color:inherit;text-decoration:none;"><div class="ico">${a.icon}</div><div class="grow"><b>${escapeHtml(a.title)}</b><div class="sub">${escapeHtml([a.kind, a.project].filter(Boolean).join(" · "))}</div></div><span class="sub">${escapeHtml(a.when)}</span></a>`).join("")}</div>` : `<div class="empty-state">Nothing yet. Add a task, an inspection or a take-off to get started.</div>`}`;
}
