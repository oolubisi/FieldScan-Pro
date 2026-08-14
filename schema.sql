-- ============================================================================
-- FieldScan Pro — Multi-tenant Postgres schema
-- Target: Supabase Postgres
--
-- Design decisions applied (agreed with product owner):
--   1. Estimates.projectIdCreated -> renamed to project_id (nullable FK),
--      consistent with every other child table.
--   2. TaskGroups and TakeOffGroups kept as SEPARATE tables (task_groups,
--      takeoff_groups) -- confirmed as distinct domain concepts, not merged.
--   3. Sequential human-readable IDs (PRJ/26/007 etc.) replaced by a real
--      primary key (UUID) + a separate display_number computed per-company,
--      per-year inside the insert transaction. No more global mutex lock.
--   4. Every table gets company_id -- the core of multi-tenancy. No table
--      is exempt, no query is allowed to omit filtering by it.
--   5. Settings sheet -> company_settings (per-tenant, not global constants).
--   6. Soft-delete conventions preserved: archived on vendors/clients,
--      two-stage trash (trashed / trashed_at + permanent delete) on
--      projects, deleted_at/deleted_by on photos/documents.
-- ============================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ============================================================================
-- TENANCY, AUTH, LICENSING
-- ============================================================================

create table companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  license_tier      text not null default 'modules' check (license_tier in ('modules', 'full')),
  created_at        timestamptz not null default now(),
  lastmodified      timestamptz not null default now()
);

-- Which specific modules a "modules"-tier company has unlocked.
-- Ignored entirely when companies.license_tier = 'full' (full unlocks everything).
create table company_modules (
  company_id        uuid not null references companies(id) on delete cascade,
  module            text not null,
  enabled           boolean not null default true,
  primary key (company_id, module)
);

-- Per-tenant settings, replacing the global Settings sheet.
-- One row per company. The legacy Settings sheet is a truly generic
-- key-value store (any key can appear, e.g. "WO1", "WO2", ... for
-- work-order boilerplate lines) -- rather than guess at a fixed shape for
-- keys this migration can't fully see the layout of, the known/hot-path
-- keys (VAT, WHT, etc.) get real typed columns for fast direct reads
-- elsewhere in this schema (e.g. change_orders/estimates read vat_rate
-- directly), while extra_settings preserves everything else -- including
-- WO* -- exactly as arbitrary key/value pairs, so no legacy setting key
-- is lost to an incomplete guess.
create table company_settings (
  company_id                  uuid primary key references companies(id) on delete cascade,
  vat_rate                    numeric(6,4) not null default 0.075,
  wht_rate                    numeric(6,4) not null default 0.05,
  recycle_bin_retention_days  integer not null default 30,
  estimate_validity_days      integer not null default 7,
  logo                        text,        -- base64 or storage object path
  name_signed                 text,
  sign_signed                 text,        -- base64 or storage object path
  bank_name                   text,
  account_name                text,
  account_number              text,
  company_name                text not null default '',
  company_address             text not null default '',
  company_phone1              text not null default '',
  company_phone2              text not null default '',
  company_email               text not null default '',
  company_tin                 text not null default '',
  company_vat_number          text not null default '',
  company_slogan              text not null default '',
  company_registration_number text not null default '',
  logo_size_factor            numeric(3,1) not null default 1.0,
  extra_settings              jsonb not null default '{}', -- every other key (e.g. WO1, WO2, ...) verbatim
  lastmodified                timestamptz not null default now()
);

