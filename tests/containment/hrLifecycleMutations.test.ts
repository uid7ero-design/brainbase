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
  it('takes the workflow advisory lock before the mutation statement and revalidates live authority inside that statement', async () => {
    queue([completedRow()]);

    await completeLifecycleTask({ actor: ACTOR, taskId: TASK_ID });

    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[0].text).toContain("'hr-lifecycle-workflow:' || t.workflow_id::text");
    expect(calls[0].values).toEqual([TASK_ID, 'org-a']);

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
      expect(lockQuery.values).toEqual([TASK_ID, 'org-a']);

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


describe('startLifecycleTask', () => {
  it('starts only an authorized NOT_STARTED task and audits atomically', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      workflow_status: 'ACTIVE',
      previous_status: 'NOT_STARTED',
      task_id: TASK_ID,
      task_status: 'IN_PROGRESS',
      audit_written: true,
    }]);

    const { startLifecycleTask } = await import('@/lib/hr/lifecycleMutations');
    const result = await startLifecycleTask({ actor: ACTOR, taskId: TASK_ID });

    expect(result).toEqual({
      outcome: 'started',
      task: { id: TASK_ID, status: 'IN_PROGRESS' },
    });
    expect(calls[1].text).toContain('UPDATE hr_lifecycle_tasks');
    expect(calls[1].text).toContain("'hr_lifecycle_task.started'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });
});

describe('waiveLifecycleTask', () => {
  it('waives under HR-admin authority and writes task/workflow audits transactionally', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      workflow_status: 'ACTIVE',
      previous_status: 'IN_PROGRESS',
      task_id: TASK_ID,
      waived_by: 'admin-user',
      waived_at: '2026-09-26T12:00:00.000Z',
      waiver_reason: 'Requirement removed',
      workflow_id: WORKFLOW_ID,
      resulting_workflow_status: 'ACTIVE',
      workflow_completed_at: null,
      task_audit_written: true,
      workflow_audit_written: false,
    }]);

    const { waiveLifecycleTask } = await import('@/lib/hr/lifecycleMutations');
    const result = await waiveLifecycleTask({
      actor: ACTOR,
      taskId: TASK_ID,
      reason: 'Requirement removed',
    });

    expect(result).toEqual({
      outcome: 'waived',
      task: {
        id: TASK_ID,
        status: 'WAIVED',
        waivedBy: 'admin-user',
        waivedAt: '2026-09-26T12:00:00.000Z',
        waiverReason: 'Requirement removed',
      },
      workflow: {
        id: WORKFLOW_ID,
        status: 'ACTIVE',
        completedAt: null,
      },
    });
    expect(calls[1].text).toContain("'hr_lifecycle_task.waived'");
    expect(calls[1].text).toContain("task_scope.previous_status IN ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL')");
  });
});

