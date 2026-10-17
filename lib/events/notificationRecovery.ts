import 'server-only';
import sql from '@/lib/db';
import { LEASE_TIMEOUT_MINUTES, MAX_ATTEMPTS } from './ticketEmailDelivery';
import { attemptNotificationDelivery, sweepStaleExhaustedNotificationLeases } from './notificationDelivery';
import { scheduleEventReminderNotifications, expireIneligibleReminderNotifications } from './notifications';

// Phase 5B — periodic executor for event_notifications, run by the SAME
// CRON_SECRET-protected route and vercel.json schedule as ticket-email
// recovery (app/api/cron/ticket-email-recovery/route.ts) — no second
// cron. lib/events/ticketEmailRecovery.ts is untouched: this module is
// a sibling with the same shape (bounded id-only candidate discovery,
// sequential attempts, non-identifying counters), not a generalisation
// of it, so the existing ticket-email path cannot regress.
//
// Sequence per run:
//   1. sweepStaleExhaustedNotificationLeases — close out stale 'sending'
//      rows already at MAX_ATTEMPTS.
//   2. expireIneligibleReminderNotifications — close out reminders whose
//      event/order no longer qualifies.
//   3. scheduleEventReminderNotifications — insert reminders for
//      reminder-enabled events now inside their send window.
//   4. findNotificationRecoveryCandidateIds — one bounded batch of
//      pending / due-failed / stale-sending ids.
//   5. attemptNotificationDelivery per candidate, sequentially, until the
//      batch is exhausted or the time budget is spent (an event
//      cancellation can schedule hundreds of rows at once; the remainder
//      simply waits for the next run — a bounded, predictable cron body
//      beats one that runs until the platform kills it).

export const NOTIFICATION_RECOVERY_BATCH_SIZE = 50;
export const NOTIFICATION_RECOVERY_TIME_BUDGET_MS = 60_000;

// Id-only, bounded, NULL-free: every branch tests an explicit status.
export async function findNotificationRecoveryCandidateIds(limit: number = NOTIFICATION_RECOVERY_BATCH_SIZE): Promise<string[]> {
  const rows = await sql`
    SELECT id FROM event_notifications
    WHERE scheduled_for <= NOW()
      AND (
        status = 'pending'
        OR (
          status = 'failed'
          AND attempt_count < ${MAX_ATTEMPTS}
          AND next_attempt_at <= NOW()
        )
        OR (
          status = 'sending'
          AND claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})
          AND attempt_count < ${MAX_ATTEMPTS}
        )
      )
    ORDER BY next_attempt_at ASC NULLS FIRST, scheduled_for ASC, id ASC
    LIMIT ${limit}
  `;
  return (rows as { id: string }[]).map(r => r.id);
}

export type NotificationRecoverySummary = {
  considered: number;
  claimed: number;
  sent: number;
  retryable_failed: number;
  terminal_failed: number;
  not_claimed: number;
  stale_exhausted_swept: number;
  reminders_scheduled: number;
  reminders_expired: number;
  deferred_time_budget: number;
  duration_ms: number;
};

export async function runNotificationRecovery(now: () => number = Date.now): Promise<NotificationRecoverySummary> {
  const startedAt = now();

  const stale_exhausted_swept = await sweepStaleExhaustedNotificationLeases(NOTIFICATION_RECOVERY_BATCH_SIZE);
  const reminders_expired = await expireIneligibleReminderNotifications();
  const reminders_scheduled = (await scheduleEventReminderNotifications()).length;

  const candidateIds = await findNotificationRecoveryCandidateIds();

  const summary: NotificationRecoverySummary = {
    considered: candidateIds.length,
    claimed: 0,
    sent: 0,
    retryable_failed: 0,
    terminal_failed: 0,
    not_claimed: 0,
    stale_exhausted_swept,
    reminders_scheduled,
    reminders_expired,
    deferred_time_budget: 0,
    duration_ms: 0,
  };

  for (let i = 0; i < candidateIds.length; i++) {
    if (now() - startedAt > NOTIFICATION_RECOVERY_TIME_BUDGET_MS) {
      summary.deferred_time_budget = candidateIds.length - i;
      break;
    }
    try {
      const outcome = await attemptNotificationDelivery(candidateIds[i]);
      if (outcome.outcome === 'not_claimed') {
        summary.not_claimed++;
      } else if (outcome.outcome === 'sent') {
        summary.claimed++;
        summary.sent++;
      } else {
        summary.claimed++;
        if (outcome.terminal) summary.terminal_failed++;
        else summary.retryable_failed++;
      }
    } catch (err) {
      console.error('[events] notification recovery: unexpected per-candidate error', err);
      summary.not_claimed++;
    }
  }

  summary.duration_ms = now() - startedAt;
  return summary;
}
