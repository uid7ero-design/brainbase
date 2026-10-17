-- Events & Ticketing — Phase 5B: lifecycle communications foundation
-- (order cancelled / order refunded / event cancelled / event reminder).
-- Run once, manually, against the target database, AFTER
-- scripts/create-events.sql, scripts/create-events-phase2.sql,
-- scripts/add-events-payments.sql, scripts/add-events-ticketing.sql and
-- scripts/create-events-ticket-email-deliveries.sql (events, event_orders
-- and the ticket-email tracking table must already exist). NOT run
-- automatically — same manual-authorization discipline as every schema
-- script in this repository. NOT executed against Production by this
-- phase: Preview Neon branch only until a separate, explicit gate.
--
-- ── Why a NEW table rather than reusing the ticket-email columns/table ──
--
-- Automatic ticket delivery lives in two places today, and neither fits
-- a lifecycle message:
--
--   * event_orders.ticket_email_* (scripts/add-events-ticket-email-
--     delivery.sql) is a ONE-send-per-order state machine: a single
--     status/claim/attempt/next_attempt/provider-id set per row. A
--     lifecycle needs SEVERAL independent sends per order (a reminder,
--     then a cancellation, then a refund), each with its own claim,
--     retries, idempotency key and provider message id. Overloading those
--     columns would make a later send silently overwrite the delivery
--     history of an earlier one.
--   * event_ticket_email_deliveries (scripts/create-events-ticket-email-
--     deliveries.sql) records what Resend LATER reports about a message
--     already accepted. It has no notification type, no recipient, no
--     claim/lease, no attempt counter, no retry schedule, no idempotency
--     key, and its send_source CHECK is deliberately ('automatic',
--     'manual') — it is a provider-outcome ledger for ticket emails, not
--     a send queue.
--
-- event_notifications is therefore ONE row per (notification type, order):
-- it carries BOTH halves — BrainBase's own send lifecycle (the exact
-- NULL-free pending -> sending -> sent / failed machine, claim id, backoff
-- and idempotency key that lib/events/ticketEmailDelivery.ts already
-- proved for ticket emails) AND, once the provider accepted the message,
-- the same Resend outcome vocabulary event_ticket_email_deliveries uses,
-- so the existing account-wide Resend webhook can resolve a notification
-- by provider_message_id exactly as it resolves a ticket email today.
-- Nothing about ticket delivery changes: no ticket-email column, table,
-- claim query or recovery statement is touched by this script.
--
-- ── Column-by-column ────────────────────────────────────────────────────
--
-- organisation_id / event_id / order_id: tenant anchors. BOTH composite
-- FKs below are organisation-scoped (events(id, organisation_id) and
-- event_orders(id, organisation_id)) — the established pattern every
-- Events child table already uses — so a notification physically cannot
-- point at another organisation's event or order. order_id is nullable
-- for a future organiser-level or attendee-level message; every type this
-- phase defines is purchaser/order-level and always sets it.
--
-- notification_type: neutral vocabulary, never product-specific —
-- ORDER_CANCELLED, ORDER_REFUNDED, EVENT_CANCELLED, EVENT_REMINDER.
--
-- recipient_email: the purchaser address the message is addressed to,
-- copied at scheduling time from event_orders.purchaser_email. Stored so
-- the row is self-describing for operators and so the uniqueness rule
-- below ("one message per type per order") is also one message per
-- address per order — a multi-attendee order never fans out to the same
-- inbox twice.
--
-- idempotency_key: 'event-notification:<TYPE>:<order_id>' — deterministic,
-- derived from already-stable ids only, UNIQUE. This single constraint is
-- the whole duplicate-prevention story at the scheduling layer: a repeat
-- cancel click, a replayed refund request, a second PATCH to CANCELLED or
-- a second reminder sweep all hit ON CONFLICT (idempotency_key) DO NOTHING
-- and schedule nothing. The same string is handed to Resend as the
-- Idempotency-Key header on every attempt (see lib/events/
-- notificationDelivery.ts), so even a retry after an ambiguous network
-- outcome cannot produce a second provider send — the exact payload-
-- stability rule lib/events/ticketEmailDelivery.ts documents applies
-- unchanged.
--
-- status / claim_id / claimed_at / attempt_count / last_attempt_at /
-- next_attempt_at / sent_at / failed_at / last_error: the send lifecycle,
-- identical in meaning to event_orders.ticket_email_* (see that
-- migration's header for the lease rationale — claim_id is an opaque
-- per-attempt token, never the timestamp). A row is born 'pending' and is
-- claimable only once scheduled_for has passed. next_attempt_at NULL on a
-- 'failed' row means TERMINAL. failed_at records the most recent failure
-- transition and is cleared by a later success.
--
-- scheduled_for: when the row becomes claimable. now() for every
-- transition-driven type; reminders are inserted by the hourly recovery
-- run only inside the event's own send window (see lib/events/
-- notificationRecovery.ts), so this column is simply now() for them too —
-- it exists so a future type can be scheduled ahead of time without a
-- schema change.
--
-- provider_message_id / delivery_status / latest_event_* /
-- delivered_at / bounced_at / suppressed_at / complained_at /
-- delivery_failed_at: the provider-outcome half, written only after a
-- successful send ('accepted' + the Resend id, in the same UPDATE as
-- status = 'sent') and thereafter only by the verified Resend webhook
-- (lib/events/ticketEmailDeliveryTracking.ts), with the same replay/
-- ordering/terminal-lock guards event_ticket_email_deliveries has.
-- delivery_failed_at is named distinctly from failed_at on purpose: the
-- former is "Resend accepted it, then reported permanent delivery
-- failure"; the latter is "our own attempt to hand it to Resend failed".
--
-- ── events.reminder_enabled ──────────────────────────────────────────────
--
-- BOOLEAN NOT NULL DEFAULT false. Reminders are opt-in per event; every
-- existing event (and every new one, until an organiser turns it on) stays
-- false, so no historical event starts emailing its purchasers because
-- this migration exists. There is no organisation-level or platform-level
-- switch and no environment variable: only this column, set by an
-- organiser through the event PATCH route, schedules a reminder.
--
-- ── Historical behaviour ────────────────────────────────────────────────
--
-- Additive only. No row of any existing table is read or modified. No
-- notification is backfilled for any historical cancellation, refund or
-- cancelled event — only transitions that happen AFTER the application
-- code ships schedule a row. event_notifications is empty immediately
-- after this script runs.
--
-- ── ROLLBACK (not executed by this script — recorded for the record) ───
--
--   DROP TABLE IF EXISTS event_notifications;      -- drops its own
--                                                   -- indexes/constraints
--   ALTER TABLE events DROP COLUMN IF EXISTS reminder_enabled;
--
-- No other table has an inbound FK to event_notifications. Metadata-only
-- while the table is empty; data-destructive (the send/delivery history
-- of every lifecycle message) once rows exist.

