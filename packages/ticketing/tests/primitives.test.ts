import { describe, it, expect } from 'vitest';
import {
  EVENT_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, TICKETING_CONCEPTS,
  isEventStatus, isOrderStatus, isPaymentStatus, isLiveOrder,
  defineProductConfig, ProductConfigError, productFeatureEnabled,
  publicEventUrl, publicTicketUrl, publicBookingWalletUrl,
  computeOrderFinancials, computePlatformFeeCents, PLATFORM_DEFAULT_FEE_POLICY,
  evaluateTicketValidity, toPublicTicketStatus,
  computeSaleStatus, isWithinSaleWindow,
  groupOrderRows, formatOrderLines,
  isOrderEligibleForTicketEmail,
  validateSlug, validateEventTicketTypeInput,
  isAllowedArtworkMimeType,
} from '../src/index';
import * as viaSubpath from '../src/feeCalculation';

describe('domain vocabulary', () => {
  it('mirrors the database constraints exactly', () => {
    expect(EVENT_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'CANCELLED']);
    expect(ORDER_STATUSES).toEqual(['PENDING', 'CONFIRMED', 'CANCELLED']);
    expect(PAYMENT_STATUSES).toEqual(['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED']);
    expect(TICKETING_CONCEPTS).toEqual(['organiser', 'venue', 'event', 'session', 'ticket_type', 'inventory', 'order', 'attendee', 'ticket', 'payment']);
  });

  it('type guards accept only the listed values', () => {
    expect(isEventStatus('PUBLISHED')).toBe(true);
    expect(isEventStatus('published')).toBe(false);
    expect(isOrderStatus('CONFIRMED')).toBe(true);
    expect(isOrderStatus(null)).toBe(false);
    expect(isPaymentStatus('REFUNDED')).toBe(true);
    expect(isPaymentStatus('PAYED')).toBe(false);
  });

  it('isLiveOrder is the twin of the SQL live predicate', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const later = new Date('2026-01-01T00:10:00Z');
    const earlier = new Date('2025-12-31T23:50:00Z');
    expect(isLiveOrder({ status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', expires_at: null }, now)).toBe(true);
    expect(isLiveOrder({ status: 'CONFIRMED', payment_status: 'PAID', expires_at: earlier }, now)).toBe(true);
    expect(isLiveOrder({ status: 'CANCELLED', payment_status: 'PAID', expires_at: null }, now)).toBe(false);
    expect(isLiveOrder({ status: 'PENDING', payment_status: 'PENDING', expires_at: later }, now)).toBe(true);
    expect(isLiveOrder({ status: 'PENDING', payment_status: 'PENDING', expires_at: earlier }, now)).toBe(false);
    expect(isLiveOrder({ status: 'PENDING', payment_status: 'PENDING', expires_at: later.toISOString() }, now)).toBe(true);
    expect(isLiveOrder({ status: 'PENDING', payment_status: 'PENDING', expires_at: null }, now)).toBe(false);
  });
});

describe('product identity seam', () => {
  const base = { name: 'Acme Tickets', publicBaseUrl: 'https://tickets.example.com/', supportEmail: 'help@example.com', emailFrom: 'Acme <no-reply@example.com>' };

  it('freezes a validated identity with sensible defaults', () => {
    const c = defineProductConfig(base);
    expect(c.name).toBe('Acme Tickets');
    expect(c.tagline).toBe('');
    expect(c.publicBaseUrl).toBe('https://tickets.example.com');
    expect(c.defaultTheme).toBe('light');
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.features)).toBe(true);
    expect(productFeatureEnabled(c, 'anything')).toBe(false);
    expect(productFeatureEnabled(defineProductConfig({ ...base, features: { wallet: true } }), 'wallet')).toBe(true);
  });

  it('refuses a missing or malformed value', () => {
    expect(() => defineProductConfig({ ...base, name: ' ' })).toThrow(ProductConfigError);
    expect(() => defineProductConfig({ ...base, publicBaseUrl: 'tickets.example.com' })).toThrow(/absolute http/);
    expect(() => defineProductConfig({ ...base, publicBaseUrl: 'ftp://x.example.com' })).toThrow(ProductConfigError);
    expect(() => defineProductConfig({ ...base, supportEmail: 'not-an-email' })).toThrow(/email address/);
    expect(() => defineProductConfig({ ...base, emailFrom: '' })).toThrow(/emailFrom/);
  });

  it('builds public links under the product base URL with encoded segments', () => {
    const c = defineProductConfig({ ...base, publicBaseUrl: 'https://tickets.example.com/app/' });
    expect(publicEventUrl(c, 'my org', 'show-1')).toBe('https://tickets.example.com/app/e/my%20org/show-1');
    expect(publicTicketUrl(c, 'tok/en')).toBe('https://tickets.example.com/app/t/tok%2Fen');
    expect(publicBookingWalletUrl(c, 'bk')).toBe('https://tickets.example.com/app/b/bk/tickets');
  });
});

