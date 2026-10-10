// ===== Reports you can save as PDF =====
// Builds the report on a hidden page area and opens the phone's print dialog; "Save as PDF" there makes the file to share.

function rpEsc(s) { return escapeHtml(s); }
const rpPara = (t) => rpEsc(t || "").replace(/\n/g, "<br>");

function rpPrint(html) {
  let area = document.getElementById("printArea");
  if (!area) { area = document.createElement("div"); area.id = "printArea"; document.body.appendChild(area); }
  area.innerHTML = `<div class="rp">${html}</div>`;
  const clear = () => { area.innerHTML = ""; window.removeEventListener("afterprint", clear); };
  window.addEventListener("afterprint", clear);
  window.print();
}

function rpPhotos(list, stages) {
  return list.length ? `<h3>Photographs</h3><div class="rp-photos">${list.map((p, i) => { const st = stages && stages[p.id]; return `<div class="rp-photo"><img src="data:${rpEsc(p.data.mime)};base64,${p.data.b64}" alt=""><div>Photo ${i + 1}${st ? " (" + rpEsc(st) + ")" : ""}${p.data.caption ? ": " + rpEsc(p.data.caption) : ""}</div></div>`; }).join("")}</div>` : "";
}

/** Snag list for one project: counts, each snag with who it is assigned to, its dates, and its photos (with their Before / During / After tags). */
function rpSnagsHtml(project, snags, allPhotos) {
  const open = snags.filter((s) => s.data.status !== "Completed").length;
  return `<h1>Snag Report</h1><h2>${rpEsc(project ? project.displayNumber + " — " + project.clientName : "Project")}</h2>
    <table class="rp-meta"><tr><td>Date</td><td>${rpEsc(new Date().toISOString().slice(0, 10))}</td></tr><tr><td>Open</td><td>${open}</td></tr><tr><td>Completed</td><td>${snags.length - open}</td></tr></table>
    ${snags.map((s, i) => {
      const d = s.data, done = d.status === "Completed";
      const photos = allPhotos.filter((ph) => ph.data.parentId === s.id).sort((a, b) => String(a.data.takenAt).localeCompare(String(b.data.takenAt)));
      return `<div class="rp-day"><h3>${i + 1}. ${rpEsc(d.title || "Untitled snag")} — ${done ? "COMPLETED" : "OPEN"}</h3>
        <table class="rp-meta">${d.notes ? `<tr><td>Details</td><td>${rpPara(d.notes)}</td></tr>` : ""}${d.assigned ? `<tr><td>Assigned to</td><td>${rpEsc(d.assigned)}</td></tr>` : ""}<tr><td>Logged</td><td>${rpEsc(d.dateLogged || "")}</td></tr>${done && d.dateCompleted ? `<tr><td>Completed</td><td>${rpEsc(d.dateCompleted)}</td></tr>` : ""}</table>
        ${photos.length ? `<div class="rp-photos">${photos.map((p, k) => { const st = (d.photoStages || {})[p.id]; return `<div class="rp-photo"><img src="data:${rpEsc(p.data.mime)};base64,${p.data.b64}" alt=""><div>${st ? rpEsc(st) + (p.data.caption ? ": " : "") : ""}${p.data.caption ? rpEsc(p.data.caption) : st ? "" : "Photo " + (k + 1)}</div></div>`; }).join("")}</div>` : ""}</div>`;
    }).join("")}`;
}

const rpFileName = (s) => String(s || "report").replace(/[^A-Za-z0-9._ -]+/g, "_").trim().slice(0, 60) || "report";
function rpShareInspection(rec, projects, allPhotos) {
  const project = projects.find((p) => p.id === rec.projectId && p.companyKey === rec.companyKey);
  const html = rpInspectionHtml(rec, project, allPhotos.filter((p) => p.data.parentId === rec.id).sort((a, b) => String(a.data.takenAt).localeCompare(String(b.data.takenAt))));
  return rpSharePdf(html, rpFileName("Inspection " + (rec.data.title || "")), "Inspection report");
}

