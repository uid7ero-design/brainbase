// BrainBase Assurance — Contractor assurance (A0.1G): real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-contractor.sh (disposable postgres:17 with the
// real A0.1B..A0.1G migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceContractor.integration.test.ts requires DATABASE_URL (see verify-assurance-contractor.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  ca: typeof import('@/lib/assurance/contractorAssurance');
  rules: typeof import('@/lib/assurance/contractorAssuranceRules');
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('ca-org-a', 'ca-a-admin', 'admin');
const admin2A = V('ca-org-a', 'ca-a-admin2', 'admin');
const mgrA = V('ca-org-a', 'ca-a-mgr', 'manager');
const mgr2A = V('ca-org-a', 'ca-a-mgr2', 'manager');
const viewerA = V('ca-org-a', 'ca-a-viewer', 'viewer');
const adminB = V('ca-org-b', 'ca-b-admin', 'admin');
const mgrB = V('ca-org-b', 'ca-b-mgr', 'manager');

const EO_A = 'a1a1a1a1-0000-4000-8000-000000000001';
const EO_A2 = 'a1a1a1a1-0000-4000-8000-000000000002';
const EO_A_INACTIVE = 'a1a1a1a1-0000-4000-8000-000000000003';
const EO_B = 'b1b1b1b1-0000-4000-8000-000000000001';

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (days: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
async function auditActions(resourceId: string) {
  return (await sql`SELECT action, user_id, after_state FROM audit_logs WHERE resource_id = ${resourceId} ORDER BY created_at, id` as
    { action: string; user_id: string; after_state: Record<string, unknown> }[]);
}
async function detailAssignment(viewer: AssuranceViewer, eo: string, assignmentId: string) {
  const d = await m.ca.getContractorDetail(viewer, eo);
  return { d: d!, a: d!.assignments.find(x => x.id === assignmentId)! };
}

const S: Record<string, string> = {};

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES ('ca-org-a','CA Org A','ca-org-a',now()), ('ca-org-b','CA Org B','ca-org-b',now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('ca-a-admin','ca-org-a','ca-a-admin','Ada Admin','ADMIN','ACTIVE',now()),
      ('ca-a-admin2','ca-org-a','ca-a-admin2','Abe Admin','ADMIN','ACTIVE',now()),
      ('ca-a-mgr','ca-org-a','ca-a-mgr','Mia Manager','MANAGER','ACTIVE',now()),
      ('ca-a-mgr2','ca-org-a','ca-a-mgr2','Max Manager','MANAGER','ACTIVE',now()),
      ('ca-a-viewer','ca-org-a','ca-a-viewer','Val Viewer','VIEWER','ACTIVE',now()),
      ('ca-b-admin','ca-org-b','ca-b-admin','Bo Admin','ADMIN','ACTIVE',now()),
      ('ca-b-mgr','ca-org-b','ca-b-mgr','Bea Manager','MANAGER','ACTIVE',now());
    INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES
      ('${EO_A}','ca-org-a','EXT-CA-1','[TEST] Acme Contracting','ACTIVE'),
      ('${EO_A2}','ca-org-a','EXT-CA-2','[TEST] Beta Supplies','ACTIVE'),
      ('${EO_A_INACTIVE}','ca-org-a','EXT-CA-3','[TEST] Dormant','INACTIVE'),
      ('${EO_B}','ca-org-b','EXT-CB-1','[TEST] Org B Contractor','ACTIVE');
    INSERT INTO external_organisation_roles (organisation_id, external_organisation_id, role) VALUES ('ca-org-a','${EO_A}','CONTRACTOR');
  `);
  m = {
    ca: await import('@/lib/assurance/contractorAssurance'),
    rules: await import('@/lib/assurance/contractorAssuranceRules'),
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
  };
});

afterAll(async () => { await sql.end(); });

describe('requirement library', () => {
  it('admins create, edit and deactivate; codes are unique per organisation; stale edits refused', async () => {
    const pl = await m.ca.createRequirement(adminA, { requirementCode: 'pl ins', name: '[TEST] Public liability insurance', category: 'INSURANCE',
      evidenceGuidance: 'Certificate of currency', expiryRequired: true, renewalNoticeDays: '30' });
    S.pl = pl.id;
    S.tl = (await m.ca.createRequirement(adminA, { requirementCode: 'TRADE-LIC', name: '[TEST] Trade licence', category: 'LICENCE', expiryRequired: true })).id;
    S.ind = (await m.ca.createRequirement(adminA, { requirementCode: 'INDUCT', name: '[TEST] Site induction', category: 'COMPETENCY' })).id;
    const lib = await m.ca.listRequirements(viewerA);
    expect(lib.find(r => r.id === S.pl)).toMatchObject({ requirement_code: 'PL-INS', renewal_notice_days: 30, expiry_required: true, status: 'ACTIVE', lock_version: 1 });
    await expectError(m.ca.createRequirement(adminA, { requirementCode: 'PL-INS', name: 'dup', category: 'OTHER' }), 'AssuranceConflictError', /already exists/);
    expect((await m.ca.createRequirement(adminB, { requirementCode: 'PL-INS', name: 'B PL', category: 'INSURANCE' })).id).toBeTruthy();
    await expectError(m.ca.createRequirement(adminA, { requirementCode: '!!', name: 'x', category: 'OTHER' }), 'AssuranceValidationError', /Code/);
    await expectError(m.ca.createRequirement(adminA, { requirementCode: 'X1', name: 'x', category: 'OTHER', renewalNoticeDays: 400 }), 'AssuranceValidationError', /Renewal notice/);
    for (const who of [mgrA, viewerA]) {
      await expectError(m.ca.createRequirement(who, { requirementCode: 'Z', name: 'z', category: 'OTHER' }), 'AssuranceForbiddenError');
      await expectError(m.ca.updateRequirement(who, S.pl, { lockVersion: 1, name: 'z', category: 'OTHER' }), 'AssuranceForbiddenError');
    }
    await expectError(m.ca.updateRequirement(adminB, S.pl, { lockVersion: 1, name: 'z', category: 'OTHER' }), 'AssuranceNotFoundError');
    const e = await m.ca.updateRequirement(adminA, S.ind, { lockVersion: 1, name: '[TEST] Site induction (v2)', category: 'COMPETENCY' });
    expect(e.lock_version).toBe(2);
    await expectError(m.ca.updateRequirement(admin2A, S.ind, { lockVersion: 1, name: 'stale', category: 'OTHER' }), 'AssuranceConflictError', /Someone else/);
    const audit = await auditActions(S.ind);
    expect(audit.map(a => a.action)).toEqual(['assurance_requirement.created', 'assurance_requirement.updated']);
    expect(audit[1].after_state.changed).toEqual(['name']);
  });
});

describe('scope', () => {
  it('scope is explicit (never inferred from roles), tenant-scoped and reversible without losing history', async () => {
    expect((await m.ca.listContractorRegister(adminA, { view: 'all' })).rows).toEqual([]);   // CONTRACTOR role alone → not in scope
    await m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A, responsibleUserId: 'ca-a-mgr' });
    await m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A2 });
    await expectError(m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A_INACTIVE }), 'AssuranceConflictError', /active/);
    await expectError(m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_B }), 'AssuranceNotFoundError');
    await expectError(m.ca.setOrganisationScope(viewerA, { externalOrganisationId: EO_A2 }), 'AssuranceForbiddenError');
    await expectError(m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A2, responsibleUserId: 'ca-b-mgr', lockVersion: 1 }), 'AssuranceValidationError');
    const reg = await m.ca.listContractorRegister(mgrA, { view: 'all' });
    expect(reg.rows.map(r => [r.name, r.headline, r.responsible_name])).toEqual([
      ['[TEST] Acme Contracting', 'NO_REQUIREMENTS', 'Mia Manager'], ['[TEST] Beta Supplies', 'NO_REQUIREMENTS', null],
    ]);
    expect((await m.ca.listScopeCandidates(mgrA)).map(c => c.id)).toEqual([]);
    expect((await m.ca.listContractorRegister(mgrB, { view: 'all' })).rows).toEqual([]);
  });
});

describe('assignments', () => {
  it('assign; duplicate active refused; inactive requirement / out-of-scope / foreign ids refused', async () => {
    S.aPL = (await m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.pl, dueDate: plus(14), reviewerUserId: 'ca-a-admin' })).id;
    S.aTL = (await m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.tl })).id;
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.pl }), 'AssuranceConflictError', /already assigned/);
    await expectError(m.ca.createAssignment(viewerA, { externalOrganisationId: EO_A, requirementId: S.ind }), 'AssuranceForbiddenError');
    await expectError(m.ca.createAssignment(mgrB, { externalOrganisationId: EO_A, requirementId: S.ind }), 'AssuranceNotFoundError');
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_B, requirementId: S.ind }), 'AssuranceNotFoundError');
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: 'b1b1b1b1-0000-4000-8000-0000000000ff' }), 'AssuranceNotFoundError');
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.ind, dueDate: '2026-02-30' }), 'AssuranceValidationError', /date/);
    // Out of scope refuses new assignments, keeps existing ones; back in scope restores.
    const scope = (await m.ca.getContractorDetail(mgrA, EO_A))!.scope!;
    const out = await m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A, status: 'OUT_OF_SCOPE', responsibleUserId: 'ca-a-mgr', lockVersion: scope.lock_version });
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.ind }), 'AssuranceConflictError', /not in Assurance scope/);
    const d = await m.ca.getContractorDetail(mgrA, EO_A);
    expect(d!.assignments.filter(a => a.status === 'ACTIVE')).toHaveLength(2);
    expect((await m.ca.listContractorRegister(mgrA, { view: 'all' })).rows.map(r => r.name)).toEqual(['[TEST] Beta Supplies']);
    expect((await m.ca.listContractorRegister(mgrA, { view: 'out_of_scope' })).rows.map(r => r.name)).toEqual(['[TEST] Acme Contracting']);
    await m.ca.setOrganisationScope(mgrA, { externalOrganisationId: EO_A, status: 'IN_SCOPE', responsibleUserId: 'ca-a-mgr', lockVersion: out.lock_version });
    expect((await auditActions(scope.id)).map(a => a.action)).toEqual([
      'assurance_external_organisation_scope.created', 'assurance_external_organisation_scope.removed_from_scope',
      'assurance_external_organisation_scope.brought_into_scope',
    ]);
    // Deactivated requirement: no new assignment; existing ones continue.
    const ind = (await m.ca.listRequirements(adminA)).find(r => r.id === S.ind)!;
    await m.ca.setRequirementStatus(adminA, S.ind, { status: 'INACTIVE', lockVersion: ind.lock_version });
    await expectError(m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: S.ind }), 'AssuranceConflictError', /Requirement is not active/);
    await m.ca.setRequirementStatus(adminA, S.ind, { status: 'ACTIVE', lockVersion: ind.lock_version + 1 });
  });
});

describe('evidence, verification and status', () => {
  it('incomplete → accepted → current; independence; expiry required; snapshot; history', async () => {
    let { d, a } = await detailAssignment(mgrA, EO_A, S.aPL);
    expect(a.state).toBe('MISSING');
    expect(d.headline).toBe('MISSING');

    const s1 = await m.ca.recordSubmission(mgrA, S.aPL, { title: '[TEST] PL certificate 2026', suppliedOn: today(), expiresOn: plus(200), heldAt: 'https://example.invalid/pl.pdf' });
    S.s1 = s1.id;
    ({ d, a } = await detailAssignment(mgrA, EO_A, S.aPL));
    expect(a.state).toBe('MISSING');
    expect(a.pending.map(p => p.id)).toEqual([S.s1]);
    expect(d.headline).toBe('MISSING');
    expect(a.pending[0]).toMatchObject({ held_at: 'https://example.invalid/pl.pdf', snapshot: { code: 'PL-INS', expiry_required: true, renewal_notice_days: 30 } });
    const [ev] = await sql`SELECT evidence_type, metadata FROM assurance_evidence WHERE id = ${s1.evidence_id}::uuid` as { evidence_type: string; metadata: Record<string, string> }[];
    expect(ev).toEqual({ evidence_type: 'DOCUMENT', metadata: { source: 'contractor_assurance', held_at: 'https://example.invalid/pl.pdf' } });

    // The recorder cannot decide; a viewer cannot decide; another org cannot see it.
    await expectError(m.ca.decideSubmission(mgrA, S.s1, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceForbiddenError', /someone else/);
    await expectError(m.ca.decideSubmission(viewerA, S.s1, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceForbiddenError');
    await expectError(m.ca.decideSubmission(adminB, S.s1, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceNotFoundError');
    await expectError(m.ca.decideSubmission(adminA, S.s1, { decision: 'REJECT', lockVersion: 1 }), 'AssuranceValidationError', /Reason/);
    // Requirement edit while awaiting review does not change what it is assessed against.
    const pl = (await m.ca.listRequirements(adminA)).find(r => r.id === S.pl)!;
    await m.ca.updateRequirement(adminA, S.pl, { lockVersion: pl.lock_version, name: '[TEST] Public liability insurance ($20m)', category: 'INSURANCE',
      evidenceGuidance: 'Certificate naming the principal', expiryRequired: true, renewalNoticeDays: 30 });
    ({ a } = await detailAssignment(mgrA, EO_A, S.aPL));
    expect(a.pending[0].snapshot.name).toBe('[TEST] Public liability insurance');
    expect(a.pending[0].snapshot.evidence_guidance).toBe('Certificate of currency');
    expect(a.pending[0].requirement_changed_since).toBe(true);

    const dec = await m.ca.decideSubmission(adminA, S.s1, { decision: 'ACCEPT', lockVersion: 1 });
    expect(dec).toEqual({ status: 'ACCEPTED', superseded_submission_id: null });
    ({ d, a } = await detailAssignment(mgrA, EO_A, S.aPL));
    expect(a.state).toBe('CURRENT');
    expect(a.current!.id).toBe(S.s1);

    // Expiry-required evidence without an expiry cannot be accepted.
    const noExp = await m.ca.recordSubmission(mgrA, S.aTL, { title: '[TEST] Trade licence (no date)', suppliedOn: today() });
    await expectError(m.ca.decideSubmission(adminA, noExp.id, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceConflictError', /expiry date/);
    await m.ca.withdrawSubmission(mgrA, noExp.id, { lockVersion: 1, reason: 'Missing expiry' });
    expect(d.counts).toMatchObject({ CURRENT: 1, MISSING: 1 });
  });

  it('expired → replacement → superseded history; rejected replacement keeps the accepted evidence', async () => {
    const past = await m.ca.recordSubmission(mgrA, S.aTL, { title: '[TEST] Trade licence 2025', suppliedOn: plus(-400), effectiveFrom: plus(-400), expiresOn: plus(-5) });
    await m.ca.decideSubmission(adminA, past.id, { decision: 'ACCEPT', lockVersion: 1 });
    const first = await detailAssignment(mgrA, EO_A, S.aTL);
    const d = first.d;
    let a = first.a;
    expect(a.state).toBe('EXPIRED');
    expect(d.headline).toBe('EXPIRED');
    expect((await m.ca.listContractorRegister(mgrA, { view: 'expired' })).rows.map(r => r.name)).toEqual(['[TEST] Acme Contracting']);

    const renewal = await m.ca.recordSubmission(mgr2A, S.aTL, { title: '[TEST] Trade licence 2026', suppliedOn: today(), expiresOn: plus(365) });
    const res = await m.ca.decideSubmission(mgrA, renewal.id, { decision: 'ACCEPT', lockVersion: 1 });   // mgrA did not record this one
    expect(res.superseded_submission_id).toBe(past.id);
    ({ a } = await detailAssignment(mgrA, EO_A, S.aTL));
    expect(a.state).toBe('CURRENT');
    expect(a.current!.id).toBe(renewal.id);
    expect(a.history.find(s => s.id === past.id)).toMatchObject({ status: 'SUPERSEDED', expires_on: plus(-5) });

    const bad = await m.ca.recordSubmission(mgrA, S.aTL, { title: '[TEST] Wrong licence', suppliedOn: today(), expiresOn: plus(500) });
    await m.ca.decideSubmission(admin2A, bad.id, { decision: 'REJECT', reason: 'Licence is for a different entity', lockVersion: 1 });
    ({ a } = await detailAssignment(mgrA, EO_A, S.aTL));
    expect(a.current!.id).toBe(renewal.id);
    expect(a.history.map(s => s.status).sort()).toEqual(['ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN']);

    const audit = await auditActions(past.id);
    expect(audit.map(x => x.action)).toEqual(['assurance_contractor_evidence.recorded', 'assurance_contractor_evidence.accepted', 'assurance_contractor_evidence.superseded']);
    expect(JSON.stringify(audit)).not.toMatch(/Trade licence 2025|different entity/);
  });

  it('expiring soon only inside a configured renewal notice window', async () => {
    const r = m.rules;
    expect(r.assignmentState({ hasAccepted: true, acceptedExpiresOn: plus(10), renewalNoticeDays: 30, today: today() })).toBe('EXPIRING_SOON');
    expect(r.assignmentState({ hasAccepted: true, acceptedExpiresOn: plus(10), renewalNoticeDays: null, today: today() })).toBe('CURRENT');
    const near = await m.ca.recordSubmission(mgr2A, S.aPL, { title: '[TEST] PL short policy', suppliedOn: today(), expiresOn: plus(20) });
    await m.ca.decideSubmission(adminA, near.id, { decision: 'ACCEPT', lockVersion: 1 });
    const { d, a } = await detailAssignment(mgrA, EO_A, S.aPL);
    expect(a.state).toBe('EXPIRING_SOON');
    expect(d.headline).toBe('EXPIRING_SOON');
    expect((await m.ca.listContractorRegister(mgrA, { view: 'expiring' })).rows.map(x => x.name)).toEqual(['[TEST] Acme Contracting']);
  });
});

describe('findings and actions', () => {
  it('explicit Finding from an assignment is linked; nothing is created automatically; actions follow the existing path', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM assurance_findings WHERE organisation_id = 'ca-org-a'` as { n: number }[])[0].n;
    expect(before).toBe(0);   // expiry, rejection and missing evidence above created no Finding
    const f = await m.findings.createFinding(mgrA, { requirementAssignmentId: S.aTL, findingType: 'DEFECT', title: '[TEST] Licence lapsed before renewal', description: 'Synthetic.' });
    const [row] = await sql`SELECT responsible_external_organisation_id FROM assurance_findings WHERE id = ${f.id}::uuid` as { responsible_external_organisation_id: string }[];
    expect(row.responsible_external_organisation_id).toBe(EO_A);
    const { a } = await detailAssignment(viewerA, EO_A, S.aTL);
    expect(a.findings.map(x => x.id)).toEqual([f.id]);
    await expectError(m.findings.createFinding(mgrA, { requirementAssignmentId: S.aTL, responsibleExternalOrganisationId: EO_A2, findingType: 'DEFECT', title: 'x', description: 'x' }),
      'AssuranceValidationError', /external organisation/);
    await expectError(m.findings.createFinding(mgrB, { requirementAssignmentId: S.aTL, findingType: 'DEFECT', title: 'x', description: 'x' }), 'AssuranceNotFoundError');
    const act = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] Obtain replacement licence' });
    expect(act.id).toBeTruthy();
  });
});

