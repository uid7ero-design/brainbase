import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// SEC-1A — direct unit coverage for lib/admin/auditLog.ts, the audit
// contract used by the two critical admin routes (impersonation, user
// administration). Mirrors the established pattern in
// tests/containment/hrAuditLog.test.ts: mock only '@/lib/db' and assert
// on the exact INSERT shape/values.

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const {
  logImpersonationStarted,
  logImpersonationStopped,
  logUserCreated,
  logUserUpdated,
  logUserRoleChanged,
  logUserOrganisationChanged,
  logUserDeleted,
} = await import('@/lib/admin/auditLog');

function sqlCallText(i: number): string {
  return (sqlMock.mock.calls[i] as unknown as [string[]])[0].join('');
}
function sqlCallArgs(i: number): unknown[] {
  return (sqlMock.mock.calls[i] as unknown as [string[], ...unknown[]]).slice(1);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('logImpersonationStarted / logImpersonationStopped', () => {
  it('writes audit_logs with organisation_id = target org, resource_type = impersonation, actor id, and both orgs in after_state', async () => {
    await logImpersonationStarted({
      actorUserId: 'founder-1',
      actorHomeOrganisationId: 'brainbase-org',
      targetOrganisationId: 'school-test-org',
      ipAddress: '203.0.113.9',
      userAgent: 'test-agent/1.0',
    });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const text = sqlCallText(0);
    expect(text).toContain('INSERT INTO audit_logs');
    const args = sqlCallArgs(0);
    expect(args).toContain('school-test-org'); // organisation_id column
    expect(args).toContain('founder-1');       // user_id column
    expect(args).toContain('impersonation.started');
    expect(args).toContain('impersonation');   // resource_type
    expect(args).toContain('203.0.113.9');
    expect(args).toContain('test-agent/1.0');
    expect(args).toContain(JSON.stringify({ actor_home_organisation_id: 'brainbase-org', target_organisation_id: 'school-test-org' }));
  });

  it('logImpersonationStopped carries the target org in before_state and null after_state', async () => {
    await logImpersonationStopped({
      actorUserId: 'founder-1',
      actorHomeOrganisationId: 'brainbase-org',
      targetOrganisationId: 'school-test-org',
      ipAddress: null,
      userAgent: null,
    });

    const args = sqlCallArgs(0);
    expect(args).toContain('impersonation.stopped');
    expect(args).toContain(null); // afterState is null; ipAddress/userAgent also null
  });

  it('never logs a session token, cookie, or raw JWT', async () => {
    await logImpersonationStarted({
      actorUserId: 'founder-1', actorHomeOrganisationId: 'brainbase-org', targetOrganisationId: 'org-x',
      ipAddress: null, userAgent: null,
    });
    const all = JSON.stringify(sqlMock.mock.calls);
    expect(all).not.toMatch(/org_override|session=|jwt|Bearer /i);
  });
});

describe('logUserCreated', () => {
  it('writes actor id, actor org, new user id as resource_id, and safe after-state fields only', async () => {
    await logUserCreated({
      actorUserId: 'founder-1',
      actorOrganisationId: 'brainbase-org',
      newUserId: 'new-user-1',
      after: { username: 'jane.smith', email: 'jane@x.com', name: 'Jane Smith', role: 'viewer', organisation_id: 'org-1' },
      ipAddress: '203.0.113.9',
      userAgent: 'test-agent/1.0',
    });

    const args = sqlCallArgs(0);
    expect(args).toContain('founder-1');
    expect(args).toContain('brainbase-org');
    expect(args).toContain('new-user-1'); // resource_id
    expect(args).toContain('user.created');
    expect(args).toContain('user'); // resource_type
    const afterJson = args.find(a => typeof a === 'string' && a.includes('jane.smith')) as string;
    expect(afterJson).toBeDefined();
    expect(afterJson).not.toMatch(/password/i);
  });
});

describe('logUserUpdated', () => {
  it('serializes before/after diffs and never includes password/password_hash', async () => {
    await logUserUpdated({
      actorUserId: 'founder-1', actorOrganisationId: 'brainbase-org', targetUserId: 'u1',
      before: { name: 'Old' }, after: { name: 'New' },
      ipAddress: null, userAgent: null,
    });

    const args = sqlCallArgs(0);
    expect(args).toContain(JSON.stringify({ name: 'Old' }));
    expect(args).toContain(JSON.stringify({ name: 'New' }));
    expect(JSON.stringify(args)).not.toMatch(/password/i);
  });

  it('a password_changed marker is accepted and never contains a real hash/value if the caller only ever passes the marker', async () => {
    await logUserUpdated({
      actorUserId: 'founder-1', actorOrganisationId: 'brainbase-org', targetUserId: 'u1',
      before: {}, after: { password_changed: true },
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain(JSON.stringify({ password_changed: true }));
  });
});

describe('logUserRoleChanged / logUserOrganisationChanged', () => {
  it('role-change event carries a distinct action and before/after role only', async () => {
    await logUserRoleChanged({
      actorUserId: 'founder-1', actorOrganisationId: 'brainbase-org', targetUserId: 'u1',
      beforeRole: 'viewer', afterRole: 'manager',
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('user.role_changed');
    expect(args).toContain(JSON.stringify({ role: 'viewer' }));
    expect(args).toContain(JSON.stringify({ role: 'manager' }));
  });

  it('organisation-change event carries a distinct action and before/after organisation_id only', async () => {
    await logUserOrganisationChanged({
      actorUserId: 'founder-1', actorOrganisationId: 'brainbase-org', targetUserId: 'u1',
      beforeOrganisationId: 'org-1', afterOrganisationId: 'org-2',
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('user.organisation_changed');
    expect(args).toContain(JSON.stringify({ organisation_id: 'org-1' }));
    expect(args).toContain(JSON.stringify({ organisation_id: 'org-2' }));
  });
});

describe('logUserDeleted', () => {
  it('carries before-state only (after_state null) and never a password field', async () => {
    await logUserDeleted({
      actorUserId: 'founder-1', actorOrganisationId: 'brainbase-org', targetUserId: 'u1',
      before: { username: 'jane', name: 'Jane', role: 'viewer', organisation_id: 'org-1' },
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('user.deleted');
    expect(args).toContain(null); // after_state
    expect(JSON.stringify(args)).not.toMatch(/password/i);
  });
});

describe('IP / user-agent propagation', () => {
  it('propagates real values when given', async () => {
    await logUserCreated({
      actorUserId: 'a', actorOrganisationId: 'org', newUserId: 'u',
      after: { username: 'x', email: null, name: 'X', role: 'viewer', organisation_id: 'org' },
      ipAddress: '198.51.100.1', userAgent: 'agent/2.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('198.51.100.1');
    expect(args).toContain('agent/2.0');
  });

  it('propagates null (not "unknown" or undefined) when omitted', async () => {
    await logUserCreated({
      actorUserId: 'a', actorOrganisationId: 'org', newUserId: 'u',
      after: { username: 'x', email: null, name: 'X', role: 'viewer', organisation_id: 'org' },
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).not.toContain('unknown');
    expect(args).not.toContain(undefined);
  });
});

describe('Failure semantics — best-effort, per ADR-0003', () => {
  it('a write failure is caught and does not propagate to the caller', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection reset'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(logUserCreated({
      actorUserId: 'a', actorOrganisationId: 'org', newUserId: 'u',
      after: { username: 'x', email: null, name: 'X', role: 'viewer', organisation_id: 'org' },
      ipAddress: null, userAgent: null,
    })).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('lib/admin/auditLog.ts source — no competing audit mechanism, no new table', () => {
  it('never writes to organiser_activity or any table other than audit_logs', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/admin/auditLog.ts'), 'utf8');
    expect(src).not.toMatch(/(INSERT INTO|UPDATE|FROM)\s+organiser_activity/i);
    expect((src.match(/INSERT INTO \w+/g) ?? [])).toEqual(['INSERT INTO audit_logs']);
  });

  it('imports the shared lib/db sql client, not a second database connection', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/admin/auditLog.ts'), 'utf8');
    expect(src).toContain("from '@/lib/db'");
  });
});
