// Organiser-facing, READ-ONLY view of payment state. Pure: no DB, no
// provider, no 'server-only'. Everything here is derived from the order's own
// committed snapshot columns (ADR 0004) — never from a current fee policy and
// never from a live provider call — so a historical order reads exactly as it
// was written.
//
// Snapshot semantics reused, not reinvented (see receipt.ts):
//   total_cents           NET ticket amount (gross − discount)
//   platform_fee_cents    NOT NULL DEFAULT 0 (zero-fee for historical rows)
//   fee_mode              NULL | 'PASS_THROUGH' | 'ABSORB'
//   payment_total_cents   what the customer paid; NULL only on pre-5A rows,
//                         where the reader falls back to total_cents
//   refunded_cents        set at refund time (provider-reported, else the
//                         payment total). Refunds are full-order only: the
//                         state is REFUNDED, there is no partial state.
//
// What is deliberately NOT computed: a payout, a Stripe processing fee, or
// anything that depends on the provider's settlement. The only organiser
// figure derived is the SHARE BEFORE PROVIDER PROCESSING FEES, which ADR 0004
// §2 defines directly from the snapshot:
//   PASS_THROUGH (or no fee) → total_cents
//   ABSORB                   → total_cents − platform_fee_cents

export const PAYMENT_STATES = ['PAID', 'PENDING', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export function isPaymentState(value: unknown): value is PaymentState {
  return typeof value === 'string' && (PAYMENT_STATES as readonly string[]).includes(value);
}

export type PaymentSnapshot = {
  payment_status: string;
  total_cents: number;
  platform_fee_cents: number | null;
  fee_mode: string | null;
  payment_total_cents: number | null;
  refunded_cents: number | null;
  platform_fee_refunded_cents?: number | null;
};

const nonNegative = (n: unknown): number => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);

// What the customer was charged. Historical rows without the snapshot read
// the ticket total, exactly as every other reader does.
export function paymentTotalCents(o: PaymentSnapshot): number {
  return nonNegative(o.payment_total_cents ?? o.total_cents);
}

export function feeModeOf(o: Pick<PaymentSnapshot, 'fee_mode'>): 'PASS_THROUGH' | 'ABSORB' | null {
  return o.fee_mode === 'PASS_THROUGH' || o.fee_mode === 'ABSORB' ? o.fee_mode : null;
}

// Amount returned to the customer. Only a REFUNDED order has one; the stored
// figure wins over any inference, and the payment total is used only when the
// refund wrote no figure (same rule the refund write and the receipt use).
export function refundedAmountCents(o: PaymentSnapshot): number | null {
  if (o.payment_status !== 'REFUNDED') return null;
  return nonNegative(o.refunded_cents ?? paymentTotalCents(o));
}

// Organiser share BEFORE provider processing fees, for an order that is
// currently PAID. Null for every other state (nothing is held) — a refunded
// order's share is not "negative revenue", it simply is not revenue.
export function organiserShareBeforeProcessingCents(o: PaymentSnapshot): number | null {
  if (o.payment_status !== 'PAID') return null;
  const fee = nonNegative(o.platform_fee_cents);
  return feeModeOf(o) === 'ABSORB' ? Math.max(0, nonNegative(o.total_cents) - fee) : nonNegative(o.total_cents);
}

export type PaymentCurrencySummary = {
  currency: string;
  counts: Record<PaymentState, number>;
  // PAID orders only: money currently held for the organiser's sales.
  paid_revenue_cents: number;
  // Platform fee on PAID orders (zero for historical / zero-fee orders).
  platform_fees_cents: number;
  // REFUNDED orders: money returned to customers.
  refunded_cents: number;
  // PAID orders only, before provider processing fees. NOT a payout.
  organiser_share_before_processing_cents: number;
};

const emptyCounts = (): Record<PaymentState, number> => ({ PAID: 0, PENDING: 0, FAILED: 0, EXPIRED: 0, REFUNDED: 0 });

// One summary per currency — currencies are never added together.
export function summarisePayments(rows: (PaymentSnapshot & { currency: string | null })[]): PaymentCurrencySummary[] {
  const by = new Map<string, PaymentCurrencySummary>();
  for (const r of rows) {
    if (!isPaymentState(r.payment_status)) continue;
    const currency = (r.currency ?? 'AUD').toUpperCase();
    let s = by.get(currency);
    if (!s) {
      s = { currency, counts: emptyCounts(), paid_revenue_cents: 0, platform_fees_cents: 0, refunded_cents: 0, organiser_share_before_processing_cents: 0 };
      by.set(currency, s);
    }
    s.counts[r.payment_status] += 1;
    if (r.payment_status === 'PAID') {
      s.paid_revenue_cents += paymentTotalCents(r);
      s.platform_fees_cents += nonNegative(r.platform_fee_cents);
      s.organiser_share_before_processing_cents += organiserShareBeforeProcessingCents(r) ?? 0;
    } else if (r.payment_status === 'REFUNDED') {
      s.refunded_cents += refundedAmountCents(r) ?? 0;
    }
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  PAID: 'Paid',
  PENDING: 'Pending',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
};

export const FEE_MODE_LABELS: Record<'PASS_THROUGH' | 'ABSORB', string> = {
  PASS_THROUGH: 'Paid by the buyer',
  ABSORB: 'Deducted from your sales',
};
