// ===== Quick expense capture =====
//   "expense"  data: { date, amount, payee, category, method, note, status: "new" | "added" | "dismissed", paymentId }
// Snap the receipt, type the amount, save. On the desktop it appears under Phone expenses and becomes a Small Expense
// on the project (with the receipt filed in the project's Documents). Once the desktop has handled it, it is shown here as such.

const EXPENSE = "expense";
const EX_CATS = ["Materials", "Labour", "Transport", "Contractor Payment", "Professional Fees", "Government Fees", "Misc"];
const EX_METHODS = ["Cash", "Transfer", "POS", "Cheque"];
const exToday = () => (typeof tsToday === "function" ? tsToday() : new Date().toISOString().slice(0, 10));
const exMoney = (v) => "₦" + moneyValue(v);

async function exLoad() {
  const status = await fsp.sync.getStatus();
  const projects = coFilter(await fsp.sync.listProjects({ excludeProspects: true }));
  const items = coFilter(await fsp.sync.getRecords(EXPENSE));
  const photos = await fsp.sync.getRecords("photo");
  const companies = coCompanies(Object.keys(status.projectsMeta).map((k) => ({ key: k, name: status.projectsMeta[k].name })));
  return { projects, items, photos, companies };
}

async function renderExpensesScreen() {
  const main = document.getElementById("main");
  if (!fsp.sync) { main.innerHTML = `<h2>Expenses</h2><div class="card"><h3>Storage isn't available</h3></div>`; return; }
  const hash = /^#\/expenses\/(.+)$/.exec(location.hash);
  return hash ? renderExpenseForm(hash[1] === "new" ? null : hash[1]) : renderExpenseList();
}

const exStatusBadge = (s) => ({ added: ["ok", "On the desktop ✓"], dismissed: ["wait", "Dismissed"] }[s] || ["wait", "Sent to desktop"]);

async function renderExpenseList() {
  const main = document.getElementById("main");
  const m = await exLoad();
  const items = [...m.items].sort((a, b) => String(b.data.date || "").localeCompare(String(a.data.date || "")) || (a.updatedAt < b.updatedAt ? 1 : -1));
  const month = exToday().slice(0, 7);
  const thisMonth = items.filter((r) => String(r.data.date || "").startsWith(month)).reduce((t, r) => t + (Number(r.data.amount) || 0), 0);
  main.innerHTML = `<h2>Expenses</h2>
    <div class="toolbar"><a class="btn" href="#/expenses/new" ${m.companies.length ? "" : 'aria-disabled="true" style="pointer-events:none;opacity:.5;"'}>Add expense</a></div>
    ${items.length ? `<p class="muted">This month: <b>${exMoney(thisMonth)}</b> across ${items.filter((r) => String(r.data.date || "").startsWith(month)).length} expense(s).</p>
    <div class="card feed">${items.map((r) => {
      const p = m.projects.find((x) => x.id === r.projectId && x.companyKey === r.companyKey);
      const [kind, label] = exStatusBadge(r.data.status);
      const n = m.photos.filter((ph) => ph.data.parentId === r.id).length;
      return `<a class="row" href="#/expenses/${escapeHtml(r.id)}" style="color:inherit;text-decoration:none;"><div class="ico" style="--c:#dc2626">🧾</div><div class="grow"><b>${exMoney(r.data.amount)}</b> <span class="muted">· ${escapeHtml(r.data.payee || "")}</span><div class="sub">${escapeHtml([r.data.date, p ? p.displayNumber : "No project", r.data.category, n ? n + " photo" + (n === 1 ? "" : "s") : ""].filter(Boolean).join(" · "))}</div></div><span class="badge ${kind}">${label}</span></a>`;
    }).join("")}</div>` : `<div class="empty-state">No expenses yet. Tap Add expense, photograph the receipt and save.</div>`}`;
}

