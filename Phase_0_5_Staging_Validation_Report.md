# Phase 0.5 Staging Validation Report

**Branch:** `phase-0-5-staging`
**Initial containment commit:** `1dc8c1c` — "security: complete Phase 0.5 emergency containment"
**Pipeline correction commit:** `bd9587c` — "fix: surface pipeline query errors and support UUID ids"
**Environment:** Vercel Preview (branch-scoped)
**Database:** separate, disposable Neon project `brainbase-phase-0-5-staging`
**Data:** synthetic only — no production data, no real customer data, no real credentials
**Status:** documentation only. This report records results of the staging validation exercise; it does not itself execute, modify, or connect to anything.

---

## 1. Environment isolation — PASS

| Check | Result |
|---|---|
| Preview branch-scoped `DATABASE_URL` / `DIRECT_URL` | PASS — configured against the disposable `brainbase-phase-0-5-staging` Neon project, not the production database |
| Preview-only `SESSION_SECRET`, `ADMIN_SEED_SECRET`, `CRON_SECRET` | PASS — distinct values scoped to the Preview environment |
| Preview deployment protected by Vercel Authentication | PASS |
| Production branch and Production database unchanged | PASS |

No environment-variable values, connection strings, or secrets are reproduced in this report.

## 2. Database initialisation — PASS

| Check | Result |
|---|---|
| Minimal staging-only schema executed successfully | PASS |
| Exactly 10 public tables | PASS — `organisations`, `users`, `modules`, `organisation_modules`, `sessions`, `session_instances`, `bookings`, `client_pipeline`, `pipeline_messages`, `social_connections` |
| 2 synthetic organisations | PASS — Staging Org A, Staging Org B |
| 4 synthetic users | PASS — `staging.superadmin`, `staging.manager.a`, `staging.manager.b`, `staging.viewer.a` |
| 1 synthetic pipeline row | PASS |
| 2 sessions | PASS — one per organisation |
| 2 session instances | PASS — one per organisation |
| 0 baseline bookings | PASS |
| 0 baseline pipeline messages | PASS |
| No `service_requests` table created | PASS |
| Bcrypt placeholders absent, all hashes valid format | PASS |
| No cross-organisation seeded relationships | PASS |

## 3. Authentication tests — PASS

| User | Expected role / org | Result |
|---|---|---|
| `staging.superadmin` | `super_admin`, Staging Org A | PASS |
| `staging.manager.a` | `manager`, Staging Org A | PASS |
| `staging.manager.b` | `manager`, Staging Org B | PASS |
| `staging.viewer.a` | `viewer`, Staging Org A | PASS |
| Logout | Cleared the authenticated identity | PASS |
| `/api/me` anonymous fallback | `{"role":null,"name":null}` | PASS |

No plaintext passwords, hashes, session cookies, or tokens are reproduced in this report.

## 4. Authorisation and fail-closed tests — PASS

| Test | Expected | Result |
|---|---|---|
| Viewer `GET /api/admin/pipeline` | 403 Forbidden | PASS |
| Manager A `DELETE` Organisation B's session | 404 Not found | PASS |
| Organisation B session and instance remained intact after the denied delete | Unchanged | PASS |
| Unauthenticated `GET /api/cron/sync` | Unauthorized | PASS |
| Gmail owner-org check | 403 | PASS |
| Google Calendar owner-org check | 403 | PASS |
| Spotify owner-org check | 403 | PASS |
| Manager `POST /api/admin/seed` without secret | 403 | PASS |
| Super_admin `POST /api/admin/seed` without secret | 403 | PASS |
| Seed-denial tests caused no database changes | Confirmed | PASS |

## 5. Pipeline-list defect — found and corrected — PASS (post-fix)

