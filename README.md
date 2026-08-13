# FieldScan Pro — complete migration package

Everything from all three upload batches, reconciled against the real
backend, plus the fixes that reconciliation turned up. This folder should
be close to drop-in complete for your Electron app root.

## Files I modified this session (batch 3 — image serving + export)

- **utils.js** — `resolveImageToDataUrl()` rewritten. Photos now live in
  Supabase Storage (private bucket), not Google Drive, so the old
  `GAS_URL?id=...&token=...` doGet-proxy pattern is gone. Removed
  `getDirectImageUrl()` entirely (nothing else used it except the now-excluded
  variations.js). A bare `data:` URI (Settings' Logo/Sign_Signed) still
  short-circuits with zero network calls, same as before.
- **photos.js** — every `driveFileId` reference renamed to `storagePath`
  (field rename to match the new backend); `phFetchRemoteImage()` now calls
  the new `getPhotoDataUrl` backend action instead of a raw GET to a GAS URL.
- **modals.js, reports.js, projectexport.js** — same `driveFileId` →
  `storagePath` rename, same reason.

## Files I modified in earlier sessions (batches 1–2)

- index.html, config.js, db.js, api.js, main.js — see earlier conversation
  for details (Google Sign-In wiring, Content-Type/Auth headers, mutationId
  plumbing for offline sync).

## Files copied in unmodified (yours, for a complete folder)

Everything else — app.js, sw.js, backup.js, branding.js, and the ~25
feature-module files, icons, package.json, etc. I never touched these;
included so nothing's missing from the folder.

## ⚠️ variations.js — deliberately EXCLUDED

You confirmed Change Orders (changeorders.js) is the surviving feature and
Variations was being replaced by it. variations.js calls
getVariations/saveVariation/updateVariation/deleteVariation — none of
which exist on the backend, and I did not build them. If you still have a
variations.js file in your real project, remove it (or leave it disconnected)
rather than including it here.

## ⚠️ Still needs your action

1. **main.js line ~61**: replace the `GOOGLE_CLIENT_ID` placeholder.
2. **preload-additions.js**: merge into your real preload.js (never
   uploaded to me, so I can't edit it directly).
3. **vendor/ folder**: you mentioned you have this but haven't uploaded it
   (fonts, fontawesome, html2canvas, jspdf, pdf-lib, jszip) — add it back
   in yourself; nothing in it needed changes.
4. **backend/api/.env**: copy from `.env.example`, fill in DATABASE_URL,
   GOOGLE_CLIENT_ID (same value as main.js's), SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY.

## What the reconciliation pass found and fixed (backend side)

Diffing every `callApi("...")` call across all 43 uploaded files against
what the backend actually implements found exactly 5 missing actions:

- **getTakeOffTemplates / saveTakeOffTemplate / deleteTakeOffTemplate** —
  a real gap, now built (`backend/api/src/routes/takeOffTemplates.js`,
  `take_off_templates` table in schema.sql). Note: this table's primary
  key is a CLIENT-generated text id (matching templates.js's own
  `"TMPL-CUST-" + Date.now()` id generation), unlike every other table's
  server-issued uuid — saveTakeOffTemplate is a true upsert.
- **getVariations / deleteVariation** — NOT built, per your confirmation
  above that Variations is legacy.

Also found and fixed, independent of that diff:

- **getProjectFullExportData** used to return raw snake_case DB columns
  under lowercase table names (`exportData.photos[0].storage_path`).
  projectexport.js reads `exportData.Photos[0].driveFileId` (PascalCase
  keys, camelCase fields) — now fixed to match exactly, reusing each
  table's own response-shaping function so the export gets identical
  field names to every other endpoint.
- **Photo image serving** — nothing previously let the frontend actually
  *retrieve* a photo's image bytes; the old Apps Script `doGet(?id=...)`
  proxy has no backend equivalent. Added `getPhotoDataUrl` (proxies a
  Supabase Storage read server-side, using the service-role key, which
  never reaches the frontend — the bucket is private).

## backend/ (deploy separately — not part of the Electron app bundle)

- schema.sql — run once against Postgres (adds `take_off_templates` since
  the last version you have)
- api/ — run `npm install` before `npm start`; not included in this zip
