// ===== Photo editor: crop, draw and add text =====
// The same file runs on the phone and on the desktop. phEdit(photo) opens a full-screen editor and resolves with
// { mime, b64, width, height } for the edited picture, or null if the person cancelled. Tests replace it with window.phEditImpl.

/** A drag from corner a to corner b -> a crop rectangle kept inside the picture, or null if it is too small to mean anything. */
function phNormRect(a, b, w, h, min) {
  const m = min == null ? 8 : min;
  const x1 = Math.max(0, Math.min(a.x, b.x)), y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(w, Math.max(a.x, b.x)), y2 = Math.min(h, Math.max(a.y, b.y));
  if (x2 - x1 < m || y2 - y1 < m) return null;
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

/** Screen position of a pointer event -> position in the picture's own pixels. */
function phPoint(ev, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) * canvas.width) / (r.width || 1), y: ((ev.clientY - r.top) * canvas.height) / (r.height || 1) };
}

const PHE_COLORS = ["#e53935", "#fdd835", "#1e88e5", "#43a047", "#ffffff", "#000000"];
const PHE_SIZES = { thin: 0.004, medium: 0.008, thick: 0.016 }; // as a fraction of the picture's long side

function pheStyle() {
  if (document.getElementById("pheStyle")) return;
  const st = document.createElement("style");
  st.id = "pheStyle";
  st.textContent = `.phe{position:fixed;inset:0;z-index:300;background:#000;color:#fff;display:flex;flex-direction:column;font-family:system-ui,sans-serif}
.phe-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;padding:6px 8px}
.phe-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.phe-wrap{position:relative;line-height:0}
.phe-wrap canvas{max-width:100vw;max-height:calc(100vh - 190px);touch-action:none;display:block}
.phe-wrap canvas.phe-ov{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.phe button{background:#333;color:#fff;border:1px solid #666;border-radius:6px;padding:8px 12px;font-size:14px;min-height:38px}
.phe button.on{background:#1e88e5;border-color:#90caf9}
.phe button:disabled{opacity:.4}
.phe .phe-save{background:#2e7d32;border-color:#81c784}
.phe .phe-sw{width:30px;height:30px;min-height:0;padding:0;border-radius:50%;border:2px solid #888}
.phe .phe-sw.on{border-color:#fff;box-shadow:0 0 0 2px #1e88e5}
.phe input[type=text]{padding:8px;border-radius:6px;border:1px solid #666;background:#222;color:#fff;font-size:14px;min-width:0;flex:1;max-width:260px}
.phe .phe-msg{text-align:center;font-size:13px;min-height:18px}`;
  document.head.appendChild(st);
}