| Item | Detail |
|---|---|
| Original defect | `GET /api/admin/pipeline` returned `{"requests":[]}` despite a confirmed, existing seeded row |
| Root cause | The booking subquery compared `bookings.pipeline_id` (native `UUID`) to `cp.id::text` — an incompatible-type comparison in PostgreSQL (`operator does not exist: uuid = text`) |
| Contributing defect | The route's blanket `.catch(() => [])` silently converted the resulting SQL error into a successful, empty-looking `200` response instead of surfacing it |
| Correction (query) | `WHERE pipeline_id = cp.id::text` → `WHERE pipeline_id::text = cp.id::text` |
| Correction (error handling) | Query errors now return `HTTP 500` with a generic `{"error":"Failed to load pipeline"}` body — no SQL text, driver detail, or stack trace exposed |
| Commit | `bd9587c` |
| New targeted tests | 6/6 PASS |
| Full containment suite | 118/118 PASS |
| TypeScript (`tsc --noEmit`) | Clean — PASS |
| Targeted lint (changed files only) | Clean — PASS |
| Production build (`next build`) | Successful — PASS |
| Corrected Preview behaviour | `GET /api/admin/pipeline` returned the synthetic pipeline row — PASS |

## 6. Pipeline booking transaction tests — PASS

| Test | Expected | Result |
|---|---|---|
| Organisation B session-instance booking attempt against Org A's pipeline | 404 | PASS |
| Denial caused no database changes | Confirmed | PASS |
| Organisation A session-instance booking attempt | 201 | PASS |
| Booking status | `confirmed` | PASS |
| Pipeline status | `resolved` | PASS |
| Pipeline message created | 1, `author_type = founder` | PASS |
| Booking's organisation/session/session-instance/pipeline IDs | All matched Organisation A | PASS |
| Rollback | Completed | PASS |

**Final baseline restored after rollback:**
- `booking_count`: 0
- `pipeline_status`: `new`
- `message_count`: 0

## 7. Explicit exclusions and unresolved items

These are documented gaps in scope, not failures of anything that was actually tested:

- `/api/admin/impersonate` — **not tested**; its `TEXT = ::uuid` comparison against `organisations.id` remains a confirmed incompatible-type condition, unresolved at the application-code level.
- Valid-secret `/api/cron/sync` execution — **not tested**; `integrations`/`sync_jobs` tables are intentionally omitted from the minimal staging schema.
- `signup` — **not supported** by the minimal schema (requires columns and a role-casing convention the schema does not provide).
- Tennis booking (`/api/tennis/book`) — **not supported** by the minimal schema (requires an omitted `client_pipeline.submitted_by_name` column).
- Real Meta (Instagram), Gmail, Google Calendar, and Spotify OAuth end-to-end flows — **not tested**; these depend on external provider configuration and network access outside this schema's and this exercise's scope.
- Individual dashboard modules relying on intentionally omitted operational tables (e.g. waste/fleet data) — **not tested**.
- Full schema governance and reconciliation between the Prisma schema and the raw-SQL migration routes — **remains deferred**, out of scope for Phase 0.5.
- The `service_requests` Prisma-vs-raw-SQL schema collision — **remains unresolved**, as originally flagged in the Phase 0 baseline report.
- **Production promotion is not approved by this report.**

---

## Evidence summary

All results above were produced by executing the previously issued, explicitly scoped staging test instruction sets (authenticated fetch calls and read-only SQL checks) against the isolated Vercel Preview deployment and its disposable Neon database, using synthetic data only. No production system, production database, or real customer data was involved at any point in this validation.

## Commits tested

- `1dc8c1c` — Phase 0.5 emergency containment (baseline security fixes, 112 automated tests)
- `bd9587c` — pipeline-list query and error-handling correction (6 additional automated tests)

## Known limitations

See §7 above in full. In summary: impersonation, live cron sync execution, signup, tennis booking, real third-party OAuth completion, and non-seeded dashboard modules were not exercised in this validation round; the `service_requests` collision and broader schema governance remain open, deferred items.

## Rollback confirmation

The synthetic booking and pipeline message created during the pipeline-booking transaction test (§6) were removed, and the synthetic pipeline row's status was restored to `new`. The disposable database's baseline state matches its pre-test condition.

## Final database counts (post-rollback)

- Organisations: 2
- Users: 4
- Pipeline rows: 1
- Sessions: 2
- Session instances: 2
- Bookings: 0
- Pipeline messages: 0
- `service_requests` table: absent (0)

## Recommendation

Phase 0.5 staging containment validation has passed for the tested scope.
Do not promote to Production and do not begin Phase 1 until the report is
reviewed and explicit approval is given.
