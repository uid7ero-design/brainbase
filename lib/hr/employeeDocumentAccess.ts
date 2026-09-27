export type EmployeeDocumentActorContext = {
  organisationId: string;
  userId: string;
  isHrAdministrator: boolean;
};

export type EmployeeDocumentAccessTarget = {
  organisationId: string;
  personLinkedUserId: string | null;
};

/**
 * Employee documents are private in HR-7 first release:
 * linked employee self-access + active HR administration only.
 * Managers receive no metadata or byte access.
 */
export function canViewEmployeeDocument(
  actor: EmployeeDocumentActorContext,
  target: EmployeeDocumentAccessTarget,
): boolean {
  if (actor.organisationId !== target.organisationId) return false;
  if (actor.isHrAdministrator) return true;

  return target.personLinkedUserId !== null
    && actor.userId === target.personLinkedUserId;
}

export function canManageEmployeeDocument(
  actor: EmployeeDocumentActorContext,
  target: { organisationId: string },
): boolean {
  return actor.organisationId === target.organisationId
    && actor.isHrAdministrator;
}
