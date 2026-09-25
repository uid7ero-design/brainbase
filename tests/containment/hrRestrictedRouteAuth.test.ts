import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

let responseQueue: unknown[][] = [];
let callCount = 0;
const calls: { text: string; values: unknown[] }[] = [];

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

const {
  requireRestrictedCase,
  requireRestrictedCaseAccess,
  restrictedCaseNotFoundResponse,
} = await import('@/lib/hr/restrictedRoute');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE_ID = '22222222-2222-4222-8222-222222222222';

const SESSION: OrgSession = {
  userId: 'user-a',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'User A',
};

const SUPER_ADMIN_SESSION: OrgSession = {
  userId: 'founder-user',
  organisationId: 'org-b',
  homeOrganisationId: 'founder-org',
  role: 'super_admin',
  name: 'Founder',
};

function queue(...responses: unknown[][]) {
  responseQueue = responses;
  callCount = 0;
}

function caseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CASE_ID,
    organisation_id: 'org-a',
    case_type: 'grievance',
    status: 'open',
    title: 'Restricted case',
    reference: null,
    opened_by: 'user-a',
    closed_at: null,
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

async function expectCanonical404(
  result:
    | Awaited<ReturnType<typeof requireRestrictedCase>>
    | Awaited<ReturnType<typeof requireRestrictedCaseAccess>>,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected a denied result');
  expect(result.response.status).toBe(404);
  expect(await result.response.json()).toEqual({
    error: 'Restricted HR case not found.',
  });
}

beforeEach(() => {
  sqlMock.mockClear();
  calls.length = 0;
  responseQueue = [];
  callCount = 0;
});

describe('canonical restricted-case 404', () => {
  it('is byte-for-byte stable at the route boundary', async () => {
    const response = restrictedCaseNotFoundResponse();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Restricted HR case not found.',
    });
  });
});

describe('requireRestrictedCase / requireRestrictedCaseAccess', () => {
  it('maps a malformed UUID directly to the canonical 404 without querying Postgres', async () => {
    const result = await requireRestrictedCase(SESSION, 'not-a-uuid');

    await expectCanonical404(result);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps a case missing from the active organisation to the canonical 404', async () => {
    queue([]);

    const result = await requireRestrictedCase(SESSION, CASE_ID);

    await expectCanonical404(result);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(calls[0].text).toContain('c.organisation_id = ?');
    expect(calls[0].values).toContain('org-a');
  });

  it('maps a wrong-organisation case to the same 404 and never performs a global id-only lookup', async () => {
    // A real row may exist in org-b, but the active-org WHERE predicate means
    // the resolver sees no row at all for org-a.
    queue([]);

    const result = await requireRestrictedCaseAccess(SESSION, OTHER_CASE_ID);

    await expectCanonical404(result);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(calls[0].text).toMatch(/WHERE c\.id = \?::uuid[\s\S]*c\.organisation_id = \?/);
    expect(calls[0].values).toContain(OTHER_CASE_ID);
    expect(calls[0].values).toContain('org-a');
  });

  it('denies an in-org case when this exact user has no live per-case grant', async () => {
    queue([]);

    const result = await requireRestrictedCaseAccess(SESSION, CASE_ID);

    await expectCanonical404(result);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(calls[0].text).toContain('FROM hr_restricted_case_access a');
    expect(calls[0].text).toContain('a.case_id = c.id');
    expect(calls[0].text).toMatch(/AND \([\s\S]*OR EXISTS \(/);
    expect(calls[0].text).toContain('a.user_id = ?');
    expect(calls[0].values).toContain('user-a');
  });

  it('denies a revoked grant because authorization only considers revoked_at IS NULL', async () => {
    // The database CASE/EXISTS expression returns authorized=false when the
    // only matching historical grant is revoked.
    queue([]);

    const result = await requireRestrictedCase(SESSION, CASE_ID);

    await expectCanonical404(result);
    expect(calls[0].text).toContain('a.revoked_at IS NULL');
  });

  it('does not treat HR-administrator status as restricted-case access', async () => {
    // HrRestricted route authorization deliberately accepts OrgSession only;
    // even if a caller object carries an unrelated HR-admin marker, the
    // resolver neither reads it nor queries hr_administrators. Only the live
    // case grant (or super_admin role) can make the row visible.
    const hrAdminShapedSession = {
      ...SESSION,
      role: 'admin',
      isHrAdministrator: true,
    } as unknown as OrgSession;
    queue([]);

    const result = await requireRestrictedCaseAccess(hrAdminShapedSession, CASE_ID);

    await expectCanonical404(result);
    expect(calls[0].text).not.toContain('hr_administrators');
  });

  it('does not treat being a case participant/subject as restricted-case access', async () => {
    // Participant membership is intentionally absent from the authorization
    // query. A subject still needs an exact live access grant.
    queue([]);

    const result = await requireRestrictedCaseAccess(SESSION, CASE_ID);

    await expectCanonical404(result);
    expect(calls[0].text).not.toContain('hr_restricted_case_participants');
  });

  it('authorizes an exact live grant and returns the already-authorized case row with one DB call', async () => {
    queue([
      caseRow(),
    ]);

    const result = await requireRestrictedCase(SESSION, CASE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected authorization success');
    expect(result.auth.via).toBe('live_case_grant');
    expect(result.auth.case).toEqual({ id: CASE_ID, organisationId: 'org-a' });
    expect(result.case.id).toBe(CASE_ID);
    expect(result.case.organisationId).toBe('org-a');
    expect(result.ctx.userId).toBe('user-a');
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('authorization-only wrapper uses the same one-query resolver and returns no case payload', async () => {
    queue([
      caseRow(),
    ]);

    const result = await requireRestrictedCaseAccess(SESSION, CASE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected authorization success');
    expect(result.auth.via).toBe('live_case_grant');
    expect('case' in result).toBe(false);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('regression: each public wrapper performs exactly one database lookup and neither issues a duplicate case query', async () => {
    queue(
      [caseRow()],
      [caseRow()],
    );

    const fullResult = await requireRestrictedCase(SESSION, CASE_ID);
    expect(fullResult.ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(1);

    const accessResult = await requireRestrictedCaseAccess(SESSION, CASE_ID);
    expect(accessResult.ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(2);

    // One SQL statement per wrapper call, with the case row and live-grant
    // authorization resolved together. A regression to "authorize, then
    // fetch the case again" would make either wrapper add a second call.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect((call.text.match(/FROM hr_restricted_cases c/g) ?? [])).toHaveLength(1);
      expect(call.text).toContain('FROM hr_restricted_case_access a');
      expect(call.text).toContain('c.organisation_id = ?');
      expect(call.values).toContain(CASE_ID);
      expect(call.values).toContain('org-a');
    }
  });
  it('allows super_admin under org override only after the case matches the active organisation', async () => {
    queue([
      caseRow({ organisation_id: 'org-b' }),
    ]);

    const result = await requireRestrictedCase(SUPER_ADMIN_SESSION, CASE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected super_admin authorization');
    expect(result.auth.via).toBe('super_admin');
    expect(result.case.organisationId).toBe('org-b');
    expect(result.ctx.homeOrganisationId).toBe('founder-org');
    expect(result.ctx.organisationId).toBe('org-b');
    expect(calls[0].values).toContain(true);
    expect(calls[0].values).toContain('org-b');
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('still returns the canonical 404 to super_admin when the case is outside the active org', async () => {
    queue([]);

    const result = await requireRestrictedCase(
      SUPER_ADMIN_SESSION,
      OTHER_CASE_ID,
    );

    await expectCanonical404(result);
    expect(calls[0].values).toContain('org-b');
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
