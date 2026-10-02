// BrainBase Assurance — Deadlines (timeframes, extensions, escalations): real-Postgres proof.
// Run ONLY via scripts/tests/verify-assurance-deadlines.sh (disposable postgres:17 with the
// real A0.1B..A0.1E-1 migrations applied).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('assuranceDeadlines.integration.test.ts requires DATABASE_URL (see verify-assurance-deadlines.sh).');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com|vercel/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted database. Disposable local Postgres only.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const sql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: sql }));

type Mods = {
  dl: typeof import('@/lib/assurance/deadlines');
  rules: typeof import('@/lib/assurance/deadlineRules');
  domain: typeof import('@/lib/assurance/domain');
  incidents: typeof import('@/lib/assurance/incidents');
  findings: typeof import('@/lib/assurance/findings');
  actions: typeof import('@/lib/assurance/actions');
  dashboard: typeof import('@/lib/assurance/dashboard');
};
let m: Mods;

import type { AssuranceViewer } from '@/lib/assurance/policy';
const V = (organisationId: string, userId: string, role: AssuranceViewer['role']): AssuranceViewer => ({
  organisationId, userId, role, canViewAllRestricted: role === 'admin' || role === 'super_admin',
});
const adminA = V('dl-org-a', 'dl-a-admin', 'admin');
const admin2A = V('dl-org-a', 'dl-a-admin2', 'admin');
const superA = V('dl-org-a', 'dl-a-super', 'super_admin');
const mgrA = V('dl-org-a', 'dl-a-mgr', 'manager');
const mgr2A = V('dl-org-a', 'dl-a-mgr2', 'manager');
const viewerA = V('dl-org-a', 'dl-a-viewer', 'viewer');
const adminB = V('dl-org-b', 'dl-b-admin', 'admin');

const DAY = 24 * 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();

async function expectError(p: Promise<unknown>, cls: string, msg?: RegExp): Promise<Error> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught, `expected ${cls}`).toBeTruthy();
  expect((caught as Error).name, (caught as Error).message).toBe(cls);
  if (msg) expect((caught as Error).message).toMatch(msg);
  return caught as Error;
}

async function tf(id: string) {
  const [r] = await sql`SELECT id, status, original_due_at, current_due_at, updated_at FROM assurance_timeframes WHERE id = ${id}::uuid` as
    { id: string; status: string; original_due_at: Date; current_due_at: Date; updated_at: Date }[];
  return r;
}
async function timeframeFor(kind: 'finding' | 'action', id: string) {
  const [r] = await sql.raw(`SELECT id, timeframe_type FROM assurance_timeframes WHERE ${kind}_id = '${id}'`) as { id: string; timeframe_type: string }[];
  return r;
}
async function audits(resourceType: string, resourceId?: string) {
  return await sql`SELECT action, user_id, resource_id, before_state, after_state FROM audit_logs
    WHERE resource_type = ${resourceType} AND (${resourceId ?? null}::text IS NULL OR resource_id = ${resourceId ?? null}::text)
    ORDER BY created_at, id` as { action: string; user_id: string; resource_id: string; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }[];
}
const ext = async (id: string) => (await sql`SELECT * FROM assurance_timeframe_extensions WHERE id = ${id}::uuid`)[0] as Record<string, unknown>;
const esc = async (id: string) => (await sql`SELECT * FROM assurance_escalations WHERE id = ${id}::uuid`)[0] as Record<string, unknown>;

const S: Record<string, string> = {};

async function makeFinding(viewer: AssuranceViewer, title: string, dueMs: number | null, incidentId = S.incident) {
  const r = await m.findings.createFinding(viewer, {
    incidentId, findingType: 'HAZARD', title, description: 'Synthetic.', ...(dueMs !== null ? { dueAt: iso(dueMs) } : {}),
  });
  return r.id;
}
async function makeAction(viewer: AssuranceViewer, findingId: string, title: string, dueMs: number | null, extra: Record<string, unknown> = {}) {
  const r = await m.actions.createAction(viewer, {
    findingIds: [findingId], actionType: 'CORRECTIVE', title, ...(dueMs !== null ? { dueAt: iso(dueMs) } : {}), ...extra,
  });
  return r.id;
}

