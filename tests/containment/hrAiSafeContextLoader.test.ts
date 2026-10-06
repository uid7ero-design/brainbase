import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';
import type { LifecycleTaskRow, LifecycleWorkflowRow } from '@/lib/hr/lifecycleRoute';

type QuerySpec = { text: string; values: unknown[] };
const calls: QuerySpec[] = [];
let rows: unknown[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(rows);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(
    ...(args as [TemplateStringsArray, ...unknown[]]),
  ),
}));

const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));

const resolveHrAccessContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({
  resolveHrAccessContext: (...args: unknown[]) => resolveHrAccessContextMock(...args),
}));

const listLifecycleWorkflowsMock = vi.fn();
const getVisibleLifecycleTasksForWorkflowMock = vi.fn();
vi.mock('@/lib/hr/lifecycleWorkflowQueries', () => ({
  listLifecycleWorkflows: (...args: unknown[]) => listLifecycleWorkflowsMock(...args),
  getVisibleLifecycleTasksForWorkflow: (...args: unknown[]) =>
    getVisibleLifecycleTasksForWorkflowMock(...args),
}));

const { loadAiSafeHrContext } = await import('@/lib/hr/aiSafeContextLoader');

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const SESSION: OrgSession = {
  userId: 'user-1',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'Viewer',
};

function personRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PERSON_ID,
    organisation_id: 'org-a',
    linked_user_id: 'linked-user-secret',
    first_name: 'Alex',
    last_name: 'SensitiveSurname',
    preferred_name: 'Lex',
    work_email: 'alex@example.com',
    work_phone: '+61 400 000 000',
    job_title: 'Operations Coordinator',
    worker_type: 'employee',
    employment_status: 'active',
    team_id: 'team-secret-id',
    manager_person_id: '22222222-2222-4222-8222-222222222222',
    start_date: '2024-01-01',
    end_date: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    team_name: 'Operations',
    manager_first_name: 'Morgan',
    manager_last_name: 'ManagerSurname',
    ...overrides,
  };
}

const WORKFLOW: LifecycleWorkflowRow = {
  id: '33333333-3333-4333-8333-333333333333',
  organisationId: 'org-a',
  personId: PERSON_ID,
  templateId: '44444444-4444-4444-8444-444444444444',
  lifecycleType: 'onboarding',
  status: 'ACTIVE',
  anchorDate: '2026-10-01',
  startedBy: 'starter-secret-id',
  startedAt: '2026-10-01T09:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
};

const TASK: LifecycleTaskRow = {
  id: '55555555-5555-4555-8555-555555555555',
  organisationId: 'org-a',
  workflowId: WORKFLOW.id,
  personId: PERSON_ID,
  templateId: WORKFLOW.templateId,
  templateTaskId: '66666666-6666-4666-8666-666666666666',
  sequence: 1,
  title: 'Complete induction',
  description: 'Sensitive description',
  responsibilityType: 'EMPLOYEE',
  assignedUserId: 'assigned-secret-id',
  dueAt: '2026-10-08T17:00:00.000Z',
  requiresApproval: false,
  approvalType: 'NONE',
  employeeVisible: true,
  managerVisible: true,
  internalOnly: false,
  status: 'IN_PROGRESS',
};

beforeEach(() => {
  rows = [];
  calls.length = 0;
  sqlMock.mockClear();
  requireHrCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  listLifecycleWorkflowsMock.mockReset();
  getVisibleLifecycleTasksForWorkflowMock.mockReset();

  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  resolveHrAccessContextMock.mockResolvedValue({
    organisationId: 'org-a',
    selfPersonId: '22222222-2222-4222-8222-222222222222',
    isHrAdministrator: false,
    hasRestrictedHrAccess: false,
  });
  listLifecycleWorkflowsMock.mockResolvedValue([WORKFLOW]);
  getVisibleLifecycleTasksForWorkflowMock.mockResolvedValue([TASK]);
});

describe('HR-8D authorised AI-safe HR context loader', () => {
  it('enforces People capability before reading HR rows', async () => {
    requireHrCapabilityMock.mockRejectedValue(new Error('Forbidden'));

    await expect(loadAiSafeHrContext({
      session: SESSION,
      personId: PERSON_ID,
    })).rejects.toThrow('Forbidden');

    expect(sqlMock).not.toHaveBeenCalled();
    expect(resolveHrAccessContextMock).not.toHaveBeenCalled();
  });

  it('scopes the person read by active organisation and person UUID', async () => {
    rows = [personRow()];

    await loadAiSafeHrContext({ session: SESSION, personId: PERSON_ID });

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('p.organisation_id = ?');
    expect(calls[0].text).toContain('p.id = ?::uuid');
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain(PERSON_ID);
  });

  it('collapses missing, malformed and relationship-forbidden people to not_found', async () => {
    expect(await loadAiSafeHrContext({
      session: SESSION,
      personId: 'not-a-uuid',
    })).toEqual({ outcome: 'not_found' });
    expect(requireHrCapabilityMock).not.toHaveBeenCalled();

    rows = [];
    expect(await loadAiSafeHrContext({
      session: SESSION,
      personId: PERSON_ID,
    })).toEqual({ outcome: 'not_found' });

    rows = [personRow()];
    resolveHrAccessContextMock.mockResolvedValueOnce({
      organisationId: 'org-a',
      selfPersonId: null,
      isHrAdministrator: false,
      hasRestrictedHrAccess: false,
    });
    expect(await loadAiSafeHrContext({
      session: SESSION,
      personId: PERSON_ID,
    })).toEqual({ outcome: 'not_found' });
  });

  it('uses the canonical viewer-scoped lifecycle queries for the same person', async () => {
    rows = [personRow()];

    await loadAiSafeHrContext({ session: SESSION, personId: PERSON_ID });

    expect(listLifecycleWorkflowsMock).toHaveBeenCalledWith(
      SESSION,
      { personId: PERSON_ID },
    );
    expect(getVisibleLifecycleTasksForWorkflowMock).toHaveBeenCalledWith(
      SESSION,
      WORKFLOW.id,
    );
  });

  it('returns only the reviewed HR-8C envelope and leaks no raw identifiers or sensitive fields', async () => {
    rows = [personRow()];

    const result = await loadAiSafeHrContext({
      session: SESSION,
      personId: PERSON_ID,
    });

    expect(result).toEqual({
      outcome: 'ok',
      context: {
        person: {
          display_name: 'Lex',
          job_title: 'Operations Coordinator',
          worker_type: 'employee',
          employment_status: 'active',
          team_name: 'Operations',
          manager_name: 'Morgan',
        },
        lifecycles: [{
          lifecycle_type: 'onboarding',
          status: 'ACTIVE',
          tasks: [{
            title: 'Complete induction',
            status: 'IN_PROGRESS',
          }],
        }],
      },
    });

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      PERSON_ID,
      'org-a',
      'linked-user-secret',
      'SensitiveSurname',
      'alex@example.com',
      '+61 400 000 000',
      'team-secret-id',
      'ManagerSurname',
      WORKFLOW.id,
      WORKFLOW.templateId,
      WORKFLOW.startedBy,
      TASK.id,
      TASK.description!,
      TASK.assignedUserId!,
      String(TASK.dueAt),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('never reads restricted cases, documents, audit logs or generic AI tables', async () => {
    rows = [personRow()];

    await loadAiSafeHrContext({ session: SESSION, personId: PERSON_ID });

    const sqlText = calls.map(call => call.text).join('\n');
    expect(sqlText).not.toMatch(/hr_restricted|hr_employee_documents|hr_audit|metric_snapshots|waste_records/i);
  });
});
