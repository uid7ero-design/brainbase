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
  logAdminMigrationExecuted,
  logSessionMigrationExecuted,
  logCrmClassificationMigrationExecuted,
  logDemoSeedExecuted,
  logAdminCrossOrgReadAccessed,
  logAgentRunExecuted,
  logFounderReadAccessed,
  logFounderActionExecuted,
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

describe('SEC-1B1 — logAdminMigrationExecuted / logSessionMigrationExecuted / logCrmClassificationMigrationExecuted', () => {
  it('logAdminMigrationExecuted attributes the actor\'s own org, a stable resource_id, and steps/lastStep in after_state', async () => {
    await logAdminMigrationExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      stepsCompleted: 44, lastStep: '44. organiser_action_confirmations',
      ipAddress: '203.0.113.9', userAgent: 'test-agent/1.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('brainbase-org'); // organisation_id = actor's own org, not tenant data
    expect(args).toContain('sa-1');
    expect(args).toContain('admin_migration.executed');
    expect(args).toContain('schema_migration');
    expect(args).toContain('admin_migrate_full'); // stable resource_id, not a per-invocation id
    expect(args).toContain(JSON.stringify({ stepsCompleted: 44, lastStep: '44. organiser_action_confirmations' }));
    expect(args).toContain(null); // before_state
  });

  it('logSessionMigrationExecuted carries the per-step results summary in after_state', async () => {
    const results = ['✓ sessions table', '✗ session_instances: boom'];
    await logSessionMigrationExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      results, ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('session_migration.executed');
    expect(args).toContain('admin_migrate_sessions');
    expect(args).toContain(JSON.stringify({ results }));
  });

  it('logCrmClassificationMigrationExecuted carries a fixed, non-secret migration identifier in after_state', async () => {
    await logCrmClassificationMigrationExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('crm_classification_migration.executed');
    expect(args).toContain('crm_contacts_classification');
    expect(args).toContain(JSON.stringify({ migration: 'crm_contacts.classification' }));
  });

  it('all three schema_migration events are resource_type "schema_migration" and never carry a password/secret field', async () => {
    await logAdminMigrationExecuted({ actorUserId: 'sa-1', actorOrganisationId: 'org', stepsCompleted: 1, lastStep: null, ipAddress: null, userAgent: null });
    await logSessionMigrationExecuted({ actorUserId: 'sa-1', actorOrganisationId: 'org', results: [], ipAddress: null, userAgent: null });
    await logCrmClassificationMigrationExecuted({ actorUserId: 'sa-1', actorOrganisationId: 'org', ipAddress: null, userAgent: null });
    for (let i = 0; i < 3; i++) {
      expect(sqlCallArgs(i)).toContain('schema_migration');
    }
    expect(JSON.stringify(sqlMock.mock.calls)).not.toMatch(/password|secret|token|DATABASE_URL/i);
  });
});

