import type { IntegrationPrincipal } from '@/lib/integrationCredentials/service';
import type { OrganiserActivityEntry } from './activity';

// Essio integration B1 — the machine/system actor for Organiser writes made
// by an integration (first user: Essio, from B2 onwards).
//
// Formalises ADR-0003 §5 for the Organiser:
//   * user id   = NULL      (never a placeholder or fake Essio user row)
//   * actor name = "Essio"  (organiser_activity.actor_name is NOT NULL)
//   * metadata.source = "essio", plus the credential id for audit
// An integration write is never attributed to, or made as, a human user.

export const ESSIO_ACTOR_NAME = 'Essio';
export const ESSIO_ACTOR_SOURCE = 'essio';

export interface OrganiserSystemActor {
  readonly kind: 'system';
  readonly actorUserId: null;
  readonly actorName: string;
  readonly source: string;
  readonly credentialId: string;
}

/** The system actor for writes made under an authenticated Essio credential. */
export function essioSystemActor(
  principal: Pick<IntegrationPrincipal, 'kind' | 'integrationKey' | 'credentialId'>,
): OrganiserSystemActor {
  if (principal.kind !== 'integration' || principal.integrationKey !== 'essio') {
    throw new Error('essioSystemActor requires an authenticated Essio integration principal');
  }
  return Object.freeze({
    kind: 'system' as const,
    actorUserId: null,
    actorName: ESSIO_ACTOR_NAME,
    source: ESSIO_ACTOR_SOURCE,
    credentialId: principal.credentialId,
  });
}

/** Actor fields for an organiser_activity entry (OrganiserActivityEntry). */
export function systemActorActivityFields(
  actor: OrganiserSystemActor,
): Required<Pick<OrganiserActivityEntry, 'actorName'>> & {
  actorUserId: null;
  metadata: { source: string; credential_id: string };
} {
  return {
    actorUserId: null,
    actorName: actor.actorName,
    metadata: { source: actor.source, credential_id: actor.credentialId },
  };
}

/** Actor fields for an audit_logs row (ADR-0003 §5: user_id NULL + after_state.source). */
export function systemActorAuditFields(actor: OrganiserSystemActor): {
  userId: null;
  sourceState: { source: string; credential_id: string };
} {
  return { userId: null, sourceState: { source: actor.source, credential_id: actor.credentialId } };
}
