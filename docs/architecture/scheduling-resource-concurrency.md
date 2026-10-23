# Scheduling resource concurrency hardening (version 2b.2.1)

Status: **implemented on `fix/scheduling-resource-concurrency`, draft PR, not merged, not applied anywhere.** It adds one
additive migration (`030_resource_concurrency.sql`, rollback `091_resource_concurrency_rollback.sql`) and small changes to
`@scheduling/postgres`. Production has no Scheduling data and this migration has not been run there. Applying it is a
separate owner-run step.

## 1. The races (all reproduced first, with tests that failed before any fix)

Phase 2B.2a guarded every configuration edit with a `NOT EXISTS` over the live holds. Under READ COMMITTED that guard cannot
see a hold that is being written by another, uncommitted, transaction, and the hold insert takes no lock on the resource row.

| # | Race | Before | After |
| --- | --- | --- | --- |
| 1 | Deactivate a resource while a reservation is created for it | both commit: a live hold on an inactive resource | whichever takes the resource lock second sees the first: deactivation refused (`resource_in_use`) or booking refused (`offering_unavailable`) |
| 2 | Unlink a resource while a reservation of that offering is created | link deleted under a live reservation | unlink refused (`allocation_in_use`) |
| 2b | A customer booking admitted on a link that an in-flight unlink then removes | a live customer hold with no link | the booking statement locks the link row (`FOR SHARE`); it waits, then finds the link gone and is refused |
| 3 | Change a resource's kind while it is booked | kind changed under a hold | refused (`resource_in_use`) |
| 3b | A booking admitted on the old kind while the kind changes | hold on a resource the preset does not accept | the hold trigger re-checks the kind under the lock |
| 4 | Link an inactive resource, or one whose kind the preset does not accept | allowed | refused (`invalid_input`) |

The stress tests also found the same bug directly: with the 2B.2a code, racing a deactivation against bookings left a resource
inactive and holding a live hold.

## 2. Design: database-level, shared by every writer

BrainBase and the standalone application both write these tables, so a guard that lives in one repository's SQL is bypassed by
the other. `030_resource_concurrency.sql` adds four triggers and five functions (nothing existing is altered or replaced):

| Trigger | On | Rule |
| --- | --- | --- |
| `scheduling_resources_guard` | BEFORE UPDATE OF active, kind on resources | no deactivation under a live hold (`SCRIU`); no kind change once linked or ever held (`SCRIU`) |
| `scheduling_holds_resource_state` | BEFORE INSERT on holds | no live hold on an inactive resource (`SCRES`), nor on a kind the owning reservation's / occurrence's preset does not accept (`SCRES`) |
| `scheduling_offering_resources_guard` | BEFORE INSERT on links | the resource must be active and of a kind the offering's preset accepts (`SCKND`) |
| `scheduling_offering_resources_release_guard` | BEFORE DELETE on links | no unlink while a live hold of that offering uses the resource (`SCALU`) |

Each function first takes `pg_advisory_xact_lock` on `scheduling_resource:<organisation>:<resource>`, the lock family that
`scheduling_hold_serialise` (010) already takes before a hold is written, and only then reads the state it protects, with a fresh
READ COMMITTED snapshot. The loser of any pair therefore waits and then sees the winner's committed work. Under REPEATABLE READ
or SERIALIZABLE the guards raise `SCISO` instead of deciding on a stale snapshot (same rule as the reservation guard).

"Live" means the same as in 2B.2a: not released and not yet ended (`upper(during) > now()`). Past or released holds are history
and never block.

`scheduling_preset_allows_resource_kind(preset, kind)` is the database copy of `PRESETS[*].resources.kinds`. A parity test
compares it with the TypeScript presets for every preset and kind, so drift fails CI.

### Repository changes (`@scheduling/postgres`)

- `errors.ts`: three new SQLSTATEs. `SCRIU` and `SCALU` map to `lifecycle_violation`; `SCKND` maps to `invalid_input`.
- `updateResource` and `unlinkOfferingResource` turn `SCRIU` / `SCALU` into the same results their own guards give
  (`resource_in_use`, `allocation_in_use`), so a race and a sequential refusal look identical to the caller.
- `setResourceActive` (legacy) now maps errors, so it is refused with `lifecycle_violation` while a live reservation holds the
  resource. This is the one behaviour change to an existing method, and it only removes the unsafe case.
- `reservationRepository`: the customer path reads the offering link with `FOR SHARE`.

## 3. Lock ordering and deadlock freedom

- Every new function takes at most one advisory lock, the per-resource one, and takes it before reading what it guards.
- A BEFORE ROW trigger runs after the row is locked, so a deactivation or kind change holds the resource row first and the
  advisory lock second; a link delete holds the link row first. A hold insert takes the advisory lock first; its foreign-key check
  later takes KEY SHARE on the resource row, which does not conflict with the NO KEY UPDATE of a deactivation. So no wait cycle
  exists between a booking, a deactivation, an unlink, a link and a kind change.
- The capacity lock family (`scheduling_capacity:*`) is never held with a resource lock by one statement (a reservation targets
  an occurrence XOR a resource).
- A transaction that touches several resources must visit them in `resource_id` order (the rule 010 already states). Single
  repository calls touch one resource.
- All functions carry `SET lock_timeout = '5s'`: a stuck waiter fails with `55P03` (retryable `contention_timeout`), never hangs.
- Verified by the 40-round stress tests (deactivate + two staff bookings + two customer bookings + two unlinks on one resource;
  kind change + link + booking), which assert that no statement fails with anything but a domain refusal (a `40P01` would show)
  and that the end state satisfies the invariants.

## 4. Known limits

- **Staff bookings do not require a link.** A staff booking may name any active resource of an accepted kind.
  Only the customer path requires the link, and it is now race-safe. `createAssigned` with no named resource reads the links
  in one statement and then calls `create` in another, so when the actor is staff an unlink that commits between them can leave one assigned booking on a
  just-unlinked resource. The booking is valid (the resource is active and accepted); the link is advisory for staff flows.
- Capacity / minimum-party changes are still checked by the repository statement only (not a trigger): a reservation created at
  the same moment as a capacity reduction can exceed the new capacity. The reservation guard (010) does not check party size
  against the resource, so closing this needs a decision about where that rule lives.
- The hold trigger adds two primary-key lookups per live hold insert (the resource row and the owner and its preset). Its cost was not benchmarked separately; the contention suite (010) runs with it applied.
- This migration validates new writes only. It never re-validates existing rows.

## 5. Applying it (owner-run, after approval; not part of this PR's merge)

1. Preconditions: 010 (version 2a.2) applied. `020_verify.sql` still reports the 2a.2 inventory; `030` adds 5 functions and
   4 triggers on top.
2. Run `030_resource_concurrency.sql` in the Neon SQL editor (one transaction; it fails fast on lock contention; re-running is a
   no-op).
3. Check: the four triggers exist and are enabled; `scheduling_schema_migrations` contains `2b.2.1`.
4. Rollback: `091_resource_concurrency_rollback.sql` (drops only what 030 added; no data touched). `090_rollback.sql` also removes
   these functions.
5. Deploying the code does not need the migration to be applied first: without it the code behaves exactly as 2B.2a (the
   repository guards remain); with it the races are closed. Apply the migration before enabling Scheduling for anyone.
