# Scheduling Phase 2B.3e: availability hardening and sign-off

Status: implemented on `feat/scheduling-availability-hardening`, **draft PR, not merged, not deployed**. No migration. No Production write and no Production SQL was run to build it: the Production baseline in section 1 was read with `SELECT` statements only.

Scope: the read-only availability calendar (2B.3d, PR #507, merged `62492066`) and the availability model under it (2B.3a to 2B.3c). Nothing here adds recurring sessions, reservations, holds, payments or public booking.

## 1. Production baseline (read only, 2026-10-29)

| Check | Result |
| --- | --- |
| Migrations | `2b.3.1`, `2b.3.2`, `2b.3.3` all in `scheduling_schema_migrations` (11 versions, `2a.2` through `2b.3.3`) |
| Entitled organisations | one: `ZZ Scheduling Internal Test` (`organisation_modules`, scheduling, enabled) |
| Pilot configuration | 4 schedules, 4 offerings, 5 resources, 3 offering-resource links, 1 settings row: as before |
| Monday availability | 1 rule: offering "ZZ Test Junior Squad (edited)", Monday 09:00-12:00, kind `hours`; 1 pinned zone `Australia/Adelaide` (`first_rule`), both written 2026-10-28 21:43 UTC |
| Closures, reservations, occurrences, holds, series | 0 |
| Scheduling audit rows since the first rule | exactly two: `availability_rule.created` and `availability_zone.pinned` (the first-availability test); every other row is from 2026-10-24 or earlier |
| CI on `main` | `62492066`, `210832d1`, `70d3b3db`: success. The run for the current head `65099425` was still in progress when read |
| Vercel (GitHub deployment status of `65099425`) | `brainbase` and `eve`: success |

Not checked: LD Tennis availability (no route or credential was used; its code is untouched by this branch).

## 2. What changed

| Area | Change |
| --- | --- |
| Reads | The calendar used to read each linked resource's rules, closures and zone separately (`3N + 11` statements for N resources). It now reads them in three batched statements: `listRulesForOwners`, `listExceptionsForOwners`, `listZonesForOwners`. The count is **14 for any number of resources** |
| Bound | An offering with more than `CALENDAR_MAX_RESOURCES` (100) linked resources answers `422 CALENDAR_TOO_LARGE` before the heavy reads, and the screen explains it. The repository refuses a batch of more than `MAX_BATCH_OWNERS` (200) ids |
| Fallback zone | An offering with no pin used to cost two more reads (offering, schedule) to find its fallback zone; the handler already holds the schedule, so it is computed with no read |
| Screen | `CALENDAR_TOO_LARGE` has its own message (no retry that cannot help) |
| Tests | Core hardening tests, a batched-read PostgreSQL suite, a read-cost and EXPLAIN suite, a permission matrix through the real middleware, and a Playwright spec for first paint, loading and error states, keyboard order, names and themes |

Unchanged on purpose: the response bodies, the error contract (apart from the new 422), the routes, and the shared engine. The engine package still imports nothing from BrainBase.

## 3. Performance

Measured on PostgreSQL 17 (Docker, local loopback, so wall time understates a networked database). Statements are counted at the application's database client for one `GET /offerings/{id}/calendar?from=2027-01-11&to=2027-01-17&step=30` by a viewer. The fixture: every third resource set in Perth, every fifth with no hours, some with closures and holds.

| Linked resources | Statements before | Statements after | Median ms before | Median ms after |
| --- | --- | --- | --- | --- |
| 1 | 14 | 14 | 16.8 | 19.3 |
| 5 | 26 | 14 | 26.6 | 18.8 |
| 20 | 71 | 14 | 76.8 | 67.9 |
| 50 | 161 | 14 | 141.8 | 158.3 |

"Before" is `origin/main` (`65099425`), measured with the same test file in a clean worktree. The 14 statements are the guard's session, module and settings lookups (4), the offering, its schedule and its linked resources (3), the three batched availability reads issued once for the offering and once for its resources (6), and one hold read (1). At N = 1 the old and new counts coincide (14); the old code added three reads for every further resource. Wall time at 50 resources is dominated by the pure view model (about 58 ms of CPU for 50 resources, linear) and JSON, not by the database; the saving is in round trips, which on a networked database (the Neon HTTP driver makes one request per statement) is the cost that grows. Local milliseconds are therefore reported as measured, not as the benefit.

**Response unchanged.** For each of the four sizes the response body, with generated ids replaced by stable names, hashes to the same digest on `main` and on this branch (`9cf1d62c…`, `7c107d8f…`, `37aa3917…`, `6f8b9e98…`). The 30 tests of the 2B.3d API suite also pass unchanged.

**Index usage** (EXPLAIN ANALYZE on 120 other resources in the same organisation with 840 rules, 360 closures and 3,600 holds):

| Read | Plan |
| --- | --- |
| Rules by owner batch | Bitmap Index Scan on `scheduling_availability_rules_resource_idx`, 3 buffers, 0.04 ms |
| Live holds in the range | Bitmap Index Scan on `scheduling_holds_no_overlap` (the exclusion constraint's GiST index), 9 buffers, 0.09 ms |
| Closures, zones | Sequential scan: correct for tables this small (5 and 2 pages). With sequential scans disabled the planner uses `scheduling_availability_exceptions_resource_idx` and `scheduling_availability_zones_pk`, so a usable index exists as the tables grow |

No new index is proposed.

## 4. Correctness evidence

Shared core (`packages/scheduling/tests`), all pure:

| Area | Where |
| --- | --- |
| Offering and resource hours intersection, closures (partial and whole day), live and released holds, missing hours failing closed, inactive and archived owners, Adelaide and Perth zones, 23-hour and 25-hour days, repeated local hour, overnight windows, window-anchored slots | `availabilityCalendar.test.ts` (38, from 2B.3d) |
| Half-open boundaries (a hold ending at a slot start, or starting at a slot end, removes nothing; one minute of overlap removes the neighbours), a closure ending at 11:00 leaves the 11:00 slot, hours ending at 24:00 do not leak into the next day, removing time removes slots but moves none, two windows are each anchored at their own start, a 9-hour overnight window across the repeated hour | `availabilityCalendarHardening.test.ts` |
| Seeded property check, 550 generated calendars over both daylight-saving changes with Adelaide and Perth resources: lanes are well formed and disjoint, free time is inside hours and outside holds, every slot is inside the offering's hours and its resource's free time, no duplicate slot, a hold never adds a slot, a closure never adds open time, calendars are deterministic | `availabilityCalendarHardening.test.ts` |

**Viewing never writes.** The permission suite (section 6) hashes every Scheduling table, the pinned zones, the users, access and audit tables before and after 24 calendar requests by 4 account types and after every refusal: identical. The 2B.3d API suite separately proves an owner with no hours is not pinned by being looked at.

### `service_period`

Finding (from the code, not assumed):

- The shared engine's rule type has no `kind` field. `calendarRules` converts a stored rule to an engine rule and drops `kind`, so a `service_period` window is drawn as hours and **makes start times bookable** exactly like an `hours` window of the same times (pinned by a test).
- The screens never create it (only `hours` is offered); an existing one shows a "Service period" badge on the hours screen and can only be removed. The API still accepts the kind, and the database CHECK allows it. The `restaurant_tables` preset declares `availability: 'service_periods'`, which implies a different meaning (named sittings with a grid) that is not implemented.
- Production has 0 such rules (it has one `hours` rule).

Recommendation (no semantics invented here): **treat an owner that has a `service_period` rule as an explicit "unavailable" state in the calendar, with the reason in words, until the product decision is made; do not hide the rule, and do not let it open bookable time.** Fail closed matches the rule everywhere else in Scheduling (no hours means no availability), it is invisible today (zero rules), and it removes the risk that a `service_period` rule written through the API silently opens bookings in the reservations phase. The alternative, hiding the rule, leaves a stored rule the owner cannot see affecting nothing, which is harder to explain. This is a one-condition change in the view model plus the API refusing `kind: 'service_period'` until defined; it is **not** made in this PR because it changes behaviour and needs the product decision first.

### Closures move the slot grid

A closure that removes the start of a window re-anchors the remaining grid at the new start (a 09:00 grid on 45-minute steps becomes 10:00, 10:45, … once 09:00 to 10:00 is closed). This is the documented window-anchored design (the grid starts at each continuous *effective* window), and it is pinned by a test. It is recorded as a product observation for the reservations phase: a customer-facing grid that shifts when a morning closure is added may be unexpected for steps that are not a divisor of the duration.

## 5. Mobile, accessibility and first paint

Real Chromium, synthetic accounts signed in through the real login form, disposable PostgreSQL, at 390x844 (mobile), 768x1024 (tablet) and 1440x900 (desktop). New spec: `tests/browser/scheduling/calendarHardening.spec.ts` (14 tests x 3 viewports = 42, all pass). With the 2B.3d calendar spec and the rest of the Scheduling harness: **257 pass, 214 skip by design, 0 fail**.

| Check | Result |
| --- | --- |
| **Reported mobile first-paint flash** | **Not reproduced.** A MutationObserver records the layout at every DOM change (before the browser can paint it): on a phone the wide grid was never in the DOM and the agenda was never drawn collapsed; on tablet and desktop the agenda was never drawn open. Tested for a fresh load, and for a client-side navigation from the hours screen with the API answer already available (the harshest case). The reason: the screen shows its loading state until the answer arrives, and the `matchMedia` effect has run by then. No change was made to the switch; the test pins the behaviour |
| Loading state | status message, one h1, no sideways scroll, no axe violations; then the calendar |
| Error states | 500 (named, "Try again" works), 422 hours-cannot-be-drawn (the reason shown), 503 not set up, **422 too many resources (own message, no useless retry)**, a failed move to another day (last good calendar kept, alert says it may be out of date, recovers) |
| Keyboard | Tab order: hours link, Day, Week, Previous, Today, Next, date field, step select, the grid scroller (a labelled, focusable region), the agenda toggle; every stop except the browser's own date-field segments shows an outline or ring |
| Names | every button, link, input, select and summary has an accessible name; every drawn block has a text equivalent; one h1; `lang` set; the grid region is labelled on wide screens and absent on phones |
| Themes | light and dark: week with the 23-hour day, day with the 25-hour day, ordinary day: 0 axe violations (WCAG 2.0/2.1/2.2 A and AA tags), no horizontal page scroll, every control at least 44 px |
| Resource calendar | viewer, 0 axe violations, no overflow |

### Defects found and corrected (each with a regression test)

1. The shared load-error "Try again" button was **88 x 34 px** (under the 44 px target the Scheduling screens use). Fixed in `LoadError` (`parts.tsx`); covered by "a server error is named, can be retried".
2. The calendar's "could not be refreshed" retry button was **75 x 28 px**. Fixed in `CalendarScreen`; covered by "a failed move to another day".
3. The new `CALENDAR_TOO_LARGE` response would have fallen through to the generic error with a retry that cannot help; it has its own message.

Not defects: a native date field has several Tab stops (one per day, month and year segment) and draws its own focus highlight, which the focus probe cannot read.

## 6. Permission and isolation matrix

Run through the **real chain** on disposable PostgreSQL: a session cookie signed by `lib/session`, then `middleware.ts` (the module-access boundary of PR #489: `organisation_user_access` filtered by entitled modules), then the real `requireSession()` (user row, organisation match, ACTIVE), then `schedulingRoute` (capability and role mapping), then the handler. Only the Next cookie store and the database client are replaced.

| Case | Result |
| --- | --- |
| MANAGER, Scheduling `use` | 200, both calendars |
| MANAGER, Scheduling `view` only | 200 (the calendar is read only); the hours **write** API is 403 at the module boundary |
| VIEWER, Scheduling `view` | 200, same body as the manager's |
| VIEWER, Scheduling `use` | 200, same body (the module grant is not the role); hours write API 403 |
| Legacy account with no `organisation_user_access` row | 200 |
| VIEWER with no Scheduling grant | 403 from middleware, before the route |
| ANALYST (even with a grant) | 403 from the route's permission mapping |
| Organisation not entitled to Scheduling (even a manager with a grant) | 403 |
| No cookie / garbage cookie / tampered signature | 401 |
| Cookie claiming another organisation than the user row | 401 |
| Inactive user | 401 |
| Cookie claiming `super_admin` for a viewer row; cookie claiming `manager` for an analyst row | judged by the row (200 / 403): the claim grants nothing |
| Foreign schedule, offering, resource id | 404, body identical to a missing id, no trace of the other organisation |
| `organisationId`, `organisation_id`, `org`, `tenant`, `userId` in the query | 400, never honoured |
| `x-organisation-id`, `x-org-id`, `x-forwarded-organisation`, `x-tenant-id` headers | ignored: the body equals the plain request's |
| Response content | no organisation, customer, reservation, occurrence or hold id, no email, no user id (searched in the bodies); holds are `{startsAt, endsAt, kind}` |
| Cache | Scheduling answers `Cache-Control: no-store`; refusals are `no-store` or `private` |
| Database failure | generic 5xx; body has no driver text, address, credential, table name or SQL; the log line has only a code or error name; the next request succeeds |
| Rejected requests | a content hash of every Scheduling table, zones, users, access rows and the audit log is unchanged after every refusal above and after view-only accounts try to write hours |

## 7. Operational readiness

| Topic | Finding |
| --- | --- |
| Error handling | Guard and handler failures return generic bodies (`Internal error.` / `Scheduling is temporarily unavailable.`) and log `[scheduling] handler failed <code or name>`. **Gap:** the log line has no route, organisation, request id or duration, so a production report cannot be tied to a request or a slow calendar. Recommend adding route and duration before real traffic |
| Query timeout | Nothing sets a `statement_timeout` for Scheduling reads; a stuck read is bounded only by the platform function limit. Recommend a per-statement timeout on the Neon connection used by Scheduling before real traffic |
| Bounds | Range at most 14 days; at most 100 resources per offering calendar (new); at most 200 owners per batched read (new); holds are read for the range plus 2 days before and 3 after. Slot generation is linear in resources and days (about 58 ms CPU at 50 resources, one week) |
| Index usage | Section 3; no new index |
| Cache safety | Routes are `force-dynamic`; `no-store` on every Scheduling answer; no module-level data cache in the Scheduling libraries or routes (the only module-level map is a bounded `Intl.DateTimeFormat` cache keyed by validated IANA zone name, in the shared engine); the organisation always comes from the session |
| Database failure | Section 6 |
| Audit | The calendar writes no audit row by design and reads leave no trace (consistent with the other Scheduling reads). Writes (hours, closures, pins) are already audited. If views must be auditable for compliance, that is a decision for the product owner |
| Deployment and rollback | No migration and no schema dependency beyond 2B.3.3. Rollback is a revert of the PR; the batched repository methods are additive on the port. Before 034/036 the calendar still fails closed with `503 AVAILABILITY_NOT_READY` / zones empty (tested) |

### Risks to settle before real booking traffic

1. `service_period` semantics (section 4): fail closed until decided.
2. No statement timeout and no request-level observability (section 7).
3. Occupied time is **resource holds only**: an occurrence with no resource and a reservation with no resource are not drawn. The reservations phase must define what the calendar shows for them.
4. A closure re-anchors the slot grid (section 4).
5. The calendar is advisory. Only the database's exclusion constraint decides a booking; the phase that books must re-check at write time.
6. The manager and viewer experience is not yet verified on the deployed Production site (section 8).

## 8. What is still to do live

No authenticated Production session was available to this work, and none was sought. The deployed-calendar checks listed in the sign-off report as "outstanding" need a person signed in as the platform owner (impersonating the pilot organisation), plus a manager and a viewer account in the pilot organisation, which do not exist in Production. They are read-only (no rule, closure, reservation, occurrence or hold is created).
