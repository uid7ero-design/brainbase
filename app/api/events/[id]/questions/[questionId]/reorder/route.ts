import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';

type Ctx = { params: Promise<{ id: string; questionId: string }> };

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] ?? null;
}

// PATCH — atomic reorder (Phase 4B pre-commit remediation §2, then the
// final concurrency fix below). manager+. Body: { direction: 'up' | 'down' }.
//
// ── Why "one UPDATE with an embedded neighbor lookup" was NOT safe ───
//
// An earlier version of this route computed the neighbor via a plain
// (non-locking) read, then issued a separate swap UPDATE — two
// distinguishable round trips, exactly the "read neighbor -> separate
// non-transactional UPDATE" shape this fix removes. The natural next
// attempt — fold the neighbor lookup (via LAG/LEAD window functions)
// and the swap into ONE statement, with no explicit lock at all — is
// ALSO unsafe, for the exact same reason the R1 capacity remediation
// documents extensively elsewhere in this module (see the free-
// registration route's own comment): under READ COMMITTED, a single
// statement takes ONE snapshot at statement start. If two concurrent
// reorder statements both start before either commits, both compute
// their "who is my neighbor" answer from the SAME pre-swap snapshot.
// When the second statement's UPDATE later blocks on a row the first
// statement is writing, PostgreSQL's EvalPlanQual mechanism re-fetches
// ONLY that specific locked row for the WHERE-clause check — it does
// NOT re-run the window-function CTEs that computed the neighbor's
// identity and sort_order from scratch. The second statement would
// still apply the STALE neighbor value it originally computed, even
// though the row layout changed underneath it while it waited.
//
// ── The fix: lock the whole sibling group FIRST, in its own statement,
// THEN compute-and-swap in a second statement — both inside the SAME
// sql.transaction([...]) call ────────────────────────────────────────
//
// Per PostgreSQL's per-STATEMENT (not per-transaction) snapshot rule,
// each element of a sql.transaction([...]) array is a genuinely
// separate statement that gets its OWN fresh snapshot when it begins.
// Statement 1 takes a FOR UPDATE lock on every question row in this
// (event, organisation, scope) group. If another reorder is already in
// flight against any of those same rows, statement 1 blocks until that
// other transaction commits or rolls back — exactly the same "lock
// first, compute after" technique the free-registration and paid-
// checkout routes already use for capacity, applied here to sort_order.
// Statement 2 (the window-function neighbor computation + the swap
// UPDATE) is a NEW statement submitted only after statement 1 returns,
// so it necessarily observes the fully up-to-date, post-any-prior-
// commit state of every locked row — never a stale pre-swap view. It
// needs no FOR UPDATE of its own: everything it reads is already
// exclusively locked by statement 1 for the remainder of this
// transaction.
//
// Both statements re-state the (organisation_id, event_id) scope
// independently — a cross-tenant/cross-event mutation is structurally
// impossible even if one of the two checks were somehow bypassed. The
// scope group itself is resolved via a self-contained subquery against
// the target row (never a value read in an earlier, separate
// statement), so the LOCK statement can never lock the wrong (stale-
// scope) set of rows.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, questionId } = await params;
  const organisationId = session.organisationId;

  const event = await loadOwnedEvent(eventId, organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: { direction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  if (body.direction !== 'up' && body.direction !== 'down') {
    return NextResponse.json({ error: "direction must be 'up' or 'down'." }, { status: 400 });
  }
  const direction = body.direction;

  // Plain existence check — purely to distinguish a clean 404 ("this
  // question doesn't exist under this event/org") from a 400 ("it
  // exists, but has no neighbor in that direction") in the common case.
  // Not itself a security boundary and not part of the atomic swap
  // logic: the transaction below independently re-verifies tenant/
  // event scope on every row it touches regardless of what this read
  // saw, so a race between this check and the transaction can only
  // ever produce an overly-generic 400 in the (vanishingly rare, admin-
  // only-action) case where the question is deleted in between —
  // never a cross-tenant mutation.
  const existsRows = await sql`
    SELECT id FROM event_registration_questions
    WHERE id = ${questionId} AND event_id = ${eventId} AND organisation_id = ${organisationId}
    LIMIT 1
  `;
  if (!existsRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let updated: { id: string; sort_order: number }[];
  try {
    const results = await sql.transaction([
      // Statement 1 — lock every sibling row in this question's own
      // (event, organisation, scope) group. The scope is resolved via
      // a subquery against the target row, evaluated as part of THIS
      // statement's own fresh snapshot — never passed in from an
      // earlier, separate read.
      sql`
        SELECT id FROM event_registration_questions
        WHERE event_id = ${eventId} AND organisation_id = ${organisationId}
          AND scope = (
            SELECT scope FROM event_registration_questions
            WHERE id = ${questionId} AND event_id = ${eventId} AND organisation_id = ${organisationId}
          )
        FOR UPDATE
      `,
      // Statement 2 — neighbor computation (via LAG/LEAD window
      // functions over the same locked sibling set) and the swap
      // UPDATE, together in one statement. If there is no neighbor in
      // the requested direction (already at the top/bottom) OR the
      // target no longer exists, `swap.neighbor_id` is NULL and the
      // UPDATE's WHERE clause matches zero rows — a clean, distinguishable
      // no-op rather than an error.
      sql`
        WITH target AS (
          SELECT id, scope, sort_order, created_at
          FROM event_registration_questions
          WHERE id = ${questionId} AND event_id = ${eventId} AND organisation_id = ${organisationId}
        ),
        ordered AS (
          SELECT
            q.id, q.sort_order,
            LAG(q.id)  OVER (ORDER BY q.sort_order, q.created_at) AS prev_id,
            LAG(q.sort_order)  OVER (ORDER BY q.sort_order, q.created_at) AS prev_sort_order,
            LEAD(q.id) OVER (ORDER BY q.sort_order, q.created_at) AS next_id,
            LEAD(q.sort_order) OVER (ORDER BY q.sort_order, q.created_at) AS next_sort_order
          FROM event_registration_questions q, target t
          WHERE q.event_id = ${eventId} AND q.organisation_id = ${organisationId} AND q.scope = t.scope
        ),
        swap AS (
          SELECT
            t.id AS target_id, t.sort_order AS target_sort_order,
            CASE WHEN ${direction} = 'up' THEN o.prev_id ELSE o.next_id END AS neighbor_id,
            CASE WHEN ${direction} = 'up' THEN o.prev_sort_order ELSE o.next_sort_order END AS neighbor_sort_order
          FROM target t
          JOIN ordered o ON o.id = t.id
        )
        UPDATE event_registration_questions AS q
        SET sort_order = CASE WHEN q.id = swap.target_id THEN swap.neighbor_sort_order ELSE swap.target_sort_order END
        FROM swap
        WHERE swap.neighbor_id IS NOT NULL
          AND q.id IN (swap.target_id, swap.neighbor_id)
          AND q.organisation_id = ${organisationId}
          AND q.event_id = ${eventId}
        RETURNING q.id, q.sort_order
      `,
    ]);
    updated = results[results.length - 1] as { id: string; sort_order: number }[];
  } catch (err) {
    console.error('[reorder question] transaction failed', err);
    return NextResponse.json({ error: 'Reorder failed. Please try again.' }, { status: 500 });
  }

  if (updated.length === 0) {
    return NextResponse.json({ error: `No question to move ${direction} — already at the ${direction === 'up' ? 'top' : 'bottom'}.` }, { status: 400 });
  }
  if (updated.length !== 2) {
    // Structurally unreachable (the UPDATE either matches the target +
    // its one neighbor, or matches nothing) — defensive only.
    return NextResponse.json({ error: 'Reorder failed.' }, { status: 500 });
  }

  return NextResponse.json({ questions: updated });
}
