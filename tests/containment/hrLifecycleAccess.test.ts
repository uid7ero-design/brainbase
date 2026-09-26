import { describe, expect, it } from 'vitest';
import {
  canApproveLifecycleTask,
  canExecuteLifecycleTask,
  canManageLifecycle,
  canViewLifecycleTask,
  canViewLifecycleWorkflow,
  type LifecycleActorContext,
  type LifecycleTaskAccessTarget,
  type LifecycleWorkflowAccessTarget,
} from '@/lib/hr/lifecycleAccess';
import {
  assertLifecycleTaskTransition,
  assertLifecycleTemplateEditable,
  assertLifecycleTemplateStartable,
  assertLifecycleTemplateTransition,
  assertLifecycleWorkflowTransition,
} from '@/lib/hr/lifecycleTransitions';

function actor(overrides: Partial<LifecycleActorContext> = {}): LifecycleActorContext {
  return {
    organisationId: 'org-a',
    userId: 'user-a',
    isHrAdministrator: false,
    ...overrides,
  };
}

function workflow(overrides: Partial<LifecycleWorkflowAccessTarget> = {}): LifecycleWorkflowAccessTarget {
  return {
    organisationId: 'org-a',
    personLinkedUserId: 'employee-user',
    currentManagerLinkedUserId: 'manager-user',
    ...overrides,
  };
}

function task(overrides: Partial<LifecycleTaskAccessTarget> = {}): LifecycleTaskAccessTarget {
  return {
    ...workflow(),
    responsibilityType: 'EMPLOYEE',
    approvalType: 'NONE',
    assignedUserId: 'employee-user',
    employeeVisible: true,
    managerVisible: false,
    internalOnly: false,
    ...overrides,
  };
}

describe('HR-7B lifecycle workflow visibility', () => {
  it('allows the explicitly linked employee to see their own workflow shell', () => {
    expect(canViewLifecycleWorkflow(actor({ userId: 'employee-user' }), workflow())).toBe(true);
  });

  it('allows only the current direct manager relationship', () => {
    expect(canViewLifecycleWorkflow(actor({ userId: 'manager-user' }), workflow())).toBe(true);
    expect(canViewLifecycleWorkflow(
      actor({ userId: 'old-manager' }),
      workflow({ currentManagerLinkedUserId: 'manager-user' }),
    )).toBe(false);
  });

  it('fails closed when the employee has no linked user', () => {
    expect(canViewLifecycleWorkflow(
      actor({ userId: 'employee-user' }),
      workflow({ personLinkedUserId: null }),
    )).toBe(false);
  });

  it('denies an unrelated same-org user', () => {
    expect(canViewLifecycleWorkflow(actor({ userId: 'unrelated' }), workflow())).toBe(false);
  });

  it('denies cross-org access even when the actor is an HR administrator', () => {
    expect(canViewLifecycleWorkflow(
      actor({ organisationId: 'org-a', isHrAdministrator: true }),
      workflow({ organisationId: 'org-b' }),
    )).toBe(false);
  });

  it('allows HR administration only inside the active organisation', () => {
    expect(canViewLifecycleWorkflow(actor({ isHrAdministrator: true }), workflow())).toBe(true);
    expect(canManageLifecycle(actor({ isHrAdministrator: true }))).toBe(true);
    expect(canManageLifecycle(actor())).toBe(false);
  });
});

