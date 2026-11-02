# Scheduling Phase 2C.0: availability at commit

Status: **analysis and recommendation, with failing-first tests. Nothing here writes a reservation, adds a route, or changes a schema.**
Evidence: `packages/scheduling-postgres/tests/availabilityAtCommit.integration.test.ts`, run by `scripts/tests/verify-scheduling-phase2c.sh` on PostgreSQL 16 and 17.
Companion: `scheduling-phase2c-booking-architecture.md` (decisions), `scheduling-phase2c-migration-plan.md` (the migration this recommends is 037).

## 1. The question

The availability engine is a pure TypeScript computation (`computeAvailability`), deliberately shared by the calendar and by anything that books, so an offered time and an accepted time cannot drift apart. A booking is a database write. Between "the engine said yes" and "the row is committed" the world can change:

- a closure or an override is added, or a weekly rule removed;
- an owner's pinned zone is established (its first availability);
- a resource is switched off, or unlinked from the offering;
- the offering is archived.

Phase 2C must say what the guarantee is, and where it comes from. Manager overrides are **not** authorised for the first release, so there is no "let it through anyway" escape: a booking is accepted only for a time the engine offers.

## 2. What the Neon HTTP driver can and cannot do

Established by the existing real-driver suite (`neonDriver.integration.test.ts`), by the driver's source, and re-proved here:

- **One statement per request, each in its own implicit transaction.** There is no `BEGIN ... COMMIT` across requests, and a request that names several statements is refused. Two awaited `sql.query(...)` calls are two transactions, on possibly two server connections, at two snapshots.
- **Concurrent calls are concurrent connections**, so a race between a writer and a booking is real, not a serialised queue.
- **Per-session settings do not stick** (`SET statement_timeout` applies to a connection the next request will not reuse). Function-level `SET lock_timeout` does work, and the existing functions use it.
- The driver's query objects are **lazy thenables**: nothing is sent until `.then`/`await`. A host that wants a request in flight while it does something else must start it explicitly. (Found while writing the real-driver tests; the first version of the race tests did not race.)
- `neon().transaction([...])` exists, but it is a **non-interactive batch**: the statements cannot depend on each other's results, so it cannot run "evaluate in TypeScript, then insert". It is not a way to make option A atomic.
- A client-side deadline (AbortSignal) stops *waiting*. **Corrected 2026-11-02 after a real-Neon run:** on Neon's HTTP endpoint an abort *during execution* also cancelled the statement (nothing was committed, twice out of two), so the earlier statement here that the server statement continues was wrong for that case. What a client can never know is the other case, a response lost *after* the commit (proved: the request commits, the client sees `fetch failed`). A client error therefore never means "absent": the idempotency key is the only safe way to resolve it, and the retry is correct whichever way the server went.

Therefore the only atomic unit available is **one SQL statement** (a CTE, or a call to a database function).

## 3. The options

