import 'server-only';
import sql from '@/lib/db';
import {
  MAX_ATTEMPTS,
  LEASE_TIMEOUT_MINUTES,
  attemptAutomaticTicketEmail,
  sweepStaleExhaustedTicketEmailLeases,
} from './ticketEmailDelivery';

// Phase 3E.2R — generic recovery executor for AUTOMATIC ticket-email
// delivery. Reached only via the CRON_SECRET-authenticated route in
// app/api/cron/ticket-email-recovery/route.ts (see that file's own
// comment) — not yet wired to any vercel.json cron schedule.
//
// This module introduces NO new send/claim/mark logic. Candidate
// discovery below is a plain, bounded SELECT of order ids ONLY — it
// grants no ownership whatsoever. The only thing that can actually claim
// and act on an order is attemptAutomaticTicketEmail() (imported
// unchanged from ./ticketEmailDelivery), called once per candidate
// exactly the same way the free-registration route already calls it.
// Every condition in findTicketEmailRecoveryCandidateOrderIds() below is
// a SUBSET of what claimTicketEmailDelivery() itself re-checks inside
// its own atomic UPDATE (order status='CONFIRMED', payment_status,
// purchaser_email, attendee ticket_token existence — none of which this
// file re-derives) — candidate discovery may therefore be broader than
// what is actually claimable; the claim remains the sole authority. A
// candidate id that is no longer actually claimable by the time
// attemptAutomaticTicketEmail() runs (raced by a concurrent worker, or
// its own eligibility changed) simply comes back 'not_claimed', never an
// error.
//
// Generic by design: this file has no knowledge of "free" vs "paid" —
// it simply revisits whatever orders already carry a non-NULL,
// currently-claimable ticket_email_status. A later, separately-approved
// phase that starts scheduling paid orders (3E.3) can reuse this exact
// executor without any change here — this phase does not schedule any
// paid order itself (see this file's own containment tests).

export const RECOVERY_BATCH_SIZE = 20;

// Bounded, id-only candidate discovery. Deliberately selects NOTHING but
// `id` — no purchaser email, no tokens, no branding, no claim id —
// candidate discovery only decides WHICH orders to attempt next; it
// never reads or exposes anything sensitive.
//
// ticket_email_status IS NULL is excluded — structurally impossible for
// this query to ever select a NULL row: every branch below tests an
// explicit non-NULL value ('pending', 'failed', or 'sending'). See this
// file's own NULL-safety containment test.
//
// Ordering: NULLS FIRST on next_attempt_at puts 'pending' rows (whose
// next_attempt_at is always NULL — see the 3E.1 schema's own column
// comment) first, then oldest-due-first for 'failed'/'sending' rows —
// a backlog drains fairly rather than starving old rows behind newly-
// failed ones. `id ASC` is a stable tie-break only, not a priority rule.
export async function findTicketEmailRecoveryCandidateOrderIds(limit: number = RECOVERY_BATCH_SIZE): Promise<string[]> {
  const rows = await sql`
    SELECT id FROM event_orders
    WHERE
      ticket_email_status = 'pending'
      OR (
        ticket_email_status = 'failed'
        AND ticket_email_attempt_count < ${MAX_ATTEMPTS}
        AND ticket_email_next_attempt_at <= NOW()
      )
      OR (
        ticket_email_status = 'sending'
        AND ticket_email_claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})
        AND ticket_email_attempt_count < ${MAX_ATTEMPTS}
      )
    ORDER BY ticket_email_next_attempt_at ASC NULLS FIRST, id ASC
    LIMIT ${limit}
  `;
  return (rows as { id: string }[]).map(r => r.id);
}

// No ids, no emails, no tokens, no claim ids, no provider bodies — only
// bounded, non-identifying counts. This is exactly the shape returned to
// the cron route's own HTTP response (see that file).
export type TicketEmailRecoverySummary = {
  considered: number;
  claimed: number;
  sent: number;
  retryable_failed: number;
  terminal_failed: number;
  not_claimed: number;
  stale_exhausted_swept: number;
  duration_ms: number;
};

// The one composition function the cron route calls. Sequence (fixed,
// deliberate order):
//   1. sweepStaleExhaustedTicketEmailLeases() FIRST — terminally closes
//      out stale 'sending' rows already at MAX_ATTEMPTS. These were
//      never eligible to be selected by step 2's candidate query anyway
//      (that query's own 'sending' branch requires attempt_count <
//      MAX_ATTEMPTS), so this ordering is about reaching a clean
//      terminal state promptly, not about avoiding a double-count race.
//   2. findTicketEmailRecoveryCandidateOrderIds() — one bounded batch.
//   3. attemptAutomaticTicketEmail(orderId) per candidate, sequentially.
//
// Sequential, not Promise.all — matches this repo's own established
// batch-processing convention (lib/integrations/syncEngine.ts's own
// runAllSyncs(): a plain for...of loop, one try/catch per item, a
// running tally, never a single failure aborting the batch).
// attemptAutomaticTicketEmail() itself already never throws (see its own
// header comment) — the try/catch below is defense in depth, matching
// runAllSyncs()'s identical discipline against its own already-safe
// callee. An unreachable unexpected error here is tallied as
// not_claimed (conservative — we do not know a claim was actually won)
// rather than aborting the remaining candidates.
export async function runTicketEmailRecovery(): Promise<TicketEmailRecoverySummary> {
  const startedAt = Date.now();

  const stale_exhausted_swept = await sweepStaleExhaustedTicketEmailLeases(RECOVERY_BATCH_SIZE);

  const candidateIds = await findTicketEmailRecoveryCandidateOrderIds();

  const summary: TicketEmailRecoverySummary = {
    considered: candidateIds.length,
    claimed: 0,
    sent: 0,
    retryable_failed: 0,
    terminal_failed: 0,
    not_claimed: 0,
    stale_exhausted_swept,
    duration_ms: 0,
  };

  for (const orderId of candidateIds) {
    try {
      const outcome = await attemptAutomaticTicketEmail(orderId);
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
      console.error('[events] ticket-email recovery: unexpected per-candidate error', err);
      summary.not_claimed++;
    }
  }

  summary.duration_ms = Date.now() - startedAt;
  return summary;
}
