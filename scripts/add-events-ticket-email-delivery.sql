-- Events & Ticketing — Phase 3E.1: durable, lease-based foundation for
-- AUTOMATIC initial ticket-email delivery. Run once, manually, against
-- the target database, AFTER scripts/create-events-phase2.sql (event_orders
-- must already exist) and scripts/add-events-ticketing.sql (ticket_token
-- must already exist on event_attendees). NOT run automatically — same
-- manual-authorization discipline as every schema script in this
-- repository.
--
-- ── Scope of 3E.1 ──────────────────────────────────────────────────────
--
-- This migration adds SCHEMA ONLY. No application code in this same
-- phase writes 'pending' to any row — not the free-registration route,
-- not the Stripe webhook, not any migration/backfill. Every existing
-- and newly-created event_orders row keeps ticket_email_status = NULL
-- until a LATER, separately-approved phase (3E.2 for free registrations,
-- 3E.3 for paid orders) explicitly schedules a NEW order for automatic
-- delivery. See lib/events/ticketEmailDelivery.ts's own header comment
-- for the full state-machine design this schema supports.
--
-- ── Why NULL must never be claimable (the central safety property) ────
--
-- After this additive migration runs, EVERY existing event_orders row
-- (every historical registration to date) has ticket_email_status = NULL
-- — a brand-new column has no other possible value for a pre-existing
-- row. If NULL were ever treated as "eligible for an automatic attempt",
-- rolling out this feature would silently email every past purchaser the
-- instant a recovery worker (not built in this phase) started running.
-- NULL therefore means "legacy / never explicitly scheduled" and is
-- structurally excluded from every claim condition in
-- lib/events/ticketEmailDelivery.ts's claim query — see that file's own
-- comment and tests/containment/eventsTicketEmailDelivery.test.ts's
-- "NULL never claimable" test for the enforcement of this property.
-- 'pending' is the ONLY status an order can be claimed from cold; only
-- future 3E.2/3E.3 code ever writes it, and only for a newly-created or
-- newly-paid order — never as a bulk backfill.
--
-- ── State machine (summary — full detail in ticketEmailDelivery.ts) ────
--
-- NULL -> pending -> sending -> sent               (happy path)
--                       |
--                       +-> failed -> sending (retry, if attempts remain
--                                     and retry-after has elapsed)
--                       |
--                       +-> failed (terminal, once attempt_count reaches
--                                   MAX_ATTEMPTS, or on an idempotency
--                                   payload-mismatch outcome that must
--                                   never be automatically retried)
--
-- ticket_email_claim_id is the exclusive-ownership token for an
-- in-flight 'sending' lease (a per-attempt crypto.randomUUID(), not the
-- claimed_at timestamp — TIMESTAMPTZ round-tripped through a JS Date
-- loses microsecond precision, which is not a safe equality-comparison
-- basis for "is this still MY claim"). Every completion write (success
-- or failure) is guarded on BOTH status='sending' AND an exact
-- claim_id match, so a worker whose lease has already expired and been
-- reclaimed by someone else can never mutate the newer claim's state —
-- see ticketEmailDelivery.ts's markTicketEmailSent/markTicketEmailFailed.
--
-- ── Column-by-column ────────────────────────────────────────────────────
--
-- ticket_email_status: the state itself. Nullable (see above). CHECK
-- constraint below restricts non-NULL values to the 4-state set; NULL
-- itself always passes a Postgres CHECK constraint by construction
-- (NULL IN (...) evaluates to NULL, not FALSE, and CHECK only rejects
-- on an explicit FALSE) — no "OR IS NULL" clause is needed in the
-- constraint expression, but is called out here so a future reader
-- isn't confused about why NULL rows are never rejected by it.
--
-- ticket_email_claimed_at: set the instant a lease is granted, cleared
-- (NULL) the instant that lease ends (success, failure, or the stale-
-- exhausted sweep). Used only to detect a STALE lease (claimed_at older
-- than the lease timeout) — never as an ownership/equality token (see
-- claim_id above).
--
-- ticket_email_claim_id: the ownership token for the CURRENT lease
-- only. Always set together with claimed_at, always cleared together
-- with it.
--
-- ticket_email_attempt_count: incremented ONLY inside the atomic claim
-- (never inside the success/failure transition — those already see the
-- count the claim just incremented). Drives MAX_ATTEMPTS gating.
--
-- ticket_email_last_attempt_at: unlike claimed_at, this is NEVER
-- cleared — a monotonic "when did we last actually try" marker that
-- survives lease release, for staff observability once a later phase
-- surfaces it.
--
-- ticket_email_next_attempt_at: the earliest instant a 'failed' order
-- becomes claimable again. NULL means either "not yet failed" or
-- "terminal — no further automatic attempt will ever be made" (either
-- MAX_ATTEMPTS was reached, or an idempotency payload-mismatch outcome
-- forced immediate termination — see ticketEmailDelivery.ts's
-- markTicketEmailFailed for that distinction).
--
-- ticket_email_sent_at / ticket_email_provider_message_id: terminal
-- success facts. provider_message_id is Resend's own opaque email id —
-- not a bearer credential, safe for staff-facing display in a later
-- phase.
--
-- ticket_email_last_error: a SHORT, bounded, pre-classified diagnostic
-- string only (application code truncates to 300 chars before writing;
-- the CHECK constraint below is a 500-char defensive backstop, not the
-- intended operating size). MUST NEVER contain a ticket_token, a
-- booking_token, an API key, or a raw provider response body/stack
-- trace — enforced by construction in ticketEmailDelivery.ts (the only
-- strings ever written here are short hardcoded classifications, the
-- exact same discipline lib/events/ticketEmail.ts's existing
-- TicketEmailSendResult already follows for the manual-resend path).
--
-- ── Idempotency (provider-side, not this schema) ───────────────────────
--
-- This migration does NOT add an idempotency-key column: the key itself
-- is a pure, deterministic function of the order's own already-stable
-- id (`event-ticket-email-initial:<orderId>` — see
-- ticketEmailDelivery.ts's buildInitialTicketEmailIdempotencyKey()) and
-- needs no storage. Resend's own documented behaviour (confirmed by the
-- task owner against live API documentation): idempotency keys are
-- retained for 24 hours and are bound to the exact request payload —
-- reusing the same key with a genuinely different payload returns a
-- mismatch condition rather than silently sending a second email or
-- silently accepting the new payload. This schema's own bounded
-- retry window (LEASE_TIMEOUT_MINUTES=10 + backoff up to 30 minutes,
-- well under an hour end-to-end for all 3 attempts) sits comfortably
-- inside that 24-hour retention window by design.
--
-- ── Additive only ───────────────────────────────────────────────────────
--
-- Nine new columns + one composite partial index + three CHECK
-- constraints on the EXISTING event_orders table. Does not touch
-- events, event_order_items, event_attendees, event_registration_responses,
-- organisations, users, audit_logs, or any other existing table or row.
-- Adding nullable columns (and one NOT NULL DEFAULT 0 integer column)
-- is a metadata-only operation in modern Postgres when the default is a
-- constant — no full table rewrite.
--
-- Idempotency of this SCRIPT itself: IF NOT EXISTS / idempotent guards
-- throughout. Safe to re-run; a second execution changes nothing.
--
-- ── ROLLBACK (not executed by this script — recorded for the record) ───
--
--   DROP INDEX IF EXISTS idx_event_orders_ticket_email_pending;
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_status_check;
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_attempt_count_check;
--   ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_last_error_check;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_status;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_claimed_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_claim_id;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_attempt_count;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_last_attempt_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_next_attempt_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_sent_at;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_provider_message_id;
--   ALTER TABLE event_orders DROP COLUMN IF EXISTS ticket_email_last_error;
--
-- Safe at any time: these are plain scalar columns with zero inbound
-- references from any other table.

ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_status TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_claimed_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_claim_id TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_last_attempt_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_next_attempt_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_sent_at TIMESTAMPTZ;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_provider_message_id TEXT;
ALTER TABLE event_orders ADD COLUMN IF NOT EXISTS ticket_email_last_error TEXT;

