import 'server-only';
import sql from '@/lib/db';
import { AssuranceValidationError } from './errors';

// BrainBase Assurance — same-organisation users(id) validation.
//
// Known database gap (A0.1C..A0.1E): every Assurance users(id) column
// (owner_user_id, lead_user_id, inspector_user_id, responsible_user_id,
// verified_by, created_by, closed_by, completed_by, responded_by,
// removed_by, ...) is a BARE foreign key — users has no
// UNIQUE (organisation_id, id) anchor, so the database will happily
// accept a user from another tenant. This module is the single,
// reusable service-layer guard for that gap. Every Assurance write that
// sets a user column from REQUEST data MUST pass those ids through
// assertSameOrgUsers() first. Columns set from the authenticated session
// (created_by = viewer.userId etc.) are already same-org by construction
// (requireSession() rejects a session whose user moved organisation).

export type UserFieldValue = { field: string; userId: string | null | undefined };

/**
 * Throws AssuranceValidationError naming the FIRST offending field if any
 * supplied user id does not belong to `organisationId` or is not ACTIVE.
 * Never reveals whether the id exists in another organisation.
 */
export async function assertSameOrgUsers(organisationId: string, fields: UserFieldValue[]): Promise<void> {
  const present = fields.filter((f): f is { field: string; userId: string } => typeof f.userId === 'string' && f.userId !== '');
  if (present.length === 0) return;

  const ids = [...new Set(present.map(f => f.userId))];
  const rows = (await sql`
    SELECT id
    FROM users
    WHERE organisation_id = ${organisationId}
      AND id = ANY(${ids}::text[])
      AND status::text = 'ACTIVE'
  `) as { id: string }[];
  const valid = new Set(rows.map(r => r.id));

  for (const f of present) {
    if (!valid.has(f.userId)) {
      throw new AssuranceValidationError(`${f.field} must be an active user in your organisation.`);
    }
  }
}

export type OrgUserOption = { id: string; name: string };

/** Active users of the viewer's organisation — id + display name only (no email/phone). */
export async function listOrgUserOptions(organisationId: string): Promise<OrgUserOption[]> {
  const rows = (await sql`
    SELECT id, name
    FROM users
    WHERE organisation_id = ${organisationId}
      AND status::text = 'ACTIVE'
    ORDER BY name ASC
    LIMIT 500
  `) as OrgUserOption[];
  return rows;
}
