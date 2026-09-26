import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };

let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (
  build: (txn: typeof sqlMock) => QuerySpec[],
) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    const response = responses[callCount++];
    if (response instanceof Error) throw response;
    results.push(response ?? []);
  }
  return results;
});

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: [TemplateStringsArray, ...unknown[]]) => sqlMock(...args),
    {
      transaction: (...args: unknown[]) =>
        transactionMock(...(args as [(txn: typeof sqlMock) => QuerySpec[]])),
    },
  ),
}));

const { completeLifecycleTask } = await import('@/lib/hr/lifecycleMutations');

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';

const ACTOR = {
  organisationId: 'org-a',
  userId: 'employee-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

function queue(...next: unknown[]) {
  responses = [[{ locked: null }], ...next];
  callCount = 0;
}

function completedRow(options?: { completesWorkflow?: boolean }) {
  return {
    task_exists: true,
    authorized: true,
    workflow_status: 'ACTIVE',
    previous_status: 'IN_PROGRESS',
    task_id: TASK_ID,
    task_status: 'COMPLETED',
    completed_by: 'employee-user',
    completed_at: '2026-09-26T09:15:00.000Z',
    workflow_id: WORKFLOW_ID,
    resulting_workflow_status: options?.completesWorkflow ? 'COMPLETED' : 'ACTIVE',
    workflow_completed_at: options?.completesWorkflow
      ? '2026-09-26T09:15:00.000Z'
      : null,
    task_audit_written: true,
    workflow_audit_written: options?.completesWorkflow ?? false,
  };
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
  transactionMock.mockImplementation(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
    const queries = build(sqlMock);
    const results: unknown[] = [];
    for (const query of queries) {
      calls.push(query);
      const response = responses[callCount++];
      if (response instanceof Error) throw response;
      results.push(response ?? []);
    }
    return results;
  });
});

describe('completeLifecycleTask', () => {
  it('takes the task advisory lock before the mutation statement and revalidates live authority inside that statement', async () => {
    queue([completedRow()]);

    await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID });

    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[0].text).toContain('hashtextextended');
    expect(calls[0].values).toEqual([`hr-lifecycle-task:${TASK_ID}`]);

    const query = calls[1].text;
    expect(query).toContain('WITH task_scope AS MATERIALIZED');
    expect(query).toContain('FROM hr_lifecycle_tasks t');
    expect(query).toContain('JOIN hr_lifecycle_workflows w');
    expect(query).toContain('p.linked_user_id AS person_linked_user_id');
    expect(query).toContain('manager.id = p.manager_person_id');
    expect(query).toContain('manager.linked_user_id AS current_manager_linked_user_id');
    expect(query).toContain('FROM hr_administrators a');
    expect(query).toContain('t.organisation_id = ?');
    expect(query).toContain("task_scope.responsibility_type = 'EMPLOYEE'");
    expect(query).toContain("task_scope.responsibility_type = 'MANAGER'");
    expect(calls[1].values).toContain('org-a');
    expect(calls[1].values).toContain('employee-user');
  });

  it('writes task completion and its audit atomically in the writable-CTE statement', async () => {
    queue([completedRow()]);

    const result = await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID });

    expect(result).toEqual({
      outcome: 'completed',
      task: {
        id: TASK_ID,
        status: 'COMPLETED',
        completedBy: 'employee-user',
        completedAt: '2026-09-26T09:15:00.000Z',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completedAt: null,
      },
    });

    const query = calls[1].text;
    expect(query).toContain('updated_task AS (');
    expect(query).toContain('UPDATE hr_lifecycle_tasks');
    expect(query).toContain("ELSE 'COMPLETED'");
    expect(query).toContain('task_audited AS (');
    expect(query).toContain('INSERT INTO audit_logs');
    expect(query).toContain("'hr_lifecycle_task.completed'");
    expect(query).toContain("'hr_lifecycle_task.submitted_for_approval'");
    expect(query).toContain('workflow_completed AS (');
    expect(query).toContain('UPDATE hr_lifecycle_workflows');
    expect(query).toContain("other_task.status NOT IN ('COMPLETED', 'WAIVED')");
  });

  it('returns awaiting_approval without completed fields when approval is required', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      workflow_status: 'ACTIVE',
      previous_status: 'IN_PROGRESS',
      task_id: TASK_ID,
      task_status: 'AWAITING_APPROVAL',
      completed_by: null,
      completed_at: null,
      workflow_id: WORKFLOW_ID,
      resulting_workflow_status: 'ACTIVE',
      workflow_completed_at: null,
      task_audit_written: true,
      workflow_audit_written: false,
    }]);

    const result = await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID });

    expect(result).toEqual({
      outcome: 'awaiting_approval',
      task: {
        id: TASK_ID,
        status: 'AWAITING_APPROVAL',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completedAt: null,
      },
    });
  });

  it('returns already_completed after a serialized loser observes the winner state', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      workflow_status: 'ACTIVE',
      previous_status: 'COMPLETED',
      task_id: null,
      task_status: null,
      completed_by: null,
      completed_at: null,
      workflow_id: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    expect(await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }))
      .toEqual({ outcome: 'already_completed' });
  });

  it('fails closed if an updated task does not report its transaction-local audit write', async () => {
    queue([{
      ...completedRow(),
      task_audit_written: false,
    }]);

    await expect(
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
    ).rejects.toThrow('completion audit was not written');
  });

  it('requires a workflow completion audit when the last task completes the workflow', async () => {
    queue([{
      ...completedRow({ completesWorkflow: true }),
      workflow_audit_written: false,
    }]);

    await expect(
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
    ).rejects.toThrow('workflow completion audit was not written');
  });

  it('returns task_not_found for missing or cross-org task state at the write boundary', async () => {
    queue([{
      task_exists: false,
      authorized: false,
      workflow_status: null,
      previous_status: null,
      task_id: null,
      task_status: null,
      completed_by: null,
      completed_at: null,
      workflow_id: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    expect(await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }))
      .toEqual({ outcome: 'task_not_found' });
  });

  it('returns forbidden when live current-relationship authorization no longer succeeds', async () => {
    queue([{
      task_exists: true,
      authorized: false,
      workflow_status: 'ACTIVE',
      previous_status: 'IN_PROGRESS',
      task_id: null,
      task_status: null,
      completed_by: null,
      completed_at: null,
      workflow_id: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    expect(await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }))
      .toEqual({ outcome: 'forbidden' });
  });
});

