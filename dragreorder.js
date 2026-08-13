// ===== dragreorder.js =====
// Reorders cards within a grid via a dedicated grip handle -- NOT the
// whole card, since these same cards already use pointer events for
// swipe-to-delete (swipe.js). Mixing native HTML5 drag-and-drop with
// custom pointer-based swipe tracking on the same element would fight
// over the same gesture; a grip keeps them unambiguous.
//
// Attached once via delegation on a stable outer container, since the
// individual card grids inside it get fully rebuilt on every render.
// Reordering is scoped to cards sharing the same immediate parent grid --
// dragging a card from one section into a different one is not supported
// here (that would mean also reassigning its project/group, out of scope
// for "let me reprioritize this list").

function attachDragReorder(containerId, onReorder) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.dragReorderAttached) return;
  container.dataset.dragReorderAttached = "true";

  let draggedCard = null;

  container.addEventListener("dragstart", (e) => {
    const grip = e.target.closest(".drag-grip");
    if (!grip) {
      e.preventDefault();
      return;
    }
    const card = grip.closest("[data-swipe-id]");
    if (!card) {
      e.preventDefault();
      return;
    }
    draggedCard = card;
    card.classList.add("drag-reorder-active");
    e.dataTransfer.effectAllowed = "move";
  });

  container.addEventListener("dragover", (e) => {
    if (!draggedCard) return;
    const overCard = e.target.closest("[data-swipe-id]");
    if (!overCard || overCard === draggedCard) return;
    const grid = draggedCard.parentElement;
    if (overCard.parentElement !== grid) return; // only within the same section
    e.preventDefault();
    const rect = overCard.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    grid.insertBefore(draggedCard, before ? overCard : overCard.nextSibling);
  });

  container.addEventListener("dragend", () => {
    if (!draggedCard) return;
    draggedCard.classList.remove("drag-reorder-active");
    const grid = draggedCard.parentElement;
    const orderedIds = Array.from(grid.children)
      .map((c) => c.dataset.swipeId)
      .filter(Boolean);
    draggedCard = null;
    if (orderedIds.length > 1) onReorder(orderedIds);
  });
}
window.attachDragReorder = attachDragReorder;