describe('HR-7B lifecycle task visibility is separate from execution', () => {
  it('employee_visible permits only the linked employee', () => {
    expect(canViewLifecycleTask(actor({ userId: 'employee-user' }), task())).toBe(true);
    expect(canViewLifecycleTask(actor({ userId: 'manager-user' }), task())).toBe(false);
  });

  it('manager_visible permits only the current direct manager', () => {
    const managerTask = task({ employeeVisible: false, managerVisible: true });
    expect(canViewLifecycleTask(actor({ userId: 'manager-user' }), managerTask)).toBe(true);
    expect(canViewLifecycleTask(actor({ userId: 'old-manager' }), managerTask)).toBe(false);
  });

  it('internal_only dominates employee/manager relationships', () => {
    const internal = task({
      employeeVisible: false,
      managerVisible: false,
      internalOnly: true,
      responsibilityType: 'HR_ADMIN',
    });
    expect(canViewLifecycleTask(actor({ userId: 'employee-user' }), internal)).toBe(false);
    expect(canViewLifecycleTask(actor({ userId: 'manager-user' }), internal)).toBe(false);
    expect(canViewLifecycleTask(actor({ isHrAdministrator: true }), internal)).toBe(true);
  });

  it('assigned_user_id is not an authorization fallback', () => {
    const staleAssignment = task({
      assignedUserId: 'old-manager',
      responsibilityType: 'MANAGER',
      employeeVisible: false,
      managerVisible: true,
      currentManagerLinkedUserId: 'new-manager',
    });
    expect(canViewLifecycleTask(actor({ userId: 'old-manager' }), staleAssignment)).toBe(false);
    expect(canExecuteLifecycleTask(actor({ userId: 'old-manager' }), staleAssignment)).toBe(false);
    expect(canViewLifecycleTask(actor({ userId: 'new-manager' }), staleAssignment)).toBe(true);
  });

  it('a visible task does not imply execution rights', () => {
    const visibleEmployeeTask = task({ managerVisible: true, responsibilityType: 'EMPLOYEE' });
    expect(canViewLifecycleTask(actor({ userId: 'manager-user' }), visibleEmployeeTask)).toBe(true);
    expect(canExecuteLifecycleTask(actor({ userId: 'manager-user' }), visibleEmployeeTask)).toBe(false);
  });
});

describe('HR-7B lifecycle task execution', () => {
  it('EMPLOYEE execution requires current explicit employee linkage and employee visibility', () => {
    expect(canExecuteLifecycleTask(actor({ userId: 'employee-user' }), task())).toBe(true);
    expect(canExecuteLifecycleTask(
      actor({ userId: 'employee-user' }),
      task({ employeeVisible: false }),
    )).toBe(false);
    expect(canExecuteLifecycleTask(
      actor({ userId: 'employee-user' }),
      task({ personLinkedUserId: null }),
    )).toBe(false);
  });

  it('MANAGER execution requires the current manager and manager visibility', () => {
    const managerTask = task({
      responsibilityType: 'MANAGER',
      employeeVisible: false,
      managerVisible: true,
    });
    expect(canExecuteLifecycleTask(actor({ userId: 'manager-user' }), managerTask)).toBe(true);
    expect(canExecuteLifecycleTask(actor({ userId: 'old-manager' }), managerTask)).toBe(false);
    expect(canExecuteLifecycleTask(
      actor({ userId: 'manager-user' }),
      { ...managerTask, managerVisible: false },
    )).toBe(false);
  });

  it('HR_ADMIN execution is HR administration only', () => {
    const hrTask = task({
      responsibilityType: 'HR_ADMIN',
      employeeVisible: false,
      managerVisible: false,
      internalOnly: true,
    });
    expect(canExecuteLifecycleTask(actor({ isHrAdministrator: true }), hrTask)).toBe(true);
    expect(canExecuteLifecycleTask(actor({ userId: 'employee-user' }), hrTask)).toBe(false);
    expect(canExecuteLifecycleTask(actor({ userId: 'manager-user' }), hrTask)).toBe(false);
  });

  it('HR administration may administratively execute any in-org task', () => {
    expect(canExecuteLifecycleTask(actor({ isHrAdministrator: true }), task())).toBe(true);
  });

  it('never executes a cross-org task, even as HR administration', () => {
    expect(canExecuteLifecycleTask(
      actor({ isHrAdministrator: true }),
      task({ organisationId: 'org-b' }),
    )).toBe(false);
  });
});

