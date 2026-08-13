// ===== undo.js =====
// Generic "undoable delete" pattern: the item disappears from the UI
// immediately (feels instant), but the actual backend delete is delayed a
// few seconds behind a toast with an Undo button. If Undo is clicked, the
// delete never happens and the item is restored. If the window expires,
// the delete goes through for real. This avoids needing a fragile
// "re-create the exact same record" flow to reverse a delete after the
// fact — the delete simply hasn't happened yet.

const UNDO_WINDOW_MS = 6000;
let undoActiveTimers = {}; // keyed by a caller-provided id, so re-triggering the same delete replaces rather than stacks

/**
 * @param {string} id - unique key for this specific pending delete (e.g. a taskId) so a rapid double-trigger doesn't double-schedule
 * @param {string} message - shown in the toast, e.g. "Task deleted"
 * @param {function} onCommit - called once the undo window expires with no undo click; should perform the actual delete
 * @param {function} onUndo - called if Undo is clicked; should restore the item's visibility
 */
function scheduleUndoableDelete(id, message, onCommit, onUndo) {
  // If this exact item already has a pending delete (e.g. double-tap), just
  // let the existing timer keep running rather than starting a second one.
  if (undoActiveTimers[id]) return;

  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.innerHTML =
    '<span>' + escapeHtml(message) + '</span>' +
    '<button class="undo-toast-btn" onclick="window.triggerUndo(\'' + escapeAttr(id) + '\')">Undo</button>';
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("undo-toast-visible"));

  const timerId = setTimeout(() => {
    delete undoActiveTimers[id];
    toast.remove();
    onCommit();
  }, UNDO_WINDOW_MS);

  undoActiveTimers[id] = { timerId, toast, onUndo };
}
window.scheduleUndoableDelete = scheduleUndoableDelete;

function triggerUndo(id) {
  const entry = undoActiveTimers[id];
  if (!entry) return;
  clearTimeout(entry.timerId);
  entry.toast.remove();
  delete undoActiveTimers[id];
  entry.onUndo();
}
window.triggerUndo = triggerUndo;
