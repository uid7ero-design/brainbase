# Scheduling Phase 1 — LD Tennis baseline, dependency map and findings

Captured against `origin/main` at `1f28c76e` (2026-10-21). Read-only discovery;
no LD Tennis file was changed. Framework: Next.js 16.2.4 / React 19.2.4 (the
repository's non-standard Next.js; the new code is framework-free and uses no
Next.js API, so the version's breaking changes do not apply to Phase 1).

## 1. What exists

### Data (raw SQL; org-scoped by `organisation_id TEXT`)

| Table | Role | Notes |
| --- | --- | --- |
| `sessions` | Weekly template | `day_of_week`, `start_time`, `duration_minutes`, `max_capacity`, `session_type` (string), `resource_id` (no resource table exists), `price_per_session`, `start_date`, `end_mode` (`ongoing`/`after_weeks`/`on_date`), `end_after_weeks`, `end_date`, `session_colour_key`, `archived_at` |
| `session_instances` | Dated occurrence | `UNIQUE(session_id, date)`; `status` `scheduled`/`cancelled` |
| `bookings` | The enrolment | Copies `client_name`/`client_email` (no `contacts.id`); `session_instance_id`, `status`, `paid`, `attendance_status` (free text), `is_recurring`, `recurring_group_id`, `pipeline_id` |
| `booking_recurrence_pauses` | Pause windows | Per `recurring_group_id` |
| `session_types` | Org-defined types | `slug`, `colour_key`, `active`, `sort_order` |
| `contacts` | LD Tennis CRM ("Squad") | Squad = `status = 'active'`; `UNIQUE(organisation_id, email)`; distinct from `crm_contacts` |

Prisma models for several of these carry "NOT YET APPLIED to production"
comments that predate later work; the live schema and `schema.prisma` are not
guaranteed to agree and were not compared (needs a read-only look at
production, out of scope for Phase 1). `contacts.guardian_name`,
`guardian_phone` and `session_id` are written by `app/api/contacts/[id]` but
declared in neither Prisma nor any script.

### Code and its dependencies

```
app/dashboard/sessions/page.tsx (2,060 lines, client)
  └─ lib/sessionDisplay.ts            pure, framework-free, imports react type only
  └─ fetches /api/dashboard/{sessions,session-types,enrolments}, /api/bookings/[id]

app/api/dashboard/sessions/**   ──► lib/tennisSchedule.ts   (server-only, @/lib/db)
app/api/dashboard/enrolments/** ──► lib/tennisRecurrence.ts (server-only, @/lib/db)
app/api/dashboard/sessions/route,[id]/route ──► lib/tennisSessionTypes.ts (server-only, db)
lib/tennisSchedule.ts ──► lib/tennisRecurrence.ts, lib/date.ts (pure)
app/api/tennis/{book,sessions,cancel,subscribe}  public, no lib/tennis*
app/api/{sessions,sessions/**} + app/admin/sessions + app/api/admin/migrate-sessions  legacy
components/nav/navModel.ts  gate { variant: 'ld-tennis' }, link label "Squad"
lib/dashboard/clientDashboard.ts  variant derived from organisations.slug
```

Classification:

| Code | Tennis-specific | Reusable | DB / framework dependency |
| --- | --- | --- | --- |
| `lib/date.ts` | no | yes | none |
| `computeExpectedOccurrences` (in `tennisSchedule.ts`) | no (weekly rule maths) | yes, pure | none, but uses **server-local** time |
| `lib/sessionDisplay.ts` | colour palette is generic; legacy `SESSION_LABELS` are tennis | mostly | react type only |
| `reconcileFutureInstances`, archive/restore, `reconcileAllSessionsForOrg` | no | rules reusable, SQL tied to legacy tables | `@/lib/db`, `server-only` |
| `tennisRecurrence.ts` (lineages, pauses, duplicate guard) | no | rules reusable | `@/lib/db`, `server-only` |
| Dashboard/legacy routes | table names | no | `@/lib/org`, `@/lib/db`, Next.js |
| `app/api/tennis/*` | yes (env org, wording) | no | `LD_TENNIS_ORG_ID` env |
| Nav gate, "Squad", lead→squad convert | yes | no | slug-derived variant |

### Who calls the legacy stack (verified by repo-wide search)

The "legacy" `app/api/sessions/*` routes and `app/admin/sessions` are **not
unused**: `app/admin/sessions/page.tsx` calls them (lines 93, 507, 512, 521,
554, 563, 569, 586), the page is linked from `components/admin/AdminAside.tsx`
("Planner"), and all of it is `super_admin` only. `app/api/admin/migrate-sessions`
has no caller outside tests.

## 2. Compatibility baseline

Existing suite (unchanged): about 50 tennis-related files in `tests/containment`.
Phase 1 added `tests/containment/schedulingPhase1Baseline.test.ts` (31 tests)
for behaviour that had none.

| Area | Covered by |
| --- | --- |
| Weekly session creation | `tennisSessionNameFallback`, `tennisSessionColourOverrideApi`, `tennisSessionScheduleFormStaticCheck` (static) |
| Rolling-horizon generation | `tennisScheduleRules`; **new** fixed-clock golden dates |
| Recurrence end conditions | `tennisScheduleRules`; **new** (`after_weeks`, `on_date`, future start, malformed rows) |
| Edit and reconcile | `tennisScheduleRules`, `tennisSessionReconcileApi`, `sessionsPatchCrossOrg`; `tennisSessionReactivateCancelledInstance` (**fails at baseline, see 4**) |
| Types and colours | `tennisSessionDisplay`, `tennisSessionTypesApi`, `tennisSessionColourOverrideApi` |
| Capacity and enrolment | `enrolmentsCrossOrg`, `sessionInstanceEnrolCrossOrg`, `tennisWeeklyEnrolment`, `tennisSessionPlayerCount` |
| Recurring bookings | `tennisRecurrence`, `tennisEnrolmentToggle`, `tennisDuplicateEnrolment`, `tennisRecurrence.integration` (real Postgres) |
| Pauses | `tennisEnrolmentPause` |
| Attendance / paid | `bookingsPaidAttendanceGate` |
| Cancellation | **new** single-enrolment DELETE, `remove-future` and public lead cancel; the Once⇄Weekly PATCH is in `tennisEnrolmentToggle` |
| Public booking | `tennisBookPipelineSchema`; **new** 503/429/400/404/409/201 and statement order |
| Public sessions list | **new** |
| Archive / restore | `tennisSessionArchiveApi`, `tennisSessionArchiveLib`, `tennisSessionArchiveAtomicity.integration` |
| Tenant isolation | `*CrossOrg` tests; **new** org scoping on the added routes |
| API contracts | per-route tests above; **new** legacy `/api/sessions` role gate |
| Dashboard routing / nav | `navModel`, `clientNavOwnership`, `tenantAwareNavigation`; **new** nav pins in `schedulingPhase1Containment` |
| UI states | static source checks only (`tennis*StaticCheck`); no visual harness run in Phase 1 |

Not covered: `POST /api/tennis/subscribe`, `dashboard/sessions/[id]/generate-instances`
(static and mock only), most legacy `/api/sessions/*` behaviour beyond its role
gate, and any UI rendering. Unknown rules were reported, not invented:
`bookings.attendance_status` values are unconstrained and unmapped.

## 3. Findings that matter for the replacement

1. **Ongoing-session top-up runs only when a manager opens the sessions page.**
   (Corrected: an earlier revision of this document said nothing called
   `POST /api/dashboard/sessions/reconcile`; that came from a literal-string search that missed
   the template literal `` fetch(`${API}/reconcile`) `` in `app/dashboard/sessions/page.tsx`.)
   The page calls it once on mount. Other triggers: session create and edit, restore, the manual
   Repair button, and a wrong-weekday auto-fix on page load. There is no scheduled job:
   the three production Vercel crons (confirmed from the Vercel project API) are `/api/cron/sync`,
   `/api/cron/ticket-email-recovery` and `/api/cron/hr-employee-document-reminders`, the repo has no
   scheduled GitHub workflow, and the route requires a signed-in manager so an unattended
   scheduler could not call it. Production request logs show the call returning 200 one second
   after a page load. Consequence: instances are generated 10 weeks ahead of the last page visit,
   and the public booking list shows only 28 days, so after roughly six weeks with no manager
   visit the public booking calendar would start to empty. Not a defect today; a dependency to
   carry into the replacement (an unattended trigger). See
   `ld-tennis-reconciliation-trigger-evidence.md`.
2. **Public booking can overbook.** `/api/tennis/book` reads capacity and
   duplicates, then inserts, with no lock or transaction (statement order is
   pinned by a test). The concurrent-create case in the Phase 2 repository
   contract exists for this.
3. **Public booking creates no CRM contact.** The only customer record is the
   `bookings` row and a `client_pipeline` request. `contacts` is populated by
   lead conversion and manual entry. This shapes the CRM-linkage backfill.
4. **Dual tenancy mechanisms.** Public routes use the `LD_TENNIS_ORG_ID`
   environment variable; dashboard routes use the signed-in organisation; nav
   uses the organisation slug. A multi-tenant public booking surface needs
   the tenant resolved from the route, not an environment variable.
5. **Time is server-local.** `reconcile*`, `archive*` and `tennis/sessions`
   compute "today" with `new Date()` / `setHours(0,0,0,0)`, and
   `tennis/sessions` then formats with `toISOString()`. The result depends on
   the runtime timezone (unverified for production; Vercel defaults to UTC),
   so "today" can be a calendar day off for an Adelaide business for part of
   each day. The new `Clock.today(timezone)` port addresses this; the
   compatibility layer deliberately preserves the legacy behaviour until
   cutover.
6. **Status-code and error-swallowing inconsistencies.** Two routes return
   401 where others return 403; several GETs return 200 with an empty list on
   a database error; `generate-instances` has no error handling.
7. **Open input surface.** `POST /api/tennis/subscribe` accepts a
   client-supplied `orgId` with no rate limit; `tennis/cancel` and `subscribe`
   do not guard `req.json()`. Reported only; unrelated to scheduling and not
   changed.
8. **Duplicated logic.** `validateSchedule` is copied in two route files; four
   instance-generation paths exist; two `normalizeEmail` functions; two
   enrolment paths (by contact id without duplicate/recurrence handling, and
   by name/email with both).
9. **Un-scoped writes behind a prior check.** A few UPDATEs filter by id only
   after an organisation-scoped read (`tennisSchedule.ts`, lead convert,
   `bookings/[id]`); `bookings` POST updates `client_pipeline` by id alone
   (super_admin only). The Phase 2 repositories scope every statement.
10. **Legacy `DELETE /api/sessions/[id]`** deletes the session without first
    deleting bookings (may fail on the foreign key); the dashboard DELETE does
    it in order inside a transaction.

## 4. Verification baseline (untouched `origin/main`, Windows, CRLF checkout)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | 21 failures in 5 files out of 18,221 tests, 186 skipped |

The five files: `clientDayOverviewStaticCheck` (7), `dashboardPolishStaticCheck`
(5), `tennisSessionReactivateCancelledInstance` (7), plus `resendLazyInit` (1) and
`reportingPeriodReviewWiring` (1). CI already excludes the first three (19
failures). The last two **pass when run alone** and failed only under full-suite
load. `tennisSessionReactivateCancelledInstance` fails because it hard-codes
dates from the August bug report ("today is Wed 2026-08-19", end date
2026-09-06) and uses the real clock, so it has been failing since that window
passed; it is date-rot, not a regression, and is why the CI exclusion exists.
The Phase 1 tests use fixed clocks so they cannot rot the same way.
