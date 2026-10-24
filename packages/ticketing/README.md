# @ticketing/core

Shared ticketing domain primitives for BrainBase Events and the standalone
ticketing product. Pure TypeScript, consumed as source by both applications
through the `@ticketing/core` path alias (root `tsconfig.json` and
`apps/*/tsconfig.json`); no build step, no runtime dependencies.

| Module | What it holds |
| --- | --- |
| `domain` | Event / order / payment status unions mirroring the DB constraints, ticketing concepts, `isLiveOrder` |
| `productConfig` | Product identity seam (`defineProductConfig`) and public link builders |
| `feeCalculation` | Platform / booking fee arithmetic in integer cents |
| `ticketValidity` | "Is this ticket valid" derivation and public status mapping |
| `saleWindow` | Per-ticket-type sale window and sale status vocabulary |
| `orderGrouping` | Folding order-item rows into one entry per order |
| `receipt` | Neutral payment summary model and HTML renderer |
| `ticketEmailEligibility` | Whether an order may receive a ticket email |
| `validation` | Organiser input validation for events, sessions, ticket types, promotions, access codes, pair inventory |
| `artworkConstants` | Event artwork upload limits |

What stays in the owning application on purpose: SQL reservation gates and
lock ordering (`lib/events/services/*`), order state transitions, Stripe and
Resend integration, lifecycle notifications, auth and sessions, organisation
branding. See `docs/architecture/decisions/0007-monorepo-boundary-standalone-ticketing.md`.

BrainBase keeps a one-line re-export at every former `lib/events/<module>.ts`
path, so existing imports are unchanged.

Tests: `npx vitest run --project packages` from the repository root.
