# Scheduling Phase 2B.3e: availability hardening and sign-off

Status: implemented on `feat/scheduling-availability-hardening`, **draft PR #510, not merged, not deployed**. No migration. No Production write and no Production SQL was run to build it: the Production baseline in section 1 was read with `SELECT` statements only.

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

### `service_period` fails closed (release-review change)

Finding, reproduced first: the engine's rule type had no `kind`, and `calendarRules` dropped it, so a `service_period` window was drawn as hours and **made start times bookable** exactly like an `hours` window of the same times (the test that pinned this in the first 2B.3e commit has been replaced by the tests below). Production has 0 such rules.

Rule now (shared engine, calendar and API):

| Where | Behaviour |
| --- | --- |
| Engine type | `AvailabilityRule.kind?: 'hours' | 'service_period'`. Absent or `'hours'` is plain hours. **Anything else, including an unknown string, is unsupported** |
| Engine (`hasUnsupportedRuleKind`, `expandOwnerAvailability`, `computeAvailability`) | An owner (offering or resource) that has **any** unsupported rule is **unavailable as a whole**, even if it also has hours rules (no mixed reading). It opens no time, whoever asks. `computeAvailability` reports `unsupported_rule_kind` (offering) or `resource_unsupported_rule_kind:<resource id>` and yields no slot through it; other resources are unaffected |
| Calendar view model | The stored kind is carried through `calendarRules`. The lane state is `unsupported` ("Unavailable"); the reasons say so; the resource calendar gives `resource_unsupported_rule_kind:<id>` |
| Hours API | Creating a `service_period` rule, or changing a rule to it, is `400 INVALID_INPUT` ("not supported yet; use 'hours'. An existing service_period rule can be removed or changed to 'hours'"). Removing one, or changing it to `hours`, still works, so there is always a way out |
| Screens | The calendar says, in words, that the offering/resource "has an hours rule of a kind that is not supported yet (a service period), so it is unavailable until that rule is removed or changed to ordinary hours". The hours screen shows the same notice. No label, rule text, organisation or identifier is shown |

Why whole-owner rather than ignoring just that rule: an owner with a rule nobody can interpret is misconfigured; opening only its `hours` rules would present a partly understood week as bookable. Failing the whole owner matches the rule everywhere else in Scheduling (no usable hours means no availability). What `service_period` should mean (the `restaurant_tables` preset declares `availability: 'service_periods'`, named sittings with a grid) remains a separate product decision; when it is made, support is added in the engine in one place.

Tests: engine and view model (9, including a 300-calendar property check that an owner with such a rule never contributes a slot), the API (4: refusal on create and change, the offering and resource calendars through the real routes, the way out), and the browser (the calendar, the week, the hours screen, axe) on all three viewports.

### Closures move the slot grid: preserved and documented

Bookable start times lie on a grid **anchored at the start of each continuous effective offering window** (the hours after closures). This is the existing behaviour and it is unchanged; it is now written down where the code lives (`generateSlots` in the shared engine) and pinned in every shape:

| Closure | Effect on start times |
| --- | --- |
| At the end of a window | Removes the slots it covers; **no other slot moves** |
| In the middle | Splits the window; the part after the closure starts a **new grid at its own start** |
| At the start | The grid starts where the remaining window starts. A 09:00 grid on 45-minute steps (09:00, 09:45, ...) becomes 10:00, 10:45, ... once 09:00 to 10:00 is closed |
| Any, when the step divides the distance to the new start | The start times do not change (a 60-minute step with 09:00 to 10:00 closed keeps 10:00, 11:00, ...) |
| A resource's closure or hold, or its own hours | Removes slots, **never re-anchors** (only the offering's own effective hours define anchors) |
| Across a daylight-saving change | The step is elapsed time from the anchor, so spacing is kept and wall-clock times follow the clocks |

Consequence to design for in the reservations phase: show the start times the engine returns; never recompute them from the offering's nominal hours, and tell a customer who held a start time when a closure is added after the fact.

