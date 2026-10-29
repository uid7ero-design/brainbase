-- BrainBase A0.1A — organiser_items tenant-scoped uniqueness (repo reconciliation)
-- ===============================================================================
--
-- Ensures organiser_items has a uniqueness guarantee on (organisation_id, id),
-- the target that same-organisation composite foreign keys reference
-- (assurance_action_tasks, organiser_item_external_links, ...).
--
-- WHY THIS FILE EXISTS (Essio B1): Production already has
--   CONSTRAINT organiser_items_organisation_id_id_key UNIQUE (organisation_id, id)
-- (verified read-only against the Production branch during Essio B0), and
-- assurance_action_tasks_organiser_item_org_fkey already references it. The
-- repository never contained the step that created it — A0.1B/A0.1C only
-- check for it as a preflight post-condition, and the test harnesses add it
-- ad hoc. This file is that missing step, so a database built from the repo
-- reproduces Production.
--
-- Behaviour:
--   * If ANY equivalent uniqueness guarantee already exists, this is a no-op.
--     Equivalent = a valid, immediate (non-deferrable), non-partial,
--     expression-free unique index (constraint-backed or not) whose key
--     columns are exactly {organisation_id, id} in any order — i.e. anything
--     PostgreSQL itself accepts as the target of
--     FOREIGN KEY (...) REFERENCES organiser_items(organisation_id, id).
--     Production's existing constraint is never dropped, recreated or renamed.
--   * Otherwise it adds CONSTRAINT organiser_items_organisation_id_id_key
--     UNIQUE (organisation_id, id), preserving the Production name.
--   * It never modifies data. If existing rows would violate the constraint,
--     or the name is already taken by a non-equivalent object, it fails with
--     a clear error and changes nothing.
--
-- Safe to run against Production later (no-op there) and safe to rerun.
-- Not applied to any environment by this branch.

BEGIN;

DO $$
DECLARE
  equivalent_name TEXT;
  duplicate_pairs BIGINT;
  name_taken      BOOLEAN;
BEGIN
  IF to_regclass('public.organiser_items') IS NULL THEN
    RAISE EXCEPTION 'A0.1A failed: public.organiser_items is missing';
  END IF;

  SELECT i.relname
    INTO equivalent_name
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid AND c.conrelid = ix.indrelid
  WHERE ix.indrelid = 'public.organiser_items'::regclass
    AND ix.indisunique
    AND ix.indisvalid
    AND ix.indimmediate
    AND ix.indpred IS NULL
    AND ix.indexprs IS NULL
    AND ix.indnkeyatts = 2
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
      WHERE k.ord <= ix.indnkeyatts
    ) = ARRAY['id', 'organisation_id']
    AND (c.oid IS NULL OR NOT c.condeferrable)
  ORDER BY (i.relname = 'organiser_items_organisation_id_id_key') DESC, i.relname
  LIMIT 1;

  IF equivalent_name IS NOT NULL THEN
    RAISE NOTICE 'A0.1A: equivalent uniqueness on organiser_items(organisation_id, id) already exists (%); nothing to do',
      equivalent_name;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'organiser_items_organisation_id_id_key'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organiser_items'::regclass
      AND conname = 'organiser_items_organisation_id_id_key'
  )
    INTO name_taken;

  IF name_taken THEN
    RAISE EXCEPTION
      'A0.1A failed: the name organiser_items_organisation_id_id_key is already used by an object that is not an equivalent UNIQUE (organisation_id, id); resolve manually';
  END IF;

  SELECT count(*)
    INTO duplicate_pairs
  FROM (
    SELECT 1
    FROM public.organiser_items
    GROUP BY organisation_id, id
    HAVING count(*) > 1
  ) d;

  IF duplicate_pairs > 0 THEN
    RAISE EXCEPTION
      'A0.1A failed: % duplicate (organisation_id, id) pair(s) in organiser_items; data was not modified — resolve manually before applying',
      duplicate_pairs;
  END IF;

  ALTER TABLE public.organiser_items
    ADD CONSTRAINT organiser_items_organisation_id_id_key UNIQUE (organisation_id, id);

  RAISE NOTICE 'A0.1A: added organiser_items_organisation_id_id_key UNIQUE (organisation_id, id)';
END $$;

-- Post-condition (read only): an equivalent uniqueness guarantee now exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index ix
    WHERE ix.indrelid = 'public.organiser_items'::regclass
      AND ix.indisunique AND ix.indisvalid AND ix.indimmediate
      AND ix.indpred IS NULL AND ix.indexprs IS NULL AND ix.indnkeyatts = 2
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
        WHERE k.ord <= ix.indnkeyatts
      ) = ARRAY['id', 'organisation_id']
  ) THEN
    RAISE EXCEPTION 'A0.1A post-condition failed: no uniqueness guarantee on organiser_items(organisation_id, id)';
  END IF;
END $$;

COMMIT;