function phEdit(photo) {
  if (window.phEditImpl) return window.phEditImpl(photo);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("The app couldn't open that photo for editing."));
    img.onload = () => {
      pheStyle();
      const el = document.createElement("div");
      el.id = "phEditor"; el.className = "phe";
      el.innerHTML = `<div class="phe-row">
          <button type="button" data-tool="pen" class="on">Draw</button><button type="button" data-tool="text">Text</button><button type="button" data-tool="crop">Crop</button>
          <button type="button" class="phe-undo">Undo</button>
        </div>
        <div class="phe-row phe-opts"></div>
        <div class="phe-stage"><div class="phe-wrap"><canvas class="phe-main"></canvas><canvas class="phe-ov"></canvas></div></div>
        <div class="phe-msg"></div>
        <div class="phe-row"><button type="button" class="phe-cancel">Cancel</button><button type="button" class="phe-apply" hidden>Apply crop</button><button type="button" class="phe-save">Save</button></div>`;
      document.body.appendChild(el);
      const q = (s) => el.querySelector(s);
      const main = q(".phe-main"), ov = q(".phe-ov"), ctx = main.getContext("2d");
      if (!ctx) { el.remove(); reject(new Error("This device can't edit photos.")); return; }
      main.width = ov.width = img.naturalWidth; main.height = ov.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      let tool = "pen", color = PHE_COLORS[0], size = "medium", sel = null, drawing = false, last = null, start = null;
      const history = [];
      const msg = (t) => { q(".phe-msg").textContent = t || ""; };
      const longSide = () => Math.max(main.width, main.height);
      const snapshot = () => {
        const c = document.createElement("canvas"); c.width = main.width; c.height = main.height;
        c.getContext("2d").drawImage(main, 0, 0);
        history.push(c); if (history.length > 20) history.shift();
        q(".phe-undo").disabled = false;
      };
      const clearSel = () => { sel = null; ov.getContext("2d").clearRect(0, 0, ov.width, ov.height); q(".phe-apply").hidden = true; };
      const drawSel = () => {
        const o = ov.getContext("2d"); o.clearRect(0, 0, ov.width, ov.height);
        if (!sel) return;
        o.fillStyle = "rgba(0,0,0,0.5)"; o.fillRect(0, 0, ov.width, ov.height);
        o.clearRect(sel.x, sel.y, sel.w, sel.h);
        o.strokeStyle = "#fff"; o.lineWidth = Math.max(2, longSide() / 400); o.setLineDash([12, 8]); o.strokeRect(sel.x, sel.y, sel.w, sel.h);
      };
      const options = () => {
        const box = q(".phe-opts");
        if (tool === "crop") { box.innerHTML = `<span style="font-size:13px">Drag on the picture to choose what to keep, then tap Apply crop.</span>`; return; }
        box.innerHTML = PHE_COLORS.map((c) => `<button type="button" class="phe-sw${c === color ? " on" : ""}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("") +
          Object.keys(PHE_SIZES).map((s) => `<button type="button" data-size="${s}" class="${s === size ? "on" : ""}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("") +
          (tool === "text" ? `<input type="text" class="phe-text" placeholder="Type, then tap where it goes" maxlength="80">` : "");
        box.querySelectorAll("[data-color]").forEach((b) => { b.onclick = () => { color = b.dataset.color; options(); }; });
        box.querySelectorAll("[data-size]").forEach((b) => { b.onclick = () => { size = b.dataset.size; options(); }; });
      };
      const setTool = (t) => {
        tool = t; clearSel(); msg("");
        el.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
        options();
      };
      el.querySelectorAll("[data-tool]").forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
      const line = (a, b) => {
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, longSide() * PHE_SIZES[size]); ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      };
      main.onpointerdown = (ev) => {
        const p = phPoint(ev, main);
        if (tool === "pen") {
          snapshot(); drawing = true; last = p; line(p, { x: p.x + 0.01, y: p.y });
          main.setPointerCapture && main.setPointerCapture(ev.pointerId);
        } else if (tool === "text") {
          const input = q(".phe-text"), text = input ? input.value.trim() : "";
          if (!text) { msg("Type the text first, then tap where it goes."); return; }
          snapshot();
          const px = Math.max(14, Math.round(longSide() * (PHE_SIZES[size] * 6 + 0.02)));
          ctx.font = `bold ${px}px sans-serif`; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
          ctx.lineWidth = Math.max(3, px / 6); ctx.strokeStyle = color === "#000000" ? "#fff" : "#000";
          ctx.strokeText(text, p.x, p.y); ctx.fillStyle = color; ctx.fillText(text, p.x, p.y);
          input.value = ""; msg("");
        } else if (tool === "crop") {
          start = p; sel = null; drawing = true; main.setPointerCapture && main.setPointerCapture(ev.pointerId);
        }
      };
      main.onpointermove = (ev) => {
        if (!drawing) return;
        const p = phPoint(ev, main);
        if (tool === "pen") { line(last, p); last = p; }
        else if (tool === "crop") { sel = phNormRect(start, p, main.width, main.height, 0); drawSel(); }
      };
      main.onpointerup = main.onpointercancel = () => {
        if (!drawing) return;
        drawing = false;
        if (tool === "crop") {
          if (sel && (sel.w < 8 || sel.h < 8)) { clearSel(); msg("Drag a larger area."); }
          q(".phe-apply").hidden = !sel;
        }
      };
      q(".phe-apply").onclick = () => {
        if (!sel) return;
        snapshot();
        const c = document.createElement("canvas"); c.width = sel.w; c.height = sel.h;
        c.getContext("2d").drawImage(main, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        main.width = ov.width = sel.w; main.height = ov.height = sel.h;
        ctx.drawImage(c, 0, 0);
        clearSel(); msg("Cropped. Undo brings the rest back.");
      };
      q(".phe-undo").disabled = true;
      q(".phe-undo").onclick = () => {
        const c = history.pop(); if (!c) return;
        main.width = ov.width = c.width; main.height = ov.height = c.height;
        ctx.drawImage(c, 0, 0); clearSel();
        q(".phe-undo").disabled = history.length === 0;
      };
      const done = (v) => { document.removeEventListener("keydown", onKey); el.remove(); resolve(v); };
      const onKey = (ev) => { if (ev.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      q(".phe-cancel").onclick = () => done(null);
      q(".phe-save").onclick = () => {
        if (!history.length) { done(null); return; } // nothing was changed
        done({ mime: "image/jpeg", b64: main.toDataURL("image/jpeg", 0.8).split(",")[1], width: main.width, height: main.height });
      };
      options();
    };
    img.src = `data:${photo.data ? photo.data.mime : photo.mime};base64,${photo.data ? photo.data.b64 : photo.b64}`;
  });
}
