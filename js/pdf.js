// ===== Real PDF files, built on the phone =====
// The report screens produce HTML for printing. This turns that same HTML into an actual PDF (text stays text, photos are
// embedded as they are) and hands it to the phone's share sheet, so a report goes straight to WhatsApp or e-mail.
// No library: a small PDF writer with the two standard fonts (Helvetica, Helvetica Bold).

const PDF_W = 595.28, PDF_H = 841.89, PDF_M = 42;
const PDF_HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const PDF_BW = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Text -> a string of WinAnsi characters (what the standard fonts draw). Anything else becomes "?"; ₦ becomes "N". */
function pdfWin(s) {
  const map = { "₦": "N", "—": "\x97", "–": "\x96", "·": "\xB7", "•": "\x95", "‘": "\x91", "’": "\x92", "“": "\x93", "”": "\x94", "…": "\x85", "✓": "v", "✗": "x", "×": "\xD7", "°": "\xB0", "±": "\xB1", "²": "\xB2", "³": "\xB3", "½": "\xBD", " ": " ", "\t": " " };
  let out = "";
  for (const ch of String(s == null ? "" : s)) {
    if (map[ch] !== undefined) out += map[ch];
    else { const c = ch.charCodeAt(0); out += (c >= 32 && c <= 126) || (c >= 160 && c <= 255) ? ch : "?"; }
  }
  return out;
}
const pdfCharW = (ch, bold) => { const c = ch.charCodeAt(0); return ((c >= 32 && c <= 126 ? (bold ? PDF_BW : PDF_HW)[c - 32] : 556) / 1000); };
const pdfTextW = (s, size, bold) => { let w = 0; for (const ch of s) w += pdfCharW(ch, bold); return w * size; };

