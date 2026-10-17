# 0008 — Order product identity (`event_orders.product_surface`)

Status: Accepted for Preview (Eve Phase 3.1). The Production migration is
separately gated and is NOT part of this change. Adds one column and one
CHECK constraint; no other schema change.

## 1. Context

The same published event page is reachable through two products: BrainBase's
own public routes (`/e/...`, `/api/public/events/*`) and the standalone Eve
product, which reaches the shared engine only through the authenticated
server-to-server API (`/api/ticketing/*`, ADR 0007). Everything a buyer is
later sent — return URLs after payment, ticket and wallet links, lifecycle
email — must belong to the product they actually used, and Phase 3.2 will
use this value to do exactly that. Before this change nothing recorded it.

## 2. Decision

`event_orders.product_surface TEXT NOT NULL DEFAULT 'BRAINBASE'
CHECK (product_surface IN ('BRAINBASE','EVE'))`.

- **On the order**, not the event or organisation. The event is shared by
  both products, so only the order knows which one the buyer used.
- **Stamped once, in the same INSERT as the order** (`paidCheckout.ts`,
  `freeRegistration.ts`), so there is no window in which an order exists
  without its product. Both services take a required `productSurface` and
  throw before touching the database if it is not a known value.
- **Decided only by the trusted server-side entry point.**
  - BrainBase's public register and checkout routes pass the literal
    `'BRAINBASE'`.
  - The Eve API handlers pass the literal `'EVE'` after the request has
    passed `checkTicketingGate` (the `TICKETING_API_SECRET`, timing-safe,
    browser-origin requests refused).
  - It is never read from a request body, query string, or header. The
    validators do not accept a product field, and the handlers never look.
- **Never updated.** Retry, the Stripe webhook (and its replays), refunds
  and email recovery only read it. No statement in the codebase sets it.
- **Retry resolves the product from the committed order**, not from the
  current request. `retryPendingOrderCheckout` reads `product_surface` in
  the same SELECT as the rest of the order snapshot and hands it to the
  caller's `buildReturnUrls` (Eve orders return to `EVE_PUBLIC_BASE_URL`,
  never to the BrainBase host a manager happened to use) before any capacity
  is reacquired. If the product's origin is unavailable Retry refuses
  cleanly with nothing mutated. Money snapshots, `stripe_account_id`, the
  capacity gate and both compare-and-set guards are unchanged.
- **Stripe metadata** gains `product_surface` for human/reconciliation use
  only. The webhook still reads exactly `metadata.event_order_id` and
  resolves everything else from the database row; the metadata value is
  never trusted. A replayed or hostile event claiming another product cannot
  change the order.
- **Eve free registration calls the shared service directly** instead of
  delegating to the BrainBase register route handler, which could not carry
  product context. It keeps the route's limiter key and budget, validation
  and CRM hooks, and the result-to-response mapping is shared
  (`lib/events/freeRegistrationResponse.ts`, the counterpart of
  `paidCheckoutResponse.ts`).

## 3. Historical orders

`ADD COLUMN ... NOT NULL DEFAULT 'BRAINBASE'` with a constant default is
catalog-only on PostgreSQL 11+; no row is rewritten and there is no backfill.
Every pre-existing order reads `BRAINBASE`, which is what it is. Code that
does not name the column (any older deployment) keeps working: the default
applies.

## 4. Alternatives rejected

- *On the event or organisation*: wrong cardinality — the same event is sold
  through both products.
- *Infer from the Stripe return URL or the Origin at send time*: not
  durable, and request-derived.
- *Postgres enum*: this schema uses TEXT + CHECK for every vocabulary so a
  value can be added with a constraint replacement, no `ALTER TYPE`.
- *Trust Stripe metadata*: the webhook must not take authority from a field
  a replay or a misconfigured sender can set.

## 5. Consequences and boundaries

- Phase 3.1 changes **no email, link, redirect or branding**. Until Phase 3.2
  ships, an Eve order's ticket email is still the BrainBase one, so Eve
  Production stays disabled.
- No refund, session, rate-limit or dashboard change. BrainBase routes, URLs,
  authentication, tenant scoping and the zero-fee default are unchanged.
- No index: nothing queries by product yet.

## 6. Migration and rollback

`scripts/add-events-order-product-surface.sql` (idempotent; CHECK added
`NOT VALID` then validated). Verified on real PostgreSQL by
`scripts/tests/verify-events-order-product-surface.sh`, which also proves
the rollback restores the pre-migration structure exactly:

```sql
ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_product_surface_check;
ALTER TABLE event_orders DROP COLUMN IF EXISTS product_surface;
```

Order of operations for any environment: apply the script, then deploy the
code. Roll back the code first; the script's rollback only loses the stamp.
