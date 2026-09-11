import 'server-only';
import sql from '@/lib/db';
import { sendTicketEmail, maskEmailForAudit } from './ticketEmail';
import { normaliseTicketEmailBranding } from '@/lib/organisations/branding';
import { logAutomaticTicketEmailSent, logAutomaticTicketEmailFailed } from './auditLog';

// Phase 3E.1 — durable, lease-based foundation for AUTOMATIC initial
// ticket-email delivery: the claim/success/failure/stale-lease
// primitives. Phase 3E.2 adds the orchestration wrapper
// (attemptAutomaticTicketEmail, at the bottom of this file) and wires
// it to its first caller: the public free-registration route, post-
// commit (see that route's own comment). Paid orders are explicitly
// OUT of scope for 3E.2/3E.2R — lib/events/stripe.ts does not call
// anything in this file yet; that remains a later, separately-approved
// 3E.3.
//
// Phase 3E.2R adds lib/events/ticketEmailRecovery.ts as a SECOND caller
// of attemptAutomaticTicketEmail (and the first real caller of
// sweepStaleExhaustedTicketEmailLeases, previously test-invocable only)
// — a bounded, periodically-invoked executor that revisits pending/due-
// failed/stale-sending orders. No new send/claim/mark logic was added
// for this: the recovery executor is purely a second, periodic CALLER
// of the exact same primitives already defined below. Every order's
// ticket_email_status still stays NULL forever unless an explicit INSERT
// schedules it (currently only the free-registration route's own INSERT
// — see the register route) — NULL remains structurally unclaimable
// (see claimTicketEmailDelivery's own comment) for every pre-existing
// and every paid order alike, regardless of how often the recovery
// executor runs.
//
// State machine (full column-by-column rationale lives in
// scripts/add-events-ticket-email-delivery.sql's header comment):
//
//   NULL -> pending -> sending -> sent                    (happy path)
//                         |
//                         +-> failed -> sending (retry, if attempts
//                                       remain and retry-after elapsed)
//                         |
//                         +-> failed (terminal: MAX_ATTEMPTS reached, OR
//                                     an idempotency payload-mismatch
//                                     outcome — see markTicketEmailFailed)
//
// Claim ownership: ticket_email_claim_id (a per-attempt
// crypto.randomUUID(), matching the exact pattern
// lib/events/auditLog.ts's insertAuditLog() already uses for its own id
// column), never ticket_email_claimed_at. A TIMESTAMPTZ value round-
// tripped through a JS Date loses microsecond precision, which is not a
// safe basis for "is this still MY claim" equality comparison — an
// opaque, exactly-string-compared token has no such ambiguity. Every
// completion write (success or failure) is guarded on BOTH
// status='sending' AND an exact claim_id match, so a worker whose lease
// has already expired and been reclaimed by someone else can never
// mutate the newer claim's state (see markTicketEmailSent/
// markTicketEmailFailed — an empty RETURNING there means the claim was
// already superseded, which is an expected, benign outcome, not an
// error).

export const LEASE_TIMEOUT_MINUTES = 10;
export const MAX_ATTEMPTS = 3;

// Keyed by attempt number (the value ticket_email_attempt_count holds
// immediately after the claim that is now failing) — attempt 1's
// failure schedules a retry 5 minutes out, attempt 2's failure 30
// minutes out. Attempt 3 (== MAX_ATTEMPTS) has no entry: see
// markTicketEmailFailed's CASE expression, which falls through to NULL
// (terminal) once attempt_count >= MAX_ATTEMPTS. Kept as code constants,
// not env vars — this is an internal retry policy, not a per-
// environment/secret value, matching this repo's own "only add env vars
// actually required by the chosen architecture" discipline.
export const RETRY_BACKOFF_MINUTES: Readonly<Record<number, number>> = {
  1: 5,
  2: 30,
};

// event-ticket-email-initial:<orderId> — deterministic, stable, and
// takes ONLY the order's own already-stable id as input. The same order
// therefore always produces the exact same key on every automatic
// attempt and every recovery, for as long as that order exists — never
// includes ticket_token, booking_token, claim_id, attempt_count, or any
// timestamp (a function that only accepts an orderId string cannot
// structurally include any of those). event_orders.id is a
// gen_random_uuid()::text value (36 chars); this key is always well
// under Resend's documented idempotency-key length limit.
//
// PAYLOAD-STABILITY RULE (critical — read before changing anything that
// touches this key): Resend binds an idempotency key to the exact
// request payload it was first used with; reusing the same key with a
// genuinely different payload returns a mismatch condition rather than
// sending a second email or silently accepting the new payload. This
// key must therefore NEVER be rotated/changed merely to force another
// send attempt — see markTicketEmailFailed's own handling of the
// 'idempotency_payload_mismatch' reason for what happens when a retry's
// payload has, in fact, changed (e.g. because mutable organisation
// branding changed between attempts): that outcome is terminal for
// automatic delivery, not a reason to mint a new key.
export function buildInitialTicketEmailIdempotencyKey(orderId: string): string {
  return `event-ticket-email-initial:${orderId}`;
}

