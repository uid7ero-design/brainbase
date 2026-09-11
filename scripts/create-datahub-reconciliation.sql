-- Data Hub 6.1A — Reconciliation persistence FOUNDATION only.
-- Run once against the target database. NOT run automatically by this
-- task. NEVER run against Production or Neon Preview by this task —
-- verification is via a local disposable Postgres container only (see
-- tests/postgres-proof/reconciliationSchema.postgres-proof.test.ts).
--
-- ZERO RUNTIME BEHAVIOR CHANGE. This script creates additive persistence
-- storage only — no application code path reads or writes any of the
-- structures below in this slice. The 6.0C1 first-import guard
-- (lib/data-hub/importBatch/confirmWorksheet.ts) remains the sole
-- runtime authority blocking a second governed Illegal Dumping import
-- until a LATER, separately-authorized slice (6.1B+) actually wires
-- reconciliation in. See prisma/schema.prisma's own doc comments on
-- SourceRecordIdentity/SourceRecordObservation for the full architecture
-- rationale (Phase 6.1 discovery + this 6.1A slice's own design
-- decisions).
--
-- Repeatable AND fail-loud, by construction — identical methodology to
-- scripts/create-datahub-source-mappings.sql (5B.1): every column/CHECK/
-- unique constraint/unique index/foreign key below is handled by a
-- single pg_temp.ensure_*() call that either creates the exact expected
-- object (if genuinely absent) or validates the exact expected
-- definition (if already present, RAISing if it differs). The
-- pg_temp.ensure_*() helper functions are copied verbatim from that
-- script (which itself copied them verbatim from
-- scripts/create-import-batches.sql) rather than re-derived, so this
-- script stays self-contained and runnable standalone. One NEW helper,
-- pg_temp.ensure_enum_type, is added below (this is the first Data Hub
-- script to introduce a new enum type) — same ensure/validate/RAISE
-- shape as every other helper here, no new pattern invented.
--
-- Creates:
--   public.source_record_identities — durable source-owned business
--     record identity (e.g. one Onkaparinga Illegal Dumping "Ticket #")
--     within one tenant-owned SourceSystem. NOT a domain row, NOT a
--     worksheet/Upload, NOT an ImportBatch, NOT a MappingVersion, NOT a
--     file/SHA identity — none of those participate in this table's own
--     uniqueness (Phase 6.1 discovery, sections K/S/T).
--   public.source_record_observations — immutable append-only
--     observation history, one row per (source identity, worksheet
--     Confirm) pair. Persisted outcome enum
--     (source_record_observation_outcome) is DELIBERATELY the truthful
--     NEW/UNCHANGED/CHANGED subset only — see the enum's own comment
--     below for why INVALID/CONFLICT are excluded.
-- Adds (both additive, nullable except where noted, zero backfill):
--   public.uploads.<new @@unique(id, organisation_id)> — required by
--     source_record_observations' own composite tenant-scoped FK below;
--     Upload previously had no such constraint (unlike SourceSystem/
--     ImportBatch/MappingVersion, which all already did) — a genuinely
--     new addition, not a pre-existing pattern being repeated. Purely
--     additive (a second unique index alongside the existing PK id),
--     zero behavior change, zero data risk.
--   public.illegal_dumping.source_record_identity_id -> source_record_identities
--
-- ARCHITECTURE — ordering:
--   1. CREATE source_record_identities (depends only on organisations,
--      source_systems — both already exist from 5B.1).
--   2. Add uploads' new (id, organisation_id) unique constraint (no
--      dependency on source_record_identities; could run first or here
--      — placed here so every "required by X's FK" comment below reads
--      in the same top-to-bottom order the FKs themselves are declared).
--   3. CREATE source_record_observations (depends on
--      source_record_identities, import_batches, uploads,
--      mapping_versions — all now exist).
--   4. Add illegal_dumping.source_record_identity_id (depends on
--      source_record_identities).
--
-- ON DELETE policy (mirrors scripts/create-datahub-source-mappings.sql's
-- own established rule exactly):
--   organisation_id FKs on both new tables: NO ACTION — matches
--     source_systems.organisation_id's own precedent (a synchronous
--     CASCADE on organisation deletion must not silently erase
--     reconciliation history; deletion of an organisation with attached
--     identity/observation rows must fail loudly, not cascade away).
--   source_record_identities -> source_systems,
--   source_record_observations -> source_record_identities/
--     import_batches/uploads/mapping_versions,
--   illegal_dumping.source_record_identity_id -> source_record_identities:
--     all NO ACTION. There is no hard-delete API for SourceSystem/
--     ImportBatch/Upload/MappingVersion/SourceRecordIdentity in this (or
--     any prior) slice — NO ACTION is the strictest available choice
--     and guarantees no cascade can ever silently erase historical
--     reconciliation audit history, matching this slice's own explicit
--     "restrictive historical preservation" requirement.
--   Neither new table has a created_by/actor column in this slice (the
--     spec's own minimum-fields list omits one) — so there is no
--     SET NULL-style actor FK to declare here, unlike source_systems/
--     source_mappings/mapping_versions' own created_by precedent.
--
-- Column/id convention: TEXT ids with NO database-side default —
-- matches every other Data Hub table's own convention (Prisma Client
-- supplies cuid() application-side).
--
-- Every DDL target and catalog lookup is schema-qualified as
-- public.<table> — this migration never relies on search_path.
--
-- ZERO UPDATE. ZERO DELETE. ZERO backfill/inference of any kind — no
-- statement in this file touches a single existing row's data. Every
-- statement below is CREATE TABLE / ALTER TABLE ADD COLUMN / ADD
-- CONSTRAINT / CREATE INDEX / CREATE TYPE (or their ensure_*-wrapped,
-- idempotent equivalents) only.
--
-- Repeatable behavioral validation:
-- tests/postgres-proof/reconciliationSchema.postgres-proof.test.ts runs
-- this script (and reruns it, proving idempotency) against a disposable,
-- self-cleaning Docker postgres:16-alpine container, then exercises real
-- Postgres constraint enforcement (tenant-isolation FK proofs, identity
-- uniqueness proofs, one-current-domain-row-per-identity proof, existing
-- IllegalDumping/legacy-writer compatibility). No Neon/Production
-- access, no local psql client required beyond Docker.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helpers (pg_temp schema) — copied
-- verbatim from scripts/create-datahub-source-mappings.sql. See that
-- file's own header for the full rationale; not re-derived here to keep
-- this script standalone/self-contained.
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

