// ===== Shared UI helpers =====
// escapeHtml / showStatus / openModal / closeModal deliberately keep the
// same names and signatures the desktop app's helpers use, so code shared
// between the two (the Calculators) runs unchanged on the phone.

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function moneyValue(v) {
  return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A short message that fades after a few seconds. */
function showStatus(message, isError) {
  const bar = document.getElementById("status-bar");
  if (!bar) return;
  bar.textContent = message;
  bar.className = "show" + (isError ? " error" : "");
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => { bar.className = ""; }, 3500);
}

/**
 * Shows a bottom sheet with a form. onSubmit runs when the primary button is
 * pressed; the caller reads whatever fields it put in the form.
 */
function openModal(title, formHtml, onSubmit, submitLabel) {
  const box = document.getElementById("modalBox");
  box.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    ${formHtml}
    <div class="modal-actions">
      <button class="btn secondary" id="modalCancelBtn">Cancel</button>
      <button class="btn" id="modalSubmitBtn">${escapeHtml(submitLabel || "Save")}</button>
    </div>
  `;
  document.getElementById("modalOverlay").classList.add("open");
  document.getElementById("modalCancelBtn").onclick = closeModal;
  document.getElementById("modalSubmitBtn").onclick = onSubmit;
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  document.getElementById("modalBox").innerHTML = "";
}

/** "5 Oct 2026, 14:03" in the phone's own locale and time zone. */
function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
