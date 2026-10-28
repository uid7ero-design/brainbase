# Scheduling Phase 2B.3c: availability configuration screens

Status: built on a draft PR, NOT merged. **Migration 035 is staged and NOT applied anywhere**; migration 034 (Phase 2B.3b) is still a separate owner-run
step (`scheduling-migration-034-production-handoff.md`). No reservation, occurrence, hold, recurring session, public booking, payment or LD Tennis change.
Until 034 is applied the screens load, say "Hours aren't set up yet" and offer "Check again"; nothing can be written.

Code: `app/scheduling/_components/` (`AvailabilityScreen`, `WeeklyHours`, `HoursDialog`, `Closures`, `ClosureDialog`), two pages
(`app/scheduling/offerings/[offeringId]/availability`, `app/scheduling/resources/[resourceId]/availability`), `lib/scheduling/dashboard/availability.ts`
(the pure decisions), the API additions in `lib/scheduling/config/availability.ts`, `createRules` in `packages/scheduling-postgres`, partial-day closures in
`packages/scheduling` (core), `packages/scheduling/sql/035_availability_partial_closures.sql` (+ `096_` rollback). Builds on 2B.3a (the core) and 2B.3b (repository
and API).

## 1. The screens

Each offering and each resource has an **Hours** page, reached from a row of the schedule screen (offerings) or the Resources screen (resources), for a manager and
for a viewer alike. It shows, top to bottom: the timezone the hours are read in, any daylight-saving notes, the **weekly hours** (seven days, Monday first,
each with its windows), and the **closures**.

| Part | What it does |
| --- | --- |
| Weekly hours | Add hours on any set of weekdays in one request; edit a window; remove a window; "Available all day" per day or for every day; overnight windows shown once, on the day they start |
| Closures | Whole days or part of each day; a date or a range; reason; upcoming first, past ones behind a checkbox; edit and remove |
| Timezone | The zone, its offset today (so daylight saving is visible), where it comes from, and that hours are not converted for the viewer's device |
| Daylight saving | The next changes (at most three, within a year) that actually touch these hours, in plain words |
| Empty / unavailable | No hours: said plainly, with an explicit "Add hours" and "Available all day, every day". Archived offering / inactive resource: readable and removable, no new hours |
| View-only | A viewer, or a manager limited to Scheduling "view", sees the hours with no controls and a note. The server refuses the same writes |
| Loading / retry / unavailable | A loading status; a network failure with "Try again"; `503 AVAILABILITY_NOT_READY` as an explanation with "Check again"; a failed save keeps the dialog open with the reason and writes nothing |

