# Scheduling: removing an overnight window atomically

Status: **implemented on a draft PR, not merged. No migration, no new database function.** It needs only 034 (already required by every
availability route). Until 034 is applied the route answers `503 AVAILABILITY_NOT_READY` and deletes nothing.

An overnight window ("Friday 10 pm to 2 am") is stored as two rules: Friday `22:00-24:00` and Saturday `00:00-02:00`. Creating one was made
atomic in 2B.3c (one multi-row `INSERT`). Removing one was two requests, so a failure between them left a smaller window (never more
availability, but a half). This change removes both halves in **one statement**.

## The operation

`POST /api/scheduling/availability-rules/remove-overnight` (permission `scheduling.manage`, the same guard as every availability write)

```json
{ "rules": [ { "id": "<evening rule id>", "expectedUpdatedAt": "<its version token>" },
             { "id": "<morning rule id>", "expectedUpdatedAt": "<its version token>" } ] }
```

| Outcome | Status | Body `code` | What was deleted |
| --- | --- | --- | --- |
| both halves removed | 200 | `{ deleted: true, ids: [..] }` | both |
| malformed request (not exactly two, same id twice, bad token, unknown field) | 400 | `INVALID_INPUT` | nothing |
| a half is missing, or belongs to another organisation (indistinguishable on purpose) | 404 | `NOT_FOUND` | nothing (the other half stays) |
| either half changed since it was loaded | 409 | `STALE_WRITE` | nothing |
| both exist and are current but are not the two halves of one window of one owner | 409 | `NOT_OVERNIGHT_WINDOW` | nothing |
| viewer, analyst, unentitled, signed out | 403 / 401 | | nothing, no audit |
| migration 034 not applied | 503 | `AVAILABILITY_NOT_READY` | nothing, no audit |

Deleting stays allowed on an archived offering and an inactive resource (availability can always be removed), as for a single rule.

## The statement

```sql
WITH want(id, tok) AS (VALUES ($2::text, $3::timestamptz), ($4::text, $5::timestamptz)),
     cur AS (                                  -- the rules that exist in THIS organisation and still carry the caller's token, locked
       SELECT r.id, ... FROM scheduling_availability_rules r JOIN want w ON w.id = r.id
        WHERE r.organisation_id = $1 AND r.updated_at = w.tok
        ORDER BY r.id FOR UPDATE OF r),
     chk AS (                                  -- true only when BOTH are in cur and they are the two halves of ONE window of ONE owner
       SELECT (SELECT count(*) FROM cur) = 2 AND EXISTS (
         SELECT 1 FROM cur e JOIN cur m ON m.id <> e.id
          WHERE e.end_time = '24:00' AND e.start_time <> '00:00' AND m.start_time = '00:00' AND m.end_time <> '24:00'
            AND m.day_of_week = (e.day_of_week + 1) % 7 AND m.kind = e.kind
            AND m.resource_id IS NOT DISTINCT FROM e.resource_id AND m.offering_id IS NOT DISTINCT FROM e.offering_id
            AND m.valid_from IS NOT DISTINCT FROM (e.valid_from + 1) AND m.valid_to IS NOT DISTINCT FROM (e.valid_to + 1)) AS ok)
DELETE FROM scheduling_availability_rules r USING cur
 WHERE r.id = cur.id AND r.organisation_id = $1 AND (SELECT ok FROM chk)
RETURNING <the rule columns>
```

- **All or none.** The `DELETE` runs only if `chk` is true, and `chk` needs both rows. One statement is atomic.
- **Version tokens for both.** Each half is matched on its own `updated_at` (microsecond precision). Under READ COMMITTED a row that was edited or
  deleted by another transaction while this one waited for its lock is re-checked against its new version and drops out of `cur`, so a
  concurrent edit makes the whole removal stale rather than deleting a row the caller never saw.
- **Organisation and owner isolation.** Every row is matched on `organisation_id`; both halves must belong to the **same owner** (same
  `resource_id`, same `offering_id`) and the same kind. A half of one window and a half of another cannot be combined; neither can two rules of
  one organisation that merely touch midnight.
- **No unrelated rule.** Only the two named ids can be deleted, and only when they form a window. `isOvernightWindowPair` in `@scheduling/core`
  states the same rule in TypeScript; a PostgreSQL test checks the SQL against it on 15 shapes, and a containment test checks the screens'
  `findOvernightPairs` agrees (what the Remove button groups is exactly what the server accepts).
- **Existing locks.** The 034 guards fire on inserts and updates, not deletes, so a removal takes **no owner advisory lock** and cannot wait on, or
  be waited on by, a writer holding one (tested). It takes row locks only, in `id` order, so two removals (or a removal and an edit) queue
  and never deadlock. The `ORDER BY` is defence-in-depth: with it removed the opposed-order test still passed over 150 rounds, because the
  planner scans in a stable order; it keeps the guarantee independent of the plan.
- **Fail closed.** The statement names `updated_at`, so without 034 it fails with `42703` before deleting anything (mapped to 503).
- **Audit reflects what committed.** The audit entries are written after the statement, one `scheduling.availability_rule.deleted` per deleted
  rule, from the rows the `DELETE ... RETURNING` actually returned (not a pre-read), each with `batch_size: 2` and `window: 'overnight'`. A
  refused removal writes nothing.

## The screen

"Remove overnight hours" now sends this one request (it used to send two `DELETE`s). A stale half, a vanished half or a changed window shows the
existing messages ("Someone else changed this...", "no longer exists", "Reload latest") and removes nothing.

## Proof

PostgreSQL 16.14 and 17.11 (`bash scripts/tests/verify-scheduling-phase2b3c.sh 16|17`, step 3b and the API suite):

- repository (25 tests): both halves; either order; week wrap; bystanders untouched; archived/inactive owners; validity-shifted window; a stale half
  (either) / both stale / a vanished half / an unknown id / a one-microsecond token difference each delete nothing; unrelated rules refused;
  15 shapes agree with `isOvernightWindowPair`; cross-organisation and viewer; **12 simultaneous removals: exactly one wins**; opposed orders
  never deadlock; removal racing an edit, a single-rule delete and a create; does not wait for the owner lock; seven windows at once; fail
  closed and recovery.
- API (11 tests + 11 validation cases): 200 with two audit entries from the deleted rows; stale / gone / not-a-window; another organisation 404,
  viewer 403, signed out 401, all with unchanged data and audit; archived and inactive owners; 8 simultaneous requests (one 200, rest 404, two audit
  entries); racing an edit; 503 before 034.
- Mutation check (each mutation made the suite fail, then was reverted): removing the pair check (9 failures), removing the row locks (2: the races),
  removing the token comparison (4). Removing only the `ORDER BY` is **not** caught (see above).
- Browser (Playwright, real production build): one request and two audit entries; a stale removal removes neither half, then succeeds after
  Reload latest; a half removed elsewhere is 404 with the other half left; every non-manager account kind and another organisation is refused with
  data unchanged, and a viewer sees no Remove button; a network failure leaves both halves and can be retried.

## Not changed

No migration; no change to 034/035; single-rule delete and edit behave as before; editing one half of an overnight window is still refused
("remove it and add it again"); no reservation, occurrence or payment route.