describe('recordLifecycleTaskApproval', () => {
  it('records approval append-only, revalidates current manager, updates the task, and audits in one statement', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      requires_approval: true,
      previous_status: 'AWAITING_APPROVAL',
      workflow_status: 'ACTIVE',
      approval_id: '66666666-6666-4666-8666-666666666666',
      task_id: TASK_ID,
      workflow_id: WORKFLOW_ID,
      person_id: '11111111-1111-4111-8111-111111111111',
      approver_user_id: 'employee-user',
      decision: 'APPROVED',
      comment: 'Ready',
      decided_at: '2026-09-26T12:30:00.000Z',
      task_status: 'COMPLETED',
      task_completed_at: '2026-09-26T12:30:00.000Z',
      resulting_workflow_status: 'ACTIVE',
      workflow_completed_at: null,
      approval_audit_written: true,
      task_audit_written: true,
      workflow_audit_written: false,
    }]);

    const { recordLifecycleTaskApproval } = await import('@/lib/hr/lifecycleMutations');
    const result = await recordLifecycleTaskApproval({
      actor: ACTOR,
      taskId: TASK_ID,
      decision: 'APPROVED',
      comment: 'Ready',
    });

    expect(result.outcome).toBe('recorded');
    expect(calls[1].text).toContain('INSERT INTO hr_lifecycle_task_approvals');
    expect(calls[1].text).toContain('manager.id = p.manager_person_id');
    expect(calls[1].text).toContain("task_scope.approval_type = 'MANAGER'");
    expect(calls[1].text).toContain("task_scope.approval_type = 'HR_ADMIN'");
    expect(calls[1].text).toContain("'hr_lifecycle_task_approval.recorded'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('keeps approval mutation deny-by-default before approval-not-required classification', async () => {
    queue([{
      task_exists: true,
      authorized: false,
      requires_approval: false,
      previous_status: 'IN_PROGRESS',
      workflow_status: 'ACTIVE',
      approval_id: null,
      task_id: null,
      workflow_id: null,
      person_id: null,
      approver_user_id: null,
      decision: null,
      comment: null,
      decided_at: null,
      task_status: null,
      task_completed_at: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      approval_audit_written: false,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    const { recordLifecycleTaskApproval } = await import('@/lib/hr/lifecycleMutations');
    await expect(recordLifecycleTaskApproval({
      actor: ACTOR,
      taskId: TASK_ID,
      decision: 'APPROVED',
      comment: null,
    })).resolves.toEqual({ outcome: 'forbidden' });
  });

  it('rejects stale approval state without appending another approval row', async () => {
    queue([{
      task_exists: true,
      authorized: true,
      requires_approval: true,
      previous_status: 'COMPLETED',
      workflow_status: 'ACTIVE',
      approval_id: null,
      task_id: null,
      workflow_id: null,
      person_id: null,
      approver_user_id: null,
      decision: null,
      comment: null,
      decided_at: null,
      task_status: null,
      task_completed_at: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      approval_audit_written: false,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    const { recordLifecycleTaskApproval } = await import('@/lib/hr/lifecycleMutations');
    await expect(recordLifecycleTaskApproval({
      actor: ACTOR,
      taskId: TASK_ID,
      decision: 'APPROVED',
      comment: null,
    })).resolves.toEqual({ outcome: 'approval_no_longer_applicable' });
  });
});


describe('approval serialization and live manager revalidation', () => {
  it('allows exactly one concurrent approval to append and makes the loser no_longer_applicable', async () => {
    const { recordLifecycleTaskApproval } = await import('@/lib/hr/lifecycleMutations');
    let status: 'AWAITING_APPROVAL' | 'COMPLETED' = 'AWAITING_APPROVAL';
    let approvalRows = 0;
    let approvalAudits = 0;
    let taskAudits = 0;
    let tail = Promise.resolve();

    transactionMock.mockImplementation((build: (txn: typeof sqlMock) => QuerySpec[]) => {
      const queries = build(sqlMock);
      const [lockQuery, mutationQuery] = queries;
      expect(lockQuery.text).toContain('pg_advisory_xact_lock');
      expect(lockQuery.values).toEqual([TASK_ID, 'org-a']);

      const run = tail.then(async () => {
        calls.push(lockQuery, mutationQuery);

        if (status !== 'AWAITING_APPROVAL') {
          return [
            [{ locked: null }],
            [{
              task_exists: true,
              authorized: true,
              requires_approval: true,
              previous_status: status,
              workflow_status: 'ACTIVE',
              approval_id: null,
              task_id: null,
              workflow_id: null,
              person_id: null,
              approver_user_id: null,
              decision: null,
              comment: null,
              decided_at: null,
              task_status: null,
              task_completed_at: null,
              resulting_workflow_status: null,
              workflow_completed_at: null,
              approval_audit_written: false,
              task_audit_written: false,
              workflow_audit_written: false,
            }],
          ];
        }

        status = 'COMPLETED';
        approvalRows += 1;
        approvalAudits += 1;
        taskAudits += 1;
        return [
          [{ locked: null }],
          [{
            task_exists: true,
            authorized: true,
            requires_approval: true,
            previous_status: 'AWAITING_APPROVAL',
            workflow_status: 'ACTIVE',
            approval_id: '66666666-6666-4666-8666-666666666666',
            task_id: TASK_ID,
            workflow_id: WORKFLOW_ID,
            person_id: '11111111-1111-4111-8111-111111111111',
            approver_user_id: ACTOR.userId,
            decision: 'APPROVED',
            comment: null,
            decided_at: '2026-09-26T12:45:00.000Z',
            task_status: 'COMPLETED',
            task_completed_at: '2026-09-26T12:45:00.000Z',
            resulting_workflow_status: 'ACTIVE',
            workflow_completed_at: null,
            approval_audit_written: true,
            task_audit_written: true,
            workflow_audit_written: false,
          }],
        ];
      });

      tail = run.then(() => undefined, () => undefined);
      return run;
    });

    const [a, b] = await Promise.all([
      recordLifecycleTaskApproval({
        actor: ACTOR,
        taskId: TASK_ID,
        decision: 'APPROVED',
        comment: null,
      }),
      recordLifecycleTaskApproval({
        actor: ACTOR,
        taskId: TASK_ID,
        decision: 'APPROVED',
        comment: null,
      }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'approval_no_longer_applicable',
      'recorded',
    ]);
    expect(approvalRows).toBe(1);
    expect(approvalAudits).toBe(1);
    expect(taskAudits).toBe(1);
  });

  it('denies a former manager when current-manager authority changed before the mutation lock is acquired', async () => {
    const { recordLifecycleTaskApproval } = await import('@/lib/hr/lifecycleMutations');
    queue([{
      task_exists: true,
      authorized: false,
      requires_approval: true,
      previous_status: 'AWAITING_APPROVAL',
      workflow_status: 'ACTIVE',
      approval_id: null,
      task_id: null,
      workflow_id: null,
      person_id: null,
      approver_user_id: null,
      decision: null,
      comment: null,
      decided_at: null,
      task_status: null,
      task_completed_at: null,
      resulting_workflow_status: null,
      workflow_completed_at: null,
      approval_audit_written: false,
      task_audit_written: false,
      workflow_audit_written: false,
    }]);

    await expect(recordLifecycleTaskApproval({
      actor: ACTOR,
      taskId: TASK_ID,
      decision: 'APPROVED',
      comment: null,
    })).resolves.toEqual({ outcome: 'forbidden' });

    expect(calls[1].text).toContain('manager.id = p.manager_person_id');
    expect(calls[1].text).toContain('current_manager_linked_user_id');
  });
});