beforeAll(async () => {
  await sql.raw(`
    INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES
      ('dl-org-a', 'Deadline Org A', 'dl-org-a', now(), NULL), ('dl-org-b', 'Deadline Org B', 'dl-org-b', now(), 'Australia/Sydney');
    INSERT INTO users (id, organisation_id, username, name, role, status, updated_at) VALUES
      ('dl-a-admin', 'dl-org-a', 'dl-a-admin', 'Ada Admin', 'ADMIN', 'ACTIVE', now()),
      ('dl-a-admin2', 'dl-org-a', 'dl-a-admin2', 'Abe Admin', 'ADMIN', 'ACTIVE', now()),
      ('dl-a-super', 'dl-org-a', 'dl-a-super', 'Sam Super', 'SUPER_ADMIN', 'ACTIVE', now()),
      ('dl-a-mgr', 'dl-org-a', 'dl-a-mgr', 'Mia Manager', 'MANAGER', 'ACTIVE', now()),
      ('dl-a-mgr2', 'dl-org-a', 'dl-a-mgr2', 'Max Manager', 'MANAGER', 'ACTIVE', now()),
      ('dl-a-viewer', 'dl-org-a', 'dl-a-viewer', 'Val Viewer', 'VIEWER', 'ACTIVE', now()),
      ('dl-b-admin', 'dl-org-b', 'dl-b-admin', 'Bo Admin', 'ADMIN', 'ACTIVE', now());
  `);
  m = {
    dl: await import('@/lib/assurance/deadlines'),
    rules: await import('@/lib/assurance/deadlineRules'),
    domain: await import('@/lib/assurance/domain'),
    incidents: await import('@/lib/assurance/incidents'),
    findings: await import('@/lib/assurance/findings'),
    actions: await import('@/lib/assurance/actions'),
    dashboard: await import('@/lib/assurance/dashboard'),
  };
  const now = Date.now();
  S.incident = (await m.incidents.createIncident(mgrA, { title: 'DL incident', description: 'd', category: 'OTHER', occurredAt: iso(now - 3600e3) })).id;
  S.restrictedIncident = (await m.incidents.createIncident(adminA, { title: 'DL restricted', description: 'd', category: 'OTHER', occurredAt: iso(now - 3600e3), restricted: true })).id;
  S.findingDue = await makeFinding(mgrA, '[TEST] finding with due date', now + 20 * DAY);
  S.findingNoDue = await makeFinding(mgrA, '[TEST] finding without due date', null);
  S.actionDue = await makeAction(mgrA, S.findingDue, '[TEST] action with due date', now + 10 * DAY);
  S.findingSoon = await makeFinding(mgrA, '[TEST] finding due soon', now + 1 * DAY);
  S.actionOverdue = await makeAction(mgrA, S.findingSoon, '[TEST] action overdue', null);
  // A legitimately past synthetic deadline (the create path validates format, not "future"):
  await sql`INSERT INTO assurance_timeframes (organisation_id, action_id, timeframe_type, original_due_at, current_due_at, created_by)
            VALUES ('dl-org-a', ${S.actionOverdue}::uuid, 'ACTION', ${iso(now - 2 * DAY)}::timestamptz, ${iso(now - 2 * DAY)}::timestamptz, 'dl-a-mgr')`;
  S.findingRestricted = await makeFinding(adminA, '[TEST] restricted finding', now + 5 * DAY, S.restrictedIncident);
  const bInc = (await m.incidents.createIncident(adminB, { title: 'B incident', description: 'd', category: 'OTHER', occurredAt: iso(now - 3600e3) })).id;
  S.findingB = (await m.findings.createFinding(adminB, { incidentId: bInc, findingType: 'HAZARD', title: 'B secret finding', description: 'd', dueAt: iso(now + 9 * DAY) })).id;
  for (const [k, kind, id] of [['tfFinding', 'finding', S.findingDue], ['tfAction', 'action', S.actionDue], ['tfSoon', 'finding', S.findingSoon],
    ['tfOverdue', 'action', S.actionOverdue], ['tfRestricted', 'finding', S.findingRestricted], ['tfB', 'finding', S.findingB]] as const) {
    S[k] = (await timeframeFor(kind, id)).id;
  }
});

afterAll(async () => { await sql.end(); });

describe('creation paths (regression)', () => {
  it('a finding due date still creates a CLOSURE timeframe; an action due date an ACTION timeframe; original = current', async () => {
    expect((await timeframeFor('finding', S.findingDue)).timeframe_type).toBe('CLOSURE');
    expect((await timeframeFor('action', S.actionDue)).timeframe_type).toBe('ACTION');
    const t = await tf(S.tfFinding);
    expect(t.status).toBe('ACTIVE');
    expect(t.original_due_at.getTime()).toBe(t.current_due_at.getTime());
    expect(await timeframeFor('finding', S.findingNoDue)).toBeUndefined();
  });
});

