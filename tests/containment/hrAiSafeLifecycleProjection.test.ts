import { describe, expect, it } from 'vitest';
import {
  projectLifecycleForAi,
  type AiSafeLifecycleWorkflowProjection,
} from '@/lib/hr/aiSafeLifecycleProjection';
import type { LifecycleTaskRow, LifecycleWorkflowRow } from '@/lib/hr/lifecycleRoute';

const WORKFLOW: LifecycleWorkflowRow = {
  id: 'workflow-secret-id',
  organisationId: 'org-secret-id',
  personId: 'person-secret-id',
  templateId: 'template-secret-id',
  lifecycleType: 'onboarding',
  status: 'ACTIVE',
  anchorDate: '2026-10-01',
  startedBy: 'starter-secret-id',
  startedAt: '2026-10-01T09:30:00.000Z',
  completedAt: null,
  cancelledAt: null,
};

const TASK: LifecycleTaskRow = {
  id: 'task-secret-id',
  organisationId: 'org-secret-id',
  workflowId: 'workflow-secret-id',
  personId: 'person-secret-id',
  templateId: 'template-secret-id',
  templateTaskId: 'template-task-secret-id',
  sequence: 4,
  title: 'Complete induction',
  description: 'Sensitive authored detail must not enter the AI projection.',
  responsibilityType: 'EMPLOYEE',
  assignedUserId: 'assignee-secret-id',
  dueAt: '2026-10-08T17:00:00.000Z',
  requiresApproval: true,
  approvalType: 'MANAGER',
  employeeVisible: true,
  managerVisible: true,
  internalOnly: false,
  status: 'IN_PROGRESS',
};

const EXPECTED_WORKFLOW_KEYS = [
  'lifecycle_type',
  'status',
  'tasks',
] as const satisfies readonly (keyof AiSafeLifecycleWorkflowProjection)[];

describe('HR-8B AI-safe lifecycle projection', () => {
  it('returns only the closed workflow/task allowlist', () => {
    const projection = projectLifecycleForAi(WORKFLOW, [TASK]);

    expect(Object.keys(projection).sort()).toEqual([...EXPECTED_WORKFLOW_KEYS].sort());
    expect(projection).toEqual({
      lifecycle_type: 'onboarding',
      status: 'ACTIVE',
      tasks: [{
        title: 'Complete induction',
        status: 'IN_PROGRESS',
      }],
    });
    expect(Object.keys(projection.tasks[0]).sort()).toEqual(['status', 'title']);
  });

  it('does not leak workflow or task identifiers, authored description, assignment or exact dates', () => {
    const serialized = JSON.stringify(projectLifecycleForAi(WORKFLOW, [TASK]));

    for (const forbidden of [
      WORKFLOW.id,
      WORKFLOW.organisationId,
      WORKFLOW.personId,
      WORKFLOW.templateId,
      WORKFLOW.startedBy,
      String(WORKFLOW.anchorDate),
      String(WORKFLOW.startedAt),
      TASK.id,
      TASK.workflowId,
      TASK.personId,
      TASK.templateId,
      TASK.templateTaskId,
      TASK.description!,
      TASK.assignedUserId!,
      String(TASK.dueAt),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('does not expose responsibility, approval or visibility metadata', () => {
    const serialized = JSON.stringify(projectLifecycleForAi(WORKFLOW, [TASK]));

    for (const forbidden of [
      TASK.responsibilityType,
      TASK.approvalType,
      'employeeVisible',
      'managerVisible',
      'internalOnly',
      'requiresApproval',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('preserves only the already-visible task set supplied by the caller', () => {
    const secondVisibleTask: LifecycleTaskRow = {
      ...TASK,
      id: 'task-two-secret-id',
      title: 'Collect equipment',
      status: 'NOT_STARTED',
    };

    expect(projectLifecycleForAi(WORKFLOW, [TASK, secondVisibleTask]).tasks).toEqual([
      { title: 'Complete induction', status: 'IN_PROGRESS' },
      { title: 'Collect equipment', status: 'NOT_STARTED' },
    ]);

    expect(projectLifecycleForAi(WORKFLOW, []).tasks).toEqual([]);
  });

  it('fails closed when future workflow or task properties are added', () => {
    const widenedWorkflow = {
      ...WORKFLOW,
      hypothetical_future_sensitive_field: 'workflow-must-never-flow-through',
    } as LifecycleWorkflowRow & { hypothetical_future_sensitive_field: string };
    const widenedTask = {
      ...TASK,
      hypothetical_future_sensitive_field: 'task-must-never-flow-through',
    } as LifecycleTaskRow & { hypothetical_future_sensitive_field: string };

    const serialized = JSON.stringify(projectLifecycleForAi(widenedWorkflow, [widenedTask]));
    expect(serialized).not.toContain('workflow-must-never-flow-through');
    expect(serialized).not.toContain('task-must-never-flow-through');
  });
});