CREATE TABLE IF NOT EXISTS event_notifications (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_id             TEXT        NOT NULL,
  order_id             TEXT,
  notification_type    TEXT        NOT NULL,
  recipient_email      TEXT        NOT NULL,
  idempotency_key      TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  scheduled_for        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_id             TEXT,
  claimed_at           TIMESTAMPTZ,
  attempt_count        INTEGER     NOT NULL DEFAULT 0,
  last_attempt_at      TIMESTAMPTZ,
  next_attempt_at      TIMESTAMPTZ,
  sent_at              TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  last_error           TEXT,
  provider_message_id  TEXT,
  delivery_status      TEXT,
  latest_event_id      TEXT,
  latest_event_at      TIMESTAMPTZ,
  latest_event_type    TEXT,
  delivered_at         TIMESTAMPTZ,
  bounced_at           TIMESTAMPTZ,
  suppressed_at        TIMESTAMPTZ,
  complained_at        TIMESTAMPTZ,
  delivery_failed_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_notifications_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT event_notifications_type_check
    CHECK (notification_type IN ('ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER')),
  CONSTRAINT event_notifications_recipient_check
    CHECK (btrim(recipient_email) <> ''),
  CONSTRAINT event_notifications_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT event_notifications_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT event_notifications_last_error_check
    CHECK (last_error IS NULL OR length(last_error) <= 500),
  CONSTRAINT event_notifications_claim_check
    CHECK ((status = 'sending' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL)
        OR (status <> 'sending' AND claim_id IS NULL AND claimed_at IS NULL)),
  CONSTRAINT event_notifications_delivery_status_check
    CHECK (delivery_status IS NULL OR delivery_status IN ('accepted', 'delivered', 'bounced', 'suppressed', 'complained', 'failed')),
  CONSTRAINT event_notifications_provider_check
    CHECK ((provider_message_id IS NULL) = (delivery_status IS NULL)),
  CONSTRAINT event_notifications_event_org_fkey FOREIGN KEY (event_id, organisation_id)
    REFERENCES events (id, organisation_id) ON DELETE CASCADE,
  CONSTRAINT event_notifications_order_org_fkey FOREIGN KEY (order_id, organisation_id)
    REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE
);

-- The sole webhook correlation lookup ("find the notification for this
-- Resend email id"); partial because a never-sent row has no id yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_notifications_provider_message_id
  ON event_notifications (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Powers recovery candidate discovery (pending / due-failed / stale-sending).
CREATE INDEX IF NOT EXISTS idx_event_notifications_due
  ON event_notifications (scheduled_for, next_attempt_at)
  WHERE status IN ('pending', 'failed', 'sending');

-- "Every message for this order" (organiser visibility, operator diagnosis).
CREATE INDEX IF NOT EXISTS idx_event_notifications_order
  ON event_notifications (organisation_id, order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_notifications_event
  ON event_notifications (organisation_id, event_id);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false;

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
--
--   SELECT count(*) FROM information_schema.columns
--   WHERE table_name = 'event_notifications';           -- expect 29
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'event_notifications'::regclass ORDER BY 1;
--   -- expect pkey + idempotency_key_key + 8 checks + 2 composite FKs
--   -- + organisation_id fkey = 13
--
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'event_notifications' ORDER BY 1;  -- expect 6
--
--   SELECT column_default FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name = 'reminder_enabled';
--   -- expect false
--
--   SELECT count(*) FROM event_notifications;             -- expect 0
--   SELECT count(*) FROM events WHERE reminder_enabled;   -- expect 0
