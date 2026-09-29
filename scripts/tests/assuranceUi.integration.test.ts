// BrainBase Assurance UI foundation — real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-ui-services.sh (disposable
// postgres:17 with the real A0.1B..A0.1D-3 migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceUi.integration.test.ts requires DATABASE_URL (see verify-assurance-ui-services.sh).');
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
  inspections: typeof import('@/lib/assurance/inspections');
  templates: typeof import('@/lib/assurance/templates');
  audits: typeof import('@/lib/assurance/audits');
  auditTemplates: typeof import('@/lib/assurance/auditTemplates');
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
  evidence: typeof import('@/lib/assurance/evidence');
  verifications: typeof import('@/lib/assurance/verifications');
  dashboard: typeof import('@/lib/assurance/dashboard');
  errors: typeof import('@/lib/assurance/errors');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('org-a', 'a-admin', 'admin');
const mgrA = V('org-a', 'a-mgr', 'manager');
const mgr2A = V('org-a', 'a-mgr2', 'manager');
const viewerA = V('org-a', 'a-viewer', 'viewer');
const mgrB = V('org-b', 'b-mgr', 'manager');
const emptyC = V('org-c', 'c-admin', 'admin');

const PERSON_A = '00000000-0000-0000-0000-00000000a001';
const PERSON_B = '00000000-0000-0000-0000-00000000b001';
const ITEM_A = '00000000-0000-0000-0000-0000000a1001';
const ITEM_B = '00000000-0000-0000-0000-0000000b1001';
let LOC_A = '';
let LOC_B = '';
let RISK_HIGH_A = '';
let RISK_LOW_A = '';

const past = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

