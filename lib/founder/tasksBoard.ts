import 'server-only';
import sql from '@/lib/db';

// Founder OS Phase D — resolves "the BrainBase internal Organiser board"
// server-side, deterministically, ignoring any active super_admin
// impersonation (org_override). The generic organiser routes
// (app/api/organiser/**) deliberately resolve organisation_id via
// lib/org.ts's requireRole(), which is impersonation-aware — correct for
// their own purpose (a super_admin genuinely acting within another org's
// context), but wrong here: Founder OS's own tasks must always mean
// BrainBase's own tasks, never whatever org a founder happens to be
// impersonating elsewhere in the app at that moment. This file is the
// "smallest safe Founder-specific adapter" — it does not reimplement
// Organiser, it resolves one org id correctly and then reads/writes the
// exact same organiser_boards/organiser_items tables directly.
//
// BRAINBASE_SLUG matches the existing, already-established convention in
// lib/dashboard/clientDashboard.ts (confirmed there against the live
// organisations table) — not a new/independent lookup mechanism.
const BRAINBASE_SLUG = 'brainbase';

export async function resolveBrainbaseOrgId(): Promise<string | null> {
  const rows = await sql`SELECT id FROM organisations WHERE slug = ${BRAINBASE_SLUG} LIMIT 1`;
  return (rows[0]?.id as string) ?? null;
}

export type FounderBoard = { id: string; name: string };

// Pre-merge correction (post-Phase-D Production verification): BrainBase's
// real org already has two pre-existing, populated Organiser boards ("WORK",
// position 0; "Tafe", position 1). The original "first board by position"
// strategy would have silently adopted WORK as "Founder Tasks" — wrong, and
// a live-data risk. Founder OS Tasks now resolves ONLY an Organiser board
// whose name is the EXACT literal "Founder Tasks" within the BrainBase org —
// never by position, never "first" or "latest", never a caller-supplied
// board id. WORK and Tafe are structurally invisible to this resolver: they
// simply don't match the name filter, so they can never be read, written,
// or silently adopted, regardless of how many boards BrainBase's org holds
// or in what order. If no such board exists yet, this returns null — the
// UI/API surface an honest empty state, and a board is only ever created via
// an explicit, founder-initiated action (see
// app/api/founder/tasks/board/route.ts), never automatically/silently
// seeded, and that creation itself re-checks this exact same predicate
// before inserting (idempotent / conflict-safe, never a duplicate).
const FOUNDER_BOARD_NAME = 'Founder Tasks';

export async function resolveFounderBoard(organisationId: string): Promise<FounderBoard | null> {
  const rows = await sql`
    SELECT id, name FROM organiser_boards
    WHERE organisation_id = ${organisationId} AND name = ${FOUNDER_BOARD_NAME}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return { id: rows[0].id as string, name: rows[0].name as string };
}

export { FOUNDER_BOARD_NAME };
