import { pool } from "../db/pool.js";
import { nextDisplayNumber } from "../db/sequence.js";
import { assertNotStale, sendConflict } from "../db/concurrency.js";
import { toApiShape as snagShape } from "./snags.js";
import { toApiShape as paymentShape } from "./payments.js";
import { toApiShape as inspectionShape } from "./inspections.js";
import { toApiShape as changeOrderShape } from "./changeOrders.js";
import { toApiShape as workOrderShape } from "./workOrders.js";
import { toApiShape as progressLogShape } from "./progressLogs.js";
import { toApiShape as taskShape } from "./tasks.js";
import { toApiShape as takeOffGroupShape } from "./takeOffGroups.js";
import { toApiShape as taskGroupShape } from "./taskGroups.js";
import { toApiShape as documentShape } from "./documents.js";
import { toApiShape as photoShape } from "./photos.js";
import { toApiShape as photoLinkShape } from "./photoLinks.js";
import { toApiShape as estimateShape } from "./estimates.js";
import { toApiShape as takeOffShape } from "./takeOffs.js";

/**
 * Maps a projects row (snake_case, Postgres) back to the exact camelCase
 * shape api.js/index.html already expect from Code.gs's getTableData("Projects").
 *
 * Field-mapping note: the legacy sheet used one string, "projectId", both as
 * the human-readable number (e.g. "PRJ/26/007") AND as the join key every
 * other table used to link back to a project. Postgres now has two separate
 * things -- a real uuid primary key and a display_number -- so we return
 * BOTH: "projectId" carries the real uuid (kept under the old field name so
 * the frontend's existing read/write paths for linking child records don't
 * need to change), and "displayNumber" is a new, additive field carrying the
 * human-readable number for anywhere the UI shows it to a person.
 */
function toApiShape(row) {
  return {
    projectId: row.id,
    displayNumber: row.display_number,
    clientName: row.client_name,
    siteLocation: row.site_location,
    clientPhone: row.client_phone,
    clientEmail: row.client_email,
    projectStatus: row.project_status,
    scope: row.scope,
    contractSubtotal: Number(row.contract_subtotal),
    vatPaid: Number(row.vat_paid),
    notes: row.notes,
    lastModified: row.lastmodified,
    pcrStatus: row.pcr_status,
    pcrCompletion: row.pcr_completion,
    pcrSummary: row.pcr_summary,
    pcrDeclaration: row.pcr_declaration,
    pcrShowWht: row.pcr_show_wht,
    pcrCompletionDate: row.pcr_completion_date,
    pcrHandoverDate: row.pcr_handover_date,
    pcrDefectsPeriod: row.pcr_defects_period,
    sourceEstimateId: row.source_estimate_id,
    invoiceGenerated: row.invoice_generated,
    invoiceNumber: row.invoice_number,
    pcrRequestedAmount: row.pcr_requested_amount != null ? Number(row.pcr_requested_amount) : null,
    trashed: row.trashed ? "Yes" : "No", // legacy sheet stored this as a "Yes"/"No" string
    trashedAt: row.trashed_at,
  };
}

// GET equivalent of action === "getProjects": non-trashed projects for the
// caller's own company only -- company_id filtering is not optional.
export async function getProjects(req, res) {
  try {
    const { rows } = await pool.query(
      `select * from projects where company_id = $1 and trashed = false order by lastmodified desc`,
      [req.user.companyId]
    );
    res.json(rows.map(toApiShape));
  } catch (err) {
    console.error("getProjects failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to load projects" });
  }
}

// Mirrors action === "getTrashedProjects".
export async function getTrashedProjects(req, res) {
  try {
    const { rows } = await pool.query(
      `select * from projects where company_id = $1 and trashed = true order by trashed_at desc`,
      [req.user.companyId]
    );
    res.json(rows.map(toApiShape));
  } catch (err) {
    console.error("getTrashedProjects failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to load trashed projects" });
  }
}

// Rudimentary NG phone validation, matching validatePhone() in Code.gs
// (11-digit local format). Throws (caller returns 400) rather than
// silently accepting a malformed number.
function validatePhone(p) {
  if (!p) return "";
  const clean = String(p).replace(/\D/g, "");
  if (clean.length !== 11) throw new Error("Phone must be 11 digits");
  return clean;
}

// action === "saveProject". Numbered "PRJ/<yy>/<NNN>", company-wide
// per-year sequence, same pattern as WorkOrders.
export async function saveProject(req, res) {
  const client = await pool.connect();
  try {
    const d = req.actionData;
    let clientPhone;
    try {
      clientPhone = validatePhone(d.clientPhone);
    } catch (e) {
      return res.status(400).json({ status: "error", success: false, message: e.message });
    }

    await client.query("begin");
    const displayNumber = await nextDisplayNumber(client, {
      table: "projects",
      companyId: req.user.companyId,
      prefix: `PRJ/${new Date().getFullYear().toString().slice(-2)}/`,
      pad: 3,
    });
    const { rows } = await client.query(
      `insert into projects
         (company_id, display_number, client_name, site_location, client_phone, client_email,
          project_status, scope, contract_subtotal, vat_paid, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id`,
      [
        req.user.companyId, displayNumber, d.clientName || "", d.siteLocation || "", clientPhone, d.clientEmail || "",
        d.projectStatus || "Active", d.scope || "", Number(d.contractSubtotal) || 0, Number(d.vatPaid) || 0, d.notes || "",
      ]
    );
    await client.query("commit");
    res.json({ success: true, projectId: rows[0].id });
  } catch (err) {
    await client.query("rollback");
    console.error("saveProject failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to save project" });
  } finally {
    client.release();
  }
}

