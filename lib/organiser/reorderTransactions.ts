import sql from '@/lib/db';

// Phase D.4.7E (Slice E1) — the executable, race-safe ordering primitive
// every same-scope reorder route (group reorder in E2, top-level item
// reorder in E3, subitem reorder in E4) is built on. This file owns the
// ACTUAL SQL that runs against the real database — it is what
// tests/containment/organiserReorderTransaction.integration.test.ts proves
// against a real, disposable Postgres schema, by calling
// resequenceOrganiserItemScope directly. No route or test may reproduce
// this SQL independently; a route wires this function's result to an HTTP
// response, nothing more.
//
// organiser_items.id / organiser_groups.id are native Postgres UUID columns
// (app/api/admin/migrate/route.ts steps 34-35: "id UUID PRIMARY KEY DEFAULT
// gen_random_uuid()") — organisation_id is TEXT (cuid-based, per every
// other organiser_* table and this repo's own CLAUDE.md convention), never
// cast to ::uuid. Confirmed by reading the canonical schema directly, not
// inferred from example id shapes.
//
// Deliberately NOT a generic "any table, any WHERE fragment" helper — this
// repo's own established convention (every existing Organiser/events route)
// is literal, fully-qualified SQL per case, never dynamically composed
// identifiers/fragments. `OrganiserItemReorderScope` is a small, closed,
// discriminated union; each variant has its own literal SQL branch below.
// A future scope this repo needs (e.g. group reorder in E2, which reorders
// organiser_groups rows, a different table) gets its OWN sibling primitive
// using the same transaction discipline — it does not get forced through
// this one by parameterizing the table name.
//
// ─── Concurrency design (mirrors app/api/events/[id]/questions/
// [questionId]/reorder/route.ts's own proven, extensively-documented
// pattern — see that route's header for the full Postgres snapshot/
// EvalPlanQual reasoning this borrows) ───────────────────────────────────
// Statement 1 locks every row in the authoritative scope FOR UPDATE, in its
// own statement, before anything is computed. Statement 2 — submitted only
// after statement 1 returns, but still inside the SAME sql.transaction([...])
// call, so the lock from statement 1 is still held — re-derives the
// authoritative scope FRESH from the (now guaranteed-locked, guaranteed-
// current) rows, validates the caller's requested id list is an EXACT
// permutation of that scope entirely in SQL (never by trusting a JS-side
// read of statement 1's own result), and only then resequences via
// unnest(...) WITH ORDINALITY. A second, concurrent call against the SAME
// scope blocks on statement 1's lock until the first transaction commits or
// rolls back, then computes from the true post-commit state — never a stale
// pre-write snapshot.
//
// No `organiser_activity` write of any kind happens here, ever — a pure
// reorder is position-only, and every existing PATCH route in this codebase
// already excludes position from activity diffing (see e.g.
// app/api/organiser/items/[itemId]/route.ts's own field_diff LATERAL VALUES
// list, and tests/containment/organiserActivitySchema.test.ts's lock
// against ever adding a position/reorder-specific event type). This file
// has no organisation_activity INSERT anywhere in it — verifiable by
// inspection, not just by test.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type OrganiserItemReorderScope =
  | { type: 'top_level_group'; organisationId: string; boardId: string; groupId: string | null }
  | { type: 'subitems'; organisationId: string; boardId: string; parentItemId: string };

// 'malformed' is this module's own pre-SQL guard (a non-UUID-shaped id
// anywhere in the scope or the requested list) — distinct from the four
// SQL-validated reasons (see lib/organiser/reorderValidation.ts's own
// ExactPermutationResult, which this deliberately mirrors for the four
// shared reasons).
export type ResequenceRejectReason = 'malformed' | 'duplicate' | 'missing' | 'extra' | 'count_mismatch';

export type ResequenceResult =
  | { ok: true; order: { id: string; position: number }[] }
  | { ok: false; reason: ResequenceRejectReason };

export type ValidationRow = {
  no_duplicates: boolean;
  no_foreign: boolean;
  no_missing: boolean;
  count_matches: boolean;
  id: string | null;
  position: number | null;
};

// Exported (not just internal) specifically so both halves of this
// module's logic that DON'T require a live database — "is every id
// well-formed" and "what does this validation row mean" — can be unit-
// tested and mutation-proofed directly and honestly in this repo's normal
// (non-integration) test run, narrowing what genuinely can only be proven
// against a real Postgres instance down to the SQL text itself (the
// FOR UPDATE lock, the EXCEPT-based set comparison, the unnest/ordinality
// resequencing) — see organiserReorderTransaction.integration.test.ts.
export function scopeIdsAreWellFormed(scope: OrganiserItemReorderScope, orderedItemIds: string[]): boolean {
  if (!UUID_RE.test(scope.boardId)) return false;
  if (scope.type === 'top_level_group' && scope.groupId !== null && !UUID_RE.test(scope.groupId)) return false;
  if (scope.type === 'subitems' && !UUID_RE.test(scope.parentItemId)) return false;
  return orderedItemIds.every((id) => UUID_RE.test(id));
}

