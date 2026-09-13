import { describe, it, expect, vi, beforeEach } from 'vitest';

// HR-1 — direct unit coverage for lib/hr/context.ts's
// resolveHrAccessContext(), the ONLY place HR-1 resolves selfPersonId
// (from hr_people.linked_user_id) and isHrAdministrator (from
// hr_administrators). Proves the Critical Domain Rule directly: no
// email/name/phone matching occurs here — only an explicit
// linked_user_id row, scoped to the caller's own organisation.
//
// HR-2 — resolveHrAccessContext() now also accepts `role`. For every
// role below, non-super_admin behavior is byte-for-byte unchanged from
// HR-1 (hence 'manager' as the non-super_admin role used throughout —
// any non-super_admin role behaves identically here). The dedicated
// 'HR-2 — super_admin full HR access' describe block below covers the
// new behavior.

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
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    expect(ctx.selfPersonId).toBe('person-1');
    expect(ctx.organisationId).toBe('org-a');
  });

  it('resolves selfPersonId to null when no hr_people row is explicitly linked to this user', async () => {
    queue([], []);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    expect(ctx.selfPersonId).toBeNull();
  });

  it('resolves isHrAdministrator true only when an hr_administrators row exists for this org+user', async () => {
    queue([], [{ id: 'admin-grant-1' }]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    expect(ctx.isHrAdministrator).toBe(true);
  });

  it('resolves isHrAdministrator false when no hr_administrators row exists', async () => {
    queue([], []);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    expect(ctx.isHrAdministrator).toBe(false);
  });

  it('hasRestrictedHrAccess is always false for a non-super_admin — no restricted-HR grant mechanism exists yet in HR-1', async () => {
    queue([{ id: 'person-1' }], [{ id: 'admin-grant-1' }]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    expect(ctx.hasRestrictedHrAccess).toBe(false);
  });

  it('both lookups are scoped to organisation_id — never a bare linked_user_id/user_id match across organisations', async () => {
    queue([], []);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    for (const call of calls) {
      expect(call.text).toContain('organisation_id');
      expect(call.values).toContain('org-a');
    }
  });

  it('never queries by email, name, or phone — only linked_user_id/user_id (the Critical Domain Rule)', async () => {
    queue([], []);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'manager' });
    for (const call of calls) {
      expect(call.text).not.toMatch(/email|first_name|last_name|phone/i);
    }
  });
});

describe('HR-2 — super_admin full HR access', () => {
  it('resolves isHrAdministrator: true for super_admin with ZERO hr_administrators rows', async () => {
    queue([]); // only selfRows is queued — the hr_administrators query is skipped entirely for super_admin
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(ctx.isHrAdministrator).toBe(true);
  });

  it('resolves hasRestrictedHrAccess: true for super_admin', async () => {
    queue([]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(ctx.hasRestrictedHrAccess).toBe(true);
  });

  it('never issues the hr_administrators query for super_admin — the authority is computed, not read from a grant row', async () => {
    queue([]);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(sqlMock).toHaveBeenCalledTimes(1); // selfRows only
    expect(calls.some(c => c.text.includes('hr_administrators'))).toBe(false);
  });

  it('the active organisationId passed in is preserved exactly — never a different/home organisation', async () => {
    queue([]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-b', userId: 'user-1', role: 'super_admin' });
    expect(ctx.organisationId).toBe('org-b');
    // The one query super_admin still issues (selfRows) is scoped to
    // this exact organisationId, not a different one.
    expect(calls[0].values).toContain('org-b');
  });

  it('selfPersonId resolution remains normal for super_admin — a linked hr_people row still resolves', async () => {
    queue([{ id: 'person-42' }]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(ctx.selfPersonId).toBe('person-42');
  });

  it('selfPersonId resolves to null for a super_admin with no linked hr_people row (the common case)', async () => {
    queue([]);
    const ctx = await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(ctx.selfPersonId).toBeNull();
  });

  it('no hr_administrators row is ever inserted as a side effect of resolving a super_admin context', async () => {
    queue([]);
    await resolveHrAccessContext({ organisationId: 'org-a', userId: 'user-1', role: 'super_admin' });
    expect(calls.every(c => !/INSERT|UPDATE|DELETE/i.test(c.text))).toBe(true);
  });
});
