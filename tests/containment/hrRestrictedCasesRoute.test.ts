import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

function getRequest(url: string): NextRequest {
  return asNextRequest(new Request(url));
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return {
    ...actual,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
  };
});

const requireHrCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireHrCapabilityMock(...args),
}));

const resolveHrAccessContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({
  resolveHrAccessContext: (...args: unknown[]) => resolveHrAccessContextMock(...args),
}));

const logHrEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logRestrictedHrReadEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/hr/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/auditLog')>();
  return {
    ...actual,
    logHrEvent: (...args: unknown[]) => logHrEventMock(...args),
    logRestrictedHrReadEvent: (...args: unknown[]) => logRestrictedHrReadEventMock(...args),
  };
});

const requireRestrictedCaseMock = vi.fn();
vi.mock('@/lib/hr/restrictedRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/restrictedRoute')>();
  return {
    ...actual,
    requireRestrictedCase: (...args: unknown[]) => requireRestrictedCaseMock(...args),
  };
});

let responseQueue: unknown[][] = [];
let callCount = 0;
let calls: Array<{ text: string; values: unknown[] }> = [];
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(
      ...(args as [TemplateStringsArray, ...unknown[]]),
    ),
}));

function queue(...responses: unknown[][]) {
  responseQueue = responses;
  callCount = 0;
}

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID_2 = '22222222-2222-4222-8222-222222222222';
const SESSION: OrgSession = {
  userId: 'user-a',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'User A',
};
const SUPER_ADMIN_SESSION: OrgSession = {
  userId: 'founder-user',
  organisationId: 'org-a',
  homeOrganisationId: 'founder-org',
  role: 'super_admin',
  name: 'Founder',
};
const HR_ADMIN_CTX = {
  organisationId: 'org-a',
  selfPersonId: null,
  isHrAdministrator: true,
  hasRestrictedHrAccess: false,
};
const NOBODY_CTX = {
  organisationId: 'org-a',
  selfPersonId: null,
  isHrAdministrator: false,
  hasRestrictedHrAccess: false,
};
const CASE_ROW = {
  id: CASE_ID,
  organisation_id: 'org-a',
  case_type: 'grievance',
  status: 'open',
  title: 'Sensitive grievance title',
  reference: 'PRIVATE-REF-001',
  opened_by: 'user-opener',
  closed_at: null,
  created_at: '2026-09-25T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z',
};

const { GET: listCases, POST: createCase } = await import('@/app/api/hr/restricted-cases/route');
const { GET: getCase } = await import('@/app/api/hr/restricted-cases/[id]/route');

beforeEach(() => {
  requireSessionMock.mockReset();
  requireHrCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  logHrEventMock.mockClear();
  logRestrictedHrReadEventMock.mockReset();
  logRestrictedHrReadEventMock.mockResolvedValue(undefined);
  requireRestrictedCaseMock.mockReset();
  sqlMock.mockClear();
  calls = [];
  responseQueue = [];
  callCount = 0;

  requireSessionMock.mockResolvedValue(SESSION);
  requireHrCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
});

