import { test, expect } from '@playwright/test';
import { type Account, enabled } from './accounts';
import { anonymousContext, api, contextFor, createOffering, createResource, createSchedule, json, query, snapshot } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'The availability API does not depend on the viewport.'); });

const A = 'sched-org-a';

// Phase 2B.3b. The availability API (weekly rules and closures) through the REAL stack: the production build, the module-access
// middleware of PR #489, the Scheduling guard, the Postgres repository and the migration-034 guards, signed in through the real login form.
// Every account must get the same answer here as it does for the rest of Scheduling (permissions.spec.ts): reads need Scheduling view,
// writes need the management permission AND Scheduling "use". Every refused request must change nothing, audit rows included.

// account -> GET availability, then POST / PATCH / DELETE.
const MATRIX: Array<[Account | 'anonymous', number, number, string]> = [
  ['manager', 200, 201, 'managed manager with Scheduling use'],
  ['manager-legacy', 200, 201, 'manager with no organisation_user_access row'],
  ['viewer', 200, 403, 'viewer with Scheduling view'],
  ['viewer-use', 200, 403, 'viewer role with Scheduling use: the role still cannot manage'],
  ['viewer-legacy', 200, 403, 'viewer with no access row'],
  ['manager-view', 200, 403, 'manager role limited to Scheduling view'],
  ['viewer-none', 403, 403, 'viewer with Scheduling none'],
  ['analyst', 403, 403, 'analyst: the Scheduling guard fails closed'],
  ['analyst-legacy', 403, 403, 'analyst with no access row'],
  ['unentitled-manager', 403, 403, 'unentitled organisation'],
  ['unentitled-legacy', 403, 403, 'unentitled organisation, no access row'],
  ['anonymous', 401, 401, 'no session'],
];

let resourceId = '';
let offeringId = '';
let seeded: { ruleId: string; ruleVersion: string; closureId: string; closureVersion: string } | null = null;

test.describe.configure({ mode: 'serial' });

test('seed: a resource and an offering, one rule and one closure created by the manager', async ({ browser }) => {
  const manager = await contextFor(browser, 'manager');
  try {
    const schedule = await createSchedule(manager.request, 'ZZ Availability', 'resource_hire');
    offeringId = (await createOffering(manager.request, schedule.id, 'ZZ Availability hire', { durationMinutes: 60 })).id;
    resourceId = (await createResource(manager.request, 'ZZ Availability court')).id;
    const rule = await manager.request.post(api(`/resources/${resourceId}/availability-rules`), { data: { dayOfWeek: 0, startTime: '08:00', endTime: '24:00', label: 'Sunday' }, headers: json });
    expect(rule.status(), await rule.text()).toBe(201);
    const closure = await manager.request.post(api(`/resources/${resourceId}/availability-exceptions`), { data: { fromDate: '2026-12-25', toDate: '2026-12-26', reason: 'Christmas' }, headers: json });
    expect(closure.status(), await closure.text()).toBe(201);
    const r = (await rule.json()).rule;
    const c = (await closure.json()).exception;
    seeded = { ruleId: r.id, ruleVersion: r.updatedAt, closureId: c.id, closureVersion: c.updatedAt };
    expect(r.endTime).toBe('24:00');
  } finally {
    await manager.close();
  }
});

