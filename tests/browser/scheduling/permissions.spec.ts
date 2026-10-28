import { test, expect } from '@playwright/test';
import { type Account, enabled, origin } from './accounts';
import { anonymousContext, api, contextFor, createOffering, createResource, createSchedule, json, query, snapshot } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'Permission behaviour does not depend on the viewport.'); });

const A = 'sched-org-a';
const C = 'sched-org-c';

// account -> expected status of GET /status, GET /schedules, POST /schedules over the real HTTP API, and what the PAGE shows.
//   A 403 from the "middleware" is the module-access layer of PR #489; a 403 from the "guard" is Scheduling's own
//   capability + role guard (lib/scheduling/access.ts). The matrix has an account for each layer on its own.
type Page = 'dashboard' | 'not-enabled' | 'forbidden' | 'login';
const MATRIX: Array<[Account | 'anonymous', number, number, number, Page, string]> = [
  ['manager', 200, 200, 201, 'dashboard', 'managed manager with Scheduling use'],
  ['manager-legacy', 200, 200, 201, 'dashboard', 'manager with no organisation_user_access row (role-only path)'],
  ['viewer', 200, 200, 403, 'dashboard', 'viewer with Scheduling view: the middleware refuses the write'],
  ['viewer-use', 200, 200, 403, 'dashboard', 'viewer role with Scheduling use: middleware allows, the Scheduling guard refuses'],
  ['viewer-legacy', 200, 200, 403, 'dashboard', 'viewer with no access row: only the Scheduling guard applies'],
  ['manager-view', 200, 200, 403, 'dashboard', 'manager role limited to Scheduling view: the middleware refuses the write'],
  ['viewer-none', 403, 403, 403, 'forbidden', 'viewer with Scheduling none: the middleware refuses everything'],
  ['analyst', 403, 403, 403, 'not-enabled', 'analyst with Scheduling use: middleware allows, the Scheduling guard fails closed'],
  ['analyst-legacy', 403, 403, 403, 'not-enabled', 'analyst with no access row: the Scheduling guard fails closed'],
  ['unentitled-manager', 403, 403, 403, 'forbidden', 'unentitled organisation, access row says use: the middleware drops the unentitled module'],
  ['unentitled-legacy', 403, 403, 403, 'not-enabled', 'unentitled organisation, no access row: the Scheduling entitlement guard'],
  ['anonymous', 401, 401, 401, 'login', 'no session'],
];

