// BrainBase Assurance — Settings → Risk levels: real-Postgres behaviour proof.
// Run ONLY via scripts/tests/verify-assurance-risk-level-settings.sh
// (disposable postgres:17 with the real A0.1B..A0.1E-1 migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceRiskLevelSettings.integration.test.ts requires DATABASE_URL (see verify-assurance-risk-level-settings.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  risk: typeof import('@/lib/assurance/riskLevels');
  lookups: typeof import('@/lib/assurance/lookups');
  incidents: typeof import('@/lib/assurance/incidents');
  investigations: typeof import('@/lib/assurance/investigations');
  findings: typeof import('@/lib/assurance/findings');
  dashboard: typeof import('@/lib/assurance/dashboard');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('rl-org-a', 'rl-a-admin', 'admin');
const admin2A = V('rl-org-a', 'rl-a-admin2', 'admin');
const superA = V('rl-org-a', 'rl-a-super', 'super_admin');
const mgrA = V('rl-org-a', 'rl-a-mgr', 'manager');
const viewerA = V('rl-org-a', 'rl-a-viewer', 'viewer');
const adminB = V('rl-org-b', 'rl-b-admin', 'admin');

const ids: Record<string, string> = {};
let B_HIGH = '';

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error & { details?: Record<string, unknown> }> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error & { details?: Record<string, unknown> };
}