-- Real authentication: Google Sign-In verified server-side.
create table users (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  email             text not null,
  google_sub         text unique,      -- verified Google account id (sub claim)
  role              text not null default 'viewer' check (role in ('admin','manager','accountant','viewer')),
  active            boolean not null default true,
  -- Per-user signature, shown on documents THIS user personally generates
  -- (distinct from company_settings.logo, which is one-per-company).
  -- Stored as a raw data: URI, same convention as company_settings.logo/
  -- sign_signed -- small enough images that Storage upload isn't needed.
  signature_image   text,
  signature_name    text,
  password_hash     text, -- bcrypt hash; null means the account has no password set yet (can't log in until one is)
  created_at        timestamptz not null default now(),
  lastmodified      timestamptz not null default now(),
  unique (company_id, email)
);

-- Static catalogue of what each role may do, mirrors ROLE_PERMISSIONS_ in
-- Code.gs. Read at request time and intersected with the company's license
-- (see company_modules) -- both must pass, server-side, before any action runs.
create table role_permissions (
  role              text not null check (role in ('admin','manager','accountant','viewer')),
  action            text not null,   -- '*' means all actions
  primary key (role, action)
);

-- ============================================================================
-- HELPER: every business table below follows this shape convention
--   id            uuid primary key default gen_random_uuid()
--   company_id    uuid not null references companies(id)
--   display_number  (only on tables that had a sequential human ID)
--   ... domain columns ...
--   lastmodified  timestamptz not null default now()
-- A trigger (see bottom of file) auto-touches lastmodified on update.
-- ============================================================================

-- ============================================================================
-- CLIENTS / VENDORS
-- ============================================================================

create table clients (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  name              text not null,
  address           text not null default '',
  phone             text not null default '',
  email             text not null default '',
  archived          boolean not null default false,
  lastmodified      timestamptz not null default now()
);
create index on clients (company_id);

create table vendors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  company           text not null,   -- vendor's own company name (kept from legacy column name)
  trade             text not null default '',
  contact_name      text not null default '',
  phone1            text not null default '',
  phone2            text not null default '',
  email             text not null default '',
  passport          jsonb not null default '[]',
  attachments       jsonb not null default '[]',
  notes             text not null default '',
  archived          boolean not null default false,
  lastmodified      timestamptz not null default now()
);
create index on vendors (company_id);

-- ============================================================================
-- PROJECTS
-- ============================================================================

create table projects (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  display_number        text not null,   -- e.g. "PRJ/26/007", computed per company/year
  client_name           text not null,
  site_location         text not null default '',
  client_phone          text not null default '',
  client_email          text not null default '',
  project_status        text not null default 'Active',
  scope                 text not null default '',
  contract_subtotal     numeric(14,2) not null default 0,
  vat_paid              numeric(14,2) not null default 0,
  notes                 text not null default '',
  pcr_status            text not null default '',
  pcr_completion        numeric(5,2) not null default 0,
  pcr_summary           text not null default '',
  pcr_declaration       text not null default '',
  pcr_show_wht          boolean not null default false,
  pcr_completion_date   date,
  pcr_handover_date     date,
  pcr_defects_period    text not null default '',
  source_estimate_id    uuid, -- FK added below via ALTER once estimates exists
  invoice_generated     boolean not null default false,
  invoice_number        text not null default '',
  pcr_requested_amount  numeric(14,2),
  trashed               boolean not null default false,
  trashed_at            timestamptz,
  archived              boolean not null default false, -- purely cosmetic dashboard declutter flag, independent of trashed
  lastmodified          timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on projects (company_id);
create index on projects (company_id, trashed);

-- ============================================================================
-- ESTIMATES  (renamed projectIdCreated -> project_id, per agreed decision)
-- ============================================================================

create table estimates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  display_number    text,               -- estimateNumber; NULL while status = Draft (no number yet)
  client_id         uuid references clients(id),
  client_name       text not null default '',
  client_address    text not null default '',
  estimate_date     date,
  valid_until_date  date,
  header_line       text not null default '',
  line_items        jsonb not null default '[]',
  subtotal_mode     text not null default 'auto',
  discount_amount   numeric(14,2) not null default 0,
  discount_enabled  boolean not null default false,
  status            text not null default 'Draft',
  conditions        text not null default '',
  comments          text not null default '',
  project_id        uuid references projects(id) on delete cascade, -- nullable: set once createProjectFromEstimate runs; cascades on permanent project delete, matching Code.gs's explicit estimate cleanup
  lastmodified      timestamptz not null default now(),
  archived          boolean not null default false, -- purely cosmetic dashboard declutter flag, independent of status
  unique (company_id, display_number)
);
create index on estimates (company_id);
create index on estimates (company_id, project_id);

-- Resolve the forward reference from projects.source_estimate_id now that
-- estimates exists.
alter table projects
  add constraint projects_source_estimate_fk
  foreign key (source_estimate_id) references estimates(id);

-- ============================================================================
-- PROJECT CHILD TABLES
-- ============================================================================

create table progress_logs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  project_id            uuid not null references projects(id) on delete cascade,
  trade_category        text not null default '',
  completion_percentage numeric(5,2) not null default 0,
  comment_narrative     text not null default '',
  progress_photo_url    jsonb not null default '[]',
  date_recorded         date,
  lastmodified          timestamptz not null default now()
);
create index on progress_logs (company_id, project_id);

create table snags (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  notes             text not null default '',
  photo_url         text,
  assigned          text not null default '',
  date_logged       date,
  date_completed    date,
  status            text not null default 'Open',
  lastmodified      timestamptz not null default now()
);
create index on snags (company_id, project_id);

