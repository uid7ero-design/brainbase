# Scheduling Phase 2A: contention, lock timeouts and retry policy

Evidence and policy for the final corrections. Nothing here is applied to Production. All measurements come from
**disposable** databases (Docker `postgres:16` and `postgres:17`, and a disposable copy branch on Neon); they are
reproducible with `scripts/tests/verify-scheduling-phase2a.sh` and `packages/scheduling-postgres/tests/contention.integration.test.ts`.

## 1. What a lock timeout means

Every waiting function carries `SET lock_timeout = '5s'` (a session setting cannot be relied on over the Neon HTTP
driver or PgBouncer). When a booking queues behind a capacity or per-resource lock for more than 5 seconds, Postgres
aborts the statement with SQLSTATE `55P03`.

| Fact | Consequence |
| --- | --- |
| Every scheduling operation is **one statement**, i.e. one implicit transaction | A statement that times out wrote **nothing** (proved: row and hold counts stay 0) |
| The place or resource may well be free; only the queue was too long | The adapter must **not** report "full" or "unavailable" |
| It is the lock wait that failed, not the booking | It is safe to ask again |

`mapPgError` therefore maps a `55P03` caused by our `lock_timeout` to `SchedulingError('contention_timeout')`,
`retryable: true`. It recognises it by the server message ("canceling statement due to lock timeout") or by a
`scheduling_*` function in the error context. A `55P03` from anything else (a `NOWAIT`, another system) stays raw.

Not mapped, on purpose:

| SQLSTATE | Why it stays raw |
| --- | --- |
| `40P01` deadlock | The schema is built so this cannot happen (per-resource advisory lock, disjoint lock families, `scheduling_holds_serialise`). If it ever appears it is a defect; a retry would hide it. A **real** deadlock raised by Postgres is tested to pass through `translating()` untouched |
| `40001` serialization, `57014` statement timeout, connection errors | Cause or outcome unknown (a lost connection may have committed) |

## 2. Retry policy (opt-in, bounded)

`retryOnContention(operation, policy, { sleep, random })` in `@scheduling/core`. It is **not wired into any repository**:
a host chooses to use it. The core has no timers, so the host supplies `sleep` and `random`.

| Rule | Value |
| --- | --- |
| Retries only | `SchedulingError.retryable`, i.e. `contention_timeout`. Never `capacity_exceeded`, `resource_conflict`, `duplicate_reservation`, `lifecycle_violation`, a raw database error or a deadlock |
| Interactive request (a person is waiting) | `INTERACTIVE_RETRY`: **2 attempts in total** (one retry) |
| Background job | `BACKGROUND_RETRY`: **3 attempts** |
| Hard cap | 5 attempts whatever the policy says |
| Backoff | full jitter, exponential: delay in `[0, min(max, base x 2^(attempt-1)))`; interactive base 250 ms, cap 1 s; background base 500 ms, cap 4 s |
| Worst case for an interactive request | about 2 x 5 s of lock wait + under 1 s of backoff, so **about 10 s**. If that is too long for the surface, do not retry: show "busy, try again" |
| Immediate or unlimited loops | not possible: the first retry waits a jittered delay and the count is capped |

### Why a retry cannot double-book

1. A `55P03` aborts the statement before commit, so the failed attempt left no reservation and no hold. Tests assert
   `scheduling_reservations` and `scheduling_resource_holds` are empty after a timeout, on direct and pooled Neon hosts
   and on Docker.
2. After a successful retry exactly one reservation exists (tested), and a further blind repeat with the same
   `idempotencyKey` returns the original reservation as `replayed: true`.
3. **Always send an `idempotencyKey` with a booking that may be retried.** It also covers the one ambiguous case the
   timeout does not (a connection lost after the server committed), which this helper deliberately does not retry.

### What is not safe to retry automatically

- A booking **without** an idempotency key after a connection error.
- Anything that returned a refusal: the answer is the answer.
- `scheduling_cancel_occurrence` and bulk operations are not wrapped; a host that retries them should treat
  `already cancelled` as success.

## 3. Contention and load results

The suite fires every request at once, each on its own pooled connection and implicit transaction (as over the Neon HTTP
driver). Latency is measured by the client around each call and **includes pool connection set-up and client-side
queueing**. The Neon runs go over the internet from the test machine, so their absolute latencies are dominated by network round
trips. `ok/s` is only meaningful for scenarios where every request is meant to succeed.

**These numbers describe one small test database on one run. They are not a production capacity promise.** Production
runs on a shared Neon compute with real traffic; this proof shows the *behaviour* under contention (correct winners,
no deadlock, bounded waits, no cross-tenant effect), not throughput targets.

