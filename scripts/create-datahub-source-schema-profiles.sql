-- Data Hub 6.2D3A — Source-schema + worksheet mapping profile FOUNDATION.
-- Run once against the target database. NOT run automatically by this
-- task. NEVER run against Production or Neon Preview by this task —
-- verification is via a local disposable Postgres container only (see
-- scripts/tests/verify-datahub-source-schema-profiles.sh).
--
-- ZERO RUNTIME BEHAVIOR CHANGE. This script creates additive persistence
-- storage only — no application code path reads or writes any of the
-- structures below in this slice. XLSX mapping selection
-- (selectWorksheetMapping.ts), XLSX confirmation (confirmWorksheet.ts)
-- and canonical XLSX import all REMAIN DISABLED by their own unchanged
-- CSV-only format gates. No service, route, admin UI or validator
-- consumes these tables yet.
--
-- Repeatable AND fail-loud, by construction — identical methodology to
-- scripts/create-datahub-source-mappings.sql (5B.1): every column/CHECK/
-- unique constraint/foreign key/index below is handled by a single
-- pg_temp.ensure_*() call that either creates the exact expected object
-- (if genuinely absent) or validates the exact expected definition (if
-- already present, RAISing if it differs). The six pg_temp.ensure_*()
-- helpers are copied verbatim from that script. One NEW helper,
-- pg_temp.ensure_index, is added (same ensure/validate/RAISE shape):
-- prior Data Hub scripts created plain indexes with CREATE INDEX IF NOT
-- EXISTS, which silently accepts a same-named index with a different
-- definition — this script instead compares pg_get_indexdef() exactly.
--
-- Creates:
--   public.dataset_types — a tenant-owned, named kind of dataset
--     delivered by one SourceSystem (e.g. "monthly service-request
--     export"). The stable anchor that schema versions hang off.
--   public.source_schema_versions — one versioned description of what a
--     dataset's file LOOKS like (its worksheets and columns). Status is
--     plain TEXT with a CHECK allowlist (DRAFT/ACTIVE/RETIRED), not a PG
--     enum — mirrors uploads.lineage_kind / source_record_identities.
--     domain_kind precedent: a lifecycle vocabulary that may grow must
--     never need an ALTER TYPE migration.
--   public.source_schema_worksheets — one expected worksheet within one
--     schema version.
--   public.source_schema_columns — one expected column within one
--     expected worksheet.
--   public.worksheet_mapping_profiles — a logical per-worksheet treatment
--     profile, pointing at its one active immutable version.
--   public.worksheet_mapping_profile_versions — immutable, versioned,
--     declarative per-worksheet treatment metadata (disposition +
--     JSONB profile_document).
-- Adds (additive, nullable, zero backfill):
--   public.import_batches.dataset_type_id          -> dataset_types
--   public.import_batches.source_schema_version_id -> source_schema_versions
--
-- ARCHITECTURE — why a SEPARATE profile/version pair, not a reuse of
-- source_mappings/mapping_versions, and not folded into
-- source_schema_versions:
--   * mapping_versions.mapping_document is explicitly the Illegal
--     Dumping canonical-field MappingDocument (lib/data-hub/
--     sourceMapping/**) consumed by the live CSV confirm path. It is NOT
--     repurposed, widened or re-pointed here — that table, its
--     constraints and its consumers are untouched.
--   * A source schema version describes the SOURCE's shape (what the
--     council's export contains). A mapping profile version describes
--     OUR treatment of one worksheet of that shape (stage it, keep as
--     metadata, use as a reconciliation summary, or ignore it). The two
--     change independently: correcting a treatment must not fabricate a
--     new source schema version, and a new source schema version does
--     not by itself say how its sheets should be treated. So profile
--     versions are versioned independently of schema versions.
--   * A profile is bound to ONE source_schema_worksheets row (i.e. one
--     worksheet of one schema version), never to a free-floating sheet
--     name — a profile always refers to a sheet that exists in the
--     schema it claims to treat. Carrying a treatment forward to a later
--     schema version is a later (service-layer) copy, not a shared row.
--
-- IMMUTABILITY IS A PROCESS CONVENTION ONLY (same as MappingVersion):
-- there is no DB trigger in D3A. The schema does NOT stop a writer from
-- adding worksheets/columns to an ACTIVE schema version, editing a
-- profile version's document, or re-parenting a schema version /
-- dataset type that no import_batches row references yet. What IS
-- structural: no row can cross tenants, and once an import_batches row
-- references a dataset type / schema version, NO ACTION blocks any
-- re-key or delete that would break that batch's lineage. Any later
-- writer must enforce "ACTIVE/RETIRED versions and profile versions are
-- never modified" itself, or a later slice must add a trigger before
-- such a writer exists.
--
-- profile_document is DECLARATIVE CONFIGURATION ONLY: never executable
-- code, raw rows, sample values, credentials, secrets, or any flag that
-- enables canonical import. The only database-level guard is that it is
-- a JSON object. D3A adds NO runtime validator and NO consumer — any
-- later phase that writes or reads it MUST validate it first.
--
-- ORDERING (the profile <-> version active-pointer cycle is resolved by
-- ordering, exactly like 5B.1's SourceMapping <-> MappingVersion cycle):
--   1. dataset_types (depends on organisations/users/source_systems).
--   2. source_schema_versions (depends on dataset_types).
--   3. source_schema_worksheets (depends on source_schema_versions).
--   4. source_schema_columns (depends on source_schema_worksheets).
--   5. worksheet_mapping_profiles WITHOUT its active-version FK (the
--      nullable column itself is created now).
--   6. worksheet_mapping_profile_versions (FK to profiles now safe).
--   7. ONLY NOW the profiles' active-version composite FK
--      (active_profile_version_id, id, organisation_id) ->
--      worksheet_mapping_profile_versions(id, worksheet_mapping_profile_id,
--      organisation_id): structurally unable to point at another
--      profile's version or another tenant's version.
--   8. Finally the two nullable lineage columns on import_batches, their
--      composite FKs and their implication CHECKs.
--
-- IMPORTBATCH LINEAGE COHERENCE (step 8). Composite FKs are MATCH SIMPLE
-- (Postgres default, required by ensure_fk), which SKIPS the whole FK
-- check if ANY referencing column is NULL. The composite FKs alone would
-- therefore let a batch carry dataset_type_id with a NULL
-- source_system_id (FK skipped), or source_schema_version_id with a
-- NULL dataset_type_id (FK skipped). Two implication CHECKs close
-- exactly those holes:
--   source_schema_version_id IS NOT NULL => dataset_type_id IS NOT NULL
--   dataset_type_id          IS NOT NULL => source_system_id IS NOT NULL
-- With those in place, whenever a lineage column is non-NULL every column
-- of its composite FK is non-NULL (organisation_id is NOT NULL already),
-- so the FK is always enforced:
--   (dataset_type_id, source_system_id, organisation_id)
--     -> dataset_types(id, source_system_id, organisation_id)
--   (source_schema_version_id, dataset_type_id, organisation_id)
--     -> source_schema_versions(id, dataset_type_id, organisation_id)
-- i.e. the dataset type belongs to the batch's OWN source system and
-- tenant, and the schema version belongs to the batch's OWN dataset type
-- and tenant. No cross-source/cross-dataset/cross-tenant lineage is
-- representable.
--
-- ON DELETE policy (mirrors 5B.1 exactly):
--   organisation_id FKs, every parent/child FK, the active-version
--   pointer and both import_batches lineage FKs: NO ACTION — there is no
--   hard-delete API for any of these rows (deactivate/retire-not-delete)
--   and no cascade may ever silently erase historical lineage.
--   created_by (actor) FKs: SET NULL — actor attribution is best-effort,
--   never a reason to block or cascade a user's deletion.
--
-- Column/id convention: TEXT ids with NO database-side default (Prisma
-- Client supplies cuid() application-side). Every DDL target and catalog
-- lookup is schema-qualified as public.<table>; never relies on
-- search_path.
--
-- ZERO UPDATE. ZERO DELETE. ZERO backfill/inference of any kind — no
-- statement in this file touches a single existing row's data. Every
-- statement below is CREATE TABLE / ALTER TABLE ADD COLUMN / ADD
-- CONSTRAINT / CREATE INDEX (wrapped in the idempotent ensure_*()
-- helpers) only. Every pre-existing import_batches row keeps
-- dataset_type_id = NULL and source_schema_version_id = NULL, which
-- satisfies both new CHECKs and both new FKs trivially.
--
-- Repeatable behavioral validation:
-- scripts/tests/verify-datahub-source-schema-profiles.sh runs this script
-- (and reruns it, proving idempotency) against a disposable,
-- self-cleaning Docker postgres:16-alpine container on top of the real
-- create-import-batches.sql + create-datahub-source-mappings.sql, then
-- exercises real Postgres constraint enforcement. No Neon/Production
-- access, no local psql client required beyond Docker.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helpers (pg_temp schema). The first
-- six are copied verbatim from scripts/create-datahub-source-mappings.sql
-- (which itself copied them from scripts/create-import-batches.sql); not
-- re-derived here to keep this script standalone/self-contained.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.ensure_column(
  p_table text, p_column text, p_expected_type text, p_expected_nullable boolean,
  p_check_default boolean,
  p_expected_default text,
  p_add_column_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_default text;
BEGIN
  SELECT data_type, is_nullable INTO r
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF NOT FOUND THEN
    EXECUTE p_add_column_sql;
    RETURN;
  END IF;

  IF r.data_type IS DISTINCT FROM p_expected_type THEN
    RAISE EXCEPTION 'Migration drift: public.%.% has type % but % was expected',
      p_table, p_column, r.data_type, p_expected_type;
  END IF;

  IF (r.is_nullable = 'YES') IS DISTINCT FROM p_expected_nullable THEN
    RAISE EXCEPTION 'Migration drift: public.%.% nullability is % but % was expected',
      p_table, p_column, r.is_nullable, (CASE WHEN p_expected_nullable THEN 'YES' ELSE 'NO' END);
  END IF;

  IF p_check_default THEN
    SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO actual_default
      FROM pg_attrdef ad
      JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
      JOIN pg_class t ON t.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = p_table AND a.attname = p_column;

    IF actual_default IS DISTINCT FROM p_expected_default THEN
      RAISE EXCEPTION 'Migration drift: public.%.% default is % but % was expected',
        p_table, p_column, COALESCE(actual_default, 'NULL (no default)'), COALESCE(p_expected_default, 'NULL (no default)');
    END IF;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_check(
  p_table text, p_conname text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO actual_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'c';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% CHECK constraint is "%" but "%" was expected',
      p_table, p_conname, actual_def, p_expected_def;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_unique_constraint(
  p_table text, p_conname text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO actual_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'u';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: public.%.% UNIQUE constraint is "%" but "%" was expected',
      p_table, p_conname, actual_def, p_expected_def;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_primary_key(
  p_table text, p_expected_cols text[], p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_cols text[];
BEGIN
  SELECT c.conkey, c.conrelid INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table AND c.contype = 'p';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO actual_cols
    FROM unnest(r.conkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = ord.attnum;

  IF actual_cols IS DISTINCT FROM p_expected_cols THEN
    RAISE EXCEPTION 'Migration drift: public.% PRIMARY KEY is on % but % was expected',
      p_table, actual_cols, p_expected_cols;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_fk(
  p_table text, p_conname text,
  p_expected_source_cols text[], p_expected_ref_table text, p_expected_ref_cols text[],
  p_expected_ondelete char, p_expected_onupdate char,
  p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  source_cols text[];
  ref_cols text[];
BEGIN
  SELECT c.confdeltype, c.confupdtype, c.confmatchtype, c.conkey, c.confkey, c.confrelid, c.conrelid, c.convalidated
    INTO r
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = p_table
      AND c.conname = p_conname AND c.contype = 'f';

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF NOT r.convalidated THEN
    RAISE EXCEPTION 'Migration drift: public.%.% exists but is NOT VALID — it was never confirmed against pre-existing rows and may not actually hold',
      p_table, p_conname;
  END IF;

  IF to_regclass('public.' || p_expected_ref_table)::oid IS DISTINCT FROM r.confrelid THEN
    RAISE EXCEPTION 'Migration drift: public.%.% references the wrong table (expected public.%)',
      p_table, p_conname, p_expected_ref_table;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO source_cols
    FROM unnest(r.conkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = ord.attnum;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO ref_cols
    FROM unnest(r.confkey) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.confrelid AND a.attnum = ord.attnum;

  IF source_cols IS DISTINCT FROM p_expected_source_cols THEN
    RAISE EXCEPTION 'Migration drift: public.%.% source columns are % but % was expected',
      p_table, p_conname, source_cols, p_expected_source_cols;
  END IF;

  IF ref_cols IS DISTINCT FROM p_expected_ref_cols THEN
    RAISE EXCEPTION 'Migration drift: public.%.% referenced columns are % but % was expected',
      p_table, p_conname, ref_cols, p_expected_ref_cols;
  END IF;

  IF r.confdeltype IS DISTINCT FROM p_expected_ondelete THEN
    RAISE EXCEPTION 'Migration drift: public.%.% ON DELETE is % but % was expected',
      p_table, p_conname, r.confdeltype, p_expected_ondelete;
  END IF;

  IF r.confupdtype IS DISTINCT FROM p_expected_onupdate THEN
    RAISE EXCEPTION 'Migration drift: public.%.% ON UPDATE is % but % was expected',
      p_table, p_conname, r.confupdtype, p_expected_onupdate;
  END IF;

  IF r.confmatchtype IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'Migration drift: public.%.% match type is % but MATCH SIMPLE (s) was expected — MATCH FULL would reject legitimate rows where only one FK column is NULL',
      p_table, p_conname, r.confmatchtype;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_unique_index(
  p_table text, p_index_name text, p_expected_cols text[], p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  actual_cols text[];
BEGIN
  SELECT i.indrelid, i.indisunique, i.indpred, i.indexprs, i.indkey
    INTO r
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'public' AND ic.relname = p_index_name AND t.relname = p_table;

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF NOT r.indisunique THEN
    RAISE EXCEPTION 'Migration drift: public.% is not a UNIQUE index (expected UNIQUE on public.%)',
      p_index_name, p_table;
  END IF;

  IF r.indpred IS NOT NULL THEN
    RAISE EXCEPTION 'Migration drift: public.% has a partial-index predicate; none was expected',
      p_index_name;
  END IF;

  IF r.indexprs IS NOT NULL THEN
    RAISE EXCEPTION 'Migration drift: public.% has expression columns; only plain columns were expected',
      p_index_name;
  END IF;

  SELECT array_agg(a.attname ORDER BY ord.n) INTO actual_cols
    FROM unnest(r.indkey::int2[]) WITH ORDINALITY AS ord(attnum, n)
    JOIN pg_attribute a ON a.attrelid = r.indrelid AND a.attnum = ord.attnum;

  IF actual_cols IS DISTINCT FROM p_expected_cols THEN
    RAISE EXCEPTION 'Migration drift: public.% columns are % but % was expected',
      p_index_name, actual_cols, p_expected_cols;
  END IF;
END;
$fn$;

-- NEW helper (6.2D3A). Same ensure/validate/RAISE shape as every helper
-- above: create if absent, otherwise compare the EXACT stored definition
-- (pg_get_indexdef — covers uniqueness, access method, column list/order,
-- expressions and any partial predicate in one normalized string) and
-- RAISE on any difference. Replaces the bare CREATE INDEX IF NOT EXISTS
-- used by earlier scripts, which silently accepts a same-named index
-- with a different definition.
CREATE OR REPLACE FUNCTION pg_temp.ensure_index(
  p_table text, p_index_name text, p_expected_def text, p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_def text;
  actual_valid boolean;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid), i.indisvalid INTO actual_def, actual_valid
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'public' AND ic.relname = p_index_name AND t.relname = p_table;

  IF NOT FOUND THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_def IS DISTINCT FROM p_expected_def THEN
    RAISE EXCEPTION 'Migration drift: index public.% is "%" but "%" was expected',
      p_index_name, actual_def, p_expected_def;
  END IF;

  -- e.g. left behind by an interrupted CREATE INDEX CONCURRENTLY: same
  -- definition text, but not usable/maintained as a real index.
  IF NOT actual_valid THEN
    RAISE EXCEPTION 'Migration drift: index public.% exists but is INVALID', p_index_name;
  END IF;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.dataset_types
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dataset_types ();

SELECT pg_temp.ensure_column('dataset_types', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('dataset_types', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('dataset_types', 'source_system_id', 'text', false, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN source_system_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('dataset_types', 'name', 'text', false, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN name TEXT NOT NULL');
SELECT pg_temp.ensure_column('dataset_types', 'description', 'text', true, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN description TEXT');
SELECT pg_temp.ensure_column('dataset_types', 'active', 'boolean', false, true, 'true',
  'ALTER TABLE public.dataset_types ADD COLUMN active BOOLEAN NOT NULL DEFAULT true');
SELECT pg_temp.ensure_column('dataset_types', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.dataset_types ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('dataset_types', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.dataset_types ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('dataset_types', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.dataset_types ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('dataset_types', ARRAY['id'],
  'ALTER TABLE public.dataset_types ADD PRIMARY KEY (id)');

-- Required by source_schema_versions' composite tenant-scoped FK.
SELECT pg_temp.ensure_unique_constraint('dataset_types', 'dataset_types_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Required by import_batches' dataset-type lineage FK (STEP 8): the
-- three-column shape is what proves a batch's dataset type belongs to
-- the batch's OWN source system AND tenant, not merely carries a valid id.
SELECT pg_temp.ensure_unique_constraint('dataset_types', 'dataset_types_id_source_system_id_organisation_id_key',
  'UNIQUE (id, source_system_id, organisation_id)',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_id_source_system_id_organisation_id_key UNIQUE (id, source_system_id, organisation_id)');

-- Scoped to the (single-tenant-owned) source system, never global — two
-- source systems (in the same or different tenants) may reuse a name.
SELECT pg_temp.ensure_unique_constraint('dataset_types', 'dataset_types_source_system_id_name_key',
  'UNIQUE (source_system_id, name)',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_source_system_id_name_key UNIQUE (source_system_id, name)');

SELECT pg_temp.ensure_fk('dataset_types', 'dataset_types_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('dataset_types', 'dataset_types_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

-- Composite tenant-scoped FK — structurally impossible for a dataset type
-- to reference a source_system belonging to a different organisation_id.
SELECT pg_temp.ensure_fk('dataset_types', 'dataset_types_source_system_org_fkey',
  ARRAY['source_system_id', 'organisation_id'], 'source_systems', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.dataset_types ADD CONSTRAINT dataset_types_source_system_org_fkey FOREIGN KEY (source_system_id, organisation_id) REFERENCES public.source_systems (id, organisation_id)');

SELECT pg_temp.ensure_index('dataset_types', 'idx_dataset_types_organisation',
  'CREATE INDEX idx_dataset_types_organisation ON public.dataset_types USING btree (organisation_id)',
  'CREATE INDEX idx_dataset_types_organisation ON public.dataset_types (organisation_id)');
SELECT pg_temp.ensure_index('dataset_types', 'idx_dataset_types_source_system',
  'CREATE INDEX idx_dataset_types_source_system ON public.dataset_types USING btree (source_system_id)',
  'CREATE INDEX idx_dataset_types_source_system ON public.dataset_types (source_system_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — public.source_schema_versions
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_schema_versions ();

SELECT pg_temp.ensure_column('source_schema_versions', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_versions', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_versions', 'dataset_type_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN dataset_type_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_versions', 'version_number', 'integer', false, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN version_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('source_schema_versions', 'label', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN label TEXT NOT NULL');
-- Defaults to the least-privileged lifecycle state. Nothing in D3A
-- activates or retires a version.
SELECT pg_temp.ensure_column('source_schema_versions', 'status', 'text', false, true, '''DRAFT''::text',
  $sql$ALTER TABLE public.source_schema_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT'$sql$);
SELECT pg_temp.ensure_column('source_schema_versions', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('source_schema_versions', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_schema_versions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('source_schema_versions', 'activated_at', 'timestamp with time zone', true, true, NULL,
  'ALTER TABLE public.source_schema_versions ADD COLUMN activated_at TIMESTAMPTZ');

SELECT pg_temp.ensure_primary_key('source_schema_versions', ARRAY['id'],
  'ALTER TABLE public.source_schema_versions ADD PRIMARY KEY (id)');

-- Required by source_schema_worksheets' composite tenant-scoped FK.
SELECT pg_temp.ensure_unique_constraint('source_schema_versions', 'source_schema_versions_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Required by import_batches' schema-version lineage FK (STEP 8): proves
-- a batch's schema version belongs to the batch's OWN dataset type AND
-- tenant. Name shortened to stay under Postgres's 63-byte identifier
-- limit (see 5B.1's source_mappings_active_mv_id_org_key note: a
-- silently-truncated name would break this script's exact-name rerun).
SELECT pg_temp.ensure_unique_constraint('source_schema_versions', 'source_schema_versions_id_dataset_type_org_key',
  'UNIQUE (id, dataset_type_id, organisation_id)',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_id_dataset_type_org_key UNIQUE (id, dataset_type_id, organisation_id)');

SELECT pg_temp.ensure_unique_constraint('source_schema_versions', 'source_schema_versions_dataset_type_id_version_number_key',
  'UNIQUE (dataset_type_id, version_number)',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_dataset_type_id_version_number_key UNIQUE (dataset_type_id, version_number)');

SELECT pg_temp.ensure_check('source_schema_versions', 'source_schema_versions_version_number_check',
  'CHECK ((version_number >= 1))',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_version_number_check CHECK (version_number >= 1)');

SELECT pg_temp.ensure_check('source_schema_versions', 'source_schema_versions_status_check',
  'CHECK ((status = ANY (ARRAY[''DRAFT''::text, ''ACTIVE''::text, ''RETIRED''::text])))',
  $sql$ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))$sql$);

-- Lifecycle coherence: a DRAFT has never been activated; an ACTIVE
-- version always records when it was activated. RETIRED is unconstrained
-- (a DRAFT may be retired without ever having been activated).
SELECT pg_temp.ensure_check('source_schema_versions', 'source_schema_versions_activation_check',
  'CHECK ((((status = ''DRAFT''::text) AND (activated_at IS NULL)) OR ((status = ''ACTIVE''::text) AND (activated_at IS NOT NULL)) OR (status = ''RETIRED''::text)))',
  $sql$ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_activation_check CHECK ((status = 'DRAFT' AND activated_at IS NULL) OR (status = 'ACTIVE' AND activated_at IS NOT NULL) OR status = 'RETIRED')$sql$);

SELECT pg_temp.ensure_fk('source_schema_versions', 'source_schema_versions_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('source_schema_versions', 'source_schema_versions_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

SELECT pg_temp.ensure_fk('source_schema_versions', 'source_schema_versions_dataset_type_org_fkey',
  ARRAY['dataset_type_id', 'organisation_id'], 'dataset_types', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_schema_versions ADD CONSTRAINT source_schema_versions_dataset_type_org_fkey FOREIGN KEY (dataset_type_id, organisation_id) REFERENCES public.dataset_types (id, organisation_id)');

SELECT pg_temp.ensure_index('source_schema_versions', 'idx_source_schema_versions_organisation',
  'CREATE INDEX idx_source_schema_versions_organisation ON public.source_schema_versions USING btree (organisation_id)',
  'CREATE INDEX idx_source_schema_versions_organisation ON public.source_schema_versions (organisation_id)');
SELECT pg_temp.ensure_index('source_schema_versions', 'idx_source_schema_versions_dataset_type',
  'CREATE INDEX idx_source_schema_versions_dataset_type ON public.source_schema_versions USING btree (dataset_type_id)',
  'CREATE INDEX idx_source_schema_versions_dataset_type ON public.source_schema_versions (dataset_type_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — public.source_schema_worksheets
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_schema_worksheets ();

SELECT pg_temp.ensure_column('source_schema_worksheets', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_worksheets', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_worksheets', 'source_schema_version_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN source_schema_version_id TEXT NOT NULL');
-- Stable semantic identity of the sheet across schema versions (e.g.
-- 'service_requests'), independent of its display name.
SELECT pg_temp.ensure_column('source_schema_worksheets', 'logical_key', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN logical_key TEXT NOT NULL');
-- The sheet name as it appears in files of THIS schema version.
SELECT pg_temp.ensure_column('source_schema_worksheets', 'expected_name', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN expected_name TEXT NOT NULL');
-- NULLABLE, zero-based (same convention as uploads.worksheet_index /
-- workbookParser.ts). A HINT only: the authoritative runtime sheet
-- identity is the parser's worksheet_index for a given physical file,
-- and the schema-level match key is expected_name/logical_key. Sheet
-- position is not a stable property of a schema when OPTIONAL sheets
-- may be absent (every later sheet shifts), so it is neither required
-- nor unique.
SELECT pg_temp.ensure_column('source_schema_worksheets', 'ordinal_hint', 'integer', true, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN ordinal_hint INTEGER');
SELECT pg_temp.ensure_column('source_schema_worksheets', 'presence', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN presence TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_worksheets', 'role', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN role TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_worksheets', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_schema_worksheets ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_schema_worksheets', ARRAY['id'],
  'ALTER TABLE public.source_schema_worksheets ADD PRIMARY KEY (id)');

-- Required by source_schema_columns' and worksheet_mapping_profiles'
-- composite tenant-scoped FKs.
SELECT pg_temp.ensure_unique_constraint('source_schema_worksheets', 'source_schema_worksheets_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_id_organisation_id_key UNIQUE (id, organisation_id)');

SELECT pg_temp.ensure_unique_constraint('source_schema_worksheets', 'source_schema_worksheets_version_logical_key_key',
  'UNIQUE (source_schema_version_id, logical_key)',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_version_logical_key_key UNIQUE (source_schema_version_id, logical_key)');

-- Excel sheet names are unique within a workbook, so one schema version
-- never needs two expected sheets with the same name. NOTE: this is a
-- byte-exact (case-sensitive) uniqueness; Excel's own rule is
-- case-insensitive — a later write service must reject case-only
-- duplicates before insert.
SELECT pg_temp.ensure_unique_constraint('source_schema_worksheets', 'source_schema_worksheets_version_expected_name_key',
  'UNIQUE (source_schema_version_id, expected_name)',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_version_expected_name_key UNIQUE (source_schema_version_id, expected_name)');

SELECT pg_temp.ensure_check('source_schema_worksheets', 'source_schema_worksheets_ordinal_hint_check',
  'CHECK ((ordinal_hint >= 0))',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_ordinal_hint_check CHECK (ordinal_hint >= 0)');

SELECT pg_temp.ensure_check('source_schema_worksheets', 'source_schema_worksheets_presence_check',
  'CHECK ((presence = ANY (ARRAY[''REQUIRED''::text, ''OPTIONAL''::text])))',
  $sql$ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_presence_check CHECK (presence IN ('REQUIRED', 'OPTIONAL'))$sql$);

SELECT pg_temp.ensure_check('source_schema_worksheets', 'source_schema_worksheets_role_check',
  'CHECK ((role = ANY (ARRAY[''DATA''::text, ''METADATA''::text, ''SUMMARY''::text])))',
  $sql$ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_role_check CHECK (role IN ('DATA', 'METADATA', 'SUMMARY'))$sql$);

SELECT pg_temp.ensure_fk('source_schema_worksheets', 'source_schema_worksheets_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('source_schema_worksheets', 'source_schema_worksheets_version_org_fkey',
  ARRAY['source_schema_version_id', 'organisation_id'], 'source_schema_versions', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_schema_worksheets ADD CONSTRAINT source_schema_worksheets_version_org_fkey FOREIGN KEY (source_schema_version_id, organisation_id) REFERENCES public.source_schema_versions (id, organisation_id)');

SELECT pg_temp.ensure_index('source_schema_worksheets', 'idx_source_schema_worksheets_organisation',
  'CREATE INDEX idx_source_schema_worksheets_organisation ON public.source_schema_worksheets USING btree (organisation_id)',
  'CREATE INDEX idx_source_schema_worksheets_organisation ON public.source_schema_worksheets (organisation_id)');
SELECT pg_temp.ensure_index('source_schema_worksheets', 'idx_source_schema_worksheets_version',
  'CREATE INDEX idx_source_schema_worksheets_version ON public.source_schema_worksheets USING btree (source_schema_version_id)',
  'CREATE INDEX idx_source_schema_worksheets_version ON public.source_schema_worksheets (source_schema_version_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — public.source_schema_columns
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_schema_columns ();

SELECT pg_temp.ensure_column('source_schema_columns', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_columns', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_columns', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
-- Zero-based column position within the sheet — the unambiguous
-- per-sheet structural identity of a column (UNIQUE below).
SELECT pg_temp.ensure_column('source_schema_columns', 'ordinal', 'integer', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN ordinal INTEGER NOT NULL');
-- The literal header text as it appears in the source. DELIBERATELY NOT
-- unique per sheet: real exports can contain duplicate header text, and
-- a schema must be able to describe such a source truthfully rather than
-- force an invented header. Identity is ordinal (structural) and
-- logical_field_key (semantic). D3C's header matcher must therefore
-- detect duplicate headers — in observed data AND in a schema definition
-- — and never resolve a duplicated header by name alone.
SELECT pg_temp.ensure_column('source_schema_columns', 'source_header', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN source_header TEXT NOT NULL');
-- Nullable: no semantics are invented where none are known yet. Not
-- unique per sheet in D3A (no consumer exists to justify a partial
-- unique index yet).
SELECT pg_temp.ensure_column('source_schema_columns', 'logical_field_key', 'text', true, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN logical_field_key TEXT');
SELECT pg_temp.ensure_column('source_schema_columns', 'presence', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN presence TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_columns', 'declared_type', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN declared_type TEXT NOT NULL');
-- NOT NULL with NO default — classification must always be an explicit
-- decision, never silently defaulted to a less-protected class.
SELECT pg_temp.ensure_column('source_schema_columns', 'sensitivity_class', 'text', false, true, NULL,
  'ALTER TABLE public.source_schema_columns ADD COLUMN sensitivity_class TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_schema_columns', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_schema_columns ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_schema_columns', ARRAY['id'],
  'ALTER TABLE public.source_schema_columns ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_unique_constraint('source_schema_columns', 'source_schema_columns_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_id_organisation_id_key UNIQUE (id, organisation_id)');

SELECT pg_temp.ensure_unique_constraint('source_schema_columns', 'source_schema_columns_worksheet_ordinal_key',
  'UNIQUE (source_schema_worksheet_id, ordinal)',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_worksheet_ordinal_key UNIQUE (source_schema_worksheet_id, ordinal)');

SELECT pg_temp.ensure_check('source_schema_columns', 'source_schema_columns_ordinal_check',
  'CHECK ((ordinal >= 0))',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_ordinal_check CHECK (ordinal >= 0)');

SELECT pg_temp.ensure_check('source_schema_columns', 'source_schema_columns_presence_check',
  'CHECK ((presence = ANY (ARRAY[''REQUIRED''::text, ''OPTIONAL''::text])))',
  $sql$ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_presence_check CHECK (presence IN ('REQUIRED', 'OPTIONAL'))$sql$);

SELECT pg_temp.ensure_check('source_schema_columns', 'source_schema_columns_declared_type_check',
  'CHECK ((declared_type = ANY (ARRAY[''STRING''::text, ''DATE_TIME''::text, ''DATE''::text, ''INTEGER''::text, ''DECIMAL''::text, ''BOOLEAN''::text, ''UNKNOWN''::text])))',
  $sql$ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_declared_type_check CHECK (declared_type IN ('STRING', 'DATE_TIME', 'DATE', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'UNKNOWN'))$sql$);

-- Data Hub column classification vocabulary. No Data Hub classification
-- enum/constant exists elsewhere in this repository; lib/hr/fieldTiers.ts
-- (internal/confidential/restricted) is an HR-module-only, fail-closed
-- field-name tier map and is deliberately NOT reused or aliased here.
SELECT pg_temp.ensure_check('source_schema_columns', 'source_schema_columns_sensitivity_class_check',
  'CHECK ((sensitivity_class = ANY (ARRAY[''PUBLIC''::text, ''INTERNAL''::text, ''CONFIDENTIAL''::text, ''PERSONALLY_IDENTIFIABLE''::text, ''HIGHLY_SENSITIVE''::text])))',
  $sql$ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_sensitivity_class_check CHECK (sensitivity_class IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PERSONALLY_IDENTIFIABLE', 'HIGHLY_SENSITIVE'))$sql$);

SELECT pg_temp.ensure_fk('source_schema_columns', 'source_schema_columns_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('source_schema_columns', 'source_schema_columns_worksheet_org_fkey',
  ARRAY['source_schema_worksheet_id', 'organisation_id'], 'source_schema_worksheets', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_schema_columns ADD CONSTRAINT source_schema_columns_worksheet_org_fkey FOREIGN KEY (source_schema_worksheet_id, organisation_id) REFERENCES public.source_schema_worksheets (id, organisation_id)');

SELECT pg_temp.ensure_index('source_schema_columns', 'idx_source_schema_columns_organisation',
  'CREATE INDEX idx_source_schema_columns_organisation ON public.source_schema_columns USING btree (organisation_id)',
  'CREATE INDEX idx_source_schema_columns_organisation ON public.source_schema_columns (organisation_id)');
SELECT pg_temp.ensure_index('source_schema_columns', 'idx_source_schema_columns_worksheet',
  'CREATE INDEX idx_source_schema_columns_worksheet ON public.source_schema_columns USING btree (source_schema_worksheet_id)',
  'CREATE INDEX idx_source_schema_columns_worksheet ON public.source_schema_columns (source_schema_worksheet_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5 — public.worksheet_mapping_profiles (WITHOUT its active-version
-- FK yet — added in STEP 7, once worksheet_mapping_profile_versions
-- exists).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.worksheet_mapping_profiles ();

SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'source_schema_worksheet_id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN source_schema_worksheet_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'name', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN name TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'active', 'boolean', false, true, 'true',
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN active BOOLEAN NOT NULL DEFAULT true');
-- Nullable by design — never populated in D3A. Its composite FK is added
-- in STEP 7.
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'active_profile_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN active_profile_version_id TEXT');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('worksheet_mapping_profiles', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.worksheet_mapping_profiles ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('worksheet_mapping_profiles', ARRAY['id'],
  'ALTER TABLE public.worksheet_mapping_profiles ADD PRIMARY KEY (id)');

-- Required by worksheet_mapping_profile_versions' composite FK.
SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profiles', 'worksheet_mapping_profiles_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Scoped to the (single-tenant-owned) worksheet definition, never global.
SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profiles', 'worksheet_mapping_profiles_worksheet_name_key',
  'UNIQUE (source_schema_worksheet_id, name)',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_worksheet_name_key UNIQUE (source_schema_worksheet_id, name)');

SELECT pg_temp.ensure_fk('worksheet_mapping_profiles', 'worksheet_mapping_profiles_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('worksheet_mapping_profiles', 'worksheet_mapping_profiles_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

SELECT pg_temp.ensure_fk('worksheet_mapping_profiles', 'worksheet_mapping_profiles_worksheet_org_fkey',
  ARRAY['source_schema_worksheet_id', 'organisation_id'], 'source_schema_worksheets', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_worksheet_org_fkey FOREIGN KEY (source_schema_worksheet_id, organisation_id) REFERENCES public.source_schema_worksheets (id, organisation_id)');

SELECT pg_temp.ensure_index('worksheet_mapping_profiles', 'idx_worksheet_mapping_profiles_organisation',
  'CREATE INDEX idx_worksheet_mapping_profiles_organisation ON public.worksheet_mapping_profiles USING btree (organisation_id)',
  'CREATE INDEX idx_worksheet_mapping_profiles_organisation ON public.worksheet_mapping_profiles (organisation_id)');
SELECT pg_temp.ensure_index('worksheet_mapping_profiles', 'idx_worksheet_mapping_profiles_worksheet',
  'CREATE INDEX idx_worksheet_mapping_profiles_worksheet ON public.worksheet_mapping_profiles USING btree (source_schema_worksheet_id)',
  'CREATE INDEX idx_worksheet_mapping_profiles_worksheet ON public.worksheet_mapping_profiles (source_schema_worksheet_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 6 — public.worksheet_mapping_profile_versions (immutable; safe to
-- create now that worksheet_mapping_profiles exists).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.worksheet_mapping_profile_versions ();

SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_id', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN worksheet_mapping_profile_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'version_number', 'integer', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN version_number INTEGER NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'disposition', 'text', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN disposition TEXT NOT NULL');
-- Declarative configuration only — see file header. NOT NULL, no
-- default: a version without a real document is a contradiction.
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'profile_document', 'jsonb', false, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN profile_document JSONB NOT NULL');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('worksheet_mapping_profile_versions', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('worksheet_mapping_profile_versions', ARRAY['id'],
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Required by the active-version composite FK (STEP 7): proves the
-- pointer targets a version of the SAME profile AND the SAME tenant.
SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_id_profile_org_key',
  'UNIQUE (id, worksheet_mapping_profile_id, organisation_id)',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_id_profile_org_key UNIQUE (id, worksheet_mapping_profile_id, organisation_id)');

SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_profile_version_key',
  'UNIQUE (worksheet_mapping_profile_id, version_number)',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_profile_version_key UNIQUE (worksheet_mapping_profile_id, version_number)');

SELECT pg_temp.ensure_check('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_version_number_check',
  'CHECK ((version_number >= 1))',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_version_number_check CHECK (version_number >= 1)');

SELECT pg_temp.ensure_check('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_disposition_check',
  'CHECK ((disposition = ANY (ARRAY[''STAGING_DATASET''::text, ''METADATA''::text, ''RECONCILIATION_SUMMARY''::text, ''IGNORE''::text])))',
  $sql$ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_disposition_check CHECK (disposition IN ('STAGING_DATASET', 'METADATA', 'RECONCILIATION_SUMMARY', 'IGNORE'))$sql$);

-- Minimal structural guard only (a JSON object, never a bare scalar or
-- array). Content validation is a later phase's responsibility.
SELECT pg_temp.ensure_check('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_document_object_check',
  'CHECK ((jsonb_typeof(profile_document) = ''object''::text))',
  $sql$ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_document_object_check CHECK (jsonb_typeof(profile_document) = 'object')$sql$);

SELECT pg_temp.ensure_fk('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

SELECT pg_temp.ensure_fk('worksheet_mapping_profile_versions', 'worksheet_mapping_profile_versions_profile_org_fkey',
  ARRAY['worksheet_mapping_profile_id', 'organisation_id'], 'worksheet_mapping_profiles', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.worksheet_mapping_profile_versions ADD CONSTRAINT worksheet_mapping_profile_versions_profile_org_fkey FOREIGN KEY (worksheet_mapping_profile_id, organisation_id) REFERENCES public.worksheet_mapping_profiles (id, organisation_id)');

SELECT pg_temp.ensure_index('worksheet_mapping_profile_versions', 'idx_worksheet_mapping_profile_versions_organisation',
  'CREATE INDEX idx_worksheet_mapping_profile_versions_organisation ON public.worksheet_mapping_profile_versions USING btree (organisation_id)',
  'CREATE INDEX idx_worksheet_mapping_profile_versions_organisation ON public.worksheet_mapping_profile_versions (organisation_id)');
SELECT pg_temp.ensure_index('worksheet_mapping_profile_versions', 'idx_worksheet_mapping_profile_versions_profile',
  'CREATE INDEX idx_worksheet_mapping_profile_versions_profile ON public.worksheet_mapping_profile_versions USING btree (worksheet_mapping_profile_id)',
  'CREATE INDEX idx_worksheet_mapping_profile_versions_profile ON public.worksheet_mapping_profile_versions (worksheet_mapping_profile_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 7 — worksheet_mapping_profiles.active_profile_version_id's
-- composite FK, added only now that its target table exists.
-- ═══════════════════════════════════════════════════════════════════

-- Required by Prisma's one-to-one relation validator on the defining side
-- (trivially satisfied since id is the PK) — mirrors 5B.1's
-- source_mappings_active_mv_id_org_key exactly.
SELECT pg_temp.ensure_unique_constraint('worksheet_mapping_profiles', 'worksheet_mapping_profiles_active_pv_id_org_key',
  'UNIQUE (active_profile_version_id, id, organisation_id)',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_active_pv_id_org_key UNIQUE (active_profile_version_id, id, organisation_id)');

-- THE active-version integrity invariant: (active_profile_version_id, id,
-- organisation_id) -> versions(id, worksheet_mapping_profile_id,
-- organisation_id). The profile's OWN id sits in the referenced row's
-- worksheet_mapping_profile_id position, so the pointer can only ever
-- target a version of THIS profile in THIS tenant. MATCH SIMPLE: a NULL
-- pointer (every row in D3A) is exempt; id/organisation_id are NOT NULL,
-- so a non-NULL pointer is always fully checked.
SELECT pg_temp.ensure_fk('worksheet_mapping_profiles', 'worksheet_mapping_profiles_active_version_fkey',
  ARRAY['active_profile_version_id', 'id', 'organisation_id'], 'worksheet_mapping_profile_versions', ARRAY['id', 'worksheet_mapping_profile_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.worksheet_mapping_profiles ADD CONSTRAINT worksheet_mapping_profiles_active_version_fkey FOREIGN KEY (active_profile_version_id, id, organisation_id) REFERENCES public.worksheet_mapping_profile_versions (id, worksheet_mapping_profile_id, organisation_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 8 — additive, nullable lineage columns on the pre-existing
-- import_batches table. NULL for every existing row — zero backfill. No
-- runtime path writes or reads them in D3A.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('import_batches', 'dataset_type_id', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN dataset_type_id TEXT');
SELECT pg_temp.ensure_column('import_batches', 'source_schema_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN source_schema_version_id TEXT');

-- Implication CHECKs — see file header. Without these, MATCH SIMPLE would
-- skip the composite FKs below whenever the parent-link column is NULL.
SELECT pg_temp.ensure_check('import_batches', 'import_batches_dataset_type_requires_source_system_check',
  'CHECK (((dataset_type_id IS NULL) OR (source_system_id IS NOT NULL)))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_dataset_type_requires_source_system_check CHECK (dataset_type_id IS NULL OR source_system_id IS NOT NULL)');
SELECT pg_temp.ensure_check('import_batches', 'import_batches_schema_version_requires_dataset_type_check',
  'CHECK (((source_schema_version_id IS NULL) OR (dataset_type_id IS NOT NULL)))',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_schema_version_requires_dataset_type_check CHECK (source_schema_version_id IS NULL OR dataset_type_id IS NOT NULL)');

-- Dataset type must belong to the batch's OWN source system and tenant.
SELECT pg_temp.ensure_fk('import_batches', 'import_batches_dataset_type_fkey',
  ARRAY['dataset_type_id', 'source_system_id', 'organisation_id'], 'dataset_types', ARRAY['id', 'source_system_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_dataset_type_fkey FOREIGN KEY (dataset_type_id, source_system_id, organisation_id) REFERENCES public.dataset_types (id, source_system_id, organisation_id)');

-- Schema version must belong to the batch's OWN dataset type and tenant.
SELECT pg_temp.ensure_fk('import_batches', 'import_batches_source_schema_version_fkey',
  ARRAY['source_schema_version_id', 'dataset_type_id', 'organisation_id'], 'source_schema_versions', ARRAY['id', 'dataset_type_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_source_schema_version_fkey FOREIGN KEY (source_schema_version_id, dataset_type_id, organisation_id) REFERENCES public.source_schema_versions (id, dataset_type_id, organisation_id)');

-- No new import_batches index in D3A, deliberately: no runtime query
-- filters batches by dataset type or schema version yet, and the parent
-- rows are never deleted or re-keyed (no API), so the referencing-side
-- index that would speed a parent DELETE's NO ACTION check has nothing to
-- serve. The slice that introduces such a query adds its own index.

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (manual, NOT executed by this script — for reference only,
-- same convention as scripts/create-datahub-source-mappings.sql's own
-- commented rollback block).
--
-- WARNING: this rollback is only safe BEFORE any meaningful reference
-- exists — i.e. before any import_batches row carries a non-NULL
-- dataset_type_id/source_schema_version_id and before any real dataset
-- type, schema version, worksheet/column definition or mapping profile
-- has been authored. After that point, dropping these columns/tables
-- permanently destroys lineage and governed configuration history; take
-- a verified backup and get explicit approval first. The matching
-- prisma/schema.prisma models/fields must be reverted in the same change,
-- or Prisma Client queries will fail on the missing columns/tables.
-- Order matters (the
-- import_batches FKs and the profile active-pointer FK must go before
-- the tables they reference):
--
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_source_schema_version_fkey;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_dataset_type_fkey;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_schema_version_requires_dataset_type_check;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_dataset_type_requires_source_system_check;
--   ALTER TABLE public.import_batches DROP COLUMN IF EXISTS source_schema_version_id;
--   ALTER TABLE public.import_batches DROP COLUMN IF EXISTS dataset_type_id;
--   ALTER TABLE public.worksheet_mapping_profiles DROP CONSTRAINT IF EXISTS worksheet_mapping_profiles_active_version_fkey;
--   DROP TABLE IF EXISTS public.worksheet_mapping_profile_versions;
--   DROP TABLE IF EXISTS public.worksheet_mapping_profiles;
--   DROP TABLE IF EXISTS public.source_schema_columns;
--   DROP TABLE IF EXISTS public.source_schema_worksheets;
--   DROP TABLE IF EXISTS public.source_schema_versions;
--   DROP TABLE IF EXISTS public.dataset_types;
-- ═══════════════════════════════════════════════════════════════════
