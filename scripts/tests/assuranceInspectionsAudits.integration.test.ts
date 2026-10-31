// BrainBase Assurance — Inspections & Audits operational execution: real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-inspections-audits.sh (disposable postgres:17 with
// the real A0.1B..A0.1I migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceInspectionsAudits.integration.test.ts requires DATABASE_URL (see verify-assurance-inspections-audits.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  inspections: typeof import('@/lib/assurance/inspections');
  audits: typeof import('@/lib/assurance/audits');
  tl: typeof import('@/lib/assurance/templateLifecycle');
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
  evidence: typeof import('@/lib/assurance/evidence');
  incidents: typeof import('@/lib/assurance/incidents');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('ia-org-a', 'ia-a-admin', 'admin');
const admin2A = V('ia-org-a', 'ia-a-admin2', 'admin');
const mgrA = V('ia-org-a', 'ia-a-mgr', 'manager');
const mgr2A = V('ia-org-a', 'ia-a-mgr2', 'manager');
const viewerA = V('ia-org-a', 'ia-a-viewer', 'viewer');
const adminB = V('ia-org-b', 'ia-b-admin', 'admin');
const mgrB = V('ia-org-b', 'ia-b-mgr', 'manager');

const LOC = 'ac000000-0000-4000-8000-000000000002';
const AST = 'ac000000-0000-4000-8000-000000000003';
const EO = 'ac000000-0000-4000-8000-000000000004';
const LOC_B = 'ac000000-0000-4000-8000-000000000012';
const LOC_OLD = 'ac000000-0000-4000-8000-000000000022';

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}
async function auditLog(resourceId: string) {
  return (await sql`SELECT action, user_id, before_state, after_state FROM audit_logs WHERE resource_id = ${resourceId} ORDER BY created_at, id` as
    { action: string; user_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[]);
}
const insRow = async (id: string) => ((await sql`SELECT status, inspector_user_id, template_version_id, completed_at, summary, updated_at FROM assurance_inspections WHERE id = ${id}::uuid`) as Record<string, unknown>[])[0];
const audRow = async (id: string) => ((await sql`SELECT status, auditor_user_id, template_version_id, completed_at, summary, updated_at FROM assurance_audits WHERE id = ${id}::uuid`) as Record<string, unknown>[])[0];
const findingStatus = async (id: string) => ((await sql`SELECT status FROM assurance_findings WHERE id = ${id}::uuid`) as { status: string }[])[0].status;
const actionStatus = async (id: string) => ((await sql`SELECT status FROM assurance_actions WHERE id = ${id}::uuid`) as { status: string }[])[0].status;
const count = async (q: ReturnType<typeof sql>) => ((await q) as { n: number }[])[0].n;

const INSPECTION_ITEMS = [
  { label: 'Walkways clear', responseType: 'PASS_FAIL', section: 'Access', required: true },
  { label: 'Exit signs lit', responseType: 'PASS_FAIL', section: 'Access', required: true },
  { label: 'Extinguisher pressure (psi)', responseType: 'NUMBER', section: 'Fire', required: false },
  { label: 'Spill kit condition', responseType: 'CHOICE', options: ['Stocked', 'Partly stocked', 'Empty'], section: 'Environment', required: true },
];

async function publishedInspectionTemplate(name: string, items: Record<string, unknown>[] = INSPECTION_ITEMS) {
  const t = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name, templateType: 'SITE', items });
  await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'inspection', versionId: t.version_id, lockVersion: 1 });
  return t;
}
async function publishedAuditTemplate(name: string) {
  const t = await m.tl.createAssuranceTemplate(adminA, {
    kind: 'audit', name, templateType: 'INTERNAL', standardReference: '[TEST] Procedure P-1',
    items: [
      { label: 'Route sheets completed', section: 'Records', required: true },
      { label: 'Toolbox talk minutes kept', section: 'Records', required: false },
      { label: 'Pre-start checks recorded', section: 'Vehicles', required: true },
    ],
  });
  await m.tl.publishTemplateVersion(adminA, t.id, { kind: 'audit', versionId: t.version_id, lockVersion: 1 });
  return t;
}