async function renderExpenseForm(id) {
  const main = document.getElementById("main");
  const m = await exLoad();
  const r = id ? m.items.find((x) => x.id === id) : null;
  if (id && !r) { main.innerHTML = `${toBackLink("#/expenses", "Expenses")}<div class="card"><h3>Expense not found</h3></div>`; return; }
  const d = r ? r.data : {};
  const locked = r && (d.status === "added");
  const latest = !r ? [...m.items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] : null;
  const companyKey = r ? r.companyKey : (latest && m.companies.some((c) => c.key === latest.companyKey) ? latest.companyKey : (m.companies[0] || {}).key);
  const projects = m.projects.filter((p) => p.companyKey === companyKey);
  const selected = r ? r.projectId : (latest && latest.companyKey === companyKey ? latest.projectId : "") || "";
  const opts = (list, cur) => list.map((x) => `<option ${x === cur ? "selected" : ""}>${escapeHtml(x)}</option>`).join("");
  main.innerHTML = `${toBackLink("#/expenses", "Expenses")}
    <h2>${r ? "Expense" : "Add expense"}</h2>
    ${locked ? `<div class="result-box"><div>The desktop added this to the project's payments. It can no longer be changed here.</div></div>` : ""}
    <div class="card">
      <label class="field">Amount (₦)<input id="exAmount" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeHtml(d.amount != null ? d.amount : "")}" ${locked ? "disabled" : ""}></label>
      <label class="field">Paid to<input id="exPayee" maxlength="120" data-dictate value="${escapeHtml(d.payee || "")}" placeholder="e.g. Bright Hardware" ${locked ? "disabled" : ""}></label>
      <label class="field">Project<select id="exProject" ${locked ? "disabled" : ""}><option value="">Choose project…</option>${projects.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.displayNumber + " — " + p.clientName)}</option>`).join("")}</select></label>
      <label class="field">Date<input id="exDate" type="date" value="${escapeHtml(d.date || exToday())}" ${locked ? "disabled" : ""}></label>
      <label class="field">Category<select id="exCat" ${locked ? "disabled" : ""}>${opts(EX_CATS, d.category || "Materials")}</select></label>
      <label class="field">Paid by<select id="exMethod" ${locked ? "disabled" : ""}>${opts(EX_METHODS, d.method || "Cash")}</select></label>
      <label class="field">Note<textarea id="exNote" rows="2" data-dictate ${locked ? "disabled" : ""}>${escapeHtml(d.note || "")}</textarea></label>
    </div>
    ${r ? `<div class="card" id="exPhotos"></div>` : `<div class="card"><h3>Receipt photo</h3>
      <label class="btn secondary block ph-add">Take or choose a photo<input type="file" id="exFile" accept="image/*" capture="environment" multiple hidden></label><div id="exFileName" class="muted"></div></div>`}
    <div class="toolbar">${locked ? "" : `<button class="btn" id="exSave">Save</button>`}${r && !locked ? `<button class="btn danger" id="exDelete">Delete</button>` : ""}</div>
    <div id="exResult"></div>`;
  dtAttach(main);
  if (r && !locked) phMount(document.getElementById("exPhotos"), r, `Receipt ${d.payee || ""}`.trim());
  else if (r) phMount(document.getElementById("exPhotos"), r, `Receipt ${d.payee || ""}`.trim());
  const file = document.getElementById("exFile");
  if (file) file.onchange = () => { document.getElementById("exFileName").textContent = file.files.length ? `${file.files.length} photo${file.files.length === 1 ? "" : "s"} ready` : ""; };
  const save = document.getElementById("exSave");
  if (save) save.onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const v = (i) => document.getElementById(i).value;
    const amount = Number(v("exAmount"));
    const fail = (t) => { document.getElementById("exResult").innerHTML = resultBox([t], true); };
    if (!(amount > 0)) return fail("Enter the amount.");
    if (!v("exPayee").trim()) return fail("Enter who was paid.");
    if (!v("exProject")) return fail("Choose the project.");
    const data = { ...d, date: v("exDate") || exToday(), amount, payee: v("exPayee").trim(), category: v("exCat"), method: v("exMethod"), note: v("exNote").trim(), status: d.status || "new" };
    const projectId = v("exProject");
    if (r) await fsp.sync.saveRecord(r.id, data, { projectId });
    else {
      const rec = await fsp.sync.createRecord({ type: EXPENSE, data, companyKey, projectId });
      const files = file ? [...file.files] : [];
      if (files.length) {
        const stamp = await phStampInfo();
        for (const f of files) {
          const s = await phShrink(f, stamp);
          await fsp.sync.createRecord({ type: "photo", companyKey, projectId, data: { parentId: rec.id, mime: s.mime, b64: s.b64, width: s.width, height: s.height, takenAt: (stamp && stamp.at) || new Date().toISOString(), ...(stamp && stamp.lat != null ? { lat: stamp.lat, lng: stamp.lng, acc: stamp.acc } : {}) } });
        }
      }
    }
    location.hash = "#/expenses";
  });
  const del = document.getElementById("exDelete");
  if (del) del.onclick = () => openModal("Delete expense?", `<p>The expense of ${exMoney(d.amount)} to ${escapeHtml(d.payee || "")} will be deleted here and on the desktop.</p>`, async () => { await fsp.sync.deleteRecord(r.id); closeModal(); location.hash = "#/expenses"; }, "Delete");
}