// action === "updateProject". contractSubtotal/vatPaid are only touched
// when the caller explicitly sends a value -- an edit to, say, notes
// shouldn't silently zero out the running contract total, same guard as
// Code.gs (which used "" as its "leave alone" sentinel).
export async function updateProject(req, res) {
  try {
    const d = req.actionData;
    let clientPhone;
    try {
      clientPhone = validatePhone(d.clientPhone);
    } catch (e) {
      return res.status(400).json({ status: "error", success: false, message: e.message });
    }
    await assertNotStale(pool, "projects", d.projectId, req.user.companyId, d.lastModified);

    const touchSubtotal = d.contractSubtotal !== undefined && d.contractSubtotal !== null;
    const touchVat = d.vatPaid !== undefined && d.vatPaid !== null;

    const { rows: existingRows } = await pool.query(
      `select contract_subtotal, vat_paid from projects where id = $1 and company_id = $2`,
      [d.projectId, req.user.companyId]
    );
    if (!existingRows.length) return res.status(404).json({ status: "error", success: false, message: "Project not found" });

    const { rowCount } = await pool.query(
      `update projects set client_name=$1, site_location=$2, client_phone=$3, client_email=$4,
              project_status=$5, scope=$6, contract_subtotal=$7, vat_paid=$8, notes=$9
        where id = $10 and company_id = $11`,
      [
        d.clientName || "", d.siteLocation || "", clientPhone, d.clientEmail || "", d.projectStatus || "",
        d.scope || "",
        touchSubtotal ? Number(d.contractSubtotal) || 0 : existingRows[0].contract_subtotal,
        touchVat ? Number(d.vatPaid) || 0 : existingRows[0].vat_paid,
        d.notes || "", d.projectId, req.user.companyId,
      ]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    if (err.isConflict) return sendConflict(res, err);
    console.error("updateProject failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to update project" });
  }
}

// action === "updateProjectScope"
export async function updateProjectScope(req, res) {
  try {
    const d = req.actionData;
    const { rowCount } = await pool.query(
      `update projects set scope = $1 where id = $2 and company_id = $3`,
      [d.scope || "", d.projectId, req.user.companyId]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("updateProjectScope failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to update project scope" });
  }
}

// action === "trashProject" -- reversible (see restoreProject).
export async function trashProject(req, res) {
  try {
    const { rowCount } = await pool.query(
      `update projects set trashed = true, trashed_at = now() where id = $1 and company_id = $2`,
      [req.actionData.projectId, req.user.companyId]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("trashProject failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to trash project" });
  }
}

// action === "restoreProject"
export async function restoreProject(req, res) {
  try {
    const { rowCount } = await pool.query(
      `update projects set trashed = false, trashed_at = null where id = $1 and company_id = $2`,
      [req.actionData.projectId, req.user.companyId]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("restoreProject failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to restore project" });
  }
}

// Every table whose rows disappear when a project is permanently deleted,
// AND (via exportKey/shape) what a project export packages up. In Code.gs
// this required manually iterating and deleting from each of these sheets
// one by one (PROJECT_LINKED_SHEETS); in Postgres every one of these
// already has `project_id ... on delete cascade`, so a single
// `DELETE FROM projects` does the same cascade atomically -- this list is
// only used here to (a) report deletedCounts back to the caller and
// (b) build a project export, not to actually perform the deletion.
//
// exportKey uses the legacy PascalCase sheet names (Snags, Payments, ...)
// -- projectexport.js reads exportData.Photos, exportData.Documents, etc.
// by these exact names, and each row goes through that table's own
// toApiShape() so the export gets the same camelCase fields
// (photoId, storagePath, ...) every other endpoint already returns,
// not raw snake_case DB columns.
const PROJECT_LINKED_TABLES = [
  { table: "snags", exportKey: "Snags", shape: snagShape },
  { table: "payments", exportKey: "Payments", shape: paymentShape },
  { table: "inspections", exportKey: "Inspections", shape: inspectionShape },
  { table: "change_orders", exportKey: "ChangeOrders", shape: changeOrderShape },
  { table: "work_orders", exportKey: "WorkOrders", shape: workOrderShape },
  { table: "progress_logs", exportKey: "ProgressLogs", shape: progressLogShape },
  { table: "tasks", exportKey: "Tasks", shape: taskShape },
  { table: "takeoff_groups", exportKey: "TakeOffGroups", shape: takeOffGroupShape },
  { table: "task_groups", exportKey: "TaskGroups", shape: taskGroupShape },
  { table: "documents", exportKey: "Documents", shape: documentShape },
  { table: "photos", exportKey: "Photos", shape: photoShape },
  { table: "flagged_uploads", exportKey: "FlaggedUploads", shape: (r) => r },
  { table: "photo_links", exportKey: "PhotoLinks", shape: photoLinkShape },
  { table: "estimates", exportKey: "Estimates", shape: estimateShape },
  { table: "takeoffs", exportKey: "TakeOffs", shape: takeOffShape },
];

