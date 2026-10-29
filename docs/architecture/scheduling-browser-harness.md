# Scheduling browser harness

A repeatable, fully local Playwright harness for the Scheduling dashboard. It exists because server-side proofs (the
PostgreSQL integration suites) cannot show what a signed-in person actually sees, and because the module-access middleware
of PR #489 and Scheduling's own guard are two separate layers that both need exercising over real HTTP with real sessions.

Run it with `npm run test:scheduling:browser` (optionally followed by Playwright arguments such as
`permissions.spec.ts --project=desktop`). It needs Docker and the Playwright Chromium browser. It is **not** part of CI
(Docker is not part of the standard workflow) and `npm run test:browser` skips every spec in this folder.

## Architecture

```
Playwright (Chromium: 390x844, 768x1024, 1440x900; light and dark)
        |  HTTPS, self-signed, loopback only
        v
loopback TLS proxy  ->  the REAL Next production server (next build + next start)
                         real login, session cookie, middleware (#489 module access), Scheduling guard, routes, repositories
                              |  Neon HTTP SQL protocol
                              v
                      SQL-over-HTTP bridge (in the orchestrator process)  ->  disposable PostgreSQL 17 (Docker, loopback port)
```

| Piece | File |
| --- | --- |
| Orchestrator: start the environment, run Playwright, tear everything down | `scripts/tests/verify-scheduling-browser-local.mjs` |
| Environment: database, schema, seed, bridge, build, server, TLS proxy | `scripts/tests/helpers/schedulingBrowserEnv.mjs` |
| Network guard loaded into the Next process (`--import`) | `scripts/tests/helpers/schedulingLocalNetworkGuard.mjs` |
| Playwright config, accounts, global sign-in, helpers | `tests/browser/scheduling/` |
| Specs | `permissions.spec.ts`, `stale-write.spec.ts`, `responsive-a11y.spec.ts`, `harness.spec.ts` |

It follows the same pattern as the HR full-app proof (`scripts/tests/verify-hr-full-local.mjs`): only the **transport** is
substituted. No session, authorisation, Scheduling response or entitlement is faked.

### Authentication and safety

* Every account is **synthetic** and is signed in through the application's **own login form** (real bcrypt check, real
  `session` cookie). `globalSetup.ts` first proves that a wrong password does not produce a session.
* Passwords are random per run, exist only in the environment of the test processes and are never printed.
* There is no session bypass, no minted token and no weakened authentication.
* The Next process runs with every credential-like variable blanked and every `.env*` variable cleared. The network guard
  refuses every request that is not loopback and every SQL connection that is not the disposable one. A pre-flight check
  proves both before the server starts.
* Production, Preview and Neon are never contacted and no customer data is involved.
* Test output, saved sign-in state and the build live outside the working tree or in a task directory that is removed on exit.
  (Writing into the tree while a **dev** server runs corrupts its manifests; `SCHED_BROWSER_MODE=dev` exists but is not the default.)

### Seed

| Organisation | Purpose |
| --- | --- |
| `sched-org-a` (Australia/Adelaide) | Scheduling-enabled; the main organisation |
| `sched-org-c` (Australia/Perth) | A second entitled organisation, for foreign object ids |
| `sched-org-b` | Not entitled |
| `sched-hq` | Home of the platform-owner account |

| Account | Organisation | Role | `organisation_user_access` (Scheduling) | Exercises |
| --- | --- | --- | --- | --- |
| `manager` | A | MANAGER | use | the full manager path |
| `manager-legacy` | A | MANAGER | none (no row) | role-only path |
| `manager-view` | A | MANAGER | view | middleware refuses writes for a manager role |
| `viewer` | A | VIEWER | view | read-only through both layers |
| `viewer-use` | A | VIEWER | use | middleware allows, Scheduling guard refuses |
| `viewer-legacy` | A | VIEWER | no row | Scheduling guard alone |
| `viewer-none` | A | VIEWER | none | middleware refuses everything |
| `analyst` | A | ANALYST | use | module access alone does not grant Scheduling |
| `analyst-legacy` | A | ANALYST | no row | Scheduling guard fails closed |
| `unentitled-manager` | B | MANAGER | use | access row cannot grant an unentitled module |
| `unentitled-legacy` | B | MANAGER | no row | Scheduling entitlement guard |
| `foreign-manager` | C | MANAGER | use | cross-organisation isolation |
| `owner` | HQ | SUPER_ADMIN | no row | impersonation |

The Scheduling schema is applied exactly as in Production: `010_shared_schema.sql`, `110`/`120` host scripts, then `030` to
`033` (markers 2b.2.1 to 2b.2.4). Configuration data is created by the specs through the real API.

## What is covered

* **Permission matrix** (`permissions.spec.ts`): status, list and write over real HTTP for every account above plus an
  anonymous caller; the page each account sees; a refused request must not change any row. Viewer UI has no management controls.
  Foreign ids return 404 in both directions and change nothing. The organisation cannot be overridden by query string, header,
  cookie or body. Platform-owner impersonation switches scope, is refused for an unentitled organisation and genuinely ends.
  Customer-identifying audit information reaches a manager and never a viewer.
* **Two-tab stale write** (`stale-write.spec.ts`): two real tabs of one browser context open the same schedule, offering and
  resource; the second to save gets 409 `STALE_WRITE`, the visible message and **Reload latest**; reloading shows the first tab's
  committed version and nothing was overwritten.
* **Responsive and accessibility** (`responsive-a11y.spec.ts`): real viewports, light and dark, no horizontal overflow, axe-core
  (WCAG 2.2 AA including colour contrast, evaluated in the real page) over the Scheduling regions, target size (24 px AA minimum,
  44 px reported), dialog size, focus trap, Escape, focus return, announced validation errors, keyboard order and focus indicator,
  mobile navigation and organisation-switcher behaviour.

## Not covered

Live accounts in Production (no invitations are sent and no Production account is created by this harness), real touch devices
and assistive-technology screen-reader output, and anything involving reservations, availability, recurrence, attendance,
payments or public booking (none exist in this release).
