# 0007 — Monorepo boundary for the standalone ticketing product (Eve, Phase 1)

Status: Accepted (standalone product Phase 1). Establishes the technical
boundary between the BrainBase application, the standalone ticketing
product ("Eve — Events made easy") and the shared ticketing core. No
BrainBase runtime behaviour changes; no schema change.

## 1. Context

The shared Events/Ticketing core (service layer, multi-type carts, Stripe
Connect, retry safety, type × session inventory, promotions, fees,
lifecycle communications, wallet/QR tickets, check-in, refunds, reminders,
delivery tracking, audit/tenant isolation) is mature and lives in
`lib/events/**`, `app/api/public/**`, `app/e|t|b/**` of the BrainBase
Next.js application. A second, customer-facing product must reuse that
engine without exposing the BrainBase shell and without a second copy of
the engine, a second Stripe implementation or a second schema.

Read-only architecture check (main at `b6128667`):

- one Next.js 16.2 application at the repository root; npm, single
  `package-lock.json`, no workspaces; `tsconfig` includes `**/*.ts(x)`
  with the `@/*` alias; Vercel project `brainbase` builds the root; CI
  runs root `tsc`, root `vitest`, root `eslint`;
- genuinely ticketing-domain code: `lib/events/**` (services, Stripe,
  notifications, check-in, public reads, validation) and the public
  routes `/e`, `/t`, `/b` plus `/api/public/events/**`;
- BrainBase shell: `app/layout.tsx` (TopNav, OrgSwitcher, SessionProvider),
  `middleware.ts` (cookie `session`, JWT via `lib/session.ts`), `lib/org.ts`
  role checks, organisation modules (Data Hub, Assurance, CRM, …);
- buyer-facing UI (`PublicEventClient.tsx`, ticket page, wallet) imports
  BrainBase branding (`BrainBaseWordmark`, `OrganisationLogo`,
  `InstitutionalChrome`) and the institutional theme — reusable in
  principle, tightly branded in practice;
- tight couplings that would break if moved today: every service imports
  `@/lib/db` (Neon serverless client), `server-only`, `lib/organisations/
  branding`, `lib/crm/eventSync`, `lib/email`; many containment tests
  read these files as source text by path.

## 2. Decision — Option B: BrainBase stays at the root

```
<repo root>            BrainBase app (unchanged location, unchanged build)
apps/eve/              standalone product shell (own package.json, lockfile,
                       next.config, tsconfig, eslint, vitest, vercel.json)
packages/ticketing/    @ticketing/core — pure shared ticketing primitives
```

Moving the whole BrainBase app into `apps/brainbase` would change the
Vercel root directory, every tooling path, the CI workflow and dozens of
source-text tests for no functional gain; it is deferred until a second
shared package genuinely needs workspace tooling.

No npm workspaces in this phase: root `package.json` and
`package-lock.json` are untouched. Both apps consume the package as
TypeScript source through a path alias (`@ticketing/core`,
`@ticketing/core/*`) declared in the root `tsconfig.json`/`vitest.config.ts`
and in `apps/eve/tsconfig.json`/`vitest.config.ts`. The package has no
runtime dependencies and no build step.

Root changes limited to: the two alias lines and `"apps"` in `exclude` in
`tsconfig.json`; a `packages` vitest project and the alias in
`vitest.config.ts`; `apps/**` in the root ESLint ignores; eight one-line
re-export shims at the former `lib/events/*.ts` paths; two source-text
test paths re-pointed to the package file (assertions unchanged).

## 3. What the shared package contains (and why only this)

`feeCalculation`, `ticketValidity`, `saleWindow`, `orderGrouping`,
`receipt`, `ticketEmailEligibility`, `validation` (organiser input rules),
`artworkConstants` — all already pure (no imports) — plus two new modules:
`domain` (event/order/payment status unions mirroring the SQL CHECK
constraints, the neutral concept list, `isLiveOrder`) and `productConfig`
(the identity seam, §6).

Deliberately kept in BrainBase: `lib/events/services/*` (reservation gate,
lock order, retry CAS), `stripe.ts`/`stripeConnect.ts`, notification
delivery and recovery, check-in mutation, public reads
(`publicEventDetail.ts` etc.), `publicValidation.ts` (HTTP body shape, 8
source-text tests), `publicEventTheme.ts` (BrainBase/institutional
presentation), auditing. Each depends on the Neon client, `server-only`,
organisation branding or CRM hooks; extracting them would mean moving the
database connection and tenant model, which is Phase 2+ work behind an
API, not a file move.

Boundary tests (`packages/ticketing/tests/boundary.test.ts`) fail the
build if the package ever imports an application path, a framework, a
provider SDK, `process.env` or a product name.

## 4. The standalone product shell (apps/eve)

Own root layout, tokens and chrome; no import of any BrainBase file
(enforced by `apps/eve/tests/boundary.test.ts`). Routes: marketing (`/`,
`/features`, `/pricing`, `/organisers`, `/venues`, `/signin`,
`/get-started`), buyer placeholders (`/e/[eventSlug]`, `/t/[token]`,
`/b/[bookingToken]/tickets`), organiser console (`/organiser` and
`/organiser/{events,orders,attendees,check-in,payments,settings}`). Every
surface whose backend is not connected renders an explicit "Not yet
available" panel (`data-eve-unavailable`); tests assert no sample data,
no tables, no forms, no fee figures, no unsupported claims and no other
product's navigation.

Bundler: webpack. Turbopack needs `turbopack.root` raised to the
repository root to read `packages/ticketing`, and at that root it also
discovers BrainBase's `middleware.ts` and compiles it as this app's — the
exact coupling the boundary forbids.

## 5. Auth strategy (recommendation: A)

BrainBase sessions are an HS256 JWT in a `session` cookie signed with
`SESSION_SECRET`, validated by root `middleware.ts` and re-checked against
the `users` table by `lib/org.ts`. The standalone product will run on its
own domain, so that cookie can never be read there and must not be
re-used across domains.

Chosen path for Phase 2: **shared users + a separate session for the
product's own domain** — same `users`/`organisations` tables (no second
user database), a session issued by the ticketing API on sign-in, signed
with the product's own secret, set only for the product's host. Phase 1
ships a sign-in placeholder with no credential form; no temporary auth
exists.

## 6. Data / API strategy (recommendation: B)

The product's browser never reaches a database. Phase 1 defines
`apps/eve/lib/ticketing/gateway.ts` — the `TicketingGateway` contract
(public event, ticket, booking wallet, organiser orders) with one
implementation that answers "unavailable". Phase 2 implements it as a
server-side client of an **authenticated ticketing API served by the
BrainBase deployment** (the public routes `/api/public/events/**` already
exist; organiser routes gain token auth). The SQL stays in one place.

## 7. Product identity seam

`@ticketing/core/productConfig` defines `ProductConfig` and
`defineProductConfig()`; the core never reads `process.env`. BrainBase's
defaults (`EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`, wordmark, sender) are
unchanged and not routed through the seam in this phase. The standalone
product declares its identity once in `apps/eve/config/product.ts`.

## 8. Deployment

Separate Vercel project with Root Directory `apps/eve`, Preview only:
`apps/eve/vercel.json` `ignoreCommand` skips every production deployment.
No domain, no live Stripe, no Resend sender configured. Details in
`apps/eve/README.md`.

## 9. Not done in this phase

Workspaces; moving BrainBase under `apps/`; extracting stateful services;
auth; the ticketing API; any organiser or buyer functionality beyond the
shell; pricing figures; branding beyond tokens and wordmark; the
social-purpose note remains an internal, disabled placeholder.
