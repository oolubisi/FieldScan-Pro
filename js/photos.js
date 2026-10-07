// ===== Photos on a task, inspection or take-off (phone) =====
// Each photo is its own synced record {parentId, mime, b64, width, height, takenAt}. It is shrunk here
// (long side 1280 px, JPEG) before it is stored, so the sync files stay small. Photos can be added and
// removed but not edited, and they are removed together with the record they belong to.

const PH_MAX_SIDE = 1280;

/** File -> { mime, b64, width, height }. Replaceable in tests (window.phShrinkImpl). */
function phShrink(file) {
  if (window.phShrinkImpl) return window.phShrinkImpl(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PH_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", b64: canvas.toDataURL("image/jpeg", 0.7).split(",")[1], width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The app couldn't read that photo.")); };
    img.src = url;
  });
}

/** Fills `box` with the photos of the record `parent` (a stored record) and an Add button. */
const phFileName = (label, i, mime) => `${String(label || "photo").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^[. ]+/, "").trim().slice(0, 60) || "photo"}-${String(i + 1).padStart(2, "0")}.${mime === "image/png" ? "png" : "jpg"}`;

/** Saves each photo to the phone as a normal image file (the browser puts them in Downloads). */
async function phDownloadAll(items, label) {
  for (const { photo, index: i } of items) {
    const bin = atob(photo.data.b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const url = URL.createObjectURL(new Blob([bytes], { type: photo.data.mime }));
    const a = document.createElement("a");
    a.href = url; a.download = phFileName(label, i, photo.data.mime);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await new Promise((r) => setTimeout(r, 250)); // browsers drop downloads that arrive all at once
  }
}

async function phMount(box, parent, label) {
  if (!box) return;
  const photos = (await fsp.sync.getRecords("photo")).filter((r) => r.data.parentId === parent.id)
    .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));
  box.innerHTML = `<h3>Photos${photos.length ? ` (${photos.length})` : ""}</h3>
    <div class="ph-grid">${photos.map((p) => `<div class="ph-item" data-id="${escapeHtml(p.id)}">
      <img src="data:${escapeHtml(p.data.mime)};base64,${p.data.b64}" alt="Photo">
      <input type="checkbox" class="ph-pick" aria-label="Select photo">
      <button type="button" class="btn danger small ph-del" aria-label="Remove photo">×</button></div>`).join("")}</div>
    <label class="btn secondary block ph-add">Add photo<input type="file" class="ph-file" accept="image/*" capture="environment" multiple hidden></label>
    ${photos.length ? `<label class="field"><input type="checkbox" class="ph-all"> Select all</label><button type="button" class="btn secondary block ph-save" style="margin-top:8px;">Download selected</button>
      <p class="muted" style="font-size:12px;">Photos go to this phone's Downloads. If a file with the same name is already there, Chrome keeps both and adds (1) to the new one; the browser doesn't let the app replace it.</p>` : ""}
    <div class="ph-result"></div>`;
  const fail = (m) => { box.querySelector(".ph-result").innerHTML = resultBox([m], true); };
  box.querySelector(".ph-file").onchange = async (ev) => {
    for (const file of [...ev.target.files]) {
      try {
        const s = await phShrink(file);
        await fsp.sync.createRecord({
          type: "photo", companyKey: parent.companyKey, projectId: parent.projectId || undefined,
          data: { parentId: parent.id, mime: s.mime, b64: s.b64, width: s.width, height: s.height, takenAt: new Date().toISOString() },
        });
      } catch (e) { return fail(e.message || String(e)); }
    }
    await phMount(box, parent, label);
  };
  const all = box.querySelector(".ph-all");
  if (all) all.onchange = () => box.querySelectorAll(".ph-pick").forEach((c) => { c.checked = all.checked; });
  const save = box.querySelector(".ph-save");
  if (save) save.onclick = async () => {
    const picked = new Set([...box.querySelectorAll(".ph-item")].filter((it) => it.querySelector(".ph-pick").checked).map((it) => it.dataset.id));
    const items = photos.map((photo, index) => ({ photo, index })).filter((it) => picked.has(it.photo.id));
    if (!items.length) { fail("Tick the photos you want first."); return; }
    await phDownloadAll(items, label);
    box.querySelector(".ph-result").innerHTML = resultBox([`${items.length} photo${items.length === 1 ? "" : "s"} saved to this phone's Downloads.`]);
  };
  box.querySelectorAll(".ph-del").forEach((b) => {
    b.onclick = async () => { await fsp.sync.deleteRecord(b.closest(".ph-item").dataset.id); await phMount(box, parent, label); };
  });
}
