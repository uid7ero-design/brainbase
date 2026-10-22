# LD Tennis public booking: overbooking race and a minimal fix

Status: **documented only. Nothing here is implemented, and it is a separate
follow-up from Scheduling Phase 1.** Applies to the live LD Tennis stack.

## 1. The defect

`POST /api/tennis/book` (`app/api/tennis/book/route.ts`, public, unauthenticated,
organisation fixed by `LD_TENNIS_ORG_ID`) runs these statements in order, each a
separate HTTP query on the Neon serverless driver, with no lock and no
transaction:

1. read the instance (`status = 'scheduled'`, organisation scoped)
2. `SELECT COUNT(*) FROM bookings WHERE session_instance_id = … AND status != 'cancelled'`
3. refuse if `count >= max_capacity`
4. duplicate check by lower-cased email
5. `INSERT INTO client_pipeline …`, then `INSERT INTO bookings …`

Two requests for the last place both pass step 3 before either reaches step 5,
and both insert. The same read-then-insert shape exists in the staff enrolment
paths (`dashboard/enrolments`, `dashboard/sessions/[id]/instances/[instanceId]`
POST) and in recurring propagation (`enrolLineageIntoInstance`), which has a
unique index for duplicate lineages but not for capacity.
`tests/containment/schedulingPhase1Baseline.test.ts` pins the statement order.

Severity: no data is corrupted, but a class can be over capacity and a customer
confirmed for a place that does not exist. The window is the time between steps
2 and 5 (several round trips), so two people booking the last place within about
a second of each other is enough. Abuse is cheap: the rate limit
(`lib/rateLimit.ts`) is in memory per serverless instance and resets on cold
start, so it does not bound parallel requests.

Whether it has already happened is unknown. This read-only query would show it
(run by the owner in the Neon console; it was not run here):

```sql
SELECT si.id, si.date, si.max_capacity,
       COUNT(b.*) FILTER (WHERE b.status != 'cancelled') AS enrolled
FROM session_instances si
JOIN bookings b ON b.session_instance_id = si.id
GROUP BY si.id, si.date, si.max_capacity
HAVING COUNT(b.*) FILTER (WHERE b.status != 'cancelled') > si.max_capacity
ORDER BY si.date DESC;
```

Note that staff may deliberately over-enrol, so rows are a lead, not proof.

## 2. Approaches that look safe and are not

- **A single `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < capacity`.** Under
  PostgreSQL's default READ COMMITTED isolation each statement sees one snapshot
  taken when it starts, so two concurrent statements both count the same number
  and both insert.
- **`SELECT … FOR UPDATE` on the instance inside the same statement (a CTE).**
  The lock serialises the writers, but the later statement's count still uses
  its original snapshot and does not see the earlier statement's new row. It
  also needs verifying rather than assuming.
- **`sql.transaction([...])` from the Neon HTTP driver.** The statements are
  sent as a fixed batch; the code cannot branch on one result inside it (the
  archive code documents this limitation).

## 3. Recommended minimal fix

Serialise bookings per instance with a row lock inside an interactive
transaction, so the count is read after the lock is held. No schema change.

```
BEGIN
  SELECT id, max_capacity FROM session_instances
    WHERE id = $1 AND organisation_id-scoped via sessions AND status = 'scheduled'
    FOR UPDATE                       -- concurrent bookings for this instance wait here
  SELECT COUNT(*) … non-cancelled bookings for the instance   -- fresh statement, fresh snapshot
  refuse if count >= max_capacity
  duplicate-email check
  INSERT client_pipeline, INSERT bookings
COMMIT
```

Because each statement in a READ COMMITTED transaction takes its own snapshot,
the second request, once it acquires the lock, counts the first request's
committed row.

Implementation options, both already dependencies:

1. `prisma.$transaction(async tx => …)` with `tx.$queryRaw` for the lock, count
   and inserts. Prisma is already used with transactions in
   `app/api/dashboard/sessions/[id]/route.ts`.
2. `Pool`/`Client` from `@neondatabase/serverless` (WebSocket) with
   BEGIN/COMMIT.

To confirm before building: that an interactive transaction works through the
production connection string (pooled endpoints and PgBouncer transaction mode
have caveats), and that connection use stays within plan limits. Both are
checkable on a disposable Neon branch.

### Scope and order

1. Public booking route first (the only unauthenticated path).
2. Then the two staff enrolment routes and recurring propagation, using the same
   lock helper, because a lock only protects paths that take it. Doing only the
   public route leaves staff and public enrolment able to race each other.
3. The pipeline/message inserts stay inside the same transaction so a refused
   booking leaves no orphan pipeline request (today a failure after the pipeline
   insert does leave one).

Not recommended as the minimal fix: a `reserved_count` counter column. It is
correct under concurrency, but it needs a schema change, a backfill, and a
decrement on every path that cancels a booking (archive, pause, remove-future,
single cancel, reconcile), which is a much larger and riskier change to a live
system. It remains the right design for the replacement engine.

Optional later hardening (schema, separate approval): a partial unique index on
`(session_instance_id, lower(client_email)) WHERE status != 'cancelled'` to make
the duplicate rule a database guarantee.

## 4. Verification plan

- A real-Postgres concurrency test in the existing Docker proof harness
  (`tests/postgres-proof`, run sequentially): capacity 2, 20 parallel booking
  requests, assert exactly 2 succeed and 18 receive the "full" 409. The same
  test must first fail against current code to prove it reproduces the race.
- Keep the existing mocked route tests; update the statement-order pin in
  `schedulingPhase1Baseline.test.ts` deliberately as part of that change.
- Preview check: parallel `curl` bursts against a disposable instance with
  capacity 1, then clean up the synthetic rows.

## 5. Rollout and rollback

Code only; no migration, no data change. Roll back by reverting the commit.
Behaviour for a single, uncontended booking is identical (same responses, same
rows); only contended requests now wait briefly and one of them receives 409.
Needs its own PR, review and owner approval, and must not be bundled with the
scheduling work.
