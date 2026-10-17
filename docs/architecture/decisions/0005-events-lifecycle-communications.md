# 0005 — Events Lifecycle Communications (Phase 5B)

Status: Accepted (Phase 5B, shared ticketing core — BrainBase Events and
the future standalone Eve product)

## 1. Context

Before this phase the only automatic purchaser email in the Events core
was ticket delivery (`lib/events/ticketEmailDelivery.ts`, scheduled by
free registration and by the Stripe webhook, retried by the hourly
recovery cron, with Resend delivery outcomes tracked in
`event_ticket_email_deliveries`). Cancelling an order, refunding it,
cancelling an event and reminding a purchaser before the event sent
nothing.

Read-only inventory findings that shaped the design:

- `event_orders.ticket_email_*` is a **one-send-per-order** state machine
  (one status/claim/attempt counter/provider id per row). A lifecycle
  needs several independent sends per order.
- `event_ticket_email_deliveries` records **what Resend later reports**
  about a message it already accepted. It has no notification type,
  recipient, claim, attempt counter, retry schedule or idempotency key,
  and its `send_source` CHECK is `('automatic', 'manual')`. It is a
  provider-outcome ledger, not a send queue.
- Cancel and refund are one shared service
  (`lib/events/services/orderTransitions.ts`) with conditional
  `UPDATE ... RETURNING` idempotency guards and best-effort audit.
- Setting an event to `CANCELLED` (`app/api/events/[id]/route.ts`) only
  changes `events.status`. Tickets already resolve as `EVENT_CANCELLED`
  through `lib/events/ticketValidity.ts`, but **order and payment rows are
  not touched and no refund is issued automatically**. This phase does
  not change that (see §6).
- `checkout.session.expired` moves an abandoned reservation to
  `CANCELLED / EXPIRED` via the Stripe webhook. That is the purchaser
  walking away from checkout, not a staff cancellation.

## 2. Decision

One new tenant-scoped table, `event_notifications`
(`scripts/create-events-notifications.sql`), one row per
(notification type, order), carrying **both** halves:

1. BrainBase's own send lifecycle — the ticket-email machine applied to a
   notification row: `pending -> sending -> sent | failed`, opaque
   `claim_id` lease, `attempt_count`, `next_attempt_at` backoff
   (5 min / 30 min, terminal at 3 attempts or on a provider
   idempotency-payload mismatch), with the constants **imported** from
   `ticketEmailDelivery.ts` so there is one retry policy, not two.
2. The provider-outcome half — `provider_message_id`, `delivery_status`
   (`accepted | delivered | bounced | suppressed | complained | failed`),
   the Svix replay/ordering guards and first-occurrence timestamps, using
   exactly the vocabulary `event_ticket_email_deliveries` uses, so the
   existing account-wide Resend webhook resolves a notification by
   `provider_message_id` in the **same single statement** it already uses
   for ticket emails (`applyResendDeliveryWebhookEvent`).

Plus one column: `events.reminder_enabled BOOLEAN NOT NULL DEFAULT false`.

Notification types are neutral and CHECK-constrained:
`ORDER_CANCELLED`, `ORDER_REFUNDED`, `EVENT_CANCELLED`, `EVENT_REMINDER`.

## 3. Idempotency model

`idempotency_key = 'event-notification:<TYPE>:<order_id>'` — deterministic,
built from stable ids only, `UNIQUE`, and handed verbatim to Resend as the
`Idempotency-Key` header on every attempt. That one string prevents
duplicates at both layers:

- **Scheduling** — every INSERT is `ON CONFLICT (idempotency_key) DO
  NOTHING`. For cancel/refund the INSERT is a CTE **derived from the
  transition UPDATE's own RETURNING** (ADR-0003 §3), so a notification
  can only exist for a transition that committed, a transition that
  matched zero rows schedules nothing, and a replayed request is a no-op.
  Event cancellation and reminders are bulk `INSERT ... SELECT ... ON
  CONFLICT DO NOTHING` statements with their audit rows chained from the
  same RETURNING.