// action === "getProjectFullExportData"
export async function getProjectFullExportData(req, res) {
  try {
    const { projectId } = req.actionData;
    const { rows: projRows } = await pool.query(
      `select * from projects where id = $1 and company_id = $2`,
      [projectId, req.user.companyId]
    );
    if (!projRows.length) return res.json({ success: false, error: "Project not found" });

    const exportData = { Project: toApiShape(projRows[0]) };
    for (const { table, exportKey, shape } of PROJECT_LINKED_TABLES) {
      const { rows } = await pool.query(`select * from ${table} where project_id = $1 and company_id = $2`, [projectId, req.user.companyId]);
      exportData[exportKey] = rows.map(shape);
    }
    res.json({ success: true, data: exportData });
  } catch (err) {
    console.error("getProjectFullExportData failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to export project data" });
  }
}

// action === "permanentlyDeleteProject" -- the ONLY point in the app
// where a project's data actually stops existing; trash/restore up to
// here has been reversible. Row counts per table are gathered BEFORE the
// delete (the cascade doesn't report counts on its own), all inside one
// transaction with the project row locked for the duration.
export async function permanentlyDeleteProject(req, res) {
  const client = await pool.connect();
  try {
    const { projectId } = req.actionData;
    await client.query("begin");

    const { rows: projRows } = await client.query(
      `select id from projects where id = $1 and company_id = $2 for update`,
      [projectId, req.user.companyId]
    );
    if (!projRows.length) {
      await client.query("rollback");
      return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    }

    const deletedCounts = {};
    for (const { table } of PROJECT_LINKED_TABLES) {
      const { rows } = await client.query(`select count(*) from ${table} where project_id = $1 and company_id = $2`, [projectId, req.user.companyId]);
      deletedCounts[table] = Number(rows[0].count);
    }

    await client.query(`delete from projects where id = $1 and company_id = $2`, [projectId, req.user.companyId]);
    await client.query("commit");
    res.json({ success: true, deletedCounts });
  } catch (err) {
    await client.query("rollback");
    console.error("permanentlyDeleteProject failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to permanently delete project" });
  } finally {
    client.release();
  }
}

// action === "updateProjectContractSubtotal" -- a direct override, used
// separately from the ChangeOrder-driven delta adjustments elsewhere.
export async function updateProjectContractSubtotal(req, res) {
  try {
    const { rowCount } = await pool.query(
      `update projects set contract_subtotal = $1 where id = $2 and company_id = $3`,
      [Number(req.actionData.contractSubtotal) || 0, req.actionData.projectId, req.user.companyId]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("updateProjectContractSubtotal failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to update contract subtotal" });
  }
}

// action === "markProjectInvoiced"
export async function markProjectInvoiced(req, res) {
  try {
    const { rowCount } = await pool.query(
      `update projects set invoice_generated = true, invoice_number = $1 where id = $2 and company_id = $3`,
      [req.actionData.invoiceNumber || "", req.actionData.projectId, req.user.companyId]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("markProjectInvoiced failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to mark project invoiced" });
  }
}

// action === "updateProjectPcrFields". The Sheets-specific number-format
// fixup in Code.gs (forcing a "0.##" display format on the pcrCompletion
// cell) has no equivalent need here -- pcr_completion is a real
// numeric(5,2) column, not a text cell that needs a display hint.
export async function updateProjectPcrFields(req, res) {
  try {
    const d = req.actionData;
    const pcrCompletionNum = Number(String(d.pcrCompletion || "0").replace("%", "")) || 0;
    const { rowCount } = await pool.query(
      `update projects set pcr_status=$1, pcr_completion=$2, pcr_summary=$3, pcr_declaration=$4,
              pcr_show_wht=$5, pcr_completion_date=$6, pcr_handover_date=$7, pcr_defects_period=$8,
              pcr_requested_amount=$9
        where id = $10 and company_id = $11`,
      [
        d.pcrStatus || "", pcrCompletionNum, d.pcrSummary || "", d.pcrDeclaration || "",
        String(d.pcrShowWht) === "true", d.pcrCompletionDate || null, d.pcrHandoverDate || null,
        d.pcrDefectsPeriod || "", Number(d.pcrRequestedAmount) || 0,
        d.projectId, req.user.companyId,
      ]
    );
    if (!rowCount) return res.status(404).json({ status: "error", success: false, message: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("updateProjectPcrFields failed", err);
    res.status(500).json({ status: "error", success: false, message: "Failed to update PCR fields" });
  }
}