describe('double-completion serialization', () => {
  function installSerializedTaskState(options?: { finalTask?: boolean }) {
    let status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS';
    let taskAuditCount = 0;
    let workflowAuditCount = 0;
    let tail = Promise.resolve();

    transactionMock.mockImplementation((build: (txn: typeof sqlMock) => QuerySpec[]) => {
      const queries = build(sqlMock);
      expect(queries).toHaveLength(2);
      const [lockQuery, mutationQuery] = queries;

      expect(lockQuery.text).toContain('pg_advisory_xact_lock');
      expect(lockQuery.values).toEqual([`hr-lifecycle-task:${TASK_ID}`]);

      const run = tail.then(async () => {
        calls.push(lockQuery, mutationQuery);

        if (status === 'COMPLETED') {
          return [
            [{ locked: null }],
            [{
              task_exists: true,
              authorized: true,
              workflow_status: 'ACTIVE',
              previous_status: 'COMPLETED',
              task_id: null,
              task_status: null,
              completed_by: null,
              completed_at: null,
              workflow_id: null,
              resulting_workflow_status: null,
              workflow_completed_at: null,
              task_audit_written: false,
              workflow_audit_written: false,
            }],
          ];
        }

        status = 'COMPLETED';
        taskAuditCount += 1;
        if (options?.finalTask) workflowAuditCount += 1;

        return [
          [{ locked: null }],
          [completedRow({ completesWorkflow: options?.finalTask })],
        ];
      });

      tail = run.then(() => undefined, () => undefined);
      return run;
    });

    return {
      status: () => status,
      taskAuditCount: () => taskAuditCount,
      workflowAuditCount: () => workflowAuditCount,
    };
  }

  it('allows one winner and one already_completed loser with one task audit side effect', async () => {
    const state = installSerializedTaskState();

    const [a, b] = await Promise.all([
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'already_completed',
      'completed',
    ]);
    expect(state.status()).toBe('COMPLETED');
    expect(state.taskAuditCount()).toBe(1);
    expect(state.workflowAuditCount()).toBe(0);
  });

  it('allows only one workflow-completion side effect when both requests race on the final task', async () => {
    const state = installSerializedTaskState({ finalTask: true });

    const [a, b] = await Promise.all([
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
      completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'already_completed',
      'completed',
    ]);

    const winner = [a, b].find(result => result.outcome === 'completed');
    expect(winner).toEqual(expect.objectContaining({
      outcome: 'completed',
      workflow: expect.objectContaining({
        status: 'COMPLETED',
      }),
    }));

    expect(state.taskAuditCount()).toBe(1);
    expect(state.workflowAuditCount()).toBe(1);
  });
});
