-- Scheduling Phase 2B.0 — dedicated INTERNAL TEST organisation, step 1 of 2: CREATE (one row).
--
-- STATUS: DEFINED, NOT RUN ANYWHERE. This is not a numbered migration and no tool, test or deployment runs it.
-- The owner runs it by hand in the Neon SQL Editor, only after a separate, explicit approval, on a Preview branch
-- first. Production creation is a data change and needs its own approval and a backup branch.
--
-- WHY: Phase 2B's first organisation is a dedicated internal test organisation (approved decision 1): not BrainBase
--   HQ, not a customer, not LD Tennis. It exists so the workflow can be exercised without a real customer's data.
--
-- WHAT: inserts exactly ONE row into organisations. Identity, so it can never be mistaken for a customer:
--     name  'ZZ Scheduling Internal Test (no customer data)'
--     slug  'zz-scheduling-internal-test'
--   plan, status, settings and timezone take the column defaults (TRIAL, ACTIVE, '{}', NULL = platform fallback
--   Australia/Adelaide), exactly as app/api/admin/orgs/route.ts creates an organisation. No user, no stripe_*
--   value, no CRM contact, no module entitlement is created. The id is a random UUID as text, as the admin route does.
--
-- NOT HERE: the Scheduling capability (internal-test-org-2-enable-capability.sql, a separate approval) and any staff
--   account (which internal users belong to it, with which roles, is still an open decision).
--
-- IDEMPOTENT: ON CONFLICT (slug) DO NOTHING; a second run creates nothing. The guard below aborts (and rolls back)
--   unless exactly zero or one such organisation exists afterwards.
--
-- REMOVAL: internal-test-org-9-remove.sql refuses while any scheduling, CRM or user row belongs to it.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO organisations (id, name, slug, updated_at)
VALUES (gen_random_uuid()::text, 'ZZ Scheduling Internal Test (no customer data)', 'zz-scheduling-internal-test', now())
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM organisations WHERE slug = 'zz-scheduling-internal-test';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one internal test organisation, found %', n;
  END IF;
END $$;

SELECT id, name, slug, plan, status FROM organisations WHERE slug = 'zz-scheduling-internal-test';

COMMIT;