| | A. Check, then insert | B. Everything in one statement or function | C. Versioned validation + existing constraints |
| --- | --- | --- | --- |
| How | TypeScript evaluates, then a separate request inserts | The rules, closures, zones and slot grid are evaluated in SQL inside the insert | TypeScript evaluates; the insert statement requires that nothing availability-related changed since it read its inputs, and locks the owners while it does |
| Atomic? | **No.** Proved: a closure committed between the check and the insert, and the booking lands inside the closed day | Yes | Yes (the version is compared under the owners' row locks, in the same statement as the insert) |
| Reuses the one engine? | Yes | **No.** It reimplements the engine in SQL: DST resolution (`resolveLocalTime` has no SQL twin), owner-pinned zones, closure re-anchoring of the slot grid, partial-day closures, `service_period` fail-closed. Two implementations will drift, and the calendar would disagree with the commit | Yes |
| Changes to Production | none | a very large function; every engine change becomes a migration | one small migration (a versions table, triggers, backfill) |
| Fit with "do not duplicate the availability engine" | fine | **violates it** | fine |
| Residual race | the whole gap | none | none for the listed changes; a booking made against the previous version is refused and the caller re-reads |

Recommendation: **C.** Option A is not safe enough on its own. Option B contradicts the requirement not to duplicate the engine and would be the largest, riskiest SQL in the product. Option C keeps one engine, keeps the exclusion and capacity constraints as the authority on double booking and overbooking, and adds exactly one new guarantee: *the availability the engine used is the availability in force when the booking commits.*

## 4. The recommended design (option C)

### 4.1 Versions

A table `scheduling_availability_versions (organisation_id, owner_kind, owner_id, version bigint)`, one row per offering and per resource, created with the owner (trigger) and backfilled. Triggers bump the owner's version, in the **same transaction** as the change, on:

- insert, update or delete of a rule or a closure/override (`scheduling_availability_rules`, `scheduling_availability_exceptions`);
- the owner's pinned zone (`scheduling_availability_zones`);
- an offering-resource link added or removed;
- a resource's `active` flag changing.

Why a table and not a column on the owner: `scheduling_offerings` and `scheduling_resources` have BEFORE UPDATE touch triggers (the 2B.2a edit tokens) and 030's resource guards. A column bump would move `updated_at` on every availability change (invalidating every open configuration form) and fire the 030 guards each time. A separate table leaves owners, tokens and guards exactly as they are. (The first prototype used a column; this was changed after finding the touch triggers.)

### 4.2 The host's contract

1. **Read the versions first**, one plain `SELECT` of the offering's and the candidate resources' version rows.
2. Read the inputs (rules, closures, zones, resources, live holds) and run `evaluateSlotBooking` (2C.1). A refusal ends here with its code.
3. Send **one statement**: lock the offering's version row and the offering row, then each resource's version row and resource row (`FOR SHARE`, offering first, resources in `resource_id` order, the existing lock order), requiring each version to equal the one read in step 1, then insert the reservation and its hold, exactly as `CREATE_SQL` does today.
4. Zero rows inserted and the offering and resource still exist: the world changed. Return a **retryable "availability changed"** outcome; the screen re-reads and re-offers. Nothing was written.
5. `23P01` (exclusion), `SCCAP`, `23505` map as they do today. `55P03` stays `contention_timeout`, never "unavailable".

Reading versions *before* the inputs is a rule, not a preference: if the version were read after the inputs, a change landing between the two reads would be invisible. A test pins this ("the version is read BEFORE the inputs").

### 4.3 Why it is atomic

The version bump is an `UPDATE` of the owner's version row. The booking statement takes `FOR SHARE` on that row.

- **Writer first, booking second** (a closure is committing when the booking arrives): the booking blocks on the row, the writer commits, the booking wakes up and PostgreSQL re-evaluates its `WHERE version = $n` against the writer's *new* row version (READ COMMITTED's re-check of a locked row). The version has moved, so the row drops out and nothing is inserted. RACE 1, 3, 4.
- **Booking first, writer second** (a booking is committing when the closure arrives): the writer's bump blocks on the booking's share lock until it commits; the booking stands. This is the approved rule that **existing bookings survive availability changes**; the calendar flags them later. RACE 2.
- No deadlock: bookings take locks offering → resources in id order; bump triggers take them in the same order; a booking takes no advisory lock before the owner rows, and the single exclusion-constraint advisory lock comes after, as today.

Because the comparison happens inside the locking `SELECT`, it works within one statement even though the statement's snapshot was taken before the writer committed. That is the property the Neon driver needs.

### 4.4 Owner-pinned zones, DST and the slot grid

