import 'server-only';
import sql from '@/lib/db';
import type { Role } from '@/lib/session';
import type { HrAccessContext } from './access';

// HR-1 — resolves the real HrAccessContext lib/hr/access.ts's pure
// functions need, now that hr_people/hr_administrators exist. Every
// HR-1 route calls this once, right after requireSession() +
// requireCapability(organisationId, 'people'), and passes the result to
// lib/hr/access.ts's canViewPerson()/canEditPerson()/etc. — never
// re-implements the decision itself.
//
// selfPersonId resolution is the Critical Domain Rule from HR-0: it is
// the caller's linked_user_id row in hr_people for THIS organisation
// only, never inferred by email/name/phone. This is unaffected by the
// HR-2 super_admin policy below — a super_admin who ALSO happens to
// have a linked hr_people row still resolves it normally.
//
// HR-2 — full super_admin HR access. `role` is the caller's real,
// DB-authoritative platform role (lib/org.ts's requireSession(), same
// value every other super_admin-gated surface in this codebase already
// trusts). For role === 'super_admin', isHrAdministrator and
// hasRestrictedHrAccess resolve to true unconditionally, for the
// organisationId the caller passed in — which is ALREADY the caller's
// current active organisation (every HR route passes
// session.organisationId, itself resolved by requireSession()'s own
// pre-existing org_override substitution; this function never receives
// or uses homeOrganisationId, and doesn't need to — the org-scoping
// question is already settled by the time organisationId reaches here).
// No hr_administrators row is read or written for a super_admin caller
// — the authority is computed, not granted, and the hr_administrators
// lookup itself is skipped entirely (never issued) rather than merely
// ignored, since a real grant row is not needed and querying for one
// would be pure waste on every super_admin HR request.
//
// This does NOT touch lib/hr/access.ts's pure decision functions or
// their same-org checks — sameOrg()/canViewPerson()/canEditPerson()/etc.
// still receive an ordinary-shaped HrAccessContext and still refuse
// any cross-organisation target exactly as before. A super_admin's
// bypass is entirely in HOW isHrAdministrator/hasRestrictedHrAccess get
// set here, never in relaxing the organisation match those functions
// enforce.
//
// For every other role, behavior is byte-for-byte unchanged from HR-1:
// isHrAdministrator is read from hr_administrators only, and
// hasRestrictedHrAccess remains always false (no restricted-HR grant
// mechanism exists yet — that is HR-6's own, later, separately
// reviewed phase).
export async function resolveHrAccessContext(params: {
  organisationId: string;
  userId: string;
  role: Role;
}): Promise<HrAccessContext> {
  const isSuperAdmin = params.role === 'super_admin';

  const [selfRows, adminRows] = await Promise.all([
    sql`
      SELECT id FROM hr_people
      WHERE organisation_id = ${params.organisationId} AND linked_user_id = ${params.userId}
      LIMIT 1
    `,
    isSuperAdmin
      ? Promise.resolve([])
      : sql`
          SELECT id FROM hr_administrators
          WHERE organisation_id = ${params.organisationId} AND user_id = ${params.userId}
          LIMIT 1
        `,
  ]);

  return {
    organisationId: params.organisationId,
    selfPersonId: (selfRows[0]?.id as string | undefined) ?? null,
    isHrAdministrator: isSuperAdmin ? true : adminRows.length > 0,
    hasRestrictedHrAccess: isSuperAdmin,
  };
}
