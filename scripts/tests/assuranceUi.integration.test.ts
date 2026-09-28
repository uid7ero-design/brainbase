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

    // Organiser task links: same org only; task status never drives the action.
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
      inspections_in_progress: 1, open_findings: 3, open_actions: 2, overdue_actions: 1, awaiting_verification: 1,
    });
    expect(d.attention.map(w => w.reference)).toContain('ACT-DEMO-003');
    expect(d.awaitingVerification.map(w => w.reference)).toEqual(['ACT-DEMO-002']);
    expect(d.inspectionsDue.map(w => w.reference).sort()).toEqual(['INS-DEMO-002', 'INS-DEMO-003']);
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
    await expectError(m.findings.transitionFinding(demoAdmin, id('702'), { status: 'CLOSED' }), 'AssuranceConflictError', /1 linked action is still open/);
  });
});