export type TicketEmailDeliveryClaim = {
  orderId: string;
  claimId: string;
  attemptCount: number;
};

// The single atomic claim — ONE conditional UPDATE ... RETURNING, never
// a SELECT-then-UPDATE (matches this codebase's own established
// idempotent-claim idiom, e.g. lib/events/stripe.ts's
// payment_status = 'PENDING' guard). Only a caller receiving a non-null
// result may proceed to read order details and call the provider.
//
// orderId-only signature (no organisationId parameter) — deliberately
// matches this file's true siblings, lib/events/stripe.ts's
// issueTicketTokensForPaidOrder() and issueBookingTokenForPaidOrder(),
// which are also internal (never route/client-facing) helpers keyed
// only on the order's own globally-unique primary key plus their own
// state-guard conditions. This function is never exposed through any
// route, cron, or UI in this phase (see this file's own header
// comment) — a future caller that already has organisationId (the
// free-registration route, the Stripe webhook) simply doesn't need to
// pass it again for correctness, since `id` alone already uniquely
// identifies one row.
//
// Claimable states — NULL is excluded from every branch below. This is
// the single most important correctness property in this file: see
// scripts/add-events-ticket-email-delivery.sql's own header comment for
// why treating NULL as claimable would risk auto-emailing historical
// purchasers the moment a recovery worker existed.
//
// The eligibility block (status/payment_status/purchaser_email/attendee
// ticket_token existence) matches
// lib/events/ticketEmailEligibility.ts's isOrderEligibleForTicketEmail()
// exactly — that JS predicate cannot run inside a SQL WHERE clause, so
// this is its SQL-native equivalent, re-evaluated fresh on every claim
// attempt rather than trusted from any earlier read. Inlined directly
// here (rather than factored into a separately-composed `sql` fragment,
// the pattern lib/events/registrationFilters.ts's
// buildRegistrationFilterSql() uses) because this phase has exactly one
// call site for it — a separate fragment would only add indirection
// (and, under this repo's own vi.fn()-based sql mock, an extra
// untestable mock call) without an actual second consumer to justify
// it yet. A CANCELLED order (which is also what refund/cancel always
// set — see app/api/events/[id]/orders/[orderId]/cancel/route.ts and
// .../refund/route.ts, both of which set status='CANCELLED') fails the
// `status = 'CONFIRMED'` condition below and is therefore never
// claimable, regardless of what ticket_email_status previously said.
//
// The 'failed' branch's own retry-due check is deliberately
// `ticket_email_next_attempt_at <= NOW()` — NOT `... IS NULL OR ... <=
// NOW()`. A 'failed' row's next_attempt_at is ALWAYS explicitly set by
// markTicketEmailFailed (never left "not yet computed"): NULL there
// means TERMINAL (either MAX_ATTEMPTS was reached, or an idempotency
// payload mismatch forced immediate termination regardless of
// attempt_count — see markTicketEmailFailed's own forceTerminal
// comment). In Postgres, `NULL <= NOW()` evaluates to NULL, which WHERE
// treats as not-true, so the bare `<= NOW()` already correctly excludes
// a terminal NULL row on its own — no `IS NULL OR` is needed. An
// earlier version of this file DID include that `IS NULL OR` clause,
// which was a real bug caught during isolated Preview verification: it
// made `next_attempt_at IS NULL` evaluate to TRUE, silently allowing a
// payload-mismatch-terminated order (still attempt_count < MAX_ATTEMPTS)
// to be reclaimed and automatically retried — exactly what the
// payload-stability rule (§13) forbids. See this file's own
// REGRESSION-labelled test in eventsTicketEmailDelivery.test.ts.
export async function claimTicketEmailDelivery(orderId: string): Promise<TicketEmailDeliveryClaim | null> {
  const claimId = crypto.randomUUID();

  const rows = await sql`
    UPDATE event_orders
    SET
      ticket_email_status = 'sending',
      ticket_email_claim_id = ${claimId},
      ticket_email_claimed_at = NOW(),
      ticket_email_last_attempt_at = NOW(),
      ticket_email_attempt_count = ticket_email_attempt_count + 1,
      ticket_email_next_attempt_at = NULL
    WHERE id = ${orderId}
      AND event_orders.status = 'CONFIRMED'
      AND event_orders.payment_status IN ('NOT_REQUIRED', 'PAID')
      AND event_orders.purchaser_email IS NOT NULL
      AND trim(event_orders.purchaser_email) <> ''
      AND EXISTS (
        SELECT 1 FROM event_attendees ea
        WHERE ea.order_id = event_orders.id
          AND ea.organisation_id = event_orders.organisation_id
          AND ea.ticket_token IS NOT NULL
      )
      AND (
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
      )
    RETURNING id, ticket_email_claim_id, ticket_email_attempt_count
  `;
  if (!rows.length) return null;

  const row = rows[0] as { id: string; ticket_email_claim_id: string; ticket_email_attempt_count: number };
  return { orderId: row.id, claimId: row.ticket_email_claim_id, attemptCount: row.ticket_email_attempt_count };
}

