-- Run once against the production database.
-- Additive only: adds a single nullable column plus a supporting index.
-- Safe to run with existing data, safe to re-run (IF NOT EXISTS). Does not
-- drop, rename, or change the type of any existing column, and performs no
-- backfill — every existing session row gets archived_at = NULL
-- automatically (a bare ADD COLUMN with no DEFAULT), meaning every session
-- that exists today keeps reconciling exactly as it does today.
--
-- NULL = active (reconciles future dates as normal).
-- Non-NULL = archived (excluded from org-wide reconciliation; future-only,
-- non-protected instances were cancelled at archive time; historical
-- instances/bookings/attendance are never touched by archiving and remain
-- fully readable regardless of this column's value).
--
-- See lib/tennisSchedule.ts (reconcileAllSessionsForOrg,
-- cancelFutureInstancesForArchive) and
-- app/api/dashboard/sessions/[id]/{archive,restore}/route.ts for the
-- application-layer behaviour this column drives.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Supports "org-scoped active/archived" queries — the org-wide reconcile
-- filter (organisation_id = ? AND archived_at IS NULL) and the Manage
-- Sessions default/"Show archived" toggle both filter on this exact pair.
CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions (organisation_id, archived_at);

-- Rollback (not run automatically — keep for reference if this needs to be reverted):
--   DROP INDEX IF EXISTS idx_sessions_archived_at;
--   ALTER TABLE sessions DROP COLUMN IF EXISTS archived_at;
