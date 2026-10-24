# 0009 — Product-aware buyer communications

Status: Accepted for Preview (Eve Phase 3.2). No schema change. Eve Production
stays disabled; sender-domain enablement is a separate operator step (§5).

## 1. Context

ADR 0008 stamps every order with `event_orders.product_surface`
(`BRAINBASE` | `EVE`). Until now every buyer email — ticket, booking wallet,
order cancelled, order refunded, event cancelled, event reminder — was built on
BrainBase's `NEXT_PUBLIC_APP_URL`, the BrainBase wordmark/legal footer and the
BrainBase sender, so an Eve buyer was sent BrainBase links and identity.

## 2. Decision

`lib/events/buyerProduct.ts` resolves a **BuyerProductContext** from the
committed order's `product_surface` and nothing else:

| | BRAINBASE (and every historical / unrecognised value) | EVE |
|---|---|---|
| link base (`/t/<token>`, `/b/<token>/tickets`) | `NEXT_PUBLIC_APP_URL` (unchanged) | `EVE_PUBLIC_BASE_URL` |
| shell wordmark / legal line | unchanged (BRAINBASE, “Brainbase · Adelaide SA Australia”) | `EVE` / “© year Eve” |
| sender | `EMAIL_FROM` default (unchanged) | `EVE_EMAIL_FROM` |

- BrainBase remains the only delivery layer: one `sendEmail()`, one Resend
  account. `sendEmail` gained one optional `from`; nothing else about the call
  changed. No Reply-To is set for any product (existing invariant retained).
- Templates take an optional `product` context. Absent ⇒ the byte-identical
  BrainBase output (asserted).
- Identity is read from `eo.product_surface` in the three send paths — the
  automatic ticket email (initial + recovery sweep), the manager's manual
  resend, and the lifecycle notification delivery (cancel / refund / event
  cancelled / reminder, inline + retry + recovery). It is resolved fresh on every
  attempt from the underlying order, so a retry, a recovery sweep or a webhook
  replay cannot change it. It is never taken from a request body, header,
  Origin, or Stripe metadata.

## 3. Failure behaviour — fail closed

Two independent gates for an Eve order:

- `EVE_LINK_BASE_UNAVAILABLE` — `EVE_PUBLIC_BASE_URL` missing/invalid (https
  required in production).
- `EVE_SENDER_UNCONFIGURED` — `EVE_EMAIL_FROM` missing, malformed, on a
  placeholder domain (`*.invalid`, `*.test`, `*.example`, `localhost`) or with a
  display name containing “Brainbase”.

Either way nothing is sent and there is **no BrainBase fallback**. Automatic and
lifecycle deliveries record a retryable `not_configured` failure (the ordinary
backoff schedule; recovery resumes once configured and sends with Eve identity);
the manual resend returns 503 without an audit/cooldown row. Links/branding and
sender enablement are separate, so links can be configured before a sender
domain is approved.

## 4. What this does not do

No new email engine, no second Resend configuration, no change to ticket,
payment or refund semantics, no charity / not-for-profit / social-purpose or
legal-entity claim in Eve emails, no Eve Production enablement.

## 5. Operator step (outside the code)

An Eve sender must be a Resend-verified domain on BrainBase's Resend account
(SPF/DKIM for the chosen domain), or a display-name-only sender on an already
verified BrainBase domain (e.g. `Eve <…@brainbase.app>`), then set
`EVE_EMAIL_FROM` and `EVE_PUBLIC_BASE_URL` on the **BrainBase** project. Which of
those two is acceptable is a product/branding decision, not a code one.
