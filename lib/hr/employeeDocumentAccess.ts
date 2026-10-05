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

/**
 * Acknowledgement is personal evidence from the employee linked to the
 * document owner. HR administrators do not gain authority to acknowledge
 * on another employee's behalf merely because they can administer HR.
 */
export function canAcknowledgeEmployeeDocument(
  actor: EmployeeDocumentActorContext,
  target: EmployeeDocumentAccessTarget,
): boolean {
  return actor.organisationId === target.organisationId
    && target.personLinkedUserId !== null
    && actor.userId === target.personLinkedUserId;
}

/**
 * Verification is an HR-governance action. Linked employees, managers and
 * unrelated users cannot verify employee-document versions.
 */
export function canVerifyEmployeeDocument(
  actor: EmployeeDocumentActorContext,
  target: { organisationId: string },
): boolean {
  return actor.organisationId === target.organisationId
    && actor.isHrAdministrator;
}
