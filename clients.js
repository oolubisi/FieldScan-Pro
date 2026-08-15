// ===== clients.js =====
// Simple client directory — used by Estimates (pick a client instead of
// retyping name/address every time) and manageable on its own.

let clientsList = [];

async function initClientsPage() {
  const container = document.getElementById("clients-list-view");
  if (container)
    container.innerHTML = '<div class="card"><span style="font-size:13px; color:var(--muted);">Loading clients...</span></div>';
  const cache = getCache();
  try {
    const resp = await callApi("getClients", {});
    clientsList = Array.isArray(resp) ? resp : [];
    cache.clients = clientsList;
    setCache(cache);
  } catch (e) {
    console.error("getClients failed", e);
    clientsList = cache.clients || [];
  }
  renderClientsPage();
}
window.initClientsPage = initClientsPage;

let clientsArchivedExpanded = false;

function renderClientsPage() {
  const container = document.getElementById("clients-list-view");
  if (!container) return;
  const isArchived = (c) => String(c.archived).toLowerCase() === "yes" || c.archived === true;
  const sorted = [...clientsList].sort(function (a, b) {
    return (a.name || "").localeCompare(b.name || "");
  });
  const active = sorted.filter((c) => !isArchived(c));
  const archived = sorted.filter(isArchived);

  const activeHtml = active.length
    ? '<div class="console-cards-grid">' + active.map(clientCardHtml).join("") + '</div>'
    : '<p style="text-align:center; padding:20px; color:var(--muted);">No clients yet — use "New Client" above to add one.</p>';

  const archivedHtml = archived.length
    ? '<div style="margin-top:16px;">' +
      '<div style="cursor:pointer; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; margin-bottom:8px;" onclick="window.toggleClientsArchivedExpanded()">' +
      '<i class="fas ' + (clientsArchivedExpanded ? "fa-chevron-down" : "fa-chevron-right") + '"></i> Archived (' + archived.length + ')' +
      '</div>' +
      (clientsArchivedExpanded ? '<div class="console-cards-grid" style="opacity:0.6;">' + archived.map(clientCardHtml).join("") + '</div>' : "") +
      '</div>'
    : "";

  container.innerHTML =
    (isElectronApp
      ? '<div style="display:flex; justify-content:flex-end; margin-bottom:15px;">' +
        '<button class="action-btn" style="width:auto; padding:0 20px;" onclick="window.openClientModal(null)">' +
        '<i class="fas fa-plus"></i> New Client</button></div>'
      : '') +
    activeHtml + archivedHtml;
}

function toggleClientsArchivedExpanded() {
  clientsArchivedExpanded = !clientsArchivedExpanded;
  renderClientsPage();
}
window.toggleClientsArchivedExpanded = toggleClientsArchivedExpanded;

function clientCardHtml(client) {
  const key = "client:" + client.clientId;
  window.modalRecordCache = window.modalRecordCache || {};
  window.modalRecordCache[key] = client;
  return (
    '<div class="card"' + (isElectronApp ? ' style="cursor:pointer;" onclick="window.openClientModal(window.modalRecordCache[\'' + key + '\'])"' : '') + '>' +
    '<strong style="font-size:16px;">' + escapeHtml(client.name || "Untitled") + '</strong><br>' +
    (client.address ? '<span style="font-size:13px; color:var(--muted);">' + escapeHtml(client.address) + '</span><br>' : "") +
    (client.phone ? '<span style="font-size:13px;">' + escapeHtml(client.phone) + '</span><br>' : "") +
    (client.email ? '<span style="font-size:13px; color:var(--muted);">' + escapeHtml(client.email) + '</span>' : "") +
    '</div>'
  );
}

