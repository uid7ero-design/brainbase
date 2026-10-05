import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contextMock = vi.fn();
const listMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentHttp', () => ({
  requireEmployeeDocumentContext: (...args: unknown[]) => contextMock(...args),
  requireEmployeeDocumentAdmin: vi.fn(),
  isIsoDate: vi.fn(),
}));

vi.mock('@/lib/hr/employeeDocumentVersionList', () => ({
  listEmployeeDocumentVersions: (...args: unknown[]) => listMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentMutations', () => ({
  addEmployeeDocumentVersion: vi.fn(),
  MAX_EMPLOYEE_DOCUMENT_BYTES: 20 * 1024 * 1024,
}));

const { GET } = await import(
  '@/app/api/hr/people/[id]/documents/[documentId]/versions/route'
);

const SESSION = {
  organisationId: 'org-a',
  userId: 'user-a',
  role: 'viewer',
};

const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request() {
  return new NextRequest(
    `https://brainbase.test/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions`,
  );
}

function params(
  id = PERSON_ID,
  documentId = DOCUMENT_ID,
) {
  return Promise.resolve({ id, documentId });
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: SESSION });
  listMock.mockResolvedValue({ outcome: 'ok', versions: [] });
});

describe('HR-7E9A employee document version history route', () => {
  it('requires shared HR context and delegates to the safe version read model', async () => {
    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith(
      SESSION,
      PERSON_ID,
      DOCUMENT_ID,
    );
  });

  it('rejects invalid resource identifiers before version lookup', async () => {
    const response = await GET(request(), {
      params: params('not-a-uuid', DOCUMENT_ID),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Employee document not found.',
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('collapses inaccessible, deleted or missing documents to the canonical 404', async () => {
    listMock.mockResolvedValueOnce({ outcome: 'not_found' });

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Employee document not found.',
    });
  });

  it('returns only safe historical-version metadata', async () => {
    listMock.mockResolvedValueOnce({
      outcome: 'ok',
      versions: [
        {
          id: 'version-3',
          versionNumber: 3,
          expiresAt: new Date('2028-10-05T00:00:00.000Z'),
          isCurrent: true,
          createdAt: new Date('2026-10-05T08:00:00.000Z'),
        },
        {
          id: 'version-2',
          versionNumber: 2,
          expiresAt: null,
          isCurrent: false,
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    });

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      versions: [
        {
          id: 'version-3',
          version_number: 3,
          expires_at: '2028-10-05T00:00:00.000Z',
          is_current: true,
          created_at: '2026-10-05T08:00:00.000Z',
        },
        {
          id: 'version-2',
          version_number: 2,
          expires_at: null,
          is_current: false,
          created_at: '2026-10-02T00:00:00.000Z',
        },
      ],
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('storage');
    expect(serialized).not.toContain('filename');
    expect(serialized).not.toContain('content_type');
    expect(serialized).not.toContain('byte_size');
    expect(serialized).not.toContain('uploaded_by');
    expect(serialized).not.toContain('acknowledgement');
    expect(serialized).not.toContain('verification');
    expect(serialized).not.toContain('comment');
  });

  it('returns a bounded generic 500 if version retrieval fails', async () => {
    listMock.mockRejectedValueOnce(new Error('sensitive DB detail'));

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Could not retrieve employee document versions.',
    });
    expect(JSON.stringify(body)).not.toContain('sensitive DB detail');
  });
});
