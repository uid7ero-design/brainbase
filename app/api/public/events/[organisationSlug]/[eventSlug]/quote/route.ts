import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { validatePublicQuoteInput, type PublicQuoteInput } from '@/lib/events/publicValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { loadCartTicketTypes, computeCartTotalCents } from '@/lib/events/services/cart';
import { resolveAccessCode, grantUnlocks, type AccessGrant } from '@/lib/events/services/accessCodes';
import { resolvePromotionCode, computeDiscount, promotionRedemptionAvailable } from '@/lib/events/services/promotions';

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
//     cart_error: string | null }
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
  ACCESS_CODE_REQUIRED: 'An access code is required for this selection.',
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
    });
  }

  const cart = await loadCartTicketTypes(organisationId, event.id, validated.items, { accessGrant });
  if (!cart.ok) {
    return NextResponse.json({
      subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: null, pricing: null, lines: [],
      promotion: null, promotion_error: null, access, access_error: accessError,
      cart_error: CART_ERRORS[cart.code] ?? 'This selection is not available.',
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

  return NextResponse.json({
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    total_cents: subtotalCents - discountCents,
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
  });
}
