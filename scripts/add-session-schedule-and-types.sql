-- Run once against the production database.
-- Additive only: safe to run with existing data, safe to re-run (every
-- statement is IF NOT EXISTS / idempotent / ON CONFLICT DO NOTHING).
-- Does not drop, rename, or change the type of any existing column.
--
-- Part A: schedule-rule fields on sessions, replacing the manual
-- "Generate 6 weeks" workflow (see lib/tennisSchedule.ts). Existing rows
-- get end_mode = 'ongoing' via the column DEFAULT below, so every current
-- session keeps behaving exactly as it does today (rolling weekly
-- generation, no end) without needing a separate UPDATE statement.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_mode text NOT NULL DEFAULT 'ongoing';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_after_weeks integer;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_end_mode_check
  CHECK (end_mode IN ('ongoing', 'after_weeks', 'on_date'))
  NOT VALID;
-- NOT VALID skips checking existing rows at migration time (they're all
-- 'ongoing' via the DEFAULT above, so it would pass anyway, but NOT VALID
-- keeps this migration fast/lock-light on a large table). Validate
-- separately and only once satisfied if you want it fully enforced:
--   ALTER TABLE sessions VALIDATE CONSTRAINT sessions_end_mode_check;

-- Part B: organisation-scoped session types, replacing the hardcoded
-- SESSION_TYPE_GROUPS constant in app/dashboard/sessions/page.tsx.
-- sessions.session_type remains an unchanged plain string column — this
-- table is additive alongside it, not a replacement/FK migration. A
-- session's saved session_type string keeps resolving and displaying
-- correctly (via sessionLabel()/sessionChip() fallbacks) even if its
-- matching row here is later archived.
CREATE TABLE IF NOT EXISTS session_types (
  id              text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  colour_key      text NOT NULL DEFAULT 'slate',
  active          boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_session_types_org ON session_types (organisation_id);

-- Backfill: LD Tennis's current 10 hardcoded types, as real rows, using
-- the exact same slug values already stored in sessions.session_type today
-- (SESSION_TYPE_GROUPS in app/dashboard/sessions/page.tsx) — so every
-- existing session continues to resolve to the same type with the same
-- name/colour it already displays, with zero visual change on cutover.
--
-- Self-contained: resolves LD Tennis's organisation_id from its stable
-- slug ('ld-tennis', verified against production organisations.slug —
-- the same unique column every org is already identified by, e.g.
-- Organisation.slug in prisma/schema.prisma) rather than requiring a UUID
-- to be hand-edited into this script. INSERT ... SELECT ... WHERE fails
-- safely: if no organisation with that slug exists, the SELECT returns
-- zero rows and the INSERT inserts nothing (no error, no partial state) —
-- it can never seed these types into any other organisation, since the
-- WHERE clause is the only source of organisation_id here. ON CONFLICT
-- DO NOTHING keeps it safe to re-run.
INSERT INTO session_types (organisation_id, name, slug, colour_key, sort_order)
SELECT o.id, v.name, v.slug, v.colour_key, v.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('Private Coaching (30 min)', 'PRIVATE_30',        'purple', 0),
  ('Private Coaching (60 min)', 'PRIVATE_60',        'violet', 1),
  ('Semi-Private Coaching',     'SEMI_PRIVATE',      'indigo', 2),
  ('Hot Shots Tennis',          'GROUP_TERM_JUNIOR', 'green',  3),
  ('Hot Shots Matchplay',       'MATCHPLAY',         'emerald',4),
  ('Adult Beginner Group',      'GROUP_TERM_ADULT',  'blue',   5),
  ('Cardio Tennis (Session)',   'CARDIO_SESSION',    'orange', 6),
  ('Cardio Tennis (Term)',      'CARDIO_TERM',       'amber',  7),
  ('Clinic',                    'CLINIC',            'sky',    8),
  ('Assessment',                'ASSESSMENT',        'slate',  9)
) AS v(name, slug, colour_key, sort_order)
WHERE o.slug = 'ld-tennis'
ON CONFLICT (organisation_id, slug) DO NOTHING;

-- Rollback (not run automatically — keep for reference if this needs to be reverted):
--   DROP TABLE IF EXISTS session_types;
--   ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_end_mode_check;
--   ALTER TABLE sessions DROP COLUMN IF EXISTS end_date;
--   ALTER TABLE sessions DROP COLUMN IF EXISTS end_after_weeks;
--   ALTER TABLE sessions DROP COLUMN IF EXISTS end_mode;
--   ALTER TABLE sessions DROP COLUMN IF EXISTS start_date;