create table work_orders (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  display_number    text not null,   -- e.g. "WKO/26/003"
  project_id        uuid not null references projects(id) on delete cascade,
  vendor_id         uuid references vendors(id),
  description       text not null default '',
  amount            numeric(14,2) not null default 0,
  status            text not null default 'Open',
  attachments       jsonb not null default '[]',
  date_created      date not null default current_date,
  lastmodified      timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on work_orders (company_id, project_id);

create table payments (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  display_number        text not null,   -- referenceId equivalent, sequential
  project_id            uuid not null references projects(id) on delete cascade,
  payment_date          date,
  payment_direction     text not null default 'out', -- in/out
  payee                 text not null default '',
  vendor_id             uuid references vendors(id),
  expense_category      text not null default '',
  amount                numeric(14,2) not null default 0,
  payment_method        text not null default '',
  status                text not null default 'Pending',
  stage                 text not null default '',
  total_invoice         numeric(14,2),
  payment_group_id      uuid,  -- groups related payments (e.g. multi-stage disbursement)
  notes                 text not null default '',
  attachments           jsonb not null default '[]',
  lastmodified          timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on payments (company_id, project_id);
create index on payments (company_id, payment_group_id);

create table change_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  display_number        text not null,  -- e.g. "CO-26-01"
  project_id            uuid not null references projects(id) on delete cascade,
  date                  date,
  title                 text not null default '',
  status                text not null default 'Draft',
  line_items            jsonb not null default '[]',
  subtotal              numeric(14,2) not null default 0,
  vat                   numeric(14,2) not null default 0,
  total                 numeric(14,2) not null default 0,
  notes                 text not null default '',
  approved_by           text not null default '',
  attachments           jsonb not null default '[]',
  lastmodified          timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on change_orders (company_id, project_id);

create table inspections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  display_number        text not null,  -- inspectionNumber
  project_id            uuid references projects(id) on delete cascade, -- nullable: general inspections aren't tied to a project
  title                 text not null default '',
  location              text not null default '',
  inspector_name        text not null default '',
  inspection_date       date,
  intro                 text not null default '',
  conclusion            text not null default '',
  attachments           jsonb not null default '[]',
  attachment_comments   jsonb not null default '[]',
  lastmodified          timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on inspections (company_id, project_id);

-- ============================================================================
-- TASKS (task_groups kept SEPARATE from takeoff_groups per decision)
-- ============================================================================

create table task_groups (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  name              text not null,
  project_id        uuid not null references projects(id) on delete cascade,
  lastmodified      timestamptz not null default now()
);
create index on task_groups (company_id, project_id);

create table tasks (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  title             text not null,
  notes             text not null default '',
  project_id        uuid not null references projects(id) on delete cascade,
  status            text not null default 'Open',
  group_id          uuid references task_groups(id) on delete cascade,
  sort_order        bigint,
  lastmodified      timestamptz not null default now()
);
create index on tasks (company_id, project_id);
create index on tasks (company_id, group_id);

-- ============================================================================
-- TAKE-OFFS (separate from Change Orders, and takeoff_groups kept SEPARATE
-- from task_groups per decision)
-- ============================================================================

create table takeoff_groups (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  name              text not null,
  project_id        uuid not null references projects(id) on delete cascade,
  lastmodified      timestamptz not null default now()
);
create index on takeoff_groups (company_id, project_id);

create table takeoffs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  display_number    text not null,  -- e.g. "TO/26-01"
  group_id          uuid references takeoff_groups(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  title             text not null default '',
  line_items        jsonb not null default '[]',
  notes             text not null default '',
  date              date,
  lastmodified      timestamptz not null default now(),
  unique (company_id, display_number)
);
create index on takeoffs (company_id, project_id);
create index on takeoffs (company_id, group_id);

-- ============================================================================
-- ESTIMATING REFERENCE DATA (units, BOQ line-item catalogue)
-- ============================================================================

create table units (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  name              text not null,
  lastmodified      timestamptz not null default now(),
  unique (company_id, name)
);

create table boq_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  type              text not null default 'item' check (type in ('item','group')),
  description       text not null,
  unit              text not null default '',
  unit_price        numeric(14,2) not null default 0,
  group_items       jsonb not null default '[]', -- only populated when type = 'group'
  lastmodified      timestamptz not null default now()
);
create index on boq_items (company_id);

-- ============================================================================
-- PHOTOS / DOCUMENTS (Supabase Storage replaces Drive file references)
-- ============================================================================

create table photos (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  storage_path      text not null,   -- Supabase Storage object path (was driveFileId)
  comment           text not null default '',
  post_project      boolean not null default false,
  captured_at       timestamptz,
  file_size_bytes   bigint not null default 0,
  flagged           boolean not null default false,
  category          text not null default '',
  tags              jsonb not null default '[]',
  area              text not null default '',
  trade             text not null default '',
  activity          text not null default '',
  stage             text not null default '',
  deleted_at        timestamptz,
  deleted_by        text, -- user's email (legacy stored the string, not a user id)
  lastmodified      timestamptz not null default now()
);
create index on photos (company_id, project_id);
create index on photos (company_id, deleted_at);

create table flagged_uploads (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  reason            text not null default '',
  size_bytes        bigint not null default 0,
  created_at        timestamptz not null default now()
);
create index on flagged_uploads (company_id, project_id);

-- Generic polymorphic link: a photo attached to any other record type
-- (snag, inspection, work order, etc.) without a dedicated join table per type.
create table photo_links (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  photo_id          uuid not null references photos(id) on delete cascade,
  record_type       text not null,  -- e.g. 'snag', 'inspection', 'work_order'
  record_id         uuid not null,
  project_id        uuid references projects(id) on delete cascade, -- nullable: legacy allowed this blank
  lastmodified      timestamptz not null default now()
);
create index on photo_links (company_id, record_type, record_id);
create index on photo_links (company_id, photo_id);

create table documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  category          text not null default '',
  file_name         text not null,
  storage_path      text not null,   -- Supabase Storage object path (was driveFileId)
  file_size_bytes   bigint not null default 0,
  version           integer not null default 1,
  notes             text not null default '',
  uploaded_by       text,   -- user's email
  uploaded_at       timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        text, -- user's email
  lastmodified      timestamptz not null default now()
);
create index on documents (company_id, project_id);
create index on documents (company_id, deleted_at);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