describe('re-exported primitives behave through the package entry point', () => {
  it('fees: the platform default is disabled and a pass-through policy adds the fee', () => {
    expect(PLATFORM_DEFAULT_FEE_POLICY).toEqual({ enabled: false });
    const none = computeOrderFinancials(10000, 2, null);
    expect(none.ok && none.result.platform_fee_cents === 0 && none.result.payment_total_cents === 10000).toBe(true);
    const policy = { fee_mode: 'PASS_THROUGH' as const, percent_bps: 500, fixed_per_order_cents: 100, fixed_per_ticket_cents: 50, min_fee_cents: null, max_fee_cents: null };
    expect(computePlatformFeeCents(10000, 2, policy)).toBe(100 + 100 + 500);
    const withFee = computeOrderFinancials(10000, 2, policy);
    expect(withFee.ok && withFee.result.payment_total_cents === 10700).toBe(true);
    expect(viaSubpath.computePlatformFeeCents).toBe(computePlatformFeeCents);
  });

  it('ticket validity and public status', () => {
    const valid = evaluateTicketValidity({ eventStatus: 'PUBLISHED', orderStatus: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(valid.valid).toBe(true);
    expect(toPublicTicketStatus(valid)).toBe('VALID');
    expect(toPublicTicketStatus(evaluateTicketValidity({ eventStatus: 'CANCELLED', orderStatus: 'CONFIRMED', paymentStatus: 'PAID' }))).toBe('EVENT_CANCELLED');
    expect(evaluateTicketValidity({ eventStatus: 'PUBLISHED', orderStatus: 'CONFIRMED', paymentStatus: 'PENDING' }).valid).toBe(false);
  });

  it('sale windows are half-open and the status vocabulary is stable', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    expect(isWithinSaleWindow({ sale_starts_at: '2026-06-01T10:00:00Z', sale_ends_at: null }, now)).toBe(true);
    expect(isWithinSaleWindow({ sale_starts_at: null, sale_ends_at: '2026-06-01T10:00:00Z' }, now)).toBe(false);
    expect(computeSaleStatus({ sale_starts_at: null, sale_ends_at: null, requires_access_code: false, remaining: 0 }, { now })).toBe('SOLD_OUT');
    expect(computeSaleStatus({ sale_starts_at: '2026-07-01T00:00:00Z', sale_ends_at: null, requires_access_code: false, remaining: 5 }, { now })).toBe('COMING_SOON');
    expect(computeSaleStatus({ sale_starts_at: null, sale_ends_at: null, requires_access_code: true, remaining: 5 }, { now })).toBe('ACCESS_REQUIRED');
  });

  it('order grouping folds item rows into one order', () => {
    const rows = [
      { id: 'o1', order_item_id: 'i1', ticket_type_name: 'Adult', quantity: 2, attendees: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'o1', order_item_id: 'i2', ticket_type_name: 'Child', quantity: 1, attendees: [{ id: 'a3' }] },
      { id: 'o2', order_item_id: 'i3', ticket_type_name: 'Adult', quantity: 1, attendees: [{ id: 'a4' }] },
    ];
    const grouped = groupOrderRows(rows);
    expect(grouped.map(g => g.id)).toEqual(['o1', 'o2']);
    expect(grouped[0].attendees.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(formatOrderLines(grouped[0].lines)).toBe('Adult × 2, Child × 1');
  });

  it('eligibility, validation and artwork constants are reachable', () => {
    const eligible = { status: 'CONFIRMED', payment_status: 'PAID', purchaser_email: 'buyer@example.com', attendees: [{ ticket_token: 'tok' }] };
    expect(isOrderEligibleForTicketEmail(eligible)).toBe(true);
    expect(isOrderEligibleForTicketEmail({ ...eligible, status: 'CANCELLED' })).toBe(false);
    expect(isOrderEligibleForTicketEmail({ ...eligible, attendees: [{ ticket_token: null }] })).toBe(false);
    expect(validateSlug('spring-gala-2026')).toBeNull();
    expect(validateSlug('Spring Gala')).not.toBeNull();
    expect(validateEventTicketTypeInput({ name: '', price_cents: 0, capacity: 10 } as never)).not.toBeNull();
    expect(isAllowedArtworkMimeType('image/png')).toBe(true);
    expect(isAllowedArtworkMimeType('image/gif')).toBe(false);
  });
});
