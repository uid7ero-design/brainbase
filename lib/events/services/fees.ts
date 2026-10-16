import sql from '@/lib/db';
import type { CheckoutLineItem } from '@/lib/events/stripe';
import {
  FEE_MODES, FEE_TAX_TREATMENTS, assertFeePolicyInputs,
  type FeeMode, type FeeTaxTreatment, type ResolvedFeePolicy,
} from '@/lib/events/feeCalculation';

// Shared ticketing service — platform / booking FEE POLICY resolution,
// Phase 5A. The arithmetic itself is the pure, client-safe
// lib/events/feeCalculation.ts; this module is the database side.
//
// Configuration hierarchy (brief §3), smallest useful model:
//   event-level row  >  organisation-level row  >  PLATFORM DEFAULT
// where the platform default is lib/events/feeCalculation.ts's
// PLATFORM_DEFAULT_FEE_POLICY — a frozen "disabled" constant, not a row.
// A row at a narrower scope wins outright, including an explicitly
// DISABLED event row under an enabled organisation row (that is how an
// organiser-level fee is switched off for one event). No row anywhere —
// the state of every BrainBase organisation — resolves to no fee, no fee
// line item, no application_fee_amount: the pre-Phase-5A checkout exactly.
//
// There is deliberately NO environment variable, product flag or global
// default row that can enable a fee: only an explicit
// ticketing_fee_policies row for one organisation (or one event) can, and
// this phase ships no write path for it other than the database itself
// (an operator/admin surface is a later phase — see the ADR). BrainBase
// organisers cannot set a platform fee on themselves.
//
// The SAME resolution is embedded as a scalar subquery inside
// lib/events/services/cart.ts's one ticket-type query (so the paid checkout
// learns the policy in the round trip it already makes, and every
// pre-Phase-5A fixture/caller whose rows carry no fee_policy column reads
// as "no fee"). FEE_POLICY_RESOLUTION_SQL below is that subquery's text,
// exported so the containment suite can assert the two copies stay
// identical, exactly as Phase 4 pins the shared `purchasable` predicate.

export const FEE_POLICY_RESOLUTION_SQL =
  "(SELECT to_jsonb(p) FROM ticketing_fee_policies p WHERE p.organisation_id = ${organisationId} AND (p.event_id = ${eventId} OR p.event_id IS NULL) ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1)";

export type FeePolicyRow = {
  id: string;
  organisation_id: string;
  event_id: string | null;
  enabled: boolean;
  fee_mode: string;
  percent_bps: number;
  fixed_per_order_cents: number;
  fixed_per_ticket_cents: number;
  min_fee_cents: number | null;
  max_fee_cents: number | null;
  currency: string;
  label: string;
  tax_treatment: string;
  version: number;
};

export type FeePolicySource = 'EVENT' | 'ORGANISATION' | 'PLATFORM_DEFAULT';

export type FeePolicyResolution = {
  // null = no fee applies (platform default, or an explicitly disabled row).
  policy: ResolvedFeePolicy | null;
  source: FeePolicySource;
};

