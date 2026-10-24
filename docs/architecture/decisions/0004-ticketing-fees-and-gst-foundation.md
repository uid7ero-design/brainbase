# 0004 — Shared Ticketing Core: Commercial Fees & GST / Invoice Foundation (Phase 5A)

Status: Proposed (Phase 5A, PR open, not merged). BrainBase default remains ZERO-FEE.

## 1. Context

The shared Events/Ticketing core (multi-ticket carts, Stripe Connect direct
charges, retry/duplicate-charge protection, promotions and access codes,
sale windows, booking wallet, check-in, full refunds, redemption accounting)
is being prepared for a future standalone commercial product while
continuing to serve BrainBase Events, whose organisations have never been
charged a platform fee.

Before this phase (read-only inventory, origin/main after #433):

| Fact | State |
| --- | --- |
| `application_fee_amount` | absent |
| BrainBase platform revenue from ticket sales | $0 (direct charges on the connected account, no fee, no transfer) |
| `event_orders.total_cents` | net ticket amount = Σ(unit × qty) − `discount_cents`; exactly what Stripe charges |
| Organisation legal / tax fields | none in columns; an optional `{tradingName, address, email, phone, abn}` exists only under `organisations.settings.commercial.businessProfile` (Commercial module) |
| GST registration status, legal entity name | not stored anywhere |
| Tax codes | Commercial module only (`commercial_tax_codes`, NUMERIC rate per organisation); nothing shared with Events |
| Receipts | Stripe's own emailed receipt (`customer_email`); never labelled a tax invoice by BrainBase |

## 2. Decision — financial total model

`total_cents` keeps its exact historical meaning (**net ticket amount**) and
is never overloaded. New, clearly named snapshot columns on `event_orders`:

```
gross_ticket_cents   = total_cents + discount_cents            (derived, as in Phase 4)
discount_cents       (Phase 4)
net_ticket_cents     = total_cents
platform_fee_cents   NOT NULL DEFAULT 0
fee_mode             NULL | 'PASS_THROUGH' | 'ABSORB'
payment_total_cents  what the customer pays (NULL only on pre-migration rows;
                     readers use COALESCE(payment_total_cents, total_cents))
refunded_cents, platform_fee_refunded_cents   set at refund time
currency             (existing, per row)
```

Worked example (the brief's cart): $220 gross − $22 promotion = $198 net;
synthetic fee 2.5 % + $0.30 per order = $5.25.

| | PASS_THROUGH | ABSORB |
| --- | --- | --- |
| Customer pays | **$203.25** | **$198.00** |
| Organiser receives (before Stripe processing fees) | $198.00 | $192.75 |
| Platform receives (application fee) | $5.25 | $5.25 |
| Full refund returns to the customer | $203.25 | $198.00 |
| Platform fee on refund | reversed ($5.25 back to the connected account) | reversed |

Calculation order: gross → promotion/access pricing → net → fee (on NET)
→ customer payment total. All arithmetic is integer cents; the percentage
component rounds half-up once; then an optional [min, max] clamp.

## 3. Fee configuration

`ticketing_fee_policies` (neutral name; no product branding), one row per
scope: organisation-level (`event_id IS NULL`) or event-level. Components:
`fee_mode`, `percent_bps` (0..10000 of the net subtotal), `fixed_per_order_cents`,
`fixed_per_ticket_cents`, `min_fee_cents`, `max_fee_cents`, `currency`, `label`
(customer-facing line name, default "Booking fee"), `tax_treatment` (metadata
seam only), `version`, `enabled`.

Resolution: event row > organisation row > **platform default = disabled**
(a frozen code constant, not a row). A disabled narrower row switches a
broader fee off for that event. No environment variable or global switch
can enable a fee; this phase ships no write path other than the database.
BrainBase organisers cannot set a platform fee on themselves.

`percent_bps` is an exact integer rather than ADR 0002's `NUMERIC(5,2)` so
the fee is integer arithmetic end to end (ADR 0002 §13); 1 bps = 0.01 %.

## 4. Immutable order snapshot

At reservation the order copies the policy id + version, mode, every input
(bps, fixed amounts, min/max, tax treatment, label) and every computed
figure. `event_orders_fee_snapshot_check` makes a non-reconciling row
unrepresentable. Retry rebuilds the Stripe Checkout Session from the
snapshot only (there is no policy read in `retryCheckout.ts`), refunds
reverse the fee recorded on the order, and no code path updates the fee
columns after insert. Changing or disabling a policy never alters an order.

## 5. Stripe Connect

Direct charges (unchanged). A positive `platform_fee_cents` is sent as
`payment_intent_data.application_fee_amount` on the Checkout Session created
with `{ stripeAccount }`; zero/absent adds no key, so a zero-fee session is
byte-identical to before. The fee can never exceed the session total
(asserted before the call). Presentation differs by mode:

* PASS_THROUGH — one extra line item (`label`, quantity 1); Σ lines =
  `payment_total_cents`.
* ABSORB — no extra line item; the customer's total is unchanged and the fee
  travels only as the application fee.

## 6. Refunds (full only, unchanged scope)

Policy for Phase 5A: the customer always receives the full amount paid, and
when the order carried a fee the refund passes `refund_application_fee: true`
so the full application fee returns to the connected account (Stripe's
documented semantics for a full refund of a direct charge). Rationale: the
platform earns nothing on a sale that did not stand and the organiser is
never out of pocket for the platform's fee. "Platform keeps the fee on
refund" is a later, explicit configuration decision (see §8). Partial
refunds remain unimplemented. Retry and refund keep using the order's
historical `stripe_account_id`.

## 7. Receipt / invoice architecture

`lib/events/receipt.ts` builds a **neutral payment summary** (event, order
reference, tickets, gross, discount, booking fee, total paid, payment date,
currency, refund as a fact) and renders it into the existing ticket email
for PAID orders. It contains no tax wording. Supplier representation:

| Supply | Supplier (per the architecture) | Status |
| --- | --- | --- |
| Ticket | The organiser — the direct charge is on the connected account; the organiser is the merchant for the ticket | Not stated on the summary as a legal supplier identity (no legal-name/ABN data exists) |
| Platform / booking fee | **Undetermined** — the fee is an application fee collected by the platform account; whether the platform (HLNA Labs / BrainBase entity) or the organiser is the supplier of the fee to the customer is a business/legal decision | Deferred |

A tax invoice and a credit note are deliberately NOT built.

## 8. Accounting / legal decisions still required (decision matrix)

| # | Decision | Options | Blocked artefacts |
| --- | --- | --- | --- |
| 1 | Who is the supplier of the platform fee to the customer under PASS_THROUGH? | platform entity / organiser (fee re-billed) / agency arrangement | fee tax invoice, fee GST line |
| 2 | Is the platform fee GST-inclusive, GST-exclusive or GST-free, and is the platform entity GST-registered? | per `tax_treatment` vocabulary | fee GST amount, fee label wording |
| 3 | Is GST on the ticket the organiser's liability only, and is BrainBase ever merchant of record? | organiser only (current architecture) / platform MoR (would require destination charges) | ticket tax invoice issuer |
| 4 | Which legal identity data must be captured per organisation (legal entity name, ABN, address, GST registration)? | new columns vs settings JSON; mandatory vs optional | organiser tax invoice |
| 5 | Does the platform keep its fee on a refund, and who bears Stripe processing fees? | keep / reverse (current) / configurable | refund policy configuration |
| 6 | Fee disclosure requirements at checkout (label wording, pre-selection disclosure). | "Booking fee" neutral label (current) / mandated wording | public page copy |
| 7 | Partial refunds and proportional fee reversal. | out of scope until required | partial refund design |

Until 1–4 are resolved, GST computation and invoice issuance are not
implemented; the schema carries only the `tax_treatment` seam and the
money snapshots a later phase will need.

## 9. Reporting

Organiser "Revenue" = Σ `total_cents` of PAID orders (ticket revenue, net of
discounts). "Platform Fees" is shown only when any paid order carried one,
split by mode. "Refunded" = Σ `refunded_cents`. The registrations CSV adds
explicit `Discount`, `Platform fee`, `Fee mode`, `Customer paid` columns
after `Currency`; `Order total` keeps its meaning.

## 10. What this phase does not do

No admin UI/API to write fee policies (database-only for now), no partial
refunds, no GST arithmetic, no tax invoice, no credit note, no change to the
20-ticket cart limit, Connect architecture, seating or box office, and no
non-zero fee anywhere in Production.