function openClientModal(editData) {
  editData = editData || null;
  const isEdit = !!editData;
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  if (modalContent) modalContent.classList.remove("modal-fullscreen");
  const labelStyle = 'style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;"';
  const largeInput = "width:100%; padding:12px; font-size:16px; border:1.5px solid var(--border); border-radius:10px;";

  title.innerText = isEdit ? "Edit Client" : "New Client";
  overlay.style.display = "flex";

  body.innerHTML =
    '<input type="hidden" id="client_id" value="' + escapeAttr(isEdit ? editData.clientId : "") + '">' +
    '<label ' + labelStyle + '>Name</label>' +
    '<input id="client_name" value="' + escapeAttr(isEdit ? editData.name || "" : "") + '" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Address</label>' +
    '<textarea id="client_address" rows="3" ' + largeInput + '>' + escapeHtml(isEdit ? editData.address || "" : "") + '</textarea>' +
    '<label ' + labelStyle + '>Phone</label>' +
    '<input id="client_phone" value="' + escapeAttr(isEdit ? editData.phone || "" : "") + '" ' + largeInput + '>' +
    '<label ' + labelStyle + '>Email</label>' +
    '<input id="client_email" type="email" value="' + escapeAttr(isEdit ? editData.email || "" : "") + '" ' + largeInput + '>' +
    (isEdit ? '<button type="button" class="action-btn" id="client_delete_btn" style="background:' + ((String(editData.archived).toLowerCase() === "yes" || editData.archived === true) ? "var(--success)" : "var(--danger)") + '; margin-top:10px;">' + ((String(editData.archived).toLowerCase() === "yes" || editData.archived === true) ? "Unarchive Client" : "Archive Client") + '</button>' : "");

  if (isEdit) {
    document.getElementById("client_delete_btn").onclick = function () {
      const isCurrentlyArchived = String(editData.archived).toLowerCase() === "yes" || editData.archived === true;
      const action = isCurrentlyArchived ? "unarchiveClient" : "archiveClient";
      const btn = document.getElementById("client_delete_btn");
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (isCurrentlyArchived ? "Unarchiving..." : "Archiving...");
      callApi(action, { clientId: editData.clientId })
        .then(function () {
          const idx = clientsList.findIndex(function (c) { return c.clientId === editData.clientId; });
          if (idx !== -1) clientsList[idx].archived = isCurrentlyArchived ? "No" : "Yes";
          const cache2 = getCache();
          cache2.clients = clientsList;
          setCache(cache2);
          if (typeof writeBackup === "function") writeBackup("getClients", clientsList, {});
          closeModal();
          renderClientsPage();
          if (typeof showSyncToast === "function") {
            showSyncToast(isCurrentlyArchived ? "✅ Client restored" : "📦 Client archived");
          }
        })
        .catch(function (e) {
          alert("Could not " + (isCurrentlyArchived ? "restore" : "archive") + " client: " + (e && e.message ? e.message : "Unknown error"));
          btn.disabled = false;
          btn.innerHTML = isCurrentlyArchived ? "Unarchive Client" : "Archive Client";
        });
    };
  }

  submit.style.display = "block";
  submit.innerText = "Save";
  submit.onclick = function () {
    const name = document.getElementById("client_name").value.trim();
    if (!name) {
      alert("Enter a client name");
      return;
    }
    submit.disabled = true;
    submit.innerText = "Saving...";
    const payload = {
      clientId: document.getElementById("client_id").value || undefined,
      name: name,
      address: document.getElementById("client_address").value,
      phone: document.getElementById("client_phone").value,
      email: document.getElementById("client_email").value,
    };
    callApi(isEdit ? "updateClient" : "saveClient", payload)
      .then(function (resp) {
        const cache2 = getCache();
        if (isEdit) {
          const idx = clientsList.findIndex(function (c) { return c.clientId === editData.clientId; });
          if (idx !== -1) clientsList[idx] = Object.assign({}, clientsList[idx], payload);
        } else {
          clientsList.push(Object.assign({}, payload, { clientId: (resp && resp.clientId) }));
        }
        cache2.clients = clientsList;
        setCache(cache2);
        if (typeof writeBackup === "function") writeBackup("getClients", clientsList, {});
        closeModal();
        renderClientsPage();
        if (typeof window.estOnClientsRefreshed === "function") window.estOnClientsRefreshed();
      })
      .catch(function (e) {
        alert("Failed to save: " + (e.message || "Unknown error"));
        submit.disabled = false;
        submit.innerText = "Save";
      });
  };
}
window.openClientModal = openClientModal;
