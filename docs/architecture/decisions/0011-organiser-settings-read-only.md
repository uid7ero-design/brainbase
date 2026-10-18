# 0011 — Organiser Settings (read-only) in the Eve console

Status: Accepted for Preview (Eve Phase 3.4). No schema change, no migration.
No settings mutation, Connect onboarding, fee edit or branding upload.

## Decision

`GET /api/ticketing/organiser/settings[?event=<id>]` (viewer+, same gate / Eve
session / fresh-DB authorisation and tenant scoping as Payments) feeds Eve's
`/organiser/settings`. BrainBase stays canonical; Eve only reads.

| Section | Source | Notes |
|---|---|---|
| Organisation | `organisations` name, slug | `organisations.timezone` is deliberately NOT read: `organisationTimezoneSchema.test.ts` pins that no application code consumes it yet |
| Events capability | the authorisation itself | A caller without the Events capability never reaches the handler (403), so the field is `enabled: true`; the entitlement `config` blob is never returned |
| Paid tickets / Connect | `getConnectAccountState`, `checkPaidTicketingEligibility` | cached `organisations.stripe_*` columns, no live Stripe call, account id never projected |
| Fees | `resolveFeePolicy` (the checkout/quote resolver): event row > organisation row > platform default | org level by default, the named event's with `?event=`; disabled row = "no fee (disabled)", distinct from "not configured"; only mode, components, currency, label and who pays are projected (no id, version, tax metadata); never derived from order snapshots; no hypothetical revenue |
| Branding | `organisations.settings.branding` through the existing coercion | display name, accent, website, support email/phone, email footer; the logo is reported only as set / not set (no URL); address, ABN and sender name are not projected |

An unreadable fee row (the checkout fails closed on it) is reported
`unavailable`, never guessed.

## Presentation notes

Eve states that orders placed through Eve are sent to buyers as Eve (Eve branding
and links) and shows no internal wording. Eve's source keeps its Phase 1 rule of
not naming the other product, so the "managed in …" wording is "read-only here /
not available in Eve yet".

## Out of scope

Any mutation, Connect onboarding, fee-policy editing, branding upload, team
management, sender-domain management.