for (const [account, statusCode, listCode, writeCode, page, why] of MATRIX) {
  test(`permission matrix: ${account} (${why})`, async ({ browser }) => {
    const context = account === 'anonymous' ? await anonymousContext(browser) : await contextFor(browser, account);
    try {
      const before = await snapshot(A);
      expect((await context.request.get(api('/status'))).status(), 'GET status').toBe(statusCode);
      expect((await context.request.get(api('/schedules'))).status(), 'GET schedules').toBe(listCode);
      const name = `ZZ Matrix ${account} ${Date.now()}`;
      const write = await context.request.post(api('/schedules'), { data: { name, presetKey: 'classes_coaching' }, headers: json });
      expect(write.status(), 'POST schedules').toBe(writeCode);
      const rows = await query<{ organisation_id: string }>('SELECT id, organisation_id FROM scheduling_schedules WHERE name = $1', [name]);
      if (writeCode === 201) {
        expect(rows).toHaveLength(1);
        expect(rows[0].organisation_id).toBe(A); // the session organisation, nothing else
      } else {
        expect(rows, 'a refused write must not create a row').toHaveLength(0);
        expect(await snapshot(A), 'a refused request must change nothing').toBe(before);
        expect(write.headers()['content-type'] ?? '').toContain('application/json');
      }
      for (const read of ['/audit', '/resources']) {
        expect((await context.request.get(api(read))).status(), `GET ${read}`).toBe(listCode);
      }

      const tab = await context.newPage();
      const response = await tab.goto(`${origin}/scheduling`);
      if (page === 'login') await expect(tab).toHaveURL(/\/login/);
      else if (page === 'forbidden') expect(response?.status()).toBe(403);
      else if (page === 'not-enabled') await expect(tab.getByText('Scheduling isn’t enabled for your organisation')).toBeVisible();
      else await expect(tab.getByRole('heading', { name: 'Scheduling', exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('a viewer sees no management controls and a view-only notice; a manager does', async ({ browser }) => {
  const seed = await contextFor(browser, 'manager');
  const schedule = await createSchedule(seed.request, 'ZZ Viewer UI');
  await createOffering(seed.request, schedule.id, 'ZZ Viewer UI session');
  await createResource(seed.request, 'ZZ Viewer UI court');
  await seed.close();
  for (const [account, manages] of [['viewer', false], ['viewer-legacy', false], ['manager', true]] as const) {
    const context = await contextFor(browser, account);
    const tab = await context.newPage();
    await tab.goto(`${origin}/scheduling/schedules`);
    await expect(tab.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
    await expect(tab.getByText('ZZ Viewer UI', { exact: true }).first()).toBeVisible();
    await expect(tab.getByRole('button', { name: 'New schedule', exact: true })).toHaveCount(manages ? 1 : 0);
    await tab.goto(`${origin}/scheduling/schedules/${schedule.id}`);
    await expect(tab.getByRole('heading', { name: 'ZZ Viewer UI', exact: true })).toBeVisible();
    await expect(tab.getByRole('button', { name: 'Edit schedule', exact: true })).toHaveCount(manages ? 1 : 0);
    await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(manages ? 0 : 1);
    await tab.goto(`${origin}/scheduling/resources`);
    await expect(tab.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
    await expect(tab.getByRole('button', { name: /^(New resource|Add your first resource)$/ })).toHaveCount(manages ? 1 : 0);
    await context.close();
  }
});

test('foreign object ids reveal nothing and change nothing, in both directions', async ({ browser }) => {
  const a = await contextFor(browser, 'manager');
  const c = await contextFor(browser, 'foreign-manager');
  const foreign = { schedule: await createSchedule(c.request, 'ZZ Foreign schedule', 'classes_coaching'), resource: await createResource(c.request, 'ZZ Foreign court') };
  const foreignOffering = await createOffering(c.request, foreign.schedule.id, 'ZZ Foreign session');
  const own = { schedule: await createSchedule(a.request, 'ZZ Own schedule'), resource: await createResource(a.request, 'ZZ Own court') };
  const ownOffering = await createOffering(a.request, own.schedule.id, 'ZZ Own session');
  const beforeC = await snapshot(C);
  const beforeA = await snapshot(A, false);

  const attempts: Array<[string, string, string, object | undefined]> = [
    ['GET', `/schedules/${foreign.schedule.id}`, 'read schedule', undefined],
    ['PATCH', `/schedules/${foreign.schedule.id}`, 'edit schedule', { expectedUpdatedAt: foreign.schedule.updatedAt, name: 'hijack' }],
    ['POST', `/schedules/${foreign.schedule.id}/archive`, 'archive schedule', {}],
    ['GET', `/schedules/${foreign.schedule.id}/offerings`, 'list offerings', undefined],
    ['POST', `/schedules/${foreign.schedule.id}/offerings`, 'create offering', { name: 'hijack', durationMinutes: 60, capacity: 5 }],
    ['GET', `/offerings/${foreignOffering.id}`, 'read offering', undefined],
    ['PATCH', `/offerings/${foreignOffering.id}`, 'edit offering', { expectedUpdatedAt: foreignOffering.updatedAt, name: 'hijack' }],
    ['POST', `/offerings/${foreignOffering.id}/archive`, 'archive offering', {}],
    ['GET', `/offerings/${foreignOffering.id}/resources`, 'list links', undefined],
    ['POST', `/offerings/${foreignOffering.id}/resources`, 'link into a foreign offering', { resourceId: own.resource.id }],
    ['POST', `/offerings/${ownOffering.id}/resources`, 'link a foreign resource into an own offering', { resourceId: foreign.resource.id }],
    ['GET', `/resources/${foreign.resource.id}`, 'read resource', undefined],
    ['PATCH', `/resources/${foreign.resource.id}`, 'edit resource', { expectedUpdatedAt: foreign.resource.updatedAt, name: 'hijack' }],
    ['POST', `/resources/${foreign.resource.id}/deactivate`, 'deactivate resource', { expectedUpdatedAt: foreign.resource.updatedAt }],
    ['DELETE', `/offerings/${ownOffering.id}/resources/${foreign.resource.id}`, 'unlink a foreign resource', undefined],
  ];
  for (const [method, path, what, data] of attempts) {
    const res = await a.request.fetch(api(path), { method, data, headers: data ? json : undefined });
    const expected = what === 'unlink a foreign resource' ? [200, 404] : [404];
    expect(expected, `${what}: ${res.status()} ${await res.text()}`).toContain(res.status());
  }
  const lists = JSON.stringify([await (await a.request.get(api('/schedules'))).json(), await (await a.request.get(api('/resources'))).json()]);
  expect(lists).not.toContain(foreign.schedule.id);
  expect(lists).not.toContain(foreign.resource.id);
  expect(lists).not.toContain('ZZ Foreign');
  expect(await snapshot(C), 'the other organisation must be unchanged').toBe(beforeC);
  expect(await query('SELECT 1 FROM scheduling_offering_resources WHERE offering_id = $1', [ownOffering.id]), 'no cross-organisation link may exist').toHaveLength(0);
  // and the reverse direction
  for (const path of [`/schedules/${own.schedule.id}`, `/offerings/${ownOffering.id}`, `/resources/${own.resource.id}`]) expect((await c.request.get(api(path))).status()).toBe(404);
  expect(await snapshot(A, false), 'the first organisation must be unchanged too').toBe(beforeA);
  await a.close();
  await c.close();
});

test('the organisation can only come from the session, never from a URL, header, cookie or body', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const c = await contextFor(browser, 'foreign-manager');
  const foreign = await createSchedule(c.request, 'ZZ Override target');
  const overrides = { 'x-organisation-id': C, 'x-org-id': C, 'x-tenant-id': C, organisation_id: C };
  await context.addCookies([{ name: 'org_override', value: C, url: origin }, { name: 'organisation_id', value: C, url: origin }]);

  const list = await context.request.get(api(`/schedules?organisationId=${C}&organisation_id=${C}&org=${C}`), { headers: overrides });
  expect(list.status()).toBe(200);
  expect(JSON.stringify(await list.json())).not.toContain(foreign.id);

  const name = `ZZ Override ${Date.now()}`;
  const created = await context.request.post(api(`/schedules?organisationId=${C}`), { data: { name, presetKey: 'classes_coaching' }, headers: { ...json, ...overrides } });
  expect(created.status()).toBe(201);
  expect((await query<{ organisation_id: string }>('SELECT organisation_id FROM scheduling_schedules WHERE name = $1', [name]))[0].organisation_id).toBe(A);

  for (const field of ['organisationId', 'organisation_id', 'orgId']) {
    const refused = await context.request.post(api('/schedules'), { data: { name: `${name} body`, presetKey: 'classes_coaching', [field]: C }, headers: json });
    expect(refused.status(), field).toBe(400);
  }
  expect(await query('SELECT 1 FROM scheduling_schedules WHERE name = $1', [`${name} body`])).toHaveLength(0);
  expect((await context.request.get(api(`/schedules/${foreign.id}`), { headers: overrides })).status()).toBe(404);
  const status = await (await context.request.get(api('/status'))).json();
  expect(status.timezone).toBe('Australia/Adelaide'); // organisation A's, not C's (Australia/Perth)
  await context.close();
  await c.close();
});

test('platform-owner impersonation switches the scope, is refused for an unentitled organisation, and genuinely ends', async ({ browser }) => {
  const owner = await contextFor(browser, 'owner');
  const imp = `${origin}/api/admin/impersonate`;
  expect((await owner.request.get(api('/status'))).status(), 'the owner organisation has no Scheduling entitlement').toBe(403);

  expect((await owner.request.post(imp, { data: { orgId: A }, headers: json })).status()).toBe(200);
  const name = `ZZ Impersonated ${Date.now()}`;
  expect((await owner.request.get(api('/status'))).status()).toBe(200);
  expect((await owner.request.post(api('/schedules'), { data: { name, presetKey: 'classes_coaching' }, headers: json })).status()).toBe(201);
  expect((await query<{ organisation_id: string }>('SELECT organisation_id FROM scheduling_schedules WHERE name = $1', [name]))[0].organisation_id).toBe(A);

  await owner.request.post(imp, { data: { orgId: C }, headers: json });
  expect(JSON.stringify(await (await owner.request.get(api('/schedules'))).json())).not.toContain(name);
  expect((await (await owner.request.get(api('/status'))).json()).timezone).toBe('Australia/Perth');

  await owner.request.post(imp, { data: { orgId: 'sched-org-b' }, headers: json });
  expect((await owner.request.get(api('/status'))).status(), 'impersonating an unentitled organisation').toBe(403);
  const before = await snapshot('sched-org-b');
  expect((await owner.request.post(api('/schedules'), { data: { name: 'ZZ nope', presetKey: 'classes_coaching' }, headers: json })).status()).toBe(403);
  expect(await snapshot('sched-org-b')).toBe(before);

  expect((await owner.request.delete(imp)).status()).toBe(200);
  expect((await (await owner.request.get(imp)).json()).orgId, 'impersonation must have ended').toBeNull();
  expect((await owner.request.get(api('/status'))).status(), 'back on the unentitled home organisation').toBe(403);
  const events = await query<{ action: string }>("SELECT action FROM audit_logs WHERE action ILIKE 'impersonation%'");
  expect(events.filter(e => /started/.test(e.action)).length).toBeGreaterThanOrEqual(3);
  expect(events.filter(e => /stopped/.test(e.action)).length).toBeGreaterThanOrEqual(1);
  await owner.close();
});

test('customer-identifying audit information is returned to a manager and never to a viewer', async ({ browser }) => {
  const marker = `ZZ Identity ${Date.now()}`;
  await query(
    "INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, after_state) VALUES (gen_random_uuid()::text, $1, 'manager', 'scheduling.reservation.created', 'scheduling.reservation', $2, $3::jsonb)",
    [A, marker, JSON.stringify({ v: 1, summary: { preset_key: 'classes_coaching' }, identity: { customer_name: 'Zed Customer', customer_email: 'zed.customer@example.test', customer_phone: '0400 000 000' } })],
  );
  const seen = async (account: Account) => {
    const context = await contextFor(browser, account);
    const res = await context.request.get(api('/audit'));
    const status = res.status();
    const body = status === 200 ? await res.json() : null;
    await context.close();
    return { status, body };
  };
  for (const account of ['manager', 'manager-legacy'] as const) {
    const { status, body } = await seen(account);
    expect(status).toBe(200);
    expect(body.identity_visible).toBe(true);
    expect(body.entries.find((e: { resourceId: string }) => e.resourceId === marker).identity).toMatchObject({ customer_email: 'zed.customer@example.test' });
  }
  for (const account of ['viewer', 'viewer-legacy', 'viewer-use'] as const) {
    const { status, body } = await seen(account);
    expect(status, account).toBe(200);
    expect(body.identity_visible, account).toBe(false);
    const entry = body.entries.find((e: { resourceId: string }) => e.resourceId === marker);
    expect(entry, `${account} sees the event itself`).toBeTruthy();
    expect(entry.identity, `${account} must not receive customer identity`).toBeUndefined();
    expect(JSON.stringify(body), account).not.toMatch(/zed\.customer|Zed Customer|0400 000 000/);
  }
  for (const account of ['analyst', 'viewer-none', 'unentitled-manager'] as const) expect((await seen(account)).status, account).toBe(403);
});

test('the dashboard dialog creates a schedule as the signed-in manager and audits the actor and organisation', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const tab = await context.newPage();
  await tab.goto(`${origin}/scheduling/schedules`);
  await tab.getByRole('button', { name: 'New schedule', exact: true }).first().click();
  const dialog = tab.getByRole('dialog', { name: 'New schedule' });
  const name = `ZZ Dialog ${Date.now()}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('radio', { name: /Appointments/ }).check();
  const saved = tab.waitForResponse(r => r.url().endsWith('/api/scheduling/schedules') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create schedule', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(tab.getByText(name, { exact: true }).locator('visible=true').first()).toBeVisible(); // a table and a card list both render the row
  const [row] = await query<{ id: string; preset_key: string }>('SELECT id, preset_key FROM scheduling_schedules WHERE name = $1 AND organisation_id = $2', [name, A]);
  expect(row.preset_key).toBe('appointments');
  const [audit] = await query<{ user_id: string; organisation_id: string }>("SELECT user_id, organisation_id FROM audit_logs WHERE resource_id = $1 AND action = 'scheduling.schedule.created'", [row.id]);
  expect(audit).toMatchObject({ user_id: 'manager', organisation_id: A });
  await context.close();
});