export function resultFromRows(rows: ValidationRow[]): ResequenceResult {
  if (rows.length === 0) {
    // Structurally unreachable: the `validation` CTE below has no FROM
    // clause of its own scoped to zero-or-more rows — it always produces
    // exactly one row — and LEFT JOIN resequenced can only ever ADD rows to
    // that (one per successfully resequenced item), never remove it.
    // Defense in depth only.
    return { ok: false, reason: 'count_mismatch' };
  }
  const v = rows[0];
  if (!v.no_duplicates) return { ok: false, reason: 'duplicate' };
  if (!v.no_foreign) return { ok: false, reason: 'extra' };
  if (!v.no_missing) return { ok: false, reason: 'missing' };
  if (!v.count_matches) return { ok: false, reason: 'count_mismatch' };
  return {
    ok: true,
    order: rows
      .filter((r): r is ValidationRow & { id: string; position: number } => r.id !== null && r.position !== null)
      .map((r) => ({ id: r.id, position: r.position })),
  };
}

/**
 * Resequences one Organiser item scope (a group's top-level items, or one
 * parent's subitems) to contiguous positions 0..N-1, matching the exact
 * order of `orderedItemIds`. Race-safe under concurrent calls against the
 * SAME scope (see this module's header). Writes NOTHING and returns
 * `{ok:false}` if `orderedItemIds` is not an exact permutation of the
 * scope's current membership, or if any id involved is not UUID-shaped.
 * Never writes `organiser_activity`.
 */
export async function resequenceOrganiserItemScope(
  scope: OrganiserItemReorderScope,
  orderedItemIds: string[],
): Promise<ResequenceResult> {
  if (!scopeIdsAreWellFormed(scope, orderedItemIds)) {
    return { ok: false, reason: 'malformed' };
  }

  const organisationId = scope.organisationId;

  const results =
    scope.type === 'top_level_group'
      ? await sql.transaction([
          sql`
            SELECT id FROM organiser_items
            WHERE organisation_id = ${organisationId} AND board_id = ${scope.boardId}
              AND group_id IS NOT DISTINCT FROM ${scope.groupId}
              AND parent_item_id IS NULL
            FOR UPDATE
          `,
          sql`
            WITH scope_rows AS (
              SELECT id FROM organiser_items
              WHERE organisation_id = ${organisationId} AND board_id = ${scope.boardId}
                AND group_id IS NOT DISTINCT FROM ${scope.groupId}
                AND parent_item_id IS NULL
            ),
            requested AS (
              SELECT id, ord - 1 AS ord
              FROM unnest(${orderedItemIds}::uuid[]) WITH ORDINALITY AS t(id, ord)
            ),
            validation AS (
              SELECT
                (SELECT COUNT(*) FROM requested) = (SELECT COUNT(DISTINCT id) FROM requested) AS no_duplicates,
                NOT EXISTS (SELECT id FROM requested EXCEPT SELECT id FROM scope_rows) AS no_foreign,
                NOT EXISTS (SELECT id FROM scope_rows EXCEPT SELECT id FROM requested) AS no_missing,
                (SELECT COUNT(*) FROM requested) = (SELECT COUNT(*) FROM scope_rows) AS count_matches
            ),
            resequenced AS (
              UPDATE organiser_items t SET position = r.ord
              FROM requested r
              WHERE t.id = r.id AND t.organisation_id = ${organisationId}
                AND (SELECT no_duplicates AND no_foreign AND no_missing AND count_matches FROM validation)
              RETURNING t.id, t.position
            )
            SELECT validation.no_duplicates, validation.no_foreign, validation.no_missing, validation.count_matches,
                   resequenced.id, resequenced.position
            FROM validation LEFT JOIN resequenced ON true
          `,
        ])
      : await sql.transaction([
          sql`
            SELECT id FROM organiser_items
            WHERE organisation_id = ${organisationId} AND board_id = ${scope.boardId}
              AND parent_item_id = ${scope.parentItemId}
            FOR UPDATE
          `,
          sql`
            WITH scope_rows AS (
              SELECT id FROM organiser_items
              WHERE organisation_id = ${organisationId} AND board_id = ${scope.boardId}
                AND parent_item_id = ${scope.parentItemId}
            ),
            requested AS (
              SELECT id, ord - 1 AS ord
              FROM unnest(${orderedItemIds}::uuid[]) WITH ORDINALITY AS t(id, ord)
            ),
            validation AS (
              SELECT
                (SELECT COUNT(*) FROM requested) = (SELECT COUNT(DISTINCT id) FROM requested) AS no_duplicates,
                NOT EXISTS (SELECT id FROM requested EXCEPT SELECT id FROM scope_rows) AS no_foreign,
                NOT EXISTS (SELECT id FROM scope_rows EXCEPT SELECT id FROM requested) AS no_missing,
                (SELECT COUNT(*) FROM requested) = (SELECT COUNT(*) FROM scope_rows) AS count_matches
            ),
            resequenced AS (
              UPDATE organiser_items t SET position = r.ord
              FROM requested r
              WHERE t.id = r.id AND t.organisation_id = ${organisationId}
                AND (SELECT no_duplicates AND no_foreign AND no_missing AND count_matches FROM validation)
              RETURNING t.id, t.position
            )
            SELECT validation.no_duplicates, validation.no_foreign, validation.no_missing, validation.count_matches,
                   resequenced.id, resequenced.position
            FROM validation LEFT JOIN resequenced ON true
          `,
        ]);

  const rows = results[results.length - 1] as ValidationRow[];
  return resultFromRows(rows);
}