export type ClaimedOrderForDelivery = {
  id: string;
  organisationId: string;
  purchaserName: string;
  purchaserEmail: string;
  eventName: string;
  bookingToken: string | null;
  attendees: { name: string; ticketToken: string }[];
  // Phase 3E.2 — organisation identity/settings for
  // normaliseTicketEmailBranding(), the exact same raw values (name +
  // settings JSON) the existing resend-ticket-email route already reads
  // and normalises the exact same way — no new branding resolution
  // logic, no duplicated raw-settings parsing.
  organisationName: string;
  organisationSettings: unknown;
};

// Trusted server-side read AFTER winning the claim (§10 of this phase's
// own architecture report) — attendee/ticket/booking-token data is
// intentionally NOT returned directly from the claim UPDATE itself,
// which would make that statement unnecessarily large just to avoid
// one safe follow-up read. This does NOT weaken claim exclusivity:
// the WHERE clause below still requires ticket_email_status='sending'
// AND an exact claim_id match, so only the caller that just won this
// exact claim can ever see this data — the same guarantee the
// UPDATE itself already provides, re-asserted defensively rather than
// assumed. Mirrors the existing resend-ticket-email route's own read
// query shape almost exactly (same JOIN structure, now including the
// same organisations JOIN that route already uses for branding), for
// consistency. Never called from, or exposed to, any client-facing
// route — this is server-only data for the delivery helper's own
// internal use.
export async function readClaimedOrderForDelivery(orderId: string, claimId: string): Promise<ClaimedOrderForDelivery | null> {
  const rows = await sql`
    SELECT
      eo.id, eo.organisation_id, eo.purchaser_name, eo.purchaser_email, eo.booking_token,
      e.name AS event_name,
      o.name AS organisation_name, o.settings AS organisation_settings,
      COALESCE(
        json_agg(json_build_object('name', ea.attendee_name, 'ticket_token', ea.ticket_token))
          FILTER (WHERE ea.id IS NOT NULL AND ea.ticket_token IS NOT NULL),
        '[]'
      ) AS attendees
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    JOIN organisations o ON o.id = eo.organisation_id
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    WHERE eo.id = ${orderId} AND eo.ticket_email_status = 'sending' AND eo.ticket_email_claim_id = ${claimId}
    GROUP BY eo.id, e.name, o.name, o.settings
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as {
    id: string; organisation_id: string; purchaser_name: string; purchaser_email: string; booking_token: string | null;
    event_name: string; organisation_name: string; organisation_settings: unknown;
    attendees: { name: string; ticket_token: string }[];
  };
  return {
    id: row.id,
    organisationId: row.organisation_id,
    purchaserName: row.purchaser_name,
    purchaserEmail: row.purchaser_email,
    eventName: row.event_name,
    bookingToken: row.booking_token,
    attendees: row.attendees.map(a => ({ name: a.name, ticketToken: a.ticket_token })),
    organisationName: row.organisation_name,
    organisationSettings: row.organisation_settings,
  };
}

// Guarded success transition. Empty RETURNING means the claim was
// already superseded (reclaimed by stale-lease recovery, or already
// swept) — an EXPECTED, benign outcome under this design (see
// buildInitialTicketEmailIdempotencyKey's own comment: whichever worker
// eventually owns the order will present the same deterministic key to
// Resend, so no duplicate delivery results even when this exact write
// loses the race), never an error condition. Callers must not overwrite
// newer state and must not retry the provider call on an empty result.
export async function markTicketEmailSent(orderId: string, claimId: string, providerMessageId: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE event_orders
    SET
      ticket_email_status = 'sent',
      ticket_email_claimed_at = NULL,
      ticket_email_claim_id = NULL,
      ticket_email_sent_at = NOW(),
      ticket_email_provider_message_id = ${providerMessageId},
      ticket_email_next_attempt_at = NULL,
      ticket_email_last_error = NULL
    WHERE id = ${orderId}
      AND ticket_email_status = 'sending'
      AND ticket_email_claim_id = ${claimId}
    RETURNING id
  `;
  return rows.length > 0;
}

