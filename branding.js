// branding.js
// Unified branding components for FieldScan Pro
// Structure: Logo → Body (variable) → Signature (toggleable) → Footer (fixed)

const BRANDING = {
  companyName: "FieldScan Pro",
  address: "Road 1 House 5B, Isheri-Brooks Estate, Isheri-Olofin, Ogun State",
  phone1: "+234 809 260 8103",
  phone2: "+234 708 260 8103",
  email: "pi.projects20@gmail.com",
};

function _getSettings() {
  const cache = typeof getCache === "function" ? getCache() : {};
  return cache.settings || {};
}

async function _getLogoUrl() {
  const settings = _getSettings();
  return settings.Logo ? await resolveImageToDataUrl(settings.Logo) : "";
}

// Lazily fetched once per app session and cached in memory -- avoids a
// network round-trip every single time a document is generated. Cleared
// on sign-out isn't needed since a full app restart is required to sign
// in as someone else anyway (see main.js's clearRefreshToken on launch).
let _cachedMyProfile = null;
async function _getMyProfile() {
  if (_cachedMyProfile) return _cachedMyProfile;
  try {
    const resp = await callApi("getMyProfile", {});
    _cachedMyProfile = resp && resp.success ? resp : {};
  } catch (e) {
    _cachedMyProfile = {};
  }
  return _cachedMyProfile;
}
// Call this after saving a new signature (see the Settings page) so the
// next document generated in this session picks up the change without
// needing a full app restart.
function _invalidateMyProfileCache() {
  _cachedMyProfile = null;
}
window.invalidateMyProfileCache = _invalidateMyProfileCache;

/**
 * Per-user signature takes priority -- each user manages their own,
 * shown on documents THEY personally generate. Falls back to the
 * one-per-company signature (company_settings.Sign_Signed) only if this
 * user hasn't set their own yet, so documents still have a signature
 * before everyone's gotten around to uploading their own.
 */
async function _getSignImageUrl() {
  const profile = await _getMyProfile();
  if (profile.signatureImage) return await resolveImageToDataUrl(profile.signatureImage);
  const settings = _getSettings();
  return settings.Sign_Signed ? await resolveImageToDataUrl(settings.Sign_Signed) : "";
}

async function _getSignatoryName() {
  const profile = await _getMyProfile();
  if (profile.signatureName) return profile.signatureName;
  const settings = _getSettings();
  return settings.Name_Signed || "";
}

/**
 * Logo block — fixed position top-right, height 120px.
 * Same for ALL documents, portrait or landscape.
 */
async function generateLogoBlock() {
  const logoUrl = await _getLogoUrl();
  if (!logoUrl) return `<div style="height: 90px;"></div>`;
  return `<div style="display: flex; justify-content: flex-end; align-items: flex-start; margin-bottom: 28px;">
    <img src="${escapeAttr(logoUrl)}" style="height: 120px; max-width: 200px; object-fit: contain; display: block;" onerror="this.style.display='none'">
  </div>`;
}

/**
 * Unified footer — fixed position at bottom.
 */
function generateUnifiedFooter() {
  return `<div class="unified-footer" style="
    position: absolute;
    bottom: 5mm;
    left: 20mm;
    right: 20mm;
    border-top: 1px solid #888;
    padding-top: 6px;
    text-align: center;
    font-size: 9pt;
    color: #444;
    line-height: 1.6;
  ">
    <div>&#128205; ${escapeHtml(BRANDING.address)}</div>
    <div>
      &#128222; ${escapeHtml(BRANDING.phone1)} &nbsp;&nbsp;&nbsp;
      &#128222; ${escapeHtml(BRANDING.phone2)} &nbsp;&nbsp;&nbsp;
      &#9993; ${escapeHtml(BRANDING.email)}
    </div>
  </div>`;
}

/**
 * Unified signature block — uses Settings sign image + name.
 */
async function generateUnifiedSignatureBlock(options) {
  const {
    label = "Authorized Signatory",
    signatoryName = "",
    signatoryTitle = "",
  } = options || {};

  const signImageUrl = await _getSignImageUrl();
  const settingsName = await _getSignatoryName();
  const finalName = signatoryName || settingsName || "";

  return `<div class="unified-signature" style="margin-top: 32px; page-break-inside: avoid; text-align: left;">
    <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; color: #495057;">${escapeHtml(label)}</div>
    <div style="display: inline-block; text-align: center;">
      ${signImageUrl ? `<div style="margin-bottom: 4px;"><img src="${escapeAttr(signImageUrl)}" style="max-height:50px; max-width:150px; object-fit:contain;" onerror="this.style.display='none'"></div>` : ""}
      <div style="border-bottom: 1.5px solid #000; width: 200px; margin: 0 auto 4px auto;"></div>
      <div style="font-size: 12px; font-weight: 700;">${escapeHtml(finalName || "_________________________")}</div>
      ${signatoryTitle ? `<div style="font-size: 11pt; color: #333;">${escapeHtml(signatoryTitle)}</div>` : ""}
    </div>
  </div>`;
}

/**
 * Full page wrapper — Logo + Body + Signature(conditional) + Footer.
 * Body content is fully variable per report type.
 */
async function wrapUnifiedPage(bodyContent, options) {
  const {
    showSignature = true,
    signatoryName = "",
    signatoryTitle = "",
    signatureLabel = "Authorized Signatory",
  } = options || {};

  const logo = await generateLogoBlock();
  const footer = generateUnifiedFooter();
  const signature = showSignature
    ? await generateUnifiedSignatureBlock({
        label: signatureLabel,
        signatoryName,
        signatoryTitle,
      })
    : "";

  return `<div class="unified-page" style="
    position: relative;
    min-height: calc(297mm - 1mm);
    background: white;
    font-family: 'Calibri', 'Georgia', serif;
    font-size: 12pt;
    color: #000;
    padding: 10mm 10mm 15mm 15mm;
    box-sizing: border-box;
  ">
    ${logo}
    <div class="unified-body" style="margin-bottom: 32px;">
      ${bodyContent}
    </div>
    ${signature}
    ${footer}
  </div>`;
}

// Expose to global scope
window.BRANDING = BRANDING;
window.generateLogoBlock = generateLogoBlock;
window.generateUnifiedFooter = generateUnifiedFooter;
window.generateUnifiedSignatureBlock = generateUnifiedSignatureBlock;
window.wrapUnifiedPage = wrapUnifiedPage;
