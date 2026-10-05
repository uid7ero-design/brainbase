import { beforeEach, describe, expect, it, vi } from 'vitest';

type QuerySpec = { text: string; values: unknown[] };
let responses: unknown[] = [];
let callCount = 0;
let calls: QuerySpec[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): QuerySpec => ({
  text: strings.join('?'),
  values,
}));

const transactionMock = vi.fn(async (build: (txn: typeof sqlMock) => QuerySpec[]) => {
  const queries = build(sqlMock);
  const results: unknown[] = [];
  for (const query of queries) {
    calls.push(query);
    results.push(responses[callCount++] ?? []);
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

const {
  startLifecycleWorkflow,
  cancelLifecycleWorkflow,
} = await import('@/lib/hr/lifecycleWorkflowMutations');

const ACTOR = {
  organisationId: 'org-a',
  userId: 'hr-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';

function queue(...items: unknown[]) {
  responses = items;
  callCount = 0;
}

beforeEach(() => {
  responses = [];
  callCount = 0;
  calls = [];
  sqlMock.mockClear();
  transactionMock.mockClear();
});

describe('HR-7C workflow mutations', () => {
  it('starts an exact ACTIVE template and snapshots task definitions atomically', async () => {
    queue(
      [{ locked: null }],
      [{
        allowed: true,
        person_exists: true,
        template_exists: true,
        template_status: 'ACTIVE',
        lifecycle_type: 'onboarding',
        existing_active: false,
        workflow_id: WORKFLOW_ID,
        task_count: 3,
        audit_written: true,
      }],
    );

    const result = await startLifecycleWorkflow({
      actor: ACTOR,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    });

    expect(result).toEqual({ outcome: 'started', workflowId: WORKFLOW_ID });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain('INSERT INTO hr_lifecycle_workflows');
    expect(calls[1].text).toContain('INSERT INTO hr_lifecycle_tasks');
    expect(calls[1].text).toContain("template_scope.status = 'ACTIVE'");
    expect(calls[1].text).toContain("task.responsibility_type = 'EMPLOYEE'");
    expect(calls[1].text).toContain("task.responsibility_type = 'MANAGER'");
    expect(calls[1].text).toContain('person_scope.linked_user_id');
    expect(calls[1].text).toContain('person_scope.manager_linked_user_id');
    expect(calls[1].text).toContain("AT TIME ZONE 'UTC'");
    expect(calls[1].text).toContain("'hr_lifecycle_workflow.started'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('allows an unlinked employee by leaving derived EMPLOYEE assignment nullable', async () => {
    queue(
      [{ locked: null }],
      [{
        allowed: true,
        person_exists: true,
        template_exists: true,
        template_status: 'ACTIVE',
        lifecycle_type: 'onboarding',
        existing_active: false,
        workflow_id: WORKFLOW_ID,
        task_count: 1,
        audit_written: true,
      }],
    );

    await expect(startLifecycleWorkflow({
      actor: ACTOR,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    })).resolves.toEqual({ outcome: 'started', workflowId: WORKFLOW_ID });

    expect(calls[1].text).not.toMatch(/COALESCE\([^)]*linked_user_id/i);
    expect(calls[1].text).not.toMatch(/email|phone|lower\(.*name/i);
  });

  it('rejects DRAFT/RETIRED templates without inserting workflow state', async () => {
    queue(
      [{ locked: null }],
      [{
        allowed: true,
        person_exists: true,
        template_exists: true,
        template_status: 'DRAFT',
        lifecycle_type: 'onboarding',
        existing_active: false,
        workflow_id: null,
        task_count: 0,
        audit_written: false,
      }],
    );

    await expect(startLifecycleWorkflow({
      actor: ACTOR,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    })).resolves.toEqual({ outcome: 'template_not_active' });
  });

  it('maps an existing ACTIVE workflow to deterministic conflict outcome', async () => {
    queue(
      [{ locked: null }],
      [{
        allowed: true,
        person_exists: true,
        template_exists: true,
        template_status: 'ACTIVE',
        lifecycle_type: 'onboarding',
        existing_active: true,
        workflow_id: null,
        task_count: 0,
        audit_written: false,
      }],
    );

    await expect(startLifecycleWorkflow({
      actor: ACTOR,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    })).resolves.toEqual({ outcome: 'workflow_already_active' });
  });

  it('revalidates HR admin authority inside workflow-start transaction', async () => {
    queue(
      [{ locked: null }],
      [{
        allowed: false,
        person_exists: true,
        template_exists: true,
        template_status: 'ACTIVE',
        lifecycle_type: 'onboarding',
        existing_active: false,
        workflow_id: null,
        task_count: 0,
        audit_written: false,
      }],
    );

    await expect(startLifecycleWorkflow({
      actor: ACTOR,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    })).resolves.toEqual({ outcome: 'forbidden' });
    expect(calls[1].text).toContain('FROM hr_administrators a');
  });

  it('cancels workflow plus all nonterminal tasks and audit state in one transaction', async () => {
    queue(
      [{ locked: null }],
      [{
        workflow_exists: true,
        allowed: true,
        previous_status: 'ACTIVE',
        previous_cancelled_at: null,
        workflow_id: WORKFLOW_ID,
        cancelled_at: '2026-09-26T14:00:00.000Z',
        audit_written: true,
      }],
    );

    const result = await cancelLifecycleWorkflow({
      actor: ACTOR,
      workflowId: WORKFLOW_ID,
    });

    expect(result).toEqual({
      outcome: 'cancelled',
      workflowId: WORKFLOW_ID,
      cancelledAt: '2026-09-26T14:00:00.000Z',
    });
    expect(calls[0].text).toContain("'hr-lifecycle-workflow:'");
    expect(calls[1].text).toContain('UPDATE hr_lifecycle_workflows');
    expect(calls[1].text).toContain('UPDATE hr_lifecycle_tasks');
    expect(calls[1].text).toContain("t.status NOT IN ('COMPLETED', 'WAIVED', 'CANCELLED')");
    expect(calls[1].text).toContain("'hr_lifecycle_workflow.cancelled'");
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
  });

  it('keeps already-cancelled cancellation idempotent without a second audit', async () => {
    queue(
      [{ locked: null }],
      [{
        workflow_exists: true,
        allowed: true,
        previous_status: 'CANCELLED',
        previous_cancelled_at: '2026-09-26T14:00:00.000Z',
        workflow_id: null,
        cancelled_at: null,
        audit_written: false,
      }],
    );

    await expect(cancelLifecycleWorkflow({
      actor: ACTOR,
      workflowId: WORKFLOW_ID,
    })).resolves.toEqual({
      outcome: 'already_cancelled',
      workflowId: WORKFLOW_ID,
      cancelledAt: '2026-09-26T14:00:00.000Z',
    });
  });

  it('refuses cancellation of a completed workflow', async () => {
    queue(
      [{ locked: null }],
      [{
        workflow_exists: true,
        allowed: true,
        previous_status: 'COMPLETED',
        previous_cancelled_at: null,
        workflow_id: null,
        cancelled_at: null,
        audit_written: false,
      }],
    );

    await expect(cancelLifecycleWorkflow({
      actor: ACTOR,
      workflowId: WORKFLOW_ID,
    })).resolves.toEqual({ outcome: 'already_completed' });
  });

  it('fails closed when the cancellation audit is not transactionally written', async () => {
    queue(
      [{ locked: null }],
      [{
        workflow_exists: true,
        allowed: true,
        previous_status: 'ACTIVE',
        previous_cancelled_at: null,
        workflow_id: WORKFLOW_ID,
        cancelled_at: '2026-09-26T14:00:00.000Z',
        audit_written: false,
      }],
    );

    await expect(cancelLifecycleWorkflow({
      actor: ACTOR,
      workflowId: WORKFLOW_ID,
    })).rejects.toThrow(/audit state/i);
  });
});
