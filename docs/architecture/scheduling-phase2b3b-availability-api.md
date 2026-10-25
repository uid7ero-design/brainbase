# Scheduling Phase 2B.3b: availability repository and guarded API

Status: built on a draft PR, NOT merged. **Migration 034 is staged and NOT applied anywhere.** No screen, no calendar, no booking, no
reservation, no hold, no occurrence. Until 034 is applied every availability route answers `503 AVAILABILITY_NOT_READY` and writes nothing,
so merging the code does not change Production behaviour (the routes are reachable but inert).

Code: `packages/scheduling/src/availabilityPersistence.ts` (types, the repository port, `checkRuleWrite`/`checkExceptionWrite`),
`packages/scheduling-postgres/src/availabilityRepository.ts`, `lib/scheduling/config/availability.ts`, eight routes under
`app/api/scheduling/`, `packages/scheduling/sql/034_availability_integrity.sql` (+ `095_` rollback). Builds on the 2B.3a core
(`docs/architecture/scheduling-phase2b3a-availability-core.md`).

## 1. Why a migration is needed (the reviewed need)

The brief asked for optimistic concurrency (`expectedUpdatedAt`), no overlapping rules and safe concurrent editing, without a migration
unless needed. Two facts about the existing 2a.2 schema make that impossible without one:

1. `scheduling_availability_rules` and `scheduling_availability_exceptions` have **no `updated_at`**, so there is nothing to compare an
   edit against. Every other editable Scheduling table has one, maintained by a trigger.
