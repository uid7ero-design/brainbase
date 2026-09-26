import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

let responseQueue: unknown[][] = [];
let callCount = 0;
const calls: { text: string; values: unknown[] }[] = [];

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(
      ...(args as [TemplateStringsArray, ...unknown[]]),
    ),
}));

const {
  requireEmployeeDocument,
  requireEmployeeDocumentVersion,
} = await import('@/lib/hr/employeeDocumentRoute');

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const EMPLOYEE_SESSION: OrgSession = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer',
  name: 'Employee',
};

const MANAGER_SESSION: OrgSession = {
  ...EMPLOYEE_SESSION,
  userId: 'manager-user',
  role: 'manager',
  name: 'Manager',
};

const HR_SESSION: OrgSession = {
  ...EMPLOYEE_SESSION,
  userId: 'hr-user',
  role: 'admin',
  name: 'HR',
};

function queue(...responses: unknown[][]) {
  responseQueue = responses;
  callCount = 0;
}

function documentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    document_id: DOCUMENT_ID,
    organisation_id: 'org-a',
    person_id: PERSON_ID,
    document_type: 'certification',
    title: 'Forklift certificate',
    lifecycle_task_id: null,
    deleted_at: null,
    document_created_at: '2026-09-26T00:00:00.000Z',
    person_linked_user_id: 'employee-user',
    is_hr_administrator: false,
    ...overrides,
  };
}

function versionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...documentRow(),
    version_id: VERSION_ID,
    version_number: 1,
    uploaded_by: 'hr-user',
    original_filename: 'certificate.pdf',
    content_type: 'application/pdf',
    byte_size: 100,
    storage_key: 'private-key',
    expires_at: '2027-09-26',
    is_current: true,
    version_created_at: '2026-09-26T01:00:00.000Z',
    ...overrides,
  };
}

async function expect404(
  result:
    | Awaited<ReturnType<typeof requireEmployeeDocument>>
    | Awaited<ReturnType<typeof requireEmployeeDocumentVersion>>,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected denied result');
  expect(result.response.status).toBe(404);
  expect(await result.response.json()).toEqual({ error: 'Employee document not found.' });
}

beforeEach(() => {
  sqlMock.mockClear();
  calls.length = 0;
  responseQueue = [];
  callCount = 0;
});

describe('employee document canonical resolvers', () => {
  it('malformed ids return canonical 404 before SQL', async () => {
    await expect404(await requireEmployeeDocument(EMPLOYEE_SESSION, 'bad', DOCUMENT_ID));
    await expect404(await requireEmployeeDocumentVersion(
      EMPLOYEE_SESSION,
      PERSON_ID,
      DOCUMENT_ID,
      'bad',
    ));
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('nonexistent/cross-org documents collapse to canonical 404', async () => {
    queue([]);
    const result = await requireEmployeeDocument(EMPLOYEE_SESSION, PERSON_ID, DOCUMENT_ID);
    await expect404(result);
    expect(calls[0].text).toMatch(/d\.organisation_id = \?/);
    expect(calls[0].values).toContain('org-a');
  });

  it('linked employee may resolve their own live document', async () => {
    queue([documentRow()]);
    const result = await requireEmployeeDocument(EMPLOYEE_SESSION, PERSON_ID, DOCUMENT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected access');
    expect(result.document.documentType).toBe('certification');
    expect(calls[0].text).toContain('p.linked_user_id AS person_linked_user_id');
    expect(calls[0].text).not.toMatch(/manager_person_id|email|phone/i);
  });

  it('manager receives the same canonical 404 because first release has no manager metadata access', async () => {
    queue([documentRow()]);
    await expect404(await requireEmployeeDocument(MANAGER_SESSION, PERSON_ID, DOCUMENT_ID));
    expect(calls[0].text).not.toContain('manager_person_id');
  });

  it('HR administrator may resolve documents in active org', async () => {
    queue([documentRow({ is_hr_administrator: true })]);
    const result = await requireEmployeeDocument(HR_SESSION, PERSON_ID, DOCUMENT_ID);
    expect(result.ok).toBe(true);
    expect(calls[0].text).toContain('FROM hr_administrators a');
  });

  it('deleted logical documents are excluded in SQL', async () => {
    queue([]);
    await expect404(await requireEmployeeDocument(EMPLOYEE_SESSION, PERSON_ID, DOCUMENT_ID));
    expect(calls[0].text).toContain('d.deleted_at IS NULL');
  });

  it('version resolver preserves server-only storage key after authorization', async () => {
    queue([versionRow()]);
    const result = await requireEmployeeDocumentVersion(
      EMPLOYEE_SESSION,
      PERSON_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected access');
    expect(result.version.storageKey).toBe('private-key');
    expect(result.version.versionNumber).toBe(1);
    expect(calls[0].text).toContain('v.document_id = d.id');
    expect(calls[0].text).toContain('v.id = ?::uuid');
  });

  it('manager cannot resolve bytes/version metadata even when document exists', async () => {
    queue([versionRow()]);
    await expect404(await requireEmployeeDocumentVersion(
      MANAGER_SESSION,
      PERSON_ID,
      DOCUMENT_ID,
      VERSION_ID,
    ));
  });
});