## 5. Mobile, accessibility and first paint

Real Chromium, synthetic accounts signed in through the real login form, disposable PostgreSQL, at 390x844 (mobile), 768x1024 (tablet) and 1440x900 (desktop). New spec: `tests/browser/scheduling/calendarHardening.spec.ts` (12 tests x 3 viewports = 42, all pass). With the 2B.3d calendar spec and the rest of the Scheduling harness: **257 pass, 214 skip by design, 0 fail**.

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
| Error handling and observability | Guard and handler failures return generic bodies (`Internal error.` / `Scheduling is temporarily unavailable.`) and log only an error code or name. **Added:** every Scheduling API request now logs one line, `[scheduling] request {route, method, status, ms, outcome}`, where `route` is the template (`/api/scheduling/offerings/:id/calendar`; dynamic segments replaced), `outcome` is `ok`, `denied`, `unavailable`, `error` or `timeout`, and an `error` code appears only for failures. It never contains an organisation, user, role, session, cookie, query string, body, parameter value, error message or SQL (tested against the log text). A denied request, or one that ends before its params were read, logs only the family `/api/scheduling/(not resolved)`: the params are read only after authorisation, so a denied request's ids are never written anywhere. A request answered by the deadline logs once as `timeout`, and its aborted work is not reported as a fault |
| Query timeout | **Implemented for the calendar reads.** The Neon HTTP protocol has no per-session `statement_timeout`, but the driver merges a query's `fetchOptions` into the request it makes, so an `AbortSignal` stops the wait. Each calendar route runs under a deadline (default 8 s, `SCHEDULING_CALENDAR_DEADLINE_MS`, always clamped to 250 ms to 25 s; a bad value falls back to 8 s, never to "no limit"). At the deadline the request's in-flight statements are told to stop, the caller gets `504 SCHEDULING_TIMEOUT` (generic body: no route, query, organisation or SQL), the late result is discarded, and the timeout is logged once. It applies only to routes that write nothing (a write must never be answered "timed out" while it may still commit). Proved on the real Neon driver (fake transport), on the full route with slow statements, and for the next request recovering. **What it does not do:** the statement already running at Neon is not cancelled by the client abort; the reads are indexed and bounded (14 days, 100 resources, 200 owners) so they end on their own. A server-side `statement_timeout` (role setting) would need a separate reviewed proposal and is not part of this PR |
| Bounds | Range at most 14 days; at most 100 resources per offering calendar (new); at most 200 owners per batched read (new); holds are read for the range plus 2 days before and 3 after. Slot generation is linear in resources and days (about 58 ms CPU at 50 resources, one week) |
| Index usage | Section 3; no new index |
| Cache safety | Routes are `force-dynamic`; `no-store` on every Scheduling answer; no module-level data cache in the Scheduling libraries or routes (the only module-level map is a bounded `Intl.DateTimeFormat` cache keyed by validated IANA zone name, in the shared engine); the organisation always comes from the session |
| Database failure | Section 6 |
| Audit | The calendar writes no audit row by design and reads leave no trace (consistent with the other Scheduling reads). Writes (hours, closures, pins) are already audited. If views must be auditable for compliance, that is a decision for the product owner |
| Deployment and rollback | No migration and no schema dependency beyond 2B.3.3. Rollback is a revert of the PR; the batched repository methods are additive on the port. Before 034/036 the calendar still fails closed with `503 AVAILABILITY_NOT_READY` / zones empty (tested) |

### Risks to settle before real booking traffic

1. What `service_period` should mean (section 4): it fails closed until decided.
2. No server-side `statement_timeout` (the client-side deadline and the request log are in; a role-level timeout needs its own reviewed proposal).
3. Occupied time is **resource holds only**: an occurrence with no resource and a reservation with no resource are not drawn. The reservations phase must define what the calendar shows for them.
4. A closure re-anchors the slot grid (section 4): documented and pinned; the reservations phase must show the engine's start times.
5. The calendar is advisory. Only the database's exclusion constraint decides a booking; the phase that books must re-check at write time.
6. The manager and viewer experience is not yet verified on the deployed Production site (section 8).