- **Sending** — a retry after an ambiguous outcome presents the same key,
  so Resend returns the original response rather than sending twice. The
  key is read from the row, never rebuilt from anything attempt-specific,
  and never rotated (the ticket-email payload-stability rule applies).

Proofs: `tests/containment/eventsLifecycleNotifications.test.ts` (static
+ mocked behaviour), `scripts/tests/verify-events-lifecycle-notifications.sh`
(disposable Postgres: single claim winner under contention, ON CONFLICT,
guard semantics, FK tenant scoping), and
`tests/containment/eventsResendWebhookDeliveryRealPostgres.test.ts`
(webhook replay/terminal lock against both tables).

## 4. Triggers and recipient

| Type | Scheduled by | Sent |
|---|---|---|
| ORDER_CANCELLED | the cancel transition's own statement (free CONFIRMED order, or a PENDING unpaid reservation cancelled by staff) | one inline attempt in the request, then the recovery run |
| ORDER_REFUNDED | the refund transition's own statement, written only after Stripe confirmed | same |
| EVENT_CANCELLED | the event PATCH route, on a non-cancelled → CANCELLED transition, one bulk statement | up to 10 inline, the rest by the recovery run |
| EVENT_REMINDER | the recovery run, for PUBLISHED events with `reminder_enabled = true` whose start is within 24 h and not past, one per CONFIRMED free/paid order | the recovery run |

Recipient: the order's purchaser only. One row per (type, order) means one
message per inbox per order; attendee-level communication is deferred
(§8). A purchaser with several orders for one cancelled event receives one
message per order (each carries its own order reference and refund state).

Not scheduled on purpose: `checkout.session.expired` (abandoned checkout),
`payment_intent.payment_failed`, and a manual free-order cancel of an
order whose purchaser email is blank.

## 5. Content rules

Templates (`lib/events/lifecycleEmail.ts`) are factual and neutral, with
HTML and a plain-text alternative (`sendEmail` gained an optional `text`
field, forwarded only when supplied). Amounts come solely from the
order's committed snapshot (`payment_total_cents`, `refunded_cents`,
`platform_fee_refunded_cents`, `fee_label`) — no fee policy is re-read.
A refund email never claims settlement timing and is never called a tax
invoice or credit note. An event-cancelled email states the order's
**actual** refund state at send time (refunded / paid but not yet
refunded / free / unpaid) and never promises a refund. Branding is the
organisation's own: the ticket-email projection plus the configured
support email/phone (`normaliseLifecycleEmailBranding`); the templates
hardcode no product name (the shared `emailLayout` shell is inherited
unchanged, as the ticket email inherits it — product-shell branding is a
later layer).

## 6. What this phase deliberately does not do

- Cancelling an event still does **not** cancel orders, invalidate rows
  or refund anyone automatically. Refunds remain one-by-one through the
  refund route. The gap is reported, not hidden; the EVENT_CANCELLED
  email is honest about it.
- No partial refunds, no refund/cancel semantic changes, no SMS, no
  marketing/broadcast, no segmentation, no attendee-level sends.
- No second cron: the existing `/api/cron/ticket-email-recovery` run
  executes `runNotificationRecovery()` after ticket-email recovery, with
  its own bounded batch (50) and time budget (60 s). Its hourly cadence
  is an ops decision outside this phase; a large event cancellation drains
  over several runs.
- No organiser UI for notification history yet (rows are queryable per
  order via `idx_event_notifications_order`).

## 7. Audit

`resource_type = 'event_order'`, `resource_id = order id` (ADR-0003 §10),
notification id/type in `after_state`: `event_order.notification_scheduled`
(human actor for cancel/refund/event-cancel, `user_id NULL` +
`source: scheduled_job:event_reminder` for reminders),
`notification_sent`, `notification_failed` (with `terminal`),
`notification_delivered | bounced | suppressed | complained |
delivery_failed` from the webhook. The event transition gets its own
`event.cancelled` action alongside `event.published`/`event.unpublished`.
No body, subject, token or raw recipient is ever written.

## 8. Deferred

Attendee-level recipients; organiser-visible notification history;
reminder lead-time configuration; recovery cadence; product-shell email
branding; a manual "resend notification" action.
