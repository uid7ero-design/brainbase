import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ACK_ID = '44444444-4444-4444-8444-444444444444';

const EMPLOYEE_SESSION: OrgSession = {
  userId: 'employee-user',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'viewer',
  name: 'Employee',
};

const HR_SESSION: OrgSession = {
  ...EMPLOYEE_SESSION,
  userId: 'hr-user',
  role: 'admin',
  name: 'HR',
};

const contextMock = vi.fn();
const resolveVersionMock = vi.fn();
const acknowledgeMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentHttp', () => ({
  requireEmployeeDocumentContext: (...args: unknown[]) => contextMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/employeeDocumentRoute')>();
  return {
    ...actual,
    requireEmployeeDocumentVersion: (...args: unknown[]) => resolveVersionMock(...args),
  };
});

vi.mock('@/lib/hr/employeeDocumentAssuranceMutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/employeeDocumentAssuranceMutations')>();
  return {
    ...actual,
    acknowledgeEmployeeDocumentVersion: (...args: unknown[]) => acknowledgeMock(...args),
  };
});

const { POST } = await import(
  '@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/acknowledgements/route'
);

function request() {
  return new Request(
    `http://localhost/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/acknowledgements`,
    {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.42',
        'user-agent': 'vitest',
      },
    },
  ) as import('next/server').NextRequest;
}

function params() {
  return {
    params: Promise.resolve({
      id: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    }),
  };
}

function employeeResolution() {
  return {
    ok: true as const,
    document: {
      id: DOCUMENT_ID,
      organisationId: 'org-a',
      personId: PERSON_ID,
      documentType: 'policy',
      title: 'Safety policy',
      lifecycleTaskId: null,
      deletedAt: null,
      createdAt: '2026-09-27T10:00:00.000Z',
    },
    version: {
      id: VERSION_ID,
      organisationId: 'org-a',
      documentId: DOCUMENT_ID,
      versionNumber: 1,
      uploadedBy: 'hr-user',
      originalFilename: 'safety-policy.pdf',
      contentType: 'application/pdf',
      byteSize: 1234,
      storageKey: 'server-only/private/key',
      expiresAt: null,
      isCurrent: true,
      createdAt: '2026-09-27T10:00:00.000Z',
    },
    auth: {
      actor: {
        organisationId: 'org-a',
        userId: 'employee-user',
        isHrAdministrator: false,
      },
      target: {
        organisationId: 'org-a',
        personLinkedUserId: 'employee-user',
      },
    },
  };
}

function acknowledgement(outcome: 'recorded' | 'already_acknowledged' = 'recorded') {
  return {
    outcome,
    acknowledgement: {
      id: ACK_ID,
      documentVersionId: VERSION_ID,
      acknowledgedBy: 'employee-user',
      acknowledgedAt: '2026-09-27T11:30:00.000Z',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: EMPLOYEE_SESSION });
  resolveVersionMock.mockResolvedValue(employeeResolution());
  acknowledgeMock.mockResolvedValue(acknowledgement());
});

describe('HR-7E4A employee document acknowledgement route', () => {
  it('stops at the shared HR context failure before resolving or mutating', async () => {
    contextMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized.' }, { status: 401 }),
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(401);
    expect(resolveVersionMock).not.toHaveBeenCalled();
    expect(acknowledgeMock).not.toHaveBeenCalled();
  });

  it('preserves the canonical document 404 for inaccessible or missing versions', async () => {
    resolveVersionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Employee document not found.' }, { status: 404 }),
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
    expect(acknowledgeMock).not.toHaveBeenCalled();
  });

  it('does not let an HR administrator acknowledge on another employee behalf', async () => {
    contextMock.mockResolvedValue({ ok: true, session: HR_SESSION });
    resolveVersionMock.mockResolvedValue({
      ...employeeResolution(),
      auth: {
        actor: {
          organisationId: 'org-a',
          userId: 'hr-user',
          isHrAdministrator: true,
        },
        target: {
          organisationId: 'org-a',
          personLinkedUserId: 'employee-user',
        },
      },
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Only the linked employee may acknowledge this document version.',
      code: 'acknowledgement_forbidden',
    });
    expect(acknowledgeMock).not.toHaveBeenCalled();
  });

  it('records linked employee acknowledgement without exposing document storage metadata', async () => {
    const response = await POST(request(), params());

    expect(response.status).toBe(201);
    expect(acknowledgeMock).toHaveBeenCalledWith({
      actor: {
        organisationId: 'org-a',
        userId: 'employee-user',
        isSuperAdmin: false,
        ipAddress: '203.0.113.42',
        userAgent: 'vitest',
      },
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
    const body = await response.json();
    expect(body).toEqual({
      acknowledgement: {
        id: ACK_ID,
        document_version_id: VERSION_ID,
        acknowledged_by: 'employee-user',
        acknowledged_at: '2026-09-27T11:30:00.000Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain('storage');
    expect(JSON.stringify(body)).not.toContain('server-only/private/key');
  });

  it('returns an idempotent repeat acknowledgement as 200', async () => {
    acknowledgeMock.mockResolvedValue(acknowledgement('already_acknowledged'));

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect((await response.json()).acknowledgement.id).toBe(ACK_ID);
  });

  it('maps race-time missing version to the canonical 404', async () => {
    acknowledgeMock.mockResolvedValue({ outcome: 'version_not_found' });

    const response = await POST(request(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
  });

  it('maps race-time authorization loss to the acknowledgement 403', async () => {
    acknowledgeMock.mockResolvedValue({ outcome: 'forbidden' });

    const response = await POST(request(), params());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('acknowledgement_forbidden');
  });

  it('maps unexpected mutation failures to a generic 500', async () => {
    acknowledgeMock.mockRejectedValue(new Error('database exploded'));

    const response = await POST(request(), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not record employee document acknowledgement.',
    });
  });
});
