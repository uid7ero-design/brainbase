import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const { listEmployeeDocumentsForPerson } = await import(
  '@/lib/hr/employeeDocumentList'
);

const SESSION = {
  organisationId: 'org-a',
  userId: 'user-a',
  role: 'viewer',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HR-7E6B employee document list read model', () => {
  it('returns not_found for a missing/cross-org person and does not query documents', async () => {
    sqlMock.mockResolvedValueOnce([]);

    await expect(listEmployeeDocumentsForPerson(
      SESSION as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )).resolves.toEqual({ outcome: 'not_found' });

    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('denies an unrelated/direct-manager style caller by collapsing access to not_found', async () => {
    sqlMock.mockResolvedValueOnce([{
      organisation_id: 'org-a',
      linked_user_id: 'different-user',
      is_hr_administrator: false,
    }]);

    await expect(listEmployeeDocumentsForPerson(
      SESSION as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )).resolves.toEqual({ outcome: 'not_found' });

    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('allows the linked employee and returns only live documents plus current-version metadata', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        organisation_id: 'org-a',
        linked_user_id: 'user-a',
        is_hr_administrator: false,
      }])
      .mockResolvedValueOnce([{
        document_id: 'doc-1',
        document_type: 'policy',
        title: 'Safety policy',
        lifecycle_task_id: null,
        document_created_at: '2026-10-01T00:00:00.000Z',
        version_id: 'version-1',
        version_number: 2,
        expires_at: '2027-10-01',
        version_created_at: '2026-10-02T00:00:00.000Z',
      }]);

    await expect(listEmployeeDocumentsForPerson(
      SESSION as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )).resolves.toEqual({
      outcome: 'ok',
      canManageDocuments: false,
      documents: [{
        id: 'doc-1',
        documentType: 'policy',
        title: 'Safety policy',
        lifecycleTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        currentVersion: {
          id: 'version-1',
          versionNumber: 2,
          expiresAt: '2027-10-01',
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      }],
    });

    const [strings] = sqlMock.mock.calls[1];
    const query = (strings as TemplateStringsArray).join('?');
    expect(query).toContain('d.deleted_at IS NULL');
    expect(query).toContain('v.is_current = TRUE');
    expect(query).not.toMatch(/storage_key/i);
    expect(query).not.toMatch(/original_filename/i);
    expect(query).not.toMatch(/content_type/i);
    expect(query).not.toMatch(/byte_size/i);
    expect(query).not.toMatch(/uploaded_by/i);
  });

  it('allows active HR administration independently of employee linkage', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        organisation_id: 'org-a',
        linked_user_id: 'different-user',
        is_hr_administrator: true,
      }])
      .mockResolvedValueOnce([]);

    await expect(listEmployeeDocumentsForPerson(
      SESSION as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )).resolves.toEqual({
      outcome: 'ok',
      canManageDocuments: true,
      documents: [],
    });

    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
