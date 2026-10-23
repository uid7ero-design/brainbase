-- Eve — registration questions (ADR 0013 §4 trigger). Run once, manually,
-- against the target database, AFTER scripts/add-events-registration-questions.sql.
-- NOT run automatically — same manual-authorization discipline as every
-- schema script here. Apply BEFORE deploying the code that reads these
-- columns (listActiveQuestions selects `sensitive`; resolvePublicEvent
-- selects `eve_questions_enabled`).
--
-- ADR 0013 §4 deferred sensitive registration questions and required that,
-- before Eve renders ANY registration question, a sensitive flag + consent
-- control be added behind a new schema gate. This is that gate.
--
-- ── events.eve_questions_enabled ─────────────────────────────────────
-- Per-event opt-in for Eve. DEFAULT false, so every existing event (incl.
-- events that already have questions answered through BrainBase) keeps
-- exactly today's Eve behaviour: Eve does not show its questions and the
-- server refuses answers submitted through Eve for it. Turning it on is an
-- explicit organiser (manager+) action, audited.
--
-- ── event_registration_questions.sensitive ───────────────────────────
-- Organiser marks a question whose answers may reveal sensitive
-- information (health, disability/accessibility, third-party details such
-- as an emergency contact). On Eve, a booking that answers any sensitive
-- question must carry the buyer's explicit acknowledgement (never
-- pre-ticked); the server refuses it otherwise.
--
-- ── event_registration_responses snapshots ───────────────────────────
-- question_help_text_snapshot: the help text shown at submission, next to
--   the existing label/field_type snapshots, so the exact wording a buyer
--   answered (e.g. a photo/video consent statement) is preserved even if
--   the question is edited later.
-- sensitive_snapshot: whether the question was marked sensitive when
--   answered.
-- sensitive_consent_at: when the buyer gave the acknowledgement, for a
--   sensitive answer submitted through Eve. NULL otherwise (including all
--   BrainBase-surface answers, whose form has no such control).
--
-- Idempotent (IF NOT EXISTS). Additive only; existing rows get the
-- defaults (false / NULL), which is exactly their current meaning.
--
-- ROLLBACK (not executed by this script):
--   ALTER TABLE event_registration_responses DROP COLUMN IF EXISTS sensitive_consent_at;
--   ALTER TABLE event_registration_responses DROP COLUMN IF EXISTS sensitive_snapshot;
--   ALTER TABLE event_registration_responses DROP COLUMN IF EXISTS question_help_text_snapshot;
--   ALTER TABLE event_registration_questions DROP COLUMN IF EXISTS sensitive;
--   ALTER TABLE events DROP COLUMN IF EXISTS eve_questions_enabled;
-- (Roll the code back first: it selects these columns.)

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eve_questions_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE event_registration_questions
  ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE event_registration_responses
  ADD COLUMN IF NOT EXISTS question_help_text_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS sensitive_snapshot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sensitive_consent_at TIMESTAMPTZ;
