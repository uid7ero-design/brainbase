import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { logHrEvent, logRestrictedHrReadEvent } = await import('@/lib/hr/auditLog');

function sqlCallArgs(): unknown[] {
  return (sqlMock.mock.calls[0] as unknown as [string[], ...unknown[]]).slice(1);
}

function jsonStates(): Record<string, unknown>[] {
  return sqlCallArgs()
    .filter((arg): arg is string =>
      typeof arg === 'string' && arg.startsWith('{'),
    )
    .map((arg) => JSON.parse(arg) as Record<string, unknown>);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('restricted-HR audit policy', () => {
  it('allows only explicit grant/revoke metadata for restricted-case access events', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'admin-user' },
      {
        action: 'hr_restricted_case_access.granted',
        resourceType: 'hr_restricted_case_access',
        resourceId: 'grant-1',
        afterState: {
          case_id: 'case-1',
          user_id: 'target-user',
          granted_by: 'admin-user',
          granted_at: '2026-09-25T01:00:00.000Z',
        },
      },
    );

    expect(jsonStates()).toContainEqual({
      case_id: 'case-1',
      user_id: 'target-user',
      granted_by: 'admin-user',
      granted_at: '2026-09-25T01:00:00.000Z',
    });
  });

  it('excludes restricted-case content while retaining safe lifecycle metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'admin-user' },
      {
        action: 'hr_restricted_case.updated',
        resourceType: 'hr_restricted_case',
        resourceId: 'case-1',
        afterState: {
          status: 'closed',
          closed_at: '2026-09-25T02:00:00.000Z',
          opened_by: 'admin-user',
          case_type: 'grievance',
          title: 'Sensitive grievance title',
          reference: 'Sensitive internal reference',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      status: 'closed',
      closed_at: '2026-09-25T02:00:00.000Z',
      opened_by: 'admin-user',
      case_type: '[redacted]',
      title: '[redacted]',
      reference: '[redacted]',
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('Sensitive grievance title');
    expect(serialized).not.toContain('Sensitive internal reference');
    expect(serialized).not.toContain('grievance');
  });

  it('never writes restricted note body content but may retain case/author ids', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'author-user' },
      {
        action: 'hr_restricted_case_note.created',
        resourceType: 'hr_restricted_case_note',
        resourceId: 'note-1',
        afterState: {
          case_id: 'case-1',
          author_id: 'author-user',
          body: 'Highly sensitive investigation narrative',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      case_id: 'case-1',
      author_id: 'author-user',
      body: '[redacted]',
    });
    expect(JSON.stringify(state)).not.toContain(
      'Highly sensitive investigation narrative',
    );
  });

  it('never writes restricted document filename/storage content while retaining safe file metadata', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'uploader-user' },
      {
        action: 'hr_restricted_case_document.created',
        resourceType: 'hr_restricted_case_document',
        resourceId: 'document-1',
        afterState: {
          case_id: 'case-1',
          uploaded_by: 'uploader-user',
          content_type: 'application/pdf',
          byte_size: 4096,
          deleted_at: null,
          original_filename: 'complaint-about-jane-doe.pdf',
          storage_key: 'private/hr/case-1/secret-object-key',
        },
      },
    );

    const [state] = jsonStates();
    expect(state).toEqual({
      case_id: 'case-1',
      uploaded_by: 'uploader-user',
      content_type: 'application/pdf',
      byte_size: 4096,
      deleted_at: null,
      original_filename: '[redacted]',
      storage_key: '[redacted]',
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('complaint-about-jane-doe.pdf');
    expect(serialized).not.toContain('secret-object-key');
  });

  it('propagates restricted-read audit storage failures so routes can fail closed', async () => {
    sqlMock.mockRejectedValueOnce(new Error('audit database unavailable'));

    await expect(logRestrictedHrReadEvent(
      { organisationId: 'org-a', userId: 'reader-user' },
      {
        action: 'hr_restricted_case.read',
        resourceType: 'hr_restricted_case',
        resourceId: 'case-1',
        afterState: { status: 'open', opened_by: 'admin-user' },
      },
    )).rejects.toThrow('audit database unavailable');
  });

  it('rejects misuse of the strict restricted-read helper before writing an audit row', async () => {
    await expect(logRestrictedHrReadEvent(
      { organisationId: 'org-a', userId: 'reader-user' },
      {
        action: 'hr_restricted_case.created',
        resourceType: 'hr_restricted_case',
        resourceId: 'case-1',
      },
    )).rejects.toThrow('only accepts restricted-case read events');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown restricted resource type by redacting every state value', async () => {
    await logHrEvent(
      { organisationId: 'org-a', userId: 'admin-user' },
      {
        action: 'hr_restricted_future_resource.updated',
        resourceType: 'hr_restricted_future_resource',
        resourceId: 'future-1',
        beforeState: {
          status: 'draft',
          custom_payload: 'secret-before',
        },
        afterState: {
          status: 'final',
          custom_payload: 'secret-after',
        },
      },
    );

    expect(jsonStates()).toEqual([
      {
        status: '[redacted]',
        custom_payload: '[redacted]',
      },
      {
        status: '[redacted]',
        custom_payload: '[redacted]',
      },
    ]);

    const args = JSON.stringify(sqlCallArgs());
    expect(args).not.toContain('secret-before');
    expect(args).not.toContain('secret-after');
    expect(args).not.toContain('draft');
    expect(args).not.toContain('final');
  });
});
