# Eve paid checkout: controlled launch runbook

Operator checklist for opening Eve paid checkout for one real event, and closing it again. Proven end to end by the live $1 proof on 2026-10-22: one payment, then a refund through the manager path.

**Defaults:**
- `EVE_PAID_CHECKOUT_ENABLED` is **absent**, so paid checkout is off.
- `EVE_PAID_CHECKOUT_ORGS=brainbase` stays set.
- Organiser: Brainbase, Stripe connected account `acct_1UTJiZE3E8bCvlgj`.
- Direct charges; the organiser is merchant of record.
- Eve Checkout is card-only.
- No platform fee; the organiser is not GST-registered.

Exact-value rules for the env vars are in [vercel-env-exact-values.md](./vercel-env-exact-values.md).

## 1. Pre-launch checks (all must pass; read-only)

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Stripe account | Stripe → Connect → `acct_1UTJiZE3E8bCvlgj`. Neon: `organisations` row for slug `brainbase` | Enabled, payments + payouts active, no actions required. DB `stripe_account_status = CONNECTED`, charges/payouts/details all true |
| 2 | Webhook health | Stripe Workbench → Webhooks → "BrainBase Production Events" (`we_1UJllx…`) | Active. Events from **Connected accounts**. URL `https://www.thebrainbase.com.au/api/public/events/webhooks/stripe`. Listens to the 5 events: `checkout.session.completed`, `…async_payment_succeeded`, `…async_payment_failed`, `…expired`, `payment_intent.payment_failed`. Recent deliveries 2xx, error rate 0% |
| 3 | Webhook auth | `POST` the URL with header `stripe-signature: t=1,v1=x` | 400 "Invalid signature" (not 503 "not configured") |
| 4 | Allow-list | `EVE_PAID_CHECKOUT_ORGS` present (Production); value set per the env doc | Exactly the organisers being launched |
| 5 | Event | BrainBase → Events → the event | Correct name, date/time **and timezone**, venue, PUBLISHED, reminders as intended |
| 6 | Tickets | Ticket types on the event | Price in cents and AUD correct; capacity correct; sale window correct; access code only if intended; no stray paid ticket types |
| 7 | Fee policy | Neon: `SELECT count(*) FROM ticketing_fee_policies` | 0 (no platform fee) |
| 8 | GST | Eve event page and a test of the email wording | No GST component, no "Tax Invoice", no ABN. Organiser not GST-registered. Review before the GST threshold or before any platform fee |
| 9 | Legal | `https://eveevents.com.au/terms`, `/refunds`, `/privacy` | 200, published (no "Not yet published"); version matches `EVE_LEGAL_DOCUMENT_VERSION` |
| 10 | Support | `support@eveevents.com.au` | Mailbox monitored for the whole window |
| 11 | Statement descriptor | Connected account profile | `EVE. EVENTS` (buyer-recognisable) |
| 12 | Other organisers | Neon: published paid ticket types for other orgs | Not on the allow-list; they stay 503 |
| 13 | Rollback | Neon snapshot (optional, routine) | Taken or deliberately skipped |

## 2. Enable

1. `vercel env add EVE_PAID_CHECKOUT_ENABLED production --value true --force --yes` (never pipe).
2. `vercel inspect https://www.thebrainbase.com.au`, then note the current Production URL.
3. `vercel redeploy <that url> --target production`, and wait until it's Ready and aliased.

## 3. Verify immediately after enabling (about 2 min)

Probe the Eve buyer API. It needs the Origin header; without it you get 403:

```powershell
foreach ($o in 'brainbase','ld-tennis','school-test-organisation') {
  try { (Invoke-WebRequest "https://eveevents.com.au/api/buyer/$o/kill-switch-probe/checkout" -Method POST `
        -ContentType 'application/json' -Body '{}' -Headers @{ Origin = 'https://eveevents.com.au' } -UseBasicParsing).StatusCode }
  catch { "$o $($_.Exception.Response.StatusCode.value__)" } }
```

- Allow-listed organiser: **400** (terms-acceptance message; no side effects). This means it's open.
- Every other organiser: **503**.
- Still 503 for the allowed organiser? The value is likely malformed. See the env doc.

Open the real event on eveevents.com.au. Confirm the price, total, "remaining" count and the Terms/Refunds checkbox.

## 4. Monitor during the window

- **Orders (Neon):** new `event_orders` for the event. `payment_status` should go PENDING → PAID within seconds of payment. Watch for orders stuck in PENDING (abandoned, or a webhook problem).
- **Stripe:** the connected account's Payments list. Webhook deliveries should all be 2xx.
- **Email (Neon):** `event_orders.ticket_email_status = 'sent'` and `event_ticket_email_deliveries.delivery_status = 'delivered'`.
- **Errors:** Vercel runtime errors for the brainbase project (`/api/public/events/webhooks/stripe`, `/api/buyer/*`).
- **Support mailbox.**
- **Capacity:** the remaining count on the event page vs paid orders.

## 5. Emergency disable (any doubt: do this first)

1. `vercel env rm EVE_PAID_CHECKOUT_ENABLED production --yes`
2. Re-read the current Production deployment, then `vercel redeploy <url> --target production`.
3. Probe: all organisers **503**.
4. Faster in-flight stop for one event: set the event to Draft in BrainBase, or deactivate the ticket type.
5. Payments that already succeeded are unaffected. Reconcile them (section 6).

## 6. Refund path

- BrainBase → Events → event → Registrations → **Refund** on the order. This gives a full refund via Stripe on the connected account.
- Expected:
  - order becomes CANCELLED / REFUNDED; `refunded_cents` set;
  - ticket page shows "Cancelled or refunded — not valid for entry";
  - capacity is released;
  - audit `event_order.refunded`;
  - ORDER_REFUNDED email delivered.
- Stripe keeps its processing fee on a refund. The $1 proof kept A$0.32. The organiser account bears it.
- Paid in Stripe but not PAID in BrainBase: don't refund blindly. Check the webhook delivery first.

## 7. End-of-window closeout

1. Disable (section 5, steps 1–3). Confirm 503 for all organisers.
2. Leave `EVE_PAID_CHECKOUT_ORGS` set; it's harmless with the flag off.
3. Reconcile: Stripe payment count = PAID orders; no PENDING orders with a completed Stripe session; every PAID order has `ticket_email_status = 'sent'`.
4. Check Stripe webhook deliveries for any non-2xx.
5. Close or unpublish the event if sales are finished (Draft, not Cancelled, unless the event itself is cancelled; Cancelled emails buyers).
6. Record: window times, deployment ids, order and refund counts, gross takings, any incidents.