- The engine reads each owner's rules in that owner's pinned zone; the evaluator passes the pins it read. Establishing a pin (an owner's first availability) bumps the version, so a booking that read "no pin yet" cannot be committed against a pinned owner.
- DST: the requested interval is a pair of instants. The evaluator derives the local date from the offering's zone, reads a canonical range (the day before to the day after), and calls the same engine, so spring-forward (23-hour) and fall-back (25-hour) days behave exactly as the calendar shows them. Tests: spring-forward day, Perth resource serving an Adelaide offering.
- Closure re-anchoring: because the grid is anchored at the start of each continuous *effective* window, a closure that removes the start of a window moves the grid. The evaluator uses the same engine, so the starts it accepts are the starts the calendar offers. Test: "after 09:00-10:00 is closed, the grid restarts at 10:00".

### 4.5 Idempotency and cancellation

- **Idempotency**: the existing per-tenant idempotency key is looked up *before* the version check. A replay of a booking that succeeded must return the original even though availability has since changed; a replay with a different body stays a conflict. (Tested at 2C.3, when the write path exists.)
- **Cancellation** needs no availability check and no version: cancelling only releases holds. It must always be possible, whatever the availability says.
- A lost version race is *not* an idempotency failure: nothing was written, so the same key may be retried.

## 5. Evidence

Failing first. The tests were written and run before the prototype existed:

| Run | Result |
| --- | --- |
| `SCHEDULING_SKIP_PROTOTYPE=1` (no version table) | **14 failed, 4 passed** of 18. Part A (the gap) and the unchanged-repository check pass, because they need no new SQL. Every part B test that needs the version table fails (`relation "scheduling_availability_versions" does not exist`) |
| With the prototype, PostgreSQL 17 | **18 passed** |
| With the prototype, PostgreSQL 16 | **18 passed** |

What the 18 tests show:

- **Part A (no new SQL).** (1) A closure committed between check and insert does not stop the insert: option A leaves a booking inside a closed day. (2) The exclusion constraint alone decides between two simultaneous bookings. (3) An inactive resource *is* refused by the database today (010's reservation guard), so that race is already closed.
- **Part B (prototype).** Every kind of change bumps the version, and only those (an unchanged `active` does not). Current versions write the reservation *and* its hold; stale versions write nothing, not even a hold. RACE 1 (closure committing), RACE 2 (booking committing, closure waits, booking stands), RACE 3 (resource switched off), RACE 4 (link removed). The ordering rule. Twelve simultaneous bookings of one slot: one wins, eleven get `23P01`. Another organisation's id writes nothing.
- **Real driver code (`@neondatabase/serverless` over a local protocol shim).** One request per statement; a closure request still committing makes a concurrent booking request wait (measured wait over 300 ms) and write nothing; the reverse order makes the closure wait and the booking stand; `23P01` arrives as `.code` on a `NeonDbError`; the existing `PostgresReservationRepository` works unchanged over the driver.

What the shim is and is not: `neonConfig.fetchFunction` is replaced so the genuine driver code serialises parameters, parses text results and maps errors, with each request served by its own pooled connection. It reproduces one-statement-per-request, no cross-request transaction, and genuine concurrency. It does **not** exercise Neon's proxy, pooling or cold starts. The opt-in live run (`SCHEDULING_NEON_DRIVER_URL`, a disposable branch, never Production) remains the final proof for 2C.3, and is not run in this stage.

## 6. Known limitation: a grid anchored by the query range (RESOLVED on branch fix/scheduling-slot-grid-range-independence)

> The grid now restarts at every local midnight of the offering's zone and hours are read one day past the range, so the grid no longer depends on the range and `anchorAtRangeEdge` is always false. The text below is the original analysis.

The engine anchors the slot grid at the start of each continuous effective window, computed over the requested date range. For a window that is continuous across the whole range (a 24-hour rule, every day), the anchor is the start of the range, so the grid depends on the range the *caller* chose. The evaluator reads a canonical range (day before to day after the requested day), but the calendar reads a user-chosen range, so for a 24-hour window with a step that does not divide the day (or across a 23/25-hour day) the calendar and the commit could disagree about which starts exist.

- `evaluateSlotBooking` reports `anchorAtRangeEdge: true` when this applies (tested).
- Production has no 24-hour rules today.
- Recommended decision for 2C.3: either (a) refuse to commit when `anchorAtRangeEdge` is true, so the case is visible rather than wrong, or (b) change the engine so a continuous window is anchored at a stable boundary (the start of the local day). (b) is an engine change with its own review and is not part of 2C.1 or 2C.2.

## 7. What this means for 2C.3 (facility hire writes)

Blocking, in order:
1. Migration 037 (the versions table and triggers) staged, rehearsed on PostgreSQL 16 and 17 and a disposable Neon branch, applied by the owner.
2. The versioned create statement, with the retry/"availability changed" outcome, behind the kill switch.
3. The grid-anchor decision in section 6.

Not blocking: reschedule, series and appointments, which are separate migration pieces.
