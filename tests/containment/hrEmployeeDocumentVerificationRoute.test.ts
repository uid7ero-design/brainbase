import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const VERIFICATION_ID = '55555555-5555-4555-8555-555555555555';

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

const SUPER_SESSION: OrgSession = {
  ...EMPLOYEE_SESSION,
  userId: 'super-user',
  role: 'super_admin',
  name: 'Super',
};

const contextMock = vi.fn();
const resolveVersionMock = vi.fn();
const verifyMock = vi.fn();

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
    verifyEmployeeDocumentVersion: (...args: unknown[]) => verifyMock(...args),
  };
});

const { POST } = await import(
  '@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/verifications/route'
);

function request(body: Record<string, unknown> = { decision: 'VERIFIED' }) {
  return new Request(
    `http://localhost/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/verifications`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42',
        'user-agent': 'vitest',
      },
      body: JSON.stringify(body),
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

function resolution(actor: {
  userId: string;
  isHrAdministrator: boolean;
}) {
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
        userId: actor.userId,
        isHrAdministrator: actor.isHrAdministrator,
      },
      target: {
        organisationId: 'org-a',
        personLinkedUserId: 'employee-user',
      },
    },
  };
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'recorded',
    verification: {
      id: VERIFICATION_ID,
      documentVersionId: VERSION_ID,
      verifiedBy: 'hr-user',
      decision: 'VERIFIED',
      comment: null,
      verifiedAt: '2026-09-27T11:31:00.000Z',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: HR_SESSION });
  resolveVersionMock.mockResolvedValue(
    resolution({ userId: 'hr-user', isHrAdministrator: true }),
  );
  verifyMock.mockResolvedValue(verification());
});

describe('HR-7E4B employee document verification route', () => {
  it('stops at the shared HR context failure before resolving or mutating', async () => {
    contextMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized.' }, { status: 401 }),
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(401);
    expect(resolveVersionMock).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('preserves the canonical document 404 for inaccessible or missing versions', async () => {
    resolveVersionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Employee document not found.' }, { status: 404 }),
    });

    const response = await POST(request(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('does not let the linked employee verify their own document version', async () => {
    contextMock.mockResolvedValue({ ok: true, session: EMPLOYEE_SESSION });
    resolveVersionMock.mockResolvedValue(
      resolution({ userId: 'employee-user', isHrAdministrator: false }),
    );

    const response = await POST(request(), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Only an HR administrator may verify this document version.',
      code: 'verification_forbidden',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('records an HR administrator verification with trimmed comment', async () => {
    verifyMock.mockResolvedValue(verification({
      decision: 'REJECTED',
      comment: 'Needs renewal',
    }));

    const response = await POST(
      request({ decision: 'REJECTED', comment: '  Needs renewal  ' }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(verifyMock).toHaveBeenCalledWith({
      actor: {
        organisationId: 'org-a',
        userId: 'hr-user',
        isSuperAdmin: false,
        ipAddress: '203.0.113.42',
        userAgent: 'vitest',
      },
      personId: PERSON_ID,
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      decision: 'REJECTED',
      comment: 'Needs renewal',
    });
    const body = await response.json();
    expect(body).toEqual({
      verification: {
        id: VERIFICATION_ID,
        document_version_id: VERSION_ID,
        verified_by: 'hr-user',
        decision: 'REJECTED',
        comment: 'Needs renewal',
        verified_at: '2026-09-27T11:31:00.000Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain('storage');
    expect(JSON.stringify(body)).not.toContain('server-only/private/key');
  });

  it('permits a super-admin verification in the active organisation', async () => {
    contextMock.mockResolvedValue({ ok: true, session: SUPER_SESSION });
    resolveVersionMock.mockResolvedValue(
      resolution({ userId: 'super-user', isHrAdministrator: true }),
    );
    verifyMock.mockResolvedValue(verification({ verifiedBy: 'super-user' }));

    const response = await POST(request(), params());

    expect(response.status).toBe(201);
    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        userId: 'super-user',
        isSuperAdmin: true,
      }),
    }));
  });

  it('rejects a null JSON body before mutation', async () => {
    const response = await POST(
      new Request(
        `http://localhost/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/verifications`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'null',
        },
      ) as import('next/server').NextRequest,
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Request body must be a JSON object.',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects an array JSON body before mutation', async () => {
    const response = await POST(
      new Request(
        `http://localhost/api/hr/people/${PERSON_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/verifications`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '[]',
        },
      ) as import('next/server').NextRequest,
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Request body must be a JSON object.',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects unknown request fields before mutation', async () => {
    const response = await POST(
      request({ decision: 'VERIFIED', unexpected: true }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Unknown or unsupported field: unexpected',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('requires VERIFIED or REJECTED as the decision', async () => {
    const response = await POST(request({ decision: 'APPROVED' }), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'decision must be VERIFIED or REJECTED.',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('requires comment to be a string or null', async () => {
    const response = await POST(
      request({ decision: 'VERIFIED', comment: 42 }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'comment must be a string or null.',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('normalizes a blank comment to null', async () => {
    const response = await POST(
      request({ decision: 'VERIFIED', comment: '   ' }),
      params(),
    );

    expect(response.status).toBe(201);
    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'VERIFIED',
      comment: null,
    }));
  });

  it('maps race-time missing version to the canonical 404', async () => {
    verifyMock.mockResolvedValue({ outcome: 'version_not_found' });

    const response = await POST(request(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Employee document not found.' });
  });

  it('maps race-time authorization loss to the verification 403', async () => {
    verifyMock.mockResolvedValue({ outcome: 'forbidden' });

    const response = await POST(request(), params());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('verification_forbidden');
  });

  it('maps unexpected mutation failures to a generic 500', async () => {
    verifyMock.mockRejectedValue(new Error('database exploded'));

    const response = await POST(request(), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not record employee document verification.',
    });
  });
});
