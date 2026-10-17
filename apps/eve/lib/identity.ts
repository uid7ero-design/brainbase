import type { OrganiserSession } from './ticketing/gateway';
import type { OrganiserIdentity } from '@/components/organiser/OrganiserShell';

export function identityOf(session: OrganiserSession): OrganiserIdentity {
  return {
    name: session.user.name,
    role: session.user.role,
    organisationId: session.organisationId,
    organisationName: session.organisation.name,
  };
}
