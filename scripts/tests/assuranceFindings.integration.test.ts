// BrainBase Assurance — Findings & Corrective Actions (A0.1I): real-Postgres service proof.
// Run ONLY via scripts/tests/verify-assurance-findings.sh (disposable postgres:17 with the
// real A0.1B..A0.1I migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceFindings.integration.test.ts requires DATABASE_URL (see verify-assurance-findings.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
  verifications: typeof import('@/lib/assurance/verifications');
  evidence: typeof import('@/lib/assurance/evidence');
  deadlines: typeof import('@/lib/assurance/deadlines');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('fa-org-a', 'fa-a-admin', 'admin');
const admin2A = V('fa-org-a', 'fa-a-admin2', 'admin');
const mgrA = V('fa-org-a', 'fa-a-mgr', 'manager');
const ownerA = V('fa-org-a', 'fa-a-owner', 'manager');
const doerA = V('fa-org-a', 'fa-a-doer', 'manager');
const outsiderA = V('fa-org-a', 'fa-a-outsider', 'manager');
const viewerA = V('fa-org-a', 'fa-a-viewer', 'viewer');
const adminB = V('fa-org-b', 'fa-b-admin', 'admin');

const INC = 'fa000000-0000-4000-8000-000000000001';
const INC_R = 'fa000000-0000-4000-8000-000000000002'; // restricted incident
const INS = 'fa000000-0000-4000-8000-000000000003';
const AUD = 'fa000000-0000-4000-8000-000000000004';
const RL = 'fa000000-0000-4000-8000-000000000005';
const EO = 'fa000000-0000-4000-8000-000000000006';
const REQ = 'fa000000-0000-4000-8000-000000000007';
const ASG = 'fa000000-0000-4000-8000-000000000008';
const BOARD = 'fa000000-0000-4000-8000-000000000009';
const ITEM = 'fa000000-0000-4000-8000-00000000000a';

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
async function findingRow(id: string) {
  return ((await sql`SELECT status, closed_at, closed_by, closure_reason, risk_level_id FROM assurance_findings WHERE id = ${id}::uuid`) as
    { status: string; closed_at: Date | null; closed_by: string | null; closure_reason: string | null; risk_level_id: string | null }[])[0];
}
async function actionStatus(id: string) {
  return ((await sql`SELECT status FROM assurance_actions WHERE id = ${id}::uuid`) as { status: string }[])[0].status;
}
/** Everything a Finding close / reopen must never touch. */
async function snapshotOthers() {
  return ((await sql`
    SELECT (SELECT string_agg(id::text || status || updated_at::text || coalesce(closed_at::text, ''), ',' ORDER BY id) FROM assurance_actions) AS actions,
           (SELECT string_agg(id::text || result || attempt_number, ',' ORDER BY id) FROM assurance_verifications) AS verifications,
           (SELECT string_agg(id::text || verification_status || lock_version, ',' ORDER BY id) FROM assurance_evidence) AS evidence,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_incidents) AS incidents,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_inspections) AS inspections,
           (SELECT string_agg(id::text || status || updated_at::text, ',' ORDER BY id) FROM assurance_audits) AS audits,
           (SELECT string_agg(id::text || status, ',' ORDER BY id) FROM assurance_requirement_assignments) AS assignments,
           (SELECT string_agg(id::text || status || current_due_at::text || original_due_at::text, ',' ORDER BY id) FROM assurance_timeframes) AS timeframes,
           (SELECT count(*) FROM assurance_timeframe_extensions)::int AS extensions,
           (SELECT count(*) FROM assurance_escalations)::int AS escalations,
           (SELECT count(*) FROM assurance_action_findings)::int AS action_links,
           (SELECT string_agg(id::text || status, ',' ORDER BY id) FROM organiser_items) AS tasks
  `) as Record<string, unknown>[])[0];
}