-- Constraints added separately (not inline), matching
-- add-events-payments.sql's own precedent, so ADD COLUMN and constraint
-- validation remain independently retryable statements.

ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_status_check;
ALTER TABLE event_orders ADD CONSTRAINT event_orders_ticket_email_status_check
  CHECK (ticket_email_status IN ('pending', 'sending', 'sent', 'failed'));

ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_attempt_count_check;
ALTER TABLE event_orders ADD CONSTRAINT event_orders_ticket_email_attempt_count_check
  CHECK (ticket_email_attempt_count >= 0);

ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_ticket_email_last_error_check;
ALTER TABLE event_orders ADD CONSTRAINT event_orders_ticket_email_last_error_check
  CHECK (ticket_email_last_error IS NULL OR char_length(ticket_email_last_error) <= 500);

-- Deliberately NO state-consistency CHECK constraints (e.g. "claimed_at
-- IS NOT NULL iff status = 'sending'", or "sent_at IS NOT NULL iff
-- status = 'sent'") beyond the three above. Every transition in
-- lib/events/ticketEmailDelivery.ts already sets/clears exactly the
-- right columns together within a single guarded UPDATE, so such a
-- constraint would never actually catch a real application bug — it
-- would only make a legitimate, brief mid-migration or manual-recovery
-- state (e.g. an operator inspecting/patching a stuck row by hand)
-- brittle for no correctness benefit. Kept minimal per this phase's own
-- "do not overconstrain the state machine unnecessarily" instruction.

-- ONE composite partial index. Partial (WHERE ticket_email_status IS
-- NOT NULL) so the — presumably much larger — set of historical/never-
-- scheduled NULL rows is never indexed at all. Column order verified
-- against the actual claim query in ticketEmailDelivery.ts
-- (claimTicketEmailDelivery): ticket_email_status leads because every
-- branch of the claim's WHERE clause starts with a status equality
-- ('pending', or status='failed' AND ..., or status='sending' AND ...)
-- — it is the single most selective condition and is common to all
-- three branches. ticket_email_next_attempt_at is the second column
-- because it directly supports the 'failed' branch's own range
-- condition (next_attempt_at <= NOW()) AND is exactly what a future
-- recovery executor's own polling query would filter on
-- (WHERE ticket_email_status = 'failed' AND ticket_email_next_attempt_at
-- <= NOW()) — not built in this phase, but this index is already shaped
-- for it. ticket_email_claimed_at is deliberately NOT a third indexed
-- column: the 'sending'+stale-lease branch is expected to be rare in
-- normal operation, and it already benefits from this same index's
-- leading ticket_email_status = 'sending' condition narrowing the
-- candidate set before claimed_at is filtered in-memory — a third
-- column would add write overhead (this index is touched by every
-- claim/success/failure UPDATE) for a branch that doesn't need it.
CREATE INDEX IF NOT EXISTS idx_event_orders_ticket_email_pending
  ON event_orders (ticket_email_status, ticket_email_next_attempt_at)
  WHERE ticket_email_status IS NOT NULL;

-- ─── Verification (run manually, read-only, after applying the above)
-- ─────────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'event_orders' AND column_name LIKE 'ticket_email_%'
--   ORDER BY column_name;
--   -- Expect 9 rows, ticket_email_attempt_count is_nullable='NO'
--   -- column_default='0', every other row is_nullable='YES'.
--
--   SELECT conname, contype, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'event_orders'::regclass AND conname LIKE 'event_orders_ticket_email_%';
--   -- Expect 3 rows, all contype = 'c' (check).
--
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'event_orders' AND indexname = 'idx_event_orders_ticket_email_pending';
--   -- Expect exactly one row.
--
--   SELECT count(*) FROM event_orders WHERE ticket_email_status IS NOT NULL;
--   -- Expect 0 immediately after applying this migration — nothing in
--   -- this phase ever writes a non-NULL value.
