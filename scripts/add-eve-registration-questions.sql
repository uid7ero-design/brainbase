-- Eve — registration questions: category model, retention and legal hold
-- (ADR 0013 §4a/§4b). Run once, manually, against the target database,
-- AFTER scripts/add-events-registration-questions.sql. NOT run
-- automatically — same manual-authorization discipline as every schema
-- script here. Apply BEFORE deploying the code that reads these columns.
--
-- One transaction with a short lock timeout: either every change lands or
-- none does, and the script gives up quickly instead of queueing behind a
-- long-running query. Re-runnable (IF NOT EXISTS / guarded constraints).
--
-- ── What each change means ───────────────────────────────────────────
-- events.eve_questions_enabled (default false)
--   Per-event Eve opt-in. Every existing event stays off: Eve shows none of
--   its questions and the services refuse answers submitted through Eve.
-- events.cancelled_at (NULL)
--   When the event was cancelled (set by the event route from now on).
--   Retention falls back to updated_at for events cancelled before this.
-- events.answers_legal_hold / event_orders.answers_legal_hold (NULL)
--   NULL = no hold. Otherwise the reason (COMPLAINT | INCIDENT | DISPUTE |
--   LEGAL_OBLIGATION); while set, retention does not remove that event's /
--   order's answers.
-- event_registration_questions.data_category (default 'STANDARD')
--   STANDARD | SENSITIVE | THIRD_PARTY | CONSENT. Drives the buyer notice,
--   whether explicit agreement is needed, staff labels and the retention
--   timer. Every existing question becomes STANDARD (no guessing); an
--   operator may reclassify reviewed questions afterwards.
-- event_registration_questions.template_key (NULL)
--   Built-in template the question came from (e.g. ACCESSIBILITY). A
--   templated question's category is fixed by the template and cannot be
--   lowered.
-- event_registration_responses.data_category_snapshot (default 'STANDARD')
--   The category in force when the answer was given — retention uses this,
--   never the live question. Existing answers stay STANDARD.
-- event_registration_responses.question_help_text_snapshot (NULL)
--   The help text shown when answered (e.g. a consent statement).
-- event_registration_responses.sensitive_consent_at (NULL)
--   When an Eve buyer gave the explicit agreement for a SENSITIVE or
--   THIRD_PARTY answer.
-- event_registration_responses.redacted_at (NULL) + answer becomes NULLable
--   Retention removes the answer value (answer := NULL) and stamps
--   redacted_at; the row keeps only structure (question, snapshots of
--   label/type/category, timestamps). A CHECK keeps the two in step.
--
-- ROLLBACK (not executed by this script; roll the code back FIRST — it
-- reads these columns; never drop them once Eve has collected answers):
--   BEGIN;
--   ALTER TABLE event_registration_responses DROP CONSTRAINT IF EXISTS event_registration_responses_redaction_chk;
--   -- only if no row has answer IS NULL:
--   ALTER TABLE event_registration_responses ALTER COLUMN answer SET NOT NULL;
--   ALTER TABLE event_registration_responses DROP COLUMN IF EXISTS redacted_at, DROP COLUMN IF EXISTS sensitive_consent_at,
--     DROP COLUMN IF EXISTS question_help_text_snapshot, DROP COLUMN IF EXISTS data_category_snapshot;
--   ALTER TABLE event_registration_questions DROP COLUMN IF EXISTS template_key, DROP COLUMN IF EXISTS data_category;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS answers_legal_hold;
--   ALTER TABLE events DROP COLUMN IF EXISTS answers_legal_hold, DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS eve_questions_enabled;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eve_questions_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answers_legal_hold TEXT;

ALTER TABLE event_orders
  ADD COLUMN IF NOT EXISTS answers_legal_hold TEXT;

ALTER TABLE event_registration_questions
  ADD COLUMN IF NOT EXISTS data_category TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS template_key TEXT;

ALTER TABLE event_registration_responses
  ADD COLUMN IF NOT EXISTS data_category_snapshot TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS question_help_text_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS sensitive_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ;

ALTER TABLE event_registration_responses ALTER COLUMN answer DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_answers_legal_hold_chk') THEN
    ALTER TABLE events ADD CONSTRAINT events_answers_legal_hold_chk
      CHECK (answers_legal_hold IS NULL OR answers_legal_hold IN ('COMPLAINT', 'INCIDENT', 'DISPUTE', 'LEGAL_OBLIGATION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_orders_answers_legal_hold_chk') THEN
    ALTER TABLE event_orders ADD CONSTRAINT event_orders_answers_legal_hold_chk
      CHECK (answers_legal_hold IS NULL OR answers_legal_hold IN ('COMPLAINT', 'INCIDENT', 'DISPUTE', 'LEGAL_OBLIGATION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_registration_questions_data_category_chk') THEN
    ALTER TABLE event_registration_questions ADD CONSTRAINT event_registration_questions_data_category_chk
      CHECK (data_category IN ('STANDARD', 'SENSITIVE', 'THIRD_PARTY', 'CONSENT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_registration_responses_data_category_chk') THEN
    ALTER TABLE event_registration_responses ADD CONSTRAINT event_registration_responses_data_category_chk
      CHECK (data_category_snapshot IN ('STANDARD', 'SENSITIVE', 'THIRD_PARTY', 'CONSENT'));
  END IF;
  -- An answer is either present (not redacted) or removed (redacted), never both/neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_registration_responses_redaction_chk') THEN
    ALTER TABLE event_registration_responses ADD CONSTRAINT event_registration_responses_redaction_chk
      CHECK ((redacted_at IS NULL) = (answer IS NOT NULL));
  END IF;
END $$;

-- Retention scan: unredacted answers by event.
CREATE INDEX IF NOT EXISTS idx_event_registration_responses_unredacted
  ON event_registration_responses (event_id) WHERE redacted_at IS NULL;

COMMIT;