create table audit_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  "timestamp"       timestamptz not null default now(),
  user_id           uuid references users(id),
  user_email        text not null default '',
  user_role         text not null default '',
  action            text not null,
  record_id         text, -- loose reference, not a real FK -- may be any table's id, or non-uuid legacy-shaped data
  project_id        uuid references projects(id) on delete set null, -- audit history must survive a permanent project delete, not block or cascade-delete with it
  summary           text not null default ''
);
create index on audit_log (company_id, "timestamp");
create index on audit_log (company_id, project_id);

-- ============================================================================
-- TRIGGER: auto-update lastmodified on every UPDATE
-- ============================================================================

create or replace function touch_lastmodified()
returns trigger as $$
begin
  new.lastmodified = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'companies','company_settings','users','clients','vendors','projects',
      'estimates','progress_logs','snags','work_orders','payments',
      'change_orders','inspections','task_groups','tasks','takeoff_groups',
      'takeoffs','units','boq_items','photos','photo_links','documents'
    ])
  loop
    execute format(
      'create trigger trg_touch_lastmodified before update on %I
       for each row execute function touch_lastmodified();', t
    );
  end loop;
end $$;

-- ============================================================================
-- SEED: role_permissions (mirrors ROLE_PERMISSIONS_ in Code.gs)
-- ============================================================================

