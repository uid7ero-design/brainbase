import { describe, it, expect, vi, beforeEach } from 'vitest';

// HR-1 — direct unit coverage for lib/hr/context.ts's
// resolveHrAccessContext(), the ONLY place HR-1 resolves selfPersonId
// (from hr_people.linked_user_id) and isHrAdministrator (from
// hr_administrators). Proves the Critical Domain Rule directly: no
// email/name/phone matching occurs here — only an explicit
// linked_user_id row, scoped to the caller's own organisation.

let responseQueue: unknown[][] = [];
let callCount = 0;
const calls: { text: string; values: unknown[] }[] = [];
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

const { resolveHrAccessContext } = await import('@/lib/hr/context');

beforeEach(() => {
  sqlMock.mockClear();
  calls.length = 0;
  responseQueue = [];
  callCount = 0;
});

describe('resolveHrAccessContext', () => {
  it('resolves selfPersonId from an explicitly linked hr_people row, scoped to the caller\'s own organisation', async () => {
    queue([{ id: 'person-1' }], []);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    expect(ctx.selfPersonId).toBe('person-1');
    expect(ctx.organisationId).toBe('org-a');
  });

  it('resolves selfPersonId to null when no hr_people row is explicitly linked to this user', async () => {
    queue([], []);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    expect(ctx.selfPersonId).toBeNull();
  });

  it('resolves isHrAdministrator true only when an hr_administrators row exists for this org+user', async () => {
    queue([], [{ id: 'admin-grant-1' }]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    expect(ctx.isHrAdministrator).toBe(true);
  });

  it('resolves isHrAdministrator false when no hr_administrators row exists', async () => {
    queue([], []);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    expect(ctx.isHrAdministrator).toBe(false);
  });

  it('hasRestrictedHrAccess is always false — no restricted-HR grant mechanism exists yet in HR-1', async () => {
    queue([{ id: 'person-1' }], [{ id: 'admin-grant-1' }]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    expect(ctx.hasRestrictedHrAccess).toBe(false);
  });

  it('both lookups are scoped to organisation_id — never a bare linked_user_id/user_id match across organisations', async () => {
    queue([], []);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    for (const call of calls) {
      expect(call.text).toContain('organisation_id');
      expect(call.values).toContain('org-a');
    }
  });

  it('never queries by email, name, or phone — only linked_user_id/user_id (the Critical Domain Rule)', async () => {
    queue([], []);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1' });
    for (const call of calls) {
      expect(call.text).not.toMatch(/email|first_name|last_name|phone/i);
    }
  });
});