// Phase D.4.7E (Slice E2) — group reorder. A SIBLING primitive, not a
// generalisation of resequenceOrganiserItemScope above: `organiser_groups`
// is a different table with different columns, and this repo's own
// convention (see this file's own header) is literal SQL per case, never a
// dynamic table-name/fragment abstraction. Reuses `resultFromRows` — that
// function only interprets validation-flag columns and is table-agnostic
// by construction — but has its own well-formedness guard and its own
// two-statement lock-then-validate-and-resequence transaction, following
// the exact same concurrency discipline documented at the top of this file.

export type OrganiserGroupReorderScope = { organisationId: string; boardId: string };

function groupScopeIdsAreWellFormed(scope: OrganiserGroupReorderScope, orderedGroupIds: string[]): boolean {
  if (!UUID_RE.test(scope.boardId)) return false;
  return orderedGroupIds.every((id) => UUID_RE.test(id));
}

/**
 * Resequences one board's groups to contiguous positions 0..N-1, matching
 * the exact order of `orderedGroupIds`. Race-safe under concurrent calls
 * against the SAME board (same FOR-UPDATE-lock-first discipline as
 * resequenceOrganiserItemScope). Writes NOTHING and returns `{ok:false}`
 * if `orderedGroupIds` is not an exact permutation of the board's current
 * groups, or if any id involved is not UUID-shaped. Never writes
 * `organiser_activity`.
 */
export async function resequenceOrganiserGroupScope(
  scope: OrganiserGroupReorderScope,
  orderedGroupIds: string[],
): Promise<ResequenceResult> {
  if (!groupScopeIdsAreWellFormed(scope, orderedGroupIds)) {
    return { ok: false, reason: 'malformed' };
  }

  const { organisationId, boardId } = scope;

  const results = await sql.transaction([
    sql`
      SELECT id FROM organiser_groups
      WHERE organisation_id = ${organisationId} AND board_id = ${boardId}
      FOR UPDATE
    `,
    sql`
      WITH scope_rows AS (
        SELECT id FROM organiser_groups
        WHERE organisation_id = ${organisationId} AND board_id = ${boardId}
      ),
      requested AS (
        SELECT id, ord - 1 AS ord
        FROM unnest(${orderedGroupIds}::uuid[]) WITH ORDINALITY AS t(id, ord)
      ),
      validation AS (
        SELECT
          (SELECT COUNT(*) FROM requested) = (SELECT COUNT(DISTINCT id) FROM requested) AS no_duplicates,
          NOT EXISTS (SELECT id FROM requested EXCEPT SELECT id FROM scope_rows) AS no_foreign,
          NOT EXISTS (SELECT id FROM scope_rows EXCEPT SELECT id FROM requested) AS no_missing,
          (SELECT COUNT(*) FROM requested) = (SELECT COUNT(*) FROM scope_rows) AS count_matches
      ),
      resequenced AS (
        UPDATE organiser_groups g SET position = r.ord
        FROM requested r
        WHERE g.id = r.id AND g.organisation_id = ${organisationId}
          AND (SELECT no_duplicates AND no_foreign AND no_missing AND count_matches FROM validation)
        RETURNING g.id, g.position
      )
      SELECT validation.no_duplicates, validation.no_foreign, validation.no_missing, validation.count_matches,
             resequenced.id, resequenced.position
      FROM validation LEFT JOIN resequenced ON true
    `,
  ]);

  const rows = results[results.length - 1] as ValidationRow[];
  return resultFromRows(rows);
}
