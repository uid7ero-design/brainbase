// BrainBase Assurance — role policy. Pure (only imports roleGte from the
// edge-safe lib/session.ts) so the service layer can enforce permissions
// without pulling in request/cookie plumbing.
import { roleGte, type Role } from '@/lib/session';

// Operation-class role floors.
//   view       — any organisation member may read non-restricted records.
//   record     — capture/triage/respond/raise findings/add evidence.
//   verify     — record a verification attempt (independence is enforced
//                separately in lib/assurance/verifications.ts).
//   close      — explicit closure/cancellation of actions/findings/incidents.
//   administer — inspection template administration.
//   restricted — may see every restricted Incident/Investigation in the
//                organisation (others see only the ones they own/lead/
//                reported/created).
export const ASSURANCE_MIN_ROLE = {
  view: 'viewer' as Role,
  record: 'manager' as Role,
  verify: 'manager' as Role,
  close: 'manager' as Role,
  administer: 'admin' as Role,
  restricted: 'admin' as Role,
};

export type AssuranceOperation = keyof typeof ASSURANCE_MIN_ROLE;

export type AssuranceViewer = {
  organisationId: string;
  userId: string;
  role: Role;
  /** True when the viewer may see every restricted record in the org. */
  canViewAllRestricted: boolean;
};

export function toAssuranceViewer(session: { organisationId: string; userId: string; role: Role }): AssuranceViewer {
  return {
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
    canViewAllRestricted: roleGte(session.role, ASSURANCE_MIN_ROLE.restricted),
  };
}

export function viewerCan(viewer: AssuranceViewer, operation: AssuranceOperation): boolean {
  return roleGte(viewer.role, ASSURANCE_MIN_ROLE[operation]);
}
