import 'server-only';
import sql from '@/lib/db';

// Phase 5B — lifecycle notification scheduling (the data-model half:
// what gets a row in event_notifications, and when). Sending lives in
// lib/events/notificationDelivery.ts; periodic retry/reminder sweeps in
// lib/events/notificationRecovery.ts; templates in
// lib/events/lifecycleEmail.ts. See scripts/create-events-notifications.sql
// for the schema and the rationale for a dedicated table.
//
// Neutral vocabulary — never product-specific names. Stable: a type is a
// CHECK-constrained literal in the schema, so renaming one is a
// migration, not a code edit.
export const NOTIFICATION_TYPES = ['ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER', 'EVENT_UPDATED'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// event-notification:<TYPE>:<orderId> — deterministic, built from
// already-stable ids only (never a timestamp, claim id, attempt count or
// token), UNIQUE in the schema and handed verbatim to Resend as the
// Idempotency-Key on every attempt. One string therefore prevents
// duplicates at BOTH layers: a second schedule for the same (type,
// order) is an ON CONFLICT no-op, and a retried send after an ambiguous
// outcome is deduplicated by the provider. The SQL in this module and in
// lib/events/services/orderTransitions.ts spells the same shape inline
// ('event-notification:<TYPE>:' || id) because the scheduling INSERTs
// derive it from the row they insert from — the containment suite pins
// every inline spelling to this function.
export const NOTIFICATION_IDEMPOTENCY_PREFIX = 'event-notification:';

export function buildNotificationIdempotencyKey(type: NotificationType, orderId: string): string {
  return `${NOTIFICATION_IDEMPOTENCY_PREFIX}${type}:${orderId}`;
}

// How many freshly-scheduled EVENT_CANCELLED notifications the PATCH
// request itself attempts to send before returning; the rest are
// picked up by the hourly recovery run. Bounded so a large event never
// turns an organiser's save into a minutes-long request.
export const EVENT_CANCELLED_INLINE_SEND_LIMIT = 10;

// Reminder window: a CONFIRMED order for a PUBLISHED, reminder-enabled
// event is scheduled once the event starts within this many hours and
// has not yet started. Code constant, not an env var — an internal
// policy, not a per-environment value.
export const REMINDER_LEAD_HOURS = 24;
export const REMINDER_SCHEDULE_BATCH_SIZE = 200;

// Bulk-schedules EVENT_CANCELLED for every affected order of ONE event,
// in one statement, with the per-order audit rows derived from the
// INSERT's own RETURNING (ADR-0003 §3 atomic form). Re-checks in SQL
// that the event really is CANCELLED now — the caller (the event PATCH
// route) only calls this on a non-cancelled -> CANCELLED transition, but
// the statement never trusts that.
//
// "Affected" = the purchaser still holds something the cancellation
// takes away or needs to know about:
//   * CONFIRMED + NOT_REQUIRED / PAID — a live free or paid booking;
//   * PENDING payment — a reservation mid-checkout (told no payment was
//     taken);
//   * REFUNDED — already refunded before the event was cancelled (told
//     their refund already happened).
// Excluded: EXPIRED / FAILED reservations and manually-cancelled free
// orders — they hold nothing and were never promised anything.
//
// Idempotent by construction: ON CONFLICT (idempotency_key) DO NOTHING,
// so a second PATCH to CANCELLED, a page re-save, or a repeat call
// inserts zero rows and writes zero audit entries. Returns the ids
// actually scheduled by THIS call (never previously-existing ones).
// The recipient in the audit row is masked in SQL exactly like
// lib/events/ticketEmail.ts's maskEmailForAudit ("j***@example.com") —
// first character + '***' + the '@domain' suffix, written without any
// backslash so the expression reads identically in a JS template
// literal, in psql, and in a migration file.
export async function scheduleEventCancelledNotifications(params: {
  organisationId: string;
  eventId: string;
  // The manager whose PATCH cancelled the event — recorded on the audit
  // rows as the human actor, with the automated origin spelled out in
  // after_state.source (ADR-0003 §5).
  actorUserId: string | null;
}): Promise<string[]> {
  const rows = await sql`
    WITH scheduled AS (
      INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
      SELECT eo.organisation_id, eo.event_id, eo.id, 'EVENT_CANCELLED', eo.purchaser_email,
             'event-notification:EVENT_CANCELLED:' || eo.id
      FROM event_orders eo
      JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
      WHERE eo.event_id = ${params.eventId} AND eo.organisation_id = ${params.organisationId}
        AND e.status = 'CANCELLED'
        AND eo.purchaser_email IS NOT NULL AND btrim(eo.purchaser_email) <> ''
        AND (
          (eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID'))
          OR eo.payment_status = 'PENDING'
          OR eo.payment_status = 'REFUNDED'
        )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, organisation_id, order_id, recipient_email
    ),
    audited AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, organisation_id, ${params.actorUserId}::text, 'event_order.notification_scheduled', 'event_order', order_id,
        NULL,
        jsonb_build_object(
          'source', 'event_cancelled',
          'notification_type', 'EVENT_CANCELLED',
          'notification_id', id,
          'recipient_masked', left(recipient_email, 1) || '***' || substring(recipient_email from '@.*$')
        )
      FROM scheduled
      RETURNING resource_id
    )
    SELECT id FROM scheduled
  `;
  return (rows as { id: string }[]).map(r => r.id);
}

// Schedules EVENT_REMINDER for CONFIRMED (free or paid) orders of every
// PUBLISHED, reminder_enabled event whose start falls inside the next
// REMINDER_LEAD_HOURS and has not passed. Called by the periodic
// recovery run only. reminder_enabled defaults to false for every event
// (see the migration), so no existing event is ever selected here until
// an organiser opts it in. Bounded per run; the NOT EXISTS guard keeps
// the LIMIT from being spent on orders that are already scheduled (the
// UNIQUE constraint remains the authority — ON CONFLICT DO NOTHING).
export async function scheduleEventReminderNotifications(limit: number = REMINDER_SCHEDULE_BATCH_SIZE): Promise<string[]> {
  const rows = await sql`
    WITH scheduled AS (
      INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key)
      SELECT eo.organisation_id, eo.event_id, eo.id, 'EVENT_REMINDER', eo.purchaser_email,
             'event-notification:EVENT_REMINDER:' || eo.id
      FROM event_orders eo
      JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
      WHERE e.reminder_enabled = true
        AND e.status = 'PUBLISHED'
        AND e.starts_at > NOW()
        AND e.starts_at <= NOW() + make_interval(hours => ${REMINDER_LEAD_HOURS})
        AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
        AND eo.purchaser_email IS NOT NULL AND btrim(eo.purchaser_email) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM event_notifications n
          WHERE n.idempotency_key = 'event-notification:EVENT_REMINDER:' || eo.id
        )
      ORDER BY e.starts_at ASC, eo.created_at ASC
      LIMIT ${limit}
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, organisation_id, order_id, recipient_email
    ),
    audited AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, organisation_id, NULL, 'event_order.notification_scheduled', 'event_order', order_id,
        NULL,
        jsonb_build_object(
          'source', 'scheduled_job:event_reminder',
          'notification_type', 'EVENT_REMINDER',
          'notification_id', id,
          'recipient_masked', left(recipient_email, 1) || '***' || substring(recipient_email from '@.*$')
        )
      FROM scheduled
      RETURNING resource_id
    )
    SELECT id FROM scheduled
  `;
  return (rows as { id: string }[]).map(r => r.id);
}

// A reminder that was scheduled but can no longer be sent honestly (the
// event was cancelled, unpublished, had reminders switched off or has
// already started; the order was cancelled or refunded) is closed out as
// a terminal 'failed' with a readable reason rather than left 'pending'
// for every recovery run to re-consider forever. Never touches a
// 'sending' row (a live lease), an already-terminal row, or any other
// type: a cancellation/refund/event-cancelled message states historical
// facts that remain true. Bounded; returns how many were closed.
export async function expireIneligibleReminderNotifications(limit: number = REMINDER_SCHEDULE_BATCH_SIZE): Promise<number> {
  const rows = await sql`
    UPDATE event_notifications
    SET status = 'failed', next_attempt_at = NULL, failed_at = NOW(), updated_at = NOW(),
        last_error = 'Reminder no longer applicable: the event or order changed before it was sent.'
    WHERE id IN (
      SELECT n.id FROM event_notifications n
      WHERE n.notification_type = 'EVENT_REMINDER'
        AND (n.status = 'pending' OR (n.status = 'failed' AND n.next_attempt_at IS NOT NULL))
        AND NOT EXISTS (
          SELECT 1 FROM event_orders eo
          JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
          WHERE eo.id = n.order_id AND eo.organisation_id = n.organisation_id
            AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
            AND e.status = 'PUBLISHED' AND e.reminder_enabled = true AND e.starts_at > NOW()
        )
      LIMIT ${limit}
    )
    RETURNING id
  `;
  return rows.length;
}

// ── EVENT_UPDATED — material date / time / venue change ──────────────────
//
// Buyer-safe payload stored in event_notifications.payload (JSON object):
// ONLY the before/after of the three material fields and the committed change
// version. Never purchaser data, tokens, secrets or internal configuration.
export type EventUpdatedSnapshot = { starts_at: string; ends_at: string; venue: string | null };
export type EventUpdatedPayload = {
  before: EventUpdatedSnapshot;
  after: EventUpdatedSnapshot;
  change_version: string;
};

// event-notification:EVENT_UPDATED:<orderId>:<committed event version>.
// The version is the events row's own updated_at (epoch microseconds) written
// by the very UPDATE that made the change — NOT a hash of the new values, so a
// replay of the same committed change is a no-op while a later distinct change
// (including reverting to an earlier date, time or venue) is a new notice.
export function buildEventUpdatedIdempotencyKey(orderId: string, changeVersion: string): string {
  return `${NOTIFICATION_IDEMPOTENCY_PREFIX}EVENT_UPDATED:${orderId}:${changeVersion}`;
}

// Bounded like EVENT_CANCELLED: the PATCH sends this many inline, the hourly
// recovery run delivers the rest.
export const EVENT_UPDATED_INLINE_SEND_LIMIT = 10;

// Schedules EVENT_UPDATED for every ELIGIBLE order of ONE event in one
// idempotent statement (rows + audit). Eligible = the same live bookings an
// EVENT_REMINDER goes to: CONFIRMED with NOT_REQUIRED / PAID payment, a
// non-empty purchaser email, created BEFORE the change (an order placed after
// it already saw the new details). Cancelled, refunded, expired, pending and
// failed orders are never notified, and nothing is scheduled unless the event
// is PUBLISHED now. changedAt is the committed events.updated_at as text.
export async function scheduleEventUpdatedNotifications(params: {
  organisationId: string;
  eventId: string;
  actorUserId: string | null;
  payload: EventUpdatedPayload;
  changedAt: string;
}): Promise<string[]> {
  const payloadJson = JSON.stringify(params.payload);
  const version = params.payload.change_version;
  const rows = await sql`
    WITH scheduled AS (
      INSERT INTO event_notifications (organisation_id, event_id, order_id, notification_type, recipient_email, idempotency_key, payload)
      SELECT eo.organisation_id, eo.event_id, eo.id, 'EVENT_UPDATED', eo.purchaser_email,
             'event-notification:EVENT_UPDATED:' || eo.id || ':' || ${version}::text,
             ${payloadJson}::jsonb
      FROM event_orders eo
      JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
      WHERE eo.event_id = ${params.eventId} AND eo.organisation_id = ${params.organisationId}
        AND e.status = 'PUBLISHED'
        AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
        AND eo.purchaser_email IS NOT NULL AND btrim(eo.purchaser_email) <> ''
        AND eo.created_at < ${params.changedAt}::timestamptz
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, organisation_id, order_id, recipient_email
    ),
    audited AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, organisation_id, ${params.actorUserId}::text, 'event_order.notification_scheduled', 'event_order', order_id,
        NULL,
        jsonb_build_object(
          'source', 'event_updated',
          'notification_type', 'EVENT_UPDATED',
          'notification_id', id,
          'recipient_masked', left(recipient_email, 1) || '***' || substring(recipient_email from '@.*$')
        )
      FROM scheduled
      RETURNING resource_id
    )
    SELECT id FROM scheduled
  `;
  return (rows as { id: string }[]).map(r => r.id);
}

// An EVENT_UPDATED that can no longer be sent honestly (the order was
// cancelled or refunded, or the event is no longer published) is closed out
// as a terminal 'failed' with a readable reason rather than retried forever.
// Mirrors expireIneligibleReminderNotifications; never touches 'sending' rows
// or other types.
export async function expireIneligibleEventUpdatedNotifications(limit: number = REMINDER_SCHEDULE_BATCH_SIZE): Promise<number> {
  const rows = await sql`
    UPDATE event_notifications
    SET status = 'failed', next_attempt_at = NULL, failed_at = NOW(), updated_at = NOW(),
        last_error = 'Event update notice no longer applicable: the event or order changed before it was sent.'
    WHERE id IN (
      SELECT n.id FROM event_notifications n
      WHERE n.notification_type = 'EVENT_UPDATED'
        AND (n.status = 'pending' OR (n.status = 'failed' AND n.next_attempt_at IS NOT NULL))
        AND NOT EXISTS (
          SELECT 1 FROM event_orders eo
          JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
          WHERE eo.id = n.order_id AND eo.organisation_id = n.organisation_id
            AND eo.status = 'CONFIRMED' AND eo.payment_status IN ('NOT_REQUIRED', 'PAID')
            AND e.status = 'PUBLISHED'
        )
      LIMIT ${limit}
    )
    RETURNING id
  `;
  return rows.length;
}
