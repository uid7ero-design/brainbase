# Scheduling Phase 2B.2a: configuration contracts (implemented)

Status: **implemented on `feat/scheduling-phase2b2a-config-contracts`, draft PR, not merged, not deployed.** Shared packages
only (`@scheduling/core`, `@scheduling/postgres`). No BrainBase file, route, page, SQL migration or entitlement changed, and
neither package imports BrainBase or Next.js. It delivers the repository operations the Phase 2B.2 plan needs for
configuration; the routes (2B.2b) and the dashboard (2B.2c) are separate, unstarted phases.

## 1. Contract changes (all additive)

| Operation | Purpose |
| --- | --- |
| `updateSchedule(tenant, id, expectedUpdatedAt, patch)` | name, terminology, cancellation policy, timezone override, preset (only while empty) |
| `updateOffering(tenant, id, expectedUpdatedAt, patch)` | name, type, colour, duration, capacity, price (amount), start time, recurrence |
| `updateResource(tenant, id, expectedUpdatedAt, patch)` | name, kind (guarded), capacity, minimum party, active (guarded) |
| `unlinkOfferingResource(tenant, offeringId, resourceId)` | removes the link row only; idempotent |
| `listOfferingResources(tenant, offeringId)` | the resources linked to an offering (staff, `scheduling.view`) |
| `archiveOffering(tenant, offeringId)` | one-way archive, the offering counterpart of `archiveSchedule` (not in the brief's list; the plan needs it) |

Existing signatures are unchanged. Reads gain one field: `updatedAt` on `StoredSchedule`, `StoredOffering` and the new
`StoredResource` (`Resource` plus `updatedAt`; `createResource` and `listResources` now return it, a subtype of what they
returned). `NewOfferingInput` still has no `updatedAt`. `setResourceActive` and `linkOfferingResource` keep their
behaviour (see section 5 for the two deliberate differences).

**Results, not exceptions, for expected outcomes** (like `CreateOccurrenceResult`):
`ConfigWriteResult<T> = { ok: true, value } | { ok: false, reason, detail? }` with reasons `not_found`, `stale_write`,
`archived`, `preset_locked`, `resource_in_use`, `allocation_in_use`. `stale_write` is the domain form of STALE_WRITE (2B.2b
maps it to HTTP 409 `STALE_WRITE`). Malformed input and missing permission still throw `SchedulingError`
(`invalid_input`, `permission_denied`), as every existing method does. Pure validation lives in the core
(`configuration.ts`: `validateSchedulePatch`, `validateOfferingPatch(patch, presetKey)`, `validateResourcePatch`,
`validateExpectedUpdatedAt`), so a standalone host gets the same rules.

## 2. Optimistic concurrency

The version token is the row's `updated_at` at **microsecond** precision (`YYYY-MM-DDTHH:MM:SS.ffffffZ`). A millisecond
rounding does not match. The write applies only if `updated_at = expected` in the same statement, so the check and the write
cannot be separated. Over the single-statement executor (Neon HTTP included) this needs no interactive transaction. When a
write changes no row, a second read-only statement only classifies why (missing, archived, stale, rule); it never writes.
Contract: each repository call is its own statement; inside one outer transaction `now()` is frozen, so two edits there would
share a version. Hosts must not wrap these calls in a single transaction.

**Closing the race a plain guard leaves open.** "No offerings exist" is checked inside the update, but under READ COMMITTED a
concurrent `INSERT` of an offering is invisible to it, and the foreign-key lock an insert takes does not conflict with
an update of a non-key column. A test proves this (the CONTROL case). So `createOffering` now writes its schedule row first
(the offering is inserted from that row) and `linkOfferingResource` writes its resource row first. The two statements then
contend for the same row, and one of them observes the other: the loser fails its version check (`stale_write`) or its
archived check. It also closes an older race (an offering created while its schedule is being archived). The visible effect
is that adding an offering changes the schedule's version, and linking a resource changes the resource's.

## 3. Invariants and where each is enforced

| Invariant | Enforced by | Negative test |
| --- | --- | --- |
| Tenant scoping on every operation | `organisation_id = $1` in every statement; foreign rows classify as `not_found` | cross-tenant matrix, both directions, row snapshots byte-identical |
| Stale update changes nothing | version predicate in the write | sequential, 20-way, lost-update |
| Preset immutable once any offering exists (archived ones count) | `NOT EXISTS offering` in the write; the schedule-row-first rule above | locked with live and archived offering; same key is a no-op; races |
| Archiving is one way | no unarchive operation; archived rows reject edits | edit after archive; second archive returns false |
| Archived schedule takes no new offering | `createOffering` inserts from the un-archived schedule row | create after archive; archive-in-flight race |
| Resource deactivation | refused while a live (unreleased, not yet ended) hold exists; reactivation always allowed | live, released, ended, unused |
| Resource kind | only while unlinked and never held (history counts) | linked, held in the past, same-kind no-op, link race |
| Capacity and minimum party | a live reservation's party must still fit | too small, too large, still fits |
| Unlink | refused while a live hold of this resource belongs to this offering (reservation or occurrence) | this offering, other offering, ended, released |
| No destructive deletion of history | unlink deletes the link row only; nothing else is deleted anywhere in this change | reservation, hold and occurrence counts unchanged |
| Resource exclusivity | untouched: the exclusion constraint on holds is not edited | same and overlapping ranges still conflict after edits |
| Existing occurrences never rewritten by an offering edit | edits touch the offering row only | occurrence row byte-identical |
| Currency and schedule of an offering never change | not editable; rejected as input | invalid_input |
| Permissions | `scheduling.manage` for writes, `scheduling.view` for the list | viewer, nobody, public refused |

## 4. Verification

- `packages/scheduling/tests/configuration.test.ts` (30): every validator rule, positive and negative.
- `packages/scheduling-postgres/tests/configEditing.integration.test.ts` (52, real PostgreSQL): the table above, plus
  deterministic races (a second connection holds a transaction open, so the order is fixed, not left to timing) and 40-round
  load races checked by `xmin`. Run by `scripts/tests/verify-scheduling-phase2a.sh [16|17]`, which now includes it beside the
  existing 2A suites.
- Mutation checks: removing the version check, the preset guard, either "write the parent row first", the tenant filter
  (resource, unlink), the kind guard, the capacity guard, the deactivation guard and the unlink guard each fail at least one
  test. The one survivor is the tenant filter in `updateOffering`'s write, which the tenant-scoped pre-read already makes
  unreachable (defence in depth).

## 5. Known limits and risks

- Deactivating a resource races with a reservation being created for it: the hold insert does not touch the resource row, so a
  hold can land as the resource is deactivated. The exclusion constraint (no double booking) is unaffected and an inactive
  resource refuses new holds afterwards; the exposure is a booking on a just-deactivated resource. Closing it needs a
  database trigger, which is a migration (separately approved). The same applies to unlink racing a new booking.
- `setResourceActive` and `linkOfferingResource` stay unguarded by the booking rules (kept for compatibility). The 2B.2b
  routes must use `updateResource` and the guarded unlink; a containment check should enforce that.
- `linkOfferingResource` does not check resource kind against the preset or that the resource is active. That compatibility
  rule belongs with the 2B.2b route and is deliberately not changed here.
- Linking and offering creation now bump the parent's version, so an editor holding an older token sees `stale_write` after
  an unrelated link or offering was added. This is intended, and the client simply re-reads.
- A unique `public_slug` is not editable here (public booking is out of scope).
- No migration is required or included. The Neon driver matrix suite (`neon.integration.test.ts`) needs a Neon endpoint and
  was not run for this change; the new SQL uses only plain statements and CTEs, as the existing repositories do.
