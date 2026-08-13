// ===== utils.js =====
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, function (m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    if (m === '"') return "&quot;";
    if (m === "'") return "&#39;";
    return m;
  });
}
function escapeAttr(str) {
  return escapeHtml(str)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

function roundMoney(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function moneyValue(val) {
  const n = roundMoney(val);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function splitAttachments(val) {
  return String(val || "")
    .split(ATTACHMENT_DELIMITER)
    .map((s) => s.trim())
    .filter(Boolean);
}
function normalizeAttachments(files) {
  return files.filter(Boolean).join(ATTACHMENT_DELIMITER);
}
function idsMatch(a, b) {
  return String(a).trim() === String(b).trim();
}

async function compressImageToTargetLimit(base64, maxBytes = 190000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onerror = () => resolve(base64);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width,
        h = img.height;
      if (w > 1000) {
        h *= 1000 / w;
        w = 1000;
      }
      if (h > 1000) {
        w *= 1000 / h;
        h = 1000;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let quality = 0.8;
      let result = canvas.toDataURL("image/jpeg", quality);
      while (result.length > maxBytes && quality > 0.2) {
        quality -= 0.1;
        result = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(result);
    };
  });
}

function showPdfCompressing() {
  let overlay = document.getElementById("pdf-compress-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "pdf-compress-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:6000;";
    overlay.innerHTML = `<div style="background:white;border-radius:20px;padding:24px;text-align:center;max-width:280px;"><div style="font-size:32px;margin-bottom:12px;"><i class="fas fa-cog fa-spin"></i></div><div style="font-weight:800;font-size:16px;">Compressing PDF…</div><div style="font-size:13px;color:#495057;margin-top:6px;">Please wait</div></div>`;
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = "flex";
  }
}

function hidePdfCompressing() {
  const overlay = document.getElementById("pdf-compress-overlay");
  if (overlay) overlay.style.display = "none";
}

// Non-blocking toast notification — replaces alert() for sync messages
function showSyncToast(message, durationMs = 3000) {
  let toast = document.getElementById("fieldscan-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "fieldscan-toast";
    toast.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
      "background:#000;color:#fff;padding:12px 20px;border-radius:14px;" +
      "font-size:14px;font-weight:700;z-index:7000;max-width:90%;text-align:center;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:opacity 0.3s;";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.display = "block";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.style.display = "none";
    }, 300);
  }, durationMs);
}

async function compressPdfToTargetLimit(base64, maxBytes = 300000) {
  if (typeof PDFLib === "undefined") {
    throw new Error(
      "PDF library not loaded. Please check your connection and retry.",
    );
  }
  const originalSize = (base64.length / 1024).toFixed(0);
  if (base64.length > 10000000) {
    if (
      !confirm(`This PDF is ${originalSize} KB. Compressing large files may take a moment and could freeze the app briefly.

Continue?`)
    ) {
      throw new Error("User cancelled large PDF compression.");
    }
  }
  showPdfCompressing();
  // Yield to UI thread so the overlay renders before heavy work begins
  await new Promise((r) => setTimeout(r, 50));
  try {
    const { PDFDocument } = PDFLib;
    const base64Data = base64.split(",")[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    const compressed = await pdfDoc.save({ useObjectStreams: true });
    // Convert back to base64 in chunks to avoid stack overflow
    const chunks = [];
    const chunkSize = 0x8000;
    for (let i = 0; i < compressed.length; i += chunkSize) {
      chunks.push(
        String.fromCharCode.apply(null, compressed.subarray(i, i + chunkSize)),
      );
    }
    const newBase64 = "data:application/pdf;base64," + btoa(chunks.join(""));
    if (newBase64.length > maxBytes) {
      throw new Error(
        `PDF too large (${(newBase64.length / 1024).toFixed(0)} KB). Max allowed: ${(maxBytes / 1024).toFixed(0)} KB. Try a smaller file or scan at lower resolution.`,
      );
    }
    return newBase64;
  } catch (err) {
    if (err.message && err.message.includes("Max allowed")) throw err;
    throw new Error(
      "PDF compression failed: " + (err.message || "Unknown error"),
    );
  } finally {
    hidePdfCompressing();
  }
}

/**
 * Old (Apps Script) image references were Drive file IDs, resolved via a
 * doGet(?id=...&token=...) proxy on the GAS backend. Photos now live in
 * Supabase Storage, referenced by storagePath (e.g.
 * "photos/<companyId>/photo_<id>.jpg") -- the bucket is private, so the
 * frontend can't read it directly; it goes through the new backend's
 * "getPhotoDataUrl" action instead, which fetches the object server-side
 * (using the service-role key, never exposed to the client) and returns
 * a data URI.
 *
 * A bare "data:" URI (e.g. Settings' Logo/Sign_Signed, which are stored
 * directly rather than uploaded to Storage) is returned as-is -- no
 * network round-trip needed for those at all.
 */
async function resolveImageToDataUrl(storagePathOrDataUrl) {
  if (!storagePathOrDataUrl) return "";
  if (storagePathOrDataUrl.startsWith("data:")) return storagePathOrDataUrl;
  try {
    const resp = await callApi("getPhotoDataUrl", { storagePath: storagePathOrDataUrl });
    return resp && resp.success && resp.dataUrl ? resp.dataUrl : "";
  } catch (e) {
    console.error("resolveImageToDataUrl failed for", storagePathOrDataUrl, e);
    return "";
  }
}

function getGPSLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("GPS Not Supported");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve(
          `Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(5)}`,
        ),
      () => resolve("GPS Unavailable"),
      { timeout: 7000, maximumAge: 60000 },
    );
  });
}

function todayFormatted() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

function paymentDirectionOf(p) {
  return (
    p.paymentDirection ||
    p.direction ||
    (p.payee === "Client" ? "Client Receipt" : "Outgoing Payment")
  );
}
function isClientReceipt(p) {
  return paymentDirectionOf(p) === "Client Receipt";
}
function isPettyExpense(p) {
  return paymentDirectionOf(p) === "Small Expense";
}

function getTaxRate(key) {
  const cache = getCache();
  const settings = cache.settings || {};
  const rate = settings[key];
  return typeof rate === "number" && !isNaN(rate) ? rate : 0;
}
function formatTaxRate(rate) {
  return (rate * 100).toFixed(1) + "%";
}
function calculateTax(amount, key) {
  return roundMoney((Number(amount) || 0) * getTaxRate(key));
}

// Defensive against both the raw {success, data} response shape and an
// already-unwrapped cache — settings.js/reports.js normalize this
// inconsistently elsewhere, so don't assume either shape here.
function getRecycleBinRetentionDays() {
  const cache = getCache();
  const raw = cache.settings || {};
  const settings = raw.data || raw;
  const val = Number(settings.RecycleBinRetentionDays);
  return !isNaN(val) && val > 0 ? val : 30;
}