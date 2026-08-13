// ===== swipe.js =====
// Generic swipe-to-delete for card lists, via pointer events (unifies
// touch and mouse, so this also works as click-drag on desktop for free).
// Attached once per container via event delegation, since card lists are
// re-rendered from scratch on every data change -- delegating to the
// container (which itself never gets replaced) means it survives those
// re-renders without needing to re-attach listeners each time.
//
// Deliberately only triggers the same undo-backed delete function each
// page already has for its own delete button -- a swipe is just another
// way to reach that same safe, reversible action, not a separate path.

const SWIPE_THRESHOLD_PX = 90;

function attachSwipeToDelete(containerId, onSwipeDelete) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.swipeAttached) return;
  container.dataset.swipeAttached = "true";

  let card = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;

  container.addEventListener("pointerdown", (e) => {
    const target = e.target.closest("[data-swipe-id]");
    // Don't hijack interaction with anything actually clickable inside the
    // card -- checkboxes, the selection badge, delete/share icons, etc.
    if (!target || e.target.closest("input, button, .doc-card-select-badge")) return;
    card = target;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = false;
  });

  container.addEventListener("pointermove", (e) => {
    if (!card) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;
    if (!dragging) {
      // Only commit to a swipe once the movement is clearly horizontal --
      // otherwise a vertical scroll attempt would get hijacked.
      if (Math.abs(moveX) > 10 && Math.abs(moveX) > Math.abs(moveY) * 1.5) {
        dragging = true;
        card.style.transition = "none";
      } else if (Math.abs(moveY) > 10) {
        card = null; // this was a scroll, not a swipe -- bail out entirely
        return;
      }
    }
    if (dragging) {
      dx = Math.min(0, moveX); // only allow swiping left
      card.style.transform = `translateX(${dx}px)`;
      card.style.opacity = String(1 - Math.min(Math.abs(dx) / 220, 0.65));
    }
  });

  const release = () => {
    if (!card) return;
    card.style.transition = "transform 0.18s ease-out, opacity 0.18s ease-out";
    if (dragging && dx < -SWIPE_THRESHOLD_PX) {
      const id = card.dataset.swipeId;
      card.style.transform = "translateX(-120%)";
      card.style.opacity = "0";
      setTimeout(() => onSwipeDelete(id), 140);
    } else {
      card.style.transform = "";
      card.style.opacity = "";
    }
    card = null;
    dragging = false;
    dx = 0;
  };
  container.addEventListener("pointerup", release);
  container.addEventListener("pointercancel", release);
  container.addEventListener("pointerleave", release);
}
window.attachSwipeToDelete = attachSwipeToDelete;
