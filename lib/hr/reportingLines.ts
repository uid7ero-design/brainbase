import 'server-only';
import sql from '@/lib/db';

// HR-2 Step 1C — manager-cycle protection. A person may keep an
// existing (even pre-existing-corrupt) manager chain untouched, but may
// never be NEWLY assigned a manager whose own chain already reports
// (directly or transitively) to them — that would make the person their
// own manager's manager, an unresolvable cycle. Direct self-management
// (managerPersonId === personId) is already blocked, both by
// app/api/hr/people/[id]/route.ts's own explicit check AND by
// hr_people's own DB CHECK(manager_person_id IS DISTINCT FROM id) — this
// function is the multi-hop generalization of that same rule, which
// neither the DB nor any application code has ever enforced.
//
// Adapted from the SAME cycle-safe recursive-CTE idiom this codebase
// already shipped and reviewed once before, for the structurally
// identical problem, in app/api/organiser/items/[itemId]/route.ts's
// Phase D.4.6F 'ancestors' CTE (self-referencing parent_item_id) — not a
// new pattern invented for HR.
//
// Walks UPWARD from the PROPOSED manager via manager_person_id, scoped
// to the caller's own organisation. If personId (the one being edited)
// ever appears in that ancestor chain, the proposed manager already
// reports to personId — assigning them would create a cycle.
//
// The `visited` array + `NOT p.id = ANY(a.visited)` guard is the
// Postgres-documented cycle-safe idiom for a self-referencing recursive
// CTE — this is the PRIMARY termination mechanism, not a mere
// optimization: a bare UNION would NOT be safe here, since Postgres
// UNION dedups on the full row tuple and every row already differs by
// its own visited array, so a pre-existing corrupted cycle elsewhere in
// the organisation's manager graph would never produce a duplicate row
// for UNION to drop, and the recursion would never terminate on its
// own. Because of this guard, a pre-existing corrupt cycle UNRELATED to
// personId/proposedManagerPersonId is handled safely and silently — that
// branch of the walk simply stops expanding (never revisits a node)
// without error, and without affecting the correctness of the one
// specific yes/no question this function answers. array_length(...) <
// 500 is a SECOND, redundant depth cap purely as defense-in-depth
// (matching the organiser precedent's own constant — generous for HR's
// much smaller expected organisation sizes), not the primary safeguard.
//
// Does not touch, weaken, or replace isPersonInOrganisation() — same-org
// manager existence remains a separate, already-existing prerequisite
// check the caller runs first (see app/api/hr/people/[id]/route.ts).
// This function assumes proposedManagerPersonId has already been proven
// to exist in organisationId.
export async function wouldCreateManagerCycle(params: {
  organisationId: string;
  personId: string;
  proposedManagerPersonId: string;
}): Promise<boolean> {
  const rows = await sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, manager_person_id, ARRAY[id] AS visited
      FROM hr_people
      WHERE id = ${params.proposedManagerPersonId}::uuid AND organisation_id = ${params.organisationId}
      UNION ALL
      SELECT p.id, p.manager_person_id, a.visited || p.id
      FROM hr_people p
      JOIN ancestors a ON p.id = a.manager_person_id
      WHERE p.organisation_id = ${params.organisationId}
        AND NOT p.id = ANY(a.visited)
        AND array_length(a.visited, 1) < 500
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${params.personId}::uuid) AS would_cycle
  `;
  return Boolean((rows[0] as { would_cycle: boolean } | undefined)?.would_cycle);
}