-- NEW helper (not present in any prior Data Hub script — this is the
-- first one to introduce a new enum type). Same ensure/validate/RAISE
-- shape as every helper above: create if absent, RAISE if the existing
-- type's own label set differs from what's expected.
CREATE OR REPLACE FUNCTION pg_temp.ensure_enum_type(
  p_type_name text, p_expected_labels text[], p_create_sql text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  actual_labels text[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO actual_labels
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typname = p_type_name;

  IF actual_labels IS NULL THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  IF actual_labels IS DISTINCT FROM p_expected_labels THEN
    RAISE EXCEPTION 'Migration drift: public.% enum labels are % but % was expected',
      p_type_name, actual_labels, p_expected_labels;
  END IF;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — public.source_record_identities
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.source_record_identities ();

SELECT pg_temp.ensure_column('source_record_identities', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_identities ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_identities', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_identities ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_identities', 'source_system_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_identities ADD COLUMN source_system_id TEXT NOT NULL');
-- Deliberately TEXT, not an enum — mirrors uploads.lineage_kind's own
-- established precedent exactly (also a discriminator expected to grow
-- over time as new domains are onboarded); an enum here would require an
-- ALTER TYPE ... ADD VALUE migration every time. 'ILLEGAL_DUMPING' is the
-- only value any current runtime path can ever produce (none does yet).
SELECT pg_temp.ensure_column('source_record_identities', 'domain_kind', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_identities ADD COLUMN domain_kind TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_identities', 'source_external_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_identities ADD COLUMN source_external_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_identities', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_record_identities ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
SELECT pg_temp.ensure_column('source_record_identities', 'updated_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_record_identities ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_record_identities', ARRAY['id'],
  'ALTER TABLE public.source_record_identities ADD PRIMARY KEY (id)');

-- Required by illegal_dumping's and source_record_observations'
-- composite tenant-scoped FKs.
SELECT pg_temp.ensure_unique_constraint('source_record_identities', 'source_record_identities_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.source_record_identities ADD CONSTRAINT source_record_identities_id_organisation_id_key UNIQUE (id, organisation_id)');

-- THE identity invariant (Phase 6.1 discovery, section K) — a Ticket #
-- may legitimately recur across different SourceSystems, different
-- organisations, or (if a future second domain onboards through the same
-- SourceSystem) different domain_kind values; only the exact 4-tuple
-- below is a genuine duplicate.
SELECT pg_temp.ensure_unique_constraint('source_record_identities', 'source_record_identities_org_source_domain_external_key',
  'UNIQUE (organisation_id, source_system_id, domain_kind, source_external_id)',
  'ALTER TABLE public.source_record_identities ADD CONSTRAINT source_record_identities_org_source_domain_external_key UNIQUE (organisation_id, source_system_id, domain_kind, source_external_id)');

-- Bounded, non-empty external identity value — never a raw payload, never
-- unbounded. 255 is a generous, non-arbitrary bound matching this
-- schema's own established convention for bounded identifier-shaped text
-- fields (e.g. source_systems.name has no explicit CHECK but is used as
-- a human-facing name; this is a stricter, narrower external-ID value).
SELECT pg_temp.ensure_check('source_record_identities', 'source_record_identities_external_id_bounded_check',
  'CHECK (((length(source_external_id) >= 1) AND (length(source_external_id) <= 255)))',
  'ALTER TABLE public.source_record_identities ADD CONSTRAINT source_record_identities_external_id_bounded_check CHECK (length(source_external_id) >= 1 AND length(source_external_id) <= 255)');

SELECT pg_temp.ensure_fk('source_record_identities', 'source_record_identities_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_record_identities ADD CONSTRAINT source_record_identities_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

-- Composite tenant-scoped FK — structurally impossible to reference a
-- source_system belonging to a different organisation_id. NO ACTION:
-- there is no hard-delete API for source_systems, so this can only ever
-- block, never silently erase reconciliation identity history.
SELECT pg_temp.ensure_fk('source_record_identities', 'source_record_identities_source_system_org_fkey',
  ARRAY['source_system_id', 'organisation_id'], 'source_systems', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_record_identities ADD CONSTRAINT source_record_identities_source_system_org_fkey FOREIGN KEY (source_system_id, organisation_id) REFERENCES public.source_systems (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_source_record_identities_org_source ON public.source_record_identities(organisation_id, source_system_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — public.uploads: new (id, organisation_id) unique constraint,
-- required by source_record_observations' own composite tenant-scoped
-- FK below (STEP 3). Purely additive — a second unique index alongside
-- the existing PK, zero behavior/data change to any existing row.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_unique_constraint('uploads', 'uploads_id_organisation_id_key',
  'UNIQUE (id, organisation_id)',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_id_organisation_id_key UNIQUE (id, organisation_id)');

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3 — public.source_record_observations (safe to create now that
-- source_record_identities and uploads' new unique constraint both
-- exist; import_batches/mapping_versions already exist from 5B.1).
-- ═══════════════════════════════════════════════════════════════════

-- Truthful PERSISTED outcome vocabulary only — deliberately narrower
-- than the full NEW/UNCHANGED/CHANGED/INVALID/CONFLICT PLANNER
-- vocabulary a future reconciliation service will compute in application
-- code (Phase 6.1 discovery, section AA/U/V; this 6.1A slice's own
-- design decision, section O of its final report). Under the existing,
-- unchanged all-or-nothing Confirm architecture, an INVALID row fails
-- the entire mapper call before any transaction ever opens, and a
-- CONFLICT is designed to fail the whole worksheet the same way —
-- neither can ever reach a committed write, so encoding them here would
-- be an impossible, never-actually-persisted state.
SELECT pg_temp.ensure_enum_type('source_record_observation_outcome',
  ARRAY['NEW', 'UNCHANGED', 'CHANGED'],
  $sql$CREATE TYPE public.source_record_observation_outcome AS ENUM ('NEW', 'UNCHANGED', 'CHANGED')$sql$);

CREATE TABLE IF NOT EXISTS public.source_record_observations ();

SELECT pg_temp.ensure_column('source_record_observations', 'id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_observations', 'organisation_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN organisation_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_observations', 'source_record_identity_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN source_record_identity_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_observations', 'import_batch_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN import_batch_id TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_observations', 'upload_id', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN upload_id TEXT NOT NULL');
-- Nullable — mirrors uploads.mapping_version_id's own established
-- nullable precedent exactly: not every worksheet is mapped.
SELECT pg_temp.ensure_column('source_record_observations', 'mapping_version_id', 'text', true, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN mapping_version_id TEXT');
SELECT pg_temp.ensure_column('source_record_observations', 'observed_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_record_observations ADD COLUMN observed_at TIMESTAMPTZ NOT NULL DEFAULT now()');
-- Bounded to exactly a SHA-256 hex digest (64 lowercase hex characters).
-- No hashing algorithm/canonical-field policy is implemented in this
-- slice; this column only creates storage for a future slice's output.
SELECT pg_temp.ensure_column('source_record_observations', 'canonical_hash', 'text', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN canonical_hash TEXT NOT NULL');
SELECT pg_temp.ensure_column('source_record_observations', 'hash_version', 'integer', false, true, '1',
  'ALTER TABLE public.source_record_observations ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1');
SELECT pg_temp.ensure_column('source_record_observations', 'outcome', 'USER-DEFINED', false, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN outcome public.source_record_observation_outcome NOT NULL');
-- Narrow, bounded, future-application-validated snapshot of ONLY the
-- (not-yet-decided) source-owned canonical field values relevant to a
-- CHANGED outcome — never a raw source row, never Notes, never any other
-- customer PII. Nullable/deferred: no runtime path writes any value in
-- this slice.
SELECT pg_temp.ensure_column('source_record_observations', 'change_summary', 'jsonb', true, true, NULL,
  'ALTER TABLE public.source_record_observations ADD COLUMN change_summary JSONB');
SELECT pg_temp.ensure_column('source_record_observations', 'created_at', 'timestamp with time zone', false, true, 'now()',
  'ALTER TABLE public.source_record_observations ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');

SELECT pg_temp.ensure_primary_key('source_record_observations', ARRAY['id'],
  'ALTER TABLE public.source_record_observations ADD PRIMARY KEY (id)');

SELECT pg_temp.ensure_check('source_record_observations', 'source_record_observations_hash_bounded_check',
  'CHECK ((canonical_hash ~ ''^[0-9a-f]{64}$''::text))',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_hash_bounded_check CHECK (canonical_hash ~ ''^[0-9a-f]{64}$'')');

SELECT pg_temp.ensure_fk('source_record_observations', 'source_record_observations_organisation_id_fkey',
  ARRAY['organisation_id'], 'organisations', ARRAY['id'], 'a', 'a',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations (id)');

-- Composite tenant-scoped FK — structurally impossible to reference a
-- source_record_identity belonging to a different organisation_id.
-- NO ACTION: append-only observation history must never be silently
-- erased by a cascade.
SELECT pg_temp.ensure_fk('source_record_observations', 'source_record_observations_identity_org_fkey',
  ARRAY['source_record_identity_id', 'organisation_id'], 'source_record_identities', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_identity_org_fkey FOREIGN KEY (source_record_identity_id, organisation_id) REFERENCES public.source_record_identities (id, organisation_id)');

-- Composite tenant-scoped FK — mirrors uploads.import_batch's own
-- established precedent exactly.
SELECT pg_temp.ensure_fk('source_record_observations', 'source_record_observations_import_batch_org_fkey',
  ARRAY['import_batch_id', 'organisation_id'], 'import_batches', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_import_batch_org_fkey FOREIGN KEY (import_batch_id, organisation_id) REFERENCES public.import_batches (id, organisation_id)');

-- Composite tenant-scoped FK — newly enabled by uploads' new (id,
-- organisation_id) unique constraint added in STEP 2, specifically so
-- this relationship is structurally tenant-safe rather than a bare FK.
SELECT pg_temp.ensure_fk('source_record_observations', 'source_record_observations_upload_org_fkey',
  ARRAY['upload_id', 'organisation_id'], 'uploads', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_upload_org_fkey FOREIGN KEY (upload_id, organisation_id) REFERENCES public.uploads (id, organisation_id)');

-- Composite tenant-scoped FK (MATCH SIMPLE) — mirrors
-- uploads.mapping_version's own established precedent exactly. A NULL
-- mapping_version_id (an unmapped worksheet) is entirely exempt from
-- this check.
SELECT pg_temp.ensure_fk('source_record_observations', 'source_record_observations_mapping_version_org_fkey',
  ARRAY['mapping_version_id', 'organisation_id'], 'mapping_versions', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.source_record_observations ADD CONSTRAINT source_record_observations_mapping_version_org_fkey FOREIGN KEY (mapping_version_id, organisation_id) REFERENCES public.mapping_versions (id, organisation_id)');

CREATE INDEX IF NOT EXISTS idx_source_record_observations_org_identity ON public.source_record_observations(organisation_id, source_record_identity_id);
CREATE INDEX IF NOT EXISTS idx_source_record_observations_upload ON public.source_record_observations(upload_id);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4 — additive, nullable reconciliation-identity link column on the
-- pre-existing illegal_dumping table. NULL for every existing row and
-- every row written by the separate, unhardened legacy /data writer
-- (modules/dumping/index.ts, untouched by this slice) — zero backfill,
-- zero inference. No runtime behavior/HTTP exposure changes as a result
-- of this column existing; it remains unused until a later,
-- separately-authorized 6.1 integration slice populates it.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('illegal_dumping', 'source_record_identity_id', 'text', true, true, NULL,
  'ALTER TABLE public.illegal_dumping ADD COLUMN source_record_identity_id TEXT');

-- Enforces "at most one current IllegalDumping projection per source
-- identity" — a NULL source_record_identity_id (every existing/legacy
-- row) is exempt from Postgres's own standard UNIQUE-index NULL
-- semantics (every NULL is distinct), so all NULL rows coexist freely;
-- only a genuine duplicate non-NULL identity link is ever rejected.
SELECT pg_temp.ensure_unique_index('illegal_dumping', 'illegal_dumping_source_record_identity_id_key',
  ARRAY['source_record_identity_id'],
  'CREATE UNIQUE INDEX illegal_dumping_source_record_identity_id_key ON public.illegal_dumping(source_record_identity_id)');

-- Composite tenant-scoped FK (MATCH SIMPLE) — mirrors
-- import_batches.source_system's own established precedent exactly. A
-- NULL source_record_identity_id (every existing/legacy row) is entirely
-- exempt from this check. NO ACTION: there is no hard-delete API for
-- source_record_identities, so this can only ever block, never silently
-- erase IllegalDumping lineage.
SELECT pg_temp.ensure_fk('illegal_dumping', 'illegal_dumping_source_record_identity_org_fkey',
  ARRAY['source_record_identity_id', 'organisation_id'], 'source_record_identities', ARRAY['id', 'organisation_id'], 'a', 'a',
  'ALTER TABLE public.illegal_dumping ADD CONSTRAINT illegal_dumping_source_record_identity_org_fkey FOREIGN KEY (source_record_identity_id, organisation_id) REFERENCES public.source_record_identities (id, organisation_id)');

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (manual, NOT executed by this script — for reference only,
-- same convention as scripts/create-datahub-source-mappings.sql's own
-- commented rollback block). Safe only if confirmed zero reconciliation
-- runs have occurred yet (no real observation/identity data exists to
-- lose):
--
--   ALTER TABLE public.illegal_dumping DROP CONSTRAINT IF EXISTS illegal_dumping_source_record_identity_org_fkey;
--   DROP INDEX IF EXISTS public.illegal_dumping_source_record_identity_id_key;
--   ALTER TABLE public.illegal_dumping DROP COLUMN IF EXISTS source_record_identity_id;
--   DROP TABLE IF EXISTS public.source_record_observations;
--   DROP TYPE IF EXISTS public.source_record_observation_outcome;
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_id_organisation_id_key;
--   DROP TABLE IF EXISTS public.source_record_identities;
-- ═══════════════════════════════════════════════════════════════════
