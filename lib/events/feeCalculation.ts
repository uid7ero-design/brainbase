// Phase 5A — platform / booking fee arithmetic. Pure, dependency-free (no
// 'server-only', no DB, no Stripe) so the public page, the organiser page
// and the server all derive a fee from ONE rule. The SERVER is the
// authority — lib/events/services/fees.ts resolves the policy and
// lib/events/services/paidCheckout.ts snapshots the result onto the order
// before Stripe is ever contacted; what the browser computes here is
// display state only.
//
// Everything is INTEGER CENTS with one explicit rounding (ADR 0002 §8/§13).
//
// Calculation order (brief §6):
//   ticket gross → promotion discount → NET ticket subtotal (total_cents)
//     → fee on the NET subtotal → customer payment total
//
//   fee = fixed_per_order_cents
//       + fixed_per_ticket_cents × ticket_count
//       + round_half_up(net_ticket_cents × percent_bps / 10000)
//   then clamped to [min_fee_cents, max_fee_cents] when either is set.
//
// Modes:
//   PASS_THROUGH  payment_total = net + fee   (customer pays the fee)
//   ABSORB        payment_total = net         (fee deducted from the
//                                              organiser's proceeds via
//                                              Stripe's application fee)
//
// The platform default (no policy row anywhere) is DISABLED: fee 0,
// payment_total = net, no application fee, no fee line item — exactly the
// pre-Phase-5A behaviour of every BrainBase organisation.

export type FeeMode = 'PASS_THROUGH' | 'ABSORB';

export const FEE_MODES: readonly FeeMode[] = ['PASS_THROUGH', 'ABSORB'];

// Metadata seam only (brief §8): snapshotted, never computed from.
export type FeeTaxTreatment = 'UNSPECIFIED' | 'GST_INCLUSIVE' | 'GST_EXCLUSIVE' | 'GST_FREE';

export const FEE_TAX_TREATMENTS: readonly FeeTaxTreatment[] = ['UNSPECIFIED', 'GST_INCLUSIVE', 'GST_EXCLUSIVE', 'GST_FREE'];

// The inputs a fee is calculated from — the shape stored on a
// ticketing_fee_policies row AND snapshotted onto event_orders, so a
// historical order can be recomputed from its own columns alone.
export type FeePolicyInputs = {
  fee_mode: FeeMode;
  percent_bps: number;
  fixed_per_order_cents: number;
  fixed_per_ticket_cents: number;
  min_fee_cents: number | null;
  max_fee_cents: number | null;
};

export type ResolvedFeePolicy = FeePolicyInputs & {
  id: string;
  version: number;
  currency: string;
  label: string;
  tax_treatment: FeeTaxTreatment;
};

// What the platform resolves to when no organisation/event row exists.
// A frozen sentinel (not a row) so it can never be edited into a fee.
export const PLATFORM_DEFAULT_FEE_POLICY: Readonly<{ enabled: false }> = Object.freeze({ enabled: false as const });

