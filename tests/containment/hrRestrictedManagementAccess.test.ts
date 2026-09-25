import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgSession } from '@/lib/org';

let responseQueue: unknown[][] = [];
let callCount = 0;
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  void strings;
  void values;
  return Promise.resolve(responseQueue[callCount++] ?? []);
});

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(
      ...(args as [TemplateStringsArray, ...unknown[]]),
    ),
}));

const { canManageRestrictedCaseAccess } = await import(
  '@/lib/hr/restrictedAccess'
);
const { requireRestrictedCaseAccess } = await import(
  '@/lib/hr/restrictedRoute'
);

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const BASE_SESSION: OrgSession = {
  userId: 'user-a',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'User A',
};

beforeEach(() => {
  sqlMock.mockClear();
  responseQueue = [];
  callCount = 0;
});

describe('canManageRestrictedCaseAccess', () => {
  it('allows an HR administrator to manage restricted-case grants', () => {
    expect(canManageRestrictedCaseAccess(BASE_SESSION, true)).toBe(true);
  });

  it('allows super_admin to manage restricted-case grants without an hr_administrators row', () => {
    const session: OrgSession = {
      ...BASE_SESSION,
      role: 'super_admin',
      organisationId: 'org-school',
      homeOrganisationId: 'founder-org',
    };

    expect(canManageRestrictedCaseAccess(session, false)).toBe(true);
  });

  it.each(['admin', 'manager', 'viewer', 'analyst'] as const)(
    'denies ordinary role %s when the caller is not an HR administrator',
    (role) => {
      const session: OrgSession = { ...BASE_SESSION, role };
      expect(canManageRestrictedCaseAccess(session, false)).toBe(false);
    },
  );

  it('keeps management authority separate from restricted-case read access', async () => {
    const hrAdminSession: OrgSession = {
      ...BASE_SESSION,
      role: 'admin',
    };

    expect(canManageRestrictedCaseAccess(hrAdminSession, true)).toBe(true);

    // The same HR administrator still has no read access unless the exact
    // case has a live grant. The hardened SQL WHERE predicate returns zero
    // rows, which must remain the canonical 404.
    responseQueue = [[]];

    const readResult = await requireRestrictedCaseAccess(
      hrAdminSession,
      CASE_ID,
    );

    expect(readResult.ok).toBe(false);
    if (readResult.ok) throw new Error('Expected restricted read denial');
    expect(readResult.response.status).toBe(404);
    expect(await readResult.response.json()).toEqual({
      error: 'Restricted HR case not found.',
    });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