MATRIX.forEach(([account, readCode, writeCode, why], index) => {
  test(`availability permission matrix: ${account} (${why})`, async ({ browser }) => {
    expect(seeded, 'seed ran').toBeTruthy();
    const context = account === 'anonymous' ? await anonymousContext(browser) : await contextFor(browser, account);
    try {
      const before = await snapshot(A);
      expect((await context.request.get(api(`/resources/${resourceId}/availability`))).status(), 'GET resource availability').toBe(readCode);
      expect((await context.request.get(api(`/offerings/${offeringId}/availability`))).status(), 'GET offering availability').toBe(readCode);

      const day = 1 + (index % 6); // a distinct weekday per account, so a permitted second manager is never an overlap
      const add = await context.request.post(api(`/resources/${resourceId}/availability-rules`), { data: { dayOfWeek: day, startTime: '09:00', endTime: '10:00', label: `ZZ ${account}` }, headers: json });
      expect(add.status(), 'POST rule').toBe(writeCode);
      const closure = await context.request.post(api(`/offerings/${offeringId}/availability-exceptions`), { data: { fromDate: `2027-0${1 + (index % 9)}-10`, toDate: `2027-0${1 + (index % 9)}-11` }, headers: json });
      expect(closure.status(), 'POST closure').toBe(writeCode);

      if (writeCode !== 201) {
        const patch = await context.request.patch(api(`/availability-rules/${seeded!.ruleId}`), { data: { expectedUpdatedAt: seeded!.ruleVersion, endTime: '23:00' }, headers: json });
        expect(patch.status(), 'PATCH rule').toBe(writeCode);
        const del = await context.request.delete(api(`/availability-rules/${seeded!.ruleId}`), { data: { expectedUpdatedAt: seeded!.ruleVersion }, headers: json });
        expect(del.status(), 'DELETE rule').toBe(writeCode);
        const patchClosure = await context.request.patch(api(`/availability-exceptions/${seeded!.closureId}`), { data: { expectedUpdatedAt: seeded!.closureVersion, reason: 'x' }, headers: json });
        expect(patchClosure.status(), 'PATCH closure').toBe(writeCode);
        const delClosure = await context.request.delete(api(`/availability-exceptions/${seeded!.closureId}`), { data: { expectedUpdatedAt: seeded!.closureVersion }, headers: json });
        expect(delClosure.status(), 'DELETE closure').toBe(writeCode);
        expect(await snapshot(A), 'a refused request must change nothing, audit rows included').toBe(before);
        expect(add.headers()['content-type'] ?? '').toContain('application/json');
        expect(add.headers()['cache-control'] ?? '').toContain('no-store');
      } else {
        const rows = await query<{ organisation_id: string }>("SELECT organisation_id FROM scheduling_availability_rules WHERE label = $1", [`ZZ ${account}`]);
        expect(rows).toHaveLength(1);
        expect(rows[0].organisation_id).toBe(A); // the session's organisation and nothing else
      }
    } finally {
      await context.close();
    }
  });
});

test('another organisation\'s manager cannot see or change these rows (404, nothing changes)', async ({ browser }) => {
  expect(seeded, 'seed ran').toBeTruthy();
  const foreign = await contextFor(browser, 'foreign-manager');
  try {
    const before = await snapshot(A);
    const get = await foreign.request.get(api(`/resources/${resourceId}/availability`));
    expect(get.status()).toBe(404);
    expect((await foreign.request.post(api(`/resources/${resourceId}/availability-rules`), { data: { dayOfWeek: 6, startTime: '09:00', endTime: '10:00' }, headers: json })).status()).toBe(404);
    expect((await foreign.request.post(api(`/offerings/${offeringId}/availability-exceptions`), { data: { fromDate: '2027-05-01', toDate: '2027-05-01' }, headers: json })).status()).toBe(404);
    expect((await foreign.request.patch(api(`/availability-rules/${seeded!.ruleId}`), { data: { expectedUpdatedAt: seeded!.ruleVersion, endTime: '23:00' }, headers: json })).status()).toBe(404);
    expect((await foreign.request.delete(api(`/availability-rules/${seeded!.ruleId}`), { data: { expectedUpdatedAt: seeded!.ruleVersion }, headers: json })).status()).toBe(404);
    expect((await foreign.request.delete(api(`/availability-exceptions/${seeded!.closureId}`), { data: { expectedUpdatedAt: seeded!.closureVersion }, headers: json })).status()).toBe(404);
    expect(JSON.stringify(await get.json())).not.toMatch(/ZZ Availability|Sunday|Christmas/);
    expect(await snapshot(A)).toBe(before);
  } finally {
    await foreign.close();
  }
});