async function expectError(p: Promise<unknown>, cls: 'AssuranceNotFoundError' | 'AssuranceValidationError' | 'AssuranceConflictError' | 'AssuranceForbiddenError', msg?: RegExp) {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
}

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES
      ('org-a', 'Org A', 'org-a', now()), ('org-b', 'Org B', 'org-b', now()), ('org-c', 'Org C (empty)', 'org-c', now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('a-admin', 'org-a', 'a-admin', 'Alex Admin', 'ADMIN', 'ACTIVE', now()),
      ('a-mgr', 'org-a', 'a-mgr', 'Morgan Manager', 'MANAGER', 'ACTIVE', now()),
      ('a-mgr2', 'org-a', 'a-mgr2', 'Riley Reviewer', 'MANAGER', 'ACTIVE', now()),
      ('a-viewer', 'org-a', 'a-viewer', 'Vic Viewer', 'VIEWER', 'ACTIVE', now()),
      ('a-inactive', 'org-a', 'a-inactive', 'Ina Inactive', 'MANAGER', 'INACTIVE', now()),
      ('b-mgr', 'org-b', 'b-mgr', 'Blake Other-Tenant', 'MANAGER', 'ACTIVE', now()),
      ('c-admin', 'org-c', 'c-admin', 'Casey Empty', 'ADMIN', 'ACTIVE', now());
    INSERT INTO organiser_boards (id, organisation_id, name) VALUES
      ('00000000-0000-0000-0000-0000000ab001', 'org-a', 'Board A'), ('00000000-0000-0000-0000-0000000bb001', 'org-b', 'Board B');
    INSERT INTO hr_people (id, organisation_id, first_name, last_name, job_title, work_email) VALUES
      ('${PERSON_A}', 'org-a', 'Pat', 'Person', 'Depot Operator', 'pat@example.test'),
      ('${PERSON_B}', 'org-b', 'Other', 'Tenant', 'Operator', 'other@example.test');
    INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES
      ('${ITEM_A}', '00000000-0000-0000-0000-0000000ab001', 'org-a', 'Replace wash-bay drain grate', 'Done'),
      ('${ITEM_B}', '00000000-0000-0000-0000-0000000bb001', 'org-b', 'Other tenant task', 'Open');
  `);
  const loc = await sql.raw(`
    INSERT INTO locations (organisation_id, location_reference, location_type, name) VALUES
      ('org-a', 'LOC-A1', 'DEPOT', 'Northern Depot'), ('org-b', 'LOC-B1', 'DEPOT', 'Other Depot')
    RETURNING id, organisation_id`) as { id: string; organisation_id: string }[];
  LOC_A = loc.find(l => l.organisation_id === 'org-a')!.id;
  LOC_B = loc.find(l => l.organisation_id === 'org-b')!.id;
  const risks = await sql.raw(`
    INSERT INTO assurance_risk_levels (organisation_id, code, name, rank, requires_verification) VALUES
      ('org-a', 'LOW', 'Low', 1, false), ('org-a', 'MED', 'Medium', 2, false),
      ('org-a', 'HIGH', 'High', 3, true), ('org-a', 'EXT', 'Extreme', 4, true)
    RETURNING id, code`) as { id: string; code: string }[];
  RISK_HIGH_A = risks.find(r => r.code === 'HIGH')!.id;
  RISK_LOW_A = risks.find(r => r.code === 'LOW')!.id;

  m = {
    incidents: await import('@/lib/assurance/incidents'),
    investigations: await import('@/lib/assurance/investigations'),
    inspections: await import('@/lib/assurance/inspections'),
    templates: await import('@/lib/assurance/templates'),
    audits: await import('@/lib/assurance/audits'),
    auditTemplates: await import('@/lib/assurance/auditTemplates'),
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
    evidence: await import('@/lib/assurance/evidence'),
    verifications: await import('@/lib/assurance/verifications'),
    dashboard: await import('@/lib/assurance/dashboard'),
    errors: await import('@/lib/assurance/errors'),
  };
});

afterAll(async () => { await sql.end(); });

function incidentInput(extra: Record<string, unknown> = {}) {
  return {
    title: 'Slip on wet floor in wash bay', description: 'Operator slipped near the drain grate.', category: 'INJURY_SAFETY',
    occurredAt: past(1), locationId: LOC_A, riskLevelId: RISK_HIGH_A, ...extra,
  };
}

describe('empty states', () => {
  it('an organisation with no Assurance data gets zero counts and empty lists (no invented data)', async () => {
    const d = await m.dashboard.getDashboardData(emptyC);
    expect(d.isEmpty).toBe(true);
    expect(Object.values(d.counts).every(n => n === 0)).toBe(true);
    expect(d.attention).toEqual([]);
    expect(d.incidentTrend).toHaveLength(8);
    expect(d.incidentTrend.every(w => w.n === 0)).toBe(true);
    expect(await m.incidents.listIncidents(emptyC)).toEqual([]);
    expect(await m.findings.listFindings(emptyC)).toEqual([]);
    expect(await m.actions.listActions(emptyC)).toEqual([]);
    expect(await m.evidence.listEvidence(emptyC)).toEqual([]);
    expect(await m.verifications.listVerificationQueue(emptyC)).toEqual([]);
  });
});

describe('permission enforcement (service layer, independent of routes)', () => {
  it('a viewer cannot create or transition records', async () => {
    await expectError(m.incidents.createIncident(viewerA, incidentInput()), 'AssuranceForbiddenError');
    await expectError(m.findings.createFinding(viewerA, { findingType: 'HAZARD', title: 't', description: 'd' }), 'AssuranceForbiddenError');
  });
  it('a manager cannot administer inspection templates', async () => {
    await expectError(m.templates.createTemplate(mgrA, { name: 'X', inspectionType: 'SITE', items: [{ label: 'a' }] }), 'AssuranceForbiddenError');
  });
});

describe('same-organisation users(id) validation', () => {
  it('rejects a user from another organisation on every user-bearing field', async () => {
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ ownerUserId: 'b-mgr' })), 'AssuranceValidationError', /Owner/);
    await expectError(m.investigations.createInvestigation(mgrA, { title: 'I', scope: 's', leadUserId: 'b-mgr' }), 'AssuranceValidationError', /Lead/);
    await expectError(m.inspections.createInspection(mgrA, { title: 'I', inspectionType: 'SITE', inspectorUserId: 'b-mgr' }), 'AssuranceValidationError', /Inspector/);
    await expectError(m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 't', description: 'd', responsibleUserId: 'b-mgr' }), 'AssuranceValidationError', /Responsible/);
  });
  it('rejects an inactive same-org user and a nonexistent user', async () => {
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ ownerUserId: 'a-inactive' })), 'AssuranceValidationError');
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ ownerUserId: 'nobody' })), 'AssuranceValidationError');
  });
  it('rejects shared entities (locations) from another organisation', async () => {
    await expectError(m.incidents.createIncident(mgrA, incidentInput({ locationId: LOC_B })), 'AssuranceValidationError', /Location/);
  });
  it('ignores any organisation id smuggled in the request body (mass assignment)', async () => {
    const r = await m.incidents.createIncident(mgrA, incidentInput({ organisationId: 'org-b', organisation_id: 'org-b', status: 'CLOSED', created_by: 'b-mgr' }));
    const rows = await sql.raw(`SELECT organisation_id, status, created_by FROM assurance_incidents WHERE id = '${r.id}'`) as Record<string, string>[];
    expect(rows[0]).toEqual({ organisation_id: 'org-a', status: 'REPORTED', created_by: 'a-mgr' });
  });
});

describe('tenant isolation', () => {
  it('another organisation cannot list, read, transition or link to a record', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Tenant isolation probe' }));
    expect((await m.incidents.listIncidents(mgrB)).some(r => r.id === inc.id)).toBe(false);
    expect(await m.incidents.getIncidentDetail(mgrB, inc.id)).toBeNull();
    await expectError(m.incidents.transitionIncident(mgrB, inc.id, { status: 'UNDER_REVIEW' }), 'AssuranceNotFoundError');
    await expectError(m.findings.createFinding(mgrB, { findingType: 'HAZARD', title: 't', description: 'd', incidentId: inc.id }), 'AssuranceNotFoundError');
    await expectError(m.investigations.createInvestigation(mgrB, { title: 'x', scope: 'y', primaryIncidentId: inc.id }), 'AssuranceNotFoundError');
    await expectError(m.evidence.createEvidence(mgrB, { evidenceType: 'PHOTO', title: 'x', target: 'incident', targetId: inc.id }), 'AssuranceNotFoundError');
    const dashB = await m.dashboard.getDashboardData(mgrB);
    expect(dashB.counts.open_incidents).toBe(0);
  });
  it('invalid ids resolve to not-found, never a 500', async () => {
    expect(await m.incidents.getIncidentDetail(mgrA, 'not-a-uuid')).toBeNull();
    expect(await m.actions.getActionDetail(mgrA, "1' OR '1'='1")).toBeNull();
  });
  it('search input is parameterised and LIKE metacharacters are literal', async () => {
    const rows = await m.incidents.listIncidents(mgrA, { q: "'; DROP TABLE assurance_incidents; --" });
    expect(rows).toEqual([]);
    expect((await m.incidents.listIncidents(mgrA, { q: '%' })).length).toBe(0);
    expect((await sql.raw('SELECT count(*)::int AS n FROM assurance_incidents') as { n: number }[])[0].n).toBeGreaterThan(0);
  });
});

describe('incident list/detail', () => {
  it('filters by status, category and search, and organises the detail', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Needle found in park bin', category: 'ENVIRONMENTAL', ownerUserId: 'a-mgr2' }));
    await sql.raw(`INSERT INTO assurance_incident_people (organisation_id, incident_id, person_id, role) VALUES ('org-a', '${inc.id}', '${PERSON_A}', 'WITNESS')`);
    const byCat = await m.incidents.listIncidents(mgrA, { category: 'ENVIRONMENTAL' });
    expect(byCat.map(r => r.id)).toContain(inc.id);
    expect(byCat.every(r => r.category === 'ENVIRONMENTAL')).toBe(true);
    expect((await m.incidents.listIncidents(mgrA, { q: 'needle' })).map(r => r.id)).toEqual([inc.id]);
    expect((await m.incidents.listIncidents(mgrA, { status: 'CLOSED' })).some(r => r.id === inc.id)).toBe(false);
    const d = await m.incidents.getIncidentDetail(mgrA, inc.id);
    expect(d!.incident.owner_name).toBe('Riley Reviewer');
    expect(d!.incident.location_name).toBe('Northern Depot');
    expect(d!.people).toEqual([expect.objectContaining({ display_name: 'Pat Person', role: 'WITNESS', job_title: 'Depot Operator' })]);
    // PII minimisation: no email is ever selected.
    expect(JSON.stringify(d)).not.toMatch(/example\.test/);
    expect(d!.history.map(h => h.action)).toContain('assurance_incident.created');
  });
  it('enforces the triage lifecycle and refuses unguarded closure', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Lifecycle probe' }));
    await expectError(m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED', closureSummary: 'x' }), 'AssuranceConflictError');
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'UNDER_REVIEW' });
    await expectError(m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED' }), 'AssuranceValidationError', /Closure summary/);
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED', closureSummary: 'Reviewed; no further action.' });
    const d = await m.incidents.getIncidentDetail(mgrA, inc.id);
    expect(d!.incident.status).toBe('CLOSED');
    expect(d!.incident.closed_by_name).toBe('Morgan Manager');
  });
});

describe('restricted records', () => {
  it('restricted incidents and everything linked beneath them are hidden from uninvolved users', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Restricted HR-sensitive incident', restricted: true }));
    const fnd = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'Restricted finding', description: 'd', incidentId: inc.id });
    const act = await m.actions.createAction(mgrA, { findingIds: [fnd.id], actionType: 'CORRECTIVE', title: 'Restricted action', priority: 'HIGH' });
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'STATEMENT', title: 'Restricted statement', target: 'incident', targetId: inc.id });

    // Creator sees everything.
    expect(await m.incidents.getIncidentDetail(mgrA, inc.id)).not.toBeNull();
    expect(await m.findings.getFindingDetail(mgrA, fnd.id)).not.toBeNull();
    // Admin sees everything.
    expect(await m.incidents.getIncidentDetail(adminA, inc.id)).not.toBeNull();
    expect(await m.actions.getActionDetail(adminA, act.id)).not.toBeNull();
    // An uninvolved same-org manager sees none of it — list, detail, or counts.
    expect(await m.incidents.getIncidentDetail(mgr2A, inc.id)).toBeNull();
    expect((await m.incidents.listIncidents(mgr2A)).some(r => r.id === inc.id)).toBe(false);
    expect(await m.findings.getFindingDetail(mgr2A, fnd.id)).toBeNull();
    expect((await m.findings.listFindings(mgr2A)).some(r => r.id === fnd.id)).toBe(false);
    expect(await m.actions.getActionDetail(mgr2A, act.id)).toBeNull();
    expect((await m.actions.listActions(mgr2A)).some(r => r.id === act.id)).toBe(false);
    expect(await m.evidence.getEvidenceDetail(mgr2A, ev.id)).toBeNull();
    expect((await m.evidence.listEvidence(mgr2A)).some(r => r.id === ev.id)).toBe(false);
    expect((await m.incidents.listIncidents(mgr2A, { q: 'Restricted HR' }))).toEqual([]);
    // ...and cannot act on it by guessing ids.
    await expectError(m.incidents.transitionIncident(mgr2A, inc.id, { status: 'UNDER_REVIEW' }), 'AssuranceNotFoundError');
    await expectError(m.actions.startAction(mgr2A, act.id), 'AssuranceNotFoundError');
    await expectError(m.evidence.linkEvidence(mgr2A, ev.id, { target: 'incident', targetId: inc.id }), 'AssuranceNotFoundError');
    await expectError(m.findings.createFinding(mgr2A, { findingType: 'HAZARD', title: 't', description: 'd', incidentId: inc.id }), 'AssuranceNotFoundError');

    const dashAdmin = await m.dashboard.getDashboardData(adminA);
    const dashOther = await m.dashboard.getDashboardData(mgr2A);
    expect(dashAdmin.counts.open_findings - dashOther.counts.open_findings).toBeGreaterThanOrEqual(1);
    expect(dashAdmin.counts.open_actions - dashOther.counts.open_actions).toBeGreaterThanOrEqual(1);
  });

  it('an owner (not creator) of a restricted incident can see it', async () => {
    const inc = await m.incidents.createIncident(adminA, incidentInput({ title: 'Restricted owned by mgr2', restricted: true, ownerUserId: 'a-mgr2' }));
    expect(await m.incidents.getIncidentDetail(mgr2A, inc.id)).not.toBeNull();
    expect(await m.incidents.getIncidentDetail(mgrA, inc.id)).toBeNull();
  });

  it('an unrestricted investigation shows a restricted linked incident only as a redacted placeholder', async () => {
    const secret = await m.incidents.createIncident(adminA, incidentInput({ title: 'Secret incident title', restricted: true }));
    const open = await m.incidents.createIncident(adminA, incidentInput({ title: 'Open incident' }));
    const inv = await m.investigations.createInvestigation(adminA, {
      title: 'Mixed investigation', scope: 'scope',
      incidents: [{ incidentId: open.id, relationship: 'PRIMARY' }, { incidentId: secret.id, relationship: 'RELATED' }],
    });
    const d = await m.investigations.getInvestigationDetail(mgr2A, inv.id);
    expect(d).not.toBeNull();
    const redacted = d!.incidents.find(l => !l.visible)!;
    expect(redacted).toMatchObject({ visible: false, id: null, incident_reference: null, title: null, status: null });
    expect(JSON.stringify(d)).not.toMatch(/Secret incident title/);
    const row = (await m.investigations.listInvestigations(mgr2A)).find(r => r.id === inv.id)!;
    expect(row.hidden_incident_count).toBe(1);
    expect(row.linked_incidents.map(l => l.id)).toEqual([open.id]);
  });

  it('restricted investigations are hidden from non-lead, non-admin users', async () => {
    const inv = await m.investigations.createInvestigation(mgrA, { title: 'Restricted investigation', scope: 's', restricted: true });
    expect(await m.investigations.getInvestigationDetail(mgr2A, inv.id)).toBeNull();
    expect(await m.investigations.getInvestigationDetail(adminA, inv.id)).not.toBeNull();
  });
});

describe('Incident <-> Investigation M:N', () => {
  it('one incident in two investigations, one investigation covering two incidents', async () => {
    const i1 = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Vehicle reversing near miss' }));
    const i2 = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Second reversing near miss', category: 'NEAR_MISS' }));
    await expectError(m.investigations.createInvestigation(mgrA, {
      title: 'Two primaries', scope: 's', incidents: [{ incidentId: i1.id, relationship: 'PRIMARY' }, { incidentId: i2.id, relationship: 'PRIMARY' }],
    }), 'AssuranceValidationError');
    const invA = await m.investigations.createInvestigation(mgrA, { title: 'Reversing practices review', scope: 's', primaryIncidentId: i1.id, relatedIncidentIds: [i2.id] });
    const invB = await m.investigations.createInvestigation(mgrA, { title: 'Fleet camera review', scope: 's', relatedIncidentIds: [i1.id] });

    const d1 = await m.incidents.getIncidentDetail(mgrA, i1.id);
    expect(d1!.investigations.map(l => l.id).sort()).toEqual([invA.id, invB.id].sort());
    const dA = await m.investigations.getInvestigationDetail(mgrA, invA.id);
    expect(dA!.incidents.map(l => [l.id, l.relationship])).toEqual([[i1.id, 'PRIMARY'], [i2.id, 'RELATED']]);
    expect(dA!.incidents.find(l => l.id === i1.id)!.other_investigation_count).toBe(1);

    await expectError(m.investigations.linkIncidentToInvestigation(mgrA, invB.id, { incidentId: i1.id }), 'AssuranceConflictError', /already linked/);
    await m.investigations.linkIncidentToInvestigation(mgrA, invB.id, { incidentId: i2.id, relationship: 'CONTEXT' });
    expect((await m.incidents.getIncidentDetail(mgrA, i2.id))!.investigations).toHaveLength(2);
  });

  it('completing an investigation does not close its incidents or findings', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Completion propagation probe' }));
    const inv = await m.investigations.createInvestigation(mgrA, { title: 'Probe', scope: 's', primaryIncidentId: inc.id });
    const f = await m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: 'Probe finding', description: 'd', investigationId: inv.id });
    for (const s of ['IN_PROGRESS', 'AWAITING_REVIEW']) await m.investigations.transitionInvestigation(mgrA, inv.id, { status: s });
    await expectError(m.investigations.transitionInvestigation(mgrA, inv.id, { status: 'COMPLETED' }), 'AssuranceValidationError', /Conclusion/);
    await m.investigations.transitionInvestigation(mgrA, inv.id, { status: 'COMPLETED', conclusion: 'Root cause: inadequate spotter procedure.' });
    expect((await m.incidents.getIncidentDetail(mgrA, inc.id))!.incident.status).toBe('REPORTED');
    expect((await m.findings.getFindingDetail(mgrA, f.id))!.finding.status).toBe('OPEN');
    await expectError(m.investigations.linkIncidentToInvestigation(mgrA, inv.id, { incidentId: inc.id }), 'AssuranceConflictError');
  });
});

describe('inspection templates and execution', () => {
  it('historical inspections keep their exact immutable template version', async () => {
    const t = await m.templates.createTemplate(adminA, {
      name: 'Depot safety walk', inspectionType: 'SITE',
      items: [
        { label: 'Walkways clear of obstructions', responseType: 'PASS_FAIL' },
        { label: 'Drain grates secure', responseType: 'PASS_FAIL', guidance: 'Check wash bay grates' },
        { label: 'Fire extinguisher pressure (psi)', responseType: 'NUMBER', required: false },
      ],
    });
    const ins = await m.inspections.createInspection(mgrA, { title: 'October depot walk', templateVersionId: t.version_id, inspectorUserId: 'a-mgr', locationId: LOC_A, scheduledAt: future(2) });
    const v2 = await m.templates.createTemplateVersion(adminA, t.id, { title: 'Depot safety walk (rev 2)', items: [{ label: 'Completely different item' }] });
    expect(v2.version_number).toBe(2);

    const d = await m.inspections.getInspectionDetail(mgrA, ins.id);
    expect(d!.inspection.template_version_number).toBe(1);
    expect(d!.inspection.latest_template_version_number).toBe(2);
    expect(d!.checklist.map(i => i.label)).toEqual(['Walkways clear of obstructions', 'Drain grates secure', 'Fire extinguisher pressure (psi)']);

    await expect(sql.raw(`UPDATE assurance_inspection_template_versions SET title = 'tampered' WHERE id = '${t.version_id}'`)).rejects.toThrow(/immutable/);
    await expect(sql.raw(`DELETE FROM assurance_inspection_template_versions WHERE id = '${t.version_id}'`)).rejects.toThrow(/immutable/);
    const detail = await m.templates.getTemplateDetail(adminA, t.id);
    expect(detail!.versions.map(v => v.version_number)).toEqual([2, 1]);
    expect(detail!.versions[1].inspection_count).toBe(1);
  });

  it('records responses separately, re-derives labels server-side, and gates completion', async () => {
    const t = await m.templates.createTemplate(adminA, {
      name: 'Playground check', inspectionType: 'FACILITY',
      items: [{ label: 'Softfall depth adequate' }, { label: 'Swing chains intact' }],
    });
    const ins = await m.inspections.createInspection(mgrA, { title: 'Playground — Riverside Park', templateVersionId: t.version_id });
    const d0 = await m.inspections.getInspectionDetail(mgrA, ins.id);
    const [k1, k2] = d0!.checklist.map(i => i.key);

    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k1, outcome: 'PASS' }), 'AssuranceConflictError', /in progress/);
    await m.inspections.startInspection(mgrA, ins.id);
    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: 'not-in-version', outcome: 'PASS' }), 'AssuranceValidationError');
    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k2, outcome: 'FAIL' }), 'AssuranceValidationError', /note/);
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k1, outcome: 'PASS', itemLabel: 'CLIENT-SUPPLIED LABEL IGNORED' });
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k2, outcome: 'OBSERVATION', notes: 'Minor wear on one chain' });
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k2, outcome: 'FAIL', notes: 'Chain link cracked on swing 2' });

    const d1 = await m.inspections.getInspectionDetail(mgrA, ins.id);
    expect(d1!.responses).toHaveLength(2);
    expect(d1!.responses.find(r => r.item_key === k1)!.item_label).toBe('Softfall depth adequate');
    expect(d1!.responses.find(r => r.item_key === k2)).toMatchObject({ outcome: 'FAIL', notes: 'Chain link cracked on swing 2' });
    const audit = await sql.raw(`SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = '${ins.id}' AND action = 'assurance_inspection.response_recorded'`) as { n: number }[];
    expect(audit[0].n).toBe(3);

    await m.inspections.completeInspection(mgrA, ins.id, { summary: 'One failed item.' });
    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: k1, outcome: 'FAIL', notes: 'x' }), 'AssuranceConflictError');
    // Completion never auto-creates findings.
    expect((await m.inspections.getInspectionDetail(mgrA, ins.id))!.findings).toEqual([]);
  });

  it('refuses completion while required items are unanswered; ad hoc inspections define items as they go', async () => {
    const t = await m.templates.createTemplate(adminA, { name: 'Two item check', inspectionType: 'SAFETY', items: [{ label: 'A' }, { label: 'B' }] });
    const ins = await m.inspections.createInspection(mgrA, { title: 'Partial', templateVersionId: t.version_id });
    await m.inspections.startInspection(mgrA, ins.id);
    const d = await m.inspections.getInspectionDetail(mgrA, ins.id);
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: d!.checklist[0].key, outcome: 'PASS' });
    await expectError(m.inspections.completeInspection(mgrA, ins.id, {}), 'AssuranceConflictError', /required/);

    await expectError(m.inspections.createInspection(mgrA, { title: 'Ad hoc without type' }), 'AssuranceValidationError');
    const adhoc = await m.inspections.createInspection(mgrA, { title: 'Ad hoc footpath check', inspectionType: 'SITE' });
    await m.inspections.startInspection(mgrA, adhoc.id);
    await expectError(m.inspections.completeInspection(mgrA, adhoc.id, {}), 'AssuranceConflictError');
    await expectError(m.inspections.recordInspectionResponse(mgrA, adhoc.id, { itemKey: 'bad key', itemLabel: 'x', outcome: 'PASS' }), 'AssuranceValidationError');
    await m.inspections.recordInspectionResponse(mgrA, adhoc.id, { itemKey: 'adhoc-trip-hazard-abc123', itemLabel: 'Raised paver near bus stop', outcome: 'FAIL', notes: '30mm lip' });
    await m.inspections.completeInspection(mgrA, adhoc.id, {});
    const list = await m.inspections.listInspections(mgrA, { source: 'adhoc' });
    expect(list.find(r => r.id === adhoc.id)).toMatchObject({ status: 'COMPLETED', fail_count: 1, template_name: null });
  });

  it('failed items link to findings through the explicit inspection link table', async () => {
    const ins = await m.inspections.createInspection(mgrA, { title: 'Link probe', inspectionType: 'SITE' });
    await m.inspections.startInspection(mgrA, ins.id);
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: 'adhoc-bin-lid-broken-000001', itemLabel: 'Bin lid', outcome: 'FAIL', notes: 'Lid hinge broken' });
    await expectError(m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'x', description: 'y', inspectionId: ins.id, inspectionItemKey: 'adhoc-missing-000000' }), 'AssuranceValidationError');
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'Bin lid hinge broken', description: 'Lid hinge broken', inspectionId: ins.id, inspectionItemKey: 'adhoc-bin-lid-broken-000001' });
    const d = await m.inspections.getInspectionDetail(mgrA, ins.id);
    expect(d!.findings).toEqual([expect.objectContaining({ id: f.id, source_item_key: 'adhoc-bin-lid-broken-000001' })]);
    const fd = await m.findings.getFindingDetail(mgrA, f.id);
    expect(fd!.sources).toEqual([{ kind: 'inspection', id: ins.id, reference: expect.stringMatching(/^INS-/) }]);
    const linkRows = await sql.raw(`SELECT count(*)::int AS n FROM assurance_inspection_findings WHERE finding_id = '${f.id}'`) as { n: number }[];
    expect(linkRows[0].n).toBe(1);
  });
});

describe('actions, evidence history and verification workflow', () => {
  it('runs the full chain without any automatic closure propagation', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Chain probe incident' }));
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'Drain grate unsecured', description: 'd', incidentId: inc.id, dueAt: future(10) });
    await expectError(m.actions.createAction(mgrA, { findingIds: [], actionType: 'CORRECTIVE', title: 'x' }), 'AssuranceValidationError');
    await expectError(m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: 'x', ownerUserId: 'b-mgr' }), 'AssuranceValidationError');
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: 'Secure drain grate', priority: 'HIGH', ownerUserId: 'a-mgr', dueAt: future(5) });

    // Organiser task links need the Organiser capability, same org only; task status never drives the action.
    await expectError(m.actions.linkActionTask(mgrA, a.id, { organiserItemId: ITEM_A }), 'AssuranceForbiddenError', /Organiser/);
    expect(await m.actions.listOrganiserItemOptions(mgrA)).toEqual([]);
    await sql.raw(`
      INSERT INTO modules (key, name, active) VALUES ('organiser', 'Organiser', true) ON CONFLICT (key) DO NOTHING;
      INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'organiser', true) ON CONFLICT DO NOTHING;
    `);
    await expectError(m.actions.linkActionTask(mgrA, a.id, { organiserItemId: ITEM_B }), 'AssuranceValidationError');
    await m.actions.linkActionTask(mgrA, a.id, { organiserItemId: ITEM_A });
    let d = await m.actions.getActionDetail(mgrA, a.id);
    expect(d!.tasks).toEqual([expect.objectContaining({ name: 'Replace wash-bay drain grate', status: 'Done' })]);
    expect(d!.action.status).toBe('OPEN');

    await m.actions.startAction(mgrA, a.id);
    expect((await m.actions.completeActionWork(mgrA, a.id)).status).toBe('AWAITING_EVIDENCE');
    await expectError(m.actions.closeAction(adminA, a.id), 'AssuranceConflictError', /Evidence is required/);
    await expectError(m.actions.submitActionEvidence(mgrA, a.id), 'AssuranceConflictError');

    // Evidence: link, soft-unlink with reason, relink — full history kept.
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'Grate bolted down', target: 'action', targetId: a.id, heldAt: 'Records ref R-1' });
    const link1 = (await m.actions.getActionDetail(mgrA, a.id))!.evidence[0];
    await expectError(m.evidence.unlinkEvidence(mgrA, { target: 'action', linkId: link1.link_id }), 'AssuranceValidationError', /Reason/);
    await m.evidence.unlinkEvidence(mgrA, { target: 'action', linkId: link1.link_id, reason: 'Wrong photo attached' });
    await expectError(m.evidence.unlinkEvidence(mgrA, { target: 'action', linkId: link1.link_id, reason: 'again' }), 'AssuranceConflictError');
    await m.evidence.linkEvidence(mgrA, ev.id, { target: 'action', targetId: a.id, purpose: 'Correct photo' });
    const evd = await m.evidence.getEvidenceDetail(mgrA, ev.id);
    expect(evd!.links).toHaveLength(2);
    expect(evd!.links.filter(l => l.removed_at)).toEqual([expect.objectContaining({ removal_reason: 'Wrong photo attached', removed_by_name: 'Morgan Manager' })]);
    expect((await sql.raw(`SELECT count(*)::int AS n FROM assurance_evidence WHERE id = '${ev.id}'`) as { n: number }[])[0].n).toBe(1);

    expect((await m.actions.submitActionEvidence(mgrA, a.id)).status).toBe('AWAITING_VERIFICATION');

    // Independence: the owner / work completer cannot verify.
    await expectError(m.verifications.recordVerification(mgrA, a.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/);
    await expectError(m.verifications.recordVerification(viewerA, a.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError');
    await expectError(m.verifications.recordVerification(mgr2A, a.id, { result: 'REJECTED' }), 'AssuranceValidationError', /notes/);
    const v1 = await m.verifications.recordVerification(mgr2A, a.id, { result: 'REJECTED', notes: 'Bolts not torqued; redo.' });
    expect(v1).toMatchObject({ attempt_number: 1, action_status: 'IN_PROGRESS' });

    expect((await m.actions.completeActionWork(mgrA, a.id)).status).toBe('AWAITING_VERIFICATION');
    const queue = await m.verifications.listVerificationQueue(mgr2A);
    expect(queue.find(q => q.id === a.id)).toMatchObject({ can_verify: true, attempt_count: 1 });
    expect((await m.verifications.listVerificationQueue(mgrA)).find(q => q.id === a.id)).toMatchObject({ can_verify: false });

    const v2 = await m.verifications.recordVerification(mgr2A, a.id, { result: 'ACCEPTED', evidenceIds: [ev.id] });
    expect(v2).toMatchObject({ attempt_number: 2, action_status: 'AWAITING_VERIFICATION' });
    await expectError(m.verifications.recordVerification(adminA, a.id, { result: 'ACCEPTED' }), 'AssuranceConflictError');

    d = await m.actions.getActionDetail(mgrA, a.id);
    expect(d!.readiness.canClose).toBe(true);
    expect(d!.verifications.map(v => v.result)).toEqual(['ACCEPTED', 'REJECTED']);
    expect(d!.verifications[0].evidence.map(e => e.id)).toEqual([ev.id]);

    // Verified != closed: still open until closed explicitly.
    expect(d!.action.status).toBe('AWAITING_VERIFICATION');
    await expectError(m.actions.closeAction(viewerA, a.id), 'AssuranceForbiddenError');
    await m.actions.closeAction(mgrA, a.id);
    expect((await m.actions.getActionDetail(mgrA, a.id))!.action.status).toBe('CLOSED');

    // Closed action's evidence is part of the closure record.
    const link2 = (await m.actions.getActionDetail(mgrA, a.id))!.evidence.find(e => !e.removed_at)!;
    await expectError(m.evidence.unlinkEvidence(mgrA, { target: 'action', linkId: link2.link_id, reason: 'x' }), 'AssuranceConflictError');

    // No propagation: the finding and the incident are untouched.
    expect((await m.findings.getFindingDetail(mgrA, f.id))!.finding.status).toBe('OPEN');
    expect((await m.incidents.getIncidentDetail(mgrA, inc.id))!.incident.status).toBe('REPORTED');

    // Verification history is append-only at the DB level.
    await expect(sql.raw(`UPDATE assurance_verifications SET result = 'REJECTED' WHERE id = '${v2.id}'`)).rejects.toThrow(/append-only/);
    await expect(sql.raw(`DELETE FROM assurance_verifications WHERE id = '${v1.id}'`)).rejects.toThrow(/append-only/);

    // Explicit, guarded closure up the chain.
    await m.findings.transitionFinding(mgrA, f.id, { status: 'UNDER_REVIEW' });
    await m.findings.transitionFinding(mgrA, f.id, { status: 'CLOSED' });
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'UNDER_REVIEW' });
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED', closureSummary: 'Grate secured and verified.' });
    expect((await m.incidents.getIncidentDetail(mgrA, inc.id))!.incident.status).toBe('CLOSED');
  });

  it('finding and incident closure are refused while linked work is open', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Closure guard probe' }));
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'Guard', description: 'd', incidentId: inc.id });
    await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'Fix it', verificationRequired: false, evidenceRequired: false });
    await m.findings.transitionFinding(mgrA, f.id, { status: 'UNDER_REVIEW' });
    await expectError(m.findings.transitionFinding(mgrA, f.id, { status: 'CLOSED' }), 'AssuranceConflictError', /action/);
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'UNDER_REVIEW' });
    await expectError(m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED', closureSummary: 'x' }), 'AssuranceConflictError', /finding/);
  });

  it('writes audit rows for mutations without copying free-text descriptions', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Audit probe', description: 'SENSITIVE-DESCRIPTION-TEXT' }));
    const rows = await sql.raw(`SELECT action, user_id, organisation_id, after_state::text AS s FROM audit_logs WHERE resource_id = '${inc.id}'`) as { action: string; user_id: string; organisation_id: string; s: string }[];
    expect(rows).toEqual([expect.objectContaining({ action: 'assurance_incident.created', user_id: 'a-mgr', organisation_id: 'org-a' })]);
    expect(rows[0].s).not.toMatch(/SENSITIVE-DESCRIPTION-TEXT/);
  });

  it('dashboard reflects overdue work and serious incidents from real rows', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'Serious open incident', riskLevelId: RISK_HIGH_A }));
    await m.incidents.createIncident(mgrA, incidentInput({ title: 'Minor open incident', riskLevelId: RISK_LOW_A }));
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'Overdue probe', description: 'd', incidentId: inc.id });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: 'Overdue action', dueAt: future(1) });
    await sql.raw(`UPDATE assurance_timeframes SET current_due_at = now() - interval '2 days' WHERE action_id = '${a.id}'`);
    const d = await m.dashboard.getDashboardData(mgrA);
    expect(d.attention.some(w => w.id === a.id && w.kind === 'action')).toBe(true);
    expect(d.seriousIncidents.some(w => w.id === inc.id)).toBe(true);
    expect(d.counts.overdue_actions).toBeGreaterThanOrEqual(1);
    expect((await m.actions.listActions(mgrA, { view: 'overdue' })).some(r => r.id === a.id)).toBe(true);
  });
});

// ── Synthetic demo fixture (scripts/assurance-demo/seed-assurance-demo.sql) ─
// The harness seeds the fixture before this suite runs. These checks prove
// it loads coherently and renders the intended workflow through the REAL
// services — not just that the SQL applied.
describe('synthetic demo fixture renders a coherent, connected scenario', () => {
  const DEMO = 'assurance-demo-org';
  const demoAdmin = V(DEMO, 'assurance-demo-coordinator', 'admin');
  const demoWhs = V(DEMO, 'assurance-demo-whs', 'manager');
  const demoViewer = V(DEMO, 'assurance-demo-viewer', 'viewer');
  const id = (n: string) => `a55de000-0000-4000-8000-000000000${n}`;

  it('is obviously synthetic and namespaced', async () => {
    const users = await sql.raw(`SELECT id, name FROM users WHERE organisation_id = '${DEMO}'`) as { id: string; name: string }[];
    expect(users.length).toBe(5);
    expect(users.every(u => u.id.startsWith('assurance-demo-') && u.name.startsWith('Demo · '))).toBe(true);
    const refs = await sql.raw(`SELECT incident_reference AS r FROM assurance_incidents WHERE organisation_id = '${DEMO}'`) as { r: string }[];
    expect(refs.every(x => /^INC-DEMO-\d{3}$/.test(x.r))).toBe(true);
    const org = await sql.raw(`SELECT name FROM organisations WHERE id = '${DEMO}'`) as { name: string }[];
    expect(org[0].name).toMatch(/^\[DEMO\].*\(synthetic\)$/);
  });

  it('the dashboard answers the operational questions from the fixture', async () => {
    const d = await m.dashboard.getDashboardData(demoAdmin);
    expect(d.isEmpty).toBe(false);
    expect(d.counts).toMatchObject({
      open_incidents: 4, serious_open_incidents: 2, active_investigations: 1, inspections_due: 1,
      inspections_in_progress: 1, open_findings: 4, open_actions: 3, overdue_actions: 1, awaiting_verification: 2,
      audits_due: 1, audits_in_progress: 0, audits_completed_30d: 1, open_audit_findings: 1,
    });
    expect(d.attention.map(w => w.reference)).toContain('ACT-DEMO-003');
    expect(d.awaitingVerification.map(w => w.reference).sort()).toEqual(['ACT-DEMO-002', 'ACT-DEMO-004']);
    expect(d.inspectionsDue.map(w => w.reference).sort()).toEqual(['AUD-DEMO-002', 'INS-DEMO-002', 'INS-DEMO-003']);
    // The customer-service viewer does not see the restricted security incident.
    const v = await m.dashboard.getDashboardData(demoViewer);
    expect(v.counts.open_incidents).toBe(3);
    expect(v.counts.serious_open_incidents).toBe(1);
  });

  it('inspection -> finding -> action -> evidence -> verification chain, with template v1 preserved', async () => {
    const ins = await m.inspections.getInspectionDetail(demoAdmin, id('401'));
    expect(ins!.inspection).toMatchObject({ template_version_number: 1, latest_template_version_number: 2, status: 'COMPLETED' });
    expect(ins!.checklist).toHaveLength(5);
    expect(ins!.responses.find(r => r.item_key === '02-drain-grates-secured')!.outcome).toBe('FAIL');
    expect(ins!.findings).toEqual([expect.objectContaining({ finding_reference: 'FND-DEMO-001', source_item_key: '02-drain-grates-secured' })]);

    const act = await m.actions.getActionDetail(demoAdmin, id('801'));
    expect(act!.action.status).toBe('CLOSED');
    expect(act!.verifications.map(v => [v.attempt_number, v.result])).toEqual([[2, 'ACCEPTED'], [1, 'REJECTED']]);
    expect(act!.verifications[0].evidence.map(e => e.reference)).toEqual(['EVD-DEMO-001']);
    expect(act!.evidence.filter(e => e.removed_at).map(e => e.evidence_reference)).toEqual(['EVD-DEMO-003']);
    expect(act!.tasks.map(t => t.name)).toEqual(['Bolt down wash bay grate WB-3 (DEMO)']);

    // Closing the action did not close its finding.
    const f = await m.findings.getFindingDetail(demoAdmin, id('701'));
    expect(f!.finding.status).toBe('AWAITING_VERIFICATION');
    expect(f!.sources.map(s => s.reference)).toEqual(['INS-DEMO-001']);
  });

  it('incident <-> investigation M:N and awaiting-verification work', async () => {
    const inc = await m.incidents.getIncidentDetail(demoAdmin, id('501'));
    expect(inc!.investigations.map(l => [l.investigation_reference, l.relationship]).sort()).toEqual([['INV-DEMO-001', 'PRIMARY'], ['INV-DEMO-002', 'CONTEXT']]);
    expect(inc!.incident.status).toBe('UNDER_INVESTIGATION'); // INV-DEMO-002 completed; incident still open
    expect(inc!.people.map(p => p.role).sort()).toEqual(['INJURED_PERSON', 'WITNESS']);
    const inv = await m.investigations.getInvestigationDetail(demoAdmin, id('601'));
    expect(inv!.incidents.map(l => l.incident_reference)).toEqual(['INC-DEMO-001', 'INC-DEMO-002']);
    const queue = await m.verifications.listVerificationQueue(demoWhs);
    expect(queue.map(q => [q.action_reference, q.can_verify])).toEqual([['ACT-DEMO-002', true]]);
    const act2 = await m.actions.getActionDetail(demoAdmin, id('802'));
    const tf = act2!.timeframes[0];
    expect(new Date(tf.original_due_at).getTime()).toBeLessThan(new Date(tf.current_due_at).getTime());
    expect(tf.extensions).toHaveLength(1);
  });

  it('the restricted incident is visible only to its owner/admins', async () => {
    expect(await m.incidents.getIncidentDetail(demoAdmin, id('503'))).not.toBeNull();
    expect(await m.incidents.getIncidentDetail(demoWhs, id('503'))).toBeNull();
    expect(await m.incidents.getIncidentDetail(demoViewer, id('503'))).toBeNull();
  });

  it('supports the next click-through: the independent verifier accepts ACT-DEMO-002, then it can be closed', async () => {
    await m.verifications.recordVerification(demoWhs, id('802'), { result: 'ACCEPTED', notes: 'Slip test passed (synthetic).' });
    await m.actions.closeAction(demoAdmin, id('802'));
    expect((await m.actions.getActionDetail(demoAdmin, id('802')))!.action.status).toBe('CLOSED');
    // FND-DEMO-002 can move on, but closure is refused while ACT-DEMO-003 is outstanding.
    await m.findings.transitionFinding(demoAdmin, id('702'), { status: 'AWAITING_VERIFICATION' });
    await expectError(m.findings.transitionFinding(demoAdmin, id('702'), { status: 'CLOSED' }), 'AssuranceConflictError', /linked actions are still open/);
  });
});

// ── Security review remediation (read-only review of this branch) ────────
describe('security review remediation', () => {
  it('M1: evidence already used elsewhere cannot be pulled under a restricted record (would hide it)', async () => {
    const open = await m.incidents.createIncident(mgrA, incidentInput({ title: 'M1 open incident' }));
    const secret = await m.incidents.createIncident(mgrA, incidentInput({ title: 'M1 restricted incident', restricted: true }));
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'M1 shared photo', target: 'incident', targetId: open.id });
    await expectError(m.evidence.linkEvidence(mgrA, ev.id, { target: 'incident', targetId: secret.id }), 'AssuranceConflictError', /hide it/);
    expect(await m.evidence.getEvidenceDetail(mgr2A, ev.id)).not.toBeNull();
    // New evidence recorded directly for the restricted record is fine (and restricted).
    const own = await m.evidence.createEvidence(mgrA, { evidenceType: 'STATEMENT', title: 'M1 restricted statement', target: 'incident', targetId: secret.id });
    expect(await m.evidence.getEvidenceDetail(mgr2A, own.id)).toBeNull();
    // Linking restricted-scoped evidence onward to an open record is allowed (it stays restricted).
    await m.evidence.linkEvidence(mgrA, own.id, { target: 'incident', targetId: open.id });
    expect(await m.evidence.getEvidenceDetail(mgr2A, own.id)).toBeNull();
  });

  it('M2: services refuse children under finished parents, not only the UI', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'M2 closed incident' }));
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'UNDER_REVIEW' });
    await m.incidents.transitionIncident(mgrA, inc.id, { status: 'CLOSED', closureSummary: 'done' });
    await expectError(m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 't', description: 'd', incidentId: inc.id }), 'AssuranceConflictError');

    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'M2 finding', description: 'd' });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'M2 action', evidenceRequired: false, verificationRequired: false });
    await m.actions.completeActionWork(mgrA, a.id);
    await m.actions.closeAction(mgrA, a.id);
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'late', target: 'action', targetId: a.id }), 'AssuranceConflictError', /finished/);
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'unlinked' });
    await expectError(m.evidence.linkEvidence(mgrA, ev.id, { target: 'action', targetId: a.id }), 'AssuranceConflictError', /finished/);
    await m.findings.transitionFinding(mgrA, f.id, { status: 'UNDER_REVIEW' });
    await m.findings.transitionFinding(mgrA, f.id, { status: 'CLOSED' });
    await expectError(m.evidence.linkEvidence(mgrA, ev.id, { target: 'finding', targetId: f.id }), 'AssuranceConflictError', /finished/);
    await expectError(m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'late' }), 'AssuranceConflictError');
  });

  it('M5: evidence cannot be added to (or removed from) an existing verification record', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'M5 finding', description: 'd' });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'M5 action', ownerUserId: 'a-mgr', evidenceRequired: false });
    await m.actions.completeActionWork(mgrA, a.id);
    const v = await m.verifications.recordVerification(mgr2A, a.id, { result: 'ACCEPTED' });
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'after the fact' });
    await expectError(m.evidence.linkEvidence(mgrA, ev.id, { target: 'verification', targetId: v.id }), 'AssuranceConflictError', /verification/);
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'verification', targetId: v.id }), 'AssuranceConflictError', /verification/);
  });

  it('M3: an evidence unlink racing a closure cannot leave a closed action without evidence', async () => {
    const { Client } = await import('pg');
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'M3 finding', description: 'd' });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'M3 action', ownerUserId: 'a-mgr', verificationRequired: false });
    await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'M3 photo', target: 'action', targetId: a.id });
    await m.actions.completeActionWork(mgrA, a.id);
    const link = (await m.actions.getActionDetail(mgrA, a.id))!.evidence[0];

    // Simulate a closure in flight: hold the action lock and close it, uncommitted.
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM assurance_actions WHERE id = $1 FOR UPDATE', [a.id]);
      await c.query("UPDATE assurance_actions SET status = 'CLOSED', closed_at = now() WHERE id = $1", [a.id]);
      const unlink = m.evidence.unlinkEvidence(mgrA, { target: 'action', linkId: link.link_id, reason: 'race probe' }).then(() => 'unlinked', e => (e as Error).name);
      await new Promise(r => setTimeout(r, 300));
      await c.query('COMMIT');
      expect(await unlink).toBe('AssuranceConflictError');
    } finally {
      await c.end();
    }
    const d = await m.actions.getActionDetail(mgrA, a.id);
    expect(d!.action.status).toBe('CLOSED');
    expect(d!.evidence.filter(e => !e.removed_at)).toHaveLength(1);
  });

  it('M4: creating an action racing the finding closure cannot leave an open action under a closed finding', async () => {
    const { Client } = await import('pg');
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'M4 finding', description: 'd' });
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM assurance_findings WHERE id = $1 FOR UPDATE', [f.id]);
      await c.query("UPDATE assurance_findings SET status = 'CLOSED', closed_at = now() WHERE id = $1", [f.id]);
      const create = m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'M4 racing action' }).then(() => 'created', e => (e as Error).name);
      await new Promise(r => setTimeout(r, 300));
      await c.query('COMMIT');
      expect(await create).toBe('AssuranceConflictError');
    } finally {
      await c.end();
    }
    const n = await sql.raw(`SELECT count(*)::int AS n FROM assurance_actions WHERE title = 'M4 racing action'`) as { n: number }[];
    expect(n[0].n).toBe(0);
  });

  it('L1: counts do not reveal restricted records to uninvolved users', async () => {
    const inc = await m.incidents.createIncident(mgrA, incidentInput({ title: 'L1 open incident' }));
    await m.investigations.createInvestigation(adminA, { title: 'L1 restricted investigation', scope: 's', restricted: true, relatedIncidentIds: [inc.id] });
    const inv2 = await m.investigations.createInvestigation(mgrA, { title: 'L1 open investigation', scope: 's', primaryIncidentId: inc.id });
    const row = (await m.incidents.listIncidents(mgr2A, { q: 'L1 open incident' }))[0];
    expect(row.investigation_count).toBe(1);
    expect((await m.incidents.listIncidents(adminA, { q: 'L1 open incident' }))[0].investigation_count).toBe(2);
    const d = await m.investigations.getInvestigationDetail(mgr2A, inv2.id);
    expect(d!.incidents[0].other_investigation_count).toBe(0);
    expect((await m.investigations.getInvestigationDetail(adminA, inv2.id))!.incidents[0].other_investigation_count).toBe(1);
  });

  it('L3: response revisions keep the previous value; items with raised findings are frozen', async () => {
    const ins = await m.inspections.createInspection(mgrA, { title: 'L3 inspection', inspectionType: 'SITE' });
    await m.inspections.startInspection(mgrA, ins.id);
    const key = 'adhoc-l3-item-000001';
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: key, itemLabel: 'L3 item', outcome: 'OBSERVATION', notes: 'first note' });
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: key, itemLabel: 'L3 item', outcome: 'FAIL', notes: 'second note' });
    const audit = await sql.raw(`SELECT before_state FROM audit_logs WHERE resource_id = '${ins.id}' AND action = 'assurance_inspection.response_recorded' ORDER BY created_at`) as { before_state: Record<string, unknown> | null }[];
    expect(audit.map(x => x.before_state?.notes ?? null)).toEqual([null, 'first note']);
    await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'L3 finding', description: 'd', inspectionId: ins.id, inspectionItemKey: key });
    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: key, itemLabel: 'L3 item', outcome: 'PASS' }), 'AssuranceConflictError', /frozen|no longer be changed/);
  });

  it('L4/L6/L7: cancellation reason kept, single PRIMARY enforced, completers stay non-independent', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'L4 finding', description: 'd' });
    const cancelled = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'L4 action' });
    await m.actions.cancelAction(mgrA, cancelled.id, { reason: 'Superseded by capital works program' });
    const aud = await sql.raw(`SELECT after_state->>'reason' AS r FROM audit_logs WHERE resource_id = '${cancelled.id}' AND action = 'assurance_action.cancelled'`) as { r: string }[];
    expect(aud[0].r).toBe('Superseded by capital works program');

    const i1 = await m.incidents.createIncident(mgrA, incidentInput({ title: 'L6 a' }));
    const i2 = await m.incidents.createIncident(mgrA, incidentInput({ title: 'L6 b' }));
    const inv = await m.investigations.createInvestigation(mgrA, { title: 'L6', scope: 's', primaryIncidentId: i1.id });
    await expectError(m.investigations.linkIncidentToInvestigation(mgrA, inv.id, { incidentId: i2.id, relationship: 'PRIMARY' }), 'AssuranceConflictError', /primary/);

    // mgr2A completes the work, is rejected... then someone else re-completes: mgr2A still cannot verify.
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'L7 action', ownerUserId: 'a-admin', evidenceRequired: false });
    await m.actions.completeActionWork(mgr2A, a.id);
    await m.verifications.recordVerification(mgrA, a.id, { result: 'REJECTED', notes: 'redo' });
    await m.actions.completeActionWork(mgrA, a.id);
    await expectError(m.verifications.recordVerification(mgr2A, a.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/);
    expect((await m.verifications.listVerificationQueue(mgr2A)).find(q => q.id === a.id)?.can_verify).toBe(false);

    // A no-op re-completion is refused.
    const b = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'L7 noop', evidenceRequired: false, verificationRequired: false });
    await m.actions.completeActionWork(mgrA, b.id);
    await expectError(m.actions.completeActionWork(mgrA, b.id), 'AssuranceConflictError', /already/);
  });

  it('L2: verification evidence is listed only when the viewer can see it', async () => {
    const secret = await m.incidents.createIncident(adminA, incidentInput({ title: 'L2 restricted', restricted: true }));
    const hidden = await m.evidence.createEvidence(adminA, { evidenceType: 'STATEMENT', title: 'L2 hidden statement', target: 'incident', targetId: secret.id });
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'L2 finding', description: 'd' });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'REMEDIAL', title: 'L2 action', ownerUserId: 'a-mgr', evidenceRequired: false });
    await m.actions.completeActionWork(mgrA, a.id);
    await m.verifications.recordVerification(adminA, a.id, { result: 'ACCEPTED', evidenceIds: [hidden.id] });
    const forAdmin = await m.actions.getActionDetail(adminA, a.id);
    expect(forAdmin!.verifications[0].evidence.map(e => e.id)).toEqual([hidden.id]);
    const forOther = await m.actions.getActionDetail(mgr2A, a.id);
    expect(forOther!.verifications[0].evidence).toEqual([]);
    expect(JSON.stringify(forOther)).not.toMatch(/L2 hidden statement/);
  });
});

// ── A0.1E-1 Audit ──────────────────────────────────────────────────────────
describe('audits (A0.1E-1)', () => {
  const adminB = V('org-b', 'b-mgr', 'admin');
  const criteria = [
    { label: 'Route sheets completed every shift' },
    { label: 'Contamination reported within 5 days' },
    { label: 'Pre-start checks recorded' },
    { label: 'Hazardous waste handled by licensed contractor', required: false },
  ];
  async function newTemplate(viewer = adminA, name = 'Audit tpl') {
    return m.auditTemplates.createAuditTemplate(viewer, { name, auditType: 'INTERNAL', standardReference: 'Synthetic Procedure v1', criteria });
  }

  it('ad hoc audits require a standard_reference (service and database)', async () => {
    await expectError(m.audits.createAudit(mgrA, { title: 'No basis', scope: 's', auditType: 'SITE' }), 'AssuranceValidationError', /standard/);
    await expect(sql.raw(`INSERT INTO assurance_audits (organisation_id, audit_reference, audit_type, title, scope)
      VALUES ('org-a', 'AUD-RAW-1', 'SITE', 't', 's')`)).rejects.toThrow(/basis_check/);
    const a = await m.audits.createAudit(mgrA, { title: 'Ad hoc', scope: 's', auditType: 'SITE', standardReference: 'Synthetic Std 2' });
    expect((await m.audits.getAuditDetail(mgrA, a.id))!.audit.standard_reference).toBe('Synthetic Std 2');
  });

  it('tenant isolation: another organisation cannot see, act on or link to an audit', async () => {
    const a = await m.audits.createAudit(mgrA, { title: 'Tenant audit', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    expect((await m.audits.listAudits(mgrB)).some(r => r.id === a.id)).toBe(false);
    expect(await m.audits.getAuditDetail(mgrB, a.id)).toBeNull();
    await expectError(m.audits.startAudit(mgrB, a.id), 'AssuranceNotFoundError');
    await expectError(m.audits.recordAuditResponse(mgrB, a.id, { criterionKey: 'adhoc-x-000001', criterionLabel: 'x', outcome: 'COMPLIANT' }), 'AssuranceNotFoundError');
    await expectError(m.findings.createFinding(mgrB, { findingType: 'DEFECT', title: 't', description: 'd', auditId: a.id }), 'AssuranceNotFoundError');
    await expectError(m.evidence.createEvidence(mgrB, { evidenceType: 'PHOTO', title: 'x', target: 'audit', targetId: a.id }), 'AssuranceNotFoundError');
    expect(await m.audits.getAuditDetail(mgrA, 'not-a-uuid')).toBeNull();
  });

  it('same-org ACTIVE auditor validation and no organisation_id trust', async () => {
    await expectError(m.audits.createAudit(mgrA, { title: 't', scope: 's', auditType: 'SITE', standardReference: 'Std', auditorUserId: 'b-mgr' }), 'AssuranceValidationError', /Auditor/);
    await expectError(m.audits.createAudit(mgrA, { title: 't', scope: 's', auditType: 'SITE', standardReference: 'Std', auditorUserId: 'a-inactive' }), 'AssuranceValidationError', /Auditor/);
    await expectError(m.audits.createAudit(viewerA, { title: 't', scope: 's', auditType: 'SITE', standardReference: 'Std' }), 'AssuranceForbiddenError');
    const a = await m.audits.createAudit(mgrA, {
      title: 'Mass assignment probe', scope: 's', auditType: 'SITE', standardReference: 'Std', auditorUserId: 'a-mgr2',
      organisationId: 'org-b', organisation_id: 'org-b', status: 'COMPLETED', created_by: 'b-mgr',
    });
    const row = (await sql.raw(`SELECT organisation_id, status, created_by, auditor_user_id FROM assurance_audits WHERE id = '${a.id}'`) as Record<string, string>[])[0];
    expect(row).toEqual({ organisation_id: 'org-a', status: 'PLANNED', created_by: 'a-mgr', auditor_user_id: 'a-mgr2' });
  });

  it('cross-tenant template, location, asset and external organisation are rejected', async () => {
    const tplB = await newTemplate(adminB, 'Org B template');
    await expectError(m.audits.createAudit(mgrA, { title: 't', scope: 's', templateVersionId: tplB.version_id }), 'AssuranceValidationError', /Template/);
    const [assetB] = await sql.raw(`INSERT INTO assets (organisation_id, asset_reference, asset_type, name) VALUES ('org-b', 'AST-B-AUD', 'VEHICLE', 'B truck') RETURNING id`) as { id: string }[];
    const [orgB] = await sql.raw(`INSERT INTO external_organisations (organisation_id, reference, name) VALUES ('org-b', 'EXT-B-AUD', 'B contractor') RETURNING id`) as { id: string }[];
    const base = { title: 't', scope: 's', auditType: 'SITE', standardReference: 'Std' };
    await expectError(m.audits.createAudit(mgrA, { ...base, locationId: LOC_B }), 'AssuranceValidationError', /Location/);
    await expectError(m.audits.createAudit(mgrA, { ...base, assetId: assetB.id }), 'AssuranceValidationError', /Asset/);
    await expectError(m.audits.createAudit(mgrA, { ...base, externalOrganisationId: orgB.id }), 'AssuranceValidationError', /External/);
    // Templates are admin-only and org-scoped.
    await expectError(m.auditTemplates.createAuditTemplate(mgrA, { name: 'x', auditType: 'SITE', criteria }), 'AssuranceForbiddenError');
    expect(await m.auditTemplates.getAuditTemplateDetail(adminA, tplB.id)).toBeNull();
    await expectError(m.auditTemplates.createAuditTemplateVersion(adminA, tplB.id, { title: 'x', criteria }), 'AssuranceNotFoundError');
  });

  it('template versions are immutable and historical audits keep their exact version', async () => {
    const t = await newTemplate(adminA, 'Waste ops');
    const a = await m.audits.createAudit(mgrA, { title: 'Bound to v1', scope: 's', templateVersionId: t.version_id, auditorUserId: 'a-mgr2', scheduledAt: future(3), locationId: LOC_A });
    const v2 = await m.auditTemplates.createAuditTemplateVersion(adminA, t.id, { title: 'Waste ops rev 2', standardReference: 'Synthetic Procedure v2', criteria: [{ label: 'Only criterion in v2' }] });
    expect(v2.version_number).toBe(2);
    await expect(sql.raw(`UPDATE assurance_audit_template_versions SET title = 'tampered' WHERE id = '${t.version_id}'`)).rejects.toThrow(/immutable/);
    await expect(sql.raw(`DELETE FROM assurance_audit_template_versions WHERE id = '${t.version_id}'`)).rejects.toThrow(/immutable/);
    const d = await m.audits.getAuditDetail(mgrA, a.id);
    expect(d!.audit).toMatchObject({ template_version_number: 1, latest_template_version_number: 2, standard_reference: 'Synthetic Procedure v1', audit_type: 'INTERNAL' });
    expect(d!.criteria.map(c => c.label)).toEqual(criteria.map(c => c.label));
    const td = await m.auditTemplates.getAuditTemplateDetail(adminA, t.id);
    expect(td!.versions.map(v => [v.version_number, v.audit_count])).toEqual([[2, 0], [1, 1]]);
    // A new audit planned now binds to whichever version is chosen (v2 here).
    const b = await m.audits.createAudit(mgrA, { title: 'Bound to v2', scope: 's', templateVersionId: v2.id });
    expect((await m.audits.getAuditDetail(mgrA, b.id))!.criteria.map(c => c.label)).toEqual(['Only criterion in v2']);
  });

  it('criterion responses: one per criterion, labels from the version, validation, frozen after completion', async () => {
    const t = await newTemplate(adminA, 'Response tpl');
    const a = await m.audits.createAudit(mgrA, { title: 'Responses', scope: 's', templateVersionId: t.version_id });
    const keys = (await m.audits.getAuditDetail(mgrA, a.id))!.criteria.map(c => c.key);
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[0], outcome: 'COMPLIANT' }), 'AssuranceConflictError', /in progress/);
    await m.audits.startAudit(mgrA, a.id);
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: 'not-in-version', outcome: 'COMPLIANT' }), 'AssuranceValidationError');
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[0] }), 'AssuranceValidationError', /rating/);
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[2], outcome: 'NON_COMPLIANT' }), 'AssuranceValidationError', /gap/);
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[0], outcome: 'PARTIAL', notes: 'first pass', criterionLabel: 'IGNORED LABEL' });
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[0], outcome: 'COMPLIANT' });
    await expect(sql.raw(`INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type)
      VALUES ('org-a', '${a.id}', '${keys[0]}', 'dup', 'COMPLIANCE_RATING')`)).rejects.toThrow(/criterion_key_key|duplicate/);
    const d = await m.audits.getAuditDetail(mgrA, a.id);
    expect(d!.responses).toHaveLength(1);
    expect(d!.responses[0]).toMatchObject({ criterion_label: criteria[0].label, outcome: 'COMPLIANT' });
    const hist = await sql.raw(`SELECT before_state FROM audit_logs WHERE resource_id = '${a.id}' AND action = 'assurance_audit.response_recorded' ORDER BY created_at`) as { before_state: Record<string, unknown> | null }[];
    expect(hist.map(h => h.before_state?.outcome ?? null)).toEqual([null, 'PARTIAL']);
    await expectError(m.audits.completeAudit(mgrA, a.id, {}), 'AssuranceConflictError', /required criteria/);
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[1], outcome: 'COMPLIANT' });
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[2], outcome: 'NON_COMPLIANT', notes: '6 of 20 missing' });
    await m.audits.completeAudit(mgrA, a.id, { summary: 'One gap', recommendations: 'Digitise pre-starts' });
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: keys[3], outcome: 'NOT_APPLICABLE' }), 'AssuranceConflictError');
    // A non-compliant rating never creates a finding by itself.
    const done = await m.audits.getAuditDetail(mgrA, a.id);
    expect(done!.findings).toEqual([]);
    expect(done!.audit).toMatchObject({ status: 'COMPLETED', recommendations: 'Digitise pre-starts' });
  });

  it('findings: raised explicitly through the shared service, linked, frozen criterion, no auto-closure either way', async () => {
    const a = await m.audits.createAudit(mgrA, { title: 'Finding links', scope: 's', auditType: 'COMPLIANCE', standardReference: 'Std' });
    await m.audits.startAudit(mgrA, a.id);
    const key = 'adhoc-pre-start-000001';
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'Pre-start checks', outcome: 'NON_COMPLIANT', notes: 'missing' });
    await expectError(m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: 'x', description: 'y', auditId: a.id, auditCriterionKey: 'adhoc-missing-000000' }), 'AssuranceValidationError');
    const f = await m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: 'Pre-starts missing', description: 'missing', auditId: a.id, auditCriterionKey: key });
    const link = await sql.raw(`SELECT count(*)::int AS n FROM assurance_audit_findings WHERE audit_id = '${a.id}' AND finding_id = '${f.id}'`) as { n: number }[];
    expect(link[0].n).toBe(1);
    const d = await m.audits.getAuditDetail(mgrA, a.id);
    expect(d!.findings).toEqual([expect.objectContaining({ id: f.id, source_criterion_key: key })]);
    expect((await m.findings.getFindingDetail(mgrA, f.id))!.sources).toEqual([{ kind: 'audit', id: a.id, reference: expect.stringMatching(/^AUD-/) }]);
    expect((await m.findings.listFindings(mgrA, { source: 'audit' })).some(r => r.id === f.id)).toBe(true);
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'Pre-start checks', outcome: 'COMPLIANT' }), 'AssuranceConflictError', /no longer be changed/);

    // Link an existing finding; duplicates refused.
    const other = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'Existing repeat issue', description: 'd' });
    await m.audits.linkFindingToAudit(mgrA, a.id, { findingId: other.id });
    await expectError(m.audits.linkFindingToAudit(mgrA, a.id, { findingId: other.id }), 'AssuranceConflictError', /already linked/);
    await expectError(m.audits.linkFindingToAudit(mgrB, a.id, { findingId: other.id }), 'AssuranceNotFoundError');

    // Corrective work goes through the finding; completing the audit changes nothing downstream.
    const act = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: 'Digital pre-starts', evidenceRequired: false, verificationRequired: false });
    await m.audits.completeAudit(mgrA, a.id, {});
    expect((await m.findings.getFindingDetail(mgrA, f.id))!.finding.status).toBe('OPEN');
    expect((await m.actions.getActionDetail(mgrA, act.id))!.action.status).toBe('OPEN');
    // ...and closing the finding does not change the audit.
    await m.actions.completeActionWork(mgrA, act.id);
    await m.actions.closeAction(mgrA, act.id);
    await m.findings.transitionFinding(mgrA, f.id, { status: 'UNDER_REVIEW' });
    await m.findings.transitionFinding(mgrA, f.id, { status: 'CLOSED' });
    expect((await m.audits.getAuditDetail(mgrA, a.id))!.audit.status).toBe('COMPLETED');

    // A cancelled audit accepts no new findings or evidence.
    const c = await m.audits.createAudit(mgrA, { title: 'To cancel', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    await expectError(m.audits.cancelAudit(mgrA, c.id, {}), 'AssuranceValidationError', /Reason/);
    await m.audits.cancelAudit(mgrA, c.id, { reason: 'Rescheduled into Q4 programme' });
    await expectError(m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 't', description: 'd', auditId: c.id }), 'AssuranceConflictError');
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'audit', targetId: c.id }), 'AssuranceConflictError', /finished/);
  });

  it('evidence on audits: link, soft unlink with reason, relink — history kept', async () => {
    const a = await m.audits.createAudit(mgrA, { title: 'Evidence audit', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: 'Working papers', target: 'audit', targetId: a.id });
    const link = (await m.audits.getAuditDetail(mgrA, a.id))!.evidence[0];
    await m.evidence.unlinkEvidence(mgrA, { target: 'audit', linkId: link.link_id, reason: 'Wrong file' });
    await m.evidence.linkEvidence(mgrA, ev.id, { target: 'audit', targetId: a.id, purpose: 'Correct file' });
    const d = await m.audits.getAuditDetail(mgrA, a.id);
    expect(d!.evidence.map(e => [!!e.removed_at, e.removal_reason])).toEqual([[false, null], [true, 'Wrong file']]);
    const evd = await m.evidence.getEvidenceDetail(mgrA, ev.id);
    expect(evd!.links.filter(l => l.kind === 'audit')).toHaveLength(2);
    expect((await m.evidence.listEvidence(mgrA, { q: 'Working papers' }))[0].links.map(l => l.kind)).toEqual(['audit']);
  });

  it('restricted-parent inheritance: audit detail never shows findings/evidence hidden by a restricted incident', async () => {
    const secret = await m.incidents.createIncident(adminA, incidentInput({ title: 'Audit restricted parent', restricted: true }));
    const a = await m.audits.createAudit(mgrA, { title: 'Inheritance audit', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    const f = await m.findings.createFinding(adminA, { findingType: 'HAZARD', title: 'Sensitive finding', description: 'd', incidentId: secret.id });
    await m.audits.linkFindingToAudit(adminA, a.id, { findingId: f.id });
    const hiddenEv = await m.evidence.createEvidence(adminA, { evidenceType: 'STATEMENT', title: 'Sensitive statement', target: 'incident', targetId: secret.id });
    await m.evidence.linkEvidence(adminA, hiddenEv.id, { target: 'audit', targetId: a.id });
    const forOther = await m.audits.getAuditDetail(mgr2A, a.id);
    expect(forOther!.findings).toEqual([]);
    expect(forOther!.hiddenFindingCount).toBe(1);
    expect(forOther!.evidence).toEqual([]);
    expect(JSON.stringify(forOther)).not.toMatch(/Sensitive/);
    expect((await m.audits.listAudits(mgr2A, { q: 'Inheritance audit' }))[0].finding_count).toBe(0);
    expect((await m.audits.getAuditDetail(adminA, a.id))!.findings).toHaveLength(1);
    // Linking a finding the viewer cannot see is refused as not found.
    const a2 = await m.audits.createAudit(mgr2A, { title: 'Probe', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    await expectError(m.audits.linkFindingToAudit(mgr2A, a2.id, { findingId: f.id }), 'AssuranceNotFoundError');
  });

  it('dashboard audit counts come from real rows', async () => {
    const before = (await m.dashboard.getDashboardData(mgrA)).counts;
    const due = await m.audits.createAudit(mgrA, { title: 'Due soon', scope: 's', auditType: 'SITE', standardReference: 'Std', scheduledAt: future(5) });
    await m.audits.createAudit(mgrA, { title: 'Far away', scope: 's', auditType: 'SITE', standardReference: 'Std', scheduledAt: future(60) });
    const running = await m.audits.createAudit(mgrA, { title: 'Running', scope: 's', auditType: 'SITE', standardReference: 'Std' });
    await m.audits.startAudit(mgrA, running.id);
    const after = await m.dashboard.getDashboardData(mgrA);
    expect(after.counts.audits_due - before.audits_due).toBe(1);
    expect(after.counts.audits_in_progress - before.audits_in_progress).toBe(1);
    expect(after.inspectionsDue.some(w => w.kind === 'audit' && w.id === due.id)).toBe(true);
    expect((await m.audits.listAudits(mgrA, { view: 'due' })).some(r => r.id === due.id)).toBe(true);
    expect((await m.dashboard.getDashboardData(mgrB)).counts.audits_due).toBe(0);
  });
});

describe('synthetic demo fixture — audit chain', () => {
  const demoAdmin = V('assurance-demo-org', 'assurance-demo-coordinator', 'admin');
  const id = (n: string) => `a55de000-0000-4000-8000-000000000${n}`;
  it('AUD-DEMO-001 shows each rating, and the non-compliant criterion leads Finding -> Action -> Evidence -> Verification', async () => {
    const d = await m.audits.getAuditDetail(demoAdmin, id('411'));
    expect(d!.audit).toMatchObject({ audit_reference: 'AUD-DEMO-001', status: 'COMPLETED', standard_reference: 'Synthetic Waste Operations Procedure v1', template_version_number: 1 });
    expect(Object.fromEntries(d!.responses.map(r => [r.criterion_key, r.outcome]))).toMatchObject({
      '01-route-sheets': 'COMPLIANT', '02-contamination-reports': 'PARTIAL', '03-pre-start-checks': 'NON_COMPLIANT', '04-hazardous-waste': 'NOT_APPLICABLE',
    });
    expect(d!.findings).toEqual([expect.objectContaining({ finding_reference: 'FND-DEMO-004', source_criterion_key: '03-pre-start-checks' })]);
    expect(d!.evidence.map(e => e.evidence_reference)).toEqual(['EVD-DEMO-007']);
    const f = await m.findings.getFindingDetail(demoAdmin, id('704'));
    expect(f!.sources.map(s => s.reference)).toEqual(['AUD-DEMO-001']);
    const act = await m.actions.getActionDetail(demoAdmin, id('804'));
    expect(act!.verifications.map(v => v.result)).toEqual(['ACCEPTED']);
    expect(act!.readiness.canClose).toBe(true);
    expect(act!.action.status).toBe('AWAITING_VERIFICATION'); // verified is not closed
    const planned = await m.audits.getAuditDetail(demoAdmin, id('412'));
    expect(planned!.audit).toMatchObject({ status: 'PLANNED', template_version_id: null, external_organisation_name: 'Demo Civil Contractors Pty Ltd (SYNTHETIC)' });
  });
});

// ── Audit security review remediation ─────────────────────────────────────
describe('audit security review remediation', () => {
  async function inProgressAdHoc(title: string) {
    const a = await m.audits.createAudit(mgrA, { title, scope: 's', auditType: 'SITE', standardReference: 'Std' });
    await m.audits.startAudit(mgrA, a.id);
    return a;
  }

  it('A-M1: an uppercase id cannot dodge the "frozen after a finding" guard (audits and inspections)', async () => {
    const a = await inProgressAdHoc('Uppercase probe');
    const key = 'adhoc-upper-000001';
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'c', outcome: 'NON_COMPLIANT', notes: 'gap' });
    await m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: 't', description: 'd', auditId: a.id, auditCriterionKey: key });
    await expectError(m.audits.recordAuditResponse(mgrA, a.id.toUpperCase(), { criterionKey: key, outcome: 'COMPLIANT' }), 'AssuranceConflictError', /no longer be changed/);
    const upper = await m.audits.getAuditDetail(mgrA, a.id.toUpperCase());
    expect(upper!.findings[0].source_criterion_key).toBe(key);
    expect(upper!.history.length).toBeGreaterThan(0);

    const ins = await m.inspections.createInspection(mgrA, { title: 'Uppercase inspection', inspectionType: 'SITE' });
    await m.inspections.startInspection(mgrA, ins.id);
    const ik = 'adhoc-upper-item-000001';
    await m.inspections.recordInspectionResponse(mgrA, ins.id, { itemKey: ik, itemLabel: 'i', outcome: 'FAIL', notes: 'broken' });
    await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 't', description: 'd', inspectionId: ins.id, inspectionItemKey: ik });
    await expectError(m.inspections.recordInspectionResponse(mgrA, ins.id.toUpperCase(), { itemKey: ik, outcome: 'PASS' }), 'AssuranceConflictError', /no longer be changed/);
    expect((await m.inspections.getInspectionDetail(mgrA, ins.id.toUpperCase()))!.findings[0].source_item_key).toBe(ik);
  });

  it('A-L1: a response save racing a finding raise cannot overwrite the frozen criterion', async () => {
    const { Client } = await import('pg');
    const a = await inProgressAdHoc('Freeze race');
    const key = 'adhoc-race-000001';
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'c', outcome: 'NON_COMPLIANT', notes: 'gap' });
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      // A finding raise in flight: holds the audit lock and has written its provenance row.
      await c.query('BEGIN');
      await c.query('SELECT id FROM assurance_audits WHERE id = $1 FOR UPDATE', [a.id]);
      await c.query(`INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, after_state)
        VALUES (gen_random_uuid()::text, 'org-a', 'a-mgr', 'assurance_finding.created', 'assurance_finding', gen_random_uuid()::text,
                jsonb_build_object('audit_id', $1::text, 'audit_criterion_key', $2::text))`, [a.id, key]);
      const save = m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, outcome: 'COMPLIANT' }).then(() => 'saved', e => (e as Error).name);
      await new Promise(r => setTimeout(r, 300));
      await c.query('COMMIT');
      expect(await save).toBe('AssuranceConflictError');
    } finally {
      await c.end();
    }
    const d = await m.audits.getAuditDetail(mgrA, a.id);
    expect(d!.responses.find(r => r.criterion_key === key)!.outcome).toBe('NON_COMPLIANT');
  });

  it('A-L2: an ad hoc criterion keeps its type on revision (no drift into an invalid row)', async () => {
    const a = await inProgressAdHoc('Type drift');
    const key = 'adhoc-drift-000001';
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'Rated criterion', responseType: 'COMPLIANCE_RATING', outcome: 'COMPLIANT' });
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'Renamed', responseType: 'TEXT', value: 'x' }), 'AssuranceValidationError', /rating/);
    const r = (await m.audits.getAuditDetail(mgrA, a.id))!.responses.find(x => x.criterion_key === key)!;
    expect(r).toMatchObject({ response_type: 'COMPLIANCE_RATING', outcome: 'COMPLIANT', criterion_label: 'Rated criterion' });
  });

  it('A-L3: the revision audit row records the value it actually replaced', async () => {
    const a = await inProgressAdHoc('Before state');
    const key = 'adhoc-before-000001';
    await m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, criterionLabel: 'c', outcome: 'PARTIAL', notes: 'v1' });
    await Promise.all([
      m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, outcome: 'PARTIAL', notes: 'v2' }),
      m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: key, outcome: 'PARTIAL', notes: 'v3' }),
    ]);
    const rows = await sql.raw(`SELECT before_state->>'notes' AS b, after_state->>'notes' AS a FROM audit_logs
      WHERE resource_id = '${a.id}' AND action = 'assurance_audit.response_recorded' ORDER BY created_at`) as { b: string | null; a: string }[];
    // Serialised by the audit lock: each revision's "before" is the previous "after".
    expect(rows[0]).toEqual({ b: null, a: 'v1' });
    expect(rows[2].b).toBe(rows[1].a);
  });

  it('A-L4: linking a finding racing its closure cannot link a closed finding', async () => {
    const { Client } = await import('pg');
    const a = await inProgressAdHoc('Link race');
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'Racing finding', description: 'd' });
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM assurance_findings WHERE id = $1 FOR UPDATE', [f.id]);
      await c.query("UPDATE assurance_findings SET status = 'CLOSED', closed_at = now() WHERE id = $1", [f.id]);
      const link = m.audits.linkFindingToAudit(mgrA, a.id, { findingId: f.id }).then(() => 'linked', e => (e as Error).name);
      await new Promise(r => setTimeout(r, 300));
      await c.query('COMMIT');
      expect(await link).toBe('AssuranceConflictError');
    } finally {
      await c.end();
    }
    const n = await sql.raw(`SELECT count(*)::int AS n FROM assurance_audit_findings WHERE audit_id = '${a.id}'`) as { n: number }[];
    expect(n[0].n).toBe(0);
  });

  it('A-Info: ad hoc criteria are capped', async () => {
    const a = await inProgressAdHoc('Cap probe');
    await sql.raw(`INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type, outcome)
      SELECT 'org-a', '${a.id}', 'adhoc-bulk-' || g, 'bulk ' || g, 'COMPLIANCE_RATING', 'COMPLIANT' FROM generate_series(1, 200) g`);
    await expectError(m.audits.recordAuditResponse(mgrA, a.id, { criterionKey: 'adhoc-one-more-000001', criterionLabel: 'x', outcome: 'COMPLIANT' }), 'AssuranceValidationError', /at most 200/);
  });
});
