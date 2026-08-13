// ===== config.js =====
//
// GAS_URL now points at the new Node/Postgres API (see MIGRATION_HANDOFF),
// not the old Apps Script /exec endpoint -- update DEFAULT_GAS_URL below to
// wherever that's actually deployed (e.g. "https://your-api.onrender.com/api").
const DEFAULT_GAS_URL = "https://fieldscanpro-api.onrender.com/api";
let GAS_URL = localStorage.getItem("fieldscan_backend_url") || DEFAULT_GAS_URL;

// AUTH_TOKEN (the old shared-secret model) is no longer checked by the new
// backend -- real auth is now a Google ID token, sent as an Authorization
// header (see getGoogleIdToken()/apiRequestHeaders() in api.js). Left here,
// still sent, and harmlessly ignored server-side, only so nothing else in
// this file needs to change; safe to delete once nothing references it.
const AUTH_TOKEN = "FieldScan2025!SecureToken";
const FIELD_SCAN_USER = {
  email: localStorage.getItem("fieldscan_user_email") || "",
  role: localStorage.getItem("fieldscan_user_role") || "admin",
};
const ATTACHMENT_DELIMITER = "|||";