2. "No two rules of one owner overlap" spans several rows. A single `INSERT ... WHERE NOT EXISTS` reads the snapshot taken when the
   statement began, so two concurrent overlapping inserts both pass it (reproduced; see the mutation check below). The repository runs one
   statement per operation (the package's standing rule: no interactive transaction), so the check has to run where a lock can be taken
   first: in a trigger. That is the same technique, lock family and ordering rules as 030-033.

Nothing else changes: no table is created, no existing column, constraint, trigger or function is altered, and no row is rewritten.

## 2. What migration 034 contains

| Object | Purpose |
| --- | --- |
| `updated_at timestamptz NOT NULL DEFAULT now()` on both tables | the version token (`ADD COLUMN IF NOT EXISTS`; existing rows get the migration time) |
| `scheduling_availability_rules_touch`, `..._exceptions_touch` | reuse `scheduling_touch_updated_at()` on every update |
| `scheduling_availability_lock_owner(org, resource, offering)` | takes the owner's lock first, then refuses an inactive resource (`SCRES`) or an archived offering/schedule (`SCARC`) |
| `scheduling_availability_rule_integrity()` + trigger (INSERT, UPDATE) | owner never changes (`SCOWN`); no overlap with another rule of the owner (`SCOVL`) |
| `scheduling_availability_exception_integrity()` + trigger | owner never changes; no same-kind exception of the owner sharing a date (`SCOVL`) |
| version marker `2b.3.1` | the migration's own record |

Deletes are deliberately unguarded so availability can always be removed, including for an archived offering or an inactive resource.
Existing rows are never re-validated.

Locks: a resource owner uses the per-resource advisory lock of 010/030 (so availability writers and a deactivation order against each other);
an offering owner uses a per-offering availability advisory lock, then the schedule and offering rows `FOR SHARE` (the order of 032/033, so an
archive in flight and an availability write wait for each other). One advisory lock at most per statement, taken before anything is read.
The proof runs the races repeatedly and no statement is ever killed as a deadlock.

Requires `010` (version `2a.2`) only; it does not depend on 030-033 being applied. Idempotent; one transaction; `lock_timeout` 5 s.
Rollback `095` removes the triggers, functions and the two columns (the version tokens are derived data; no rule or exception row is touched).

### Handoff checklist (owner-run, separate approval; nothing here was run against Production)

1. Read-only precheck: `SELECT version FROM scheduling_schema_migrations` shows `2a.2`; `SELECT count(*) FROM scheduling_availability_rules`
   and `..._exceptions` are `0` for the pilot (the pilot has no availability rows, so no row is affected).
2. Apply `034_availability_integrity.sql` in one transaction (manual Neon SQL editor handoff, as for 030-033).
3. Verify: the four triggers exist and are enabled; `2b.3.1` is in `scheduling_schema_migrations`; both tables have `updated_at`.
4. Only then do the routes start answering (they return 503 `AVAILABILITY_NOT_READY` before this).
5. Rollback is `095`, which returns the routes to 503. Neither file is run by the application.

## 3. Semantics of the API

All routes sit behind the central guard (`schedulingRoute`): session 401, entitlement 403, role/level permission 403, then the handler. The
organisation is always the session's; no request field, parameter or response carries one. Reads need `scheduling.view`, writes
`scheduling.manage`. Every response is `Cache-Control: no-store`.

| Route | Methods |
| --- | --- |
| `/api/scheduling/{offerings\|resources}/{id}/availability` | GET: `{ owner, rules, exceptions }` |
| `/api/scheduling/{offerings\|resources}/{id}/availability-rules` | POST: add a weekly rule |
| `/api/scheduling/{offerings\|resources}/{id}/availability-exceptions` | POST: add a closure |
| `/api/scheduling/availability-rules/{ruleId}` | PATCH, DELETE (both need `expectedUpdatedAt`) |
| `/api/scheduling/availability-exceptions/{exceptionId}` | PATCH, DELETE (both need `expectedUpdatedAt`) |

Rule body: `dayOfWeek` (0 = Sunday), `startTime`, `endTime` (`HH:MM`, or `24:00` for end of day), optional `validFrom`/`validTo`, `kind`
(`hours` default or `service_period`), `label` (at most 80 characters). Closure body: `fromDate`, `toDate` (inclusive), optional `reason` (at
most 200). Unknown fields are refused. Overnight hours are two rules (see `splitOvernightRule`); one request that crosses midnight is refused with
a hint, so a request can never half-succeed.

Errors: `400 INVALID_INPUT` (with `problems`), `404 NOT_FOUND` (missing or another organisation's row, indistinguishable), `409 STALE_WRITE`,
`409 OVERLAP`, `409 ARCHIVED`, `409 RESOURCE_INACTIVE`, `413`/`415`, `503 TRY_AGAIN` (lock wait timed out, nothing written),
`503 AVAILABILITY_NOT_READY` (034 not applied).

Two layers decide a write. The core validators answer first with plain reasons (`checkRuleWrite` / `checkExceptionWrite`, the same
validators the 2B.3a computation uses). The database triggers are authoritative and re-check under the owner's lock; their refusal is the same `409 OVERLAP`.

Fail-closed details: every repository **write** names `updated_at` itself (in `RETURNING` or `WHERE`), so before 034 the statement fails at
analysis time and writes nothing. (A test caught the first draft, whose INSERT succeeded and only the read-back failed.) A missing, archived,
inactive or foreign owner never yields availability. "No rules" still means "no availability" (decision B): the API stores rules, the 2B.3a
computation decides what they mean.

Audit: one entry per successful mutation, after it commits, on the existing `audit_logs` (`scheduling.availability_rule.created|updated|deleted`,
`scheduling.availability_exception.created|updated|deleted`). The summary holds ids, owner kind, weekday, times, dates and changed field names. Free text
(label, reason) is never copied into it, only `has_reason`. A refused request audits nothing.

Not accepted yet: `kind: 'override'` closures (see risk 1), and nothing writes `scheduling_schedules.timezone` or the organisation timezone.

## 4. Tests

- `packages/scheduling-postgres/tests/availabilityIntegrity.integration.test.ts` (88): version token and stale writes, overlap (touching,
  24:00, validity dates, edits, closures), archived/inactive owners, tenant isolation, permissions at the repository, raw SQL refused
  (`SCOVL`, `SCOWN`, `SCISO`), concurrency (30 concurrent overlapping inserts: one wins; non-overlapping all succeed; edits with one version; races
  against deactivation and archive), 40 seeded rule-set and 20 closure parity runs against the core validators, no reservation/hold/occurrence
  touched, fail-closed before 034 and idempotent rollback/re-apply.
- `scripts/tests/schedulingAvailabilityApi2b3b.integration.test.ts` (39): the real routes and guard on real Postgres: 503 before 034, the access
  matrix, isolation, validation, concurrency over HTTP, archived/inactive, audit completeness, nothing else touched.
- `packages/scheduling/tests/availabilityPersistence.test.ts`: the advisory checks, purely.
- `tests/browser/scheduling/availability.spec.ts`: the permission matrix for every account kind through the production build, cross-organisation
  404, the manager flow, one audit entry per success, reads change nothing.
- Run on PostgreSQL 16 and 17: `bash scripts/tests/verify-scheduling-phase2b3b.sh 16|17`. Mutation check: removing the owner lock from 034 makes the
  concurrency tests fail.

## 5. Prepared, not built

**2B.3c working-hours and closure screens.** Weekly hours editor and closure list at a 44 px target, keyboard first, 390 px first, `adjustments`
notice, the 409 messages above, stale-write "Reload latest" like the other screens. Playwright: manager/view-only/denied, stale write, responsive, axe.
**2B.3d read-only day and week calendar and free-slot API.** `GET` over `computeAvailability` (reads holds, writes nothing), schedule-zone display.
**2B.3e hardening.** Timezone-change flow, accessibility, audit completeness, performance, DST fixtures.

## 6. Decisions still open

1. **Override exceptions.** The table has no column for override hours. Options: closures only until a reviewed `windows` column (recommended now);
   a reviewed migration adding it; or validity-dated rules.
2. **Applying 034 to Production** and when (it is a prerequisite for 2B.3c). A reviewed handoff, owner-run.
3. **Pinning the schedule timezone** on first rule save (`scheduling_schedules.timezone`): not done here; needed before the calendar or any
   timezone-change policy is enforceable. Decide before 2B.3d.
4. **Resource that follows its offering.** Still needs explicit `00:00-24:00` rules; confirm a one-click default in 2B.3c.
5. **Overnight in one action.** The API takes one window per request; the screen will create the two rules in sequence. Decide whether a single atomic
   endpoint is wanted (a transaction needs a SQL function, i.e. another reviewed migration).
6. **Exception overlap across kinds** (closed inside override) is allowed by the core; irrelevant until overrides exist.
7. **`service_period` rules** are stored and overlap-checked like hours; the computation ignores `kind`. Confirm that is the intended meaning.