describe('cancellation, isolation and races', () => {
  it('cancelled assignment keeps history and allows a fresh assignment', async () => {
    const a2 = await m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A2, requirementId: S.ind });
    const s = await m.ca.recordSubmission(mgrA, a2.id, { title: '[TEST] Induction record', suppliedOn: today() });
    await expectError(m.ca.cancelAssignment(mgrA, a2.id, { lockVersion: 1 }), 'AssuranceValidationError', /Reason/);
    await m.ca.cancelAssignment(mgrA, a2.id, { reason: 'No longer engaged', lockVersion: 1 });
    await expectError(m.ca.decideSubmission(adminA, s.id, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceConflictError', /not active/);
    await expectError(m.ca.recordSubmission(mgrA, a2.id, { title: 'x', suppliedOn: today() }), 'AssuranceConflictError', /not active/);
    const d = (await m.ca.getContractorDetail(mgrA, EO_A2))!;
    expect(d.assignments.find(x => x.id === a2.id)).toMatchObject({ status: 'CANCELLED', cancel_reason: 'No longer engaged' });
    expect(d.headline).toBe('NO_REQUIREMENTS');
    expect((await m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A2, requirementId: S.ind })).id).toBeTruthy();
  });

  it('another organisation sees nothing and cannot act on any id', async () => {
    expect(await m.ca.getContractorDetail(adminB, EO_A)).toBeNull();
    expect((await m.ca.listContractorRegister(adminB, { view: 'all' })).rows).toEqual([]);
    expect((await m.ca.listRequirements(adminB)).map(r => r.requirement_code)).toEqual(['PL-INS']);
    await expectError(m.ca.recordSubmission(mgrB, S.aPL, { title: 'x', suppliedOn: today() }), 'AssuranceNotFoundError');
    await expectError(m.ca.cancelAssignment(mgrB, S.aPL, { reason: 'x', lockVersion: 1 }), 'AssuranceNotFoundError');
    await expectError(m.ca.updateAssignment(mgrB, S.aPL, { lockVersion: 1 }), 'AssuranceNotFoundError');
    await expectError(m.ca.setRequirementStatus(adminB, S.pl, { status: 'INACTIVE', lockVersion: 1 }), 'AssuranceNotFoundError');
    await expectError(m.ca.withdrawSubmission(mgrB, S.s1, { lockVersion: 1 }), 'AssuranceNotFoundError');
  });

  it('forged organisation / actor fields are ignored', async () => {
    const r = await m.ca.createRequirement(adminA, { requirementCode: 'FORGE', name: '[TEST] Forge probe', category: 'OTHER',
      organisationId: 'ca-org-b', organisation_id: 'ca-org-b', created_by: 'ca-b-admin', status: 'INACTIVE' });
    const [row] = await sql`SELECT organisation_id, created_by, status FROM assurance_requirements WHERE id = ${r.id}::uuid` as Record<string, string>[];
    expect(row).toEqual({ organisation_id: 'ca-org-a', created_by: 'ca-a-admin', status: 'ACTIVE' });
    const s = await m.ca.recordSubmission(mgrA, S.aTL, { title: '[TEST] Forge evidence', suppliedOn: today(), recordedBy: 'ca-a-admin', recorded_by: 'ca-a-admin', status: 'ACCEPTED' });
    const [sub] = await sql`SELECT recorded_by, status FROM assurance_requirement_submissions WHERE id = ${s.id}::uuid` as Record<string, string>[];
    expect(sub).toEqual({ recorded_by: 'ca-a-mgr', status: 'SUBMITTED' });
  });

  it('two admins deciding the same evidence: exactly one decision', async () => {
    const s = await m.ca.recordSubmission(mgrA, S.aPL, { title: '[TEST] PL race', suppliedOn: today(), expiresOn: plus(300) });
    const results = await Promise.allSettled([
      m.ca.decideSubmission(adminA, s.id, { decision: 'ACCEPT', lockVersion: 1 }),
      m.ca.decideSubmission(admin2A, s.id, { decision: 'REJECT', reason: 'race', lockVersion: 1 }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    const audit = await auditActions(s.id);
    expect(audit.filter(x => /accepted|rejected/.test(x.action))).toHaveLength(1);
  });

  it('two accepts on different pending evidence for one assignment serialise: one current, the other superseded', async () => {
    const p1 = await m.ca.recordSubmission(mgrA, S.aPL, { title: '[TEST] PL r1', suppliedOn: today(), expiresOn: plus(310) });
    const p2 = await m.ca.recordSubmission(mgrA, S.aPL, { title: '[TEST] PL r2', suppliedOn: today(), expiresOn: plus(320) });
    const results = await Promise.allSettled([
      m.ca.decideSubmission(adminA, p1.id, { decision: 'ACCEPT', lockVersion: 1 }),
      m.ca.decideSubmission(admin2A, p2.id, { decision: 'ACCEPT', lockVersion: 1 }),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const [c] = await sql`SELECT count(*) FILTER (WHERE status = 'ACCEPTED')::int AS acc FROM assurance_requirement_submissions WHERE assignment_id = ${S.aPL}::uuid` as { acc: number }[];
    expect(c.acc).toBe(1);
    const statuses = await sql`SELECT id, status FROM assurance_requirement_submissions WHERE id IN (${p1.id}::uuid, ${p2.id}::uuid)` as { id: string; status: string }[];
    expect(statuses.map(x => x.status).sort()).toEqual(['ACCEPTED', 'SUPERSEDED']);
  });

  it('duplicate concurrent assignment and deactivate-vs-assign: deterministic conflicts', async () => {
    const req = await m.ca.createRequirement(adminA, { requirementCode: 'RACE', name: '[TEST] Race requirement', category: 'OTHER' });
    const dup = await Promise.allSettled([
      m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A2, requirementId: req.id }),
      m.ca.createAssignment(mgr2A, { externalOrganisationId: EO_A2, requirementId: req.id }),
    ]);
    expect(dup.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((dup.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.name).toBe('AssuranceConflictError');
    const req2 = await m.ca.createRequirement(adminA, { requirementCode: 'RACE2', name: '[TEST] Race requirement 2', category: 'OTHER' });
    const [assign, deactivate] = await Promise.allSettled([
      m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: req2.id }),
      m.ca.setRequirementStatus(adminA, req2.id, { status: 'INACTIVE', lockVersion: 1 }),
    ]);
    expect(deactivate.status).toBe('fulfilled');
    if (assign.status === 'rejected') expect((assign.reason as Error).name).toBe('AssuranceConflictError');
    const [st] = await sql`SELECT status FROM assurance_requirements WHERE id = ${req2.id}::uuid` as { status: string }[];
    expect(st.status).toBe('INACTIVE');
  });

  it('a failed audit write rolls the decision back (atomic)', async () => {
    const s = await m.ca.recordSubmission(mgrA, S.aTL, { title: '[TEST] Atomic', suppliedOn: today(), expiresOn: plus(400) });
    await sql.raw(`
      CREATE OR REPLACE FUNCTION ca_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'assurance_contractor_evidence.accepted' AND NEW.resource_id = '${s.id}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ca_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ca_fail_audit();
    `);
    try {
      let failed = false;
      try { await m.ca.decideSubmission(adminA, s.id, { decision: 'ACCEPT', lockVersion: 1 }); } catch { failed = true; }
      expect(failed).toBe(true);
      const [row] = await sql`SELECT status, lock_version FROM assurance_requirement_submissions WHERE id = ${s.id}::uuid` as { status: string; lock_version: number }[];
      expect(row).toEqual({ status: 'SUBMITTED', lock_version: 1 });
      const { a } = await detailAssignment(mgrA, EO_A, S.aTL);
      expect(a.current!.status).toBe('ACCEPTED');
      expect(a.current!.id).not.toBe(s.id);
    } finally {
      await sql.raw('DROP TRIGGER ca_fail_audit ON audit_logs; DROP FUNCTION ca_fail_audit();');
    }
  });
});