// Why the provider actually failed, classified by the caller (never
// derived from a raw provider payload stored here). attempt_count is
// NEVER incremented in this function — it was already incremented by
// claimTicketEmailDelivery() for the attempt that is now failing; this
// transition only reads that already-current value to decide the next
// backoff step.
export type TicketEmailFailureReason =
  | 'provider_rejected'   // Case A — a definite provider rejection.
  | 'ambiguous_outcome'   // Case C — network timeout / unclear result.
  // §13's payload-stability rule: Resend reported that this exact
  // idempotency key was already used with a DIFFERENT request payload.
  // Retrying with the SAME key would just repeat the mismatch, and
  // minting a NEW key to force another send would defeat provider
  // duplicate protection (explicitly forbidden — see
  // buildInitialTicketEmailIdempotencyKey's own comment). This reason
  // therefore ALWAYS forces an immediate terminal failure regardless of
  // attempt_count, never a scheduled automatic retry — only a
  // completely separate, human-triggered manual resend (§O — which
  // never uses this idempotency key at all) can recover from it.
  | 'idempotency_payload_mismatch'
  // Phase 3E.2 — sendEmail() resolved with status 'not_configured'
  // (RESEND_API_KEY absent, e.g. a Preview environment): no network
  // request was made at all, so this is neither a provider rejection
  // nor a genuinely ambiguous outcome — it is a known, definite
  // environment-configuration gap. Deliberately NOT forceTerminal:
  // configuration may become available later (e.g. once Production env
  // vars are set, or if a Preview environment temporarily lacks the
  // key), so this follows the SAME retryable backoff schedule as
  // 'provider_rejected'/'ambiguous_outcome' — only
  // 'idempotency_payload_mismatch' is ever forced terminal.
  | 'not_configured';

export async function markTicketEmailFailed(
  orderId: string,
  claimId: string,
  reason: TicketEmailFailureReason,
  errorMessage: string,
): Promise<boolean> {
  // Bounded, pre-classified diagnostic only — never a raw provider
  // response body, stack trace, or any token. See
  // scripts/add-events-ticket-email-delivery.sql's own column comment;
  // 300 here, 500 is the CHECK constraint's defensive backstop.
  const boundedError = errorMessage.slice(0, 300);
  const forceTerminal = reason === 'idempotency_payload_mismatch';

  const rows = await sql`
    UPDATE event_orders
    SET
      ticket_email_status = 'failed',
      ticket_email_claimed_at = NULL,
      ticket_email_claim_id = NULL,
      ticket_email_last_error = ${boundedError},
      ticket_email_next_attempt_at = CASE
        WHEN ${forceTerminal} THEN NULL
        WHEN ticket_email_attempt_count >= ${MAX_ATTEMPTS} THEN NULL
        WHEN ticket_email_attempt_count = 1 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[1]})
        WHEN ticket_email_attempt_count = 2 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[2]})
        ELSE NULL
      END
    WHERE id = ${orderId}
      AND ticket_email_status = 'sending'
      AND ticket_email_claim_id = ${claimId}
    RETURNING id
  `;
  return rows.length > 0;
}

