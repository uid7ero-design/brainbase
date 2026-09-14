-- Data Hub 6.1C2 — add the ABANDONED value to the existing "IncidentStatus"
-- Postgres enum. Additive only. NOT run automatically by this task.
--
-- ZERO backfill, ZERO UPDATE, ZERO DELETE, ZERO DROP. This script only ever
-- adds a new label to an already-existing enum type — no existing
-- illegal_dumping row is touched, no other enum/table/column/constraint is
-- affected. Approved product decision (6.1C2): ABANDONED is terminal,
-- non-resolved, non-open, non-in-progress — never CLOSED (whose only real
-- runtime meaning, app/api/illegal-dumping/kpi/route.ts's resolved-count
-- KPI, treats CLOSED as synonymous with "resolved") and never RESOLVED (the
-- record was explicitly NOT resolved). See
-- lib/data-hub/importBatch/illegalDumpingMapper.ts's KNOWN_STATUS_MAP
-- header comment for the full investigation.
--
-- Repeatable AND fail-loud, by construction — same ensure/validate/RAISE
-- methodology as every other Data Hub migration script (see
-- scripts/create-datahub-reconciliation.sql's own pg_temp.ensure_enum_type
-- for the closest precedent, which creates a brand-new enum TYPE; this
-- script instead adds one VALUE to an EXISTING type, so it uses a new,
-- narrower helper, pg_temp.ensure_enum_value, rather than reusing
-- ensure_enum_type unmodified).
--
-- POSTGRES TRANSACTION CAVEAT — read before ever using ABANDONED in the
-- same script/transaction as this migration: a value added via
-- ALTER TYPE ... ADD VALUE cannot be referenced (compared, cast to, used as
-- a literal) in the SAME transaction that added it, even on modern
-- Postgres. This script only ever ADDS the label — it never reads,
-- compares, or writes a row using 'ABANDONED' — so this restriction has
-- zero practical effect here. Do not add backfill/usage logic to this
-- script later without accounting for that restriction (run it as a
-- genuinely separate, subsequent statement/transaction instead).
--
-- Column/id convention: no existing column type changes — illegal_dumping.
-- status remains "IncidentStatus" NOT NULL DEFAULT 'OPEN', unchanged.
--
-- Rollback: PostgreSQL has no `ALTER TYPE ... DROP VALUE`. A value, once
-- added, cannot be trivially removed — the only way to remove it is to
-- recreate the entire enum type (rename old type, create new type with the
-- desired labels, alter every column using it to the new type, drop the
-- old type), which is a destructive, high-risk operation this script
-- deliberately does NOT attempt automatically. If ABANDONED must ever be
-- removed, that requires its own separately authorized recovery procedure,
-- executed only after confirming zero rows reference it. No backfill is
-- required for THIS migration itself (additive only, nothing to reverse
-- on a plain code rollback — see the 6.1C2 implementation report).

-- ═══════════════════════════════════════════════════════════════════
-- Session-scoped validation/repair helper (pg_temp schema) — new for this
-- script (adding a value to an EXISTING enum type has no prior helper in
-- this codebase; ensure_enum_type only covers creating a brand-new type).
-- Same ensure/validate/RAISE shape as every other helper in this codebase:
-- create if absent, RAISE if something unexpected is found, no-op if
-- already exactly as expected.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.ensure_enum_value(
  p_type_name text, p_label text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  type_exists boolean;
  label_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = p_type_name
  ) INTO type_exists;

  IF NOT type_exists THEN
    RAISE EXCEPTION 'Migration drift: enum type public.% does not exist — cannot add value %',
      p_type_name, p_label;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typname = p_type_name AND e.enumlabel = p_label
  ) INTO label_exists;

  IF NOT label_exists THEN
    -- EXECUTE (dynamic SQL), not a literal ALTER TYPE statement, so the
    -- type/label names can be safely parameterized via format(%I/%L) —
    -- matches this codebase's own established EXECUTE-for-DDL convention
    -- (see every other ensure_*() helper in this repo).
    EXECUTE format('ALTER TYPE public.%I ADD VALUE %L', p_type_name, p_label);
  END IF;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════
-- The single, additive change this script makes.
-- ═══════════════════════════════════════════════════════════════════

SELECT pg_temp.ensure_enum_value('IncidentStatus', 'ABANDONED');

-- ═══════════════════════════════════════════════════════════════════
-- Reference only — NOT executed by this script. Read-only precheck to run
-- BEFORE this migration (Neon SQL Editor, manual, separately authorized):
--
--   SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
--   FROM pg_type t
--   JOIN pg_namespace n ON n.oid = t.typnamespace
--   JOIN pg_enum e ON e.enumtypid = t.oid
--   WHERE n.nspname = 'public' AND t.typname = 'IncidentStatus'
--   GROUP BY t.typname;
--   -- Expected BEFORE: {OPEN,IN_PROGRESS,RESOLVED,CLOSED} — exactly 4
--   -- labels, ABANDONED absent.
--
-- Read-only postcheck to run AFTER this migration:
--
--   SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
--   FROM pg_type t
--   JOIN pg_namespace n ON n.oid = t.typnamespace
--   JOIN pg_enum e ON e.enumtypid = t.oid
--   WHERE n.nspname = 'public' AND t.typname = 'IncidentStatus'
--   GROUP BY t.typname;
--   -- Expected AFTER: {OPEN,IN_PROGRESS,RESOLVED,CLOSED,ABANDONED} —
--   -- exactly 5 labels, the original 4 unchanged, ABANDONED present.
--
-- Manual, destructive, NOT executed by this script — recreating the enum
-- type without ABANDONED (only if ever separately authorized, and only
-- after confirming zero illegal_dumping rows reference it):
--   -- 1. Confirm zero references:
--   --    SELECT COUNT(*) FROM illegal_dumping WHERE status = 'ABANDONED';
--   --    (must be 0 before proceeding)
--   -- 2. ALTER TYPE "IncidentStatus" RENAME TO "IncidentStatus_old";
--   -- 3. CREATE TYPE "IncidentStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CLOSED');
--   -- 4. ALTER TABLE illegal_dumping ALTER COLUMN status TYPE "IncidentStatus"
--   --      USING status::text::"IncidentStatus";
--   -- 5. DROP TYPE "IncidentStatus_old";
-- ═══════════════════════════════════════════════════════════════════