describe('deadline list', () => {
  it('open view: org-scoped, visibility-filtered, ordered by due date, with overdue / due-soon derived', async () => {
    const rows = await m.dl.listDeadlines(mgrA);
    const ids = rows.map(r => r.id);
    expect(ids).toEqual([S.tfOverdue, S.tfSoon, S.tfAction, S.tfFinding]);
    expect(ids).not.toContain(S.tfB);
    expect(ids).not.toContain(S.tfRestricted); // restricted finding hidden from a manager
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(by[S.tfOverdue]).toMatchObject({ overdue: true, due_soon: false, open: true, record_kind: 'action', status: 'ACTIVE' });
    expect(by[S.tfSoon]).toMatchObject({ overdue: false, due_soon: true, record_kind: 'finding', timeframe_type: 'CLOSURE' });
    expect(by[S.tfAction]).toMatchObject({ overdue: false, due_soon: false, record_reference: expect.stringMatching(/^ACT-/) });
    expect((await m.dl.listDeadlines(adminA)).map(r => r.id)).toContain(S.tfRestricted);
    expect((await m.dl.listDeadlines(adminB)).map(r => r.id)).toEqual([S.tfB]);
  });
  it('filters: overdue, due_soon, kind, type, search', async () => {
    expect((await m.dl.listDeadlines(mgrA, { view: 'overdue' })).map(r => r.id)).toEqual([S.tfOverdue]);
    expect((await m.dl.listDeadlines(mgrA, { view: 'due_soon' })).map(r => r.id)).toEqual([S.tfSoon]);
    expect((await m.dl.listDeadlines(mgrA, { kind: 'action' })).map(r => r.record_kind)).toEqual(['action', 'action']);
    expect((await m.dl.listDeadlines(mgrA, { timeframeType: 'CLOSURE' })).every(r => r.timeframe_type === 'CLOSURE')).toBe(true);
    expect((await m.dl.listDeadlines(mgrA, { q: 'due soon' })).map(r => r.id)).toEqual([S.tfSoon]);
    expect(await m.dl.listDeadlines(mgrA, { timeframeType: "x'; DROP TABLE x;--" })).toHaveLength(4); // ignored, not injected
  });
  it('uses the dashboard\'s exact overdue / due-soon definitions', async () => {
    const dash = await m.dashboard.getDashboardData(mgrA);
    expect(dash.counts.overdue_actions).toBe(1);
    expect(dash.counts.overdue_findings).toBe(0);
    const attention = dash.attention.map(r => r.id);
    expect(attention).toEqual(expect.arrayContaining([S.actionOverdue, S.findingSoon]));
    // Deadlines' overdue + due-soon set is exactly the dashboard's needs-attention set.
    const dl = (await m.dl.listDeadlines(mgrA)).filter(r => r.overdue || r.due_soon).map(r => r.record_id);
    expect([...dl].sort()).toEqual([...attention].sort());
  });
  it('record view lists timeframes with history; hidden / foreign records yield nothing', async () => {
    const t = await m.dl.listRecordTimeframes(mgrA, 'finding', S.findingDue);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: S.tfFinding, open: true, extensions: [], escalations: [] });
    expect(await m.dl.listRecordTimeframes(mgrA, 'finding', S.findingRestricted)).toEqual([]);
    expect(await m.dl.listRecordTimeframes(adminA, 'finding', S.findingB)).toEqual([]);
    expect(await m.dl.listRecordTimeframes(mgrA, 'finding', 'not-a-uuid')).toEqual([]);
  });
  it('timezone: the explicit Australia/Adelaide convention (never the server UTC); DST boundary renders the local calendar date', async () => {
    expect(await m.dl.getAssuranceTimeZone('dl-org-a')).toBe('Australia/Adelaide');
    // The per-organisation timezone column is Platform Phase F.2A schema only and deliberately not read yet:
    expect(await m.dl.getAssuranceTimeZone('dl-org-b')).toBe('Australia/Adelaide');
    expect(m.rules.safeTimeZone('Mars/Olympus')).toBe('Australia/Adelaide');
    // Adelaide DST starts 2026-10-04 02:00 (+09:30 → +10:30). 23:59 local on each side of it:
    const before = '2026-10-03T23:59:00+09:30', after = '2026-10-04T23:59:00+10:30';
    expect(m.domain.formatAssuranceDate(before, 'Australia/Adelaide')).toBe('3 Oct 2026');
    expect(m.domain.formatAssuranceDate(after, 'Australia/Adelaide')).toBe('4 Oct 2026');
    expect(m.domain.formatAssuranceDateTime(after, 'Australia/Adelaide')).toMatch(/4 Oct 2026.*11:59/);
    // The same instants in UTC would read as different calendar days — exactly the bug a timeZone avoids:
    expect(m.domain.formatAssuranceDate(before, 'UTC')).toBe('3 Oct 2026');
    expect(m.domain.formatAssuranceDate(after, 'UTC')).toBe('4 Oct 2026');
    expect(m.domain.formatAssuranceDate('2026-10-04T00:30:00+09:30', 'UTC')).toBe('3 Oct 2026');
    expect(m.domain.formatAssuranceDate('2026-10-04T00:30:00+09:30', 'Australia/Adelaide')).toBe('4 Oct 2026');
  });
});