// Separate, narrower, NON-claiming cleanup for the one gap a plain
// lease cannot otherwise close: a worker that dies on its FINAL
// (MAX_ATTEMPTS-th) attempt leaves a 'sending' row that the claim
// query's own stale-lease branch will never touch again (it explicitly
// requires attempt_count < MAX_ATTEMPTS to reclaim). Without this sweep
// such a row would display 'sending' forever — neither an honest
// 'failed' nor a 'sent' — which is misleading for observability and
// leaves no path to a clean terminal state. This function grants NO new
// claim and does NOT increment attempt_count; it only transitions an
// exhausted, stale lease straight to terminal 'failed'.
//
// Bounded-batch. Phase 3E.2R gives this its first real caller —
// lib/events/ticketEmailRecovery.ts's runTicketEmailRecovery() calls
// this FIRST, before candidate discovery (see that module's own
// comment for why) — reached only via the CRON_SECRET-authenticated
// route in app/api/cron/ticket-email-recovery/route.ts, which is not
// yet wired to any vercel.json cron schedule (dormant until a
// separately-approved rollout step adds one).
export async function sweepStaleExhaustedTicketEmailLeases(limit: number = 20): Promise<number> {
  const rows = await sql`
    UPDATE event_orders
    SET
      ticket_email_status = 'failed',
      ticket_email_claimed_at = NULL,
      ticket_email_claim_id = NULL,
      ticket_email_last_error = 'Lease expired after maximum attempts; delivery outcome unknown.',
      ticket_email_next_attempt_at = NULL
    WHERE id IN (
      SELECT id FROM event_orders
      WHERE ticket_email_status = 'sending'
        AND ticket_email_claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})
        AND ticket_email_attempt_count >= ${MAX_ATTEMPTS}
      LIMIT ${limit}
    )
    RETURNING id
  `;
  return rows.length;
}

// Phase 3E.2 — the smallest orchestration wrapper needed to actually
// invoke the 3E.1 primitives above for ONE specific order. This was the
// ONLY function in this file any route called in 3E.2 (the free-
// registration route, post-commit — see that route's own comment); Phase
// 3E.2R adds a second caller (lib/events/ticketEmailRecovery.ts) that
// invokes this SAME function for previously-claimed-but-unresolved and
// due-for-retry orders — no new send/claim/mark logic was introduced for
// recovery, only a second caller of this existing orchestration. A
// later, separately-approved 3E.3 will call it from the Stripe webhook
// the same way. It never throws — every internal failure, expected or
// not, is caught and converted into a safe outcome — so a caller can
// invoke it with a plain best-effort `try { await
// attemptAutomaticTicketEmail(orderId) } catch {}` and still be
// completely safe even if this function's own internal safety net
// somehow didn't catch something.
//
// terminal (Phase 3E.2R addition) — true when this exact failure will
// NEVER be automatically retried again: either an idempotency payload
// mismatch (always forced terminal regardless of attempt_count — see
// markTicketEmailFailed's own forceTerminal comment) or attempt_count
// has reached MAX_ATTEMPTS (mirrors markTicketEmailFailed's own CASE
// expression exactly — see isTerminalFailure below). This lets a caller
// (the recovery executor) tally retryable vs terminal failures without
// re-deriving markTicketEmailFailed's own backoff logic itself.
export type AutomaticTicketEmailOutcome =
  | { outcome: 'not_claimed' }
  | { outcome: 'sent'; providerMessageId: string | null }
  | { outcome: 'failed'; reason: TicketEmailFailureReason; terminal: boolean };

// Mirrors markTicketEmailFailed's own CASE expression exactly (the
// forceTerminal / attempt_count >= MAX_ATTEMPTS conditions) — kept as a
// single small helper so the two can never silently drift apart. Not
// exported: only attemptAutomaticTicketEmail needs it, and every outside
// caller reads the already-computed `terminal` field on its returned
// outcome instead of recomputing this itself.
function isTerminalFailure(reason: TicketEmailFailureReason, attemptCount: number): boolean {
  return reason === 'idempotency_payload_mismatch' || attemptCount >= MAX_ATTEMPTS;
}

