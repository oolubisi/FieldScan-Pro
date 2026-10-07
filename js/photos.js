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
async function phMount(box, parent) {
  if (!box) return;
  const photos = (await fsp.sync.getRecords("photo")).filter((r) => r.data.parentId === parent.id)
    .sort((a, b) => String(a.data.takenAt || "").localeCompare(String(b.data.takenAt || "")));
  box.innerHTML = `<h3>Photos${photos.length ? ` (${photos.length})` : ""}</h3>
    <div class="ph-grid">${photos.map((p) => `<div class="ph-item" data-id="${escapeHtml(p.id)}">
      <img src="data:${escapeHtml(p.data.mime)};base64,${p.data.b64}" alt="Photo">
      <button type="button" class="btn danger small ph-del" aria-label="Remove photo">×</button></div>`).join("")}</div>
    <label class="btn secondary block ph-add">Add photo<input type="file" class="ph-file" accept="image/*" capture="environment" multiple hidden></label>
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
    await phMount(box, parent);
  };
  box.querySelectorAll(".ph-del").forEach((b) => {
    b.onclick = async () => { await fsp.sync.deleteRecord(b.closest(".ph-item").dataset.id); await phMount(box, parent); };
  });
}
