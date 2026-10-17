# Eve — Events made easy (Phase 1 shell)

Standalone ticketing product shell built on the shared ticketing core
(`packages/ticketing`, imported as `@ticketing/core`). It never contains
its own ticketing engine, Stripe integration, database access or copy of
the BrainBase shell; see `docs/architecture/decisions/0007-monorepo-boundary-standalone-ticketing.md`.

## Local

```
cd apps/eve
npm install          # own lockfile; the repository root is not a workspace
npm run dev          # webpack dev server (see next.config.ts for why not Turbopack)
npm run typecheck
npm run test         # route render + axe smoke + boundary tests
npm run lint
npm run build
```

The root BrainBase application is unaffected by anything under `apps/eve`
(root `tsconfig` excludes `apps`, root ESLint ignores `apps/**`).

## Routes

| Area | Routes | State in Phase 1 |
| --- | --- | --- |
| Marketing | `/`, `/features`, `/pricing`, `/organisers`, `/venues`, `/signin`, `/get-started` | Live copy; pricing / sign-in / get-started are explicit "not yet available" panels |
| Buyer | `/e/[eventSlug]`, `/t/[token]`, `/b/[bookingToken]/tickets` | Route shape real; gateway unconnected → unavailable panel, no sample data |
| Organiser | `/organiser`, `/organiser/{events,orders,attendees,check-in,payments,settings}` | Own console chrome; every panel unavailable until auth + API exist |

## Data

`lib/ticketing/gateway.ts` is the only seam to the backend. Phase 1 ships
the `unavailableGateway`. Phase 2 replaces it with a server-side client of
the authenticated ticketing API served by the BrainBase deployment. The
browser never talks to a database.

## Product identity

`config/product.ts` is the single declaration (name, tagline, base URL,
support email, sender identity, theme, feature switches). Values flow into
`defineProductConfig()` from `@ticketing/core`; the core itself reads no
environment.

## Deployment (Preview only in Phase 1)

Separate Vercel project (same Git repository):

| Setting | Value |
| --- | --- |
| Root Directory | `apps/eve` |
| Framework | Next.js (auto-detected) |
| Install command | default (`npm install` in `apps/eve`, own lockfile) |
| Build command | default (`npm run build` → `next build --webpack`) |
| Include files outside root | on (default) — needed for `packages/ticketing` |
| Production deployments | **disabled** by `vercel.json` `ignoreCommand` (exit 0 when `VERCEL_ENV=production`) |
| Domains | none configured |

### Environment variables

| Variable | Required in Phase 1 | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_EVE_BASE_URL` | no (defaults to `http://localhost:3100`) | Absolute origin for public links and metadata |
| `EVE_SUPPORT_EMAIL` | no (placeholder `support@eve.invalid`) | Shown to buyers and organisers |
| `EVE_EMAIL_FROM` | no (placeholder) | Sender identity once email is sent from this product |

Nothing else. In particular **no** `DATABASE_URL`, `SESSION_SECRET`,
`STRIPE_*` or `RESEND_*` belongs in this project in Phase 1.

### Shared vs separate (for Phase 2 planning)

- Shared with BrainBase: the Neon database (through the ticketing API, never
  directly), the `users`/`organisations` tables, the Stripe **platform**
  account and the organisers' connected accounts, the ticketing core code.
- Separate: the Vercel project, domain and session cookie/secret, the
  product config, the Resend sender domain and templates' identity, the
  public base URL embedded in tickets and emails.

### Stripe (TEST mode) requirements for Phase 2

Test-mode platform keys only, in the API deployment (not here); a
test-mode webhook endpoint per deployment host; organiser Connect in test
mode. No live Stripe setup exists or is planned for this phase.

### Resend requirements for Phase 2

A verified sender domain for the product, `EVE_EMAIL_FROM` on that domain,
and a Resend webhook per deployment host for delivery/bounce tracking.
Synthetic inboxes only (`delivered@resend.dev`, `bounced@resend.dev`) until
then.

## Content rules

- No unsupported claims (pricing comparisons, charity/profit statements,
  reserved seating, offline scanning). `tests/routes.test.tsx` fails on
  them.
- `content/impact.ts` is an internal, disabled placeholder and is never
  rendered.
