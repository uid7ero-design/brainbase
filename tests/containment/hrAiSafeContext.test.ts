import { describe, expect, it } from 'vitest';
import { composeAiSafeHrContext } from '@/lib/hr/aiSafeContext';
import type { AiSafeHrPersonProjection } from '@/lib/hr/aiSafePersonProjection';
import type { AiSafeLifecycleWorkflowProjection } from '@/lib/hr/aiSafeLifecycleProjection';

const PERSON: AiSafeHrPersonProjection = {
  display_name: 'Lex',
  job_title: 'Operations Coordinator',
  worker_type: 'employee',
  employment_status: 'active',
  team_name: 'Operations',
  manager_name: 'Morgan',
};

const LIFECYCLE: AiSafeLifecycleWorkflowProjection = {
  lifecycle_type: 'onboarding',
  status: 'ACTIVE',
  tasks: [
    { title: 'Complete induction', status: 'IN_PROGRESS' },
    { title: 'Collect equipment', status: 'NOT_STARTED' },
  ],
};

describe('HR-8C AI-safe HR context envelope', () => {
  it('composes only the reviewed person and lifecycle projections', () => {
    expect(composeAiSafeHrContext({
      person: PERSON,
      lifecycles: [LIFECYCLE],
    })).toEqual({
      person: PERSON,
      lifecycles: [LIFECYCLE],
    });
  });

  it('re-materialises person data so runtime-only extra properties cannot flow through', () => {
    const widenedPerson = {
      ...PERSON,
      person_id: 'person-secret-id',
      work_email: 'secret@example.com',
      hypothetical_future_sensitive_field: 'must-never-flow-through',
    } as AiSafeHrPersonProjection & {
      person_id: string;
      work_email: string;
      hypothetical_future_sensitive_field: string;
    };

    const serialized = JSON.stringify(composeAiSafeHrContext({
      person: widenedPerson,
      lifecycles: [],
    }));

    expect(serialized).not.toContain('person-secret-id');
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).not.toContain('must-never-flow-through');
  });

  it('re-materialises workflow and task data so nested runtime extras cannot flow through', () => {
    const widenedTask = {
      ...LIFECYCLE.tasks[0],
      task_id: 'task-secret-id',
      description: 'sensitive authored detail',
    };
    const widenedLifecycle = {
      ...LIFECYCLE,
      workflow_id: 'workflow-secret-id',
      started_by: 'starter-secret-id',
      tasks: [widenedTask],
    } as AiSafeLifecycleWorkflowProjection & {
      workflow_id: string;
      started_by: string;
      tasks: Array<typeof widenedTask>;
    };

    const serialized = JSON.stringify(composeAiSafeHrContext({
      person: PERSON,
      lifecycles: [widenedLifecycle],
    }));

    expect(serialized).not.toContain('workflow-secret-id');
    expect(serialized).not.toContain('starter-secret-id');
    expect(serialized).not.toContain('task-secret-id');
    expect(serialized).not.toContain('sensitive authored detail');
  });

  it('returns fresh nested objects and arrays rather than retaining caller references', () => {
    const lifecycles = [LIFECYCLE];
    const context = composeAiSafeHrContext({
      person: PERSON,
      lifecycles,
    });

    expect(context.person).not.toBe(PERSON);
    expect(context.lifecycles).not.toBe(lifecycles);
    expect(context.lifecycles[0]).not.toBe(LIFECYCLE);
    expect(context.lifecycles[0].tasks).not.toBe(LIFECYCLE.tasks);
    expect(context.lifecycles[0].tasks[0]).not.toBe(LIFECYCLE.tasks[0]);
  });

  it('does not invent lifecycle data when none was supplied', () => {
    expect(composeAiSafeHrContext({
      person: PERSON,
      lifecycles: [],
    }).lifecycles).toEqual([]);
  });
});
