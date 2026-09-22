-- Data Hub 6.2B1 — reporting-period foundation. Additive only. NOT run
-- automatically by this task. NEVER run against Production or Neon
-- Preview by this task — verification is via a local disposable Postgres
-- container only.
--
-- ZERO UPDATE. ZERO DELETE. ZERO backfill/inference of any kind — no
-- statement in this file touches a single existing row's data. Every
-- statement below is ALTER TABLE ADD COLUMN / ADD CONSTRAINT (or their
-- ensure_*()-wrapped, idempotent equivalents) only.
--
-- Adds:
--   public.uploads.period_start   DATE, nullable
--   public.uploads.period_end     DATE, nullable
--   public.uploads.period_source  TEXT, nullable ("MANUAL" is the only
--     value any 6.2B1 runtime path can produce; deliberately a plain
--     column, not an enum, mirroring lineage_kind/domain_kind's own
--     established precedent — a future detection source must never
--     require an ALTER TYPE migration)
--   public.uploads_period_pair_check — CHECK constraint: both
--     period_start/period_end are NULL together, or both are non-NULL
--     together, and when both are non-NULL, period_start <= period_end.
--     Prisma cannot express this cross-column CHECK directly; this SQL
--     is the actual enforcement, the Prisma schema's own comment is
--     documentation only.
--   public.source_systems.reporting_period_required  BOOLEAN NOT NULL
--     DEFAULT false — every existing row becomes false on migration,
--     preserving existing confirmation behavior for every SourceSystem
--     configured before this slice. Enabling it for any specific
--     already-configured SourceSystem is a separate, explicit, later
--     Production configuration action — never performed by this
--     migration.
--
-- Repeatable AND fail-loud, by construction — same ensure/validate/RAISE
-- methodology as every other Data Hub migration script (see
-- scripts/create-datahub-reconciliation.sql and
-- scripts/create-illegal-dumping-abandoned-status.sql for the closest
-- precedent). The pg_temp.ensure_column/ensure_check helper functions
-- are copied verbatim from scripts/create-datahub-reconciliation.sql
-- rather than re-derived, so this script stays self-contained and
-- runnable standalone. No new helper is introduced.
--
-- No uniqueness constraint of any kind is added by this migration —
-- deliberately. A later Phase 6.2E replacement/versioning slice needs
-- multiple worksheets to legitimately share one identical
-- (period_start, period_end) pair for the same organisation+SourceSystem
-- (the original import plus N later replacements) — adding a uniqueness
-- rule now would need to be removed later, a strictly worse migration
-- sequence than never adding one until a real replacement-tracking
-- design exists to make a constraint meaningful.
--
-- No index is added by this migration either — no read/query path
-- introduced in this slice filters or sorts by period, so a
-- (organisation_id, period_start, period_end) index would be purely
-- speculative for logic that does not exist yet (Phase 6.2C's own
-- future duplicate-classification work). Add it in that later slice,
-- alongside the query that actually needs it.

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helpers (pg_temp schema) — copied
-- verbatim from scripts/create-datahub-reconciliation.sql. See that
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

-- ═══════════════════════════════════════════════════════════════════
-- public.uploads — three additive nullable columns + one pair/range CHECK
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('uploads', 'period_start', 'date', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN period_start DATE');
SELECT pg_temp.ensure_column('uploads', 'period_end', 'date', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN period_end DATE');
SELECT pg_temp.ensure_column('uploads', 'period_source', 'text', true, true, NULL,
  'ALTER TABLE public.uploads ADD COLUMN period_source TEXT');

SELECT pg_temp.ensure_check('uploads', 'uploads_period_pair_check',
  'CHECK ((((period_start IS NULL) AND (period_end IS NULL)) OR ((period_start IS NOT NULL) AND (period_end IS NOT NULL) AND (period_start <= period_end))))',
  'ALTER TABLE public.uploads ADD CONSTRAINT uploads_period_pair_check CHECK (
     (period_start IS NULL AND period_end IS NULL)
     OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= period_end)
   )');

-- ═══════════════════════════════════════════════════════════════════
-- public.source_systems — one additive, NOT NULL DEFAULT false policy flag
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_column('source_systems', 'reporting_period_required', 'boolean', false, true, 'false',
  'ALTER TABLE public.source_systems ADD COLUMN reporting_period_required BOOLEAN NOT NULL DEFAULT false');

-- ═══════════════════════════════════════════════════════════════════
-- Rollback (manual, NOT executed by this script — for reference only,
-- same convention as every other Data Hub migration script's own
-- commented rollback block). Safe only if confirmed zero rows have used
-- these columns for anything meaningful yet:
--
--   ALTER TABLE public.uploads DROP CONSTRAINT IF EXISTS uploads_period_pair_check;
--   ALTER TABLE public.uploads DROP COLUMN IF EXISTS period_start;
--   ALTER TABLE public.uploads DROP COLUMN IF EXISTS period_end;
--   ALTER TABLE public.uploads DROP COLUMN IF EXISTS period_source;
--   ALTER TABLE public.source_systems DROP COLUMN IF EXISTS reporting_period_required;
-- ═══════════════════════════════════════════════════════════════════
