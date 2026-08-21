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
  // Inline styles instead of relying on external .undo-toast CSS classes
  // -- this was likely the actual cause of "no confirmation shows": the
  // element was being created and appended correctly, but with no
  // guaranteed visible styling (position, z-index, colors, animation) if
  // that CSS was ever missing or incomplete, it would sit in the DOM
  // invisibly. Matches showSyncToast's already-reliable, self-contained
  // approach, just styled distinctly enough (dark red) to read as a
  // delete confirmation rather than a generic sync message.
  toast.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);" +
    "background:#1a1a1a;color:#fff;padding:12px 16px;border-radius:14px;" +
    "font-size:14px;font-weight:700;z-index:7500;max-width:90%;" +
    "display:flex;align-items:center;gap:14px;box-shadow:0 4px 16px rgba(0,0,0,0.35);" +
    "opacity:0;transition:opacity 0.25s, transform 0.25s;";
  const messageSpan = document.createElement("span");
  messageSpan.textContent = message;
  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Undo";
  undoBtn.style.cssText =
    "background:none;border:none;color:#4dabf7;font-weight:800;font-size:14px;" +
    "cursor:pointer;padding:4px 8px;flex-shrink:0;";
  undoBtn.onclick = () => window.triggerUndo(id);
  toast.appendChild(messageSpan);
  toast.appendChild(undoBtn);
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

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
