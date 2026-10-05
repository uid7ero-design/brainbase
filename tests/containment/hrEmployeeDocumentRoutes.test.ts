import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const HR_SESSION: OrgSession = {
  userId: 'hr-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'admin',
  name: 'HR',
};

const EMPLOYEE_SESSION: OrgSession = {
  ...HR_SESSION,
  userId: 'employee-user',
  role: 'viewer',
  name: 'Employee',
};

const contextMock = vi.fn();
const adminMock = vi.fn();
const resolveVersionMock = vi.fn();
const readAuditMock = vi.fn();
const createMock = vi.fn();
const addVersionMock = vi.fn();
const deleteMock = vi.fn();
const downloadMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentHttp', () => ({
  requireEmployeeDocumentContext: (...args: unknown[]) => contextMock(...args),
  requireEmployeeDocumentAdmin: (...args: unknown[]) => adminMock(...args),
  isIsoDate: (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
}));

vi.mock('@/lib/hr/employeeDocumentRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/employeeDocumentRoute')>();
  return {
    ...actual,
    requireEmployeeDocumentVersion: (...args: unknown[]) => resolveVersionMock(...args),
  };
});

vi.mock('@/lib/hr/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/auditLog')>();
  return {
    ...actual,
    logEmployeeDocumentReadEvent: (...args: unknown[]) => readAuditMock(...args),
  };
});

vi.mock('@/lib/hr/employeeDocumentMutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/employeeDocumentMutations')>();
  return {
    ...actual,
    createEmployeeDocumentWithVersion: (...args: unknown[]) => createMock(...args),
    addEmployeeDocumentVersion: (...args: unknown[]) => addVersionMock(...args),
    softDeleteEmployeeDocument: (...args: unknown[]) => deleteMock(...args),
    downloadEmployeeDocumentVersionBytes: (...args: unknown[]) => downloadMock(...args),
  };
});

const { POST: createDocument } = await import('@/app/api/hr/people/[id]/documents/route');
const { POST: addVersion } = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/route');
const { GET: downloadVersion } = await import('@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/route');
const { DELETE: deleteDocument } = await import('@/app/api/hr/people/[id]/documents/[documentId]/route');

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, init) as import('next/server').NextRequest;
}

function uploadForm(fields: Record<string, string> = {}, filename = 'certificate.pdf') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new File([new Uint8Array([1, 2, 3])], filename, { type: 'application/pdf' }));
  return form;
}

