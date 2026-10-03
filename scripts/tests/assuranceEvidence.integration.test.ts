// BrainBase Assurance — Evidence & Verification (A0.1H): real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-evidence.sh (disposable postgres:17 with the
// real A0.1B..A0.1H migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceEvidence.integration.test.ts requires DATABASE_URL (see verify-assurance-evidence.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  evidence: typeof import('@/lib/assurance/evidence');
  ca: typeof import('@/lib/assurance/contractorAssurance');
  actions: typeof import('@/lib/assurance/actions');
  inspections: typeof import('@/lib/assurance/inspections');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('ev-org-a', 'ev-a-admin', 'admin');
const admin2A = V('ev-org-a', 'ev-a-admin2', 'admin');
const mgrA = V('ev-org-a', 'ev-a-mgr', 'manager');
const ownerA = V('ev-org-a', 'ev-a-owner', 'manager');
const doerA = V('ev-org-a', 'ev-a-doer', 'manager');
const pastDoerA = V('ev-org-a', 'ev-a-pastdoer', 'manager');
const viewerA = V('ev-org-a', 'ev-a-viewer', 'viewer');
const adminB = V('ev-org-b', 'ev-b-admin', 'admin');
const mgrB = V('ev-org-b', 'ev-b-mgr', 'manager');

