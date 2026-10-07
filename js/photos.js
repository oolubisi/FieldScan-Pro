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

const phList = async (parent) => (await fsp.sync.getRecords("photo")).filter((r) => r.data.parentId === parent.id)
  .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));

/** Rotated copy of a photo -> { mime, b64, width, height }. Replaceable in tests (window.phRotateImpl). */
function phRotate(photo, degrees) {
  if (window.phRotateImpl) return window.phRotateImpl(photo, degrees);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const quarter = Math.abs(degrees) % 180 === 90;
      const canvas = document.createElement("canvas");
      canvas.width = quarter ? img.naturalHeight : img.naturalWidth;
      canvas.height = quarter ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve({ mime: "image/jpeg", b64: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error("The app couldn't rotate that photo."));
    img.src = `data:${photo.data.mime};base64,${photo.data.b64}`;
  });
}

/**
 * Full-screen viewer for one photo: previous / next, rotate, download, delete. A photo itself is never edited in place:
 * rotating or editing saves the changed copy in the same position and removes the original, so syncing stays simple and safe.
 */
async function phOpenViewer(parent, label, startIndex, onClose) {
  let photos = await phList(parent);
  let index = Math.min(startIndex, photos.length - 1);
  if (index < 0) return;
  const el = document.createElement("div");
  el.id = "phViewer"; el.className = "ph-viewer";
  el.innerHTML = `<div class="ph-v-top"><span class="ph-v-count"></span><button type="button" class="btn secondary small ph-v-close">Close</button></div>
    <div class="ph-v-stage"><img class="ph-v-img" alt="Photo"></div>
    <div class="ph-v-cap"><input class="ph-v-captext" placeholder="Caption (shown in the report)" maxlength="200"><button type="button" class="btn secondary small ph-v-capsave">Save caption</button></div>
    <div class="ph-v-msg"></div>
    <div class="ph-v-bar">
      <button type="button" class="btn secondary small ph-v-prev" aria-label="Previous photo">‹</button>
      <button type="button" class="btn secondary small ph-v-left" aria-label="Rotate left">⟲</button>
      <button type="button" class="btn secondary small ph-v-right" aria-label="Rotate right">⟳</button>
      <button type="button" class="btn secondary small ph-v-edit">Crop / draw</button>
      <button type="button" class="btn secondary small ph-v-down">Download</button>
      <button type="button" class="btn danger small ph-v-del">Delete</button>
      <button type="button" class="btn secondary small ph-v-next" aria-label="Next photo">›</button>
    </div>`;
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  const msg = (t) => { q(".ph-v-msg").textContent = t || ""; };
  const draw = () => {
    const p = photos[index];
    q(".ph-v-img").src = `data:${p.data.mime};base64,${p.data.b64}`;
    q(".ph-v-count").textContent = `${index + 1} / ${photos.length}`;
    q(".ph-v-prev").disabled = index === 0;
    q(".ph-v-next").disabled = index === photos.length - 1;
    q(".ph-v-del").textContent = "Delete";
    q(".ph-v-captext").value = p.data.caption || "";
    msg("");
  };
  const close = () => { el.remove(); if (onClose) onClose(); };
  const replaceWith = async (make) => {
    const old = photos[index];
    try {
      const s = await make(old);
      if (!s) return;
      await fsp.sync.createRecord({
        type: "photo", companyKey: parent.companyKey, projectId: parent.projectId || undefined,
        data: { ...old.data, ...s },
      });
      await fsp.sync.deleteRecord(old.id);
      photos = await phList(parent);
      draw();
    } catch (e) { msg(e.message || String(e)); }
  };
  const rotate = (deg) => replaceWith((old) => phRotate(old, deg));
  q(".ph-v-capsave").onclick = () => replaceWith(async () => ({ caption: q(".ph-v-captext").value.trim().slice(0, 200) }));
  q(".ph-v-edit").onclick = () => replaceWith((old) => phEdit(old));
  q(".ph-v-close").onclick = close;
  q(".ph-v-prev").onclick = () => { if (index > 0) { index--; draw(); } };
  q(".ph-v-next").onclick = () => { if (index < photos.length - 1) { index++; draw(); } };
  q(".ph-v-left").onclick = () => rotate(-90);
  q(".ph-v-right").onclick = () => rotate(90);
  q(".ph-v-down").onclick = async () => { await phDownloadAll([{ photo: photos[index], index }], label); msg("Saved to this phone's Downloads."); };
  q(".ph-v-del").onclick = async () => {
    const b = q(".ph-v-del");
    if (b.textContent === "Delete") { b.textContent = "Tap again to delete"; return; }
    await fsp.sync.deleteRecord(photos[index].id);
    photos = await phList(parent);
    if (!photos.length) { close(); return; }
    index = Math.min(index, photos.length - 1);
    draw();
  };
  draw();
}

async function phMount(box, parent, label) {
  if (!box) return;
  const photos = (await fsp.sync.getRecords("photo")).filter((r) => r.data.parentId === parent.id)
    .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));
  box.innerHTML = `<h3>Photos${photos.length ? ` (${photos.length})` : ""}</h3>
    <div class="ph-grid">${photos.map((p) => `<div class="ph-item" data-id="${escapeHtml(p.id)}">
      <img src="data:${escapeHtml(p.data.mime)};base64,${p.data.b64}" alt="Photo">
      <input type="checkbox" class="ph-pick" aria-label="Select photo">
      <button type="button" class="ph-del" aria-label="Remove photo">×</button>${p.data.caption ? `<div class="ph-cap">${escapeHtml(p.data.caption)}</div>` : ""}</div>`).join("")}</div>
    ${photos.length ? `<p class="muted" style="font-size:12px; margin:0 0 8px;">Tap a photo to view, rotate or delete it.</p>` : ""}
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
  box.querySelectorAll(".ph-item img").forEach((img) => {
    img.onclick = () => phOpenViewer(parent, label, photos.findIndex((p) => p.id === img.closest(".ph-item").dataset.id), () => phMount(box, parent, label));
  });
  box.querySelectorAll(".ph-del").forEach((b) => {
    b.onclick = async () => { await fsp.sync.deleteRecord(b.closest(".ph-item").dataset.id); await phMount(box, parent, label); };
  });
}