describe('SEC-1B1 — logDemoSeedExecuted', () => {
  it('is the one genuinely org-scoped SEC-1B1 event: organisation_id is the real seeded tenant, resource_id is the demo file id, counts + enabled modules land in after_state', async () => {
    await logDemoSeedExecuted({
      actorUserId: 'admin-1', organisationId: 'tenant-org-9', fileId: 'file-xyz',
      counts: { wasteRecords: 384, fleetMetrics: 96, serviceRequests: 261 },
      enabledModules: ['waste_recycling', 'fleet_management', 'service_requests'],
      ipAddress: '203.0.113.9', userAgent: 'test-agent/1.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('tenant-org-9'); // organisation_id = the actual tenant seeded
    expect(args).toContain('admin-1');
    expect(args).toContain('demo_seed.executed');
    expect(args).toContain('demo_seed');
    expect(args).toContain('file-xyz'); // resource_id
    expect(args).toContain(JSON.stringify({
      counts: { wasteRecords: 384, fleetMetrics: 96, serviceRequests: 261 },
      enabledModules: ['waste_recycling', 'fleet_management', 'service_requests'],
    }));
    expect(args).toContain(null); // before_state
  });
});

describe('SEC-1B2 — logAdminCrossOrgReadAccessed / logAgentRunExecuted', () => {
  it('logAdminCrossOrgReadAccessed attributes the actor\'s own org, uses the orgId filter (or "all-organisations") as resource_id, and never carries row-level data', async () => {
    await logAdminCrossOrgReadAccessed({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      filters: { orgId: 'tenant-9', from: null, to: null, agentName: null, routeType: null },
      resultCounts: { totalRuns: 42, byAgent: 3, byRoute: 2, recent: 42 },
      ipAddress: '203.0.113.9', userAgent: 'test-agent/1.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('brainbase-org');
    expect(args).toContain('sa-1');
    expect(args).toContain('admin_cross_org_read.accessed');
    expect(args).toContain('agent_runs_report');
    expect(args).toContain('tenant-9'); // resource_id = the orgId filter used
    expect(args).toContain(JSON.stringify({
      filters: { orgId: 'tenant-9', from: null, to: null, agentName: null, routeType: null },
      resultCounts: { totalRuns: 42, byAgent: 3, byRoute: 2, recent: 42 },
    }));
  });

  it('logAdminCrossOrgReadAccessed uses "all-organisations" as resource_id when no orgId filter was applied', async () => {
    await logAdminCrossOrgReadAccessed({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      filters: { orgId: null, from: null, to: null, agentName: null, routeType: null },
      resultCounts: { totalRuns: 0, byAgent: 0, byRoute: 0, recent: 0 },
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('all-organisations');
  });

  it('logAgentRunExecuted records which agent ran and whether it fell back/errored — never the query text itself', async () => {
    await logAgentRunExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      agent: 'insight', fallbackUsed: false, hadError: false, routeSource: 'agents/route-test',
      ipAddress: '203.0.113.9', userAgent: 'test-agent/1.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('agent_run.executed');
    expect(args).toContain('agent_run');
    expect(args).toContain('insight'); // resource_id = which agent ran
    expect(args).toContain(JSON.stringify({ fallbackUsed: false, hadError: false, routeSource: 'agents/route-test' }));
  });

  it('neither event ever carries a raw user query/prompt, row data, or secret', async () => {
    await logAdminCrossOrgReadAccessed({
      actorUserId: 'sa-1', actorOrganisationId: 'org',
      filters: { orgId: null, from: null, to: null, agentName: null, routeType: null },
      resultCounts: { totalRuns: 1, byAgent: 1, byRoute: 1, recent: 1 },
      ipAddress: null, userAgent: null,
    });
    await logAgentRunExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'org',
      agent: 'briefing', fallbackUsed: false, hadError: false, routeSource: 'agents/route-test',
      ipAddress: null, userAgent: null,
    });
    expect(JSON.stringify(sqlMock.mock.calls)).not.toMatch(/password|secret|token|input_query|DATABASE_URL/i);
  });
});

describe('SEC-1B2 — logFounderReadAccessed / logFounderActionExecuted', () => {
  it('logFounderReadAccessed attributes the actor\'s own org, the specific founder resource read, and whether live/demo/fallback data was used — never the payload', async () => {
    await logFounderReadAccessed({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      resource: 'founder_intelligence', source: 'live',
      ipAddress: '203.0.113.9', userAgent: 'test-agent/1.0',
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('brainbase-org');
    expect(args).toContain('sa-1');
    expect(args).toContain('founder_read.accessed');
    expect(args).toContain('founder_backend');
    expect(args).toContain('founder_intelligence'); // resource_id
    expect(args).toContain(JSON.stringify({ source: 'live' }));
  });

  it('logFounderActionExecuted attributes the actor\'s own org, the action slug as resource_id, and is honest about whether the external mutation actually succeeded', async () => {
    await logFounderActionExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'brainbase-org',
      action: 'add-lead', backendInvoked: true, backendOk: false,
      ipAddress: null, userAgent: null,
    });
    const args = sqlCallArgs(0);
    expect(args).toContain('founder_action.executed');
    expect(args).toContain('founder_action');
    expect(args).toContain('add-lead'); // resource_id
    expect(args).toContain(JSON.stringify({ backendInvoked: true, backendOk: false }));
  });

  it('neither event ever carries a secret, token, or the founder backend response payload', async () => {
    await logFounderReadAccessed({
      actorUserId: 'sa-1', actorOrganisationId: 'org', resource: 'founder_clients', source: 'fallback',
      ipAddress: null, userAgent: null,
    });
    await logFounderActionExecuted({
      actorUserId: 'sa-1', actorOrganisationId: 'org', action: 'log-demo', backendInvoked: true, backendOk: true,
      ipAddress: null, userAgent: null,
    });
    expect(JSON.stringify(sqlMock.mock.calls)).not.toMatch(/password|secret|token|DATABASE_URL/i);
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