describe('HR-7B lifecycle approvals', () => {
  it('NONE can never be approved', () => {
    expect(canApproveLifecycleTask(actor({ isHrAdministrator: true }), task())).toBe(false);
  });

  it('MANAGER approval belongs to the current direct manager, not HR admin by default', () => {
    const approvalTask = task({
      approvalType: 'MANAGER',
      employeeVisible: false,
      managerVisible: true,
    });
    expect(canApproveLifecycleTask(actor({ userId: 'manager-user' }), approvalTask)).toBe(true);
    expect(canApproveLifecycleTask(actor({ userId: 'old-manager' }), approvalTask)).toBe(false);
    expect(canApproveLifecycleTask(actor({ isHrAdministrator: true }), approvalTask)).toBe(false);
  });

  it('MANAGER approval is denied when the task is not manager-visible', () => {
    expect(canApproveLifecycleTask(
      actor({ userId: 'manager-user' }),
      task({ approvalType: 'MANAGER', managerVisible: false }),
    )).toBe(false);
  });

  it('HR_ADMIN approval belongs only to HR administration', () => {
    const approvalTask = task({ approvalType: 'HR_ADMIN' });
    expect(canApproveLifecycleTask(actor({ isHrAdministrator: true }), approvalTask)).toBe(true);
    expect(canApproveLifecycleTask(actor({ userId: 'manager-user' }), approvalTask)).toBe(false);
    expect(canApproveLifecycleTask(actor({ userId: 'employee-user' }), approvalTask)).toBe(false);
  });
});

describe('HR-7B lifecycle transition policy', () => {
  it('allows only forward template lifecycle transitions', () => {
    expect(() => assertLifecycleTemplateTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertLifecycleTemplateTransition('DRAFT', 'RETIRED')).not.toThrow();
    expect(() => assertLifecycleTemplateTransition('ACTIVE', 'RETIRED')).not.toThrow();
    expect(() => assertLifecycleTemplateTransition('ACTIVE', 'DRAFT')).toThrow();
    expect(() => assertLifecycleTemplateTransition('RETIRED', 'ACTIVE')).toThrow();
  });

  it('enforces template immutability and ACTIVE-only workflow starts', () => {
    expect(() => assertLifecycleTemplateEditable('DRAFT')).not.toThrow();
    expect(() => assertLifecycleTemplateEditable('ACTIVE')).toThrow(/immutable/i);
    expect(() => assertLifecycleTemplateEditable('RETIRED')).toThrow(/immutable/i);

    expect(() => assertLifecycleTemplateStartable('ACTIVE')).not.toThrow();
    expect(() => assertLifecycleTemplateStartable('DRAFT')).toThrow(/ACTIVE/);
    expect(() => assertLifecycleTemplateStartable('RETIRED')).toThrow(/ACTIVE/);
  });

  it('keeps workflow terminal states terminal', () => {
    expect(() => assertLifecycleWorkflowTransition('ACTIVE', 'COMPLETED')).not.toThrow();
    expect(() => assertLifecycleWorkflowTransition('ACTIVE', 'CANCELLED')).not.toThrow();
    expect(() => assertLifecycleWorkflowTransition('COMPLETED', 'ACTIVE')).toThrow();
    expect(() => assertLifecycleWorkflowTransition('CANCELLED', 'ACTIVE')).toThrow();
  });

  it('keeps task terminal states terminal and supports approval rejection recovery', () => {
    expect(() => assertLifecycleTaskTransition('NOT_STARTED', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertLifecycleTaskTransition('IN_PROGRESS', 'AWAITING_APPROVAL')).not.toThrow();
    expect(() => assertLifecycleTaskTransition('AWAITING_APPROVAL', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertLifecycleTaskTransition('COMPLETED', 'IN_PROGRESS')).toThrow();
    expect(() => assertLifecycleTaskTransition('WAIVED', 'IN_PROGRESS')).toThrow();
    expect(() => assertLifecycleTaskTransition('CANCELLED', 'IN_PROGRESS')).toThrow();
  });

  it('rejects same-state pseudo transitions', () => {
    expect(() => assertLifecycleTemplateTransition('DRAFT', 'DRAFT')).toThrow();
    expect(() => assertLifecycleWorkflowTransition('ACTIVE', 'ACTIVE')).toThrow();
    expect(() => assertLifecycleTaskTransition('NOT_STARTED', 'NOT_STARTED')).toThrow();
  });
});
