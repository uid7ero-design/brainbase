import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-0.5 §3 — regression coverage for lib/org.ts's requireSession(). HR-0
// confirmed this DB-authoritative check re-reads id/organisation_id/role
// on every call but never re-checked users.status, so disabling a user in
// the DB did not revoke an existing session via the one authoritative
// path. This suite proves the fix, using the same mocking convention as
// tests/containment/crmBackfillImpersonationAuthChain.test.ts (the real,
// unmocked requireSession(), with only its own dependencies — getSession,
// sql, cookies — mocked).

const getSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) };
});

let responseQueue: unknown[][] = [];
let callCount = 0;
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []));
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  }),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

const { requireSession, requireRole } = await import('@/lib/org');

beforeEach(() => {
  getSessionMock.mockReset();
  sqlMock.mockClear();
  cookieStore.clear();
  responseQueue = [];
  callCount = 0;
});

const baseSession = { userId: 'user-1', organisationId: 'org-1', role: 'manager', name: 'A User' };

describe('requireSession() — status enforcement', () => {
  it('an ACTIVE user succeeds', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager', status: 'ACTIVE' }]);

    const session = await requireSession();
    expect(session.userId).toBe('user-1');
    expect(session.role).toBe('manager');
  });

  it('an INACTIVE user is rejected', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager', status: 'INACTIVE' }]);

    await expect(requireSession()).rejects.toThrow('Session invalid');
  });

  it('an INVITED (not-yet-activated) user is rejected — not treated as session-valid', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager', status: 'INVITED' }]);

    await expect(requireSession()).rejects.toThrow('Session invalid');
  });

  it('status comparison is case-insensitive (a lowercase DB value is still rejected if not active)', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager', status: 'inactive' }]);

    await expect(requireSession()).rejects.toThrow('Session invalid');
  });

  it('a missing status field (pre-existing test doubles / unbackfilled rows) does not spuriously reject — only a POSITIVE non-active value does', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager' }]); // no status key at all

    const session = await requireSession();
    expect(session.userId).toBe('user-1');
  });

  it('the rejection message for an inactive user is identical to the existing cross-org-switch rejection, so a caller cannot distinguish the reason from the error text', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'manager', status: 'INACTIVE' }]);
    let inactiveMsg = '';
    try { await requireSession(); } catch (e) { inactiveMsg = (e as Error).message; }

    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-2', role: 'manager', status: 'ACTIVE' }]); // org drift
    let orgDriftMsg = '';
    try { await requireSession(); } catch (e) { orgDriftMsg = (e as Error).message; }

    expect(inactiveMsg).toBe('Session invalid');
    expect(orgDriftMsg).toBe('Session invalid');
  });

  it('role reassignment protection still works (a role change takes effect immediately, unrelated to this fix)', async () => {
    getSessionMock.mockResolvedValue({ ...baseSession, role: 'manager' });
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'super_admin', status: 'ACTIVE' }]);

    const session = await requireSession();
    expect(session.role).toBe('super_admin');
  });

  it('organisation reassignment protection still works (still rejects on org drift, independent of status)', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([{ id: 'user-1', organisation_id: 'org-2', role: 'manager', status: 'ACTIVE' }]);

    await expect(requireSession()).rejects.toThrow('Session invalid');
  });

  it('a missing/deleted user still fails with Unauthorized', async () => {
    getSessionMock.mockResolvedValue(baseSession);
    queue([]); // no row returned

    await expect(requireSession()).rejects.toThrow('Unauthorized');
  });

  it('no session cookie at all still fails with Unauthorized, before any DB call', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(requireSession()).rejects.toThrow('Unauthorized');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('requireRole() rejects an inactive user even if their DB role would otherwise satisfy the threshold', async () => {
    getSessionMock.mockResolvedValue({ ...baseSession, role: 'super_admin' });
    queue([{ id: 'user-1', organisation_id: 'org-1', role: 'super_admin', status: 'INACTIVE' }]);

    await expect(requireRole('super_admin')).rejects.toThrow('Session invalid');
  });

  it('impersonation (org_override) still resolves correctly for an active super_admin, unaffected by the status check', async () => {
    getSessionMock.mockResolvedValue({ userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' });
    cookieStore.set('org_override', 'other-org');
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    const session = await requireSession();
    expect(session.organisationId).toBe('other-org');
    expect(session.homeOrganisationId).toBe('brainbase-org');
  });
});

describe('lib/org.ts source — the SELECT now retrieves status', () => {
  it('requireSession\'s own users lookup selects status alongside id/organisation_id/role', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/org.ts'), 'utf8');
    const selectStart = src.indexOf('SELECT id, organisation_id, role');
    expect(selectStart).toBeGreaterThan(-1);
    expect(src.slice(selectStart, selectStart + 60)).toContain('status');
  });
});

describe('Known alternate session helper that bypasses the authoritative DB check (report only — not fixed in this phase, see HR-0.5 report)', () => {
  function read(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
  }

  it('app/api/admin/users/route.ts authorizes GET/PATCH/DELETE/POST from the raw JWT session (getSession) directly, never calling requireSession()/requireRole() — this regression guard documents the bypass exists so it is not silently reintroduced as "already fixed"', () => {
    // A doc comment in this file mentions requireSession() BY NAME (to
    // explain a role-casing convention it mirrors) without ever importing
    // or calling it — checking for an actual import/call, not the bare
    // word, is what proves the bypass is real rather than a false positive
    // off that comment.
    const src = read('app/api/admin/users/route.ts');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // strip /* */ block comments
      .replace(/\/\/[^\n]*/g, '');        // strip // line comments
    expect(src).toContain("session.role?.toLowerCase() !== 'super_admin'");
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\brequireSession\b/);
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\brequireRole\b/);
    expect(codeOnly).not.toMatch(/\brequireSession\s*\(\)/);
    expect(codeOnly).not.toMatch(/\brequireRole\s*\(/);
  });
});
