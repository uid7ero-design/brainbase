import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicQuoteInput, type PublicQuoteInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { loadCartTicketTypes, computeCartTotalCents, assessCartAvailability } from '@/lib/events/services/cart';
import { resolveAccessCode, grantUnlocks, type AccessGrant } from '@/lib/events/services/accessCodes';
import { resolvePromotionCode, computeDiscount, promotionRedemptionAvailable } from '@/lib/events/services/promotions';
import { normaliseFeePolicyRow } from '@/lib/events/services/fees';
import { computeOrderFinancials } from '@/lib/events/feeCalculation';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// Phase 4 — public cart QUOTE: evaluates a selection plus an optional
// promotion code and/or access code and returns the server-computed
// subtotal / discount / payable total and per-line figures. READ-ONLY —
// reserves nothing, inserts nothing, never a step the register/checkout
// routes trust: both of those re-derive every figure themselves from the
// same services, so a quote is purely what the page displays before
// submit (brief §9: "do not trust a client-supplied discounted total").
//
// Response contract (200 for every evaluable request; inline errors):
//   { subtotal_cents, discount_cents, total_cents, currency, pricing,
//     lines: [{ ticket_type_id, quantity, gross_cents, discount_cents }],
//     promotion: { code } | null,  promotion_error: string | null,
//     access: { unlocked_ticket_type_ids } | null, access_error: string | null,
//     cart_error: string | null,
//     Phase 5A: platform_fee_cents, payment_total_cents,
//       fee: { label } | null  (a PASS_THROUGH fee the purchaser pays;
//       null when no fee or an ABSORB fee, which is never a purchaser fact) }
//   total_cents stays the NET TICKET total; payment_total_cents is what the
//   purchaser pays (equal unless a PASS_THROUGH fee applies).
//     Phase 6: availability: { ok, unavailable_ticket_type_ids, session_full }
//       | null — the read-side twin of the reservation gate (see
//       lib/events/services/cart.ts's assessCartAvailability) evaluated for
//       THIS selection and session; null for an empty selection. A cart the
//       gate would refuse right now (a sold-out type in this session, the
//       session's shared capacity, or a session that is not this event's)
//       is reported as a cart_error here too, so the page never shows a
//       price for a selection checkout is about to reject. Advisory only:
//       a quote still reserves nothing and the gate still decides.
// Every code failure is the SAME generic text regardless of cause
// (unknown / inactive / expired / other event / other organisation), so
// this endpoint cannot be used to learn which codes exist (brief §6).
//
// Rate limited harder than the page fetch and separately from
// register/checkout: 30 quotes per 10 minutes per IP + event. The
// limiter is the repository's per-instance in-memory one
// (lib/rateLimit.ts) — an outstanding platform-hardening limitation, not
// distributed protection; the access-code alphabet/length (>= 8 of 36
// symbols) is the primary enumeration defence.
const CODE_NOT_VALID = 'Code not valid.';
const CODE_NOT_APPLICABLE = "This code can't be applied to this order.";
const CODE_UNAVAILABLE = 'This code is no longer available.';

const CART_ERRORS: Record<string, string> = {
  TICKET_TYPE_NOT_FOUND: 'Selected ticket type is not available for this event.',
  TICKET_TYPE_INACTIVE: 'Selected ticket type is not currently available.',
  MIXED_FREE_AND_PAID: 'Free and paid tickets must be booked in separate orders.',
  CURRENCY_MISMATCH: 'All tickets in one order must use the same currency.',
  SALE_NOT_STARTED: 'Tickets for this selection are not on sale yet.',
  SALE_ENDED: 'Sales for this selection have ended.',
  EVENT_ENDED: 'This event has ended.',
  ACCESS_CODE_REQUIRED: 'An access code is required for this selection.',
  // Phase 6 — availability, worded exactly like the register/checkout
  // routes' own 404/409 bodies for the same conditions.
  SESSION_NOT_FOUND: 'Selected session is not available for this event.',
  CAPACITY_UNAVAILABLE: 'Some of the selected tickets are no longer available.',
  SESSION_FULL: 'The selected session does not have enough places left for this order.',
};