/** Drives one corrective Action through work -> evidence -> independent verification -> close. */
async function completeAction(actionId: string) {
  await m.actions.startAction(doerA, actionId);
  expect(await m.actions.completeActionWork(doerA, actionId)).toEqual({ status: 'AWAITING_EVIDENCE' });
  const ev = await m.evidence.createEvidence(doerA, { evidenceType: 'PHOTO', title: '[TEST] Fixed', heldAt: 'Site file', target: 'action', targetId: actionId });
  await m.evidence.requestEvidenceVerification(doerA, ev.id, { lockVersion: 1 });
  await m.evidence.decideEvidence(admin2A, ev.id, { decision: 'ACCEPT', lockVersion: 2 });
  expect(await actionStatus(actionId)).toBe('AWAITING_EVIDENCE'); // accepting evidence never moves the Action
  expect(await m.actions.submitActionEvidence(doerA, actionId)).toEqual({ status: 'AWAITING_VERIFICATION' });
  await m.verifications.recordVerification(admin2A, actionId, { result: 'ACCEPTED' });
  expect(await actionStatus(actionId)).toBe('AWAITING_VERIFICATION'); // verification never closes
  await m.actions.closeAction(adminA, actionId);
  expect(await actionStatus(actionId)).toBe('CLOSED');
  return ev.id;
}

