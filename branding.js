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

/**
 * Single source of truth for company letterhead details (name, address,
 * phone1/2, email, TIN, VAT registration number, slogan, registration
 * number). Settings first, falling back to the original hardcoded
 * BRANDING defaults for the five fields that existed before Company
 * Details was built -- so nothing goes blank for anyone who hasn't
 * filled in the new Settings dialog yet. The four brand-new fields
 * (TIN, VAT number, slogan, registration number) have no old hardcoded
 * equivalent, so they simply default to empty until set.
 *
 * Synchronous on purpose -- unlike logo/signature, none of these need
 * an image fetch; settings are already sitting in cache by the time
 * any document gets generated.
 */
function _getCompanyDetails() {
  const settings = _getSettings();
  const data = settings && settings.data ? settings.data : settings;
  return {
    // These 4 are the only ones any document currently reads. Blank ->
    // a bracketed placeholder label, NOT the original hardcoded
    // real-world address/phone/email -- silently showing one specific
    // company's actual details to every other company using this app
    // whenever they hadn't filled in Settings yet was the actual bug
    // here, not just "missing a fallback."
    address: data.CompanyAddress || "[Address]",
    phone1: data.CompanyPhone1 || "[Phone 1]",
    phone2: data.CompanyPhone2 || "[Phone 2]",
    email: data.CompanyEmail || "[Email]",
    // Not yet used anywhere (see prior note) -- left as empty string
    // rather than a placeholder, since an unused field showing
    // "[Company Name]" in some future spot with no context would be
    // more confusing than helpful until it's actually wired in.
    name: data.CompanyName || "",
    tin: data.CompanyTIN || "",
    vatNumber: data.CompanyVatNumber || "",
    slogan: data.CompanySlogan || "",
    registrationNumber: data.CompanyRegistrationNumber || "",
  };
}

async function _getLogoUrl() {
  const settings = _getSettings();
  const data = settings && settings.data ? settings.data : settings;
  return data.Logo ? await resolveImageToDataUrl(data.Logo) : "";
}

/**
 * Multiplier applied to the logo's display size on every generated
 * document -- 1.0 is the original size, adjustable in 0.1 steps from
 * Settings. Bounded defensively here too (not just at the input's own
 * min/max) in case a stale/unexpected value ever comes back from the
 * server -- 0 or a negative number would make the logo invisible or
 * render nonsensically.
 */
function _getLogoSizeFactor() {
  const settings = _getSettings();
  const data = settings && settings.data ? settings.data : settings;
  const factor = Number(data.LogoSizeFactor);
  return factor > 0 ? factor : 1.0;
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
  const f = _getLogoSizeFactor();
  return `<div style="display: flex; justify-content: flex-end; align-items: flex-start; margin-bottom: 28px;">
    <img src="${escapeAttr(logoUrl)}" style="height: ${Math.round(120 * f)}px; max-width: ${Math.round(200 * f)}px; object-fit: contain; display: block;" onerror="this.style.display='none'">
  </div>`;
}

/**
 * Unified footer — fixed position at bottom.
 */
function generateUnifiedFooter() {
  const c = _getCompanyDetails();
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
    <div>&#128205; ${escapeHtml(c.address)}</div>
    <div>
      &#128222; ${escapeHtml(c.phone1)} &nbsp;&nbsp;&nbsp;
      &#128222; ${escapeHtml(c.phone2)} &nbsp;&nbsp;&nbsp;
      &#9993; ${escapeHtml(c.email)}
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
window._getCompanyDetails = _getCompanyDetails;
window._getLogoSizeFactor = _getLogoSizeFactor;
window.generateLogoBlock = generateLogoBlock;
window.generateUnifiedFooter = generateUnifiedFooter;
window.generateUnifiedSignatureBlock = generateUnifiedSignatureBlock;
window.wrapUnifiedPage = wrapUnifiedPage;