/** Splits text into lines no wider than `width` (points), keeping explicit line breaks. */
function pdfWrap(text, size, bold, width) {
  const out = [];
  for (const para of String(text == null ? "" : text).split(/\r?\n/).map(pdfWin)) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (pdfTextW(test, size, bold) <= width || !line) {
        if (pdfTextW(test, size, bold) > width) { // one word longer than the line: break it
          let chunk = "";
          for (const ch of test) { if (pdfTextW(chunk + ch, size, bold) > width && chunk) { out.push(chunk); chunk = ""; } chunk += ch; }
          line = chunk;
        } else line = test;
      } else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** Width and height of a JPEG (read from its header), or null. */
function pdfJpegSize(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}
function pdfB64ToBytes(b64) {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * blocks: { t: "h1"|"h2"|"h3"|"p"|"gap" , text } | { t: "table", rows: [[cell...]], header: bool, widths?: [fractions] }
 *       | { t: "photos", items: [{ b64, caption }] }
 * -> Uint8Array (a complete PDF).
 */
function pdfBuild({ title, blocks, footer }) {
  const pages = [];
  let page = null, y = 0;
  const newPage = () => { page = { ops: [], images: [] }; pages.push(page); y = PDF_H - PDF_M; };
  const need = (h) => { if (!page || y - h < PDF_M + 18) newPage(); };
  const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const text = (s, x, yy, size, bold, gray) => { page.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray != null ? gray + " g" : "0 g"} ${x.toFixed(2)} ${yy.toFixed(2)} Td (${esc(s)}) Tj ET`); };
  const rect = (x, yy, w, h, gray) => page.ops.push(`${gray} g ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
  const line = (x1, yy, x2, gray) => page.ops.push(`${gray} G 0.5 w ${x1.toFixed(2)} ${yy.toFixed(2)} m ${x2.toFixed(2)} ${yy.toFixed(2)} l S 0 G`);
  const W = PDF_W - PDF_M * 2;
  const H = { h1: [20, true, 26], h2: [14, true, 20], h3: [11.5, true, 18], p: [10, false, 14] };

  for (const b of blocks) {
    if (b.t === "gap") { y -= b.h || 8; continue; }
    if (H[b.t]) {
      const [size, bold, lead] = H[b.t];
      const lines = pdfWrap(b.text, size, bold, W);
      if (b.t !== "p") { need(lead * Math.min(lines.length, 2) + 8); y -= b.t === "h1" ? 0 : 6; }
      for (const l of lines) { need(lead); y -= lead; text(l, PDF_M, y + (lead - size) / 2 - 1, size, bold); }
      y -= b.t === "p" ? 4 : 2;
    } else if (b.t === "table") {
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      let fr = b.widths;
      if (!fr || fr.length !== cols) {
        const mx = Array.from({ length: cols }, (_, c) => Math.max(4, ...b.rows.map((r) => Math.min(40, String(r[c] == null ? "" : r[c]).length))));
        const tot = mx.reduce((a, c) => a + c, 0); fr = mx.map((m) => m / tot);
      }
      const colW = fr.map((f) => W * f), size = 9, lead = 12;
      b.rows.forEach((row, ri) => {
        const head = b.header && ri === 0;
        const cells = colW.map((cw, c) => pdfWrap(String(row[c] == null ? "" : row[c]), size, head, cw - 8));
        const h = Math.max(...cells.map((l) => l.length)) * lead + 6;
        need(h);
        if (head) rect(PDF_M, y - h, W, h, 0.9);
        let x = PDF_M;
        cells.forEach((ls, c) => {
          const right = /^[N₦]?[-−]?[\d,]+(\.\d+)?%?$/.test(String(row[c] == null ? "" : row[c]).replace(/^₦/, "N")) && ri > 0 && cols > 2 && c > 0;
          ls.forEach((l, li) => { const tx = right ? x + colW[c] - 4 - pdfTextW(l, size, head) : x + 4; text(l, tx, y - 3 - lead * (li + 1) + 3, size, head); });
          x += colW[c];
        });
        y -= h; line(PDF_M, y, PDF_M + W, y, 0.8);
      });
      y -= 8;
    } else if (b.t === "photos") {
      const gap = 10, cw = (W - gap) / 2, maxH = 190;
      for (let i = 0; i < b.items.length; i += 2) {
        const row = b.items.slice(i, i + 2).map((it) => {
          const bytes = pdfB64ToBytes(it.b64), sz = pdfJpegSize(bytes) || { w: 4, h: 3 };
          const sc = Math.min(cw / sz.w, maxH / sz.h), w = sz.w * sc, h = sz.h * sc;
          return { it, bytes, sz, w, h, cap: it.caption ? pdfWrap(it.caption, 8.5, false, cw) : [] };
        });
        const rh = Math.max(...row.map((r) => r.h + r.cap.length * 11 + 6));
        need(rh + 4);
        row.forEach((r, k) => {
          const x = PDF_M + k * (cw + gap), top = y;
          const idx = page.images.length;
          page.images.push({ bytes: r.bytes, w: r.sz.w, h: r.sz.h });
          page.ops.push(`q ${r.w.toFixed(2)} 0 0 ${r.h.toFixed(2)} ${x.toFixed(2)} ${(top - r.h).toFixed(2)} cm /Im${idx} Do Q`);
          r.cap.forEach((l, li) => text(l, x, top - r.h - 10 - li * 11, 8.5, false, 0.3));
        });
        y -= rh + 6;
      }
    }
  }
  if (!pages.length) newPage();

  // ---- serialise ----
  const chunks = []; const offsets = []; let len = 0;
  const push = (s) => { const b = typeof s === "string" ? Uint8Array.from(s, (c) => c.charCodeAt(0) & 255) : s; chunks.push(b); len += b.length; };
  const obj = (n, bodyParts) => { offsets[n] = len; push(`${n} 0 obj\n`); bodyParts.forEach(push); push("\nendobj\n"); };
  const total = pages.length;
  // object ids: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page, content, images...
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  let next = 5; const pageIds = [], pageObjs = [];
  pages.forEach((pg) => {
    const pid = next++, cid = next++; const imgIds = pg.images.map(() => next++);
    pageIds.push(pid); pageObjs.push({ pg, pid, cid, imgIds });
  });
  obj(1, [`<< /Type /Catalog /Pages 2 0 R >>`]);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((i) => i + " 0 R").join(" ")}] /Count ${total} >>`]);
  obj(3, [`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`]);
  obj(4, [`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`]);
  pageObjs.forEach(({ pg, pid, cid, imgIds }, pi) => {
    const foot = [];
    const save = page; page = pg; // draw the page footer onto this page
    const label = pdfWin(`${footer || ""}${footer ? "   ·   " : ""}Page ${pi + 1} of ${total}`);
    text(label, PDF_W - PDF_M - pdfTextW(label, 8, false), 24, 8, false, 0.45);
    if (title) text(pdfWin(title).slice(0, 80), PDF_M, 24, 8, false, 0.45);
    page = save;
    const content = pg.ops.join("\n");
    obj(pid, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${imgIds.map((id, k) => `/Im${k} ${id} 0 R`).join(" ")} >> >> /Contents ${cid} 0 R >>`]);
    obj(cid, [`<< /Length ${content.length} >>\nstream\n`, content, `\nendstream`]);
    pg.images.forEach((im, k) => obj(imgIds[k], [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, `\nendstream`]));
  });
  const xref = len, count = next;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(String(offsets[n]).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0;
  chunks.forEach((c) => { out.set(c, o); o += c.length; });
  return out;
}

