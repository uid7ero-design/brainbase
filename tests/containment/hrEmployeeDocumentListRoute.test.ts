import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contextMock = vi.fn();
const listMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentHttp', () => ({
  requireEmployeeDocumentContext: (...args: unknown[]) => contextMock(...args),
  requireEmployeeDocumentAdmin: vi.fn(),
  isIsoDate: vi.fn(),
}));

vi.mock('@/lib/hr/employeeDocumentList', () => ({
  listEmployeeDocumentsForPerson: (...args: unknown[]) => listMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentMutations', () => ({
  createEmployeeDocumentWithVersion: vi.fn(),
  MAX_EMPLOYEE_DOCUMENT_BYTES: 20 * 1024 * 1024,
}));

const { GET } = await import('@/app/api/hr/people/[id]/documents/route');

const SESSION = {
  organisationId: 'org-a',
  userId: 'user-a',
  role: 'viewer',
};

function request() {
  return new NextRequest('https://brainbase.test/api/hr/people/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/documents');
}

function params() {
  return Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: SESSION });
  listMock.mockResolvedValue({ outcome: 'ok', documents: [] });
});

describe('HR-7E6B employee document list route', () => {
  it('requires shared HR context before listing documents', async () => {
    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith(
      SESSION,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('collapses inaccessible/missing people to the employee-document 404', async () => {
    listMock.mockResolvedValueOnce({ outcome: 'not_found' });

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
  });

  it('returns only safe logical-document and current-version fields', async () => {
    listMock.mockResolvedValueOnce({
      outcome: 'ok',
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

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      documents: [{
        id: 'doc-1',
        document_type: 'policy',
        title: 'Safety policy',
        lifecycle_task_id: null,
        created_at: '2026-10-01T00:00:00.000Z',
        current_version: {
          id: 'version-1',
          version_number: 2,
          expires_at: '2027-10-01',
          created_at: '2026-10-02T00:00:00.000Z',
        },
      }],
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('storage');
    expect(serialized).not.toContain('filename');
    expect(serialized).not.toContain('content_type');
    expect(serialized).not.toContain('byte_size');
    expect(serialized).not.toContain('uploaded_by');
    expect(serialized).not.toContain('linked_user');
  });

  it('returns a bounded generic 500 if list retrieval fails', async () => {
    listMock.mockRejectedValueOnce(new Error('sensitive DB detail'));

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Could not retrieve employee documents.' });
    expect(JSON.stringify(body)).not.toContain('sensitive DB detail');
  });
});
