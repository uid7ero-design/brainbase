import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATES, isPaymentState, paymentTotalCents, refundedAmountCents, organiserShareBeforeProcessingCents, summarisePayments, feeModeOf,
  type PaymentSnapshot,
} from '../src/paymentsView';

const snap = (o: Partial<PaymentSnapshot> & { payment_status: string; total_cents: number }): PaymentSnapshot => ({
  platform_fee_cents: 0, fee_mode: null, payment_total_cents: null, refunded_cents: null, ...o,
});

describe('payments view — snapshot semantics', () => {
  it('knows exactly the five organiser-visible payment states (NOT_REQUIRED is not one)', () => {
    expect([...PAYMENT_STATES]).toEqual(['PAID', 'PENDING', 'FAILED', 'EXPIRED', 'REFUNDED']);
    expect(isPaymentState('NOT_REQUIRED')).toBe(false);
    expect(isPaymentState('paid')).toBe(false);
  });

  it('payment total falls back to the ticket total for a pre-snapshot row', () => {
    expect(paymentTotalCents(snap({ payment_status: 'PAID', total_cents: 5000 }))).toBe(5000);
    expect(paymentTotalCents(snap({ payment_status: 'PAID', total_cents: 5000, payment_total_cents: 5525, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH' }))).toBe(5525);
  });

  it('a stored refunded_cents wins; the payment total is used only when none was written; non-REFUNDED has none', () => {
    expect(refundedAmountCents(snap({ payment_status: 'REFUNDED', total_cents: 5000, payment_total_cents: 5525, refunded_cents: 5000 }))).toBe(5000);
    expect(refundedAmountCents(snap({ payment_status: 'REFUNDED', total_cents: 5000, payment_total_cents: 5525 }))).toBe(5525);
    expect(refundedAmountCents(snap({ payment_status: 'PAID', total_cents: 5000, refunded_cents: 100 }))).toBeNull();
  });

  it('organiser share before processing: PASS_THROUGH/no fee = ticket total, ABSORB = total − fee, non-PAID = null', () => {
    expect(organiserShareBeforeProcessingCents(snap({ payment_status: 'PAID', total_cents: 19800, fee_mode: 'PASS_THROUGH', platform_fee_cents: 525 }))).toBe(19800);
    expect(organiserShareBeforeProcessingCents(snap({ payment_status: 'PAID', total_cents: 19800, fee_mode: 'ABSORB', platform_fee_cents: 525 }))).toBe(19275);
    expect(organiserShareBeforeProcessingCents(snap({ payment_status: 'PAID', total_cents: 5000 }))).toBe(5000);
    for (const s of ['PENDING', 'FAILED', 'EXPIRED', 'REFUNDED']) expect(organiserShareBeforeProcessingCents(snap({ payment_status: s, total_cents: 5000 }))).toBeNull();
  });

  it('never goes negative or non-integer on corrupt input', () => {
    expect(organiserShareBeforeProcessingCents(snap({ payment_status: 'PAID', total_cents: 100, fee_mode: 'ABSORB', platform_fee_cents: 900 }))).toBe(0);
    expect(paymentTotalCents(snap({ payment_status: 'PAID', total_cents: -5 }))).toBe(0);
    expect(feeModeOf({ fee_mode: 'bogus' })).toBeNull();
  });

  it('summarises per currency and ignores non-payment states', () => {
    const rows = [
      { ...snap({ payment_status: 'PAID', total_cents: 1000 }), currency: 'aud' },
      { ...snap({ payment_status: 'PAID', total_cents: 2000, fee_mode: 'ABSORB', platform_fee_cents: 100 }), currency: 'AUD' },
      { ...snap({ payment_status: 'REFUNDED', total_cents: 500, refunded_cents: 500 }), currency: 'AUD' },
      { ...snap({ payment_status: 'PAID', total_cents: 700 }), currency: 'USD' },
      { ...snap({ payment_status: 'NOT_REQUIRED', total_cents: 0 }), currency: 'AUD' },
    ];
    const [aud, usd] = summarisePayments(rows);
    expect(aud).toMatchObject({ currency: 'AUD', paid_revenue_cents: 3000, platform_fees_cents: 100, refunded_cents: 500, organiser_share_before_processing_cents: 2900 });
    expect(aud.counts).toEqual({ PAID: 2, PENDING: 0, FAILED: 0, EXPIRED: 0, REFUNDED: 1 });
    expect(usd).toMatchObject({ currency: 'USD', paid_revenue_cents: 700 });
    expect(summarisePayments([])).toEqual([]);
  });
});