function versionResolution() {
  return {
    ok: true as const,
    document: {
      id: DOCUMENT_ID,
      organisationId: 'org-a',
      personId: PERSON_ID,
      documentType: 'certification',
      title: 'Forklift certificate',
      lifecycleTaskId: null,
      deletedAt: null,
      createdAt: '2026-09-26T00:00:00.000Z',
    },
    version: {
      id: VERSION_ID,
      organisationId: 'org-a',
      documentId: DOCUMENT_ID,
      versionNumber: 1,
      uploadedBy: 'hr-user',
      originalFilename: 'certificate.pdf',
      contentType: 'application/pdf',
      byteSize: 3,
      storageKey: 'server-only-key',
      expiresAt: null,
      isCurrent: true,
      createdAt: '2026-09-26T00:00:00.000Z',
    },
    auth: {
      actor: { organisationId: 'org-a', userId: 'employee-user', isHrAdministrator: false },
      target: { organisationId: 'org-a', personLinkedUserId: 'employee-user' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: HR_SESSION });
  adminMock.mockResolvedValue(null);
  readAuditMock.mockResolvedValue(undefined);
  downloadMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('HR-7D4 employee document routes', () => {
  it('denies create before parsing or mutation when the actor is not HR admin', async () => {
    adminMock.mockResolvedValue(
      Response.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      ),
    );

    const response = await createDocument(
      request(`/api/hr/people/${PERSON_ID}/documents`, {
        method: 'POST',
        body: uploadForm({ document_type: 'certification', title: 'Certificate' }),
      }),
      { params: Promise.resolve({ id: PERSON_ID }) },
    );

    expect(response.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects unknown/server-managed create fields', async () => {
    const response = await createDocument(
      request(`/api/hr/people/${PERSON_ID}/documents`, {
        method: 'POST',
        body: uploadForm({
          document_type: 'certification',
          title: 'Certificate',
          organisation_id: 'org-b',
        }),
      }),
      { params: Promise.resolve({ id: PERSON_ID }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Unknown or server-managed field: organisation_id',
      code: 'server_managed_field',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates document + v1 without exposing storage metadata', async () => {
    createMock.mockResolvedValue({
      outcome: 'created',
      document: {
        id: DOCUMENT_ID,
        person_id: PERSON_ID,
        document_type: 'certification',
        title: 'Certificate',
        lifecycle_task_id: null,
        deleted_at: null,
        created_at: '2026-09-26T00:00:00.000Z',
      },
      version: {
        id: VERSION_ID,
        document_id: DOCUMENT_ID,
        version_number: 1,
        uploaded_by: 'hr-user',
        original_filename: 'certificate.pdf',
        content_type: 'application/pdf',
        byte_size: 3,
        expires_at: null,
        is_current: true,
        created_at: '2026-09-26T00:00:00.000Z',
      },
    });

    const response = await createDocument(
      request(`/api/hr/people/${PERSON_ID}/documents`, {
        method: 'POST',
        body: uploadForm({ document_type: 'certification', title: 'Certificate' }),
      }),
      { params: Promise.resolve({ id: PERSON_ID }) },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.version.version_number).toBe(1);
    expect(JSON.stringify(body)).not.toContain('storage_key');
    expect(JSON.stringify(body)).not.toContain('server-only-key');
  });

  it('adds an immutable version only for HR administrators', async () => {
    addVersionMock.mockResolvedValue({
      outcome: 'created',
      version: {
        id: VERSION_ID,
        document_id: DOCUMENT_ID,
        version_number: 2,
        uploaded_by: 'hr-user',
        original_filename: 'certificate.pdf',
        content_type: 'application/pdf',
        byte_size: 3,
        expires_at: null,
        is_current: true,
        created_at: '2026-09-26T00:00:00.000Z',
      },
    });

    const response = await addVersion(
      request(`/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions`, {
        method: 'POST',
        body: uploadForm(),
      }),
      { params: Promise.resolve({ id: PERSON_ID, documentId: DOCUMENT_ID }) },
    );

    expect(response.status).toBe(201);
    expect(addVersionMock).toHaveBeenCalledTimes(1);
    expect((await response.json()).version.version_number).toBe(2);
  });

  it('fails closed on download audit failure and never reads Blob bytes', async () => {
    contextMock.mockResolvedValue({ ok: true, session: EMPLOYEE_SESSION });
    resolveVersionMock.mockResolvedValue(versionResolution());
    readAuditMock.mockRejectedValue(new Error('audit unavailable'));

    const response = await downloadVersion(
      request(`/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}`),
      { params: Promise.resolve({ id: PERSON_ID, documentId: DOCUMENT_ID, versionId: VERSION_ID }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unable to record employee document access.' });
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('writes read audit before returning employee document bytes', async () => {
    contextMock.mockResolvedValue({ ok: true, session: EMPLOYEE_SESSION });
    resolveVersionMock.mockResolvedValue(versionResolution());
    const order: string[] = [];
    readAuditMock.mockImplementation(async () => { order.push('audit'); });
    downloadMock.mockImplementation(async () => {
      order.push('blob');
      return new Uint8Array([1, 2, 3]);
    });

    const response = await downloadVersion(
      request(`/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}`),
      { params: Promise.resolve({ id: PERSON_ID, documentId: DOCUMENT_ID, versionId: VERSION_ID }) },
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(['audit', 'blob']);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="certificate.pdf"');
  });

  it('returns canonical document 404 without audit or Blob access when resolver denies', async () => {
    contextMock.mockResolvedValue({ ok: true, session: EMPLOYEE_SESSION });
    resolveVersionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Employee document not found.' }, { status: 404 }),
    });

    const response = await downloadVersion(
      request(`/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}`),
      { params: Promise.resolve({ id: PERSON_ID, documentId: DOCUMENT_ID, versionId: VERSION_ID }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
    expect(readAuditMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('soft-deletes the logical document only through the admin mutation', async () => {
    deleteMock.mockResolvedValue({
      outcome: 'deleted',
      deletedAt: '2026-09-26T03:00:00.000Z',
    });

    const response = await deleteDocument(
      request(`/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: PERSON_ID, documentId: DOCUMENT_ID }) },
    );

    expect(response.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      deleted: true,
      document_id: DOCUMENT_ID,
      deleted_at: '2026-09-26T03:00:00.000Z',
    });
  });
});