insert into role_permissions (role, action) values
  ('admin', '*'),
  ('viewer', 'get'),
  ('manager', 'saveProject'), ('manager', 'updateProject'), ('manager', 'updateProjectScope'),
  ('manager', 'trashProject'), ('manager', 'restoreProject'), ('manager', 'permanentlyDeleteProject'),
  ('manager', 'getProjectFullExportData'), ('manager', 'updateProjectPcrFields'), ('manager', 'markProjectInvoiced'),
  ('manager', 'archiveProject'), ('manager', 'unarchiveProject'),
  ('accountant', 'backfillPaymentVendorIds'),
  -- Vendors/Clients module (matches ROLE_PERMISSIONS_.manager in Code.gs:
  -- manager gets save/update/archive/unarchive but NOT delete -- delete
  -- is admin-only, via the '*' row above).
  ('manager', 'get'),
  ('manager', 'saveVendor'), ('manager', 'updateVendor'),
  ('manager', 'archiveVendor'), ('manager', 'unarchiveVendor'),
  ('manager', 'saveClient'), ('manager', 'updateClient'),
  ('manager', 'archiveClient'), ('manager', 'unarchiveClient'), ('manager', 'deleteClient'),
  ('manager', 'saveUnit'), ('manager', 'deleteUnit'),
  ('manager', 'saveBOQItem'), ('manager', 'updateBOQItem'), ('manager', 'deleteBOQItem'),
  ('manager', 'saveEstimate'), ('manager', 'updateEstimate'),
  ('manager', 'deleteEstimate'), ('manager', 'createProjectFromEstimate'),
  ('manager', 'archiveEstimate'), ('manager', 'unarchiveEstimate'),
  ('manager', 'saveTask'), ('manager', 'updateTask'), ('manager', 'deleteTask'),
  ('manager', 'saveTaskGroup'), ('manager', 'updateTaskGroup'), ('manager', 'deleteTaskGroup'),
  ('manager', 'saveTakeOff'), ('manager', 'updateTakeOff'), ('manager', 'deleteTakeOff'),
  ('manager', 'saveTakeOffGroup'), ('manager', 'updateTakeOffGroup'), ('manager', 'deleteTakeOffGroup'),
  ('manager', 'saveTakeOffTemplate'), ('manager', 'deleteTakeOffTemplate'),
  ('manager', 'saveWorkOrder'), ('manager', 'updateWorkOrder'),
  ('manager', 'saveChangeOrder'), ('manager', 'updateChangeOrder'), ('manager', 'deleteChangeOrder'),
  ('manager', 'saveProgressLog'), ('manager', 'updateProgressLog'), ('manager', 'deleteProgressLog'),
  ('manager', 'saveSnag'), ('manager', 'updateSnag'), ('manager', 'deleteSnag'),
  ('manager', 'saveInspection'), ('manager', 'updateInspection'), ('manager', 'deleteInspection'),
  ('manager', 'savePhoto'), ('manager', 'updatePhotoComment'), ('manager', 'updatePhotoMeta'),
  ('manager', 'deletePhoto'), ('manager', 'restorePhoto'), ('manager', 'purgePhoto'),
  ('manager', 'savePhotoLink'), ('manager', 'deletePhotoLink'), ('manager', 'getPhotoLinks'),
  ('manager', 'saveDocument'), ('manager', 'updateDocumentMetadata'),
  ('manager', 'deleteDocument'), ('manager', 'restoreDocument'), ('manager', 'getDocuments'),
  ('accountant', 'get'),
  ('accountant', 'savePayment'), ('accountant', 'updatePayment'),
  ('accountant', 'deletePayment'), ('accountant', 'deletePaymentGroup'),
  ('manager', 'updateMySignature'), ('accountant', 'updateMySignature'), ('viewer', 'updateMySignature'),
  ('manager', 'changePassword'), ('accountant', 'changePassword'), ('viewer', 'changePassword');

-- ============================================================================
-- IDEMPOTENCY (supports offline write-queue replay -- see the client-side
-- write queue and server.js's dispatcher). A queued mutation made while
-- offline carries a client-generated mutation_id; when the client
-- reconnects and replays it, the server returns the ORIGINAL response
-- instead of running the write a second time if it already succeeded once
-- (e.g. the first attempt's response never made it back to the client
-- before the connection dropped, or the client retried before getting an
-- answer back).
-- ============================================================================

create table idempotency_keys (
  company_id     uuid not null references companies(id) on delete cascade,
  mutation_id    uuid not null,
  action         text not null,
  response       jsonb not null,
  status_code    integer not null default 200,
  created_at     timestamptz not null default now(),
  primary key (company_id, mutation_id)
);
-- Not indexed for cross-company lookup on purpose -- mutation_id is only
-- ever looked up scoped to the requesting company. A periodic cleanup job
-- (outside this schema, same as the photo/document recycle-bin purge)
-- should prune rows older than a few days -- kept indefinitely otherwise.

-- ============================================================================
-- TAKE-OFF TEMPLATES
-- ============================================================================

-- Reusable take-off templates (a saved line-item list a user can apply to
-- a new take-off). Unlike every other table in this schema, the id is
-- CLIENT-GENERATED text (e.g. "TMPL-CUST-1733500000000"), not a
-- server-issued uuid -- the frontend's local-first template system
-- (templates.js) needs a stable id it controls itself before ever
-- talking to the server, and reuses the same id on every subsequent save
-- as a true upsert key (never "insert new row, get id back").
create table take_off_templates (
  company_id     uuid not null references companies(id) on delete cascade,
  template_id    text not null,
  name           text not null default '',
  description    text not null default '',
  items          jsonb not null default '[]',
  lastmodified   timestamptz not null default now(),
  primary key (company_id, template_id)
);