/** The report HTML (as rpInspectionHtml / rpDiaryHtml / the snag report make it) -> blocks for pdfBuild. */
function pdfBlocksFromHtml(html) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html");
  const blocks = [];
  const txt = (el) => { const c = el.cloneNode(true); c.querySelectorAll("br").forEach((b) => b.replaceWith("\n")); return c.textContent.replace(/[ \t]+/g, " ").replace(/\n /g, "\n").trim(); };
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName;
      if (tag === "H1" || tag === "H2" || tag === "H3") blocks.push({ t: tag.toLowerCase(), text: txt(n) });
      else if (tag === "P") { const t = txt(n); if (t) blocks.push({ t: "p", text: t }); }
      else if (tag === "TABLE") {
        const rows = [...n.rows].map((r) => [...r.cells].map((c) => txt(c)));
        const meta = n.classList.contains("rp-meta");
        blocks.push({ t: "table", rows, header: !meta && !!n.querySelector("th"), widths: meta ? [0.25, 0.75] : undefined });
        blocks.push({ t: "gap", h: 4 });
      } else if (n.classList.contains("rp-photos")) {
        const items = [...n.querySelectorAll(".rp-photo")].map((p) => {
          const img = p.querySelector("img"), m = img && /^data:([^;]+);base64,(.*)$/.exec(img.getAttribute("src") || "");
          const cap = p.querySelector("div");
          return m ? { mime: m[1], b64: m[2], caption: cap ? txt(cap) : "" } : null;
        }).filter(Boolean);
        if (items.length) blocks.push({ t: "photos", items });
      } else walk(n);
    }
  };
  walk(doc.getElementById("r"));
  return blocks;
}

/** Makes sure every photo is a JPEG (PNG ones are redrawn through a canvas). Photos that can't be converted are left out. */
async function pdfPrepareImages(blocks) {
  for (const b of blocks) {
    if (b.t !== "photos") continue;
    const ok = [];
    for (const it of b.items) {
      if (/jpe?g/i.test(it.mime)) { ok.push(it); continue; }
      try {
        const jpg = await pdfToJpeg(it.mime, it.b64);
        if (jpg) ok.push({ ...it, b64: jpg });
      } catch (e) { /* skip this photo */ }
    }
    b.items = ok;
  }
  return blocks.filter((b) => b.t !== "photos" || b.items.length);
}
function pdfToJpeg(mime, b64) {
  if (window.pdfToJpegImpl) return window.pdfToJpegImpl(mime, b64);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0); resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]); };
    img.onerror = () => reject(new Error("image"));
    img.src = `data:${mime};base64,${b64}`;
  });
}

/** Offers the PDF to the phone's share sheet (WhatsApp, e-mail, Drive…); where that isn't possible it is saved to Downloads. Returns "shared" | "saved" | "cancelled". */
async function pdfShare(bytes, fileName, title) {
  if (window.pdfShareImpl) return window.pdfShareImpl(bytes, fileName, title);
  const name = String(fileName || "report").replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\.pdf$/i, "") + ".pdf";
  const file = new File([bytes], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; /* fall through to saving */ }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "saved";
}

/** Report HTML -> PDF -> share sheet. The one call the screens make. */
async function rpSharePdf(html, fileName, title) {
  try {
    let blocks = pdfBlocksFromHtml(html);
    blocks = await pdfPrepareImages(blocks);
    const bytes = pdfBuild({ title: title || fileName, blocks, footer: "FieldScan Pro" });
    const r = await pdfShare(bytes, String(fileName || "report").replace(/\.pdf$/i, "") + ".pdf", title);
    if (window.showStatus) showStatus(r === "shared" ? "Shared." : r === "saved" ? "Saved the PDF to this phone's Downloads." : "Cancelled.");
    return r;
  } catch (e) {
    if (window.showStatus) showStatus("Couldn't make the PDF: " + (e.message || e), true);
    return "error";
  }
}