const ACT = 'e0e0e0e0-0000-4000-8000-000000000001';
const ACT_B = 'e0e0e0e0-0000-4000-8000-000000000009';
const FND = 'e0e0e0e0-0000-4000-8000-000000000002';
const INS = 'e0e0e0e0-0000-4000-8000-000000000003';
const INS2 = 'e0e0e0e0-0000-4000-8000-000000000005';
const AUD = 'e0e0e0e0-0000-4000-8000-000000000004';
const EO_A = 'e1e1e1e1-0000-4000-8000-000000000001';
const EO_B = 'e1e1e1e1-0000-4000-8000-000000000009';
const REQ = 'e2e2e2e2-0000-4000-8000-000000000001';

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}
async function auditActions(resourceId: string) {
  return (await sql`SELECT action, user_id, before_state, after_state FROM audit_logs WHERE resource_id = ${resourceId} ORDER BY created_at, id` as
    { action: string; user_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[]);
}
async function row(id: string) {
  return ((await sql`SELECT verification_status, lock_version, decided_by, superseded_by_evidence_id, replaces_evidence_id, title FROM assurance_evidence WHERE id = ${id}::uuid`) as
    { verification_status: string; lock_version: number; decided_by: string | null; superseded_by_evidence_id: string | null; replaces_evidence_id: string | null; title: string }[])[0];
}
async function snapshotOtherModules() {
  return ((await sql`
    SELECT (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_actions) AS actions,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_findings) AS findings,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_inspections) AS inspections,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_audits) AS audits,
           (SELECT count(*) FROM assurance_verifications)::int AS verifications,
           (SELECT count(*) FROM assurance_findings)::int AS finding_count,
           (SELECT count(*) FROM assurance_timeframes)::int AS timeframes,
           (SELECT string_agg(id::text || status, ',' ORDER BY id) FROM assurance_requirement_assignments) AS assignments
  `) as Record<string, unknown>[])[0];
}

const S: Record<string, string> = {};

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES ('ev-org-a','EV Org A','ev-org-a',now()), ('ev-org-b','EV Org B','ev-org-b',now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('ev-a-admin','ev-org-a','ev-a-admin','Ada Admin','ADMIN','ACTIVE',now()),
      ('ev-a-admin2','ev-org-a','ev-a-admin2','Abe Admin','ADMIN','ACTIVE',now()),
      ('ev-a-mgr','ev-org-a','ev-a-mgr','Mia Manager','MANAGER','ACTIVE',now()),
      ('ev-a-owner','ev-org-a','ev-a-owner','Olly Owner','MANAGER','ACTIVE',now()),
      ('ev-a-doer','ev-org-a','ev-a-doer','Dee Doer','MANAGER','ACTIVE',now()),
      ('ev-a-pastdoer','ev-org-a','ev-a-pastdoer','Pat Pastdoer','MANAGER','ACTIVE',now()),
      ('ev-a-viewer','ev-org-a','ev-a-viewer','Val Viewer','VIEWER','ACTIVE',now()),
      ('ev-b-admin','ev-org-b','ev-b-admin','Bo Admin','ADMIN','ACTIVE',now()),
      ('ev-b-mgr','ev-org-b','ev-b-mgr','Bea Manager','MANAGER','ACTIVE',now());
    INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES
      ('${EO_A}','ev-org-a','EXT-EV-1','[TEST] Acme Contracting','ACTIVE'),
      ('${EO_B}','ev-org-b','EXT-EVB-1','[TEST] Org B Contractor','ACTIVE');
    INSERT INTO assurance_actions (id, organisation_id, action_reference, action_type, title, priority, owner_user_id, status, work_completed_by, work_completed_at) VALUES
      ('${ACT}','ev-org-a','ACT-EV-1','CORRECTIVE','[TEST] Fix guard rail','MEDIUM','ev-a-owner','AWAITING_VERIFICATION','ev-a-doer',now()),
      ('${ACT_B}','ev-org-b','ACT-EVB-1','CORRECTIVE','[TEST] B action','MEDIUM','ev-b-mgr','IN_PROGRESS',NULL,NULL);
    INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id) VALUES
      (gen_random_uuid()::text,'ev-org-a','ev-a-pastdoer','assurance_action.work_completed','assurance_action','${ACT}');
    INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, identified_at) VALUES
      ('${FND}','ev-org-a','FND-EV-1','OBSERVATION','[TEST] Guard rail loose','Loose rail',now());
    INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, inspection_type, title) VALUES
      ('${INS}','ev-org-a','INS-EV-1','SITE','[TEST] Site walk'), ('${INS2}','ev-org-a','INS-EV-2','SITE','[TEST] Second walk');
    INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type) VALUES
      ('ev-org-a','${INS}','fire-exits','Fire exits clear','PASS_FAIL'), ('ev-org-a','${INS2}','ladders','Ladders tagged','PASS_FAIL');
    INSERT INTO assurance_audits (id, organisation_id, audit_reference, audit_type, title, scope, standard_reference) VALUES
      ('${AUD}','ev-org-a','AUD-EV-1','INTERNAL','[TEST] Safety audit','Site','ISO 45001 cl.9');
    INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type) VALUES
      ('ev-org-a','${AUD}','c-1','Criterion one','BOOLEAN');
    INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, category, created_by) VALUES ('${REQ}','ev-org-a','PL-EV','[TEST] Public liability','INSURANCE','ev-a-admin');
    INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('ev-org-a','${EO_A}');
  `);
  m = {
    evidence: await import('@/lib/assurance/evidence'),
    ca: await import('@/lib/assurance/contractorAssurance'),
    actions: await import('@/lib/assurance/actions'),
    inspections: await import('@/lib/assurance/inspections'),
  };
});

afterAll(async () => { await sql.end(); });

describe('evidence register, provenance and item context', () => {
  it('records evidence against an action with supplier and provenance; it appears in the register', async () => {
    const ev = await m.evidence.createEvidence(mgrA, {
      evidenceType: 'PHOTO', title: '[TEST] Rail fixed', heldAt: 'Site file F-1', supplierId: EO_A, target: 'action', targetId: ACT,
      decidedBy: 'ev-a-admin', createdBy: 'ev-a-admin', // forged fields are ignored
    });
    S.e1 = ev.id;
    const r = await row(ev.id);
    expect(r.verification_status).toBe('UNVERIFIED');
    const list = await m.evidence.listEvidence(mgrA, {});
    const item = list.find(x => x.id === ev.id)!;
    expect(item.state).toBe('UNVERIFIED');
    expect(item.authority).toBe('evidence');
    expect(item.supplier_name).toBe('[TEST] Acme Contracting');
    expect(item.links.map(l => l.reference)).toEqual(['ACT-EV-1']);
    const d = (await m.evidence.getEvidenceDetail(mgrA, ev.id))!;
    expect(d.evidence.created_by).toBe('ev-a-mgr');
    expect(d.evidence.captured_by).toBe('ev-a-mgr');
    expect(d.evidence.metadata.held_at).toBe('Site file F-1');
    expect(d.links[0].target_status).toBe('AWAITING_VERIFICATION');
    expect((await auditActions(ev.id)).map(a => a.action)).toEqual(['assurance_evidence.created']);
  });

  it('inspection item and audit criterion context is structured, same-record and shown', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: '[TEST] Exit photo', target: 'inspection', targetId: INS, itemKey: 'fire-exits' });
    await m.evidence.linkEvidence(mgrA, ev.id, { target: 'audit', targetId: AUD, criterionKey: 'c-1' });
    const d = (await m.evidence.getEvidenceDetail(mgrA, ev.id))!;
    expect(d.links.map(l => `${l.kind}:${l.item_label}`).sort()).toEqual(['audit:Criterion one', 'inspection:Fire exits clear']);
    const list = await m.evidence.listEvidence(mgrA, { related: 'inspection' });
    expect(list.find(x => x.id === ev.id)!.links.find(l => l.kind === 'inspection')!.item).toBe('Fire exits clear');
    const ins = (await m.inspections.getInspectionDetail(mgrA, INS))!;
    expect(ins.evidence.find(x => x.evidence_id === ev.id)!.item_label).toBe('Fire exits clear');
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'inspection', targetId: INS, itemKey: 'ladders' }), 'AssuranceValidationError', /checklist item/);
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'action', targetId: ACT, itemKey: 'fire-exits' }), 'AssuranceValidationError');
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'x', target: 'audit', targetId: AUD, criterionKey: 'nope' }), 'AssuranceValidationError', /criterion/);
  });

  it('a supplier must be a same-org external organisation', async () => {
    await expectError(m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: 'x', supplierId: EO_B }), 'AssuranceValidationError', /supplier/i);
  });
});

describe('verification decisions and independence', () => {
  it('submit, refuse non-independent deciders, accept by an independent person; the action stays open', async () => {
    const before = await snapshotOtherModules();
    await m.evidence.requestEvidenceVerification(mgrA, S.e1, { lockVersion: 1 });
    expect((await row(S.e1)).verification_status).toBe('AWAITING_VERIFICATION');
    // recorder, action owner, current completer and a past completer are all refused
    await expectError(m.evidence.decideEvidence(mgrA, S.e1, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceForbiddenError', /recorded/);
    await expectError(m.evidence.decideEvidence(ownerA, S.e1, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceForbiddenError', /own an action/);
    await expectError(m.evidence.decideEvidence(doerA, S.e1, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceForbiddenError', /completed the work/);
    await expectError(m.evidence.decideEvidence(pastDoerA, S.e1, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceForbiddenError', /completed the work/);
    await expectError(m.evidence.decideEvidence(viewerA, S.e1, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceForbiddenError');
    const d = (await m.evidence.getEvidenceDetail(adminA, S.e1))!;
    expect(d.decision.conflicts).toEqual([]);
    const ownerView = (await m.evidence.getEvidenceDetail(ownerA, S.e1))!;
    expect(ownerView.decision.conflicts.length).toBeGreaterThan(0);
    // stale lock version refused, then accepted; a forged decider is ignored
    await expectError(m.evidence.decideEvidence(adminA, S.e1, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceConflictError', /changed/);
    const res = await m.evidence.decideEvidence(adminA, S.e1, { decision: 'ACCEPT', lockVersion: 2, decidedBy: 'ev-a-mgr' });
    expect(res).toEqual({ verification_status: 'ACCEPTED', superseded_evidence_id: null });
    expect((await row(S.e1)).decided_by).toBe('ev-a-admin');
    // non-propagation: the action is still awaiting verification, nothing verified/closed/raised
    expect(await snapshotOtherModules()).toEqual(before);
    const a = (await m.actions.getActionState(adminA, ACT));
    expect(a.status).toBe('AWAITING_VERIFICATION');
    expect((await auditActions(S.e1)).map(x => x.action)).toEqual([
      'assurance_evidence.created', 'assurance_evidence.verification_requested', 'assurance_evidence.accepted',
    ]);
  });

  it('reject needs a reason; rejection creates no finding; decisions are terminal', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: '[TEST] Blurry cert', requestVerification: true });
    const findingsBefore = (await snapshotOtherModules()).finding_count;
    await expectError(m.evidence.decideEvidence(adminA, ev.id, { decision: 'REJECT', lockVersion: 1 }), 'AssuranceValidationError', /Reason/);
    await m.evidence.decideEvidence(adminA, ev.id, { decision: 'REJECT', reason: 'Illegible', lockVersion: 1 });
    expect((await row(ev.id)).verification_status).toBe('REJECTED');
    expect((await snapshotOtherModules()).finding_count).toBe(findingsBefore);
    await expectError(m.evidence.decideEvidence(admin2A, ev.id, { decision: 'ACCEPT', lockVersion: 2 }), 'AssuranceConflictError');
    S.rejected = ev.id;
  });

  it('two concurrent decisions: exactly one wins, one audit row', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: '[TEST] Race', requestVerification: true });
    const results = await Promise.allSettled([
      m.evidence.decideEvidence(adminA, ev.id, { decision: 'ACCEPT', lockVersion: 1 }),
      m.evidence.decideEvidence(admin2A, ev.id, { decision: 'REJECT', reason: 'r', lockVersion: 1 }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as Error).name).toBe('AssuranceConflictError');
    const decisions = (await auditActions(ev.id)).filter(a => a.action === 'assurance_evidence.accepted' || a.action === 'assurance_evidence.rejected');
    expect(decisions).toHaveLength(1);
  });

  it('withdraw returns evidence to unverified; correction is allowed only before a decision, with before/after', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: '[TEST] Draft', requestVerification: true });
    await m.evidence.withdrawEvidenceVerification(mgrA, ev.id, { lockVersion: 1, reason: 'Fix title' });
    expect((await row(ev.id)).verification_status).toBe('UNVERIFIED');
    await m.evidence.correctEvidence(mgrA, ev.id, { lockVersion: 2, title: '[TEST] Final title', heldAt: 'Records R-9' });
    const audit = (await auditActions(ev.id)).find(a => a.action === 'assurance_evidence.corrected')!;
    expect(audit.before_state).toMatchObject({ title: '[TEST] Draft', held_at: null });
    expect(audit.after_state).toMatchObject({ title: '[TEST] Final title', held_at: 'Records R-9', changed: ['title', 'held_at'] });
    await expectError(m.evidence.correctEvidence(mgrA, ev.id, { lockVersion: 2, title: 'stale' }), 'AssuranceConflictError', /changed/);
    await expectError(m.evidence.correctEvidence(mgrA, S.e1, { lockVersion: 3, title: 'after decision' }), 'AssuranceConflictError', /replacement/);
    await expectError(m.evidence.correctEvidence(viewerA, ev.id, { lockVersion: 3, title: 'x' }), 'AssuranceForbiddenError');
  });
});

describe('replacement and supersession', () => {
  it('replace accepted evidence: old stays current until the replacement is accepted; a rejected replacement changes nothing', async () => {
    await expectError(m.evidence.recordReplacementEvidence(mgrA, (await m.evidence.createEvidence(mgrA, { evidenceType: 'PHOTO', title: 'u' })).id,
      { evidenceType: 'PHOTO', title: 'r' }), 'AssuranceConflictError', /accepted or rejected/);
    const r1 = await m.evidence.recordReplacementEvidence(mgrA, S.e1, { evidenceType: 'PHOTO', title: '[TEST] Rail fixed v2', requestVerification: true });
    expect((await row(r1.id)).replaces_evidence_id).toBe(S.e1);
    // the replacement supports the same open records
    const d1 = (await m.evidence.getEvidenceDetail(mgrA, r1.id))!;
    expect(d1.links.filter(l => !l.removed_at).map(l => l.reference)).toEqual(['ACT-EV-1']);
    // a second live replacement is refused
    await expectError(m.evidence.recordReplacementEvidence(mgrA, S.e1, { evidenceType: 'PHOTO', title: 'dup' }), 'AssuranceConflictError');
    await m.evidence.decideEvidence(adminA, r1.id, { decision: 'REJECT', reason: 'Wrong rail', lockVersion: 1 });
    expect((await row(S.e1)).verification_status).toBe('ACCEPTED');
    // a rejected replacement of current accepted evidence cannot start its own branch
    await expectError(m.evidence.recordReplacementEvidence(mgrA, r1.id, { evidenceType: 'PHOTO', title: 'fork' }), 'AssuranceConflictError', /current evidence/);
    const r2 = await m.evidence.recordReplacementEvidence(mgrA, S.e1, { evidenceType: 'PHOTO', title: '[TEST] Rail fixed v3', requestVerification: true });
    const before = await snapshotOtherModules();
    const res = await m.evidence.decideEvidence(admin2A, r2.id, { decision: 'ACCEPT', lockVersion: 1 });
    expect(res.superseded_evidence_id).toBe(S.e1);
    const old = await row(S.e1);
    expect(old.verification_status).toBe('SUPERSEDED');
    expect(old.superseded_by_evidence_id).toBe(r2.id);
    expect(old.decided_by).toBe('ev-a-admin'); // original decision kept
    expect(await snapshotOtherModules()).toEqual(before); // supersession touches nothing else
    const chain = (await m.evidence.getEvidenceDetail(mgrA, S.e1))!.chain;
    expect(chain.map(c => c.verification_status)).toEqual(['SUPERSEDED', 'REJECTED', 'ACCEPTED']);
    expect((await m.evidence.getEvidenceDetail(mgrA, r2.id))!.canReplace).toBe(true);
    expect((await m.evidence.getEvidenceDetail(mgrA, S.e1))!.canReplace).toBe(false);
    await expectError(m.evidence.recordReplacementEvidence(mgrA, S.e1, { evidenceType: 'PHOTO', title: 'x' }), 'AssuranceConflictError', /already been replaced/);
    expect((await auditActions(S.e1)).map(a => a.action)).toContain('assurance_evidence.superseded');
    S.current = r2.id;
  });

  it('replacing rejected evidence leaves it rejected', async () => {
    const r = await m.evidence.recordReplacementEvidence(mgrA, S.rejected, { evidenceType: 'DOCUMENT', title: '[TEST] Clear cert', requestVerification: true });
    await m.evidence.decideEvidence(adminA, r.id, { decision: 'ACCEPT', lockVersion: 1 });
    expect((await row(S.rejected)).verification_status).toBe('REJECTED');
    expect((await row(r.id)).verification_status).toBe('ACCEPTED');
  });

  it('two concurrent replacements of the same evidence: exactly one viable successor', async () => {
    const results = await Promise.allSettled([
      m.evidence.recordReplacementEvidence(mgrA, S.current, { evidenceType: 'PHOTO', title: '[TEST] race A' }),
      m.evidence.recordReplacementEvidence(mgrA, S.current, { evidenceType: 'PHOTO', title: '[TEST] race B' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const live = (await sql`SELECT count(*)::int AS n FROM assurance_evidence WHERE replaces_evidence_id = ${S.current}::uuid AND verification_status <> 'REJECTED'`) as { n: number }[];
    expect(live[0].n).toBe(1);
  });

  it('superseded evidence cannot be linked to new records', async () => {
    await expectError(m.evidence.linkEvidence(mgrA, S.e1, { target: 'finding', targetId: FND }), 'AssuranceConflictError', /replaced/);
  });
});

describe('contractor authority and projection', () => {
  it('submission evidence shows the submission decision, is queued for contractor review, and is never generically decided', async () => {
    const asg = await m.ca.createAssignment(mgrA, { externalOrganisationId: EO_A, requirementId: REQ });
    const sub = await m.ca.recordSubmission(mgrA, asg.id, { title: '[TEST] PL certificate', heldAt: 'Insurer portal', suppliedOn: '2026-10-01', expiresOn: '2027-09-30' });
    const evRows = (await sql`SELECT count(*)::int AS n FROM assurance_evidence WHERE id = ${sub.evidence_id}::uuid`) as { n: number }[];
    expect(evRows[0].n).toBe(1); // no duplicate evidence row
    let item = (await m.evidence.listEvidence(mgrA, { related: 'contractor' })).find(x => x.id === sub.evidence_id)!;
    expect(item).toMatchObject({ state: 'AWAITING_VERIFICATION', authority: 'contractor' });
    expect(item.contractor).toMatchObject({ external_organisation_name: '[TEST] Acme Contracting', requirement_name: '[TEST] Public liability', expires_on: '2027-09-30' });
    expect((await m.evidence.listContractorEvidenceQueue(adminA)).some(q => q.evidence_id === sub.evidence_id && q.can_decide)).toBe(true);
    expect((await m.evidence.listContractorEvidenceQueue(mgrA)).find(q => q.evidence_id === sub.evidence_id)!.can_decide).toBe(false);
    expect((await m.evidence.listEvidenceVerificationQueue(adminA)).some(q => q.id === sub.evidence_id)).toBe(false);
    for (const attempt of [
      () => m.evidence.requestEvidenceVerification(mgrA, sub.evidence_id, { lockVersion: 1 }),
      () => m.evidence.decideEvidence(adminA, sub.evidence_id, { decision: 'ACCEPT', lockVersion: 1 }),
      () => m.evidence.correctEvidence(mgrA, sub.evidence_id, { lockVersion: 1, title: 'x' }),
      () => m.evidence.recordReplacementEvidence(mgrA, sub.evidence_id, { evidenceType: 'DOCUMENT', title: 'x' }),
    ]) await expectError(attempt(), 'AssuranceConflictError', /Contractor assurance/);
    const subRow = ((await sql`SELECT id, lock_version FROM assurance_requirement_submissions WHERE evidence_id = ${sub.evidence_id}::uuid`) as { id: string; lock_version: number }[])[0];
    await m.ca.decideSubmission(adminA, subRow.id, { decision: 'ACCEPT', lockVersion: subRow.lock_version });
    item = (await m.evidence.listEvidence(mgrA, {})).find(x => x.id === sub.evidence_id)!;
    expect(item.state).toBe('ACCEPTED'); // never "Unverified"
    expect((await row(sub.evidence_id)).verification_status).toBe('UNVERIFIED'); // the contractor decision is not copied
    const d = (await m.evidence.getEvidenceDetail(mgrA, sub.evidence_id))!;
    expect(d).toMatchObject({ state: 'ACCEPTED', authority: 'contractor' });
    expect(d.contractor!.requirement_code).toBe('PL-EV');
    expect((await m.evidence.listRecentEvidenceDecisions(mgrA)).some(r => r.evidence_id === sub.evidence_id && r.authority === 'contractor')).toBe(true);
    // the requirement assignment itself is untouched by the evidence register
    expect(((await sql`SELECT status FROM assurance_requirement_assignments WHERE id = ${asg.id}::uuid`) as { status: string }[])[0].status).toBe('ACTIVE');
  });
});

describe('queues and filters', () => {
  it('state filters and the generic verification queue', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'STATEMENT', title: '[TEST] Queue me', target: 'action', targetId: ACT, requestVerification: true });
    const q = await m.evidence.listEvidenceVerificationQueue(adminA);
    expect(q.find(x => x.id === ev.id)!.can_decide).toBe(true);
    expect((await m.evidence.listEvidenceVerificationQueue(ownerA)).find(x => x.id === ev.id)!.can_decide).toBe(false);
    expect((await m.evidence.listEvidence(mgrA, { state: 'AWAITING_VERIFICATION' })).every(r => r.state === 'AWAITING_VERIFICATION')).toBe(true);
    expect((await m.evidence.listEvidence(mgrA, { state: 'SUPERSEDED' })).map(r => r.id)).toContain(S.e1);
    expect((await m.evidence.listEvidence(mgrA, { state: 'ACCEPTED' })).some(r => r.id === S.e1)).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('another organisation cannot list, view, decide, correct, replace or link to evidence, and foreign ids do not disclose', async () => {
    expect((await m.evidence.listEvidence(adminB, {})).some(r => r.id === S.e1)).toBe(false);
    expect(await m.evidence.getEvidenceDetail(adminB, S.e1)).toBeNull();
    expect((await m.evidence.listEvidenceVerificationQueue(adminB)).length).toBe(0);
    expect((await m.evidence.listContractorEvidenceQueue(adminB)).length).toBe(0);
    expect((await m.evidence.listRecentEvidenceDecisions(adminB)).length).toBe(0);
    await expectError(m.evidence.decideEvidence(adminB, S.current, { decision: 'REJECT', reason: 'x', lockVersion: 2 }), 'AssuranceNotFoundError');
    await expectError(m.evidence.requestEvidenceVerification(mgrB, S.current, { lockVersion: 2 }), 'AssuranceNotFoundError');
    await expectError(m.evidence.correctEvidence(mgrB, S.current, { lockVersion: 2, title: 'x' }), 'AssuranceNotFoundError');
    await expectError(m.evidence.recordReplacementEvidence(mgrB, S.current, { evidenceType: 'PHOTO', title: 'x' }), 'AssuranceNotFoundError');
    await expectError(m.evidence.linkEvidence(mgrB, S.current, { target: 'action', targetId: ACT_B }), 'AssuranceNotFoundError');
    const bEv = await m.evidence.createEvidence(mgrB, { evidenceType: 'PHOTO', title: '[TEST] B evidence' });
    await expectError(m.evidence.linkEvidence(mgrA, bEv.id, { target: 'action', targetId: ACT }), 'AssuranceNotFoundError');
    await expectError(m.evidence.linkEvidence(mgrB, bEv.id, { target: 'action', targetId: ACT }), 'AssuranceNotFoundError');
    await expectError(m.evidence.createEvidence(mgrB, { evidenceType: 'PHOTO', title: 'x', target: 'inspection', targetId: INS, itemKey: 'fire-exits' }), 'AssuranceNotFoundError');
  });
});

describe('audit atomicity', () => {
  it('a refused mutation writes no audit row; every accepted mutation writes exactly one', async () => {
    const ev = await m.evidence.createEvidence(mgrA, { evidenceType: 'DOCUMENT', title: '[TEST] Audit me' });
    const before = (await auditActions(ev.id)).length;
    await expectError(m.evidence.decideEvidence(adminA, ev.id, { decision: 'ACCEPT', lockVersion: 1 }), 'AssuranceConflictError');
    await expectError(m.evidence.requestEvidenceVerification(mgrA, ev.id, { lockVersion: 9 }), 'AssuranceConflictError');
    expect((await auditActions(ev.id)).length).toBe(before);
    await m.evidence.requestEvidenceVerification(mgrA, ev.id, { lockVersion: 1 });
    expect((await auditActions(ev.id)).length).toBe(before + 1);
  });
});
