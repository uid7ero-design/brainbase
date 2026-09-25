import 'server-only';

import { isActiveUserInOrganisation } from '@/lib/hr/validation';
import type { OrgSession } from '@/lib/org';

export type RestrictedGrantTargetResult =
  | {
      eligible: true;
      userId: string;
    }
  | {
      eligible: false;
      reason: 'not_eligible';
    };

/**
 * HR-6 PR-2 — validates a user who is about to receive restricted-case
 * access. Eligibility is deliberately stricter than simple FK existence:
 * the target must be an ACTIVE user in the request's active organisation.
 *
 * There is no super_admin bypass here. A super_admin operating under an
 * organisation override may act as the grantor, but the recipient still has
 * to belong to the active organisation and be ACTIVE.
 *
 * Cross-organisation, INACTIVE, INVITED and nonexistent users all collapse to
 * the same not_eligible result so callers do not turn this helper into a user
 * enumeration surface.
 */
export async function validateRestrictedGrantTarget(
  organisationId: string,
  targetUserId: string,
): Promise<RestrictedGrantTargetResult> {
  const eligible = await isActiveUserInOrganisation(
    targetUserId,
    organisationId,
  );

  if (!eligible) {
    return {
      eligible: false,
      reason: 'not_eligible',
    };
  }

  return {
    eligible: true,
    userId: targetUserId,
  };
}

export type HrRestrictedActor = {
  /** Always the authenticated session user; never supplied by request JSON. */
  userId: string;
  /** The active organisation this restricted-HR action is operating in. */
  organisationId: string;
  /** The actor's real/home users.organisation_id. */
  homeOrganisationId: string;
  /** True only for super_admin acting under an explicit organisation override. */
  isOrgOverride: boolean;
};

export type HrRestrictedActorSession = Pick<
  OrgSession,
  'userId' | 'organisationId' | 'homeOrganisationId' | 'role'
>;

/**
 * HR-6 PR-2 — derives restricted-HR actor attribution exclusively from the
 * authenticated OrgSession. There is intentionally no actor/user-id override
 * parameter: opened_by / granted_by / revoked_by / author_id / uploaded_by
 * must all use the returned userId rather than accepting a client-supplied
 * actor.
 *
 * A super_admin under org_override is valid even though the actor's home
 * organisation differs from the active organisation. That exception applies
 * to actor attribution only; restricted-case and target-user validation stay
 * scoped to organisationId.
 */
export function restrictedActorFromSession(
  session: HrRestrictedActorSession,
): HrRestrictedActor {
  return {
    userId: session.userId,
    organisationId: session.organisationId,
    homeOrganisationId: session.homeOrganisationId,
    isOrgOverride:
      session.role === 'super_admin'
      && session.organisationId !== session.homeOrganisationId,
  };
}

/**
 * HR-6 PR-2 — authority to manage per-case restricted-access grants.
 *
 * This is deliberately independent from restricted-case read authorization:
 * an HR administrator may grant/revoke access without automatically being
 * able to read the case. super_admin may manage grants regardless of an
 * hr_administrators row. Ordinary roles cannot manage grants.
 */
export function canManageRestrictedCaseAccess(
  session: Pick<OrgSession, 'role'>,
  isHrAdministrator: boolean,
): boolean {
  return session.role === 'super_admin' || isHrAdministrator;
}