export async function attemptAutomaticTicketEmail(orderId: string): Promise<AutomaticTicketEmailOutcome> {
  let claim: TicketEmailDeliveryClaim | null = null;
  try {
    claim = await claimTicketEmailDelivery(orderId);
    if (!claim) return { outcome: 'not_claimed' };

    const order = await readClaimedOrderForDelivery(orderId, claim.claimId);
    if (!order || order.attendees.length === 0) {
      // Structurally shouldn't happen (the claim's own eligibility
      // recheck already required at least one attendee ticket_token),
      // but if the trusted read ever comes back empty/attendee-less,
      // record it honestly rather than silently doing nothing.
      await markTicketEmailFailed(orderId, claim.claimId, 'ambiguous_outcome', 'Order data unavailable immediately after claim.');
      const terminal = isTerminalFailure('ambiguous_outcome', claim.attemptCount);
      // Only attempt the audit write if we actually have an
      // organisationId to attribute it to (order === null means the
      // trusted read found nothing at all — nothing to log against).
      if (order) {
        await logAutomaticTicketEmailFailed({
          organisationId: order.organisationId, orderId, attemptCount: claim.attemptCount,
          terminal, reason: 'ambiguous_outcome',
        }).catch(err => console.error('[events] automatic ticket-email audit write failed (post-claim read empty)', err, { orderId }));
      }
      return { outcome: 'failed', reason: 'ambiguous_outcome', terminal };
    }

    // Deterministic per-order key, reused verbatim on every automatic
    // attempt/recovery for this order — never rotated (§ payload-
    // stability rule, see buildInitialTicketEmailIdempotencyKey).
    const idempotencyKey = buildInitialTicketEmailIdempotencyKey(orderId);
    // Same branding resolution the existing manual resend route already
    // uses — no new logic, no duplicated raw-settings parsing.
    const branding = normaliseTicketEmailBranding(order.organisationSettings, order.organisationName);
    const recipientMasked = maskEmailForAudit(order.purchaserEmail);

    const sendResult = await sendTicketEmail(
      order.purchaserEmail,
      {
        eventName: order.eventName,
        purchaserName: order.purchaserName,
        attendees: order.attendees,
        bookingToken: order.bookingToken,
        branding,
      },
      { idempotencyKey },
    );

    if (sendResult.result === 'sent') {
      await markTicketEmailSent(orderId, claim.claimId, sendResult.providerMessageId);
      await logAutomaticTicketEmailSent({
        organisationId: order.organisationId, orderId, attemptCount: claim.attemptCount,
        providerMessageId: sendResult.providerMessageId, recipientMasked,
      }).catch(err => console.error('[events] automatic ticket-email audit write failed after send', err, { orderId }));
      return { outcome: 'sent', providerMessageId: sendResult.providerMessageId };
    }

    // §11 outcome mapping — not_configured and unknown both follow the
    // SAME retryable backoff schedule as an ordinary provider rejection
    // (only idempotency_payload_mismatch ever forces terminal — see
    // markTicketEmailFailed's own forceTerminal logic, unchanged here).
    let reason: TicketEmailFailureReason;
    let errorMessage: string;
    if (sendResult.result === 'not_configured') {
      reason = 'not_configured';
      errorMessage = 'Email sending is not configured for this environment.';
    } else if (sendResult.result === 'unknown') {
      reason = 'ambiguous_outcome';
      errorMessage = sendResult.error;
    } else {
      // result === 'failed' — sendResult.idempotencyPayloadMismatch is
      // the ONLY thing that selects the terminal reason; every other
      // 'failed' outcome (including a plain provider rejection) is the
      // ordinary retryable case.
      reason = sendResult.idempotencyPayloadMismatch ? 'idempotency_payload_mismatch' : 'provider_rejected';
      errorMessage = sendResult.error;
    }

    await markTicketEmailFailed(orderId, claim.claimId, reason, errorMessage);
    const terminal = isTerminalFailure(reason, claim.attemptCount);
    await logAutomaticTicketEmailFailed({
      organisationId: order.organisationId, orderId, attemptCount: claim.attemptCount,
      terminal, reason,
    }).catch(err => console.error('[events] automatic ticket-email audit write failed after failure', err, { orderId }));
    return { outcome: 'failed', reason, terminal };
  } catch (err) {
    console.error('[events] attemptAutomaticTicketEmail: unexpected error', err, { orderId });
    if (claim) {
      // Best-effort cleanup so an unexpected internal error (not a
      // provider outcome — those are all handled above) doesn't leave
      // the lease stuck in 'sending' any longer than necessary. Never
      // throws further; if this itself fails too, the periodic
      // recovery executor (lib/events/ticketEmailRecovery.ts, Phase
      // 3E.2R) is the eventual fallback.
      await markTicketEmailFailed(orderId, claim.claimId, 'ambiguous_outcome', 'Unexpected internal error during automatic delivery.').catch(() => {});
      return { outcome: 'failed', reason: 'ambiguous_outcome', terminal: isTerminalFailure('ambiguous_outcome', claim.attemptCount) };
    }
    // No claim was ever won (e.g. claimTicketEmailDelivery itself threw)
    // — the row's own state is completely untouched by this attempt, so
    // nothing here is actually "terminal": a later attempt (registration-
    // adjacent or recovery) can still claim and try this order normally.
    return { outcome: 'failed', reason: 'ambiguous_outcome', terminal: false };
  }
}
