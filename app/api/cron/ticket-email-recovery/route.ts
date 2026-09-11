import { NextResponse } from 'next/server';
import { runTicketEmailRecovery } from '@/lib/events/ticketEmailRecovery';
import { secureCompare } from '@/lib/secureCompare';

/**
 * GET /api/cron/ticket-email-recovery
 *
 * Phase 3E.2R — revisits pending/due-failed/stale-sending AUTOMATIC
 * ticket-email deliveries (lib/events/ticketEmailRecovery.ts) and
 * terminally sweeps stale-exhausted leases. Generic across free/paid —
 * see that module's own header comment.
 *
 * NOT yet wired to any vercel.json cron schedule — dormant in Production
 * until a separately-approved rollout step adds one. Until then this
 * route only ever runs when explicitly invoked with the correct secret.
 *
 * Protected by CRON_SECRET env var — fails closed: if the secret isn't
 * configured, the endpoint refuses every request rather than running
 * unauthenticated (an absent secret must never mean "open to anyone").
 * Mirrors app/api/cron/sync/route.ts's own authorization convention
 * exactly (same env var, same Bearer-token shape, same secureCompare()
 * timing-safe comparison) — this is Vercel's own documented mechanism
 * for securing a cron-invoked route, not a new auth primitive.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/ticket-email-recovery] CRON_SECRET is not configured — refusing all requests.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!secureCompare(auth, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runTicketEmailRecovery();
    // One safe structured summary line — no ids, no emails, no tokens,
    // no provider bodies, no secret. Per-order detail already lives in
    // the existing event_order.ticket_email_sent/failed audit rows
    // (unchanged by this phase — see runTicketEmailRecovery's own
    // comment); this line is executor-run-level observability only.
    console.log(
      `[events cron/ticket-email-recovery] considered=${summary.considered} claimed=${summary.claimed} ` +
      `sent=${summary.sent} retryable_failed=${summary.retryable_failed} terminal_failed=${summary.terminal_failed} ` +
      `not_claimed=${summary.not_claimed} stale_exhausted_swept=${summary.stale_exhausted_swept} duration_ms=${summary.duration_ms}`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    // Generic, safe error only — deliberately NOT (err as Error).message
    // (unlike cron/sync's own handler): an infrastructure failure here
    // (e.g. the candidate-discovery query itself throwing) must not leak
    // any internal detail through the HTTP response. The real error is
    // still logged server-side for operator visibility.
    console.error('[events cron/ticket-email-recovery] fatal:', err);
    return NextResponse.json({ error: 'Recovery run failed.' }, { status: 500 });
  }
}
