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

// The Founder Tasks board is deliberately NOT a hardcoded/seeded id — it's
// the first (by position, then created_at) organiser board that already
// exists for the BrainBase org, discovered at read time. Per the Phase D
// audit: whether a suitable board already exists in Production, and
// whether that board's existing content is exclusively founder-task-
// shaped, could not be verified from the repository alone — the UI
// surfaces the resolved board's real name prominently so this is never
// silently assumed, and a board is only ever created via an explicit,
// founder-initiated action (see app/api/founder/tasks/board/route.ts),
// never automatically/silently seeded.
export async function resolveFounderBoard(organisationId: string): Promise<FounderBoard | null> {
  const rows = await sql`
    SELECT id, name FROM organiser_boards
    WHERE organisation_id = ${organisationId}
    ORDER BY position ASC, created_at ASC
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return { id: rows[0].id as string, name: rows[0].name as string };
}
