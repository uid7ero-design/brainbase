# 0010 — Organiser Payments (read-only) in the Eve console

Status: Accepted for Preview (Eve Phase 3.3). No schema change, no migration.
No refund, payout, onboarding or any other payment mutation in this slice.

## 1. Decision

Eve's `/organiser/payments` shows payment state read from BrainBase, which
stays canonical for orders, payment state, Stripe Connect, checkout, webhooks,
refunds, fees and lifecycle communications. Eve adds no payment logic and calls
no payment provider.

- **API (BrainBase, `/api/ticketing/organiser/…`, GET only, viewer+):**
  - `payments?status=&event=` — Connect status, per-currency summary, filtered
    order list (capped at 200; summary reads at most 5,000 rows and says when
    it was cut short).
  - `payments/[orderId]` — one order's payment breakdown and lines.
  Both go through `authorizeTicketingApiRequest` (server-to-server gate, Eve
  session, fresh DB reload of user/tenant/organisation/Events capability/role)
  and a tenant-scoped reader (`lib/events/organiserPayments.ts`: every query is
  `organisation_id = <caller org>`; events are joined on the same organisation).
  Another tenant's order, a free order and an unknown id are the same 404.
- **Data = committed snapshots only** (ADR 0004): `total_cents`,
  `platform_fee_cents`, `fee_mode`, `payment_total_cents`, `refunded_cents`,
  `platform_fee_refunded_cents`, `paid_at`, `refunded_at`, `currency`. Historical
  rows follow the existing fallbacks (`payment_total_cents` NULL → `total_cents`;
  no fee snapshot → no fee). Nothing is recomputed from a current fee policy and
  no refund amount is inferred from a status label when a figure was stored.
- **Connect status** is the cached `organisations.stripe_*` state the paid-checkout
  gate already reads (`getConnectAccountState`, `checkPaidTicketingEligibility`);
  no live Stripe call. The connected account id and every provider identifier are
  never projected.

## 2. Aggregate semantics (`packages/ticketing/src/paymentsView.ts`)

Per currency (never summed across currencies):

| Figure | Definition |
|---|---|
| Paid revenue | Σ `payment_total` over PAID orders |
| Platform fees | Σ `platform_fee_cents` over PAID orders |
| Refunds | Σ stored `refunded_cents` over REFUNDED orders (payment total only if none was written) |
| Share before processing fees | PAID only: `total_cents`, minus `platform_fee_cents` when `fee_mode = ABSORB` (ADR 0004 §2) |
| Counts | per state: PAID, PENDING, FAILED, EXPIRED, REFUNDED |

**Not computed, deliberately:** a payout, Stripe processing fees, settlement
timing, or any figure that needs the provider. The share figure is labelled
"before processing fees … not a payout". Refunds are full-order only in the
existing model, so there is no partial-refund state to display.

## 3. Out of scope

Refunds, Connect onboarding/management, payouts, CSV export, per-order actions,
dashboard redesign, Eve legal or charity claims.
