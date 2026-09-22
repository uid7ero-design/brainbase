-- Events & Ticketing — Resend delivery-status visibility. Run once,
-- manually, against the target database, AFTER
-- scripts/add-events-ticket-email-delivery.sql (event_orders.ticket_email_*
-- columns must already exist). NOT run automatically — same
-- manual-authorization discipline as every schema script in this
-- repository. NOT executed against Production by this phase.
--
-- ── Why a new dedicated table, not new columns on event_orders ─────────
--
-- event_orders.ticket_email_provider_message_id (added by
-- add-events-ticket-email-delivery.sql) already records the AUTOMATIC
-- send's provider message id, but it is a single column: it can only
-- ever describe ONE send per order. Manual resend
-- (app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts)
-- creates a genuinely NEW, distinct Resend message on every click (it
-- has no idempotency key at all — see that route's own send() call) and
-- today only records its provider message id inside audit_logs'
-- after_state JSONB, which is not indexed or correlatable. Overloading
-- a single column on event_orders to also track manual sends would mean
-- a second manual resend silently overwrites the first send's
-- correlation id — making a LATER webhook for the first send
-- unresolvable, or worse, misattributed to the second send. This table
-- gives every accepted provider message (automatic or manual) its own
-- row, keyed by that message's own provider_message_id, so a webhook
-- event always resolves to the exact send it actually describes.
--
-- ── Relationship to event_orders.ticket_email_status ────────────────────
--
-- event_orders.ticket_email_status (NULL/pending/sending/sent/failed) is
-- BrainBase's OWN send/recovery lifecycle — whether OUR attempt to hand
-- the email to Resend succeeded — and is entirely unchanged by this
-- migration. delivery_status on THIS table is a separate concept: what
-- Resend/the recipient's mail infrastructure later reported about a
-- message Resend already accepted. 'accepted' here does not imply
-- inbox delivery, and a later 'bounced'/'suppressed'/'complained' here
-- never rewrites event_orders.ticket_email_status — see
-- lib/events/resendWebhook.ts for the enforcement of that separation.
--
-- ── Column-by-column ────────────────────────────────────────────────────
--
-- send_source: 'automatic' (attemptAutomaticTicketEmail) or 'manual'
-- (the organiser resend route). Purely descriptive; never used as a
-- correlation key.
--
-- provider_message_id: Resend's own opaque email id (the `id` returned
-- by POST /emails, and the `email_id` field on every webhook event).
-- UNIQUE — this is the sole correlation key a webhook uses to find its
-- row; see the unique index below. Not a bearer credential.
--
-- delivery_status: 'accepted' initially (the only state application
-- code — not the webhook handler — ever writes), moving to at most one
-- of 'delivered' / 'bounced' / 'suppressed' / 'complained' / 'failed'
-- once a genuine webhook event arrives. Names match Resend's own
-- `email.*` webhook event vocabulary (see lib/resend SDK's WebhookEvent
-- union), not invented terminology. Once a row reaches one of the four
-- terminal statuses (bounced/suppressed/complained/failed), it is
-- permanently locked — lib/events/resendWebhook.ts's guarded UPDATE
-- never transitions a row out of a terminal status, so a delayed or
-- reordered later webhook can never regress a known-bad outcome back to
-- something more favourable, and can never resurrect a stale row.
-- 'delivered' is NOT treated as terminal-locked: Resend's own event
-- semantics make 'delivered' the common happy-path event, and locking
-- it would only serve to reject a legitimately later event that
-- shouldn't exist for a delivered message anyway; the replay/ordering
-- guards below already make re-applying 'delivered' a safe no-op.
--
-- latest_event_id: the Svix `svix-id` header of the most recently
-- APPLIED webhook event for this row — Resend's webhook delivery is
-- Svix-based and svix-id is that provider's own per-delivery event
-- identifier (see node_modules/resend's Webhooks.verify(), which is a
-- thin wrapper around svix/standardwebhooks). A replayed delivery of
-- the exact same event carries the exact same svix-id, so comparing
-- against this column is the exact-replay guard. NOT a fallback
-- deduplication key — Resend/Svix supplies a real provider event id, so
-- the task's "if no provider event identifier exists" fallback path
-- does not apply here.
--
-- latest_event_at: the webhook payload's own `created_at` for the most
-- recently applied event. Used as an ordering guard (an incoming
-- event's created_at must be >= this value) so an out-of-order-delivered
-- OLDER event (same or different svix-id) can never overwrite state a
-- newer event already established.
--
-- latest_event_type: the raw Resend event type string of the most
-- recently applied event (e.g. 'email.delivered'), for operator
-- diagnosis. Not used in any WHERE-clause guard.
--
-- delivered_at / bounced_at / suppressed_at / complained_at / failed_at:
-- first-occurrence timestamps for each specific outcome, each written
-- via COALESCE(existing, new) so re-applying a later event of the SAME
-- resulting status (a legitimate, non-replayed second webhook for an
-- outcome that doesn't logically repeat) never moves an already-recorded
-- timestamp backward or forward.
--
-- ── Idempotency / concurrency (enforced in application code, not here) ──
--
-- lib/events/resendWebhook.ts applies every webhook event via a single
-- guarded UPDATE ... WHERE provider_message_id = $1 AND delivery_status
-- NOT IN ('bounced','suppressed','complained','failed') AND
-- latest_event_id IS DISTINCT FROM $2 AND (latest_event_at IS NULL OR
-- $3 >= latest_event_at), with the audit-log INSERT chained from that
-- same UPDATE's RETURNING inside one statement (matching
-- lib/events/stripe.ts's existing webhook-handler CTE pattern, per this
-- repo's ADR-0003 §3: a system-initiated, redelivery-prone transition
-- gets the atomic CTE form, not the best-effort separate-statement form
-- used for human-initiated audit events).
--
-- A webhook whose provider_message_id matches no row (an event for some
-- other email this Resend account sent — auth/password-reset/lead
-- notifications share the same Resend account and webhook endpoint,
-- since Resend webhooks are configured account-wide, not per-feature)
-- is a safe, expected no-op: 0 rows affected, 200 OK, no mutation, no
-- audit entry. See lib/events/resendWebhook.ts's own handling of this.
--
-- ── Additive only ────────────────────────────────────────────────────────
--
-- One new table. Does not alter event_orders, event_order_items,
-- event_attendees, event_registration_responses, organisations, users,
-- or audit_logs. IF NOT EXISTS throughout; safe to re-run.
--
-- ── ROLLBACK (not executed by this script — recorded for the record) ───
--
--   DROP INDEX IF EXISTS idx_event_ticket_email_deliveries_order;
--   DROP INDEX IF EXISTS idx_event_ticket_email_deliveries_org;
--   DROP TABLE IF EXISTS event_ticket_email_deliveries;
--
-- Safe at any time: no other table has an inbound FK to this one.

CREATE TABLE IF NOT EXISTS event_ticket_email_deliveries (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id       TEXT NOT NULL REFERENCES organisations(id),
  order_id              TEXT NOT NULL,
  send_source           TEXT NOT NULL CHECK (send_source IN ('automatic', 'manual')),
  provider_message_id   TEXT NOT NULL,
  delivery_status       TEXT NOT NULL DEFAULT 'accepted'
                          CHECK (delivery_status IN ('accepted', 'delivered', 'bounced', 'suppressed', 'complained', 'failed')),
  latest_event_id       TEXT,
  latest_event_at       TIMESTAMPTZ,
  latest_event_type     TEXT,
  accepted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at          TIMESTAMPTZ,
  bounced_at            TIMESTAMPTZ,
  suppressed_at         TIMESTAMPTZ,
  complained_at         TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite tenant-integrity anchor onto event_orders(id,
  -- organisation_id) — matches this codebase's established composite-FK
  -- pattern (event_order_items -> event_orders, event_sessions ->
  -- events). Structurally prevents a delivery row from ever pointing at
  -- a different organisation's order.
  CONSTRAINT event_ticket_email_deliveries_order_org_fkey
    FOREIGN KEY (order_id, organisation_id)
    REFERENCES event_orders (id, organisation_id) ON DELETE CASCADE
);

-- The sole webhook correlation lookup: "find the row for this Resend
-- email id". UNIQUE, not just indexed — provider_message_id identifies
-- exactly one accepted send by construction (Resend generates a fresh
-- id per send; see lib/events/ticketEmail.ts's sendTicketEmail(), which
-- never reuses one across two distinct sends).
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_ticket_email_deliveries_provider_message_id
  ON event_ticket_email_deliveries (provider_message_id);

-- Powers "delivery history for this order" (future organiser UI) and
-- the manual-resend route's own insert-time lookups.
CREATE INDEX IF NOT EXISTS idx_event_ticket_email_deliveries_order
  ON event_ticket_email_deliveries (organisation_id, order_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_ticket_email_deliveries_org
  ON event_ticket_email_deliveries (organisation_id);

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'event_ticket_email_deliveries'
--   ORDER BY ordinal_position;
--   -- Expect 17 rows.
--
--   SELECT conname, contype FROM pg_constraint
--   WHERE conrelid = 'event_ticket_email_deliveries'::regclass;
--   -- Expect send_source check, delivery_status check, the composite FK,
--   -- and the primary key.
--
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'event_ticket_email_deliveries';
--   -- Expect the primary key index plus the three CREATE INDEX
--   -- statements above (4 total).
--
--   SELECT count(*) FROM event_ticket_email_deliveries;
--   -- Expect 0 immediately after applying this migration — nothing
--   -- backfills historical sends.
