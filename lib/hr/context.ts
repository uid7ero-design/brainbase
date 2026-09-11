import 'server-only';
import sql from '@/lib/db';
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
// only, never inferred by email/name/phone. isHrAdministrator is read
// from hr_administrators only — never derived from users.role, and
// never implied by super_admin (see lib/hr/access.ts's own header
// comment for the full rationale).
//
// hasRestrictedHrAccess is always false in HR-1 — no restricted-HR
// grant mechanism exists yet (that is HR-6's own, later, separately
// reviewed phase); this preserves lib/hr/access.ts's
// canAccessRestrictedHr()/canFieldBeShown() behaviour exactly as HR-0.5
// left it (always denied) rather than inventing a placeholder grant.
export async function resolveHrAccessContext(params: {
  organisationId: string;
  userId: string;
}): Promise<HrAccessContext> {
  const [selfRows, adminRows] = await Promise.all([
    sql`
      SELECT id FROM hr_people
      WHERE organisation_id = ${params.organisationId} AND linked_user_id = ${params.userId}
      LIMIT 1
    `,
    sql`
      SELECT id FROM hr_administrators
      WHERE organisation_id = ${params.organisationId} AND user_id = ${params.userId}
      LIMIT 1
    `,
  ]);

  return {
    organisationId: params.organisationId,
    selfPersonId: (selfRows[0]?.id as string | undefined) ?? null,
    isHrAdministrator: adminRows.length > 0,
    hasRestrictedHrAccess: false,
  };
}