export async function POST(req: NextRequest, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;

  const ip = getClientIp(req);
  if (!checkRateLimit(`public-events-quote:${organisationSlug}:${eventSlug}:${ip}`, 30, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  let rawBody: PublicQuoteInput;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const validated = validatePublicQuoteInput(rawBody);
  if (typeof validated === 'string') return NextResponse.json({ error: validated }, { status: 400 });

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return NextResponse.json({ error: 'Event not available.' }, { status: 404 });
  const { organisationId, event } = resolved;

  // Access code first: it decides which restricted types are eligible.
  let accessGrant: AccessGrant | null = null;
  let accessError: string | null = null;
  if (validated.access_code) {
    const access = await resolveAccessCode(organisationId, event.id, validated.access_code);
    if (access.ok) accessGrant = access.grant;
    else accessError = CODE_NOT_VALID;
  }
  let access: { unlocked_ticket_type_ids: string[] } | null = null;
  if (accessGrant) {
    const restricted = await sql`
      SELECT id FROM event_ticket_types
      WHERE event_id = ${event.id} AND organisation_id = ${organisationId} AND active = true AND requires_access_code = true
    `;
    access = { unlocked_ticket_type_ids: (restricted as { id: string }[]).map(r => r.id).filter(ttId => grantUnlocks(accessGrant, ttId)) };
  }

  // No tickets selected yet: nothing to price — only the access result.
  if (validated.items.length === 0) {
    return NextResponse.json({
      subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: null, pricing: null, lines: [],
      promotion: null, promotion_error: null, access, access_error: accessError, cart_error: null,
      platform_fee_cents: 0, payment_total_cents: 0, fee: null, availability: null,
    });
  }

  const cart = await loadCartTicketTypes(organisationId, event.id, validated.items, { accessGrant });
  if (!cart.ok) {
    return NextResponse.json({
      subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: null, pricing: null, lines: [],
      promotion: null, promotion_error: null, access, access_error: accessError,
      cart_error: CART_ERRORS[cart.code] ?? 'This selection is not available.',
      platform_fee_cents: 0, payment_total_cents: 0, fee: null, availability: null,
    });
  }

  const subtotalCents = computeCartTotalCents(cart.lines);
  let discountCents = 0;
  let lineDiscounts = cart.lines.map(() => 0);
  let promotion: { code: string } | null = null;
  let promotionError: string | null = null;
  if (validated.promotion_code) {
    if (cart.pricing === 'FREE') {
      promotionError = CODE_NOT_APPLICABLE;
    } else {
      const resolvedPromotion = await resolvePromotionCode(organisationId, event.id, validated.promotion_code);
      if (!resolvedPromotion.ok) {
        promotionError = CODE_NOT_VALID;
      } else {
        const computed = computeDiscount(cart.lines, resolvedPromotion.rule, cart.currency);
        if (!computed.ok) {
          promotionError = CODE_NOT_APPLICABLE;
        } else if (!(await promotionRedemptionAvailable(organisationId, resolvedPromotion.rule.id))) {
          promotionError = CODE_UNAVAILABLE;
        } else {
          discountCents = computed.discountCents;
          lineDiscounts = computed.lineDiscountCents;
          promotion = { code: resolvedPromotion.rule.code };
        }
      }
    }
  }

  // Phase 5A — the platform fee on the NET ticket total, from the SAME
  // resolution the paid checkout will snapshot (event row > organisation
  // row > none). A free cart never carries a fee. A policy this code
  // cannot apply (malformed, other currency, absorbed fee > total) is
  // reported as the generic cart error the checkout would also refuse
  // with — the quote reserves nothing either way.
  const totalCents = subtotalCents - discountCents;
  let platformFeeCents = 0;
  let paymentTotalCents = totalCents;
  let fee: { label: string } | null = null;
  if (cart.pricing === 'PAID') {
    try {
      const policy = normaliseFeePolicyRow(cart.feePolicyRow).policy;
      if (policy && policy.currency !== cart.currency.toUpperCase()) throw new Error('fee policy currency mismatch');
      const financials = computeOrderFinancials(totalCents, validated.quantity, policy);
      if (!financials.ok) throw new Error(financials.code);
      platformFeeCents = financials.result.platform_fee_cents;
      paymentTotalCents = financials.result.payment_total_cents;
      if (financials.result.fee_mode === 'PASS_THROUGH' && platformFeeCents > 0) fee = { label: policy!.label };
    } catch (err) {
      console.error('[public quote] fee policy could not be applied', err);
      return NextResponse.json({
        subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: null, pricing: null, lines: [],
        promotion: null, promotion_error: null, access, access_error: accessError,
        cart_error: 'This selection is not available.',
        platform_fee_cents: 0, payment_total_cents: 0, fee: null, availability: null,
      });
    }
  }

  // Phase 6 — the same capacity verdict the reservation gate will reach
  // for this exact selection and session, read without locks AFTER the
  // pricing above (pricing never depends on it). A selection the gate
  // would refuse right now is a cart_error with the figures zeroed, like
  // every other cart error on this endpoint; the availability detail is
  // returned alongside so the page can say which lines. Reserves nothing.
  const assessed = await assessCartAvailability(organisationId, event.id, validated.items, validated.event_session_id);
  const availability = assessed.assessed
    ? { ok: assessed.sessionFound && !assessed.sessionFull && assessed.unavailableTicketTypeIds.length === 0, unavailable_ticket_type_ids: assessed.unavailableTicketTypeIds, session_full: assessed.sessionFull }
    : null;
  if (assessed.assessed && !availability!.ok) {
    const code = !assessed.sessionFound ? 'SESSION_NOT_FOUND' : assessed.unavailableTicketTypeIds.length > 0 ? 'CAPACITY_UNAVAILABLE' : 'SESSION_FULL';
    return NextResponse.json({
      subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: null, pricing: null, lines: [],
      promotion: null, promotion_error: null, access, access_error: accessError,
      cart_error: CART_ERRORS[code],
      platform_fee_cents: 0, payment_total_cents: 0, fee: null, availability,
    });
  }

  return NextResponse.json({
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    total_cents: totalCents,
    currency: cart.currency,
    pricing: cart.pricing,
    lines: cart.lines.map((l, i) => ({
      ticket_type_id: l.ticket_type_id, quantity: l.quantity,
      gross_cents: l.unit_price_cents * l.quantity, discount_cents: lineDiscounts[i],
    })),
    promotion,
    promotion_error: promotionError,
    access,
    access_error: accessError,
    cart_error: null,
    platform_fee_cents: platformFeeCents,
    payment_total_cents: paymentTotalCents,
    fee,
    availability,
  });
}