### 3.1 Outcomes (identical on every target unless noted)

| Scenario | Requests | Outcomes (Docker PG 16) |
| --- | --- | --- |
| one-resource identical slot x50 | 50 | 49 resource_conflict, 1 ok |
| one-resource identical slot x100 | 100 | 1 ok, 99 resource_conflict |
| one-resource 100 adjacent slots (serialised) | 100 | 100 ok |
| one-resource 100 overlapping different ranges | 100 | 97 resource_conflict, 3 ok |
| independent resources x100 | 100 | 100 ok |
| 20 resources x 5 racers | 100 | 80 resource_conflict, 20 ok |
| mixed headcount+exclusive x288 | 288 | 56 capacity_exceeded, 48 ok, 184 resource_conflict |
| waiter behind resource lock held 1.5s | 1 | 1 ok |
| waiter behind capacity lock held 1.5s | 1 | 1 ok |
| 30 queued behind a stuck resource lock | 30 | 30 contention_timeout |
| deadlock hunt: 20 rounds x 36 overlapping | 720 | 636 resource_conflict, 84 ok |
| assignment: 15 rounds x 24 racers x 4 resources | 360 | 60 ok, 300 resource_conflict |
| cancel while 30 racers compete x10 rounds | 309 | 290 resource_conflict, 19 ok |
| 4 tenants x 25 racers, identical ids | 100 | 4 ok, 96 resource_conflict |

### 3.2 Latency per request in ms (p50 / p95 / max) and wall time

| Scenario | Docker PG 16 | Docker PG 17 | Neon direct | Neon pooled |
| --- | --- | --- | --- | --- |
| one-resource identical slot x50 | 224 / 251 / 253 (wall 275) | 233 / 257 / 262 (wall 284) | 869 / 946 / 948 (wall 985) | 1033 / 1068 / 1070 (wall 1095) |
| one-resource identical slot x100 | 385 / 429 / 438 (wall 451) | 440 / 507 / 521 (wall 525) | 1195 / 1676 / 1698 (wall 1718) | 1639 / 1867 / 1886 (wall 1903) |
| one-resource 100 adjacent slots (serialised) | 567 / 707 / 726 (wall 734) | 474 / 601 / 621 (wall 630) | 1503 / 1629 / 1639 (wall 1664) | 1750 / 1825 / 1833 (wall 1856) |
| one-resource 100 overlapping different ranges | 184 / 243 / 249 (wall 259) | 233 / 273 / 280 (wall 289) | 555 / 1253 / 1259 (wall 1279) | 212 / 467 / 492 (wall 510) |
| independent resources x100 | 325 / 386 / 394 (wall 397) | 348 / 389 / 396 (wall 405) | 1189 / 1368 / 1374 (wall 1387) | 455 / 486 / 493 (wall 511) |
| 20 resources x 5 racers | 183 / 241 / 256 (wall 257) | 207 / 275 / 281 (wall 289) | 323 / 566 / 576 (wall 593) | 210 / 473 / 511 (wall 528) |
| mixed headcount+exclusive x288 | 641 / 1085 / 1108 (wall 1145) | 732 / 1047 / 1069 (wall 1106) | 1039 / 1702 / 1764 (wall 1805) | 850 / 1512 / 1572 (wall 1646) |
| waiter behind resource lock held 1.5s | 1520 / 1520 / 1520 (wall 1520) | 1509 / 1509 / 1509 (wall 1509) | 1563 / 1563 / 1563 (wall 1563) | 1542 / 1542 / 1542 (wall 1542) |
| waiter behind capacity lock held 1.5s | 1531 / 1531 / 1531 (wall 1531) | 1519 / 1519 / 1519 (wall 1519) | 1571 / 1571 / 1571 (wall 1571) | 1567 / 1567 / 1567 (wall 1567) |
| 30 queued behind a stuck resource lock | 5050 / 5075 / 5075 (wall 5079) | 5058 / 5073 / 5073 (wall 5078) | 5311 / 5334 / 5336 (wall 5339) | 5282 / 5307 / 5308 (wall 5310) |
| deadlock hunt: 20 rounds x 36 overlapping | 127 / 254 / 308 (wall 3443) | 124 / 160 / 209 (wall 3105) | 381 / 460 / 601 (wall 8935) | 280 / 310 / 375 (wall 6325) |
| assignment: 15 rounds x 24 racers x 4 resources | 373 / 507 / 543 (wall 6306) | 400 / 465 / 482 (wall 6442) | 1000 / 1229 / 1272 (wall 16484) | 975 / 1113 / 1149 (wall 15064) |
| cancel while 30 racers compete x10 rounds | 116 / 146 / 157 (wall 1448) | 120 / 158 / 174 (wall 1505) | 331 / 364 / 373 (wall 4068) | 279 / 342 / 358 (wall 3633) |
| 4 tenants x 25 racers, identical ids | 341 / 429 / 444 (wall 448) | 327 / 419 / 429 (wall 436) | 583 / 939 / 944 (wall 955) | 493 / 747 / 809 (wall 820) |