// Pure normalisation of a (possibly absent) resolved row — the single
// place the "disabled row means no fee" rule and the field coercions live.
// Fails CLOSED on a malformed row (unknown mode/treatment, non-integer
// money): a policy this code cannot interpret must never silently become
// "no fee" on a checkout that an operator intended to carry one, nor a
// fee the operator did not configure — so it throws, and the paid
// checkout reports a configuration failure.
export function normaliseFeePolicyRow(raw: unknown): FeePolicyResolution {
  if (raw === null || raw === undefined) return { policy: null, source: 'PLATFORM_DEFAULT' };
  if (typeof raw !== 'object') throw new Error('Fee policy row is not an object.');
  const row = raw as Partial<FeePolicyRow>;
  const source: FeePolicySource = row.event_id ? 'EVENT' : 'ORGANISATION';
  if (row.enabled !== true) return { policy: null, source };
  if (typeof row.id !== 'string' || !row.id) throw new Error('Fee policy row has no id.');
  if (!FEE_MODES.includes(row.fee_mode as FeeMode)) throw new Error(`Fee policy ${row.id} has an unknown fee_mode.`);
  const treatment = (row.tax_treatment ?? 'UNSPECIFIED') as FeeTaxTreatment;
  if (!FEE_TAX_TREATMENTS.includes(treatment)) throw new Error(`Fee policy ${row.id} has an unknown tax_treatment.`);
  const int = (v: unknown, what: string): number => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`Fee policy ${row.id}: ${what} is not an integer.`);
    return n;
  };
  const intOrNull = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : int(v, what));
  const policy: ResolvedFeePolicy = {
    id: row.id,
    version: int(row.version ?? 1, 'version'),
    fee_mode: row.fee_mode as FeeMode,
    percent_bps: int(row.percent_bps ?? 0, 'percent_bps'),
    fixed_per_order_cents: int(row.fixed_per_order_cents ?? 0, 'fixed_per_order_cents'),
    fixed_per_ticket_cents: int(row.fixed_per_ticket_cents ?? 0, 'fixed_per_ticket_cents'),
    min_fee_cents: intOrNull(row.min_fee_cents, 'min_fee_cents'),
    max_fee_cents: intOrNull(row.max_fee_cents, 'max_fee_cents'),
    currency: typeof row.currency === 'string' && row.currency ? row.currency.toUpperCase() : 'AUD',
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : 'Booking fee',
    tax_treatment: treatment,
  };
  assertFeePolicyInputs(policy);
  return { policy, source };
}

// Standalone resolution (public quote, public event detail). The paid
// checkout does NOT call this — it reads the identical subquery from the
// cart load (see the module comment).
export async function resolveFeePolicy(organisationId: string, eventId: string): Promise<FeePolicyResolution> {
  const rows = await sql`
    SELECT (SELECT to_jsonb(p) FROM ticketing_fee_policies p WHERE p.organisation_id = ${organisationId} AND (p.event_id = ${eventId} OR p.event_id IS NULL) ORDER BY (p.event_id IS NOT NULL) DESC LIMIT 1) AS fee_policy
  `;
  const row = rows[0] as { fee_policy: unknown } | undefined;
  return normaliseFeePolicyRow(row?.fee_policy ?? null);
}

// What the PUBLIC page may know about a fee: only a PASS_THROUGH fee is a
// customer-facing fact (the customer pays it); an ABSORB fee is between
// the platform and the organiser and is never disclosed to a purchaser.
// Never the policy id, version or tax metadata.
export type PublicFeeDisclosure = {
  label: string;
  percent_bps: number;
  fixed_per_order_cents: number;
  fixed_per_ticket_cents: number;
  min_fee_cents: number | null;
  max_fee_cents: number | null;
};

export function publicFeeDisclosure(policy: ResolvedFeePolicy | null): PublicFeeDisclosure | null {
  if (!policy || policy.fee_mode !== 'PASS_THROUGH') return null;
  return {
    label: policy.label,
    percent_bps: policy.percent_bps,
    fixed_per_order_cents: policy.fixed_per_order_cents,
    fixed_per_ticket_cents: policy.fixed_per_ticket_cents,
    min_fee_cents: policy.min_fee_cents,
    max_fee_cents: policy.max_fee_cents,
  };
}

// Stripe presentation (brief §5): a PASS_THROUGH fee is ONE extra line
// item (quantity 1) named by the policy's label, appended after the ticket
// lines, so Σ line amounts = payment_total_cents and the hosted page shows
// the customer exactly what they pay for. An ABSORB fee produces NO line
// item — the customer's total is unchanged; the fee travels only as the
// charge's application_fee_amount. A zero fee produces nothing either way.
export function buildFeeLineItem(label: string, feeCents: number): CheckoutLineItem | null {
  if (!Number.isSafeInteger(feeCents) || feeCents < 0) throw new Error(`platform_fee_cents must be a non-negative safe integer (got ${feeCents}).`);
  if (feeCents === 0) return null;
  return { name: label, unitAmountCents: feeCents, quantity: 1 };
}
