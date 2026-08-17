-- Run once against the production database.
-- Additive only: safe to run with existing data, safe to re-run (all
-- statements are IF NOT EXISTS / idempotent).
--
-- Adds a stable per-player "recurring lineage" identifier to bookings
-- (replacing the previous name/email-only matching used by the recurring
-- propagation logic) and a small table for pausing that lineage over a
-- bounded date range without destroying the recurring relationship.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurring_group_id text;

CREATE INDEX IF NOT EXISTS idx_bookings_recurring_group_id
  ON bookings (recurring_group_id);

-- Prevents two propagated/backfilled bookings for the same recurring
-- lineage from ever landing on the same session instance, even under
-- concurrent requests — mirrors the existing
-- session_instances (session_id, date) unique-index + ON CONFLICT pattern
-- already used by generate-instances.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bookings_instance_recurring_group
  ON bookings (session_instance_id, recurring_group_id)
  WHERE status != 'cancelled' AND recurring_group_id IS NOT NULL;

-- session_id is included (not just recurring_group_id) so a future,
-- separately-scoped class-wide pause (recurring_group_id IS NULL, applies
-- to every recurring player in the session) can reuse this same table
-- without a schema change — NOT implemented/read by any route yet, only
-- the column exists for forward compatibility. Every route in this change
-- set always writes and queries recurring_group_id IS NOT NULL (player-scoped).
CREATE TABLE IF NOT EXISTS booking_recurrence_pauses (
  id                 text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  organisation_id    text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  recurring_group_id text,
  session_id         text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pause_from         date NOT NULL,
  pause_until        date NOT NULL,
  reason             text,
  created_by         text,
  created_at         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT booking_recurrence_pauses_range_check CHECK (pause_until >= pause_from)
);

CREATE INDEX IF NOT EXISTS idx_pauses_org_group
  ON booking_recurrence_pauses (organisation_id, recurring_group_id);

CREATE INDEX IF NOT EXISTS idx_pauses_session
  ON booking_recurrence_pauses (session_id);

-- Rollback (not run automatically — keep for reference if this needs to be reverted):
--   DROP TABLE IF EXISTS booking_recurrence_pauses;
--   DROP INDEX IF EXISTS uniq_bookings_instance_recurring_group;
--   DROP INDEX IF EXISTS idx_bookings_recurring_group_id;
--   ALTER TABLE bookings DROP COLUMN IF EXISTS recurring_group_id;
