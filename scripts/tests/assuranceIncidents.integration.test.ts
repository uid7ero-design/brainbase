// BrainBase Assurance — Incidents & Investigations: real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-incidents.sh (disposable postgres:17 with the
// real A0.1B..A0.1I migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceIncidents.integration.test.ts requires DATABASE_URL (see verify-assurance-incidents.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  incidents: typeof import('@/lib/assurance/incidents');
  investigations: typeof import('@/lib/assurance/investigations');
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
  verifications: typeof import('@/lib/assurance/verifications');
  evidence: typeof import('@/lib/assurance/evidence');
  rules: typeof import('@/lib/assurance/incidentRules');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('ii-org-a', 'ii-a-admin', 'admin');
const admin2A = V('ii-org-a', 'ii-a-admin2', 'admin');
const mgrA = V('ii-org-a', 'ii-a-mgr', 'manager');
const doerA = V('ii-org-a', 'ii-a-doer', 'manager');
const outsiderA = V('ii-org-a', 'ii-a-outsider', 'manager');
const viewerA = V('ii-org-a', 'ii-a-viewer', 'viewer');
const adminB = V('ii-org-b', 'ii-b-admin', 'admin');

const RL = 'ab000000-0000-4000-8000-000000000001';
const LOC = 'ab000000-0000-4000-8000-000000000002';
const AST = 'ab000000-0000-4000-8000-000000000003';
const EO = 'ab000000-0000-4000-8000-000000000004';
const RL_B = 'ab000000-0000-4000-8000-000000000009';

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}
async function audit(resourceId: string) {
  return (await sql`SELECT action, user_id, before_state, after_state FROM audit_logs WHERE resource_id = ${resourceId} ORDER BY created_at, id` as
    { action: string; user_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[]);
}
const incRow = async (id: string) => ((await sql`SELECT status, owner_user_id, closed_at, closure_summary, risk_level_id, updated_at FROM assurance_incidents WHERE id = ${id}::uuid`) as Record<string, unknown>[])[0];
const invRow = async (id: string) => ((await sql`SELECT status, lead_user_id, completed_at, conclusion, restricted, updated_at FROM assurance_investigations WHERE id = ${id}::uuid`) as Record<string, unknown>[])[0];
const findingStatus = async (id: string) => ((await sql`SELECT status FROM assurance_findings WHERE id = ${id}::uuid`) as { status: string }[])[0].status;

function incidentInput(extra: Record<string, unknown> = {}) {
  return {
    title: '[TEST] Slip in wash bay', description: 'Operator slipped near grate WB-3.', category: 'INJURY_SAFETY',
    occurredAt: new Date(Date.now() - 3600_000).toISOString(), ...extra,
  };
}

/** Drives an Action through work -> evidence -> independent verification -> close. */
async function completeAction(actionId: string) {
  await m.actions.startAction(doerA, actionId);
  await m.actions.completeActionWork(doerA, actionId);
  const ev = await m.evidence.createEvidence(doerA, { evidenceType: 'PHOTO', title: '[TEST] Done', target: 'action', targetId: actionId });
  await m.actions.submitActionEvidence(doerA, actionId);
  await m.verifications.recordVerification(admin2A, actionId, { result: 'ACCEPTED', evidenceIds: [ev.id] });
  await m.actions.closeAction(adminA, actionId);
}

const S: Record<string, string> = {};

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES ('ii-org-a','II Org A','ii-org-a',now()), ('ii-org-b','II Org B','ii-org-b',now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('ii-a-admin','ii-org-a','ii-a-admin','Ada Admin','ADMIN','ACTIVE',now()),
      ('ii-a-admin2','ii-org-a','ii-a-admin2','Abe Admin','ADMIN','ACTIVE',now()),
      ('ii-a-mgr','ii-org-a','ii-a-mgr','Mia Manager','MANAGER','ACTIVE',now()),
      ('ii-a-owner','ii-org-a','ii-a-owner','Olly Owner','MANAGER','ACTIVE',now()),
      ('ii-a-lead','ii-org-a','ii-a-lead','Lee Lead','MANAGER','ACTIVE',now()),
      ('ii-a-doer','ii-org-a','ii-a-doer','Dee Doer','MANAGER','ACTIVE',now()),
      ('ii-a-outsider','ii-org-a','ii-a-outsider','Otto Outsider','MANAGER','ACTIVE',now()),
      ('ii-a-viewer','ii-org-a','ii-a-viewer','Val Viewer','VIEWER','ACTIVE',now()),
      ('ii-b-admin','ii-org-b','ii-b-admin','Bo Admin','ADMIN','ACTIVE',now());
    INSERT INTO assurance_risk_levels (id, organisation_id, code, name, rank) VALUES ('${RL}','ii-org-a','HIGH','High',3), ('${RL_B}','ii-org-b','HIGH','High',3);
    INSERT INTO locations (id, organisation_id, location_reference, location_type, name, status) VALUES ('${LOC}','ii-org-a','LOC-II-1','DEPOT','[TEST] Depot 2','ACTIVE');
    INSERT INTO assets (id, organisation_id, asset_reference, asset_type, name, status) VALUES ('${AST}','ii-org-a','AST-II-1','EQUIPMENT','[TEST] Wash bay grate','ACTIVE');
    INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES ('${EO}','ii-org-a','EXT-II-1','[TEST] Cleaning Co','ACTIVE');
  `);
  m = {
    incidents: await import('@/lib/assurance/incidents'),
    investigations: await import('@/lib/assurance/investigations'),
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
    verifications: await import('@/lib/assurance/verifications'),
    evidence: await import('@/lib/assurance/evidence'),
    rules: await import('@/lib/assurance/incidentRules'),
  };
});

afterAll(async () => { await sql.end(); });

describe('incident capture, register and detail', () => {
  it('creates an incident with reference data, risk and owner; organisation and actor are server-derived', async () => {
    const r = await m.incidents.createIncident(mgrA, incidentInput({
      riskLevelId: RL, ownerUserId: 'ii-a-owner', locationId: LOC, assetId: AST, externalOrganisationId: EO,
      immediateResponse: 'Area coned off.', organisationId: 'ii-org-b', createdBy: 'ii-b-admin',
    }));
    S.inc = r.id;
    const row = ((await sql`SELECT organisation_id, created_by, reported_by_user_id, status FROM assurance_incidents WHERE id = ${r.id}::uuid`) as Record<string, string>[])[0];
    expect(row).toMatchObject({ organisation_id: 'ii-org-a', created_by: 'ii-a-mgr', reported_by_user_id: 'ii-a-mgr', status: 'REPORTED' });
    const d = (await m.incidents.getIncidentDetail(mgrA, r.id))!;
    expect(d.incident).toMatchObject({ risk_name: 'High', owner_name: 'Olly Owner', location_name: '[TEST] Depot 2', asset_name: '[TEST] Wash bay grate', external_organisation_name: '[TEST] Cleaning Co' });
    expect((await audit(r.id)).map(a => a.action)).toEqual(['assurance_incident.created']);
  });

  it('refuses cross-org reference data and owners', async () => {
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ riskLevelId: RL_B })), 'AssuranceValidationError');
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ ownerUserId: 'ii-b-admin' })), 'AssuranceValidationError');
  });

  it('register views follow actual statuses and the closure guard; filters by external organisation', async () => {
    const ids = async (view: string, extra: Record<string, string> = {}) => (await m.incidents.listIncidents(mgrA, { view, ...extra })).map(r => r.id);
    expect(await ids('needs_triage')).toContain(S.inc);
    expect(await ids('ready')).not.toContain(S.inc);
    expect(await ids('all', { externalOrganisationId: EO })).toEqual([S.inc]);
    const row = (await m.incidents.listIncidents(mgrA, {})).find(r => r.id === S.inc)!;
    expect(row).toMatchObject({ asset_name: '[TEST] Wash bay grate', external_organisation_name: '[TEST] Cleaning Co', investigation_count: 0, finding_count: 0, open_action_count: 0 });
    await m.incidents.transitionIncident(mgrA, S.inc, { status: 'UNDER_REVIEW' });
    await m.incidents.transitionIncident(mgrA, S.inc, { status: 'INVESTIGATION_REQUIRED' });
    expect(await ids('investigation_required')).toContain(S.inc);
    expect(await ids('needs_triage')).not.toContain(S.inc);
  });

  it('owner assignment: optimistic, same-org, audited, no side effects; finished incidents keep their owner', async () => {
    const before = await incRow(S.inc);
    await expectError(m.incidents.assignIncidentOwner(viewerA, S.inc, { ownerUserId: 'ii-a-mgr' }), 'AssuranceForbiddenError');
    await expectError(m.incidents.assignIncidentOwner(mgrA, S.inc, { ownerUserId: 'ii-b-admin', expectedOwnerUserId: 'ii-a-owner' }), 'AssuranceValidationError');
    await expectError(m.incidents.assignIncidentOwner(mgrA, S.inc, { ownerUserId: 'ii-a-mgr', expectedOwnerUserId: 'ii-a-lead' }), 'AssuranceConflictError', /someone else/);
    await m.incidents.assignIncidentOwner(mgrA, S.inc, { ownerUserId: 'ii-a-mgr', expectedOwnerUserId: 'ii-a-owner' });
    const after = await incRow(S.inc);
    expect(after).toMatchObject({ owner_user_id: 'ii-a-mgr', status: before.status, risk_level_id: before.risk_level_id });
    const ev = (await audit(S.inc)).filter(a => a.action === 'assurance_incident.owner_changed');
    expect(ev).toEqual([expect.objectContaining({ before_state: { owner_user_id: 'ii-a-owner' }, after_state: { owner_user_id: 'ii-a-mgr' } })]);
    // Two concurrent changes from the same view: exactly one wins.
    const res = await Promise.allSettled([
      m.incidents.assignIncidentOwner(mgrA, S.inc, { ownerUserId: 'ii-a-owner', expectedOwnerUserId: 'ii-a-mgr' }),
      m.incidents.assignIncidentOwner(adminA, S.inc, { ownerUserId: 'ii-a-lead', expectedOwnerUserId: 'ii-a-mgr' }),
    ]);
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((res.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    expect((await audit(S.inc)).filter(a => a.action === 'assurance_incident.owner_changed')).toHaveLength(2);
  });
});

describe('starting an investigation from an incident', () => {
  it('links the incident as PRIMARY, changes nothing on the incident, audits both records', async () => {
    const before = await incRow(S.inc);
    const r = await m.investigations.startInvestigationFromIncident(mgrA, S.inc, {
      title: '[TEST] Why did the grate lift?', scope: 'Establish how the grate came loose.', leadUserId: 'ii-a-lead', riskLevelId: RL,
      organisationId: 'ii-org-b',
    });
    S.inv = r.id;
    const link = ((await sql`SELECT relationship, organisation_id FROM assurance_investigation_incidents WHERE investigation_id = ${r.id}::uuid AND incident_id = ${S.inc}::uuid`) as Record<string, string>[])[0];
    expect(link).toEqual({ relationship: 'PRIMARY', organisation_id: 'ii-org-a' });
    expect(await invRow(r.id)).toMatchObject({ status: 'OPEN', lead_user_id: 'ii-a-lead', restricted: false });
    const after = await incRow(S.inc);
    expect(after.status).toBe(before.status); // no automatic Incident transition
    expect(String(after.updated_at)).toBe(String(before.updated_at));
    expect((await audit(r.id)).map(a => a.action)).toEqual(['assurance_investigation.created']);
    expect((await audit(S.inc)).filter(a => a.action === 'assurance_incident.investigation_started')).toHaveLength(1);
    const d = (await m.incidents.getIncidentDetail(mgrA, S.inc))!;
    expect(d.investigations.map(i => i.id)).toEqual([r.id]);
  });

  it('a second start while an active primary investigation exists is refused; concurrent starts have one winner', async () => {
    await expectError(m.investigations.startInvestigationFromIncident(mgrA, S.inc, { title: 'x', scope: 'y' }), 'AssuranceConflictError', /already has an active investigation/);
    const inc2 = await m.incidents.createIncident(mgrA, incidentInput({ title: '[TEST] Race incident' }));
    const res = await Promise.allSettled([
      m.investigations.startInvestigationFromIncident(mgrA, inc2.id, { title: '[TEST] race one', scope: 's' }),
      m.investigations.startInvestigationFromIncident(adminA, inc2.id, { title: '[TEST] race two', scope: 's' }),
    ]);
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((res.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    const n = ((await sql`SELECT count(*)::int AS n FROM assurance_investigation_incidents WHERE incident_id = ${inc2.id}::uuid`) as { n: number }[])[0].n;
    expect(n).toBe(1);
    const created = ((await sql`SELECT count(*)::int AS n FROM assurance_investigations WHERE title LIKE '[TEST] race %'`) as { n: number }[])[0].n;
    expect(created).toBe(1); // the loser wrote nothing (no orphan investigation, no audit)
  });

  it('a restricted incident always yields a restricted investigation; unrestricted links to it are refused', async () => {
    const r = await m.incidents.createIncident(mgrA, incidentInput({ title: '[TEST] Sensitive', restricted: true }));
    S.incR = r.id;
    const inv = await m.investigations.startInvestigationFromIncident(mgrA, r.id, { title: '[TEST] Sensitive inv', scope: 's', restricted: false });
    S.invR = inv.id;
    expect((await invRow(inv.id)).restricted).toBe(true);
    await expectError(m.investigations.createInvestigation(mgrA, { title: 'x', scope: 'y', primaryIncidentId: r.id }), 'AssuranceValidationError', /restricted/);
    const open = await m.investigations.createInvestigation(mgrA, { title: '[TEST] Public inv', scope: 'y' });
    await expectError(m.investigations.linkIncidentToInvestigation(mgrA, open.id, { incidentId: r.id }), 'AssuranceConflictError', /restricted/);
    expect(((await sql`SELECT count(*)::int AS n FROM assurance_investigation_incidents WHERE investigation_id = ${open.id}::uuid`) as { n: number }[])[0].n).toBe(0);
  });

  it('cannot start from a closed/cancelled or invisible incident', async () => {
    const c = await m.incidents.createIncident(mgrA, incidentInput({ title: '[TEST] Cancel me' }));
    await m.incidents.transitionIncident(adminA, c.id, { status: 'CANCELLED' });
    await expectError(m.investigations.startInvestigationFromIncident(mgrA, c.id, { title: 'x', scope: 'y' }), 'AssuranceConflictError');
    await expectError(m.investigations.startInvestigationFromIncident(outsiderA, S.incR, { title: 'x', scope: 'y' }), 'AssuranceNotFoundError');
    await expectError(m.investigations.startInvestigationFromIncident(adminB, S.inc, { title: 'x', scope: 'y' }), 'AssuranceNotFoundError');
  });
});

describe('investigation register, detail, lead and completion', () => {
  it('views use actual statuses; lead assignment is optimistic and audited', async () => {
    const ids = async (view: string) => (await m.investigations.listInvestigations(mgrA, { view })).map(r => r.id);
    expect(await ids('planning')).toContain(S.inv);
    await m.investigations.transitionInvestigation(mgrA, S.inv, { status: 'IN_PROGRESS' });
    expect(await ids('in_progress')).toContain(S.inv);
    expect(await ids('awaiting_review')).not.toContain(S.inv);
    await expectError(m.investigations.assignInvestigationLead(mgrA, S.inv, { leadUserId: 'ii-a-mgr', expectedLeadUserId: 'ii-a-owner' }), 'AssuranceConflictError');
    await m.investigations.assignInvestigationLead(mgrA, S.inv, { leadUserId: 'ii-a-owner', expectedLeadUserId: 'ii-a-lead' });
    expect((await invRow(S.inv)).lead_user_id).toBe('ii-a-owner');
    expect((await audit(S.inv)).filter(a => a.action === 'assurance_investigation.lead_changed')).toHaveLength(1);
  });

  it('evidence on incident and investigation; accepting it changes neither', async () => {
    const e1 = await m.evidence.createEvidence(doerA, { evidenceType: 'PHOTO', title: '[TEST] Grate photo', target: 'incident', targetId: S.inc });
    const e2 = await m.evidence.createEvidence(doerA, { evidenceType: 'DOCUMENT', title: '[TEST] Witness note', target: 'investigation', targetId: S.inv });
    const incBefore = await incRow(S.inc); const invBefore = await invRow(S.inv);
    for (const e of [e1, e2]) {
      await m.evidence.requestEvidenceVerification(doerA, e.id, { lockVersion: 1 });
      await m.evidence.decideEvidence(admin2A, e.id, { decision: 'ACCEPT', lockVersion: 2 });
    }
    expect(await incRow(S.inc)).toEqual(incBefore);
    expect(await invRow(S.inv)).toEqual(invBefore);
    const row = (await m.investigations.listInvestigations(mgrA, {})).find(r => r.id === S.inv)!;
    expect(row.evidence_count).toBe(1);
  });

  it('findings raised explicitly keep structured sources; actions reach them only through findings', async () => {
    const f1 = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Loose grate', description: 'x', incidentId: S.inc });
    const f2 = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: '[TEST] No inspection regime', description: 'y', investigationId: S.inv });
    S.f1 = f1.id; S.f2 = f2.id;
    expect((await m.findings.getFindingDetail(mgrA, f1.id))!.sources).toEqual([expect.objectContaining({ kind: 'incident', id: S.inc })]);
    expect((await m.findings.getFindingDetail(mgrA, f2.id))!.sources).toEqual([expect.objectContaining({ kind: 'investigation', id: S.inv })]);
    const a = await m.actions.createAction(mgrA, { findingIds: [f2.id], actionType: 'CORRECTIVE', title: '[TEST] Weekly grate check', priority: 'MEDIUM', ownerUserId: 'ii-a-owner' });
    S.a = a.id;
    const incD = (await m.incidents.getIncidentDetail(mgrA, S.inc))!;
    const invD = (await m.investigations.getInvestigationDetail(mgrA, S.inv))!;
    expect(incD.actions).toEqual([]); // the action addresses the investigation's finding only
    expect(invD.actions.map(x => [x.id, x.finding_references])).toEqual([[a.id, [expect.stringMatching(/^FND-/)]]]);
    expect((await m.incidents.listIncidents(mgrA, { view: 'findings_open' })).map(r => r.id)).toContain(S.inc);
  });

  it('completion needs AWAITING_REVIEW and a conclusion; it closes nothing else', async () => {
    await expectError(m.investigations.transitionInvestigation(adminA, S.inv, { status: 'COMPLETED', conclusion: 'x' }), 'AssuranceConflictError');
    await m.investigations.transitionInvestigation(mgrA, S.inv, { status: 'AWAITING_REVIEW' });
    await expectError(m.investigations.transitionInvestigation(adminA, S.inv, { status: 'COMPLETED' }), 'AssuranceValidationError', /Conclusion/);
    await expectError(m.investigations.transitionInvestigation(viewerA, S.inv, { status: 'COMPLETED', conclusion: 'x' }), 'AssuranceForbiddenError');
    await m.investigations.transitionInvestigation(mgrA, S.inv, { status: 'COMPLETED', conclusion: '[TEST] The grate fixings had corroded; no inspection regime existed.' });
    expect((await invRow(S.inv)).status).toBe('COMPLETED');
    expect((await incRow(S.inc)).status).toBe('INVESTIGATION_REQUIRED');
    expect(await findingStatus(S.f1)).toBe('OPEN');
    expect(await findingStatus(S.f2)).toBe('OPEN');
    expect(((await sql`SELECT status FROM assurance_actions WHERE id = ${S.a}::uuid`) as { status: string }[])[0].status).toBe('OPEN');
    const r = m.rules.investigationCompletionReadiness({ status: 'IN_PROGRESS', openFindingCount: 2, targetPassed: true, viewerCanClose: true });
    expect(r.blockers[0]).toMatch(/move it to awaiting review first/);
    expect(r.notes.join(' ')).toMatch(/does not block completion/);
  });

  it('a duplicate concurrent completion has one winner', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: '[TEST] Double complete' }));
    const inv = await m.investigations.startInvestigationFromIncident(mgrA, inc.id, { title: '[TEST] dc', scope: 's' });
    await m.investigations.transitionInvestigation(mgrA, inv.id, { status: 'IN_PROGRESS' });
    await m.investigations.transitionInvestigation(mgrA, inv.id, { status: 'AWAITING_REVIEW' });
    const res = await Promise.allSettled([
      m.investigations.transitionInvestigation(adminA, inv.id, { status: 'COMPLETED', conclusion: 'one' }),
      m.investigations.transitionInvestigation(admin2A, inv.id, { status: 'COMPLETED', conclusion: 'two' }),
    ]);
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await audit(inv.id)).filter(a => a.action === 'assurance_investigation.completed')).toHaveLength(1);
  });
});

describe('incident closure readiness, closure and non-propagation', () => {
  it('closure is refused while a finding is open; readiness names it', async () => {
    await m.incidents.transitionIncident(mgrA, S.inc, { status: 'UNDER_INVESTIGATION' });
    await m.incidents.transitionIncident(mgrA, S.inc, { status: 'AWAITING_VERIFICATION' });
    await expectError(m.incidents.transitionIncident(adminA, S.inc, { status: 'CLOSED', closureSummary: 'x' }), 'AssuranceConflictError', /still open/);
    const d = (await m.incidents.getIncidentDetail(mgrA, S.inc))!;
    const r = m.rules.incidentClosureReadiness({
      status: d.incident.status, openVisibleFindings: d.findings.filter(f => f.status === 'OPEN').map(f => ({ reference: f.finding_reference })),
      openHiddenFindings: d.hiddenOpenFindingCount, activeVisibleInvestigations: [], activeHiddenInvestigations: d.hiddenActiveInvestigationCount,
      openActionCount: d.actions.length, viewerCanClose: true,
    });
    expect(r.canFinishNow).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/still open: FND-/);
  });

  it('resolving findings (and their action) does not close the incident; closing the incident closes nothing else', async () => {
    await completeAction(S.a);
    expect((await incRow(S.inc)).status).toBe('AWAITING_VERIFICATION'); // action closure ≠ incident closure
    for (const f of [S.f1, S.f2]) {
      await m.findings.transitionFinding(mgrA, f, { status: 'UNDER_REVIEW' });
      await m.findings.transitionFinding(adminA, f, { status: 'CLOSED', reason: 'Resolved.' });
    }
    expect((await incRow(S.inc)).status).toBe('AWAITING_VERIFICATION'); // finding closure ≠ incident closure
    expect((await m.incidents.listIncidents(mgrA, { view: 'ready' })).map(r => r.id)).toContain(S.inc);
    const invBefore = await invRow(S.inv);
    await expectError(m.incidents.transitionIncident(adminA, S.inc, { status: 'CLOSED' }), 'AssuranceValidationError', /Closure summary/);
    await m.incidents.transitionIncident(adminA, S.inc, { status: 'CLOSED', closureSummary: '[TEST] Grate secured; regime in place.' });
    expect(await incRow(S.inc)).toMatchObject({ status: 'CLOSED', closure_summary: '[TEST] Grate secured; regime in place.' });
    expect(await invRow(S.inv)).toEqual(invBefore);
    expect((await m.findings.getFindingDetail(mgrA, S.f1))!.finding.status).toBe('CLOSED'); // still readable
    expect((await m.actions.getActionDetail(mgrA, S.a))!.action.status).toBe('CLOSED');
    await expectError(m.incidents.assignIncidentOwner(mgrA, S.inc, { ownerUserId: 'ii-a-mgr' }), 'AssuranceConflictError');
    expect(m.rules.INCIDENT_TRANSITIONS.CLOSED).toEqual([]); // no reopen
  });

  it('two concurrent closes have one winner and one audit event', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: '[TEST] Close race' }));
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'UNDER_REVIEW' });
    const res = await Promise.allSettled([
      m.incidents.transitionIncident(adminA, inc.id, { status: 'CLOSED', closureSummary: 'one' }),
      m.incidents.transitionIncident(admin2A, inc.id, { status: 'CLOSED', closureSummary: 'two' }),
    ]);
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await audit(inc.id)).filter(a => a.action === 'assurance_incident.closed')).toHaveLength(1);
  });
});

describe('tenant isolation and restricted visibility', () => {
  it('another organisation sees nothing and cannot write', async () => {
    expect(await m.incidents.listIncidents(adminB, {})).toEqual([]);
    expect(await m.investigations.listInvestigations(adminB, {})).toEqual([]);
    expect(await m.incidents.getIncidentDetail(adminB, S.inc)).toBeNull();
    expect(await m.investigations.getInvestigationDetail(adminB, S.inv)).toBeNull();
    await expectError(m.incidents.transitionIncident(adminB, S.incR, { status: 'UNDER_REVIEW' }), 'AssuranceNotFoundError');
    await expectError(m.incidents.assignIncidentOwner(adminB, S.incR, { ownerUserId: 'ii-b-admin' }), 'AssuranceNotFoundError');
    await expectError(m.investigations.assignInvestigationLead(adminB, S.invR, { leadUserId: 'ii-b-admin' }), 'AssuranceNotFoundError');
  });

  it('restricted incident and its investigation, findings, actions and evidence are invisible to an uninvolved manager, including counts', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Sensitive finding', description: 'x', investigationId: S.invR });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] Sensitive action', priority: 'LOW' });
    const e = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: '[TEST] Sensitive evidence', target: 'investigation', targetId: S.invR });
    expect(await m.incidents.getIncidentDetail(outsiderA, S.incR)).toBeNull();
    expect(await m.investigations.getInvestigationDetail(outsiderA, S.invR)).toBeNull();
    expect(await m.findings.getFindingDetail(outsiderA, f.id)).toBeNull();
    expect(await m.actions.getActionDetail(outsiderA, a.id)).toBeNull();
    expect(await m.evidence.getEvidenceDetail(outsiderA, e.id)).toBeNull();
    const incIds = (await m.incidents.listIncidents(outsiderA, {})).map(r => r.id);
    const invIds = (await m.investigations.listInvestigations(outsiderA, {})).map(r => r.id);
    expect(incIds).not.toContain(S.incR);
    expect(invIds).not.toContain(S.invR);
    for (const view of m.rules.INCIDENT_REGISTER_VIEWS) {
      expect((await m.incidents.listIncidents(outsiderA, { view })).map(r => r.id)).not.toContain(S.incR);
    }
    // The creator (involved) and admins still see everything.
    expect(await m.investigations.getInvestigationDetail(mgrA, S.invR)).not.toBeNull();
    expect((await m.investigations.getInvestigationDetail(adminA, S.invR))!.actions.map(x => x.id)).toEqual([a.id]);
  });
});