test('the manager flow through the real stack: overlap, stale write, 24:00, closure overlap, removal, and exactly one audit entry per success', async ({ browser }) => {
  const manager = await contextFor(browser, 'manager');
  try {
    const resource = (await createResource(manager.request, 'ZZ Availability flow court')).id;
    const base = api(`/resources/${resource}`);
    const post = (path: string, data: unknown) => manager.request.post(`${base}${path}`, { data, headers: json });
    const auditCount = async () => (await query<{ n: string }>("SELECT count(*)::text AS n FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.availability_%'", [A]))[0].n;
    const start = Number(await auditCount());

    const first = await post('/availability-rules', { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' });
    expect(first.status()).toBe(201);
    const rule = (await first.json()).rule;
    const overlap = await post('/availability-rules', { dayOfWeek: 2, startTime: '11:00', endTime: '13:00' });
    expect([overlap.status(), (await overlap.json()).code]).toEqual([409, 'OVERLAP']);
    expect((await post('/availability-rules', { dayOfWeek: 2, startTime: '12:00', endTime: '24:00' })).status(), 'touching, to end of day').toBe(201);
    expect((await post('/availability-rules', { dayOfWeek: 3, startTime: '25:00', endTime: '26:00' })).status()).toBe(400);

    const edit = await manager.request.patch(api(`/availability-rules/${rule.id}`), { data: { expectedUpdatedAt: rule.updatedAt, label: 'Morning' }, headers: json });
    expect(edit.status()).toBe(200);
    const stale = await manager.request.patch(api(`/availability-rules/${rule.id}`), { data: { expectedUpdatedAt: rule.updatedAt, label: 'Stale' }, headers: json });
    expect([stale.status(), (await stale.json()).code]).toEqual([409, 'STALE_WRITE']);
    expect((await query<{ label: string }>('SELECT label FROM scheduling_availability_rules WHERE id = $1', [rule.id]))[0].label).toBe('Morning');

    expect((await post('/availability-exceptions', { fromDate: '2026-12-24', toDate: '2026-12-26' })).status()).toBe(201);
    const clash = await post('/availability-exceptions', { fromDate: '2026-12-26', toDate: '2026-12-28' });
    expect([clash.status(), (await clash.json()).code]).toEqual([409, 'OVERLAP']);
    expect((await post('/availability-exceptions', { fromDate: '2027-01-01', toDate: '2027-01-01', kind: 'override' })).status(), 'override not available yet').toBe(400);

    const current = (await (await edit.json()).rule) as { id: string; updatedAt: string };
    const gone = await manager.request.delete(api(`/availability-rules/${current.id}`), { data: { expectedUpdatedAt: current.updatedAt }, headers: json });
    expect(gone.status()).toBe(200);
    // successes: 2 rules created + 1 edited + 1 closure created + 1 rule deleted = 5, plus 1 for the zone the owner's first rule pinned (migration 036); every refusal above wrote no audit entry
    expect(Number(await auditCount()) - start).toBe(6);
  } finally {
    await manager.close();
  }
});

test('availability never creates a reservation, occurrence or resource hold, and the pilot-shaped tables other than availability are untouched by reads', async ({ browser }) => {
  const viewer = await contextFor(browser, 'viewer');
  try {
    const counts = async () => (await query<{ n: string }>("SELECT (SELECT count(*) FROM scheduling_reservations WHERE organisation_id = $1) + (SELECT count(*) FROM scheduling_occurrences WHERE organisation_id = $1) + (SELECT count(*) FROM scheduling_resource_holds WHERE organisation_id = $1) AS n", [A]))[0].n;
    expect(await counts()).toBe('0');
    const before = await snapshot(A);
    for (let i = 0; i < 3; i++) {
      expect((await viewer.request.get(api(`/resources/${resourceId}/availability`))).status()).toBe(200);
      expect((await viewer.request.get(api(`/offerings/${offeringId}/availability`))).status()).toBe(200);
    }
    expect(await snapshot(A), 'reading availability changes nothing').toBe(before);
    expect(await counts()).toBe('0');
  } finally {
    await viewer.close();
  }
});
