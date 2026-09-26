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
  activateLifecycleTemplate,
  createLifecycleTemplate,
  createLifecycleTemplateVersion,
  retireLifecycleTemplate,
} = await import('@/lib/hr/lifecycleTemplateMutations');

const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR = {
  organisationId: 'org-a',
  userId: 'hr-user',
  isSuperAdmin: false,
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
};

const INPUT = {
  templateKey: 'standard-onboarding',
  lifecycleType: 'onboarding' as const,
  name: 'Standard onboarding',
  description: null,
  tasks: [{
    sequence: 1,
    title: 'Complete profile',
    description: null,
    responsibilityType: 'EMPLOYEE' as const,
    dueOffsetDays: -7,
    requiresApproval: false,
    approvalType: 'NONE' as const,
    employeeVisible: true,
    managerVisible: false,
    internalOnly: false,
  }],
};

function queue(...next: unknown[]) {
  responses = [[{ locked: null }], ...next];
  callCount = 0;
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
      results.push(responses[callCount++] ?? []);
    }
    return results;
  });
});

describe('lifecycle template transactional mutations', () => {
  it('creates template + task definitions + audit in one transaction after a family lock', async () => {
    queue([{
      allowed: true,
      family_exists: false,
      template_id: TEMPLATE_ID,
      version_number: 1,
      task_count: 1,
      audit_written: true,
    }]);

    const result = await createLifecycleTemplate({ actor: ACTOR, input: INPUT });

    expect(result).toEqual({
      outcome: 'created',
      templateId: TEMPLATE_ID,
      versionNumber: 1,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[0].values).toEqual([
      'hr-lifecycle-template-family:org-a:standard-onboarding',
    ]);
    expect(calls[1].text).toContain('INSERT INTO hr_lifecycle_templates');
    expect(calls[1].text).toContain('INSERT INTO hr_lifecycle_template_tasks');
    expect(calls[1].text).toContain('INSERT INTO audit_logs');
    expect(calls[1].text).toContain("'hr_lifecycle_template.created'");
    expect(calls[1].text).toContain('FROM hr_administrators');
  });

  it('denies create when the write-boundary HR-admin grant is absent', async () => {
    queue([{
      allowed: false,
      family_exists: false,
      template_id: null,
      version_number: null,
      task_count: 0,
      audit_written: false,
    }]);

    await expect(createLifecycleTemplate({ actor: ACTOR, input: INPUT }))
      .resolves.toEqual({ outcome: 'forbidden' });
  });

  it('maps an existing family after the lock to family_exists', async () => {
    queue([{
      allowed: true,
      family_exists: true,
      template_id: null,
      version_number: null,
      task_count: 0,
      audit_written: false,
    }]);

    await expect(createLifecycleTemplate({ actor: ACTOR, input: INPUT }))
      .resolves.toEqual({ outcome: 'family_exists' });
  });

  it('creates the next version from server-resolved family identity', async () => {
    queue([{
      allowed: true,
      source_exists: true,
      template_id: TEMPLATE_ID,
      version_number: 2,
      task_count: 1,
      audit_written: true,
    }]);

    const versionInput = {
      name: INPUT.name,
      description: INPUT.description,
      tasks: INPUT.tasks,
    };
    const result = await createLifecycleTemplateVersion({
      actor: ACTOR,
      sourceTemplateId: TEMPLATE_ID,
      input: versionInput,
    });

    expect(result).toEqual({
      outcome: 'created',
      templateId: TEMPLATE_ID,
      versionNumber: 2,
    });
    expect(calls[0].text).toContain("'hr-lifecycle-template-family:' || t.organisation_id || ':' || t.template_key");
    expect(calls[1].text).toContain('max(t.version_number)');
    expect(calls[1].text).toContain("'hr_lifecycle_template.versioned'");
  });

  it('returns canonical template_not_found outcome when version source disappears', async () => {
    queue([{
      allowed: true,
      source_exists: false,
      template_id: null,
      version_number: null,
      task_count: 0,
      audit_written: false,
    }]);

    const versionInput = {
      name: INPUT.name,
      description: INPUT.description,
      tasks: INPUT.tasks,
    };
    await expect(createLifecycleTemplateVersion({
      actor: ACTOR,
      sourceTemplateId: TEMPLATE_ID,
      input: versionInput,
    })).resolves.toEqual({ outcome: 'template_not_found' });
  });

  it('serializes activation by family and reports a competing active version', async () => {
    queue([{
      allowed: true,
      target_exists: true,
      previous_status: 'DRAFT',
      other_active_exists: true,
      template_id: null,
      audit_written: false,
    }]);

    await expect(activateLifecycleTemplate({
      actor: ACTOR,
      templateId: TEMPLATE_ID,
    })).resolves.toEqual({ outcome: 'active_version_exists' });

    expect(calls[0].text).toContain('pg_advisory_xact_lock');
    expect(calls[1].text).toContain("target.status = 'DRAFT'");
  });

  it('treats already-active activation as idempotent without another audit', async () => {
    queue([{
      allowed: true,
      target_exists: true,
      previous_status: 'ACTIVE',
      other_active_exists: false,
      template_id: null,
      audit_written: false,
    }]);

    await expect(activateLifecycleTemplate({
      actor: ACTOR,
      templateId: TEMPLATE_ID,
    })).resolves.toEqual({
      outcome: 'already_active',
      templateId: TEMPLATE_ID,
    });
  });

  it('retires DRAFT or ACTIVE and keeps already-retired requests idempotent', async () => {
    queue([{
      allowed: true,
      target_exists: true,
      previous_status: 'RETIRED',
      template_id: null,
      audit_written: false,
    }]);

    await expect(retireLifecycleTemplate({
      actor: ACTOR,
      templateId: TEMPLATE_ID,
    })).resolves.toEqual({
      outcome: 'already_retired',
      templateId: TEMPLATE_ID,
    });

    expect(calls[1].text).toContain("target.status IN ('DRAFT', 'ACTIVE')");
    expect(calls[1].text).toContain("'hr_lifecycle_template.retired'");
  });
});