const S: Record<string, string> = {};

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES ('ia-org-a','IA Org A','ia-org-a',now()), ('ia-org-b','IA Org B','ia-org-b',now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('ia-a-admin','ia-org-a','ia-a-admin','Ada Admin','ADMIN','ACTIVE',now()),
      ('ia-a-admin2','ia-org-a','ia-a-admin2','Abe Admin','ADMIN','ACTIVE',now()),
      ('ia-a-mgr','ia-org-a','ia-a-mgr','Mia Manager','MANAGER','ACTIVE',now()),
      ('ia-a-mgr2','ia-org-a','ia-a-mgr2','Ian Inspector','MANAGER','ACTIVE',now()),
      ('ia-a-viewer','ia-org-a','ia-a-viewer','Val Viewer','VIEWER','ACTIVE',now()),
      ('ia-b-admin','ia-org-b','ia-b-admin','Bo Admin','ADMIN','ACTIVE',now()),
      ('ia-b-mgr','ia-org-b','ia-b-mgr','Bea Manager','MANAGER','ACTIVE',now());
    INSERT INTO locations (id, organisation_id, location_reference, location_type, name, status) VALUES
      ('${LOC}','ia-org-a','LOC-IA-1','DEPOT','[TEST] Depot 3','ACTIVE'),
      ('${LOC_OLD}','ia-org-a','LOC-IA-2','DEPOT','[TEST] Old depot','INACTIVE'),
      ('${LOC_B}','ia-org-b','LOC-IA-B1','DEPOT','[TEST] B depot','ACTIVE');
    INSERT INTO assets (id, organisation_id, asset_reference, asset_type, name, status) VALUES ('${AST}','ia-org-a','AST-IA-1','EQUIPMENT','[TEST] Forklift 7','ACTIVE');
    INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES ('${EO}','ia-org-a','EXT-IA-1','[TEST] Hire Co','ACTIVE');
  `);
  m = {
    inspections: await import('@/lib/assurance/inspections'),
    audits: await import('@/lib/assurance/audits'),
    tl: await import('@/lib/assurance/templateLifecycle'),
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
    evidence: await import('@/lib/assurance/evidence'),
    incidents: await import('@/lib/assurance/incidents'),
  };
});

afterAll(async () => { await sql.end(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('inspection: plan → conduct → respond → evidence → finding → complete', () => {
  it('plans an inspection from the exact published version, with context, inspector and planned date; org/actor are server-derived', async () => {
    const t = await publishedInspectionTemplate('[TEST] Depot walk');
    S.insTpl = t.id; S.insV1 = t.version_id;
    const planned = new Date(Date.now() + 2 * 86400_000).toISOString();
    const r = await m.inspections.createInspection(mgrA, {
      title: '[TEST] Depot 3 monthly walk', templateVersionId: t.version_id, inspectorUserId: 'ia-a-mgr2', scheduledAt: planned,
      locationId: LOC, assetId: AST, externalOrganisationId: EO, organisationId: 'ia-org-b', createdBy: 'ia-b-admin',
    });
    S.ins = r.id;
    const row = (await sql`SELECT organisation_id, created_by, status, inspection_type FROM assurance_inspections WHERE id = ${r.id}::uuid`) as Record<string, unknown>[];
    expect(row[0]).toEqual({ organisation_id: 'ia-org-a', created_by: 'ia-a-mgr', status: 'PLANNED', inspection_type: 'SITE' });
    const d = (await m.inspections.getInspectionDetail(mgrA, r.id))!;
    expect(d.inspection).toMatchObject({
      template_version_id: S.insV1, template_version_number: 1, inspector_name: 'Ian Inspector',
      location_name: '[TEST] Depot 3', asset_name: '[TEST] Forklift 7', external_organisation_name: '[TEST] Hire Co',
    });
    expect(d.checklist.map(i => [i.label, i.section, i.required])).toEqual([
      ['Walkways clear', 'Access', true], ['Exit signs lit', 'Access', true],
      ['Extinguisher pressure (psi)', 'Fire', false], ['Spill kit condition', 'Environment', true],
    ]);
    expect(d.readiness).toMatchObject({ ready: false, total: 4, answered: 0, requiredTotal: 3, requiredAnswered: 0 });
    expect(d.readiness.blockers[0]).toMatch(/not been started/);
    S.keys = JSON.stringify(d.checklist.map(i => i.key));
    expect((await auditLog(r.id)).map(a => a.action)).toEqual(['assurance_inspection.created']);
  });

  it('ad hoc creation still works and needs a type; draft / foreign template versions and inactive or foreign references are refused', async () => {
    const adhoc = await m.inspections.createInspection(mgrA, { title: '[TEST] Ad hoc yard check', inspectionType: 'SAFETY' });
    S.insAdhoc = adhoc.id;
    expect((await insRow(adhoc.id)).template_version_id).toBeNull();
    await expectError(m.inspections.createInspection(mgrA, { title: 'x' }), 'AssuranceValidationError', /type is required/);
    const draft = await m.tl.createAssuranceTemplate(adminA, { kind: 'inspection', name: '[TEST] Never published', templateType: 'SITE', items: [{ label: 'x' }] });
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', templateVersionId: draft.version_id }), 'AssuranceValidationError', /not published/);
    await expectError(m.inspections.createInspection(adminB, { title: 'x', templateVersionId: S.insV1 }), 'AssuranceValidationError', /not found in your organisation/);
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', inspectionType: 'SITE', locationId: LOC_B }), 'AssuranceValidationError');
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', inspectionType: 'SITE', locationId: LOC_OLD }), 'AssuranceValidationError');
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', inspectionType: 'SITE', inspectorUserId: 'ia-b-admin' }), 'AssuranceValidationError');
    await expectError(m.inspections.createInspection(viewerA, { title: 'x', inspectionType: 'SITE' }), 'AssuranceForbiddenError');
  });

  it('responses: only while in progress; label/type from the bound version; type, options and required notes validated', async () => {
    const keys = JSON.parse(S.keys) as string[];
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[0], outcome: 'PASS' }), 'AssuranceConflictError', /in progress/);
    await m.inspections.startInspection(mgr2A, S.ins);
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: 'not-in-version', outcome: 'PASS' }), 'AssuranceValidationError', /not part of/);
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[3], value: 'Overflowing' }), 'AssuranceValidationError', /listed options/);
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[2], value: 'lots' }), 'AssuranceValidationError', /valid number/);
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[0], outcome: 'FAIL' }), 'AssuranceValidationError', /why this item failed/);
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[0] }), 'AssuranceValidationError', /outcome or enter/);
    // A forged label/type is ignored: the version is authoritative.
    await m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[0], outcome: 'PASS', itemLabel: 'Forged', responseType: 'TEXT' });
    await m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[2], value: '180' });
    const d = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(d.responses.find(r => r.item_key === keys[0])).toMatchObject({ item_label: 'Walkways clear', response_type: 'PASS_FAIL', outcome: 'PASS' });
    expect(d.responses.find(r => r.item_key === keys[2])).toMatchObject({ response_type: 'NUMBER', response_value: 180 });
    // Partial: required items still missing → incomplete, and completion refuses with the same blocker.
    expect(d.readiness).toMatchObject({ incomplete: true, ready: false, answered: 2, requiredAnswered: 1 });
    expect(d.readiness.blockers).toEqual(['2 required items have no response yet.']);
    await expectError(m.inspections.completeInspection(mgr2A, S.ins, {}), 'AssuranceConflictError', /^2 required items have no response yet\.$/);
    const reg = (await m.inspections.listInspections(mgrA, { view: 'incomplete' })).map(r => r.id);
    expect(reg).toContain(S.ins);
    expect((await m.inspections.listInspections(mgrA, { view: 'ready' })).map(r => r.id)).not.toContain(S.ins);
  });

  it('a revision is audited with the previous value; evidence links to the item; accepting it changes no response', async () => {
    const keys = JSON.parse(S.keys) as string[];
    await m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[2], value: 175, notes: 'Re-read gauge' });
    const rev = (await auditLog(S.ins)).filter(a => a.action === 'assurance_inspection.response_recorded').at(-1)!;
    expect(rev.before_state).toMatchObject({ value: 180 });
    expect(rev.after_state).toMatchObject({ item_key: keys[2], value: 175, notes: 'Re-read gauge' });

    // Evidence needs a recorded response for the item (A0.1H FK).
    await expectError(m.evidence.createEvidence(mgr2A, { evidenceType: 'PHOTO', title: '[TEST] x', target: 'inspection', targetId: S.ins, itemKey: keys[1] }), 'AssuranceValidationError');
    const ev = await m.evidence.createEvidence(mgr2A, { evidenceType: 'PHOTO', title: '[TEST] Gauge photo', target: 'inspection', targetId: S.ins, itemKey: keys[2], purpose: 'Gauge reading' });
    S.insEvidence = ev.id;
    const before = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(before.evidence.map(e => [e.evidence_id, e.item_key, e.item_label])).toEqual([[ev.id, keys[2], 'Extinguisher pressure (psi)']]);
    const respBefore = await sql`SELECT * FROM assurance_inspection_responses WHERE inspection_id = ${S.ins}::uuid ORDER BY item_key`;
    const insBefore = await insRow(S.ins);
    await m.evidence.requestEvidenceVerification(mgr2A, ev.id, { lockVersion: 1 });
    await m.evidence.decideEvidence(admin2A, ev.id, { decision: 'ACCEPT', lockVersion: 2 });
    expect(await sql`SELECT * FROM assurance_inspection_responses WHERE inspection_id = ${S.ins}::uuid ORDER BY item_key`).toEqual(respBefore);
    expect(await insRow(S.ins)).toEqual(insBefore);
    const reg = (await m.inspections.listInspections(mgrA, {})).find(r => r.id === S.ins)!;
    expect(reg.evidence_count).toBe(1);
  });

  it('a failing response is a fact only: no Finding is created; raising one is explicit, linked to the item, and retry-safe', async () => {
    const keys = JSON.parse(S.keys) as string[];
    const findingsBefore = await count(sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ia-org-a'`);
    await m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[1], outcome: 'FAIL', notes: 'Exit sign at door 2 dark' });
    expect(await count(sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ia-org-a'`)).toBe(findingsBefore);
    expect((await m.inspections.getInspectionDetail(mgrA, S.ins))!.findings).toEqual([]);

    const requestKey = crypto.randomUUID();
    const input = { findingType: 'DEFECT', title: '[TEST] Exit sign dark', description: 'Door 2.', inspectionId: S.ins, inspectionItemKey: keys[1], requestKey };
    // Double tap: two concurrent submissions with the same key → one finding.
    const [a, b] = await Promise.all([m.findings.createFinding(mgr2A, input), m.findings.createFinding(mgr2A, input)]);
    expect(a.id).toBe(b.id);
    // A later retry (lost response) also returns the same finding.
    expect((await m.findings.createFinding(mgr2A, input)).id).toBe(a.id);
    // Another user replaying someone else's key never sees their finding.
    await expectError(m.findings.createFinding(mgrA, input), 'AssuranceConflictError');
    S.insFinding = a.id;
    expect(await count(sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ia-org-a'`)).toBe(findingsBefore + 1);
    const link = (await sql`SELECT item_key FROM assurance_inspection_findings WHERE finding_id = ${a.id}::uuid`) as { item_key: string }[];
    expect(link).toEqual([{ item_key: keys[1] }]);
    // Raising a finding does not change the inspection's status.
    expect((await insRow(S.ins)).status).toBe('IN_PROGRESS');
    // The item's response is now frozen.
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[1], outcome: 'PASS' }), 'AssuranceConflictError', /finding has been raised/);
    const d = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(d.findings.map(f => [f.id, f.source_item_key, f.status])).toEqual([[a.id, keys[1], 'OPEN']]);
  });

  it('an Action is raised on the Finding (no shortcut) and shows on the inspection through it', async () => {
    const act = await m.actions.createAction(mgrA, { findingIds: [S.insFinding], actionType: 'CORRECTIVE', title: '[TEST] Replace exit sign', priority: 'HIGH', ownerUserId: 'ia-a-mgr' });
    S.insAction = act.id;
    const d = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(d.actions.map(x => [x.id, x.finding_id, x.status])).toEqual([[act.id, S.insFinding, 'OPEN']]);
    const reg = (await m.inspections.listInspections(mgrA, {})).find(r => r.id === S.ins)!;
    expect(reg).toMatchObject({ finding_count: 1, open_action_count: 1, evidence_count: 1 });
    expect((await m.inspections.listInspections(mgrA, { view: 'findings' })).map(r => r.id)).toContain(S.ins);
    expect(await count(sql`SELECT count(*)::int AS n FROM assurance_action_findings WHERE action_id = ${act.id}::uuid`)).toBe(1);
  });

  it('assignment: lock + guarded write, stale expectation conflicts deterministically, audited, changes nothing else', async () => {
    const before = await insRow(S.ins);
    const [x, y] = await Promise.allSettled([
      m.inspections.assignInspector(mgrA, S.ins, { inspectorUserId: 'ia-a-mgr', expectedInspectorUserId: 'ia-a-mgr2' }),
      m.inspections.assignInspector(admin2A, S.ins, { inspectorUserId: 'ia-a-admin2', expectedInspectorUserId: 'ia-a-mgr2' }),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    const loser = (x.status === 'rejected' ? x : y) as PromiseRejectedResult;
    expect((loser.reason as Error).name).toBe('AssuranceConflictError');
    const after = await insRow(S.ins);
    expect(['ia-a-mgr', 'ia-a-admin2']).toContain(after.inspector_user_id);
    expect({ ...after, inspector_user_id: null, updated_at: null }).toEqual({ ...before, inspector_user_id: null, updated_at: null });
    const assigned = (await auditLog(S.ins)).filter(a => a.action === 'assurance_inspection.assigned');
    expect(assigned).toHaveLength(1);
    expect(assigned[0].before_state).toEqual({ inspector_user_id: 'ia-a-mgr2' });
    // Back to the original inspector; foreign users and viewers are refused.
    await m.inspections.assignInspector(mgrA, S.ins, { inspectorUserId: 'ia-a-mgr2', expectedInspectorUserId: after.inspector_user_id });
    await expectError(m.inspections.assignInspector(mgrA, S.ins, { inspectorUserId: 'ia-b-mgr' }), 'AssuranceValidationError');
    await expectError(m.inspections.assignInspector(viewerA, S.ins, { inspectorUserId: 'ia-a-mgr' }), 'AssuranceForbiddenError');
    await expectError(m.inspections.assignInspector(mgrA, S.ins, { inspectorUserId: 'ia-a-mgr2' }), 'AssuranceConflictError', /already that person/);
  });

  it('response race on one item: both saves land serially, the last write wins and every save is audited', async () => {
    const keys = JSON.parse(S.keys) as string[];
    const n0 = (await auditLog(S.ins)).filter(a => a.action === 'assurance_inspection.response_recorded').length;
    await Promise.all([
      m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[3], value: 'Stocked' }),
      m.inspections.recordInspectionResponse(mgrA, S.ins, { itemKey: keys[3], value: 'Partly stocked', notes: 'Absorbent low' }),
    ]);
    const rows = (await sql`SELECT response_value FROM assurance_inspection_responses WHERE inspection_id = ${S.ins}::uuid AND item_key = ${keys[3]}`) as { response_value: string }[];
    expect(rows).toHaveLength(1);
    const logs = (await auditLog(S.ins)).filter(a => a.action === 'assurance_inspection.response_recorded');
    expect(logs.length).toBe(n0 + 2);
    // Serialised by the row lock: the stored value is the later save, and the
    // later save's "before" is exactly the earlier save — nothing is lost.
    expect(logs.at(-1)!.after_state!.value).toBe(rows[0].response_value);
    expect(logs.at(-1)!.before_state!.value).toBe(logs.at(-2)!.after_state!.value);
  });

  it('ready → two concurrent completions: exactly one wins; completion closes no Finding / Action / evidence', async () => {
    const d = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(d.readiness).toMatchObject({ ready: true, blockers: [] });
    expect((await m.inspections.listInspections(mgrA, { view: 'ready' })).map(r => r.id)).toContain(S.ins);
    const evBefore = await sql`SELECT verification_status FROM assurance_evidence WHERE id = ${S.insEvidence}::uuid`;
    const [x, y] = await Promise.allSettled([
      m.inspections.completeInspection(mgr2A, S.ins, { summary: '[TEST] One sign out; extinguisher OK.' }),
      m.inspections.completeInspection(mgrA, S.ins, { summary: 'second' }),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(((x.status === 'rejected' ? x : y) as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    expect(await insRow(S.ins)).toMatchObject({ status: 'COMPLETED' });
    expect((await auditLog(S.ins)).filter(a => a.action === 'assurance_inspection.completed')).toHaveLength(1);
    expect(await findingStatus(S.insFinding)).toBe('OPEN');
    expect(await actionStatus(S.insAction)).toBe('OPEN');
    expect(await sql`SELECT verification_status FROM assurance_evidence WHERE id = ${S.insEvidence}::uuid`).toEqual(evBefore);
    // Completed: responses locked, inspector fixed, not completable again.
    const keys = JSON.parse(S.keys) as string[];
    await expectError(m.inspections.recordInspectionResponse(mgr2A, S.ins, { itemKey: keys[0], outcome: 'FAIL', notes: 'x' }), 'AssuranceConflictError', /in progress/);
    await expectError(m.inspections.assignInspector(mgrA, S.ins, { inspectorUserId: 'ia-a-mgr' }), 'AssuranceConflictError', /completed or cancelled/);
    await expectError(m.inspections.completeInspection(mgr2A, S.ins, {}), 'AssuranceConflictError');
    await expectError(m.inspections.cancelInspection(adminA, S.ins, { reason: 'x' }), 'AssuranceConflictError');
    expect((await m.inspections.listInspections(mgrA, { view: 'completed' })).map(r => r.id)).toContain(S.ins);
  });

  it('closing the Action does not change the completed inspection', async () => {
    const before = await insRow(S.ins);
    await m.actions.startAction(mgrA, S.insAction);
    await m.actions.completeActionWork(mgrA, S.insAction);
    expect(await insRow(S.ins)).toEqual(before);
  });

  it('template version integrity: v2 published after completion; the completed record keeps v1; a new record gets v2', async () => {
    const v2 = await m.tl.createTemplateVersion(adminA, S.insTpl, { kind: 'inspection' });
    const saved = await m.tl.updateTemplateDraft(adminA, S.insTpl, {
      kind: 'inspection', versionId: v2.id, lockVersion: 1, title: '[TEST] Depot walk rev 2',
      items: [{ label: 'Walkways and exits clear', section: 'Access', required: true }],
    });
    await m.tl.publishTemplateVersion(adminA, S.insTpl, { kind: 'inspection', versionId: v2.id, lockVersion: saved.lock_version });
    const old = (await m.inspections.getInspectionDetail(mgrA, S.ins))!;
    expect(old.inspection).toMatchObject({ template_version_id: S.insV1, template_version_number: 1, latest_template_version_number: 2 });
    expect(old.checklist.map(i => i.label)).toEqual(INSPECTION_ITEMS.map(i => i.label));
    expect(old.responses.find(r => r.item_key === JSON.parse(S.keys)[0])!.item_label).toBe('Walkways clear');
    const r2 = await m.inspections.createInspection(mgrA, { title: '[TEST] Depot walk next month', templateVersionId: v2.id });
    const d2 = (await m.inspections.getInspectionDetail(mgrA, r2.id))!;
    expect(d2.inspection.template_version_number).toBe(2);
    expect(d2.checklist.map(i => i.label)).toEqual(['Walkways and exits clear']);
    await expectError(m.inspections.createInspection(mgrA, { title: 'x', templateVersionId: S.insV1 }), 'AssuranceValidationError', /not published/);
    // Retiring the template changes neither historical record.
    await m.tl.retireAssuranceTemplate(adminA, S.insTpl, { kind: 'inspection', reason: '[TEST] superseded' });
    expect((await m.inspections.getInspectionDetail(mgrA, S.ins))!.checklist).toEqual(old.checklist);
    expect((await insRow(r2.id)).template_version_id).toBe(v2.id);
    S.ins2 = r2.id;
  });

  it('cancellation: close-gated (viewers refused), reason required and audited, no propagation; ad hoc readiness', async () => {
    await m.inspections.startInspection(mgrA, S.insAdhoc);
    const adhoc = (await m.inspections.getInspectionDetail(mgrA, S.insAdhoc))!;
    expect(adhoc.readiness.blockers).toEqual(['Record at least one item before completing an ad hoc inspection.']);
    await m.inspections.recordInspectionResponse(mgrA, S.insAdhoc, { itemKey: 'adhoc-gate-latch', itemLabel: 'Gate latch', responseType: 'PASS_FAIL', outcome: 'FAIL', notes: 'Bent' });
    expect((await m.inspections.getInspectionDetail(mgrA, S.insAdhoc))!.readiness).toMatchObject({ ready: true, total: 1 });
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: '[TEST] Gate latch', description: 'Bent.', inspectionId: S.insAdhoc, inspectionItemKey: 'adhoc-gate-latch' });
    await expectError(m.inspections.cancelInspection(viewerA, S.insAdhoc, { reason: 'x' }), 'AssuranceForbiddenError');
    await expectError(m.inspections.cancelInspection(adminA, S.insAdhoc, {}), 'AssuranceValidationError');
    await m.inspections.cancelInspection(adminA, S.insAdhoc, { reason: '[TEST] Duplicate of scheduled walk' });
    expect((await auditLog(S.insAdhoc)).at(-1)).toMatchObject({ action: 'assurance_inspection.cancelled', after_state: { status: 'CANCELLED', reason: '[TEST] Duplicate of scheduled walk' } });
    expect(await findingStatus(f.id)).toBe('OPEN');
    expect((await m.inspections.listInspections(mgrA, { view: 'cancelled' })).map(r => r.id)).toContain(S.insAdhoc);
    await expectError(m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: 'x', description: 'x', inspectionId: S.insAdhoc }), 'AssuranceConflictError');
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'inspection', targetId: S.insAdhoc }), 'AssuranceConflictError');
  });

  it('history shows the lifecycle in order', async () => {
    const actions = (await auditLog(S.ins)).map(a => a.action);
    expect(actions[0]).toBe('assurance_inspection.created');
    expect(actions).toContain('assurance_inspection.started');
    expect(actions).toContain('assurance_inspection.assigned');
    expect(actions.at(-1)).toBe('assurance_inspection.completed');
    expect((await m.inspections.getInspectionDetail(mgrA, S.ins))!.history.length).toBe(actions.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('audit: plan → assess criteria → evidence → finding → complete', () => {
  it('plans from the exact published version (standard inherited); ad hoc needs a standard', async () => {
    const t = await publishedAuditTemplate('[TEST] Waste ops audit');
    S.audTpl = t.id; S.audV1 = t.version_id;
    const a = await m.audits.createAudit(mgrA, { title: '[TEST] Q4 waste ops', scope: 'Depot 3 collections', templateVersionId: t.version_id, auditorUserId: 'ia-a-mgr2', locationId: LOC, externalOrganisationId: EO, organisationId: 'ia-org-b' });
    S.aud = a.id;
    const d = (await m.audits.getAuditDetail(mgrA, a.id))!;
    expect(d.audit).toMatchObject({ template_version_number: 1, standard_reference: '[TEST] Procedure P-1', auditor_name: 'Ian Inspector', external_organisation_name: '[TEST] Hire Co' });
    expect((await audRow(a.id)).status).toBe('PLANNED');
    expect(d.criteria.map(c => c.required)).toEqual([true, false, true]);
    S.ckeys = JSON.stringify(d.criteria.map(c => c.key));
    await expectError(m.audits.createAudit(mgrA, { title: 'x', scope: 'y', auditType: 'INTERNAL' }), 'AssuranceValidationError', /standard or reference/);
    await expectError(m.audits.createAudit(adminB, { title: 'x', scope: 'y', templateVersionId: S.audV1 }), 'AssuranceValidationError', /not found in your organisation/);
  });

  it('criteria responses: rating required for compliance ratings, gap notes required; a non-compliance is not a Finding', async () => {
    const k = JSON.parse(S.ckeys) as string[];
    await m.audits.startAudit(mgr2A, S.aud);
    await expectError(m.audits.recordAuditResponse(mgr2A, S.aud, { criterionKey: k[0] }), 'AssuranceValidationError', /compliance rating/);
    await expectError(m.audits.recordAuditResponse(mgr2A, S.aud, { criterionKey: k[0], outcome: 'NON_COMPLIANT' }), 'AssuranceValidationError', /gap/);
    await expectError(m.audits.recordAuditResponse(mgr2A, S.aud, { criterionKey: 'forged', outcome: 'COMPLIANT' }), 'AssuranceValidationError', /not part of/);
    const before = await count(sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ia-org-a'`);
    await m.audits.recordAuditResponse(mgr2A, S.aud, { criterionKey: k[0], outcome: 'NON_COMPLIANT', notes: '3 of 10 route sheets missing' });
    expect(await count(sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ia-org-a'`)).toBe(before);
    const d = (await m.audits.getAuditDetail(mgrA, S.aud))!;
    expect(d.readiness).toMatchObject({ incomplete: true, requiredAnswered: 1, requiredTotal: 2 });
    expect(d.readiness.blockers).toEqual(['1 required criterion has no response yet.']);
    await expectError(m.audits.completeAudit(mgr2A, S.aud, {}), 'AssuranceConflictError', /1 required criterion/);
  });

  it('criterion evidence and an explicit, retry-safe Finding; the Finding stays independent of completion', async () => {
    const k = JSON.parse(S.ckeys) as string[];
    const ev = await m.evidence.createEvidence(mgr2A, { evidenceType: 'DOCUMENT', title: '[TEST] Route sheet sample', target: 'audit', targetId: S.aud, criterionKey: k[0] });
    expect((await m.audits.getAuditDetail(mgrA, S.aud))!.evidence.map(e => [e.evidence_id, e.item_key])).toEqual([[ev.id, k[0]]]);
    const requestKey = crypto.randomUUID();
    const input = { findingType: 'NON_CONFORMANCE', title: '[TEST] Route sheets incomplete', description: 'Synthetic.', auditId: S.aud, auditCriterionKey: k[0], requestKey };
    const [a, b] = await Promise.all([m.findings.createFinding(mgr2A, input), m.findings.createFinding(mgr2A, input)]);
    expect(a.id).toBe(b.id);
    S.audFinding = a.id;
    expect((await sql`SELECT criterion_key FROM assurance_audit_findings WHERE finding_id = ${a.id}::uuid`)).toEqual([{ criterion_key: k[0] }]);
    expect((await audRow(S.aud)).status).toBe('IN_PROGRESS');
    const act = await m.actions.createAction(mgrA, { findingIds: [a.id], actionType: 'CORRECTIVE', title: '[TEST] Retrain drivers on route sheets', priority: 'MEDIUM' });
    expect((await m.audits.getAuditDetail(mgrA, S.aud))!.actions.map(x => x.id)).toEqual([act.id]);
    expect((await m.audits.listAudits(mgrA, {})).find(r => r.id === S.aud)).toMatchObject({ finding_count: 1, open_action_count: 1, evidence_count: 1 });
    await m.audits.recordAuditResponse(mgr2A, S.aud, { criterionKey: k[2], outcome: 'COMPLIANT' });
    expect((await m.audits.listAudits(mgrA, { view: 'ready' })).map(r => r.id)).toContain(S.aud);
    const [x, y] = await Promise.allSettled([
      m.audits.completeAudit(mgr2A, S.aud, { summary: '[TEST] One gap.', recommendations: 'Weekly sheet check.' }),
      m.audits.completeAudit(mgrA, S.aud, {}),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(await audRow(S.aud)).toMatchObject({ status: 'COMPLETED', summary: '[TEST] One gap.' });
    expect(await findingStatus(a.id)).toBe('OPEN');
    expect(await actionStatus(act.id)).toBe('OPEN');
  });

  it('assignment race and audit history', async () => {
    const a = await m.audits.createAudit(mgrA, { title: '[TEST] Assign race', scope: 's', templateVersionId: S.audV1 });
    const [x, y] = await Promise.allSettled([
      m.audits.assignAuditor(mgrA, a.id, { auditorUserId: 'ia-a-mgr', expectedAuditorUserId: null }),
      m.audits.assignAuditor(mgr2A, a.id, { auditorUserId: 'ia-a-mgr2', expectedAuditorUserId: null }),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await auditLog(a.id)).map(l => l.action)).toEqual(['assurance_audit.created', 'assurance_audit.assigned']);
    const hist = (await auditLog(S.aud)).map(l => l.action);
    expect(hist[0]).toBe('assurance_audit.created');
    expect(hist).toContain('assurance_audit.started');
    expect(hist.filter(h => h === 'assurance_audit.response_recorded').length).toBe(2);
    expect(hist.at(-1)).toBe('assurance_audit.completed');
  });

  it('version integrity for audits: v2 does not change the completed audit', async () => {
    const v2 = await m.tl.createTemplateVersion(adminA, S.audTpl, { kind: 'audit' });
    const saved = await m.tl.updateTemplateDraft(adminA, S.audTpl, { kind: 'audit', versionId: v2.id, lockVersion: 1, title: '[TEST] rev 2', standardReference: '[TEST] Procedure P-2', items: [{ label: 'Only v2 criterion' }] });
    await m.tl.publishTemplateVersion(adminA, S.audTpl, { kind: 'audit', versionId: v2.id, lockVersion: saved.lock_version });
    const d = (await m.audits.getAuditDetail(mgrA, S.aud))!;
    expect(d.audit).toMatchObject({ template_version_number: 1, standard_reference: '[TEST] Procedure P-1', latest_template_version_number: 2 });
    expect(d.criteria.map(c => c.label)).toEqual(['Route sheets completed', 'Toolbox talk minutes kept', 'Pre-start checks recorded']);
    const n = await m.audits.createAudit(mgrA, { title: '[TEST] Next audit', scope: 's', templateVersionId: v2.id });
    expect((await m.audits.getAuditDetail(mgrA, n.id))!.audit.template_version_number).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tenant isolation (Org B against Org A records)', () => {
  it('cannot list, view, respond, add evidence, raise findings, assign, complete or cancel; foreign ids are non-disclosing', async () => {
    expect((await m.inspections.listInspections(adminB, {})).map(r => r.id)).not.toContain(S.ins);
    expect((await m.audits.listAudits(adminB, {})).map(r => r.id)).not.toContain(S.aud);
    expect(await m.inspections.getInspectionDetail(adminB, S.ins2)).toBeNull();
    expect(await m.audits.getAuditDetail(adminB, S.aud)).toBeNull();
    const k = JSON.parse(S.keys) as string[];
    const nf = 'AssuranceNotFoundError';
    await expectError(m.inspections.startInspection(adminB, S.ins2), nf);
    await expectError(m.inspections.recordInspectionResponse(adminB, S.ins2, { itemKey: k[0], outcome: 'PASS' }), nf);
    await expectError(m.inspections.assignInspector(adminB, S.ins2, { inspectorUserId: 'ia-b-mgr' }), nf);
    await expectError(m.inspections.completeInspection(adminB, S.ins2, {}), nf);
    await expectError(m.inspections.cancelInspection(adminB, S.ins2, { reason: 'x' }), nf);
    await expectError(m.audits.assignAuditor(adminB, S.aud, { auditorUserId: 'ia-b-mgr' }), nf);
    await expectError(m.audits.cancelAudit(adminB, S.aud, { reason: 'x' }), nf);
    await expectError(m.findings.createFinding(adminB, { findingType: 'DEFECT', title: 'x', description: 'x', inspectionId: S.ins2 }), nf);
    await expectError(m.findings.createFinding(adminB, { findingType: 'DEFECT', title: 'x', description: 'x', auditId: S.aud }), nf);
    await expectError(m.evidence.createEvidence(adminB, { evidenceType: 'PHOTO', title: 'x', target: 'inspection', targetId: S.ins2 }), nf);
    await expectError(m.evidence.createEvidence(adminB, { evidenceType: 'PHOTO', title: 'x', target: 'audit', targetId: S.aud }), nf);
    // A random id behaves exactly like a foreign one.
    await expectError(m.inspections.startInspection(adminB, crypto.randomUUID()), nf);
    // Org A's register is unaffected by Org B's activity, and vice versa.
    const bIns = await m.inspections.createInspection(mgrB, { title: '[TEST] B own', inspectionType: 'SITE', locationId: LOC_B });
    expect((await m.inspections.listInspections(mgrA, {})).map(r => r.id)).not.toContain(bIns.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('restricted linked-record containment', () => {
  it('a Finding / Action / evidence also linked to a restricted incident is not shown, named or counted for a manager who cannot see it', async () => {
    const r = await m.inspections.createInspection(mgrA, { title: '[TEST] Containment walk', inspectionType: 'SAFETY' });
    await m.inspections.startInspection(mgrA, r.id);
    await m.inspections.recordInspectionResponse(mgrA, r.id, { itemKey: 'adhoc-guard', itemLabel: 'Guard rail', responseType: 'PASS_FAIL', outcome: 'PASS' });
    const inc = await m.incidents.createIncident(adminA, {
      title: '[TEST] Sensitive matter', description: 'Synthetic restricted.', category: 'INJURY_SAFETY',
      occurredAt: new Date(Date.now() - 3600_000).toISOString(), restricted: true,
    });
    const f = await m.findings.createFinding(adminA, { findingType: 'HAZARD', title: '[TEST] SECRET finding title', description: 'Synthetic.', incidentId: inc.id });
    await m.findings.linkFindingToSource(adminA, 'inspection', r.id, { findingId: f.id });
    await m.actions.createAction(adminA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] SECRET action', priority: 'LOW' });
    const e = await m.evidence.createEvidence(adminA, { evidenceType: 'DOCUMENT', title: '[TEST] SECRET evidence', target: 'incident', targetId: inc.id });
    await m.evidence.linkEvidence(adminA, e.id, { target: 'inspection', targetId: r.id });

    // Admin sees it all.
    const adminRow = (await m.inspections.listInspections(adminA, {})).find(x => x.id === r.id)!;
    expect(adminRow).toMatchObject({ finding_count: 1, open_action_count: 1, evidence_count: 1 });
    // The manager sees none of it — not in counts, not in detail, not by name.
    const mgrRow = (await m.inspections.listInspections(mgrA, {})).find(x => x.id === r.id)!;
    expect(mgrRow).toMatchObject({ finding_count: 0, open_action_count: 0, evidence_count: 0 });
    expect((await m.inspections.listInspections(mgrA, { view: 'findings' })).map(x => x.id)).not.toContain(r.id);
    const d = (await m.inspections.getInspectionDetail(mgrA, r.id))!;
    expect(d.findings).toEqual([]);
    expect(d.actions).toEqual([]);
    expect(d.evidence).toEqual([]);
    expect(d.hiddenFindingCount).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/SECRET/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('evidence link race and regression of neighbouring modules', () => {
  it('two concurrent links of the same evidence to the same inspection item: exactly one active link', async () => {
    const r = await m.inspections.createInspection(mgrA, { title: '[TEST] Link race', inspectionType: 'SITE' });
    await m.inspections.startInspection(mgrA, r.id);
    await m.inspections.recordInspectionResponse(mgrA, r.id, { itemKey: 'adhoc-bin', itemLabel: 'Bin lids', responseType: 'PASS_FAIL', outcome: 'PASS' });
    const e = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: '[TEST] Bin photo' });
    const res = await Promise.allSettled([
      m.evidence.linkEvidence(mgrA, e.id, { target: 'inspection', targetId: r.id, itemKey: 'adhoc-bin' }),
      m.evidence.linkEvidence(mgr2A, e.id, { target: 'inspection', targetId: r.id, itemKey: 'adhoc-bin' }),
    ]);
    expect(res.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(((res.find(x => x.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect(await count(sql`SELECT count(*)::int AS n FROM assurance_evidence_inspections WHERE evidence_id = ${e.id}::uuid AND removed_at IS NULL`)).toBe(1);
  });

  it('findings raised without a requestKey are unaffected (incident source path unchanged)', async () => {
    const inc = await m.incidents.createIncident(mgrA, {
      title: '[TEST] Plain incident', description: 'x', category: 'INJURY_SAFETY', occurredAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const a = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] one', description: 'x', incidentId: inc.id, requestKey: crypto.randomUUID() });
    const b = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] two', description: 'x', incidentId: inc.id });
    expect(a.id).not.toBe(b.id);
    const created = (await auditLog(a.id)).find(l => l.action === 'assurance_finding.created')!;
    // requestKey is only honoured for inspection / audit sources.
    expect(created.after_state).not.toHaveProperty('request_key');
  });
});
