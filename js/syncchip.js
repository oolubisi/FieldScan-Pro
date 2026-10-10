// ===== "Last synced" chip in the header =====
// Always visible, so you never have to open the Sync tab to know whether the desktop has your work:
// how long ago the last sync was, how many records are still waiting, and whether anything needs a decision.

/** "just now", "5 min ago", "3 h ago", "2 days ago"; null when there is no time. */
function scAgo(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round(((now == null ? Date.now() : now) - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

/** The chip's words and colour. level: ok | warn | bad | idle */
function scModel({ lastSync, counts, conflicts, folderState, now }) {
  const waiting = (counts ? counts.unsent + counts.sent : 0);
  const ago = scAgo(lastSync, now);
  const age = lastSync ? ((now == null ? Date.now() : now) - new Date(lastSync).getTime()) / 3600000 : Infinity;
  if (conflicts) return { level: "bad", text: `⚠ ${conflicts} need${conflicts === 1 ? "s" : ""} a decision` };
  if (folderState === "denied" || folderState === "error") return { level: "bad", text: "⚠ Sync folder needs attention" };
  if (folderState === "none" || !folderState) return waiting ? { level: "warn", text: `⟳ ${waiting} waiting · no sync folder` } : { level: "idle", text: "Not syncing yet" };
  if (!ago) return { level: "warn", text: waiting ? `⟳ ${waiting} waiting · not synced yet` : "Not synced yet" };
  if (waiting) return { level: age > 1 ? "warn" : "ok", text: `⟳ ${waiting} waiting · synced ${ago}` };
  if (age > 24) return { level: "warn", text: `⚠ Last synced ${ago}` };
  return { level: "ok", text: `✓ Synced ${ago}` };
}

async function scRefresh() {
  const chip = document.getElementById("syncChip");
  if (!chip || !window.fsp || !fsp.sync) return;
  try {
    const status = await fsp.sync.getStatus();
    const f = fsp.folder ? await fsp.folder.status() : { state: "none" };
    const m = scModel({ lastSync: f.lastSync, counts: status.counts, conflicts: status.conflicts, folderState: f.state });
    chip.textContent = m.text; chip.className = `sync-chip ${m.level}`; chip.hidden = false;
    chip.title = f.lastSummary || "";
  } catch (e) { chip.hidden = true; }
}

function scStart() {
  scRefresh();
  window.addEventListener("hashchange", () => setTimeout(scRefresh, 300));
  if (!/jsdom/i.test(navigator.userAgent)) setInterval(scRefresh, 30000);
}
