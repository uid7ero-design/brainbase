-- Data Hub 6.2D3E — governed schema ACTIVATION IMMUTABILITY governance.
-- Run once against the target database. NOT run automatically by this
-- task. NEVER run against Production or Neon Preview by this task —
-- verification is via a local disposable Postgres container only (see
-- tests/postgres-proof/datahubGovernedSchemaImmutability.postgres-proof.test.ts).
--
-- WHY THIS EXISTS (6.2D3E reconnaissance, architecture correction —
-- see the 6.2D3E discovery report): as of the D3D merge baseline
-- (b5e0b85252065edd0c66c30b2bd09ede057f74d3), zero runtime/admin writer
-- exists for source_schema_versions / source_schema_worksheets /
-- source_schema_columns / worksheet_mapping_profiles /
-- worksheet_mapping_profile_versions — "safety" was pure convention
-- (nobody has written the code to mutate an ACTIVE/RETIRED row yet).
-- Once a SourceSchemaVersion becomes ACTIVE and ImportBatches begin
-- pinning to it (6.2D3D's establishImportBatchSchemaLineage.ts),
-- historical meaning must not depend on that convention holding forever.
-- This script adds real DB-enforced protection BEFORE activation is ever
-- attempted against a real database.
--
-- ZERO RUNTIME BEHAVIOR CHANGE for any code path that does not attempt a
-- forbidden mutation. D3C's read-only matchImportBatchSchema.ts and
-- D3D's establishImportBatchSchemaLineage.ts perform ONLY SELECT/
-- findFirst/findMany against these five tables (their own read paths)
-- plus, for D3D, exactly one conditional UPDATE against the UNRELATED
-- import_batches table — none of that is touched or slowed by anything
-- below. CSV confirmation (confirmWorksheet.ts), 6.1B reconciliation,
-- and Upload.canonical_status are entirely untouched; they never
-- reference any of these five tables.
--
-- LIFECYCLE POLICY (source_schema_versions.status):
--   DRAFT -> ACTIVE   allowed (the activation transition)
--   DRAFT -> RETIRED  allowed
--   ACTIVE -> RETIRED allowed
--   ACTIVE -> DRAFT   FORBIDDEN — there is no "unactivate"; retire instead
--   RETIRED -> ACTIVE FORBIDDEN — RETIRED is terminal
--   RETIRED -> DRAFT  FORBIDDEN — RETIRED is terminal
--   RETIRED -> RETIRED (or any other RETIRED-row UPDATE) FORBIDDEN —
--     RETIRED rows accept no further UPDATE of any kind.
--   ACTIVE -> ACTIVE (or any other ACTIVE-row UPDATE) FORBIDDEN except
--     the ACTIVE -> RETIRED transition itself.
--
-- STRUCTURAL IMMUTABILITY:
--   source_schema_versions   — once ACTIVE or RETIRED: organisation_id,
--     dataset_type_id, version_number, label, created_by, created_at are
--     frozen; activated_at may never be rewritten once first set (not
--     even to the same non-NULL value via a no-op-looking UPDATE that
--     also fails to change status — the whole row is frozen except the
--     one permitted status transition's own required field changes).
--   source_schema_worksheets — INSERT/UPDATE/DELETE all rejected
--     whenever the worksheet's (old AND, for INSERT/UPDATE, new) parent
--     SourceSchemaVersion is ACTIVE or RETIRED — an activated schema can
--     never be structurally EXTENDED by adding a new worksheet, any more
--     than an existing one can be edited or removed. Rows under a DRAFT
--     version remain fully editable/insertable by a future governance
--     writer (none exists yet — D3E does not create one).
--   source_schema_columns    — same rule (INSERT/UPDATE/DELETE), via the
--     owning worksheet's parent SourceSchemaVersion.
--   worksheet_mapping_profile_versions — UNCONDITIONALLY immutable after
--     INSERT (UPDATE and DELETE both rejected always, regardless of
--     parent schema status — these rows are "explicitly versioned";
--     a configuration change creates a NEW version via INSERT, which
--     remains fully permitted — never edits an existing one). INSERT
--     itself is deliberately NOT gated by this migration: that is the
--     intended versioned-evolution mechanism and stays untouched.
--   worksheet_mapping_profiles — INSERT rejected whenever the target
--     worksheet's SourceSchemaVersion is ACTIVE or RETIRED (an activated
--     schema's profile set is frozen, not just its existing rows). Once
--     an EXISTING row's OWNING WORKSHEET's schema version is ACTIVE or
--     RETIRED: only `active`, `active_profile_version_id` and
--     `updated_at` may change (the lifecycle pointer); organisation_id,
--     source_schema_worksheet_id, name, created_by, created_at are
--     frozen. Re-parenting a DRAFT-owned profile ONTO an ACTIVE/RETIRED
--     worksheet is rejected exactly like a fresh INSERT there would be.
--     DELETE is rejected once the owning worksheet's schema is ACTIVE/
--     RETIRED (symmetric with worksheets/columns — not explicitly
--     enumerated in the 6.2D3E spec's own original test list, but
--     consistent with its own stated philosophy in Section 3: historical
--     meaning must not depend on convention). Rows under a DRAFT version
--     remain fully insertable/editable/re-parentable-to-another-DRAFT-
--     worksheet/deletable (subject to existing FKs/constraints).
--   The pre-existing composite FK
--   worksheet_mapping_profiles_active_version_fkey (D3A) remains the
--   sole authority for "does this pointer target a version of THIS
--   profile in THIS tenant" — nothing below duplicates or weakens it.
--
-- Repeatable AND fail-loud, by construction, matching this repo's
-- established migration idiom (scripts/create-datahub-source-schema-
-- profiles.sql, scripts/create-datahub-reporting-period.sql): every
-- trigger FUNCTION is `CREATE OR REPLACE FUNCTION` (natively idempotent
-- — always ends in the exact same defined state) and every TRIGGER is
-- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (also natively idempotent
-- for the same reason). Neither object type has a "diff the existing
-- definition and RAISE on drift" ensure_*() helper anywhere in this
-- repo, because neither needs one: unlike a column/constraint (which
-- could pre-exist with a WRONG definition that must be detected rather
-- than silently overwritten), CREATE OR REPLACE / DROP+CREATE always
-- converges to exactly this script's own definition, which is the
-- correct end state either way. Safe to apply to an existing database
-- with existing (DRAFT-only, per D3B) rows — nothing here performs any
-- UPDATE/DELETE/backfill on existing data; it only adds enforcement for
-- future writes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- source_schema_versions — lifecycle + structural-identity protection.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_source_schema_version_write()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'source_schema_versions: cannot DELETE an % row (id=%) — ACTIVE and RETIRED versions are permanent history', OLD.status, OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE' from here.
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'source_schema_versions: row % is RETIRED — RETIRED is terminal; no further UPDATE of any kind is permitted', OLD.id;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' THEN
    -- Free editing while remaining DRAFT — reserved for a future
    -- approved governance writer; D3E itself introduces none. The
    -- pre-existing source_schema_versions_activation_check CHECK
    -- constraint (D3A) already forbids DRAFT with a non-NULL
    -- activated_at, so this branch cannot smuggle in an early
    -- activation timestamp.
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
    IF NEW.activated_at IS NULL THEN
      RAISE EXCEPTION 'source_schema_versions: DRAFT -> ACTIVE requires a non-NULL activated_at (row %)', OLD.id;
    END IF;
  ELSIF OLD.status = 'DRAFT' AND NEW.status = 'RETIRED' THEN
    NULL; -- DRAFT -> RETIRED allowed; activated_at may remain NULL or be set, either is a valid activation_check combination.
  ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED' THEN
    IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
      RAISE EXCEPTION 'source_schema_versions: activated_at must not be rewritten during ACTIVE -> RETIRED (row %)', OLD.id;
    END IF;
  ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'source_schema_versions: row % is ACTIVE — ACTIVE rows are immutable except the one-time transition to RETIRED', OLD.id;
  ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'source_schema_versions: ACTIVE -> DRAFT is forbidden (row %) — there is no "unactivate"; retire instead', OLD.id;
  ELSE
    RAISE EXCEPTION 'source_schema_versions: unrecognized status transition % -> % (row %)', OLD.status, NEW.status, OLD.id;
  END IF;

  -- Every permitted transition above still requires the row's own
  -- historical identity to be preserved verbatim.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.dataset_type_id IS DISTINCT FROM OLD.dataset_type_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'source_schema_versions: % -> % may not change identity fields (id/organisation_id/dataset_type_id/version_number/label/created_by/created_at) (row %)', OLD.status, NEW.status, OLD.id;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_source_schema_version_write ON public.source_schema_versions;
CREATE TRIGGER datahub_guard_source_schema_version_write
  BEFORE UPDATE OR DELETE ON public.source_schema_versions
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_source_schema_version_write();

-- ═══════════════════════════════════════════════════════════════════
-- source_schema_worksheets — immutable once the PARENT schema version
-- is ACTIVE or RETIRED. Checks both OLD's and (for INSERT/UPDATE) NEW's
-- parent, so a worksheet can neither be re-parented INTO an ACTIVE/
-- RETIRED version to smuggle a change past the OLD-side check, nor
-- freshly INSERTed under one to structurally extend an activated schema.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_source_schema_worksheet_write()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_old_status text;
  v_new_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_new_status FROM public.source_schema_versions WHERE id = NEW.source_schema_version_id;
    IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'source_schema_worksheets: cannot INSERT a new worksheet under a % SourceSchemaVersion (%) — an activated schema is structurally frozen', v_new_status, NEW.source_schema_version_id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO v_old_status FROM public.source_schema_versions WHERE id = OLD.source_schema_version_id;
  IF v_old_status IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'source_schema_worksheets: row % belongs to a % SourceSchemaVersion (%) — worksheets under an activated schema are immutable', OLD.id, v_old_status, OLD.source_schema_version_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_new_status FROM public.source_schema_versions WHERE id = NEW.source_schema_version_id;
    IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'source_schema_worksheets: row % cannot be re-parented onto a % SourceSchemaVersion (%)', OLD.id, v_new_status, NEW.source_schema_version_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_source_schema_worksheet_write ON public.source_schema_worksheets;
CREATE TRIGGER datahub_guard_source_schema_worksheet_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.source_schema_worksheets
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_source_schema_worksheet_write();

-- ═══════════════════════════════════════════════════════════════════
-- source_schema_columns — same rule (INSERT/UPDATE/DELETE), via the
-- owning worksheet's parent SourceSchemaVersion.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_source_schema_column_write()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_old_status text;
  v_new_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT ssv.status INTO v_new_status
      FROM public.source_schema_worksheets ssw
      JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
      WHERE ssw.id = NEW.source_schema_worksheet_id;
    IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'source_schema_columns: cannot INSERT a new column under worksheet % whose SourceSchemaVersion is % — an activated schema is structurally frozen', NEW.source_schema_worksheet_id, v_new_status;
    END IF;
    RETURN NEW;
  END IF;

  SELECT ssv.status INTO v_old_status
    FROM public.source_schema_worksheets ssw
    JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
    WHERE ssw.id = OLD.source_schema_worksheet_id;
  IF v_old_status IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'source_schema_columns: row % belongs to a worksheet (%) under a % SourceSchemaVersion — columns under an activated schema are immutable', OLD.id, OLD.source_schema_worksheet_id, v_old_status;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT ssv.status INTO v_new_status
      FROM public.source_schema_worksheets ssw
      JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
      WHERE ssw.id = NEW.source_schema_worksheet_id;
    IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'source_schema_columns: row % cannot be re-parented onto a worksheet (%) under a % SourceSchemaVersion', OLD.id, NEW.source_schema_worksheet_id, v_new_status;
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_source_schema_column_write ON public.source_schema_columns;
CREATE TRIGGER datahub_guard_source_schema_column_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.source_schema_columns
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_source_schema_column_write();

-- ═══════════════════════════════════════════════════════════════════
-- worksheet_mapping_profile_versions — UNCONDITIONALLY immutable after
-- INSERT. No DRAFT exception (unlike worksheets/columns): a profile
-- version is "explicitly versioned" — any configuration change creates
-- a NEW version, it never edits an existing one, regardless of the
-- parent schema's status.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_worksheet_mapping_profile_version_write()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'worksheet_mapping_profile_versions: row % is immutable — DELETE is never permitted; create a new version instead', OLD.id;
  END IF;
  RAISE EXCEPTION 'worksheet_mapping_profile_versions: row % is immutable — UPDATE is never permitted; create a new version instead', OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_worksheet_mapping_profile_version_write ON public.worksheet_mapping_profile_versions;
CREATE TRIGGER datahub_guard_worksheet_mapping_profile_version_write
  BEFORE UPDATE OR DELETE ON public.worksheet_mapping_profile_versions
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_worksheet_mapping_profile_version_write();

-- ═══════════════════════════════════════════════════════════════════
-- worksheet_mapping_profiles — lifecycle-pointer-only mutation once the
-- OWNING WORKSHEET's SourceSchemaVersion is ACTIVE or RETIRED. DELETE is
-- rejected under the same condition (symmetric hardening; not explicitly
-- enumerated by name in every upstream spec test list, but required by
-- the same "historical meaning must not depend on convention" principle
-- this whole migration exists to satisfy). Rows under a DRAFT version
-- remain fully editable, including DELETE.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.datahub_guard_worksheet_mapping_profile_write()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_old_status text;
  v_new_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT ssv.status INTO v_new_status
      FROM public.source_schema_worksheets ssw
      JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
      WHERE ssw.id = NEW.source_schema_worksheet_id;
    IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'worksheet_mapping_profiles: cannot INSERT a new profile under worksheet % whose SourceSchemaVersion is % — an activated schema''s profile set is structurally frozen', NEW.source_schema_worksheet_id, v_new_status;
    END IF;
    RETURN NEW;
  END IF;

  SELECT ssv.status INTO v_old_status
    FROM public.source_schema_worksheets ssw
    JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
    WHERE ssw.id = OLD.source_schema_worksheet_id;

  IF TG_OP = 'DELETE' THEN
    IF v_old_status IN ('ACTIVE', 'RETIRED') THEN
      RAISE EXCEPTION 'worksheet_mapping_profiles: row % belongs to a worksheet under a % SourceSchemaVersion — DELETE is not permitted once activated', OLD.id, v_old_status;
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE' from here.
  IF v_old_status IN ('ACTIVE', 'RETIRED') THEN
    -- Existing lifecycle-pointer-only mutation rule: identity frozen,
    -- only active/active_profile_version_id/updated_at may change. This
    -- also structurally forbids re-parenting OUT of this worksheet
    -- (source_schema_worksheet_id is one of the frozen identity fields),
    -- so an already-activated profile can never be moved elsewhere.
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.source_schema_worksheet_id IS DISTINCT FROM OLD.source_schema_worksheet_id
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'worksheet_mapping_profiles: row % belongs to a worksheet under a % SourceSchemaVersion — only active/active_profile_version_id/updated_at may change once activated', OLD.id, v_old_status;
    END IF;
    RETURN NEW;
  END IF;

  -- OLD parent is DRAFT: reject re-parenting ONTO an ACTIVE/RETIRED
  -- worksheet (that would structurally extend an activated schema's
  -- profile set exactly like a fresh INSERT there would) — otherwise
  -- fully editable/re-parentable-to-another-DRAFT-worksheet, subject to
  -- the existing FKs/constraints.
  SELECT ssv.status INTO v_new_status
    FROM public.source_schema_worksheets ssw
    JOIN public.source_schema_versions ssv ON ssv.id = ssw.source_schema_version_id
    WHERE ssw.id = NEW.source_schema_worksheet_id;
  IF v_new_status IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'worksheet_mapping_profiles: row % cannot be re-parented from a DRAFT worksheet onto worksheet % whose SourceSchemaVersion is % — an activated schema''s profile set is structurally frozen', OLD.id, NEW.source_schema_worksheet_id, v_new_status;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS datahub_guard_worksheet_mapping_profile_write ON public.worksheet_mapping_profiles;
CREATE TRIGGER datahub_guard_worksheet_mapping_profile_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.worksheet_mapping_profiles
  FOR EACH ROW EXECUTE FUNCTION public.datahub_guard_worksheet_mapping_profile_write();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- Reference only — NOT executed by this script. Manual rollback
-- (destructive to the GOVERNANCE GUARANTEE, never to data), only if
-- ever separately authorized:
--   DROP TRIGGER IF EXISTS datahub_guard_source_schema_version_write ON public.source_schema_versions;
--   DROP TRIGGER IF EXISTS datahub_guard_source_schema_worksheet_write ON public.source_schema_worksheets;
--   DROP TRIGGER IF EXISTS datahub_guard_source_schema_column_write ON public.source_schema_columns;
--   DROP TRIGGER IF EXISTS datahub_guard_worksheet_mapping_profile_version_write ON public.worksheet_mapping_profile_versions;
--   DROP TRIGGER IF EXISTS datahub_guard_worksheet_mapping_profile_write ON public.worksheet_mapping_profiles;
--   DROP FUNCTION IF EXISTS public.datahub_guard_source_schema_version_write();
--   DROP FUNCTION IF EXISTS public.datahub_guard_source_schema_worksheet_write();
--   DROP FUNCTION IF EXISTS public.datahub_guard_source_schema_column_write();
--   DROP FUNCTION IF EXISTS public.datahub_guard_worksheet_mapping_profile_version_write();
--   DROP FUNCTION IF EXISTS public.datahub_guard_worksheet_mapping_profile_write();
-- ═══════════════════════════════════════════════════════════════════
