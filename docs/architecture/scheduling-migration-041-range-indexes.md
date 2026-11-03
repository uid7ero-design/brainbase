# Scheduling migration 041: GiST range indexes for the booking range reads

Status: NOT APPLIED ANYWHERE. Staged for review. Applied only by the owner, only after separate approval, and never as part of merging code.

Files: `packages/scheduling/sql/041_range_indexes.sql` (registry version `2c.4.1`), rollback `packages/scheduling/sql/099_range_indexes_rollback.sql`,
read change in `packages/scheduling-postgres/src/bookingReadRepository.ts`, proof in `packages/scheduling-postgres/tests/rangeIndexes.integration.test.ts`.

## What it does

Two new indexes and one registry row. Nothing existing changes.

- `scheduling_reservations_range_gist` on `scheduling_reservations USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'))`
- `scheduling_occurrences_range_gist` on `scheduling_occurrences USING gist (organisation_id, tstzrange(starts_at, ends_at, '[)'))`

The booking read repository (reservations, both reads; occurrences) now filters with
`tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange($from, $to, '[)')` instead of `x.starts_at < $to AND x.ends_at > $from`. The holds query is unchanged
(it already uses the gist exclusion constraint `scheduling_holds_no_overlap`; `btree_gist` is already installed).

The code is correct whether or not the migration is applied: without the indexes the new predicate is evaluated as a filter and returns the same rows. The indexes only make it fast.

## Why the original btree proposal was rejected

The 2C.2 plan proposed btree indexes on `(organisation_id, ends_at)`. Measured, they do not help: the query orders by `(starts_at, id)` with `LIMIT 201`, and the planner keeps the
`starts_at`-ordered scan (which stops early on the limit) and filters rows away, rather than using the `ends_at` index. A range overlap is not expressible as a single btree
range, because it constrains two columns in opposite directions.

## Measurements (disposable Neon branch, SYNTHETIC data, not Production)

One organisation with 100k reservations and 50k occurrences, a one-week window near now with history behind it, `ORDER BY starts_at, id LIMIT 201`:

| Query | Before | With btree (organisation_id, ends_at) | With gist range index |
| --- | --- | --- | --- |
| Reservations | 89-178 ms, about 110k-267k buffers, about 82k rows filtered | no change (planner keeps the starts_at scan) | 1.43 ms, 559 buffers |
| Occurrences | 8.6 ms (seq scan) | 10.7 ms | 1.66 ms |

Planner caveat (disposable local PostgreSQL, synthetic data): with `LIMIT 201` the planner picks between the starts_at-ordered scan and the gist index from its row estimate. At about
140 reservations per day, a three-day window uses the gist index (under 1 ms) while a one-week window (about 1000 matches) still prefers the ordered scan (about 15 ms, about 1.7k buffers),
because it assumes matches are spread evenly through the ordered index. The index is correct and used when selective; it is not a guarantee for every window and density.

These numbers are from a disposable branch with generated data. They are not Production measurements; Production's scheduling tables are empty today.

## Equivalence

For `from < to` (the read validation, `validateBookingRange`, rejects `to <= from` before any SQL runs, so `tstzrange` can never be built with reversed bounds), and `ends_at > starts_at`
(already a CHECK on both tables), two half-open ranges `[s, e)` and `[from, to)` overlap exactly when `s < to AND from < e`. That is the old predicate. Boundary cases follow:
a row ending exactly at `from`, or starting exactly at `to`, is not in range in either form.

`rangeIndexes.integration.test.ts` checks this on a disposable PostgreSQL: thousands of reservations and occurrences, random and boundary-touching spans (end equals from, start equals to,
zero gap, containing, contained, multi-day), 300 query windows, identical id sets from both predicates with the index absent, present, and with the planner forced onto it.

## Rollout (owner-run)

1. Take a fresh backup branch of Production.
2. Confirm marker `2c.3.1` (037) is present.
3. Run `041_range_indexes.sql` in the Neon SQL editor. It is one transaction with a 5 s lock timeout and a 120 s statement timeout, idempotent, and uses plain `CREATE INDEX`
   (not `CONCURRENTLY`, which cannot run in a transaction). Plain `CREATE INDEX` blocks writes to the two tables while it builds, which is instant because Production's scheduling tables are empty.
   On a large populated database, build the two indexes `CONCURRENTLY` by hand outside a transaction instead.
4. Verify: both indexes exist and are valid; `SELECT version FROM scheduling_schema_migrations WHERE version = '2c.4.1'` returns one row.

## Rollback

Run `099_range_indexes_rollback.sql`: drops both indexes and deletes the `2c.4.1` registry row. Independent and idempotent. The application keeps working (the reads return the same rows, only slower on large tables).

## NOT APPLIED

Nothing in this change has been applied to Production, Preview, or any Neon database. The only database it has run against is a disposable local Docker PostgreSQL started by
`scripts/tests/verify-scheduling-phase2c.sh`.