describe('GET /api/hr/restricted-cases', () => {
  it('rejects before querying when there is no authenticated session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(logRestrictedHrReadEventMock).not.toHaveBeenCalled();
  });

  it('lists only active-org cases with an exact live grant for an ordinary caller', async () => {
    queue([CASE_ROW]);

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cases: [{
        id: CASE_ID,
        case_type: 'grievance',
        status: 'open',
        title: 'Sensitive grievance title',
        reference: 'PRIVATE-REF-001',
        opened_by: 'user-opener',
        closed_at: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      }],
    });
    expect(calls[0].text).toContain('c.organisation_id = ?');
    expect(calls[0].text).toContain('FROM hr_restricted_case_access a');
    expect(calls[0].text).toContain('a.case_id = c.id');
    expect(calls[0].text).toContain('a.user_id = ?');
    expect(calls[0].text).toContain('a.revoked_at IS NULL');
    expect(calls[0].text).not.toContain('hr_administrators');
    expect(calls[0].text).not.toContain('hr_restricted_case_participants');
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain('user-a');
  });

  it('super_admin list access is still constrained to the active organisation', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    queue([]);

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(200);
    expect(calls[0].text).toContain('c.organisation_id = ?');
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain(true);
  });

  it('audits each successfully returned case with metadata only', async () => {
    queue([
      CASE_ROW,
      {
        ...CASE_ROW,
        id: CASE_ID_2,
        title: 'Second sensitive title',
        reference: 'PRIVATE-REF-002',
      },
    ]);

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(200);
    expect(logRestrictedHrReadEventMock).toHaveBeenCalledTimes(2);
    for (const call of logRestrictedHrReadEventMock.mock.calls) {
      const [actor, entry] = call as [Record<string, unknown>, Record<string, unknown>];
      expect(actor).toMatchObject({ organisationId: 'org-a', userId: 'user-a' });
      expect(entry).toMatchObject({
        action: 'hr_restricted_case.read',
        resourceType: 'hr_restricted_case',
      });
      expect(entry.afterState).toEqual({ status: 'open', opened_by: 'user-opener' });
    }
    const auditArgs = JSON.stringify(logRestrictedHrReadEventMock.mock.calls);
    expect(auditArgs).not.toContain('Sensitive grievance title');
    expect(auditArgs).not.toContain('Second sensitive title');
    expect(auditArgs).not.toContain('PRIVATE-REF-001');
    expect(auditArgs).not.toContain('PRIVATE-REF-002');
  });

  it('an empty authorized list writes no case-read audit event', async () => {
    queue([]);

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cases: [] });
    expect(logRestrictedHrReadEventMock).not.toHaveBeenCalled();
  });

  it('fails closed with a generic 503 when any list read audit cannot be written', async () => {
    queue([CASE_ROW]);
    logRestrictedHrReadEventMock.mockRejectedValueOnce(new Error('audit database unavailable'));

    const res = await listCases(getRequest('http://localhost/api/hr/restricted-cases'));

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Unable to record restricted HR access.' });
    expect(text).not.toContain('Sensitive grievance title');
    expect(text).not.toContain('PRIVATE-REF-001');
    expect(text).not.toContain('grievance');
    expect(logRestrictedHrReadEventMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/hr/restricted-cases', () => {
  it('denies an ordinary user before any restricted-case write', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);

    const res = await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      { case_type: 'grievance', title: 'Case title' },
    ));

    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('allows an HR administrator to create a case without implicitly creating a read grant', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{
      id: CASE_ID,
      status: 'open',
      opened_by: 'user-a',
      created_at: '2026-09-25T00:00:00.000Z',
    }]);

    const res = await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      {
        case_type: 'investigation',
        title: '  Sensitive title  ',
        reference: '  REF-42  ',
      },
    ));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      case: {
        id: CASE_ID,
        status: 'open',
        created_at: '2026-09-25T00:00:00.000Z',
      },
    });
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(calls[0].text).toContain('INSERT INTO hr_restricted_cases');
    expect(calls[0].text).not.toContain('INSERT INTO hr_restricted_case_access');
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain('user-a');
    expect(calls[0].values).toContain('Sensitive title');
    expect(calls[0].values).toContain('REF-42');
  });

  it('derives opened_by and active organisation from a super_admin override session', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    queue([{
      id: CASE_ID,
      status: 'open',
      opened_by: 'founder-user',
      created_at: '2026-09-25T00:00:00.000Z',
    }]);

    const res = await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      { case_type: 'other', title: 'Case title' },
    ));

    expect(res.status).toBe(201);
    expect(calls[0].values).toContain('org-a');
    expect(calls[0].values).toContain('founder-user');
    expect(calls[0].values).not.toContain('founder-org');
  });

  it('rejects client attempts to supply organisation, actor or lifecycle authority fields', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);

    for (const field of ['organisation_id', 'opened_by', 'status', 'closed_at']) {
      const res = await createCase(jsonRequest(
        'http://localhost/api/hr/restricted-cases',
        { case_type: 'grievance', title: 'Case title', [field]: 'attacker-value' },
      ));
      expect(res.status).toBe(400);
    }

    expect(sqlMock).not.toHaveBeenCalled();
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('validates the locked case type vocabulary and required title', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);

    const badType = await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      { case_type: 'performance', title: 'Case title' },
    ));
    expect(badType.status).toBe(400);

    const badTitle = await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      { case_type: 'grievance', title: '   ' },
    ));
    expect(badTitle.status).toBe(400);

    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('audits creation with metadata only and never the title or reference', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{
      id: CASE_ID,
      status: 'open',
      opened_by: 'user-a',
      created_at: '2026-09-25T00:00:00.000Z',
    }]);

    await createCase(jsonRequest(
      'http://localhost/api/hr/restricted-cases',
      { case_type: 'disciplinary', title: 'Secret narrative', reference: 'SECRET-REF' },
    ));

    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [actor, entry] = logHrEventMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(actor).toMatchObject({ organisationId: 'org-a', userId: 'user-a' });
    expect(entry).toEqual({
      action: 'hr_restricted_case.created',
      resourceType: 'hr_restricted_case',
      resourceId: CASE_ID,
      afterState: { status: 'open', opened_by: 'user-a' },
    });
    const auditArgs = JSON.stringify(logHrEventMock.mock.calls);
    expect(auditArgs).not.toContain('Secret narrative');
    expect(auditArgs).not.toContain('SECRET-REF');
    expect(auditArgs).not.toContain('disciplinary');
  });
});