describe('extension request', () => {
  it('validates: permission, later + future date, reason, open, foreign / hidden ids', async () => {
    const t0 = await tf(S.tfFinding);
    const later = iso(t0.current_due_at.getTime() + 7 * DAY);
    await expectError(m.dl.requestExtension(viewerA, S.tfFinding, { requestedDueAt: later, reason: 'r' }), 'AssuranceForbiddenError');
    await expectError(m.dl.requestExtension(mgrA, S.tfFinding, { requestedDueAt: 'not a date', reason: 'r' }), 'AssuranceValidationError', /valid date/);
    await expectError(m.dl.requestExtension(mgrA, S.tfFinding, { requestedDueAt: later, reason: '   ' }), 'AssuranceValidationError', /Reason is required/);
    await expectError(m.dl.requestExtension(mgrA, S.tfFinding, { requestedDueAt: iso(t0.current_due_at.getTime() - DAY), reason: 'r' }), 'AssuranceValidationError', /later than the current/);
    await expectError(m.dl.requestExtension(mgrA, S.tfOverdue, { requestedDueAt: iso(Date.now() - 3600e3), reason: 'r' }), 'AssuranceValidationError', /in the future/);
    await expectError(m.dl.requestExtension(adminA, S.tfB, { requestedDueAt: later, reason: 'r' }), 'AssuranceNotFoundError');
    await expectError(m.dl.requestExtension(mgrA, S.tfRestricted, { requestedDueAt: later, reason: 'r' }), 'AssuranceNotFoundError');
    await expectError(m.dl.requestExtension(mgrA, 'nope', { requestedDueAt: later, reason: 'r' }), 'AssuranceNotFoundError');
    expect((await sql`SELECT count(*)::int AS n FROM assurance_timeframe_extensions`)[0].n).toBe(0);
  });
  it('creates a PENDING request without changing the effective due date; audited; client cannot forge actor/org', async () => {
    const t0 = await tf(S.tfFinding);
    const requested = iso(t0.current_due_at.getTime() + 7 * DAY);
    const r = await m.dl.requestExtension(mgrA, S.tfFinding, { requestedDueAt: requested, reason: 'Waiting on a contractor quote.', requestedBy: 'dl-a-admin', organisationId: 'dl-org-b' });
    S.ext1 = r.id;
    const e = await ext(r.id);
    expect(e).toMatchObject({ status: 'PENDING', requested_by: 'dl-a-mgr', organisation_id: 'dl-org-a', reason: 'Waiting on a contractor quote.', approved_due_at: null });
    expect((e.previous_due_at as Date).getTime()).toBe(t0.current_due_at.getTime());
    const t1 = await tf(S.tfFinding);
    expect(t1.current_due_at.getTime()).toBe(t0.current_due_at.getTime());
    expect(t1.updated_at.getTime()).toBe(t0.updated_at.getTime());
    const [a] = await audits('assurance_timeframe', S.tfFinding);
    expect(a.action).toBe('assurance_timeframe.extension_requested');
    expect(a.after_state).toMatchObject({ extension_id: r.id, status: 'PENDING', record_type: 'finding', timeframe_type: 'CLOSURE' });
    expect(JSON.stringify(a.after_state)).not.toContain('contractor quote'); // free text stays on the history row
    expect((await m.dl.listDeadlines(mgrA, { view: 'pending' })).map(x => x.id)).toEqual([S.tfFinding]);
  });
  it('only one PENDING request per deadline, including under a concurrent race', async () => {
    const t0 = await tf(S.tfFinding);
    await expectError(m.dl.requestExtension(mgr2A, S.tfFinding, { requestedDueAt: iso(t0.current_due_at.getTime() + 9 * DAY), reason: 'again' }), 'AssuranceConflictError', /already waiting/);
    const t1 = await tf(S.tfAction);
    const results = await Promise.allSettled([
      m.dl.requestExtension(mgrA, S.tfAction, { requestedDueAt: iso(t1.current_due_at.getTime() + 2 * DAY), reason: 'race A' }),
      m.dl.requestExtension(mgr2A, S.tfAction, { requestedDueAt: iso(t1.current_due_at.getTime() + 3 * DAY), reason: 'race B' }),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find(x => x.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect((await sql`SELECT count(*)::int AS n FROM assurance_timeframe_extensions WHERE timeframe_id = ${S.tfAction}::uuid AND status = 'PENDING'`)[0].n).toBe(1);
    S.extRace = ((results.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value).id;
  });
});

describe('extension decisions', () => {
  it('managers cannot decide; the requester cannot decide their own request', async () => {
    await expectError(m.dl.decideExtension(mgr2A, S.ext1, {}, 'approve'), 'AssuranceForbiddenError', /organisation admins/);
    const own = await m.dl.requestExtension(adminA, S.tfSoon, { requestedDueAt: iso(Date.now() + 6 * DAY), reason: 'Admin asks.' });
    await expectError(m.dl.decideExtension(adminA, own.id, {}, 'approve'), 'AssuranceForbiddenError', /your own/);
    await expectError(m.dl.decideExtension(adminA, own.id, { notes: 'no' }, 'reject'), 'AssuranceForbiddenError', /your own/);
    S.extOwn = own.id;
  });
  it('reject: needs a reason; due date unchanged; request kept in history; audited', async () => {
    const t0 = await tf(S.tfFinding);
    await expectError(m.dl.decideExtension(adminA, S.ext1, { notes: '' }, 'reject'), 'AssuranceValidationError', /Reason for rejecting/);
    await m.dl.decideExtension(adminA, S.ext1, { notes: 'Quote is not a blocker.' }, 'reject');
    expect(await ext(S.ext1)).toMatchObject({ status: 'REJECTED', decided_by: 'dl-a-admin', decision_notes: 'Quote is not a blocker.', approved_due_at: null });
    const t1 = await tf(S.tfFinding);
    expect(t1.current_due_at.getTime()).toBe(t0.current_due_at.getTime());
    expect(t1.original_due_at.getTime()).toBe(t0.original_due_at.getTime());
    expect((await audits('assurance_timeframe', S.tfFinding)).at(-1)!.action).toBe('assurance_timeframe.extension_rejected');
    await expectError(m.dl.decideExtension(admin2A, S.ext1, {}, 'approve'), 'AssuranceConflictError', /already been rejected/);
  });
  it('approve: effective due date moves to the requested date; original never changes; history retained; audited with before/after', async () => {
    const t0 = await tf(S.tfFinding);
    const requested = t0.current_due_at.getTime() + 14 * DAY;
    S.ext2 = (await m.dl.requestExtension(mgr2A, S.tfFinding, { requestedDueAt: iso(requested), reason: 'Parts delayed.' })).id;
    await m.dl.decideExtension(adminA, S.ext2, { notes: 'Agreed.' }, 'approve');
    const t1 = await tf(S.tfFinding);
    expect(t1.current_due_at.getTime()).toBe(requested);
    expect(t1.original_due_at.getTime()).toBe(t0.original_due_at.getTime());
    expect(t1.status).toBe('ACTIVE');
    const e = await ext(S.ext2);
    expect(e).toMatchObject({ status: 'APPROVED', decided_by: 'dl-a-admin', decision_notes: 'Agreed.' });
    expect((e.approved_due_at as Date).getTime()).toBe(requested);
    const a = (await audits('assurance_timeframe', S.tfFinding)).at(-1)!;
    expect(a.action).toBe('assurance_timeframe.extension_approved');
    expect(new Date(a.before_state!.current_due_at as string).getTime()).toBe(t0.current_due_at.getTime());
    expect(new Date(a.after_state!.current_due_at as string).getTime()).toBe(requested);
    expect(new Date(a.after_state!.original_due_at as string).getTime()).toBe(t0.original_due_at.getTime());
    const hist = (await m.dl.listRecordTimeframes(mgrA, 'finding', S.findingDue))[0].extensions;
    expect(hist.map(h => h.status)).toEqual(['APPROVED', 'REJECTED']);
    expect(hist[1].reason).toBe('Waiting on a contractor quote.');
    expect((await m.dl.listDeadlines(mgrA, { view: 'extended' })).map(x => x.id)).toEqual([S.tfFinding]);
  });
  it('the DB still refuses any change to original_due_at', async () => {
    await expect(sql`UPDATE assurance_timeframes SET original_due_at = now() WHERE id = ${S.tfFinding}::uuid`).rejects.toThrow();
  });
  it('approver may choose a different later date, never an earlier-or-equal one', async () => {
    const t0 = await tf(S.tfAction);
    await expectError(m.dl.decideExtension(adminA, S.extRace, { approvedDueAt: iso(t0.current_due_at.getTime()) }, 'approve'), 'AssuranceValidationError', /later than the current/);
    const chosen = t0.current_due_at.getTime() + DAY;
    await m.dl.decideExtension(adminA, S.extRace, { approvedDueAt: iso(chosen) }, 'approve');
    expect((await tf(S.tfAction)).current_due_at.getTime()).toBe(chosen);
  });
  it('a stale request (deadline changed since it was made) cannot be approved', async () => {
    const t0 = await tf(S.tfSoon);
    // simulate the deadline moving under the pending request (another approved extension path)
    await sql`UPDATE assurance_timeframes SET current_due_at = current_due_at + interval '1 day' WHERE id = ${S.tfSoon}::uuid`;
    await expectError(m.dl.decideExtension(admin2A, S.extOwn, {}, 'approve'), 'AssuranceConflictError', /deadline has changed since this request/);
    await sql`UPDATE assurance_timeframes SET current_due_at = ${t0.current_due_at} WHERE id = ${S.tfSoon}::uuid`;
  });
  it('two admins approving at once: exactly one wins, the deadline moves once', async () => {
    const results = await Promise.allSettled([
      m.dl.decideExtension(admin2A, S.extOwn, {}, 'approve'),
      m.dl.decideExtension(superA, S.extOwn, { notes: 'No.' }, 'reject'),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find(x => x.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = ${S.tfSoon} AND action IN ('assurance_timeframe.extension_approved', 'assurance_timeframe.extension_rejected')`)[0].n).toBe(1);
  });
  it('withdraw: requester or admin only; PENDING only; due date unchanged', async () => {
    const t0 = await tf(S.tfOverdue);
    const r = await m.dl.requestExtension(mgrA, S.tfOverdue, { requestedDueAt: iso(Date.now() + 4 * DAY), reason: 'Need more time.' });
    await expectError(m.dl.cancelExtension(mgr2A, r.id, {}), 'AssuranceForbiddenError', /Only the person/);
    await m.dl.cancelExtension(mgrA, r.id, {});
    expect(await ext(r.id)).toMatchObject({ status: 'CANCELLED', decided_by: 'dl-a-mgr' });
    expect((await tf(S.tfOverdue)).current_due_at.getTime()).toBe(t0.current_due_at.getTime());
    await expectError(m.dl.cancelExtension(mgrA, r.id, {}), 'AssuranceConflictError', /already been cancelled/);
    expect((await audits('assurance_timeframe', S.tfOverdue)).map(a => a.action)).toEqual(['assurance_timeframe.extension_requested', 'assurance_timeframe.extension_cancelled']);
  });
  it('foreign organisation: requests and decisions are "not found"', async () => {
    const b = await m.dl.requestExtension(adminB, S.tfB, { requestedDueAt: iso(Date.now() + 30 * DAY), reason: 'B wants more time.' });
    await expectError(m.dl.decideExtension(adminA, b.id, {}, 'approve'), 'AssuranceNotFoundError');
    await expectError(m.dl.cancelExtension(adminA, b.id, {}), 'AssuranceNotFoundError');
    expect(await ext(b.id)).toMatchObject({ status: 'PENDING' });
  });
});

describe('escalations', () => {
  it('raise: permission, level validation, assignee same-org, foreign/hidden not found; audited; deadline untouched', async () => {
    const t0 = await tf(S.tfOverdue);
    await expectError(m.dl.raiseEscalation(viewerA, S.tfOverdue, { level: 1, reason: 'r' }), 'AssuranceForbiddenError');
    for (const level of [0, 6, 1.5, 'x', null]) {
      await expectError(m.dl.raiseEscalation(mgrA, S.tfOverdue, { level, reason: 'r' }), 'AssuranceValidationError', /level/);
    }
    await expectError(m.dl.raiseEscalation(mgrA, S.tfOverdue, { level: 1, reason: '' }), 'AssuranceValidationError', /Reason/);
    await expectError(m.dl.raiseEscalation(mgrA, S.tfOverdue, { level: 1, reason: 'r', assignedUserId: 'dl-b-admin' }), 'AssuranceValidationError', /Assigned to/);
    await expectError(m.dl.raiseEscalation(adminA, S.tfB, { level: 1, reason: 'r' }), 'AssuranceNotFoundError');
    await expectError(m.dl.raiseEscalation(mgrA, S.tfRestricted, { level: 1, reason: 'r' }), 'AssuranceNotFoundError');
    const r = await m.dl.raiseEscalation(mgrA, S.tfOverdue, { level: '1', reason: 'Needs attention from the site lead.', assignedUserId: 'dl-a-mgr2' });
    S.esc1 = r.id;
    expect(await esc(r.id)).toMatchObject({ status: 'OPEN', escalation_level: 1, escalated_by: 'dl-a-mgr', assigned_user_id: 'dl-a-mgr2', organisation_id: 'dl-org-a' });
    const [a] = await audits('assurance_escalation', r.id);
    expect(a.action).toBe('assurance_escalation.created');
    expect(a.after_state).toMatchObject({ escalation_id: r.id, level: 1, status: 'OPEN', record_type: 'action' });
    const t1 = await tf(S.tfOverdue);
    expect([t1.current_due_at.getTime(), t1.status]).toEqual([t0.current_due_at.getTime(), t0.status]);
    expect((await m.dl.listDeadlines(mgrA, { view: 'escalated' })).map(x => [x.id, x.open_escalations, x.top_open_escalation_level])).toEqual([[S.tfOverdue, 1, 1]]);
  });
  it('lifecycle OPEN → ACKNOWLEDGED → RESOLVED; invalid transitions refused; nothing else changes', async () => {
    const actionBefore = (await sql`SELECT status, updated_at FROM assurance_actions WHERE id = ${S.actionOverdue}::uuid`)[0];
    const tfBefore = await tf(S.tfOverdue);
    await expectError(m.dl.transitionEscalation(mgrA, S.esc1, {}, 'resolve'), 'AssuranceConflictError', /open cannot be resolved/);
    await m.dl.transitionEscalation(mgr2A, S.esc1, { notes: 'Seen; contractor booked.' }, 'acknowledge');
    expect(await esc(S.esc1)).toMatchObject({ status: 'ACKNOWLEDGED', acknowledged_by: 'dl-a-mgr2', notes: 'Seen; contractor booked.' });
    await expectError(m.dl.transitionEscalation(mgrA, S.esc1, {}, 'acknowledge'), 'AssuranceConflictError', /acknowledged cannot be acknowledged/);
    await m.dl.transitionEscalation(mgrA, S.esc1, {}, 'resolve');
    const e = await esc(S.esc1);
    expect(e).toMatchObject({ status: 'RESOLVED', resolved_by: 'dl-a-mgr', notes: 'Seen; contractor booked.' });
    await expectError(m.dl.transitionEscalation(mgrA, S.esc1, { notes: 'x' }, 'cancel'), 'AssuranceConflictError', /resolved cannot be cancelled/);
    // Resolution does not close the action, satisfy the deadline, or move the date.
    const actionAfter = (await sql`SELECT status, updated_at FROM assurance_actions WHERE id = ${S.actionOverdue}::uuid`)[0];
    expect(actionAfter).toEqual(actionBefore);
    const tfAfter = await tf(S.tfOverdue);
    expect([tfAfter.status, tfAfter.current_due_at.getTime(), tfAfter.updated_at.getTime()]).toEqual([tfBefore.status, tfBefore.current_due_at.getTime(), tfBefore.updated_at.getTime()]);
    expect((await m.dl.listDeadlines(mgrA, { view: 'overdue' })).map(x => x.id)).toEqual([S.tfOverdue]);
    expect((await audits('assurance_escalation', S.esc1)).map(a => a.action)).toEqual(['assurance_escalation.created', 'assurance_escalation.acknowledged', 'assurance_escalation.resolved']);
  });
  it('cancel needs a reason; OPEN → CANCELLED and ACKNOWLEDGED → CANCELLED; resolving one never closes another', async () => {
    const e2 = (await m.dl.raiseEscalation(mgrA, S.tfOverdue, { level: 2, reason: 'Second escalation.' })).id;
    const e3 = (await m.dl.raiseEscalation(mgrA, S.tfOverdue, { level: 1, reason: 'Third.' })).id;
    await expectError(m.dl.transitionEscalation(mgrA, e2, {}, 'cancel'), 'AssuranceValidationError', /Reason for cancelling/);
    await m.dl.transitionEscalation(mgrA, e2, { notes: 'Raised in error.' }, 'cancel');
    await m.dl.transitionEscalation(mgrA, e3, {}, 'acknowledge');
    expect((await esc(e2)).status).toBe('CANCELLED');
    expect((await esc(e3)).status).toBe('ACKNOWLEDGED');
    await m.dl.transitionEscalation(mgrA, e3, { notes: 'Duplicate.' }, 'cancel');
    expect((await esc(e3)).status).toBe('CANCELLED');
  });
  it('escalation transition race: exactly one wins', async () => {
    const e4 = (await m.dl.raiseEscalation(mgrA, S.tfAction, { level: 1, reason: 'Race.' })).id;
    const results = await Promise.allSettled([
      m.dl.transitionEscalation(mgrA, e4, {}, 'acknowledge'),
      m.dl.transitionEscalation(mgr2A, e4, { notes: 'Not needed.' }, 'cancel'),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find(x => x.status === 'rejected') as PromiseRejectedResult).reason as Error).name).toBe('AssuranceConflictError');
    expect((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = ${e4} AND action <> 'assurance_escalation.created'`)[0].n).toBe(1);
  });
  it('foreign escalation: transitions are "not found"', async () => {
    const b = (await m.dl.raiseEscalation(adminB, S.tfB, { level: 1, reason: 'B.' })).id;
    for (const tr of ['acknowledge', 'resolve', 'cancel'] as const) {
      await expectError(m.dl.transitionEscalation(adminA, b, { notes: 'x' }, tr), 'AssuranceNotFoundError');
    }
    expect((await esc(b)).status).toBe('OPEN');
    expect((await m.dl.listRecordTimeframes(adminA, 'finding', S.findingB))).toEqual([]);
  });
});

describe('closure (regression + non-propagation)', () => {
  it('closing an action follows its own gates; the timeframe is untouched; the deadline leaves the open view and cannot be extended or escalated', async () => {
    const f = await makeFinding(mgrA, '[TEST] closure finding', Date.now() + 15 * DAY);
    const a = await makeAction(mgrA, f, '[TEST] closure action', Date.now() + 8 * DAY, { evidenceRequired: false, verificationRequired: false });
    const t = (await timeframeFor('action', a)).id;
    await expectError(m.actions.closeAction(mgrA, a), 'AssuranceConflictError', /cannot be closed yet/); // gates unchanged
    // an approved extension does not complete work
    const x = await m.dl.requestExtension(mgrA, t, { requestedDueAt: iso(Date.now() + 12 * DAY), reason: 'More time.' });
    await m.dl.decideExtension(adminA, x.id, {}, 'approve');
    expect((await sql`SELECT status, work_completed_at FROM assurance_actions WHERE id = ${a}::uuid`)[0]).toMatchObject({ status: 'OPEN', work_completed_at: null });
    await m.actions.startAction(mgrA, a);
    await m.actions.completeActionWork(mgrA, a);
    const before = await tf(t);
    await m.actions.closeAction(mgrA, a);
    const after = await tf(t);
    expect([after.status, after.current_due_at.getTime(), after.updated_at.getTime()]).toEqual([before.status, before.current_due_at.getTime(), before.updated_at.getTime()]);
    expect((await m.dl.listDeadlines(mgrA)).map(r => r.id)).not.toContain(t);
    expect((await m.dl.listDeadlines(mgrA, { view: 'all' })).find(r => r.id === t)).toMatchObject({ open: false, overdue: false, record_status: 'CLOSED' });
    await expectError(m.dl.requestExtension(mgrA, t, { requestedDueAt: iso(Date.now() + 40 * DAY), reason: 'x' }), 'AssuranceConflictError', /no longer open/);
    await expectError(m.dl.raiseEscalation(mgrA, t, { level: 1, reason: 'x' }), 'AssuranceConflictError', /no longer open/);
  });
  it('the service exposes no delete and no direct due-date edit', () => {
    expect(Object.keys(m.dl).filter(k => /delete|remove|purge|setDue|updateDue/i.test(k))).toEqual([]);
  });
});
