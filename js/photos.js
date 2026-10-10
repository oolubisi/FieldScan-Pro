// ===== Photos on a task, inspection or take-off (phone) =====
// Each photo is its own synced record {parentId, mime, b64, width, height, takenAt}. It is shrunk here
// (long side 1280 px, JPEG) before it is stored, so the sync files stay small. Photos can be added and
// removed but not edited, and they are removed together with the record they belong to.

const PH_MAX_SIDE = 1280;

// ----- date / time / GPS stamp -----
const PH_STAMP_KEY = "fsp-photostamp";
/** Whether new photos are stamped with date, time and location (on by default; changed on the Sync screen). */
function phStampEnabled(set) {
  try {
    if (set !== undefined) { localStorage.setItem(PH_STAMP_KEY, set ? "on" : "off"); return set; }
    return localStorage.getItem(PH_STAMP_KEY) !== "off";
  } catch (e) { return set === undefined ? true : set; }
}

/** The text burned onto a photo: "10 Oct 2026 14:32 · 6.52411, 3.37921 (±12 m)". */
function phStampText(info) {
  const d = new Date(info.at);
  const date = `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return info.lat == null ? date : `${date} · ${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}${info.acc != null ? ` (±${Math.round(info.acc)} m)` : ""}`;
}

/** { at, lat?, lng?, acc?, text } for the next photos, or null when stamping is off. The location is asked for once, with a short wait; without it the stamp is just the time. Replaceable in tests (window.phGeoImpl). */
async function phStampInfo() {
  if (!phStampEnabled()) return null;
  const info = { at: new Date().toISOString() };
  try {
    const pos = window.phGeoImpl ? await window.phGeoImpl() : await new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("none"));
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
    });
    if (pos && pos.coords && Number.isFinite(pos.coords.latitude)) { info.lat = pos.coords.latitude; info.lng = pos.coords.longitude; info.acc = pos.coords.accuracy; }
  } catch (e) { /* no permission or no signal: time only */ }
  info.text = phStampText(info);
  return info;
}

/** Burns the stamp into the bottom-left corner of a canvas (a dark strip so it reads on any photo). */
function phDrawStamp(ctx, w, h, text) {
  const size = Math.max(14, Math.round(Math.min(w, h) * 0.035));
  ctx.font = `600 ${size}px sans-serif`;
  const pad = Math.round(size * 0.4), tw = Math.min(w - pad * 2, ctx.measureText(text).width + pad * 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h - size - pad * 2, tw + pad, size + pad * 2);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h - size / 2 - pad, w - pad * 2);
}

/** File -> { mime, b64, width, height }. `stamp` (from phStampInfo) is burned in. Replaceable in tests (window.phShrinkImpl). */
function phShrink(file, stamp) {
  if (window.phShrinkImpl) return window.phShrinkImpl(file, stamp);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PH_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      if (stamp && stamp.text) phDrawStamp(ctx, w, h, stamp.text);
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

async function phMount(box, parent, label, opts) {
  if (!box) return;
  const stages = opts && opts.stages ? ((await fsp.sync.getRecords(parent.type)).find((r) => r.id === parent.id) || parent).data.photoStages || {} : null;
  const photos = (await fsp.sync.getRecords("photo")).filter((r) => r.data.parentId === parent.id)
    .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));
  box.innerHTML = `<h3>Photos${photos.length ? ` (${photos.length})` : ""}</h3>
    <div class="ph-grid">${photos.map((p) => `<div class="ph-item" data-id="${escapeHtml(p.id)}">
      <img src="data:${escapeHtml(p.data.mime)};base64,${p.data.b64}" alt="Photo">
      <input type="checkbox" class="ph-pick" aria-label="Select photo">${stages ? `<select class="ph-stage" aria-label="Stage"><option value="">No stage</option>${["Before", "During", "After"].map((s) => `<option value="${s}" ${stages[p.id] === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}
      <button type="button" class="ph-del" aria-label="Remove photo">×</button>${p.data.caption ? `<div class="ph-cap">${escapeHtml(p.data.caption)}</div>` : ""}</div>`).join("")}</div>
    ${photos.length ? `<p class="muted" style="font-size:12px; margin:0 0 8px;">Tap a photo to view, rotate or delete it.</p>` : ""}
    ${stages && phStageGroups(photos, stages).filled >= 2 ? `<button type="button" class="btn secondary block ph-compare" style="margin-bottom:8px;">Compare Before / During / After</button>` : ""}
    <label class="btn secondary block ph-add">Add photo<input type="file" class="ph-file" accept="image/*" capture="environment" multiple hidden></label>
    ${photos.length ? `<label class="field"><input type="checkbox" class="ph-all"> Select all</label><button type="button" class="btn secondary block ph-save" style="margin-top:8px;">Download selected</button>
      <p class="muted" style="font-size:12px;">Photos go to this phone's Downloads. If a file with the same name is already there, Chrome keeps both and adds (1) to the new one; the browser doesn't let the app replace it.</p>` : ""}
    <div class="ph-result"></div>`;
  const fail = (m) => { box.querySelector(".ph-result").innerHTML = resultBox([m], true); };
  box.querySelector(".ph-file").onchange = async (ev) => {
    const stamp = await phStampInfo();
    for (const file of [...ev.target.files]) {
      try {
        const s = await phShrink(file, stamp);
        await fsp.sync.createRecord({
          type: "photo", companyKey: parent.companyKey, projectId: parent.projectId || undefined,
          data: { parentId: parent.id, mime: s.mime, b64: s.b64, width: s.width, height: s.height, takenAt: (stamp && stamp.at) || new Date().toISOString(), ...(stamp && stamp.lat != null ? { lat: stamp.lat, lng: stamp.lng, acc: stamp.acc } : {}) },
        });
      } catch (e) { return fail(e.message || String(e)); }
    }
    await phMount(box, parent, label, opts);
  };
  const cmp = box.querySelector(".ph-compare");
  if (cmp) cmp.onclick = () => phOpenCompare(phStageGroups(photos, stages), label);
  box.querySelectorAll(".ph-stage").forEach((sel) => {
    sel.onchange = () => pjSetStage(parent.id, sel.closest(".ph-item").dataset.id, sel.value);
  });
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
    img.onclick = () => phOpenViewer(parent, label, photos.findIndex((p) => p.id === img.closest(".ph-item").dataset.id), () => phMount(box, parent, label, opts));
  });
  box.querySelectorAll(".ph-del").forEach((b) => {
    b.onclick = async () => { await fsp.sync.deleteRecord(b.closest(".ph-item").dataset.id); await phMount(box, parent, label, opts); };
  });
}

// ----- Before / During / After side by side -----

const PH_STAGES = ["Before", "During", "After"];

/** { Before: [photo...], During: [...], After: [...], filled: how many of the three have a photo } */
function phStageGroups(photos, stages) {
  const g = { Before: [], During: [], After: [] };
  photos.forEach((p) => { const s = (stages || {})[p.id]; if (g[s]) g[s].push(p); });
  g.filled = PH_STAGES.filter((s) => g[s].length).length;
  return g;
}

/** Full-screen: the stages as columns (stacked on a narrow phone), every photo of each stage under its label. */
function phOpenCompare(groups, label) {
  const el = document.createElement("div");
  el.id = "phCompare"; el.className = "ph-viewer ph-cmp";
  const cols = PH_STAGES.filter((s) => groups[s].length);
  el.innerHTML = `<div class="ph-v-top"><span>${escapeHtml(label || "Photos")}</span><button type="button" class="btn secondary small ph-v-close">Close</button></div>
    <div class="ph-cmp-grid" style="grid-template-columns:repeat(${cols.length},1fr)">${cols.map((s) => `<div class="ph-cmp-col"><div class="ph-cmp-h">${s}</div>${groups[s].map((p) => `<figure><img alt="${s}" src="data:${escapeHtml(p.data.mime)};base64,${p.data.b64}">${p.data.caption ? `<figcaption>${escapeHtml(p.data.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`).join("")}</div>`;
  document.body.appendChild(el);
  el.querySelector(".ph-v-close").onclick = () => el.remove();
}