### 3.3 Successful bookings per second, and peak sessions seen waiting on a lock

| Scenario | Docker PG 16 | Docker PG 17 | Neon direct | Neon pooled |
| --- | --- | --- | --- | --- |
| one-resource 100 adjacent slots (serialised) | 136.2 ok/s, peak 85 waiting | 158.9 ok/s, peak 86 waiting | 60.1 ok/s, peak 55 waiting | 53.9 ok/s, peak 53 waiting |
| independent resources x100 | 252.1 ok/s, peak 0 waiting | 246.6 ok/s, peak 0 waiting | 72.1 ok/s, peak 1 waiting | 195.6 ok/s, peak 0 waiting |
| mixed headcount+exclusive x288 | 41.9 ok/s, peak 57 waiting | 43.4 ok/s, peak 53 waiting | 26.6 ok/s, peak 20 waiting | 29.2 ok/s, peak 25 waiting |


## 4. What the results show

- **Exactly the right winners.** 50 and 100 simultaneous requests for one slot give exactly one winner and
  `resource_conflict` for the rest; 20 resources x 5 racers give 20 winners; 4 organisations using identical ids give
  one winner each.
- **A hot resource serialises.** 100 back-to-back slots on one resource all queue behind its lock. On an idle local
  database they complete well inside the 5 s bound. **On a loaded host the tail of the queue can exceed it**: in one
  run on a heavily loaded Windows machine 8 of 100 queued requests returned `contention_timeout` (nothing written, no
  overlap, no wrong refusal) while the other 92 succeeded. That is the designed, bounded behaviour, and it is the
  practical ceiling for a single resource: queue depth times per-booking time must stay under about 5 s. The test now
  asserts that invariant instead of assuming 100 successes.
- **Independent resources do not contend.** 100 bookings on 100 resources show no lock waiters.
- **Mixed headcount and exclusive reservations** (classes holding a court plus hire bookings on the same courts) end
  with exactly the capacity filled, no overlap and no deadlock.
- **No deadlock in any scenario**, including 20 rounds x 36 overlapping requests across 3 resources and 15 rounds x 24
  assignment racers over 4 resources. (Without `scheduling_holds_serialise` the earlier regression test fails 3 of 3.)
- **Cancellation while competing**: ten rounds of 30 racers while the holder is cancelled never produce two live holds,
  and no cancelled reservation keeps a live hold.
- **Lock timeout under load**: 30 requests queued behind a stuck lock all fail between about 5.0 and 5.4 s as
  `contention_timeout`, write nothing, and all succeed once the lock is free.
- **Advisory-lock wait**: a request behind a lock held 1.5 s completes in about 1.5 s (both lock families), on Docker and on
  both Neon hosts.

## 5. Limits of this proof

- Single small compute, one run per environment, synthetic data, no sustained load, no mixed read traffic.
- The 100-racer scenarios open up to 60 to 110 connections at once; real traffic through the Neon HTTP driver or the
  pooler behaves differently from a client-side pool.
- Latencies from the Neon runs include the network from the test machine.
- The per-resource lock is the design's serialisation point. A venue with one very hot resource and slow commits will
  see `contention_timeout`; the remedy is retry with backoff (section 2) or a shorter queue, not a longer timeout.
- Not tested: PgBouncer under connection exhaustion, autoscaling cold starts, failover during a booking.
- The load suite is **not part of CI** (it needs a real database).

## 6. Test-host note (Windows)

On the Windows development machine the vitest worker occasionally died silently partway through the load suite
(about 3 runs in 6 once thousands of sockets were in `TIME_WAIT`). No JavaScript exit, uncaught-error or unhandled-rejection
event fired, no Windows crash event was logged, a bare `pg` socket stress test was clean, and the same suites passed
fully on Neon. The cause was not isolated. The proof script retries a suite only when the worker process dies (and prints
a note); a suite that runs and fails an assertion is never retried. This affects the local proof harness only.