describe('GET /api/hr/restricted-cases/[id]', () => {
  it('returns the canonical authorization denial unchanged and writes no read audit', async () => {
    requireRestrictedCaseMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: 'Restricted HR case not found.' },
        { status: 404 },
      ),
    });

    const res = await getCase(
      getRequest(`http://localhost/api/hr/restricted-cases/${CASE_ID}`),
      paramsFor(CASE_ID),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Restricted HR case not found.' });
    expect(requireRestrictedCaseMock).toHaveBeenCalledWith(SESSION, CASE_ID);
    expect(logRestrictedHrReadEventMock).not.toHaveBeenCalled();
  });

  it('returns an authorized case and audits the successful read with metadata only', async () => {
    requireRestrictedCaseMock.mockResolvedValue({
      ok: true,
      case: {
        id: CASE_ID,
        organisationId: 'org-a',
        caseType: 'grievance',
        status: 'open',
        title: 'Highly sensitive title',
        reference: 'HIGHLY-SENSITIVE-REF',
        openedBy: 'user-opener',
        closedAt: null,
        createdAt: '2026-09-25T00:00:00.000Z',
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
      auth: {
        case: { id: CASE_ID, organisationId: 'org-a' },
        via: 'live_case_grant',
      },
      ctx: {
        userId: 'user-a',
        organisationId: 'org-a',
        homeOrganisationId: 'org-a',
        role: 'manager',
      },
    });

    const res = await getCase(
      getRequest(`http://localhost/api/hr/restricted-cases/${CASE_ID}`),
      paramsFor(CASE_ID),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.title).toBe('Highly sensitive title');
    expect(body.case.reference).toBe('HIGHLY-SENSITIVE-REF');
    expect(logRestrictedHrReadEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logRestrictedHrReadEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toEqual({
      action: 'hr_restricted_case.read',
      resourceType: 'hr_restricted_case',
      resourceId: CASE_ID,
      afterState: { status: 'open', opened_by: 'user-opener' },
    });
    const auditArgs = JSON.stringify(logRestrictedHrReadEventMock.mock.calls);
    expect(auditArgs).not.toContain('Highly sensitive title');
    expect(auditArgs).not.toContain('HIGHLY-SENSITIVE-REF');
    expect(auditArgs).not.toContain('grievance');
  });

  it('fails closed with a generic 503 and does not disclose case data when read audit storage fails', async () => {
    requireRestrictedCaseMock.mockResolvedValue({
      ok: true,
      case: {
        id: CASE_ID,
        organisationId: 'org-a',
        caseType: 'grievance',
        status: 'open',
        title: 'DO-NOT-DISCLOSE-TITLE',
        reference: 'DO-NOT-DISCLOSE-REF',
        openedBy: 'user-opener',
        closedAt: null,
        createdAt: '2026-09-25T00:00:00.000Z',
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
      auth: { case: { id: CASE_ID, organisationId: 'org-a' }, via: 'live_case_grant' },
      ctx: { userId: 'user-a', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'manager' },
    });
    logRestrictedHrReadEventMock.mockRejectedValueOnce(new Error('audit database unavailable'));

    const res = await getCase(
      getRequest(`http://localhost/api/hr/restricted-cases/${CASE_ID}`),
      paramsFor(CASE_ID),
    );

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Unable to record restricted HR access.' });
    expect(text).not.toContain('DO-NOT-DISCLOSE-TITLE');
    expect(text).not.toContain('DO-NOT-DISCLOSE-REF');
    expect(text).not.toContain('grievance');
  });

  it('does not run restricted-case authorization when People capability is denied', async () => {
    requireHrCapabilityMock.mockRejectedValue(new Error('No People capability'));

    const res = await getCase(
      getRequest(`http://localhost/api/hr/restricted-cases/${CASE_ID}`),
      paramsFor(CASE_ID),
    );

    expect(res.status).toBe(403);
    expect(requireRestrictedCaseMock).not.toHaveBeenCalled();
    expect(logRestrictedHrReadEventMock).not.toHaveBeenCalled();
  });
});
