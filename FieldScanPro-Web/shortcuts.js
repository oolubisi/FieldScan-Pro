// ===== shortcuts.js =====
// Deliberately kept small and unambiguous. Every shortcut here does one
// obvious thing, works the same way on every page, and never fires while
// someone is actually typing in a field (except Escape, and Cmd/Ctrl+K
// which is meant to work regardless of focus, matching how most apps that
// use it -- Slack, Notion, etc. -- treat it as a global override).

document.addEventListener("keydown", function (e) {
  // Escape: close whichever layer is currently on top, checked in the
  // order they're most commonly opened over one another.
  if (e.key === "Escape") {
    const openPanel = document.querySelector(".full-page-panel");
    if (openPanel) {
      if (typeof closeFullPagePanel === "function") closeFullPagePanel(openPanel.id);
      return;
    }
    const modalOverlay = document.getElementById("modalOverlay");
    if (modalOverlay && modalOverlay.style.display !== "none" && modalOverlay.style.display !== "") {
      if (typeof closeModal === "function") closeModal();
      return;
    }
    const moreSheet = document.getElementById("mobile-more-sheet-overlay");
    if (moreSheet && moreSheet.classList.contains("open")) {
      if (typeof closeMobileMoreSheet === "function") closeMobileMoreSheet();
      return;
    }
    const boqOverlay = document.getElementById("boq-manager-overlay");
    if (boqOverlay) {
      boqOverlay.remove();
      return;
    }
    return;
  }

  // Cmd/Ctrl+K: open Global Search, from anywhere.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (typeof openGlobalSearch === "function") openGlobalSearch();
    return;
  }
});
