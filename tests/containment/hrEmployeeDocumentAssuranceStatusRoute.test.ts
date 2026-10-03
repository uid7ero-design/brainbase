import { beforeEach, describe, expect, it, vi } from 'vitest';

const contextMock = vi.fn();
const resolverMock = vi.fn();
const statusMock = vi.fn();

vi.mock('@/lib/hr/employeeDocumentHttp', () => ({
  requireEmployeeDocumentContext: (...args: unknown[]) => contextMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentRoute', () => ({
  requireEmployeeDocumentVersion: (...args: unknown[]) => resolverMock(...args),
}));

vi.mock('@/lib/hr/employeeDocumentAssuranceStatus', () => ({
  getEmployeeDocumentAssuranceStatus: (...args: unknown[]) => statusMock(...args),
}));

const { GET } = await import(
  '@/app/api/hr/people/[id]/documents/[documentId]/versions/[versionId]/assurance/route'
);

const SESSION = {
  organisationId: 'org-a',
  userId: 'actor-a',
  role: 'viewer',
};

const RESOLVED = {
  ok: true,
  document: { id: 'doc-a' },
  version: { id: '11111111-1111-4111-8111-111111111111' },
  auth: {
    actor: {
      organisationId: 'org-a',
      userId: 'actor-a',
      isHrAdministrator: false,
    },
    target: {
      organisationId: 'org-a',
      personLinkedUserId: 'actor-a',
    },
  },
};

function request() {
  return new Request('https://brainbase.test/api/hr/people/p/documents/d/versions/v/assurance');
}

function params() {
  return Promise.resolve({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: '11111111-1111-4111-8111-111111111111',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  contextMock.mockResolvedValue({ ok: true, session: SESSION });
  resolverMock.mockResolvedValue(RESOLVED);
  statusMock.mockResolvedValue({
    acknowledged: true,
    acknowledgedAt: '2026-10-03T01:02:03.000Z',
    latestVerification: {
      decision: 'VERIFIED',
      verifiedAt: '2026-10-03T02:03:04.000Z',
    },
  });
});

describe('HR-7E6A employee document assurance status route', () => {
  it('requires the shared HR context before resolving the document version', async () => {
    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(resolverMock).toHaveBeenCalledTimes(1);
    expect(contextMock.mock.invocationCallOrder[0])
      .toBeLessThan(resolverMock.mock.invocationCallOrder[0]);
  });

  it('passes canonical resolver denials through without querying assurance state', async () => {
    resolverMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Employee document not found.' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(404);
    expect(statusMock).not.toHaveBeenCalled();
  });

  it('queries only the resolved same-tenant version and linked employee identity', async () => {
    await GET(request(), { params: params() });

    expect(statusMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      versionId: '11111111-1111-4111-8111-111111111111',
      linkedEmployeeUserId: 'actor-a',
    });
  });

  it('returns only safe assurance state fields', async () => {
    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      assurance: {
        document_version_id: '11111111-1111-4111-8111-111111111111',
        employee_acknowledgement: {
          acknowledged: true,
          acknowledged_at: '2026-10-03T01:02:03.000Z',
        },
        latest_verification: {
          decision: 'VERIFIED',
          verified_at: '2026-10-03T02:03:04.000Z',
        },
      },
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('comment');
    expect(serialized).not.toContain('verified_by');
    expect(serialized).not.toContain('linked_user');
    expect(serialized).not.toContain('storage');
    expect(serialized).not.toContain('filename');
    expect(serialized).not.toContain('reminder');
  });

  it('returns a generic 500 when assurance-state retrieval fails', async () => {
    statusMock.mockRejectedValueOnce(new Error('sensitive database detail'));

    const response = await GET(request(), { params: params() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Could not retrieve employee document assurance status.',
    });
    expect(JSON.stringify(body)).not.toContain('sensitive database detail');
  });
});