Controls follow the **effective** permission (entitlement, role, Scheduling access level and the guard's decision), not the role alone. Every screen request goes
through `schedulingApi` to `/api/scheduling`, which authorises each request on its own; hiding a control is UX only.

### Accessibility and layout

Real Chromium at 390, 768 and 1440 px, light and dark: no horizontal overflow; axe (WCAG 2.2 AA, with colour contrast) clean on the page and inside each dialog;
**44 px** targets for every control on these screens (checkboxes and radios count by their whole row); dialogs from the shared `Dialog` (focus moves in, Tab and
Shift+Tab stay inside, Escape closes, focus returns to the opener); validation errors announced; times in plain 12-hour words ("9:00 am to 5:00 pm", "midnight");
a complete keyboard-only path, including adding a closure without a mouse.

## 2. Product rules, and where each lives

| Rule | Implementation |
| --- | --- |
| An offering without hours is unavailable; so is a resource without hours | The screen says so; nothing is implied. `computeAvailability` (2B.3a) already returns no availability. |
| Closures only | The closure dialog offers whole days and part of a day. There is no override control and the API refuses `kind: 'override'`. |
| "Available all day" | One click saves an **explicit** `00:00-24:00` rule (one day, or all seven in one request). A day with no rule stays closed. |
| Overnight hours are atomic | Section 3. |
| Timezone | Section 5. The screens show it; they never change it and never convert saved hours. |
| `service_period` | Not creatable or editable on these screens (only `hours` is offered). An existing one is shown with a "Service period" label and can only be removed. The API still accepts the kind; the distinction from hours is undefined and the computation ignores it. |
| DST and slot grid | Section 4, with the tests that pin it. |

## 3. Overnight hours: how an atomic window is stored without a new database function

**Question.** Can the existing repository create an overnight window (two rules) atomically without a new SQL function?

**Answer: yes.** The repository's standing rule is one SQL statement per operation. A multi-row `INSERT` is one statement, so it is one implicit transaction: either every
tuple is stored or none is. The only thing it needed was proof that 034's guard still works for a tuple whose conflict is with **another tuple of the same statement**.
PostgreSQL's documented behaviour is that a row-level `BEFORE` trigger's queries see the rows earlier tuples of the same command inserted, and 034's guard takes the
owner's advisory lock on the first tuple and holds it to the end of the statement. The PG 16/17 suite proves both: a batch that overlaps itself is refused whole, a
batch that overlaps a stored rule stores nothing (the tuples before the refused one are not left behind), 12 simultaneous identical batches leave exactly one whole batch,
and batches that overlap in opposite tuple order never deadlock.

**What was added** (no migration): `createRules(owner, rules[])` on the repository (one `INSERT ... SELECT ... CROSS JOIN (VALUES ...)`, at most 14 rules), and two optional
request fields on the existing `POST .../availability-rules`:

- `daysOfWeek: [1,2,3,4,5]` instead of `dayOfWeek`: the same window on several weekdays;
- `overnight: true`: the window ends before it starts (`22:00` to `02:00`). It is split by `splitOvernightRule` into `22:00-24:00` on the day and `00:00-02:00` on the next
  weekday (validity dates move a day forward with it) and written in the same statement. Without the flag a window that crosses midnight is still refused.

The screen therefore sends **one** request for an overnight window; there are never two UI writes. The response is `{ rule, rules }` (`rule` is the first, so existing callers
are unaffected), and each created rule has its own audit entry (`batch_size` says how many were created together).

**What is not atomic, deliberately.** *Removing* an overnight window is two `DELETE`s (the screen shows the pair as one and confirms once), and *editing* an overnight window is
refused ("remove it and add it again"). A failure between the two deletes leaves a **smaller** window, never more availability, and the screen says exactly that with a reload.
A single atomic removal would need a batch-delete endpoint (a multi-row `DELETE` guarded by both version tokens): small, no migration, but not needed to satisfy "created atomically".

## 4. Local time: repeated hours, the missing hour and the slot grid

These rules are documented in `availability.ts`, shown to users as daylight-saving notes, and **pinned by tests**
(`packages/scheduling/tests/availabilityLocalTimeRules.test.ts`, Australia/Adelaide, 2027; `tests/containment/schedulingAvailabilityScreensLib.test.ts`;
`tests/browser/scheduling/availability-screens.spec.ts`). Reference: Adelaide clocks go **back** on Sunday 4 April 2027 at 03:00 (+10:30 to +09:30; local 02:00-03:00 happens
twice) and **forward** on Sunday 3 October 2027 at 02:00 (+09:30 to +10:30; local 02:00-03:00 does not exist).

1. **Hours are wall-clock times in one explicit zone.** `09:00` stays `09:00` across a change while its UTC hour moves.
2. **A repeated time is its first pass.** A window that *ends* at 2:30 am on 4 April ends at the first 2:30 am (4.5 real hours for `22:00-02:30` the night before); one that *starts* at
   2:30 am starts at the first 2:30. A window across the repeated hour keeps its true length (`00:00-06:00` is 7 real hours). A window ending at 3:00 am covers both passes of 2:00-3:00.
   **Decision (was open since 2B.3a):** an end inside the repeated hour means the first pass. Each such boundary is reported (`start_ambiguous`, `end_ambiguous`) and the screen says so.
3. **A missing time is the instant the clocks jump.** Hours starting at 2:30 am on 3 October open at 3:00 am; hours ending there end at 3:00 am; hours wholly inside the skipped hour
   open nothing (`dropped_in_gap`, said on the screen). `00:00-24:00` is 23 real hours on that day and 25 on the fall-back day.
4. **The slot grid is anchored to the operating window, not the clock.** Slot starts begin at the start of each *continuous* operating interval and step by real elapsed minutes: `09:15-12:15`
   offers 09:15, 10:15, 11:15 local before and after a change. Touching windows (09:00-12:00 and 12:00-17:00) and an overnight pair are one continuous interval anchored at the first
   window's start, and a slot may straddle the junction. Windows separated by a gap restart the grid at their own start. **Decision (was open since 2B.3a):** this is the grid; fixed
   clock-minute slots would be a small core change if wanted.
5. **On the fall-back day hourly slots step in elapsed time**, so the wall clock shows 02:00 twice, told apart by the offset (`+10:30`, `+09:30`). That is deterministic and intended; a
   customer-facing label should carry the offset or the zone on that day (a 2B.3d display decision).
6. **A partial-day closure is written in wall-clock times**, so closing the repeated hour closes **both** passes of it.
7. The screens compute the notes from the same `expandOwnerAvailability` the availability computation uses, so what they say is what the computation does.

## 5. Timezone: how to pin the effective zone when the first rule is saved

**What was found** (code and a read-only look at a copy of the pilot data):

- The effective zone today is `scheduling_schedules.timezone` (a nullable per-schedule override with a validity `CHECK`) **else** `organisations.timezone` (host-owned) **else** the platform
  fallback `Australia/Adelaide`. In the pilot copy all four schedules have `timezone = NULL` and the organisation is `Australia/Adelaide`, so every schedule follows the organisation.
- Hours are wall-clock times **with no zone of their own**. If `organisations.timezone` changes later, the same saved hours silently mean different instants. 2B.3a's policy says that must
  never happen silently (the core refuses a read in a different zone from the authored one unless confirmed).
- A resource belongs to the organisation, not to a schedule, so a resource's hours have **no schedule to carry a zone**. Today `computeAvailability` takes one zone for the whole
  computation, so a resource's hours would be read in whichever offering's zone asks.
- `scheduling_schedules` has a `touch` trigger, so writing its `timezone` also moves its version token (an open "Edit schedule" dialog goes stale).
- `scheduling_settings` is a module-owned, one-row-per-organisation table the application never creates (setup does). It is the natural module-owned home for an organisation-level pin.

**Design (not built; needs its own migration and review).**

1. *Pin at the organisation level.* Add one nullable column, `scheduling_settings.availability_timezone text CHECK (availability_timezone IS NULL OR scheduling_is_timezone(availability_timezone))`.
2. *Pin atomically with the first save.* In the same single statement as the first rule or closure write for the organisation (a data-modifying CTE), set
   `availability_timezone = <resolved zone> WHERE availability_timezone IS NULL`. If the write is refused, so is the pin. The resolved zone is `schedule.timezone ?? organisations.timezone ?? fallback`
   at that moment, **taken from the database inside the statement**, never from the request.
3. *Effective zone afterwards* = `schedule.timezone` (a deliberate override, only if set) **else** the pinned `availability_timezone` **else** the host zone. A later change of
   `organisations.timezone` therefore does not move any saved hours. The organisation's own timezone is **never written**, and no saved rule is rewritten.
4. *Resources read in the pinned organisation zone* regardless of which offering asks; the core gains an explicit `resourceTimezone` for the intersection (small, pure).
5. *Changing a pinned zone is a reviewed flow*, not an edit: a guard (a trigger, like 034's) refuses to change `availability_timezone` or a schedule's `timezone` while rules exist for it,
   and the host runs `compareAvailabilityAcrossTimezones`, shows the report, and requires explicit confirmation, which is audited. This is 2B.3e.
6. *Existing orgs with rules and no pin* (none in Production: 0 rules) show "Not pinned yet" with a one-click "Pin to <zone>", never an automatic reinterpretation.

**Alternative considered, no schema:** pin only `scheduling_schedules.timezone` on the first *offering* rule (the column exists). It cannot cover resource hours (no schedule), it bumps the schedule's
version token, and the existing schedule form can clear the zone again, so it would need the same guard anyway. Rejected as incomplete.

**What the screens do now.** They show the zone, its offset and its source, say that hours are saved as local times in that zone and are not converted, and say that a later timezone change does not
convert them automatically. They never write a zone. Nothing here changes any existing timezone or reinterprets any saved rule.

## 6. Partial-day closures and migration 035 (staged, NOT applied)

**Why a migration.** A closure stores dates and a kind only; "closed 12:00-13:00 on Good Friday" has nowhere to live. The product decision for 2B.3c includes partial-day closures,
so schema support is required, and it is a **separate, owner-run migration** (the brief's rule), not part of merging the code.

| | |
| --- | --- |
| File | `packages/scheduling/sql/035_availability_partial_closures.sql` (version `2b.3.2`), rollback `096_availability_partial_closures_rollback.sql` |
| SHA-256 (committed LF bytes) | 035 `91f60dcd1b0a72a747a0d1b672c6a42f7388567d150609f6ac12e0196af2f93c`, 096 `22595731ece3ba8e1c78462d6e65c081fdc388f10012dd2c518051c4adcaa210` |
| Needs | 034 applied first (version `2b.3.1`); refuses (`SCVER`) otherwise |
| Adds | `start_time time NULL`, `end_time time NULL` on `scheduling_availability_exceptions`; `CHECK` both-or-neither and `start < end` (`24:00` is a valid end); replaces the exception guard function so overlap compares **time ranges as well as dates** (a whole-day closure covers every time); marker `2b.3.2` |
| Existing rows | unchanged: no window means the whole day, which is what every existing row meant |
| Locks / SQLSTATE | the same as 034 (same advisory lock family, order and `SCOVL`) |
| Idempotent, one transaction | yes (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, constraint added only if missing) |
| Rollback | restores 034's guard body **verbatim** (the PG suite compares the bodies by hash), drops the constraint and columns, removes the marker. It **refuses** while any partial-day closure exists (dropping the columns would turn "closed 12:00-13:00" into "closed all day"); delete those first |
| Do not | re-run 034 after 035: it would put the date-only guard back (stricter, never looser) |

**Fail-closed before 035.** A full-day closure names neither new column, so it is stored identically with or without 035. A partial-day write names them and fails at analysis time
(`undefined_column`), which the repository reports as `PartialClosuresNotReadyError` and the API as `503 PARTIAL_CLOSURES_NOT_READY` with **nothing written and nothing audited**. Reads work
either way (the new columns are read through `to_jsonb`, so a missing column is `null`). `GET availability` reports `capabilities.partialClosures`; the dialog shows "Part of a day" **disabled with
the reason** until it is true.

**Handoff checklist for 035** (owner-run, separate approval, after 034; same shape as the 034 handoff): verify the two hashes; preflight `SELECT version ...` shows `2b.3.1` and not `2b.3.2`, and
`information_schema.columns` has no `start_time` on the exceptions table; backup branch; run the committed file once; verify the two columns, the constraint, the marker, the new guard body hash, and
that the fingerprints of everything else are unchanged; rollback is 096 (refuses while partial closures exist).

## 7. API changes (all behind the existing guard; no new route)

| Change | Detail |
| --- | --- |
| `POST .../availability-rules` | accepts `daysOfWeek` (1 to 7 distinct weekdays) and `overnight`; answers `{ rule, rules }`; one audit entry per rule |
| `POST/PATCH .../availability-exceptions` | accept `startTime` and `endTime` (both, or both `null`/absent = whole day); `PATCH` replaces the pair |
| `GET .../availability` | adds `capabilities: { partialClosures }` |
| Errors | `503 PARTIAL_CLOSURES_NOT_READY` (new); the screens add plain messages for `OVERLAP`, `AVAILABILITY_NOT_READY`, `PARTIAL_CLOSURES_NOT_READY` |
| Audit | closure entries carry `start_time`/`end_time` when partial, never the free-text reason; rule entries carry `batch_size` when created together |

## 8. Tests

- `packages/scheduling/tests/`: partial closures (validation, set overlap, computation, a seeded property test of `subtractLocalWindows`), the local-time rules above, the batch advisory check.
- `packages/scheduling-postgres/tests/availabilityBatchAndClosures.integration.test.ts` (PostgreSQL 16 and 17): atomic batches (all or none, self-overlap, concurrency, opposite order, tenant isolation,
  archived/inactive), migration 035 before and after (fail closed, overlap over time ranges, raw SQL refused, 24:00, seeded parity with the core validators, concurrency), 096 (refuses with partial rows,
  restores 034's guard byte for byte, keeps data, idempotent), and 034-absent behaviour for the new methods.
- `scripts/tests/schedulingAvailabilityApi2b3c.integration.test.ts`: the HTTP API on real Postgres for the same.
- `tests/containment/schedulingAvailabilityScreensLib.test.ts`: the pure library behind the screens (forms, overnight pairing, closures, timezone, Adelaide notices).
- Playwright through the merged harness (`tests/browser/scheduling/availability-screens.spec.ts`, `availability-layout.spec.ts`): permissions for every account kind, cross-tenant, weekly hours,
  "Available all day", overnight (one request, two rules, atomic refusal), closures (whole and partial), stale writes, overlap refusals, midnight boundaries, archived/inactive, loading/retry/503,
  the capability toggle (035 rolled back and re-applied on the disposable database), Adelaide offsets and daylight-saving notes at fixed dates, 390/768/1440 px, light and dark, axe, 44 px, keyboard.
- Run: `bash scripts/tests/verify-scheduling-phase2b3c.sh 16|17` and `node scripts/tests/verify-scheduling-browser-local.mjs`.

**Results on the draft PR head** (disposable databases only): PostgreSQL 16.14 and 17.11 both pass the whole proof (2 fail-closed + 88 repository + 31 batch/035 + 37 availability API + 44 2B.3c API + 26 regression). TypeScript is clean; ESLint has 0 errors (12 existing warnings); the scheduling and containment suites pass (32 files, 1375 tests). The browser harness passes in full across desktop, tablet and mobile (169 passed; the skips are specs that are viewport-specific by design). The 19 failures that the wider repository suite shows (client day overview, dashboard polish, import batch, reporting period, tennis session, budget report) are identical on `main` without this branch.

## 9. Decisions still open before 2B.3d (the read-only calendar and free-slot API)

1. **Apply 034, then 035, to Production and when.** The screens and the calendar both need 034; partial-day closures need 035.
2. **Timezone pinning migration** (section 5): approve the `scheduling_settings.availability_timezone` design (or choose another home), and the `resourceTimezone` core change. Needed before the calendar
   shows resource hours.
3. **Customer-facing time labels on a fall-back day** (the two 02:00s): show the offset, or the zone, or skip the repeated hour in the offered slots.
4. **Atomic removal of an overnight window**: add the small batch-delete endpoint, or keep two deletes with the honest message.
5. **Editing an overnight window in place** (both halves at once): not offered now.
6. **`service_period` meaning**: still undefined; the screens do not create it.
7. **Fixed clock-minute slot grid** instead of window-anchored: a small core change if the business wants it.
8. **Unpinned existing hours** (none in Production today): the one-click "Pin to <zone>" flow.
