export type LifecycleResponsibilityType = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
export type LifecycleApprovalType = 'NONE' | 'MANAGER' | 'HR_ADMIN';

export type LifecycleActorContext = {
  organisationId: string;
  userId: string;
  /** True only for an active HR-administrator grant in this org, or the
   * central super_admin bypass after active-org scoping has been resolved. */
  isHrAdministrator: boolean;
};

export type LifecycleWorkflowAccessTarget = {
  organisationId: string;
  personLinkedUserId: string | null;
  currentManagerLinkedUserId: string | null;
};

export type LifecycleTaskAccessTarget = LifecycleWorkflowAccessTarget & {
  responsibilityType: LifecycleResponsibilityType;
  approvalType: LifecycleApprovalType;
  assignedUserId: string | null;
  employeeVisible: boolean;
  managerVisible: boolean;
  internalOnly: boolean;
};

function sameOrg(
  actor: LifecycleActorContext,
  target: { organisationId: string },
): boolean {
  return actor.organisationId === target.organisationId;
}

function isLinkedEmployee(
  actor: LifecycleActorContext,
  target: LifecycleWorkflowAccessTarget,
): boolean {
  return target.personLinkedUserId !== null
    && actor.userId === target.personLinkedUserId;
}

function isCurrentDirectManager(
  actor: LifecycleActorContext,
  target: LifecycleWorkflowAccessTarget,
): boolean {
  return target.currentManagerLinkedUserId !== null
    && actor.userId === target.currentManagerLinkedUserId;
}

/** Template administration and workflow start/cancel are HR-admin only.
 * super_admin reaches this function with isHrAdministrator=true after the
 * central active-org-scoped bypass has been resolved server-side. */
export function canManageLifecycle(actor: LifecycleActorContext): boolean {
  return actor.isHrAdministrator;
}

/** A workflow shell is visible to its explicitly linked employee, that
 * person's CURRENT direct manager, or HR administration. */
export function canViewLifecycleWorkflow(
  actor: LifecycleActorContext,
  target: LifecycleWorkflowAccessTarget,
): boolean {
  if (!sameOrg(actor, target)) return false;
  return actor.isHrAdministrator
    || isLinkedEmployee(actor, target)
    || isCurrentDirectManager(actor, target);
}

/** Visibility is separate from execution. internal_only always excludes
 * employee and manager access. assignedUserId is intentionally NOT an
 * authority source: current explicit HR relationships are authoritative. */
export function canViewLifecycleTask(
  actor: LifecycleActorContext,
  target: LifecycleTaskAccessTarget,
): boolean {
  if (!sameOrg(actor, target)) return false;
  if (actor.isHrAdministrator) return true;
  if (target.internalOnly) return false;

  if (target.employeeVisible && isLinkedEmployee(actor, target)) return true;
  if (target.managerVisible && isCurrentDirectManager(actor, target)) return true;

  return false;
}

/** Execution requires both visibility and the current responsibility rule.
 * HR administration has the explicit administrative override for execution. */
export function canExecuteLifecycleTask(
  actor: LifecycleActorContext,
  target: LifecycleTaskAccessTarget,
): boolean {
  if (!sameOrg(actor, target)) return false;
  if (actor.isHrAdministrator) return true;
  if (!canViewLifecycleTask(actor, target)) return false;

  if (target.responsibilityType === 'EMPLOYEE') {
    return isLinkedEmployee(actor, target);
  }

  if (target.responsibilityType === 'MANAGER') {
    return isCurrentDirectManager(actor, target);
  }

  return false;
}

/** Approval authority is exact and server-derived. There is deliberately no
 * general HR-admin override for MANAGER approvals: MANAGER means the current
 * direct manager at decision time; HR_ADMIN means HR administration. */
export function canApproveLifecycleTask(
  actor: LifecycleActorContext,
  target: LifecycleTaskAccessTarget,
): boolean {
  if (!sameOrg(actor, target)) return false;
  if (target.approvalType === 'NONE') return false;

  if (target.approvalType === 'HR_ADMIN') {
    return actor.isHrAdministrator;
  }

  return canViewLifecycleTask(actor, target)
    && isCurrentDirectManager(actor, target);
}
