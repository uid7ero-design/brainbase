import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { logHrEvent } = await import('@/lib/hr/auditLog');

function jsonStates(): Record<string, unknown>[] {
  const args = (sqlMock.mock.calls[0] as unknown as [string[], ...unknown[]]).slice(1);
  return args
    .filter((arg): arg is string => typeof arg === 'string' && arg.startsWith('{'))
    .map(arg => JSON.parse(arg) as Record<string, unknown>);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('HR-7D employee document audit policies', () => {
  it('redacts logical-document title while retaining governed metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_employee_document.created',
        resourceType: 'hr_employee_document',
        resourceId: 'document-1',
        afterState: {
          id: 'document-1',
          organisation_id: 'org-a',
          person_id: 'person-1',
          document_type: 'contract',
          title: 'Executive employment agreement',
          lifecycle_task_id: 'task-1',
          deleted_at: null,
          future_sensitive_field: 'must not leak',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      person_id: 'person-1',
      document_type: 'contract',
      title: '[redacted]',
      lifecycle_task_id: 'task-1',
      deleted_at: null,
      future_sensitive_field: '[redacted]',
    });
  });

  it('never writes storage_key to audit state and redacts original filename', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_employee_document_version.created',
        resourceType: 'hr_employee_document_version',
        resourceId: 'version-1',
        afterState: {
          id: 'version-1',
          organisation_id: 'org-a',
          document_id: 'document-1',
          version_number: 2,
          uploaded_by: 'hr-user',
          original_filename: 'medical-certificate.pdf',
          content_type: 'application/pdf',
          byte_size: 1200,
          storage_key: 'private/blob/key',
          expires_at: '2027-09-26',
          is_current: true,
          created_at: '2026-09-26T00:00:00Z',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      document_id: 'document-1',
      version_number: 2,
      uploaded_by: 'hr-user',
      original_filename: '[redacted]',
      content_type: 'application/pdf',
      byte_size: 1200,
      expires_at: '2027-09-26',
      is_current: true,
    });
    expect(state).not.toHaveProperty('storage_key');
  });

  it('unknown future employee-document resource types fail closed', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'hr-user' },
      {
        action: 'hr_employee_document_future.created',
        resourceType: 'hr_employee_document_future',
        resourceId: 'future-1',
        afterState: {
          title: 'secret',
          anything: 123,
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      title: '[redacted]',
      anything: '[redacted]',
    });
  });
});
