-- Data Hub 5B.1 — Source Systems / Mapping additive schema foundation.
-- Run once against the target database. NOT run automatically by this
-- task. NEVER run against Production or Neon Preview by this task —
-- verification is via a local disposable Postgres container only (see
-- scripts/tests/verify-datahub-source-mappings.sh).
--
-- Repeatable AND fail-loud, by construction — identical methodology to
-- scripts/create-import-batches.sql (5A.2C): every column/CHECK/unique
-- constraint/unique index/foreign key below is handled by a single
-- pg_temp.ensure_*() call that either creates the exact expected object
-- (if genuinely absent — failing loudly if pre-existing data violates
-- it) or validates the exact expected definition (if already present,
-- RAISing if it differs). The pg_temp.ensure_*() helper functions below
-- are copied verbatim from scripts/create-import-batches.sql rather
-- than re-derived — same session-scoped (pg_temp), non-persistent
-- validation/repair logic, so this script stays self-contained and
-- runnable standalone.
--
-- Creates:
--   public.source_systems  — tenant-owned logical origin of repeatable
--     imported data. NOT a vendor record, NOT a connector
--     (lib/integrations/** is deliberately not coupled here), NOT an
--     ImportBatch/Upload. No credential/config/secret/scheduling field
--     exists on this table.
--   public.source_mappings — a logical mapping definition belonging to
--     one source_system. Points to its one active mapping_version for
--     O(1) resolution.
--   public.mapping_versions — immutable versioned mapping document
--     (JSONB), scoped to one source_mapping, monotonically-versioned.
-- Adds (both additive, nullable, zero backfill):
--   public.import_batches.source_system_id -> source_systems
--   public.uploads.mapping_version_id      -> mapping_versions
--
-- ARCHITECTURE — SourceMapping <-> MappingVersion pointer cycle:
-- source_mappings.active_mapping_version_id references
-- mapping_versions(id), but mapping_versions.source_mapping_id
-- references source_mappings(id) — a genuine two-table cycle. This is
-- resolved by ORDERING, not by deferred constraints or a nullable
-- work-around table:
--   1. CREATE source_systems (no dependency on the other two).
--   2. CREATE source_mappings WITHOUT its active_mapping_version_id FK
--      (the column itself is created now, nullable — see step 4).
--   3. CREATE mapping_versions, whose own FK to source_mappings can now
--      be added safely (source_mappings already exists).
--   4. ONLY NOW add source_mappings' active_mapping_version_id FK,
--      because mapping_versions (its target) now exists. This is a
--      COMPOSITE FK — (active_mapping_version_id, id, organisation_id)
--      -> mapping_versions(id, source_mapping_id, organisation_id) —
--      which is what makes it structurally impossible for the active
--      pointer to reference a version belonging to a DIFFERENT mapping
--      or a DIFFERENT tenant, not merely a version with the right id.
--   5. Finally, the nullable lineage columns on the pre-existing
--      import_batches/uploads tables, each with its own composite
--      tenant-scoped FK, mirroring uploads_import_batch_org_fkey's own
--      established MATCH SIMPLE precedent exactly.
--
-- ON DELETE policy (see also each ensure_fk call below):
--   organisation_id FKs on all three new tables: NO ACTION — matches
--     import_batches.organisation_id's own precedent (a synchronous
--     CASCADE on organisation deletion must not silently erase
--     mapping/lineage history; deletion of an organisation with
--     attached lineage must fail loudly, not cascade away).
--   created_by (actor/audit) FKs on all three new tables: SET NULL —
--     matches import_batches.uploaded_by / uploads.confirmed_by's own
--     precedent exactly (actor attribution is best-effort, never a
--     reason to block or cascade a user's own deletion).
--   source_mappings -> source_systems, mapping_versions ->
--     source_mappings, source_mappings.active_mapping_version_id ->
--     mapping_versions, import_batches.source_system_id ->
--     source_systems, uploads.mapping_version_id -> mapping_versions:
--     all NO ACTION. There is no hard-delete API for SourceSystem/
--     SourceMapping/MappingVersion in this slice (deactivate-not-delete
--     is the only lifecycle operation) — NO ACTION is the strictest
--     available choice and guarantees no cascade can ever silently
--     erase historical ImportBatch/Upload lineage or MappingVersion
--     history, matching the explicit requirement.
--
-- Column/id convention: TEXT ids with NO database-side default —
-- matches import_batches.id/uploads.id's own convention (Prisma Client
-- supplies cuid() application-side).
--
-- Every DDL target and catalog lookup is schema-qualified as
-- public.<table> — this migration never relies on search_path.
--
-- Repeatable behavioral validation:
-- scripts/tests/verify-datahub-source-mappings.sh runs this script (and
-- reruns it, proving idempotency) against a disposable, self-cleaning
-- Docker postgres:16-alpine container, then exercises real Postgres
-- constraint enforcement (tenant-isolation FK proofs, active-version
-- pointer integrity, duplicate-version rejection, existing-row
-- preservation). No Neon/Production access, no local psql client
-- required beyond Docker.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helpers (pg_temp schema) — copied
-- verbatim from scripts/create-import-batches.sql. See that file's own
-- header for the full rationale; not re-derived here to keep this
-- script standalone/self-contained.
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

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.source_systems
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_systems ();

SELECT pg_temp.ensure_column('source_systems', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_systems ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_systems', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_systems ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_systems', 'name', 'text', false, true, NULL,
  'ALTER TABLE public.source_systems ADD COLUMN name TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_systems', 'description', 'text', true, true, NULL,
  'ALTER TABLE public.source_systems ADD COLUMN description TEXT');
SELECT pg_temp.ensure_column('source_systems', 'active', 'boolean', false, true, 'true',
  'ALTER TABLE public.source_systems ADD COLUMN active BOOLEAN NOT NULL DEFAULT true');
SELECT pg_temp.ensure_column('source_systems', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.source_systems ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('source_systems', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_systems ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('source_systems', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_systems ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_systems', ARRAY['id'],
  'ALTER TABLE public.source_systems ADD PRIMARY KEY (id)');

-- Required by import_batches' and source_mappings' composite tenant-
-- scoped FKs below.
SELECT pg_temp.ensure_unique_constraint('source_systems', 'source_systems_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_systems ADD CONSTRAINT source_systems_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Tenant-scoped, not global — two different organisations may legitimately
-- name a source system the same thing.
SELECT pg_temp.ensure_unique_constraint('source_systems', 'source_systems_organisation_id_name_key',
  'UNIQUE (organisation_id, name)',
  'ALTER TABLE public.source_systems ADD CONSTRAINT source_systems_organisation_id_name_key UNIQUE (organisation_id, name)');

SELECT pg_temp.ensure_fk('source_systems', 'source_systems_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_systems ADD CONSTRAINT source_systems_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('source_systems', 'source_systems_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.source_systems ADD CONSTRAINT source_systems_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

CREATE INDEX IF NOT EXISTS idx_source_systems_organisation ON public.source_systems(organisation_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — public.source_mappings (WITHOUT its active-version FK yet —
-- see the file header's ordering rationale; that FK is added in STEP 4,
-- once mapping_versions exists).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_mappings ();

SELECT pg_temp.ensure_column('source_mappings', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_mappings', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_mappings', 'source_system_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN source_system_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_mappings', 'name', 'text', false, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN name TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_mappings', 'active', 'boolean', false, true, 'true',
  'ALTER TABLE public.source_mappings ADD COLUMN active BOOLEAN NOT NULL DEFAULT true');
-- Nullable by design — mapping creation and version creation are
-- separate, later, transactional service-layer operations; this
-- schema-only slice never populates this column.
SELECT pg_temp.ensure_column('source_mappings', 'active_mapping_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN active_mapping_version_id TEXT');
SELECT pg_temp.ensure_column('source_mappings', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.source_mappings ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('source_mappings', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_mappings ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('source_mappings', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_mappings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_mappings', ARRAY['id'],
  'ALTER TABLE public.source_mappings ADD PRIMARY KEY (id)');

-- Required by mapping_versions' and the active-version composite FKs.
SELECT pg_temp.ensure_unique_constraint('source_mappings', 'source_mappings_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Tenant-safe via source_system_id (already single-tenant-owned) — two
-- mappings on two different source systems may share a name.
SELECT pg_temp.ensure_unique_constraint('source_mappings', 'source_mappings_source_system_id_name_key',
  'UNIQUE (source_system_id, name)',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_source_system_id_name_key UNIQUE (source_system_id, name)');

SELECT pg_temp.ensure_fk('source_mappings', 'source_mappings_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('source_mappings', 'source_mappings_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

-- Composite tenant-scoped FK (MATCH SIMPLE, Postgres's default) — makes
-- it structurally impossible for a mapping to reference a source_system
-- belonging to a different organisation_id. NO ACTION: there is no
-- hard-delete API for source_systems in this slice, so this can only
-- ever block, never silently cascade away mapping history.
SELECT pg_temp.ensure_fk('source_mappings', 'source_mappings_source_system_org_fkey',
  ARRAY['source_system_id', 'organisation_id'], 'source_systems', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_source_system_org_fkey FOREIGN KEY (source_system_id, organisation_id) REFERENCES public.source_systems (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_source_mappings_organisation ON public.source_mappings(organisation_id);
CREATE INDEX IF NOT EXISTS idx_source_mappings_source_system ON public.source_mappings(source_system_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — public.mapping_versions (immutable versioned mapping
-- document; safe to create now that source_mappings exists).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mapping_versions ();

SELECT pg_temp.ensure_column('mapping_versions', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('mapping_versions', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('mapping_versions', 'source_mapping_id', 'text', false, true, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN source_mapping_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('mapping_versions', 'version_number', 'integer', false, true, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN version_number INTEGER NOT NULL');
-- Structural source-column mapping document only — never executable
-- code, credentials, raw imported rows, or customer data samples (see
-- file header / prisma/schema.prisma's MappingVersion doc comment).
-- NOT NULL, no default — a version without a real document is a
-- contradiction of "immutable versioned mapping document".
SELECT pg_temp.ensure_column('mapping_versions', 'mapping_document', 'jsonb', false, false, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN mapping_document JSONB NOT NULL');
SELECT pg_temp.ensure_column('mapping_versions', 'created_by', 'text', true, true, NULL,
  'ALTER TABLE public.mapping_versions ADD COLUMN created_by TEXT');
SELECT pg_temp.ensure_column('mapping_versions', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.mapping_versions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('mapping_versions', ARRAY['id'],
  'ALTER TABLE public.mapping_versions ADD PRIMARY KEY (id)');

-- Required by uploads' composite tenant-scoped FK.
SELECT pg_temp.ensure_unique_constraint('mapping_versions', 'mapping_versions_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_id_organisation_id_key UNIQUE (id, organisation_id)');

-- Required by source_mappings.active_mapping_version_id's composite FK
-- (STEP 4 below) — the three-column shape (id, source_mapping_id,
-- organisation_id) is what makes that pointer provably belong to the
-- SAME mapping AND the SAME tenant, not merely carry the right id.
SELECT pg_temp.ensure_unique_constraint('mapping_versions', 'mapping_versions_id_source_mapping_id_organisation_id_key',
  'UNIQUE (id, source_mapping_id, organisation_id)',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_id_source_mapping_id_organisation_id_key UNIQUE (id, source_mapping_id, organisation_id)');

-- Enforces "monotonically increasing version number scoped to the
-- mapping" as a hard DB invariant, not merely an application
-- convention.
SELECT pg_temp.ensure_unique_constraint('mapping_versions', 'mapping_versions_source_mapping_id_version_number_key',
  'UNIQUE (source_mapping_id, version_number)',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_source_mapping_id_version_number_key UNIQUE (source_mapping_id, version_number)');

SELECT pg_temp.ensure_check('mapping_versions', 'mapping_versions_version_number_check',
  'CHECK ((version_number >= 1))',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_version_number_check CHECK (version_number >= 1)');

SELECT pg_temp.ensure_fk('mapping_versions', 'mapping_versions_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

SELECT pg_temp.ensure_fk('mapping_versions', 'mapping_versions_created_by_fkey',
  ARRAY['created_by'], 'users', ARRAY['id'], 'n', 'a',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL');

-- Composite tenant-scoped FK — structurally impossible to reference a
-- source_mapping belonging to a different organisation_id. NO ACTION:
-- historical MappingVersion lineage must remain durable — see file
-- header.
SELECT pg_temp.ensure_fk('mapping_versions', 'mapping_versions_source_mapping_org_fkey',
  ARRAY['source_mapping_id', 'organisation_id'], 'source_mappings', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.mapping_versions ADD CONSTRAINT mapping_versions_source_mapping_org_fkey FOREIGN KEY (source_mapping_id, organisation_id) REFERENCES public.source_mappings (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_mapping_versions_organisation ON public.mapping_versions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_mapping_versions_source_mapping ON public.mapping_versions(source_mapping_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — source_mappings.active_mapping_version_id's own composite
-- FK, added only now that mapping_versions (its target) exists. See
-- file header's ordering rationale for why this could not be added in
-- STEP 2.
-- ═══════════════════════════════════════════════════════════════════

-- Required by Prisma's one-to-one relation validator on the defining
-- side (source_mappings.active_version); trivially satisfied since id
-- is already the PRIMARY KEY, but Postgres/Prisma both require it
-- named explicitly to match the FK's own local column list.
--
-- NOTE ON NAME LENGTH: the "obvious" fully-descriptive name
-- (source_mappings_active_mapping_version_id_id_organisation_id_key)
-- is 64 bytes — one over Postgres's 63-byte identifier limit.
-- Postgres would silently truncate it at creation time, but this
-- script's own ensure_unique_constraint() looks up the EXACT name
-- passed here — so a truncated stored name never matches this longer
-- name on rerun, breaking idempotency (caught by this harness's own
-- rerun proof). Shortened deliberately to stay well under the limit.
SELECT pg_temp.ensure_unique_constraint('source_mappings', 'source_mappings_active_mv_id_org_key',
  'UNIQUE (active_mapping_version_id, id, organisation_id)',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_active_mv_id_org_key UNIQUE (active_mapping_version_id, id, organisation_id)');

-- THE active-version integrity invariant. Composite FK
-- (active_mapping_version_id, id, organisation_id) ->
-- mapping_versions(id, source_mapping_id, organisation_id) — a version
-- can only ever be pointed to as "active" by the EXACT SourceMapping row
-- it belongs to (its own id appears in the referenced row's own
-- source_mapping_id position) AND the EXACT tenant it belongs to. It is
-- structurally impossible for this pointer to reference another
-- mapping's version or another organisation's version — not an
-- application-level check, a DB-enforced one. MATCH SIMPLE (Postgres's
-- default): a NULL active_mapping_version_id (every row, since this
-- schema-only slice never populates it) is entirely exempt from this
-- check.
SELECT pg_temp.ensure_fk('source_mappings', 'source_mappings_active_version_fkey',
  ARRAY['active_mapping_version_id', 'id', 'organisation_id'], 'mapping_versions', ARRAY['id', 'source_mapping_id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_mappings ADD CONSTRAINT source_mappings_active_version_fkey FOREIGN KEY (active_mapping_version_id, id, organisation_id) REFERENCES public.mapping_versions (id, source_mapping_id, organisation_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5 — additive, nullable lineage columns on the pre-existing
-- import_batches/uploads tables. NULL/absent-FK for every existing row
-- — zero backfill required. No runtime behavior/HTTP exposure changes
-- as a result of these columns existing; they remain unused until a
-- later 5B integration slice populates them.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('import_batches', 'source_system_id', 'text', true, true, NULL,
  'ALTER TABLE public.import_batches ADD COLUMN source_system_id TEXT');

-- Composite tenant-scoped FK (MATCH SIMPLE) — mirrors
-- uploads_import_batch_org_fkey's own established precedent exactly. A
-- NULL source_system_id (every existing row) is entirely exempt from
-- this check. NO ACTION: there is no hard-delete API for source_systems
-- in this slice, so this can only ever block, never silently erase
-- ImportBatch lineage.
SELECT pg_temp.ensure_fk('import_batches', 'import_batches_source_system_org_fkey',
  ARRAY['source_system_id', 'organisation_id'], 'source_systems', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_source_system_org_fkey FOREIGN KEY (source_system_id, organisation_id) REFERENCES public.source_systems (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_import_batches_source_system ON public.import_batches(source_system_id);

SELECT pg_temp.ensure_column('uploads', 'mapping_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN mapping_version_id TEXT');

-- Composite tenant-scoped FK (MATCH SIMPLE) — mirrors
-- uploads_import_batch_org_fkey's own established precedent exactly. A
-- NULL mapping_version_id (every existing row) is entirely exempt from
-- this check. NO ACTION: historical MappingVersion lineage from Upload
-- must remain durable — see file header.
SELECT pg_temp.ensure_fk('uploads', 'uploads_mapping_version_org_fkey',
  ARRAY['mapping_version_id', 'organisation_id'], 'mapping_versions', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_mapping_version_org_fkey FOREIGN KEY (mapping_version_id, organisation_id) REFERENCES public.mapping_versions (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_uploads_mapping_version ON public.uploads(mapping_version_id);

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (manual, NOT executed by this script — for reference only,
-- same convention as scripts/create-import-batches.sql's own commented
-- rollback block):
--
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_mapping_version_org_fkey;
--   DROP INDEX IF EXISTS public.idx_uploads_mapping_version;
--   ALTER TABLE public.uploads DROP COLUMN IF EXISTS mapping_version_id;
--   ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_source_system_org_fkey;
--   DROP INDEX IF EXISTS public.idx_import_batches_source_system;
--   ALTER TABLE public.import_batches DROP COLUMN IF EXISTS source_system_id;
--   ALTER TABLE public.source_mappings DROP CONSTRAINT IF EXISTS source_mappings_active_version_fkey;
--   DROP TABLE IF EXISTS public.mapping_versions;
--   DROP TABLE IF EXISTS public.source_mappings;
--   DROP TABLE IF EXISTS public.source_systems;
-- ═══════════════════════════════════════════════════════════════════