async function level(code: string, org = 'rl-org-a') {
  const [r] = await sql`SELECT id, code, name, description, rank, is_active, requires_verification, created_by,
    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS revision
    FROM assurance_risk_levels WHERE organisation_id = ${org} AND code = ${code}` as {
      id: string; code: string; name: string; description: string | null; rank: number; is_active: boolean;
      requires_verification: boolean; created_by: string | null; revision: string }[];
  return r;
}
const rev = async (code: string) => (await level(code)).revision;
async function audits(code?: string) {
  return await sql`SELECT action, user_id, resource_id, before_state, after_state FROM audit_logs
    WHERE organisation_id = 'rl-org-a' AND resource_type = 'assurance_risk_level'
      AND (${code ?? null}::text IS NULL OR after_state->>'code' = ${code ?? null}::text)
    ORDER BY created_at, id` as { action: string; user_id: string; resource_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[];
}
const seriousNow = async () => (await m.risk.listRiskLevelsForAdmin(adminA)).filter(l => l.serious).map(l => l.code).sort();

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES
      ('rl-org-a', 'Risk Org A', 'rl-org-a', now()), ('rl-org-b', 'Risk Org B', 'rl-org-b', now()), ('rl-org-c', 'Risk Org C (empty)', 'rl-org-c', now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('rl-a-admin', 'rl-org-a', 'rl-a-admin', 'Ada Admin', 'ADMIN', 'ACTIVE', now()),
      ('rl-a-admin2', 'rl-org-a', 'rl-a-admin2', 'Abe Admin', 'ADMIN', 'ACTIVE', now()),
      ('rl-a-super', 'rl-org-a', 'rl-a-super', 'Sam Super', 'SUPER_ADMIN', 'ACTIVE', now()),
      ('rl-a-mgr', 'rl-org-a', 'rl-a-mgr', 'Mia Manager', 'MANAGER', 'ACTIVE', now()),
      ('rl-a-viewer', 'rl-org-a', 'rl-a-viewer', 'Val Viewer', 'VIEWER', 'ACTIVE', now()),
      ('rl-b-admin', 'rl-org-b', 'rl-b-admin', 'Bo Admin', 'ADMIN', 'ACTIVE', now());
    INSERT INTO assurance_risk_levels (organisation_id, code, name, description, rank, requires_verification) VALUES
      ('rl-org-a', 'LOW', 'Low', 'Minor risk that can be managed through routine controls.', 10, false),
      ('rl-org-a', 'MEDIUM', 'Medium', 'Moderate risk requiring a planned and monitored response.', 20, false),
      ('rl-org-a', 'HIGH', 'High', 'Significant risk requiring prompt management attention.', 30, true),
      ('rl-org-a', 'EXTREME', 'Extreme', 'Severe risk requiring immediate attention and action.', 40, true),
      ('rl-org-b', 'HIGH', 'B High', NULL, 30, true),
      ('rl-org-b', 'TOP', 'B Top', NULL, 90, true);
  `);
  for (const c of ['LOW', 'MEDIUM', 'HIGH', 'EXTREME']) ids[c] = (await level(c)).id;
  B_HIGH = (await level('HIGH', 'rl-org-b')).id;
  m = {
    risk: await import('@/lib/assurance/riskLevels'),
    lookups: await import('@/lib/assurance/lookups'),
    incidents: await import('@/lib/assurance/incidents'),
    investigations: await import('@/lib/assurance/investigations'),
    findings: await import('@/lib/assurance/findings'),
    dashboard: await import('@/lib/assurance/dashboard'),
  };
});

afterAll(async () => { await sql.end(); });

describe('list', () => {
  it('returns the Brainbase-style matrix rank DESC with High + Extreme serious, current org only', async () => {
    const rows = await m.risk.listRiskLevelsForAdmin(adminA);
    expect(rows.map(r => [r.code, r.rank, r.is_active, r.serious])).toEqual([
      ['EXTREME', 40, true, true], ['HIGH', 30, true, true], ['MEDIUM', 20, true, false], ['LOW', 10, true, false],
    ]);
    expect(rows.every(r => typeof r.revision === 'string' && r.revision.length >= 20)).toBe(true);
    expect(rows.map(r => r.id)).not.toContain(B_HIGH);
    expect((await m.risk.listRiskLevelsForAdmin(adminB)).map(r => r.code)).toEqual(['TOP', 'HIGH']);
    expect(await m.risk.listRiskLevelsForAdmin(V('rl-org-c', 'x', 'admin'))).toEqual([]);
  });
  it('usage counts only for viewers who can see every record', async () => {
    expect((await m.risk.listRiskLevelsForAdmin(adminA))[0].usage_count).toBe(0);
    expect((await m.risk.listRiskLevelsForAdmin(mgrA))[0].usage_count).toBeNull();
  });
});

describe('permissions', () => {
  it('only administer can mutate; managers and viewers are refused; super_admin inherits', async () => {
    for (const v of [mgrA, viewerA]) {
      await expectError(m.risk.createRiskLevel(v, { code: 'X1', name: 'X', rank: 5 }), 'AssuranceForbiddenError', /Only organisation admins/);
      await expectError(m.risk.updateRiskLevel(v, ids.LOW, { name: 'x', expectedRevision: 'r' }), 'AssuranceForbiddenError');
      await expectError(m.risk.deactivateRiskLevel(v, ids.LOW, { expectedRevision: 'r' }), 'AssuranceForbiddenError');
      await expectError(m.risk.reactivateRiskLevel(v, ids.LOW, { expectedRevision: 'r' }), 'AssuranceForbiddenError');
    }
    const r = await m.risk.createRiskLevel(superA, { code: 'negligible', name: 'Negligible', rank: 5 });
    expect(r.code).toBe('NEGLIGIBLE');
    expect((await level('NEGLIGIBLE')).created_by).toBe('rl-a-super');
  });
  it('another organisation\'s level is not found for view-by-id or mutation', async () => {
    await expectError(m.risk.updateRiskLevel(adminB, ids.LOW, { name: 'Hacked', expectedRevision: await rev('LOW') }), 'AssuranceNotFoundError');
    await expectError(m.risk.deactivateRiskLevel(adminB, ids.LOW, { expectedRevision: await rev('LOW') }), 'AssuranceNotFoundError');
    await expectError(m.risk.updateRiskLevel(adminA, B_HIGH, { name: 'Hacked', expectedRevision: 'x' }), 'AssuranceNotFoundError');
    await expectError(m.risk.updateRiskLevel(adminA, 'not-a-uuid', { name: 'x', expectedRevision: 'x' }), 'AssuranceNotFoundError');
    expect((await level('LOW')).name).toBe('Low');
    expect((await level('HIGH', 'rl-org-b')).name).toBe('B High');
  });
  it('the service exposes no delete operation', () => {
    expect(Object.keys(m.risk).filter(k => /delete|remove/i.test(k))).toEqual([]);
  });
});

describe('create', () => {
  it('validates code, name and rank', async () => {
    await expectError(m.risk.createRiskLevel(adminA, { code: '  ', name: 'X', rank: 7 }), 'AssuranceValidationError', /Code is required/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'BAD CODE', name: 'X', rank: 7 }), 'AssuranceValidationError', /letters, numbers and underscores/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'OK', name: '   ', rank: 7 }), 'AssuranceValidationError', /Name is required/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'OK', name: 'X', rank: -1 }), 'AssuranceValidationError', /negative/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'OK', name: 'X', rank: 7.5 }), 'AssuranceValidationError', /whole number/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'OK', name: 'X', rank: 'abc' }), 'AssuranceValidationError', /whole number/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'OK', name: 'X', rank: 7, description: 5 }), 'AssuranceValidationError', /Description/);
  });
  it('rejects a duplicate code (case-insensitively, after normalisation) and a duplicate rank', async () => {
    await expectError(m.risk.createRiskLevel(adminA, { code: 'high', name: 'Another high', rank: 35 }), 'AssuranceConflictError', /code HIGH already exists/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'SEVERE', name: 'Severe', rank: 30 }), 'AssuranceConflictError', /Rank 30 is already used by "High"/);
  });
  it('creates a non-serious level: created_by, blank description stored as NULL, audit row in the same transaction', async () => {
    const before = await audits();
    const r = await m.risk.createRiskLevel(adminA, { code: 'minor_plus', name: 'Minor plus', rank: 15, description: '   ', requiresVerification: false });
    const row = await level('MINOR_PLUS');
    expect(row).toMatchObject({ id: r.id, name: 'Minor plus', description: null, rank: 15, is_active: true, requires_verification: false, created_by: 'rl-a-admin' });
    const after = await audits();
    expect(after.length).toBe(before.length + 1);
    const a = after[after.length - 1];
    expect(a).toMatchObject({ action: 'assurance_risk_level.created', user_id: 'rl-a-admin', resource_id: r.id });
    expect(a.after_state).toMatchObject({ id: r.id, code: 'MINOR_PLUS', name: 'Minor plus', rank: 15, is_active: true, requires_verification: false });
    expect(a.after_state!.serious).toEqual([{ code: 'EXTREME', name: 'Extreme' }, { code: 'HIGH', name: 'High' }]);
  });
  it('a create that changes the serious set needs the exact acknowledgement', async () => {
    const e = await expectError(m.risk.createRiskLevel(adminA, { code: 'TEST_CRITICAL', name: '[TEST] Critical', rank: 50 }), 'AssuranceConfirmationRequiredError', /treated as serious/);
    expect(e.details).toEqual({
      code: 'SERIOUS_CHANGE_CONFIRMATION',
      before: [{ code: 'EXTREME', name: 'Extreme' }, { code: 'HIGH', name: 'High' }],
      after: [{ code: 'TEST_CRITICAL', name: '[TEST] Critical' }, { code: 'EXTREME', name: 'Extreme' }],
      acknowledge: ['EXTREME', 'TEST_CRITICAL'],
    });
    expect(await level('TEST_CRITICAL')).toBeUndefined();
    await expectError(m.risk.createRiskLevel(adminA, { code: 'TEST_CRITICAL', name: '[TEST] Critical', rank: 50, acknowledgeSerious: ['EXTREME', 'HIGH'] }), 'AssuranceConfirmationRequiredError');
    await m.risk.createRiskLevel(adminA, { code: 'TEST_CRITICAL', name: '[TEST] Critical', rank: 50, acknowledgeSerious: ['TEST_CRITICAL', 'EXTREME'] });
    expect(await seriousNow()).toEqual(['EXTREME', 'TEST_CRITICAL']);
    const a = (await audits('TEST_CRITICAL')).at(-1)!;
    expect(a.before_state!.serious).toEqual([{ code: 'EXTREME', name: 'Extreme' }, { code: 'HIGH', name: 'High' }]);
    expect(a.after_state!.serious).toEqual([{ code: 'TEST_CRITICAL', name: '[TEST] Critical' }, { code: 'EXTREME', name: 'Extreme' }]);
  });
});

describe('serious rule (shared with the dashboard)', () => {
  it('is exactly the top two ACTIVE ranks; an inactive highest rank is ignored', async () => {
    const crit = await level('TEST_CRITICAL');
    await m.risk.deactivateRiskLevel(adminA, crit.id, { expectedRevision: crit.revision, acknowledgeSerious: ['EXTREME', 'HIGH'] });
    expect(await seriousNow()).toEqual(['EXTREME', 'HIGH']);
    const list = await m.risk.listRiskLevelsForAdmin(adminA);
    expect(list[0]).toMatchObject({ code: 'TEST_CRITICAL', is_active: false, serious: false });
  });
  it('the dashboard counts serious open incidents with the same floor', async () => {
    for (const c of ['LOW', 'MEDIUM', 'HIGH', 'EXTREME']) {
      await m.incidents.createIncident(mgrA, { title: `Dash ${c}`, description: 'd', category: 'OTHER', occurredAt: new Date(Date.now() - 3600e3).toISOString(), riskLevelId: ids[c] });
    }
    const d = await m.dashboard.getDashboardData(adminA);
    expect(d.counts.serious_open_incidents).toBe(2);
    expect(d.seriousIncidents.map(i => i.detail)).toEqual(['Extreme', 'High']);
  });
});

describe('edit', () => {
  it('updates name, description and requires_verification with before/after audit', async () => {
    const low = await level('LOW');
    await m.risk.updateRiskLevel(adminA, low.id, { name: 'Low (minor)', description: 'Routine controls apply.', requiresVerification: true, expectedRevision: low.revision });
    const after = await level('LOW');
    expect(after).toMatchObject({ name: 'Low (minor)', description: 'Routine controls apply.', requires_verification: true, rank: 10, code: 'LOW' });
    expect(after.revision).not.toBe(low.revision);
    const a = (await audits('LOW')).at(-1)!;
    expect(a.action).toBe('assurance_risk_level.updated');
    expect(a.before_state).toMatchObject({ code: 'LOW', name: 'Low', description: 'Minor risk that can be managed through routine controls.', requires_verification: false, rank: 10 });
    expect(a.after_state).toMatchObject({ code: 'LOW', name: 'Low (minor)', description: 'Routine controls apply.', requires_verification: true, rank: 10, serious_changed: false });
  });
  it('code is immutable; a no-op is refused; duplicate rank (including an inactive level\'s) is refused', async () => {
    const low = await level('LOW');
    await expectError(m.risk.updateRiskLevel(adminA, low.id, { code: 'LOWEST', name: 'x', expectedRevision: low.revision }), 'AssuranceValidationError', /code cannot be changed/);
    await m.risk.updateRiskLevel(adminA, low.id, { code: 'low', name: 'Low', expectedRevision: low.revision }); // same code (normalised) is fine
    const low2 = await level('LOW');
    await expectError(m.risk.updateRiskLevel(adminA, low2.id, { name: 'Low', expectedRevision: low2.revision }), 'AssuranceValidationError', /Nothing to save/);
    await expectError(m.risk.updateRiskLevel(adminA, low2.id, { rank: 20, expectedRevision: low2.revision }), 'AssuranceConflictError', /Rank 20 is already used by "Medium"/);
    await expectError(m.risk.updateRiskLevel(adminA, low2.id, { rank: 50, expectedRevision: low2.revision }), 'AssuranceConflictError', /\(inactive\)/);
    expect((await level('LOW')).rank).toBe(10);
  });
  it('a stale revision is refused and nothing is overwritten', async () => {
    const med = await level('MEDIUM');
    await m.risk.updateRiskLevel(admin2A, med.id, { description: 'Changed by admin 2.', expectedRevision: med.revision });
    await expectError(m.risk.updateRiskLevel(adminA, med.id, { description: 'Changed by admin 1.', expectedRevision: med.revision }), 'AssuranceConflictError', /changed by someone else/);
    expect((await level('MEDIUM')).description).toBe('Changed by admin 2.');
  });
  it('a rank change that alters the serious set needs acknowledgement, and the server re-evaluates', async () => {
    const med = await level('MEDIUM');
    const e = await expectError(m.risk.updateRiskLevel(adminA, med.id, { rank: 35, expectedRevision: med.revision }), 'AssuranceConfirmationRequiredError');
    expect(e.details).toMatchObject({ before: [{ code: 'EXTREME' }, { code: 'HIGH' }], after: [{ code: 'EXTREME' }, { code: 'MEDIUM' }], acknowledge: ['EXTREME', 'MEDIUM'] });
    await m.risk.updateRiskLevel(adminA, med.id, { rank: 35, expectedRevision: med.revision, acknowledgeSerious: ['EXTREME', 'MEDIUM'] });
    expect(await seriousNow()).toEqual(['EXTREME', 'MEDIUM']);
    const a = (await audits('MEDIUM')).at(-1)!;
    expect(a.before_state).toMatchObject({ rank: 20 });
    expect(a.after_state).toMatchObject({ rank: 35, serious_changed: true });
    // and back (again acknowledged)
    const med2 = await level('MEDIUM');
    await m.risk.updateRiskLevel(adminA, med2.id, { rank: 20, expectedRevision: med2.revision, acknowledgeSerious: ['EXTREME', 'HIGH'] });
    expect(await seriousNow()).toEqual(['EXTREME', 'HIGH']);
  });
  it('a rank change that keeps the serious set needs no acknowledgement', async () => {
    const low = await level('LOW');
    await m.risk.updateRiskLevel(adminA, low.id, { rank: 12, expectedRevision: low.revision });
    expect((await level('LOW')).rank).toBe(12);
  });
});

describe('deactivate / reactivate with historical records', () => {
  let incidentId = '', findingId = '', investigationId = '';
  it('a referenced level can be deactivated; history keeps it; new-record selectors drop it', async () => {
    const usage = async () => (await m.risk.listRiskLevelsForAdmin(adminA)).find(l => l.code === 'MEDIUM')!.usage_count!;
    const usageBefore = await usage(); // the dashboard test above already used MEDIUM once
    const inc = await m.incidents.createIncident(mgrA, { title: 'Historic', description: 'd', category: 'OTHER', occurredAt: new Date(Date.now() - 7200e3).toISOString(), riskLevelId: ids.MEDIUM });
    incidentId = inc.id;
    findingId = (await m.findings.createFinding(mgrA, { incidentId, findingType: 'HAZARD', title: 'Historic finding', description: 'd', riskLevelId: ids.MEDIUM })).id;
    investigationId = (await m.investigations.createInvestigation(mgrA, { title: 'Historic investigation', scope: 's', riskLevelId: ids.MEDIUM, primaryIncidentId: incidentId })).id;
    expect(await usage()).toBe(usageBefore + 3); // incident + finding + investigation

    const med = await level('MEDIUM');
    await m.risk.deactivateRiskLevel(adminA, med.id, { expectedRevision: med.revision });
    expect((await level('MEDIUM')).is_active).toBe(false);

    // historical display (detail + list) still resolves the level by id
    expect((await m.incidents.getIncidentDetail(adminA, incidentId))!.incident.risk_name).toBe('Medium');
    expect((await m.incidents.listIncidents(adminA, {})).find(r => r.id === incidentId)!.risk_name).toBe('Medium');
    expect((await m.findings.getFindingDetail(adminA, findingId))!.finding.risk_name).toBe('Medium');
    expect((await m.findings.listFindings(adminA, {})).find(r => r.id === findingId)!.risk_name).toBe('Medium');
    expect((await m.investigations.getInvestigationDetail(adminA, investigationId))!.investigation.risk_name).toBe('Medium');
    // records untouched
    const [ref] = await sql`SELECT
      (SELECT risk_level_id FROM assurance_incidents WHERE id = ${incidentId}::uuid) AS i,
      (SELECT risk_level_id FROM assurance_findings WHERE id = ${findingId}::uuid) AS f,
      (SELECT risk_level_id FROM assurance_investigations WHERE id = ${investigationId}::uuid) AS v` as { i: string; f: string; v: string }[];
    expect([ref.i, ref.f, ref.v]).toEqual([ids.MEDIUM, ids.MEDIUM, ids.MEDIUM]);

    // selectors for NEW records (incident, investigation and finding forms all use listRiskLevels)
    expect((await m.lookups.listRiskLevels('rl-org-a')).map(l => l.code)).not.toContain('MEDIUM');
    await expectError(m.incidents.createIncident(mgrA, { title: 'New', description: 'd', category: 'OTHER', occurredAt: new Date().toISOString(), riskLevelId: ids.MEDIUM }), 'AssuranceValidationError', /Risk level/);
    await expectError(m.findings.createFinding(mgrA, { incidentId, findingType: 'HAZARD', title: 'x', description: 'd', riskLevelId: ids.MEDIUM }), 'AssuranceValidationError', /Risk level/);
    await expectError(m.investigations.createInvestigation(mgrA, { title: 'x', scope: 's', riskLevelId: ids.MEDIUM, primaryIncidentId: incidentId }), 'AssuranceValidationError', /Risk level/);

    const a = (await audits('MEDIUM')).at(-1)!;
    expect(a.action).toBe('assurance_risk_level.deactivated');
    expect(a.before_state).toMatchObject({ is_active: true });
    expect(a.after_state).toMatchObject({ is_active: false, serious_changed: false });
  });
  it('deactivating a serious level changes the set (acknowledged); reactivating restores it', async () => {
    const high = await level('HIGH');
    const e = await expectError(m.risk.deactivateRiskLevel(adminA, high.id, { expectedRevision: high.revision }), 'AssuranceConfirmationRequiredError');
    // MEDIUM (20) is inactive, so the next active rank is MINOR_PLUS (15, created above; LOW is now 12)
    expect(e.details).toMatchObject({ after: [{ code: 'EXTREME' }, { code: 'MINOR_PLUS' }] });
    await m.risk.deactivateRiskLevel(adminA, high.id, { expectedRevision: high.revision, acknowledgeSerious: e.details!.acknowledge });
    expect(await seriousNow()).toEqual(['EXTREME', 'MINOR_PLUS']);
    const a1 = (await audits('HIGH')).at(-1)!;
    expect(a1.before_state!.serious).toEqual([{ code: 'EXTREME', name: 'Extreme' }, { code: 'HIGH', name: 'High' }]);
    expect(a1.after_state).toMatchObject({ is_active: false, serious_changed: true });

    const high2 = await level('HIGH');
    await expectError(m.risk.reactivateRiskLevel(adminA, high2.id, { expectedRevision: high2.revision }), 'AssuranceConfirmationRequiredError');
    await m.risk.reactivateRiskLevel(adminA, high2.id, { expectedRevision: high2.revision, acknowledgeSerious: ['EXTREME', 'HIGH'] });
    expect(await seriousNow()).toEqual(['EXTREME', 'HIGH']);
    const a2 = (await audits('HIGH')).at(-1)!;
    expect(a2.action).toBe('assurance_risk_level.reactivated');
    expect(a2.after_state).toMatchObject({ is_active: true, serious_changed: true });
  });
  it('reactivating an already-active level is refused; ranks stay unique across active and inactive levels', async () => {
    const high = await level('HIGH');
    await expectError(m.risk.reactivateRiskLevel(adminA, high.id, { expectedRevision: high.revision }), 'AssuranceConflictError', /already active/);
    const med = await level('MEDIUM');
    await expectError(m.risk.deactivateRiskLevel(adminA, med.id, { expectedRevision: med.revision }), 'AssuranceConflictError', /already inactive/);
    await expectError(m.risk.createRiskLevel(adminA, { code: 'MED2', name: 'Medium 2', rank: 20 }), 'AssuranceConflictError', /\(inactive\)/);
    await m.risk.reactivateRiskLevel(adminA, med.id, { expectedRevision: med.revision });
    expect((await level('MEDIUM')).is_active).toBe(true);
    expect((await m.lookups.listRiskLevels('rl-org-a')).map(l => l.code)).toContain('MEDIUM');
  });
});

describe('concurrency and atomicity', () => {
  it('two admins cannot claim the same rank: exactly one create wins', async () => {
    const results = await Promise.allSettled([
      m.risk.createRiskLevel(adminA, { code: 'RACE_A', name: 'Race A', rank: 17 }),
      m.risk.createRiskLevel(admin2A, { code: 'RACE_B', name: 'Race B', rank: 17 }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as Error).name).toBe('AssuranceConflictError');
    expect(((await sql`SELECT count(*)::int AS n FROM assurance_risk_levels WHERE organisation_id = 'rl-org-a' AND rank = 17`) as { n: number }[])[0].n).toBe(1);
  });
  it('two concurrent edits from the same revision: exactly one wins, the other is refused', async () => {
    const low = await level('LOW');
    const results = await Promise.allSettled([
      m.risk.updateRiskLevel(adminA, low.id, { description: 'Edit one.', expectedRevision: low.revision }),
      m.risk.updateRiskLevel(admin2A, low.id, { description: 'Edit two.', expectedRevision: low.revision }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect(['Edit one.', 'Edit two.']).toContain((await level('LOW')).description);
  });
  it('the configuration change rolls back if its audit row cannot be written', async () => {
    await sql.raw(`ALTER TABLE audit_logs ADD CONSTRAINT rl_test_block_update_audit CHECK (action <> 'assurance_risk_level.updated') NOT VALID`);
    try {
      const low = await level('LOW');
      let caught: unknown;
      try { await m.risk.updateRiskLevel(adminA, low.id, { name: 'Should not persist', expectedRevision: low.revision }); } catch (e) { caught = e; }
      expect(caught).toBeTruthy();
      expect((await level('LOW')).name).toBe(low.name);
      expect((await level('LOW')).revision).toBe(low.revision);
    } finally {
      await sql.raw(`ALTER TABLE audit_logs DROP CONSTRAINT rl_test_block_update_audit`);
    }
  });
  it('every risk-level audit row belongs to org A and matches a real level; org B is untouched', async () => {
    const rows = await sql`SELECT organisation_id, count(*)::int AS n FROM audit_logs WHERE resource_type = 'assurance_risk_level' GROUP BY organisation_id` as { organisation_id: string; n: number }[];
    expect(rows.map(r => r.organisation_id)).toEqual(['rl-org-a']);
    const orphan = await sql`SELECT 1 FROM audit_logs l WHERE l.resource_type = 'assurance_risk_level'
      AND NOT EXISTS (SELECT 1 FROM assurance_risk_levels r WHERE r.id::text = l.resource_id AND r.organisation_id = l.organisation_id)` as unknown[];
    expect(orphan).toHaveLength(0);
    expect((await m.risk.listRiskLevelsForAdmin(adminB)).map(r => [r.code, r.name, r.rank])).toEqual([['TOP', 'B Top', 90], ['HIGH', 'B High', 30]]);
  });
});
