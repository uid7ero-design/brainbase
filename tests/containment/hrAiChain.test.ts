import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { HrAccessContext } from '@/lib/hr/access';
import { CapabilityAccessError } from '@/lib/capabilities/requireCapability';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), sql: vi.fn(), capability: vi.fn(), access: vi.fn(),
  workflows: vi.fn(), tasks: vi.fn(), provider: vi.fn(),
}));
vi.mock('@/lib/org', () => ({ requireSession: mocks.session }));
vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/hr/capability', () => ({ requireHrCapability: mocks.capability }));
vi.mock('@/lib/hr/context', () => ({ resolveHrAccessContext: mocks.access }));
vi.mock('@/lib/hr/lifecycleWorkflowQueries', () => ({
  listLifecycleWorkflows: mocks.workflows,
  getVisibleLifecycleTasksForWorkflow: mocks.tasks,
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: mocks.provider }; },
}));

// Route, loader, access predicate, projections, input builder and provider
// adapter are real. Only session/DB-backed reads and the external SDK are fake.
const { POST } = await import('@/app/api/hr/ai/route');
const { resetRateLimit } = await import('@/lib/rateLimit');
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION = { userId: 'user-secret', organisationId: 'org-secret', homeOrganisationId: 'org-secret', role: 'manager', name: 'Viewer' };
const PERSON = {
  id: PERSON_ID, organisation_id: 'org-secret', linked_user_id: 'linked-secret',
  first_name: 'Alex', last_name: 'Surname-secret', preferred_name: 'Lex',
  work_email: 'contact-secret@example.test', work_phone: 'phone-secret',
  job_title: 'Operator', worker_type: 'employee', employment_status: 'active',
  team_id: 'team-secret', manager_person_id: MANAGER_ID,
  start_date: '2026-01-02', end_date: null, created_at: 'created-secret', updated_at: 'updated-secret',
  team_name: 'Operations', manager_first_name: 'Morgan', manager_last_name: 'manager-surname-secret',
  restricted_cases: 'restricted-secret', documents: 'document-secret', audit: 'audit-secret',
};
const WORKFLOW = {
  id: 'workflow-secret', organisationId: 'org-secret', personId: PERSON_ID,
  templateId: 'template-secret', lifecycleType: 'onboarding', status: 'ACTIVE',
  anchorDate: '2026-01-02', startedBy: 'starter-secret', startedAt: 'started-secret', completedAt: null, cancelledAt: null,
};
const TASK = {
  id: 'task-secret', organisationId: 'org-secret', workflowId: 'workflow-secret',
  personId: PERSON_ID, templateId: 'template-secret', templateTaskId: 'template-task-secret',
  sequence: 1, title: 'Complete induction', description: 'description-secret',
  responsibilityType: 'EMPLOYEE', assignedUserId: 'assigned-secret', dueAt: '2026-01-02',
  requiresApproval: true, approvalType: 'MANAGER', employeeVisible: true, managerVisible: true,
  internalOnly: false, status: 'IN_PROGRESS', future_sensitive_field: 'future-secret',
};
const context = (overrides: Partial<HrAccessContext> = {}): HrAccessContext => ({
  organisationId: 'org-secret', selfPersonId: MANAGER_ID,
  isHrAdministrator: false, hasRestrictedHrAccess: false, ...overrides,
});
const request = () => new Request('http://localhost/api/hr/ai', {
  method: 'POST', body: JSON.stringify({ person_id: PERSON_ID, question: 'What is outstanding?' }),
}) as NextRequest;

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  resetRateLimit(`hr-ai:${JSON.stringify([SESSION.organisationId, SESSION.userId])}`);
  mocks.session.mockResolvedValue(SESSION);
  mocks.sql.mockResolvedValue([PERSON]);
  mocks.capability.mockResolvedValue({ key: 'people', config: {} });
  mocks.access.mockResolvedValue(context());
  mocks.workflows.mockResolvedValue([WORKFLOW]);
  mocks.tasks.mockResolvedValue([TASK]);
  mocks.provider.mockResolvedValue({ content: [{ type: 'text', text: 'Induction is in progress.' }], id: 'provider-secret', usage: { input_tokens: 42 } });
});

describe('HR-8I composed read-only HR AI chain', () => {
  it.each([
    ['linked employee', context({ selfPersonId: PERSON_ID })],
    ['current direct manager', context()],
    ['explicit HR administrator', context({ selfPersonId: null, isHrAdministrator: true })],
  ])('authorizes %s and sends only the closed safe envelope to the actual adapter', async (_, access) => {
    mocks.access.mockResolvedValue(access);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Induction is in progress.' });
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    const payload = mocks.provider.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect(JSON.parse(payload.messages[0].content)).toEqual({
      question: 'What is outstanding?', hr_context: {
        person: { display_name: 'Lex', job_title: 'Operator', worker_type: 'employee', employment_status: 'active', team_name: 'Operations', manager_name: 'Morgan' },
        lifecycles: [{ lifecycle_type: 'onboarding', status: 'ACTIVE', tasks: [{ title: 'Complete induction', status: 'IN_PROGRESS' }] }],
      },
    });
    const bytes = JSON.stringify(payload);
    expect(bytes).not.toContain('secret');
    expect(bytes).not.toContain(PERSON_ID);
    expect(bytes).not.toContain(MANAGER_ID);
    expect(bytes).not.toContain('2026-01-02');
    const [strings, ...values] = mocks.sql.mock.calls[0];
    expect(strings.join('?')).toContain('p.organisation_id = ?');
    expect(values).toContain(SESSION.organisationId);
    expect(values).toContain(PERSON_ID);
    expect(mocks.workflows).toHaveBeenCalledWith(SESSION, { personId: PERSON_ID });
    expect(mocks.tasks).toHaveBeenCalledWith(SESSION, WORKFLOW.id);
  });

  it.each([
    ['unlinked caller', context({ selfPersonId: null })],
    ['stale manager', context({ selfPersonId: 'stale-manager' })],
    ['cross-tenant HR administrator', context({ organisationId: 'other-org', isHrAdministrator: true })],
    ['restricted grant alone', context({ selfPersonId: null, hasRestrictedHrAccess: true })],
  ])('denies %s before lifecycle reads or provider invocation', async (_, access) => {
    mocks.access.mockResolvedValue(access);
    const result = await POST(request());
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: 'HR record not found.' });
    expect(mocks.workflows).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('rejects a disabled capability before any HR row read', async () => {
    mocks.capability.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    expect((await POST(request())).status).toBe(404);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('maps actual adapter failures to generic HTTP errors', async () => {
    mocks.provider.mockRejectedValue(new Error('external-provider-secret'));
    const result = await POST(request());
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'HR assistant is temporarily unavailable.' });
  });

  it('uses the real provider response bound and omits non-text content', async () => {
    mocks.provider.mockResolvedValue({ content: [{ type: 'tool_use', input: 'tool-secret' }, { type: 'text', text: 'x'.repeat(7000) }] });
    const result = await POST(request());
    expect(await result.json()).toEqual({ answer: 'x'.repeat(6000) });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
