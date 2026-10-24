# 0014 — Eve legal copy for paid ticketing (2026-10-22)

Status: drafted, self-published wording. NOT reviewed by a solicitor or accountant and must
never be described as if it had been. Follows ADR 0013 (launch compliance) and ADR 0004
(fees and GST foundation).

## 1. What changed

The published Terms, Privacy Policy and Refunds & cancellations pages said paid ticketing "is
not currently available" or described payments only as something Eve "would" do in future.
That would be wrong the moment paid checkout is enabled, and an order would record acceptance
of text that said paid tickets do not exist. The text now describes paid ticketing as something
that may be offered for some events, and describes what the system actually does:

- Payments are taken by Stripe, through the Event Organiser's own Stripe account (a direct
  charge); card details go to Stripe and are not seen or stored by Eve.
- The buyer agrees to the Terms and the Refunds & cancellations policy before paying; Eve records
  that they agreed, when (database clock) and which version of each.
- A paid booking is confirmed only after the payment succeeds; the place is held for a limited
  time meanwhile and released if payment is not completed.
- Refunds are for the full order, to the original payment method, through Stripe, and are never
  automatic: a request is reviewed and processed by a person. No refund is promised except where
  Australian law requires one. Partial refunds are not available through Eve. A refunded order's
  tickets stop being valid and the places are released.
- The buyer checkout shows, before payment, that Stripe takes the card details.

`EVE_LEGAL_DOCUMENT_VERSION` (packages/ticketing/src/legalVersions.ts) and `LEGAL_LAST_UPDATED`
(apps/eve/config/legal.ts) were bumped together to `2026-10-22` / `22 October 2026`; a test keeps
the two in agreement. **Check the date again at publication.** Both constants must change whenever
the wording changes; the version is stamped on every paid Eve order.

## 2. GST / tax: deliberately no position

No GST or tax treatment has been decided (ADR 0004 questions 1-4 are open), so the text says only
that it does not set out how any tax applies to ticket prices and tells the buyer where to ask.
It does not use the words "GST" or "tax invoice" (an existing test requires this while the operator
is not registered for GST) and does not say prices are inclusive or exclusive of tax.
Before real paid sales the commercial/accounting decisions in the readiness report must be made and
the wording revisited.

## 3. Publishing

The Eve project's Production deployment publishes this text automatically on merge
(`EVE_LEGAL_PUBLISHED=true` on Eve Production). It must therefore be merged only when paid
ticketing is genuinely going to be offered, or accepted as accurate in the meantime (it states paid
tickets "may be offered ... only where an event shows a ticket price"). `EVE_PAID_CHECKOUT_ENABLED`
remains the separate, fail-closed switch for taking payments.