const S: Record<string, string> = {};

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at) VALUES ('fa-org-a','FA Org A','fa-org-a',now()), ('fa-org-b','FA Org B','fa-org-b',now());
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('fa-a-admin','fa-org-a','fa-a-admin','Ada Admin','ADMIN','ACTIVE',now()),
      ('fa-a-admin2','fa-org-a','fa-a-admin2','Abe Admin','ADMIN','ACTIVE',now()),
      ('fa-a-mgr','fa-org-a','fa-a-mgr','Mia Manager','MANAGER','ACTIVE',now()),
      ('fa-a-owner','fa-org-a','fa-a-owner','Olly Owner','MANAGER','ACTIVE',now()),
      ('fa-a-doer','fa-org-a','fa-a-doer','Dee Doer','MANAGER','ACTIVE',now()),
      ('fa-a-outsider','fa-org-a','fa-a-outsider','Otto Outsider','MANAGER','ACTIVE',now()),
      ('fa-a-viewer','fa-org-a','fa-a-viewer','Val Viewer','VIEWER','ACTIVE',now()),
      ('fa-b-admin','fa-org-b','fa-b-admin','Bo Admin','ADMIN','ACTIVE',now());
    INSERT INTO assurance_risk_levels (id, organisation_id, code, name, rank) VALUES ('${RL}','fa-org-a','HIGH','High',3);
    INSERT INTO assurance_incidents (id, organisation_id, incident_reference, category, title, description, occurred_at, restricted, created_by) VALUES
      ('${INC}','fa-org-a','INC-FA-1','INJURY_SAFETY','[TEST] Slip in wash bay','Slip',now() - interval '2 days',false,'fa-a-mgr'),
      ('${INC_R}','fa-org-a','INC-FA-R','INJURY_SAFETY','[TEST] Restricted incident','Sensitive',now() - interval '2 days',true,'fa-a-mgr');
    INSERT INTO assurance_inspections (id, organisation_id, inspection_reference, inspection_type, title) VALUES
      ('${INS}','fa-org-a','INS-FA-1','SITE','[TEST] Depot walk');
    INSERT INTO assurance_inspection_responses (organisation_id, inspection_id, item_key, item_label, response_type, outcome) VALUES
      ('fa-org-a','${INS}','drain-grates','Drain grates secured','PASS_FAIL','FAIL'),
      ('fa-org-a','${INS}','fire-exits','Fire exits clear','PASS_FAIL','PASS');
    INSERT INTO assurance_audits (id, organisation_id, audit_reference, audit_type, title, scope, standard_reference) VALUES
      ('${AUD}','fa-org-a','AUD-FA-1','INTERNAL','[TEST] Safety audit','Depot','ISO 45001 cl.9');
    INSERT INTO assurance_audit_responses (organisation_id, audit_id, criterion_key, criterion_label, response_type) VALUES
      ('fa-org-a','${AUD}','c-9-1','9.1 Monitoring and measurement','BOOLEAN');
    INSERT INTO external_organisations (id, organisation_id, reference, name, status) VALUES ('${EO}','fa-org-a','EXT-FA-1','[TEST] Acme Contracting','ACTIVE');
    INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, category, created_by) VALUES ('${REQ}','fa-org-a','PL-FA','[TEST] Public liability','INSURANCE','fa-a-admin');
    INSERT INTO assurance_external_organisation_scopes (organisation_id, external_organisation_id) VALUES ('fa-org-a','${EO}');
    INSERT INTO assurance_requirement_assignments (id, organisation_id, external_organisation_id, requirement_id, created_by) VALUES ('${ASG}','fa-org-a','${EO}','${REQ}','fa-a-admin');
    INSERT INTO modules (key, name, active) VALUES ('organiser', 'Organiser', true) ON CONFLICT (key) DO NOTHING;
    INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('fa-org-a', 'organiser', true) ON CONFLICT DO NOTHING;
    INSERT INTO organiser_boards (id, organisation_id, name) VALUES ('${BOARD}','fa-org-a','[TEST] Depot works');
    INSERT INTO organiser_items (id, board_id, organisation_id, name, status) VALUES ('${ITEM}','${BOARD}','fa-org-a','[TEST] Bolt grate','Not Started');
  `);
  m = {
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
    verifications: await import('@/lib/assurance/verifications'),
    evidence: await import('@/lib/assurance/evidence'),
    deadlines: await import('@/lib/assurance/deadlines'),
  };
});

afterAll(async () => { await sql.end(); });

describe('source provenance (structured, A0.1I)', () => {
  it('a finding raised from an inspection item stores the item key on the link and shows its label', async () => {
    const f = await m.findings.createFinding(mgrA, {
      findingType: 'HAZARD', title: '[TEST] Lifted drain grate', description: 'Trip hazard', inspectionId: INS, inspectionItemKey: 'drain-grates',
      riskLevelId: RL, dueAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    S.fIns = f.id;
    const link = ((await sql`SELECT item_key FROM assurance_inspection_findings WHERE finding_id = ${f.id}::uuid`) as { item_key: string }[])[0];
    expect(link.item_key).toBe('drain-grates');
    const d = (await m.findings.getFindingDetail(mgrA, f.id))!;
    expect(d.sources).toEqual([expect.objectContaining({ kind: 'inspection', id: INS, reference: 'INS-FA-1', context: 'Drain grates secured', context_key: 'drain-grates' })]);
    const created = (await audit(f.id)).filter(a => a.action === 'assurance_finding.created');
    expect(created).toHaveLength(1);
  });

  it('a finding raised from an audit criterion stores the criterion key', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: '[TEST] Monitoring gap', description: 'No records', auditId: AUD, auditCriterionKey: 'c-9-1' });
    S.fAud = f.id;
    const d = (await m.findings.getFindingDetail(mgrA, f.id))!;
    expect(d.sources).toEqual([expect.objectContaining({ kind: 'audit', reference: 'AUD-FA-1', context: '9.1 Monitoring and measurement', context_key: 'c-9-1' })]);
  });

  it('a finding raised from a contractor requirement shows the contractor and requirement', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'NON_CONFORMANCE', title: '[TEST] Insurance lapsed', description: 'Expired', requirementAssignmentId: ASG });
    S.fCon = f.id;
    const d = (await m.findings.getFindingDetail(mgrA, f.id))!;
    expect(d.sources).toEqual([expect.objectContaining({ kind: 'contractor', id: EO, reference: '[TEST] Acme Contracting', context: 'PL-FA — [TEST] Public liability' })]);
    expect((await m.findings.listFindings(mgrA, { source: 'contractor' })).map(r => r.id)).toEqual([f.id]);
  });

  it('an unknown item or criterion is refused and nothing is written', async () => {
    const before = ((await sql`SELECT count(*)::int AS n FROM assurance_findings`) as { n: number }[])[0].n;
    await expectError(m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'x', description: 'x', inspectionId: INS, inspectionItemKey: 'nope' }), 'AssuranceValidationError');
    await expectError(m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: 'x', description: 'x', auditId: AUD, auditCriterionKey: 'nope' }), 'AssuranceValidationError');
    expect(((await sql`SELECT count(*)::int AS n FROM assurance_findings`) as { n: number }[])[0].n).toBe(before);
  });

  it('source provenance cannot be retargeted in the database', async () => {
    await expect(sql`UPDATE assurance_inspection_findings SET item_key = 'fire-exits' WHERE finding_id = ${S.fIns}::uuid`).rejects.toMatchObject({ code: 'CE001' });
    await expect(sql`UPDATE assurance_audit_findings SET finding_id = ${S.fIns}::uuid WHERE finding_id = ${S.fAud}::uuid`).rejects.toMatchObject({ code: 'CE001' });
  });
});

describe('finding lifecycle, closure reason, readiness and register views', () => {
  it('needs action -> actions underway -> ready for closure (derived, no status propagation)', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Loose rail', description: 'Rail moves', incidentId: INC, riskLevelId: RL });
    S.f1 = f.id;
    const ids = async (view: string) => (await m.findings.listFindings(mgrA, { view })).map(r => r.id);
    expect(await ids('needs_action')).toContain(f.id);
    expect(await ids('underway')).not.toContain(f.id);

    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] Re-fix rail', priority: 'HIGH', ownerUserId: 'fa-a-owner' });
    S.a1 = a.id;
    expect(await ids('underway')).toContain(f.id);
    expect(await ids('needs_action')).not.toContain(f.id);
    expect((await findingRow(f.id)).status).toBe('OPEN'); // creating an Action changes no Finding status

    // Task completion is an execution aid only.
    await m.actions.linkActionTask(mgrA, a.id, { organiserItemId: ITEM });
    await sql`UPDATE organiser_items SET status = 'Done' WHERE id = ${ITEM}::uuid`;
    expect(await actionStatus(a.id)).toBe('OPEN');

    // Work complete != verified != closed.
    S.e1 = await completeAction(a.id);
    const d = (await m.findings.getFindingDetail(mgrA, f.id))!;
    expect(d.actions[0]).toMatchObject({ status: 'CLOSED', accepted_evidence_count: 1, active_evidence_count: 1, latest_verification_result: 'ACCEPTED' });
    expect(d.actions[0].work_completed_at).toBeTruthy();
    expect((await findingRow(f.id)).status).toBe('OPEN'); // no auto-close when the last action closes
    expect(await ids('ready')).toContain(f.id);
    expect(await ids('underway')).not.toContain(f.id);
  });

  it('closure needs the transition path, a reason and the close permission', async () => {
    await expectError(m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED', reason: 'x' }), 'AssuranceConflictError', /cannot move/);
    await m.findings.transitionFinding(mgrA, S.f1, { status: 'UNDER_REVIEW' });
    await expectError(m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED' }), 'AssuranceValidationError', /Closure reason/);
    await expectError(m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED', reason: '   ' }), 'AssuranceValidationError', /Closure reason/);
    await expectError(m.findings.transitionFinding(viewerA, S.f1, { status: 'CLOSED', reason: 'x' }), 'AssuranceForbiddenError');
    const before = await snapshotOthers();
    await m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED', reason: 'Rail re-fixed and verified (ACT closed).' });
    const r = await findingRow(S.f1);
    expect(r).toMatchObject({ status: 'CLOSED', closed_by: 'fa-a-admin', closure_reason: 'Rail re-fixed and verified (ACT closed).' });
    expect(await snapshotOthers()).toEqual(before); // closing never touches actions, sources, evidence, verifications, deadlines
    const closed = (await audit(S.f1)).filter(a => a.action === 'assurance_finding.closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].after_state).toMatchObject({ status: 'CLOSED', closure_reason: 'Rail re-fixed and verified (ACT closed).' });
  });

  it('closure is refused while any linked action is open; readiness explains why', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'DEFECT', title: '[TEST] Faulty light', description: 'Flicker' });
    await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] Replace light', priority: 'LOW' });
    await m.findings.transitionFinding(mgrA, f.id, { status: 'UNDER_REVIEW' });
    await expectError(m.findings.transitionFinding(adminA, f.id, { status: 'CLOSED', reason: 'done' }), 'AssuranceConflictError', /linked actions are still open/);
    const { findingClosureReadiness } = await import('@/lib/assurance/findingRules');
    const d = (await m.findings.getFindingDetail(mgrA, f.id))!;
    const r = findingClosureReadiness({ status: d.finding.status, openVisibleActions: d.actions.map(a => ({ reference: a.action_reference })), openHiddenActions: d.hiddenOpenActionCount, viewerCanClose: true });
    expect(r.canCloseNow).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/still open: ACT-/);
  });

  it('cancellation needs a reason and is terminal', async () => {
    await expectError(m.findings.transitionFinding(adminA, S.fCon, { status: 'CANCELLED' }), 'AssuranceValidationError', /Cancellation reason/);
    await m.findings.transitionFinding(adminA, S.fCon, { status: 'CANCELLED', reason: 'Duplicate of an existing contractor finding.' });
    expect(await findingRow(S.fCon)).toMatchObject({ status: 'CANCELLED', closure_reason: 'Duplicate of an existing contractor finding.' });
    expect((await audit(S.fCon)).filter(a => a.action === 'assurance_finding.cancelled')).toHaveLength(1);
    await expectError(m.findings.reopenFinding(adminA, S.fCon, { reason: 'x' }), 'AssuranceConflictError', /cancelled finding cannot be reopened/);
    expect((await m.findings.listFindings(mgrA, { view: 'closed' })).map(r => r.id)).toEqual(expect.arrayContaining([S.f1, S.fCon]));
  });

  it('a legacy terminal finding without a recorded reason is shown as such (no reason is fabricated)', async () => {
    const id = 'fa000000-0000-4000-8000-0000000000aa';
    // Simulate a pre-A0.1I closure: insert as OPEN then close with the guard disabled for this one row only.
    await sql.raw(`
      INSERT INTO assurance_findings (id, organisation_id, finding_reference, finding_type, title, description, identified_at)
        VALUES ('${id}','fa-org-a','FND-FA-LEGACY','OBSERVATION','[TEST] Legacy closure','Closed long ago',now() - interval '90 days');
      ALTER TABLE assurance_findings DISABLE TRIGGER trg_assurance_findings_lifecycle;
      UPDATE assurance_findings SET status = 'CLOSED', closed_at = now() - interval '60 days', closed_by = 'fa-a-admin' WHERE id = '${id}';
      ALTER TABLE assurance_findings ENABLE TRIGGER trg_assurance_findings_lifecycle;
    `);
    const d = (await m.findings.getFindingDetail(mgrA, id))!;
    expect(d.finding.closure_reason).toBeNull();
    await expect(sql`UPDATE assurance_findings SET closure_reason = 'Legacy closure' WHERE id = ${id}::uuid`).rejects.toMatchObject({ code: 'CF001' });
    S.legacy = id;
  });
});

describe('reopen (A0.1I): CLOSED -> UNDER_REVIEW with immutable history', () => {
  it('requires the close permission, visibility, a CLOSED finding and a reason', async () => {
    await expectError(m.findings.reopenFinding(viewerA, S.f1, { reason: 'x' }), 'AssuranceForbiddenError');
    await expectError(m.findings.reopenFinding(adminB, S.f1, { reason: 'x' }), 'AssuranceNotFoundError');
    await expectError(m.findings.reopenFinding(adminA, S.f1, { reason: '  ' }), 'AssuranceValidationError', /Reopen reason/);
    await expectError(m.findings.reopenFinding(adminA, S.fAud, { reason: 'x' }), 'AssuranceConflictError', /Only a closed finding/);
    expect(((await sql`SELECT count(*)::int AS n FROM assurance_finding_reopenings`) as { n: number }[])[0].n).toBe(0);
  });

  it('reopens, preserves the closure record in history and changes nothing else', async () => {
    const prev = await findingRow(S.f1);
    // Make the CLOSURE deadline factual history: past due.
    await sql`INSERT INTO assurance_timeframes (organisation_id, finding_id, timeframe_type, original_due_at, current_due_at, created_by)
              VALUES ('fa-org-a', ${S.f1}::uuid, 'CLOSURE', now() - interval '3 days', now() - interval '3 days', 'fa-a-mgr')`;
    const before = await snapshotOthers();
    const auditBefore = ((await sql`SELECT count(*)::int AS n FROM audit_logs`) as { n: number }[])[0].n;
    const r = await m.findings.reopenFinding(mgrA, S.f1, { reason: 'Rail found loose again after storm.' });
    expect(r).toEqual({ id: S.f1, status: 'UNDER_REVIEW', reopen_number: 1 });
    expect(await findingRow(S.f1)).toMatchObject({ status: 'UNDER_REVIEW', closed_at: null, closed_by: null, closure_reason: null, risk_level_id: prev.risk_level_id });
    const d = (await m.findings.getFindingDetail(mgrA, S.f1))!;
    expect(d.reopenings).toHaveLength(1);
    expect(d.reopenings[0]).toMatchObject({
      reopen_number: 1, previous_status: 'CLOSED', previous_closed_by_name: 'Ada Admin',
      previous_closure_reason: 'Rail re-fixed and verified (ACT closed).', reason: 'Rail found loose again after storm.', reopened_by_name: 'Mia Manager',
    });
    expect(new Date(d.reopenings[0].previous_closed_at).getTime()).toBe(new Date(prev.closed_at!).getTime());
    // Non-propagation: actions, verifications, evidence, sources, deadlines, tasks untouched; no timeframe created.
    expect(await snapshotOthers()).toEqual(before);
    expect(await actionStatus(S.a1)).toBe('CLOSED');
    // Exactly one audit event, atomically.
    expect(((await sql`SELECT count(*)::int AS n FROM audit_logs`) as { n: number }[])[0].n).toBe(auditBefore + 1);
    const ev = (await audit(S.f1)).filter(a => a.action === 'assurance_finding.reopened');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ user_id: 'fa-a-mgr', before_state: { status: 'CLOSED', closure_reason: 'Rail re-fixed and verified (ACT closed).' }, after_state: { status: 'UNDER_REVIEW', reason: 'Rail found loose again after storm.', reopen_number: 1 } });
    // The existing (past-due) deadline now shows as overdue — factually, without being reset.
    expect((await m.findings.listFindings(mgrA, { view: 'overdue' })).map(x => x.id)).toContain(S.f1);
    const tfs = await m.deadlines.listRecordTimeframes(mgrA, 'finding', S.f1);
    expect(tfs).toHaveLength(1);
    // Derived: the only action is closed, so the reopened finding is "ready" until follow-up work is added.
    expect((await m.findings.listFindings(mgrA, { view: 'ready' })).map(x => x.id)).toContain(S.f1);
  });

  it('a reopened finding is still closed only explicitly, never automatically', async () => {
    expect((await findingRow(S.f1)).status).toBe('UNDER_REVIEW');
  });

  it('follow-up work is a NEW action; the closed action and its verification history stay as they are', async () => {
    const verBefore = await sql`SELECT id, result, attempt_number FROM assurance_verifications WHERE action_id = ${S.a1}::uuid ORDER BY attempt_number`;
    const a2 = await m.actions.createAction(mgrA, { findingIds: [S.f1], actionType: 'CORRECTIVE', title: '[TEST] Replace rail section', priority: 'HIGH', ownerUserId: 'fa-a-owner' });
    S.a2 = a2.id;
    let d = (await m.findings.getFindingDetail(mgrA, S.f1))!;
    expect(d.actions.map(a => [a.id, a.status])).toEqual([[S.a1, 'CLOSED'], [S.a2, 'OPEN']]);
    expect((await m.findings.listFindings(mgrA, { view: 'underway' })).map(x => x.id)).toContain(S.f1);
    // Owner, current completer and earlier completers cannot verify.
    await m.actions.startAction(doerA, a2.id);
    await m.actions.completeActionWork(doerA, a2.id);
    const ev = await m.evidence.createEvidence(doerA, { evidenceType: 'PHOTO', title: '[TEST] Welded', target: 'action', targetId: a2.id });
    await m.actions.submitActionEvidence(doerA, a2.id);
    await expectError(m.verifications.recordVerification(ownerA, a2.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/);
    await expectError(m.verifications.recordVerification(doerA, a2.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/);
    await m.verifications.recordVerification(admin2A, a2.id, { result: 'REJECTED', notes: 'Weld incomplete.' });
    expect(await actionStatus(a2.id)).toBe('IN_PROGRESS');
    await m.actions.completeActionWork(outsiderA, a2.id); // a second completer
    await expectError(m.verifications.recordVerification(doerA, a2.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/); // historical completer
    await expectError(m.verifications.recordVerification(outsiderA, a2.id, { result: 'ACCEPTED' }), 'AssuranceForbiddenError', /independent/); // current completer
    await m.verifications.recordVerification(admin2A, a2.id, { result: 'ACCEPTED', evidenceIds: [ev.id] });
    await m.actions.closeAction(adminA, a2.id);
    expect(await sql`SELECT id, result, attempt_number FROM assurance_verifications WHERE action_id = ${S.a1}::uuid ORDER BY attempt_number`).toEqual(verBefore);
    d = (await m.findings.getFindingDetail(mgrA, S.f1))!;
    expect(d.actions.map(a => [a.id, a.status])).toEqual([[S.a1, 'CLOSED'], [S.a2, 'CLOSED']]);
    expect((await findingRow(S.f1)).status).toBe('UNDER_REVIEW');
  });

  it('reclose needs a NEW reason; both closure cycles and the reopen stay visible', async () => {
    await expectError(m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED' }), 'AssuranceValidationError', /Closure reason/);
    await m.findings.transitionFinding(adminA, S.f1, { status: 'CLOSED', reason: 'Rail section replaced (welded) and verified.' });
    const d = (await m.findings.getFindingDetail(mgrA, S.f1))!;
    expect(d.finding.closure_reason).toBe('Rail section replaced (welded) and verified.');
    expect(d.reopenings.map(r => r.previous_closure_reason)).toEqual(['Rail re-fixed and verified (ACT closed).']);
    const verbs = (await audit(S.f1)).map(a => a.action).filter(a => /closed|reopened/.test(a));
    expect(verbs).toEqual(['assurance_finding.closed', 'assurance_finding.reopened', 'assurance_finding.closed']);
  });

  it('two concurrent reopens: exactly one wins, the other gets a deterministic conflict', async () => {
    const results = await Promise.allSettled([
      m.findings.reopenFinding(adminA, S.f1, { reason: '[TEST] race one' }),
      m.findings.reopenFinding(admin2A, S.f1, { reason: '[TEST] race two' }),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as Error).name).toBe('AssuranceConflictError');
    const rows = (await sql`SELECT reopen_number FROM assurance_finding_reopenings WHERE finding_id = ${S.f1}::uuid ORDER BY reopen_number`) as { reopen_number: number }[];
    expect(rows.map(r => r.reopen_number)).toEqual([1, 2]);
    expect((await audit(S.f1)).filter(a => a.action === 'assurance_finding.reopened')).toHaveLength(2);
  });

  it('reopen history is append-only', async () => {
    await expect(sql`UPDATE assurance_finding_reopenings SET reason = 'edited' WHERE finding_id = ${S.f1}::uuid`).rejects.toMatchObject({ code: 'CF001' });
    await expect(sql`DELETE FROM assurance_finding_reopenings WHERE finding_id = ${S.f1}::uuid`).rejects.toMatchObject({ code: 'CF001' });
  });

  it('a legacy closure can be reopened; its missing reason is preserved as missing', async () => {
    await m.findings.reopenFinding(adminA, S.legacy, { reason: 'Recurred.' });
    const d = (await m.findings.getFindingDetail(adminA, S.legacy))!;
    expect(d.reopenings[0]).toMatchObject({ reopen_number: 1, previous_closure_reason: null, reason: 'Recurred.' });
  });
});

describe('tenant and restricted visibility', () => {
  it('another organisation cannot see, close, cancel or reopen', async () => {
    expect(await m.findings.getFindingDetail(adminB, S.f1)).toBeNull();
    expect((await m.findings.listFindings(adminB, {})).length).toBe(0);
    await expectError(m.findings.transitionFinding(adminB, S.fAud, { status: 'CANCELLED', reason: 'x' }), 'AssuranceNotFoundError');
    await expectError(m.actions.createAction(adminB, { findingIds: [S.fAud], actionType: 'CORRECTIVE', title: 'x', priority: 'LOW' }), 'AssuranceNotFoundError');
  });

  it('a finding under a restricted incident is hidden from uninvolved managers, including its actions and reopen', async () => {
    const f = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Sensitive hazard', description: 'x', incidentId: INC_R });
    const a = await m.actions.createAction(mgrA, { findingIds: [f.id], actionType: 'CORRECTIVE', title: '[TEST] Sensitive fix', priority: 'LOW' });
    expect(await m.findings.getFindingDetail(outsiderA, f.id)).toBeNull();
    expect((await m.findings.listFindings(outsiderA, {})).map(r => r.id)).not.toContain(f.id);
    expect(await m.actions.getActionDetail(outsiderA, a.id)).toBeNull();
    await expectError(m.findings.reopenFinding(outsiderA, f.id, { reason: 'x' }), 'AssuranceNotFoundError');
    // A visible finding that shares the hidden action reports "one or more" hidden open actions, never the action itself.
    const shared = await m.findings.createFinding(mgrA, { findingType: 'HAZARD', title: '[TEST] Public hazard', description: 'x' });
    await sql`INSERT INTO assurance_action_findings (organisation_id, action_id, finding_id, created_by) VALUES ('fa-org-a', ${a.id}::uuid, ${shared.id}::uuid, 'fa-a-mgr')`;
    const d = (await m.findings.getFindingDetail(outsiderA, shared.id))!;
    expect(d.actions).toHaveLength(0);
    expect(d.hiddenOpenActionCount).toBe(1);
    expect((await m.findings.listFindings(outsiderA, { view: 'underway' })).map(r => r.id)).toContain(shared.id);
  });
});