## 8. What is still to do live

No authenticated Production session was available to this work, and none was sought. The deployed-calendar checks listed in the sign-off report as "outstanding" need a person signed in as the platform owner (impersonating the pilot organisation), plus a manager and a viewer account in the pilot organisation, which do not exist in Production. They are read-only (no rule, closure, reservation, occurrence or hold is created).


## 9. Live acceptance follow-up: time labels, an empty resource, and loading time

Raised during authenticated Production acceptance of the calendar (PR #510 still draft). Everything below was reproduced on the disposable harness first (real login, synthetic accounts, 390x844, 768x1024, 1440x900), with before and after runs of the same spec (`tests/browser/scheduling/calendarUx.spec.ts`, 12 tests x 3 viewports). The availability calculations are untouched: the response digests at 1, 5, 20 and 50 resources are still identical to `main`'s.

### 9.1 Time labels near the top of the day view

| | |
| --- | --- |
| Reproduced | The first label (00:00) started **5.6 px above** the time column and that 5.6 px was **under the sticky header**, on the ordinary day and on the 23-hour and 25-hour days, desktop and tablet. (Below 768 px the agenda is drawn, so there is no positioned label to clip.) |
| Root cause 1 | Every label is centred on its hour line (`top: -0.6em`). The first line is at the very top of the column, so half its label hangs above the column, into the header. |
| Root cause 2 | The scroll box had `overflow-x: auto` only, which makes it a scroll container in **both** axes. It was exactly as tall as the day (`scrollHeight == clientHeight == 919`), so it never scrolled vertically: the sticky headers had nothing to stick to, the page scrolled instead, and the time column and headers scrolled away. |
| Fix | The first label sits just **below** its line, inside the column. The grid is a scroll box of its own (`max-height: min(72vh, 46rem)`, both directions), so the lane headers, the corner cell and the time column stay put, and the keyboard scrolls it (it is a labelled, focusable region). It opens scrolled so the first open hour is on screen, **snapped** so a labelled hour line sits a fixed distance under the header (never an arbitrary offset that would leave a label half hidden) and no label straddles the bottom edge. |
| Contract tested | At the position the page chooses and at the top: no label is cut anywhere; at the end: none across the bottom edge. Scrolled by hand, labels pass under the header like any scrolled content. Tested on an ordinary day, the 23-hour day and the 25-hour day. |
| Keyboard | The grid takes focus with a visible ring; Home, the arrow keys, PageDown and End scroll it; ArrowUp scrolls back from the end. (Chromium animates key scrolling, so the tests poll.) |

### 9.2 An offering whose resource has no hours

Pilot shape: ZZ Test Junior Squad has Monday 09:00 to 12:00; ZZ Test Court 1 has no hours. The calculation was right (no bookable times) but the screen gave a blank dim column and one easily missed sentence. Now, above the calendar, three plain statements (a mark **and** words, never colour alone):

1. **Offering hours are set:** 09:00 to 12:00 (or: no offering hours, archived, a rule not supported yet).
2. One row per linked resource: **has hours** (and which), or **has no hours set, so it is unavailable, including when this offering needs it**, with a **Set hours** link for a manager or **View hours** for everyone else (it goes to that resource's hours screen; nothing is created from the calendar). Inactive and unsupported-rule resources say so.
3. **Bookable:** the number of start times, or **No bookable times** and why (the offering is unavailable; no duration; the offering needs at least one linked resource with hours and the named ones have none; or the open time is held, closed or too short).

In the grid, the empty resource's column is dotted (a closure is red hatching) and carries a sticky **No hours set / Unavailable** card that stays below the lane headers wherever the grid is scrolled. The week view shows the same note for a selected empty lane; the agenda says **no hours set, so not available**; the per-resource sentence that used to repeat in a separate paragraph is no longer repeated. Hours are **never** created or changed by looking.

### 9.3 Slow loading: measured, not guessed

Measured separately: the API, the page, hydration, rendering, and the requests each action makes (browser Resource Timing and a MutationObserver; local loopback unless stated).

| Finding | Evidence |
| --- | --- |
| **Waterfall (the demonstrated bottleneck)** | Opened from another screen (no date in the address), the calendar request started **2 to 5 ms after** a `/status` request ended: the screen asked the API for the organisation's timezone before it could ask for the calendar. That `/status` call repeats the whole authorisation chain (8 statements, 9.4 round trips) |
| Rendering is **not** a bottleneck | The calendar appears 17 to 25 ms after its response arrives before; 27 to 36 ms after (the explainer and the opening scroll are new work). HTML first byte about 100 ms, "Loading the calendar" shown at about 200 ms, unchanged |
| No wasted refetching | Exactly **one** API request per action: day to week, week to day, next, previous, change step. Re-selecting the current view makes **zero**. Nothing to remove |
| Server round trips | With every statement delayed 40 ms (one Neon HTTP request each) through the **real** middleware, session, entitlement, runtime and handler: the offering calendar took **14.1 round trips**, the resource calendar **12.2** |

Changes, each tied to a finding:

1. **No `/status` wait.** The page already runs the access check, so it reads the organisation's timezone beside it (in parallel: no added time) and hands it to the screen; the screen starts the calendar request at once. Without the zone it falls back to asking `/status`, as before. (The lookup moved into `lib/scheduling/organisationTimezone.ts` so the page gate can use it without importing the whole runtime; the containment pins follow it and still allow exactly one reader.)
2. **Handler: two rounds, not four.** The offering and its linked resources are read together; then the schedule, the offering's hours, every resource's hours and the live holds together. The resource calendar is one round. The 100-resource cap is still checked before any availability is read; a missing or another organisation's id is still 404 (the reads are tenant scoped).
3. **Runtime: the zone and the settings row are read together** (one round trip). Failure order is unchanged (an unusable zone before a missing settings row; nothing created or repaired).

| Measured (final run, PG16 and PG17 agree) | Before | After |
| --- | --- | --- |
| Screen's path to a calendar, 40 ms per statement (`/status` then calendar, as the screen did it) | 939 ms, 23.5 round trips | **427 ms, 10.7** (the calendar request alone) |
| Offering calendar request alone | 564 ms, 14.1 | 427 ms, 10.7 |
| Resource calendar request alone | 487 ms, 12.2 | 388 ms, 9.7 |
| Local, no network latency: calendar request starts (desktop, tablet, mobile) | 396, 355, 365 ms | 349, 276, 269 ms |
| Local: calendar on screen (desktop, tablet, mobile) | 570, 490, 510 ms | 529, 423, 392 ms |
| API requests on a cold open | 2 | 1 |
| Statements per calendar request, 1, 5, 20, 50 resources | 14, 14, 14, 14 | 14, 14, 14, 14 (responses identical to main) |

Local milliseconds understate the benefit: the saving is round trips, each a real Neon HTTP request. The remaining round trips are the shared authorisation chain (middleware, session, entitlement), which this PR does not touch.

**Safe performance logging.** The per-request log line now also carries `stmts` (repository statements) and `dbMs` (their total time; they overlap, so it can exceed `ms`), and every Scheduling response carries `Server-Timing: app;dur=..., db;dur=...;desc="N statements, summed"`. Numbers only: no SQL, parameters, rows, identities or tokens (tested). Production request durations can be read from Vercel's logs once deployed. They could not be read for this work: the Vercel connection needs team access that only the account owner can grant, and it was not requested.

Kept: tenant isolation (every statement is organisation scoped; the permission matrix, foreign ids and spoofing tests pass), the 14-day range limit, the 100-resource cap, the 200-owner batch bound, the 8-second deadline and every fail-closed rule.