function rpInspectionHtml(rec, project, photos) {
  const d = rec.data, s = clSummary(d.items || []);
  const res = { pass: "Pass", fail: "FAIL", na: "N/A", "": "Not checked" };
  return `<h1>Inspection Report</h1><h2>${rpEsc(d.title || "Untitled inspection")}</h2>
    <table class="rp-meta"><tr><td>Project</td><td>${rpEsc(project ? project.displayNumber + " — " + project.clientName : "General (no project)")}</td></tr>
    <tr><td>Location</td><td>${rpEsc(d.location || "")}</td></tr><tr><td>Inspector</td><td>${rpEsc(d.inspectorName || "")}</td></tr><tr><td>Date</td><td>${rpEsc(d.inspectionDate || "")}</td></tr></table>
    ${d.intro ? `<h3>Introduction</h3><p>${rpPara(d.intro)}</p>` : ""}
    ${(d.items || []).length ? `<h3>Checklist</h3><p>${s.pass} pass · ${s.fail} fail · ${s.na} n/a · ${s.open} not checked</p><table class="rp-grid">${d.items.map((i) => `<tr><td>${rpEsc(i.text)}${i.note ? `<div>${rpEsc(i.note)}</div>` : ""}</td><td class="${i.result === "fail" ? "rp-fail" : ""}">${res[i.result || ""]}</td></tr>`).join("")}</table>` : ""}
    ${d.conclusion ? `<h3>Observations / Conclusions</h3><p>${rpPara(d.conclusion)}</p>` : ""}
    ${rpPhotos(photos)}`;
}

function rpPrintInspection(rec, projects, allPhotos) {
  const project = projects.find((p) => p.id === rec.projectId && p.companyKey === rec.companyKey);
  rpPrint(rpInspectionHtml(rec, project, allPhotos.filter((p) => p.data.parentId === rec.id).sort((a, b) => String(a.data.takenAt).localeCompare(String(b.data.takenAt)))));
}

function rpDiaryHtml(entries, projects, allPhotos) {
  const first = entries[0].data.date, last = entries[entries.length - 1].data.date;
  return `<h1>Site Diary</h1><h2>${rpEsc(first === last ? first : first + " to " + last)}</h2>` + entries.map((r) => {
    const d = r.data, p = projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
    const row = (label, v) => v ? `<tr><td>${label}</td><td>${rpPara(v)}</td></tr>` : "";
    return `<div class="rp-day"><h3>${rpEsc(d.date || "")}${d.weather ? " · " + rpEsc(d.weather) : ""}${p ? " · " + rpEsc(p.displayNumber) : ""}</h3>
      <table class="rp-meta">${row("Labour", d.labour)}${row("Deliveries", d.deliveries)}${row("Instructions", d.instructions)}${row("Progress", d.progress)}${row("Notes", d.notes)}</table>
      ${rpPhotos(allPhotos.filter((ph) => ph.data.parentId === r.id).sort((a, b) => String(a.data.takenAt).localeCompare(String(b.data.takenAt))))}</div>`;
  }).join("");
}

function rpPrintDiary(entries, projects, allPhotos) { rpPrint(rpDiaryHtml(entries, projects, allPhotos)); }

function rpShareDiary(entries, projects, allPhotos) {
  const first = entries[0].data.date || "";
  return rpSharePdf(rpDiaryHtml(entries, projects, allPhotos), rpFileName("Site diary " + first), "Site diary");
}
function rpPrintSnags(project, snags, allPhotos) { rpPrint(rpSnagsHtml(project, snags, allPhotos)); }
function rpShareSnags(project, snags, allPhotos) { return rpSharePdf(rpSnagsHtml(project, snags, allPhotos), rpFileName("Snags " + (project ? project.displayNumber : "")), "Snag report"); }