export type FeeComputation = {
  fee_mode: FeeMode | null;
  net_ticket_cents: number;
  platform_fee_cents: number;
  payment_total_cents: number;
  // The amount sent as Stripe's application_fee_amount — equal to
  // platform_fee_cents in both modes, and 0 (meaning: not sent at all)
  // when there is no fee.
  application_fee_cents: number;
};

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative safe integer (got ${value}).`);
}

export function assertFeePolicyInputs(policy: FeePolicyInputs): void {
  if (!FEE_MODES.includes(policy.fee_mode)) throw new Error(`Unknown fee_mode ${String(policy.fee_mode)}.`);
  if (!Number.isInteger(policy.percent_bps) || policy.percent_bps < 0 || policy.percent_bps > 10000) {
    throw new Error('percent_bps must be a whole number 0..10000.');
  }
  assertCents(policy.fixed_per_order_cents, 'fixed_per_order_cents');
  assertCents(policy.fixed_per_ticket_cents, 'fixed_per_ticket_cents');
  if (policy.min_fee_cents !== null) assertCents(policy.min_fee_cents, 'min_fee_cents');
  if (policy.max_fee_cents !== null) assertCents(policy.max_fee_cents, 'max_fee_cents');
  if (policy.min_fee_cents !== null && policy.max_fee_cents !== null && policy.max_fee_cents < policy.min_fee_cents) {
    throw new Error('max_fee_cents must be >= min_fee_cents.');
  }
}

// The fee alone, before the mode is applied. Exported so the public page
// can show a PASS_THROUGH fee for a selection without a server round trip
// (the server recomputes and snapshots the authoritative figure).
export function computePlatformFeeCents(netTicketCents: number, ticketCount: number, policy: FeePolicyInputs): number {
  assertCents(netTicketCents, 'net_ticket_cents');
  assertCents(ticketCount, 'ticket_count');
  assertFeePolicyInputs(policy);
  // Round half-up, exactly once, on the percentage component.
  const percentPart = Math.floor((netTicketCents * policy.percent_bps + 5000) / 10000);
  let fee = policy.fixed_per_order_cents + policy.fixed_per_ticket_cents * ticketCount + percentPart;
  if (policy.min_fee_cents !== null && fee < policy.min_fee_cents) fee = policy.min_fee_cents;
  if (policy.max_fee_cents !== null && fee > policy.max_fee_cents) fee = policy.max_fee_cents;
  assertCents(fee, 'platform_fee_cents');
  return fee;
}

export type FeeComputationFailure = { ok: false; code: 'FEE_EXCEEDS_TOTAL' };

// The complete financial result for one paid order. `policy` null means
// the platform default (no fee). Deterministic, integer-only; the ABSORB
// branch fails closed (never silently caps) when the fee would exceed the
// amount actually charged — an application fee can never exceed the
// payment.
export function computeOrderFinancials(
  netTicketCents: number,
  ticketCount: number,
  policy: FeePolicyInputs | null,
): { ok: true; result: FeeComputation } | FeeComputationFailure {
  assertCents(netTicketCents, 'net_ticket_cents');
  if (!policy) {
    return {
      ok: true,
      result: { fee_mode: null, net_ticket_cents: netTicketCents, platform_fee_cents: 0, payment_total_cents: netTicketCents, application_fee_cents: 0 },
    };
  }
  const fee = computePlatformFeeCents(netTicketCents, ticketCount, policy);
  if (policy.fee_mode === 'PASS_THROUGH') {
    return {
      ok: true,
      result: { fee_mode: 'PASS_THROUGH', net_ticket_cents: netTicketCents, platform_fee_cents: fee, payment_total_cents: netTicketCents + fee, application_fee_cents: fee },
    };
  }
  if (fee > netTicketCents) return { ok: false, code: 'FEE_EXCEEDS_TOTAL' };
  return {
    ok: true,
    result: { fee_mode: 'ABSORB', net_ticket_cents: netTicketCents, platform_fee_cents: fee, payment_total_cents: netTicketCents, application_fee_cents: fee },
  };
}

// Re-derives the snapshot arithmetic a stored order must satisfy (the same
// rule event_orders_fee_snapshot_check enforces in SQL) — used by Retry to
// fail closed before any mutation when a row does not reconcile.
export function feeSnapshotReconciles(row: {
  total_cents: number;
  platform_fee_cents: number;
  fee_mode: FeeMode | null;
  payment_total_cents: number | null;
}): boolean {
  if (row.fee_mode === null) return row.platform_fee_cents === 0 && (row.payment_total_cents === null || row.payment_total_cents === row.total_cents);
  if (row.payment_total_cents === null) return false;
  if (row.fee_mode === 'PASS_THROUGH') return row.payment_total_cents === row.total_cents + row.platform_fee_cents;
  if (row.fee_mode === 'ABSORB') return row.payment_total_cents === row.total_cents && row.platform_fee_cents <= row.total_cents;
  return false;
}
