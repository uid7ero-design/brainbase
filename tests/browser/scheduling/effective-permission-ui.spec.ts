import { test, expect } from '@playwright/test';
import { type Account, enabled, origin } from './accounts';
import { api, contextFor, createOffering, createResource, createSchedule, json, query, snapshot } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'Effective permissions do not depend on the viewport.'); });

const A = 'sched-org-a';

// Management controls must follow the EFFECTIVE permission, not the role alone: entitlement, role, the user's Scheduling access level
// (none / view / use, PR #489) and the Scheduling guard's own decision. Every account that is shown no controls must also be refused
// server-side, and every account that is shown them must be accepted: the UI and the server may never disagree.
type Outcome = 'manages' | 'view-only' | 'forbidden-page' | 'not-enabled';
const CASES: Array<[Account, Outcome, number, string]> = [
  ['manager', 'manages', 201, 'manager role, Scheduling use'],
  ['manager-view', 'view-only', 403, 'manager role, Scheduling view only'],
  ['viewer', 'view-only', 403, 'viewer role, Scheduling view'],
  ['viewer-use', 'view-only', 403, 'viewer role, Scheduling use (the role still cannot manage)'],
  ['viewer-none', 'forbidden-page', 403, 'viewer role, Scheduling none'],
  ['analyst', 'not-enabled', 403, 'analyst role, denied by the Scheduling guard'],
];

test('seed the records the effective-permission cases look at', async ({ browser }) => {
  const seed = await contextFor(browser, 'manager');
  const schedule = await createSchedule(seed.request, 'ZZ Effective UI');
  await createOffering(seed.request, schedule.id, 'ZZ Effective UI session');
  await createResource(seed.request, 'ZZ Effective UI court');
  await seed.close();
});

for (const [account, outcome, writeCode, why] of CASES) {
  test(`effective permission UI: ${account} (${why})`, async ({ browser }) => {
    const context = await contextFor(browser, account);
    try {
      const [schedule] = await query<{ id: string }>("SELECT id FROM scheduling_schedules WHERE organisation_id = $1 AND name = 'ZZ Effective UI' ORDER BY created_at DESC LIMIT 1", [A]);
      expect(schedule, 'seed record').toBeTruthy();
      const tab = await context.newPage();
      const manages = outcome === 'manages';

      if (outcome === 'forbidden-page') {
        for (const path of ['/scheduling', '/scheduling/schedules', '/scheduling/resources', `/scheduling/schedules/${schedule.id}`]) {
          expect((await tab.goto(`${origin}${path}`))?.status(), path).toBe(403);
        }
      } else if (outcome === 'not-enabled') {
        for (const path of ['/scheduling', '/scheduling/schedules', '/scheduling/resources', `/scheduling/schedules/${schedule.id}`]) {
          await tab.goto(`${origin}${path}`);
          await expect(tab.getByText('Scheduling isn’t enabled for your organisation')).toBeVisible();
          await expect(tab.getByRole('button', { name: /^(New |Add |Edit |Archive|Deactivate)/ })).toHaveCount(0);
        }
      } else {
        await tab.goto(`${origin}/scheduling/schedules`);
        await expect(tab.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
        await expect(tab.getByText('ZZ Effective UI', { exact: true }).first()).toBeVisible();
        await expect(tab.getByRole('button', { name: 'New schedule', exact: true })).toHaveCount(manages ? 1 : 0);
        await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(manages ? 0 : 1);

        await tab.goto(`${origin}/scheduling/schedules/${schedule.id}`);
        await expect(tab.getByRole('heading', { name: 'ZZ Effective UI', exact: true })).toBeVisible();
        for (const name of ['Edit schedule', 'New session']) {
          await expect(tab.getByRole('button', { name, exact: true }), name).toHaveCount(manages ? 1 : 0);
        }
        if (!manages) await expect(tab.getByRole('button', { name: /^(Archive|Deactivate|Unlink)/ }), 'destructive controls').toHaveCount(0);
        await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(manages ? 0 : 1);

        await tab.goto(`${origin}/scheduling/resources`);
        await expect(tab.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
        await expect(tab.getByRole('button', { name: /^(New resource|Add your first resource)$/ })).toHaveCount(manages ? 1 : 0);
        if (!manages) await expect(tab.getByRole('button', { name: /^(Edit|Deactivate)/ }), 'resource row controls').toHaveCount(0);

        await tab.goto(`${origin}/scheduling`);
        await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(manages ? 0 : 1);
        if (!manages) await expect(tab.getByRole('link', { name: /^(Create a schedule|Add a resource)$/ })).toHaveCount(0);
      }

      // The server decides the same thing: a write is refused exactly when the UI hid the controls.
      const before = await snapshot(A);
      const name = `ZZ Effective write ${account} ${Date.now()}`;
      const created = await context.request.post(api('/schedules'), { data: { name, presetKey: 'classes_coaching' }, headers: json });
      expect(created.status(), 'POST /schedules').toBe(writeCode);
      const resource = await context.request.post(api('/resources'), { data: { kind: 'court', name: `${name} court`, capacity: 2 }, headers: json });
      expect(resource.status(), 'POST /resources').toBe(writeCode);
      const offering = await context.request.post(api(`/schedules/${schedule.id}/offerings`), { data: { name: `${name} offering`, durationMinutes: 30, capacity: 2, priceCents: 0 }, headers: json });
      expect(offering.status(), 'POST offerings').toBe(writeCode);
      if (writeCode === 403) {
        expect(await snapshot(A), 'refused writes must change nothing').toBe(before);
        expect(await query('SELECT 1 FROM scheduling_schedules WHERE name = $1', [name])).toHaveLength(0);
      }
    } finally {
      await context.close();
    }
  });
}
