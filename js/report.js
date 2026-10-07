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

function rpPhotos(list) {
  return list.length ? `<h3>Photographs</h3><div class="rp-photos">${list.map((p, i) => `<div class="rp-photo"><img src="data:${rpEsc(p.data.mime)};base64,${p.data.b64}" alt=""><div>Photo ${i + 1}${p.data.caption ? ": " + rpEsc(p.data.caption) : ""}</div></div>`).join("")}</div>` : "";
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
