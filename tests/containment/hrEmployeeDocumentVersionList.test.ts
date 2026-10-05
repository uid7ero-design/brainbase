import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const { listEmployeeDocumentVersions } = await import(
  '@/lib/hr/employeeDocumentVersionList'
);

const SESSION = {
  organisationId: 'org-a',
  userId: 'user-a',
  role: 'viewer',
};

const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HR-7E9A employee document version history read model', () => {
  it('returns not_found for a missing, deleted or cross-org document without reading versions', async () => {
    sqlMock.mockResolvedValueOnce([]);

    await expect(listEmployeeDocumentVersions(
      SESSION as never,
      PERSON_ID,
      DOCUMENT_ID,
    )).resolves.toEqual({ outcome: 'not_found' });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const query = (strings as TemplateStringsArray).join('?');
    expect(query).toContain('d.deleted_at IS NULL');
    expect(query).toContain('d.person_id = p.id');
  });

  it('collapses unrelated or direct-manager style access to not_found', async () => {
    sqlMock.mockResolvedValueOnce([{
      organisation_id: 'org-a',
      linked_user_id: 'different-user',
      is_hr_administrator: false,
      document_id: DOCUMENT_ID,
    }]);

    await expect(listEmployeeDocumentVersions(
      SESSION as never,
      PERSON_ID,
      DOCUMENT_ID,
    )).resolves.toEqual({ outcome: 'not_found' });

    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('allows the linked employee and returns only safe immutable version metadata', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        organisation_id: 'org-a',
        linked_user_id: 'user-a',
        is_hr_administrator: false,
        document_id: DOCUMENT_ID,
      }])
      .mockResolvedValueOnce([
        {
          version_id: 'version-3',
          version_number: 3,
          expires_at: '2028-10-05',
          is_current: true,
          created_at: '2026-10-05T08:00:00.000Z',
        },
        {
          version_id: 'version-2',
          version_number: 2,
          expires_at: '2027-10-01',
          is_current: false,
          created_at: '2026-10-02T00:00:00.000Z',
        },
      ]);

    await expect(listEmployeeDocumentVersions(
      SESSION as never,
      PERSON_ID,
      DOCUMENT_ID,
    )).resolves.toEqual({
      outcome: 'ok',
      versions: [
        {
          id: 'version-3',
          versionNumber: 3,
          expiresAt: '2028-10-05',
          isCurrent: true,
          createdAt: '2026-10-05T08:00:00.000Z',
        },
        {
          id: 'version-2',
          versionNumber: 2,
          expiresAt: '2027-10-01',
          isCurrent: false,
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    });

    expect(sqlMock).toHaveBeenCalledTimes(2);
    const [strings] = sqlMock.mock.calls[1];
    const query = (strings as TemplateStringsArray).join('?');
    expect(query).toContain('ORDER BY v.version_number DESC');
    expect(query).not.toMatch(/storage_key/i);
    expect(query).not.toMatch(/original_filename/i);
    expect(query).not.toMatch(/content_type/i);
    expect(query).not.toMatch(/byte_size/i);
    expect(query).not.toMatch(/uploaded_by/i);
    expect(query).not.toMatch(/acknowledg/i);
    expect(query).not.toMatch(/verification/i);
    expect(query).not.toMatch(/comment/i);
  });

  it('allows active HR administration independently of employee linkage', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        organisation_id: 'org-a',
        linked_user_id: 'different-user',
        is_hr_administrator: true,
        document_id: DOCUMENT_ID,
      }])
      .mockResolvedValueOnce([]);

    await expect(listEmployeeDocumentVersions(
      SESSION as never,
      PERSON_ID,
      DOCUMENT_ID,
    )).resolves.toEqual({
      outcome: 'ok',
      versions: [],
    });

    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
