// ===== Voice notes on a task, inspection, take-off, diary entry, expense, progress or snag (phone) =====
// Each note is its own synced record {parentId, mime, b64, durationSec, takenAt, title}. Recorded with the phone's
// microphone at a low bit rate (about 20 KB per 10 seconds) and capped at 3 minutes so sync files stay small.
// Like a photo, a note is added and removed but not edited, and it goes with the record it belongs to.

const VN_MAX_SEC = 180;
const vnFmt = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.round((sec || 0) % 60)).padStart(2, "0")}`;
const vnSupported = () => !!(window.vnCaptureImpl || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder));

/**
 * Starts recording. Returns { stop(): Promise<{mime, b64, durationSec}>, cancel() }.
 * Replaceable in tests (window.vnCaptureImpl).
 */
async function vnCapture() {
  if (window.vnCaptureImpl) return window.vnCaptureImpl();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const pref = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { ...(pref ? { mimeType: pref } : {}), audioBitsPerSecond: 24000 });
  const chunks = []; const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    cancel() { try { rec.onstop = null; rec.stop(); } catch (e) { /* already stopped */ } release(); },
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        release();
        const mime = (rec.mimeType || pref || "audio/webm").split(";")[0];
        const blob = new Blob(chunks, { type: mime });
        const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("The recording couldn't be read.")); fr.readAsDataURL(blob); });
        resolve({ mime, b64, durationSec: Math.round((Date.now() - t0) / 1000) });
      };
      rec.onerror = () => reject(new Error("The recording failed."));
      try { rec.stop(); } catch (e) { reject(e); }
    }),
  };
}

/** Puts the voice-notes block right after the photos block `photoBox` (made once, kept when the photos redraw). */
async function vnMount(photoBox, parent, label) {
  if (!photoBox || !photoBox.parentNode) return;
  let box = photoBox.nextElementSibling;
  if (!box || !box.classList.contains("vn-box")) { box = document.createElement("div"); box.className = "vn-box"; photoBox.after(box); }
  return vnRender(box, parent, label);
}

async function vnRender(box, parent, label) {
  const notes = (await fsp.sync.getRecords("voice")).filter((r) => r.data.parentId === parent.id)
    .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));
  box.innerHTML = `<h3>Voice notes${notes.length ? ` (${notes.length})` : ""}</h3>
    ${notes.map((n) => `<div class="vn-row" data-id="${escapeHtml(n.id)}">
      <audio controls preload="none" src="data:${escapeHtml(n.data.mime)};base64,${n.data.b64}"></audio>
      ${n.data.transcript ? `<p class="vn-tx">${escapeHtml(n.data.transcript)}</p>` : ""}
      <div class="vn-meta"><span>${escapeHtml(vnFmt(n.data.durationSec))} · ${escapeHtml(new Date(n.data.takenAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span>
        <button type="button" class="btn secondary small vn-del">Delete</button></div></div>`).join("")}
    ${vnSupported() ? `<div class="vn-rec"><button type="button" class="btn vn-start">🎙 Record voice note</button>
      <div class="vn-live" hidden><span class="vn-dot"></span><b class="vn-time">0:00</b><button type="button" class="btn danger small vn-stop">Stop &amp; save</button><button type="button" class="btn secondary small vn-cancel">Cancel</button></div></div>`
      : `<p class="muted" style="font-size:12px;">This browser can't record audio.</p>`}
    <div class="vn-result"></div>`;
  const fail = (m) => { box.querySelector(".vn-result").innerHTML = resultBox([m], true); };
  box.querySelectorAll(".vn-del").forEach((b) => {
    b.onclick = async () => {
      if (b.textContent === "Delete") { b.textContent = "Tap again to delete"; return; }
      await fsp.sync.deleteRecord(b.closest(".vn-row").dataset.id);
      await vnRender(box, parent, label);
    };
  });
  const start = box.querySelector(".vn-start");
  if (!start) return;
  start.onclick = async () => {
    let cap;
    try { cap = await vnCapture(); } catch (e) { fail(/denied|NotAllowed|Permission/i.test(String(e && (e.name + e.message))) ? "Allow microphone access for this app in the browser to record." : (e.message || "The microphone isn't available.")); return; }
    start.hidden = true;
    const live = box.querySelector(".vn-live"); live.hidden = false;
    const t0 = Date.now(); let done = false;
    const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); box.querySelector(".vn-time").textContent = vnFmt(s); if (s >= VN_MAX_SEC) finish(); }, 250);
    async function finish() {
      if (done) return; done = true; clearInterval(tick);
      try {
        const s = await cap.stop();
        await fsp.sync.createRecord({ type: "voice", companyKey: parent.companyKey, projectId: parent.projectId || undefined,
          data: { parentId: parent.id, mime: s.mime, b64: s.b64, durationSec: s.durationSec, takenAt: new Date().toISOString() } });
      } catch (e) { fail(e.message || String(e)); }
      await vnRender(box, parent, label);
    }
    box.querySelector(".vn-stop").onclick = finish;
    box.querySelector(".vn-cancel").onclick = () => { done = true; clearInterval(tick); cap.cancel(); vnRender(box, parent, label); };
  };
}
