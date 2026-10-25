import { test, expect, type Page } from '@playwright/test';
import { enabled, origin } from './accounts';
import { api, contextFor, createOffering, createResource, createSchedule, query } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'The stale-write contract does not depend on the viewport.'); });

const STALE = 'Someone else changed this while you were editing.';

// Two REAL browser tabs (two pages of one signed-in browser context) load the same record at the same version. Tab A saves
// first; tab B then saves its stale copy. The server must answer 409 STALE_WRITE and write nothing; tab B must say so and offer
// "Reload latest"; reloading must show tab A's committed version and tab B must not have overwritten it.

async function openEdit(tab: Page, buttonName: string, dialogName: string) {
  await tab.getByRole('button', { name: buttonName, exact: true }).click();
  const dialog = tab.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}
const isPatch = (fragment: string) => (r: { url(): string; request(): { method(): string } }) => r.url().includes(fragment) && r.request().method() === 'PATCH';

test('schedule: the second tab to save gets 409 STALE_WRITE, a visible message and Reload latest', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const schedule = await createSchedule(context.request, 'ZZ Stale schedule');
  const url = `${origin}/scheduling/schedules/${schedule.id}`;
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([tabA.goto(url), tabB.goto(url)]);
  const dialogA = await openEdit(tabA, 'Edit schedule', 'Edit ZZ Stale schedule');
  const dialogB = await openEdit(tabB, 'Edit schedule', 'Edit ZZ Stale schedule');

  await dialogA.getByLabel('Name').fill('ZZ Stale schedule (tab A)');
  const savedA = tabA.waitForResponse(isPatch(`/schedules/${schedule.id}`));
  await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await savedA).status()).toBe(200);
  await expect(dialogA).toHaveCount(0);

  await dialogB.getByLabel('Name').fill('ZZ Stale schedule (tab B)');
  const savedB = tabB.waitForResponse(isPatch(`/schedules/${schedule.id}`));
  await dialogB.getByRole('button', { name: 'Save changes', exact: true }).click();
  const staleResponse = await savedB;
  expect(staleResponse.status()).toBe(409);
  expect((await staleResponse.json()).code).toBe('STALE_WRITE');
  await expect(dialogB).toBeVisible(); // not silently closed
  await expect(dialogB.getByText(STALE)).toBeVisible();
  await expect(dialogB.getByText(/your changes were not saved/)).toBeVisible();
  const reload = dialogB.getByRole('button', { name: 'Reload latest', exact: true });
  await expect(reload).toBeVisible();
  expect((await query<{ name: string }>('SELECT name FROM scheduling_schedules WHERE id = $1', [schedule.id]))[0].name, 'tab B must not overwrite tab A').toBe('ZZ Stale schedule (tab A)');

  await reload.click();
  await expect(dialogB).toHaveCount(0);
  await expect(tabB.getByRole('heading', { name: 'ZZ Stale schedule (tab A)', exact: true })).toBeVisible(); // the committed version
  expect((await query<{ name: string }>('SELECT name FROM scheduling_schedules WHERE id = $1', [schedule.id]))[0].name).toBe('ZZ Stale schedule (tab A)');

  // after reloading, tab B holds the new version and its next save succeeds
  const again = await openEdit(tabB, 'Edit schedule', 'Edit ZZ Stale schedule (tab A)');
  await again.getByLabel('Name').fill('ZZ Stale schedule (tab B, after reload)');
  const retry = tabB.waitForResponse(isPatch(`/schedules/${schedule.id}`));
  await again.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await retry).status()).toBe(200);
  expect((await query<{ name: string }>('SELECT name FROM scheduling_schedules WHERE id = $1', [schedule.id]))[0].name).toBe('ZZ Stale schedule (tab B, after reload)');
  await context.close();
});

test('offering: the second tab to save gets 409 STALE_WRITE, a visible message and Reload latest', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const schedule = await createSchedule(context.request, 'ZZ Stale offering schedule');
  const offering = await createOffering(context.request, schedule.id, 'ZZ Stale session');
  const url = `${origin}/scheduling/schedules/${schedule.id}`;
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([tabA.goto(url), tabB.goto(url)]);
  const dialogA = await openEdit(tabA, 'Edit ZZ Stale session', 'Edit ZZ Stale session');
  const dialogB = await openEdit(tabB, 'Edit ZZ Stale session', 'Edit ZZ Stale session');

  await dialogA.getByLabel('Name').fill('ZZ Stale session (tab A)');
  const savedA = tabA.waitForResponse(isPatch(`/offerings/${offering.id}`));
  await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await savedA).status()).toBe(200);
  await expect(dialogA).toHaveCount(0);

  await dialogB.getByLabel('Name').fill('ZZ Stale session (tab B)');
  const savedB = tabB.waitForResponse(isPatch(`/offerings/${offering.id}`));
  await dialogB.getByRole('button', { name: 'Save changes', exact: true }).click();
  const staleResponse = await savedB;
  expect(staleResponse.status()).toBe(409);
  expect((await staleResponse.json()).code).toBe('STALE_WRITE');
  await expect(dialogB.getByText(STALE)).toBeVisible();
  const reload = dialogB.getByRole('button', { name: 'Reload latest', exact: true });
  await expect(reload).toBeVisible();
  expect((await query<{ name: string }>('SELECT name FROM scheduling_offerings WHERE id = $1', [offering.id]))[0].name).toBe('ZZ Stale session (tab A)');
  await reload.click();
  await expect(dialogB).toHaveCount(0);
  await expect(tabB.getByText('ZZ Stale session (tab A)', { exact: true }).first()).toBeVisible();
  expect((await query<{ name: string }>('SELECT name FROM scheduling_offerings WHERE id = $1', [offering.id]))[0].name).toBe('ZZ Stale session (tab A)');
  await context.close();
});

test('resource: the second tab to save gets 409 STALE_WRITE, a visible message and Reload latest', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const resource = await createResource(context.request, 'ZZ Stale court');
  const url = `${origin}/scheduling/resources`;
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([tabA.goto(url), tabB.goto(url)]);
  const dialogA = await openEdit(tabA, 'Edit ZZ Stale court', 'Edit ZZ Stale court');
  const dialogB = await openEdit(tabB, 'Edit ZZ Stale court', 'Edit ZZ Stale court');

  await dialogA.getByLabel('Name').fill('ZZ Stale court (tab A)');
  const savedA = tabA.waitForResponse(isPatch(`/resources/${resource.id}`));
  await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await savedA).status()).toBe(200);
  await expect(dialogA).toHaveCount(0);

  await dialogB.getByLabel('Name').fill('ZZ Stale court (tab B)');
  const savedB = tabB.waitForResponse(isPatch(`/resources/${resource.id}`));
  await dialogB.getByRole('button', { name: 'Save changes', exact: true }).click();
  const staleResponse = await savedB;
  expect(staleResponse.status()).toBe(409);
  expect((await staleResponse.json()).code).toBe('STALE_WRITE');
  await expect(dialogB.getByText(STALE)).toBeVisible();
  const reload = dialogB.getByRole('button', { name: 'Reload latest', exact: true });
  await expect(reload).toBeVisible();
  expect((await query<{ name: string }>('SELECT name FROM scheduling_resources WHERE id = $1', [resource.id]))[0].name).toBe('ZZ Stale court (tab A)');
  await reload.click();
  await expect(dialogB).toHaveCount(0);
  await expect(tabB.getByText('ZZ Stale court (tab A)', { exact: true }).first()).toBeVisible();
  expect((await query<{ name: string }>('SELECT name FROM scheduling_resources WHERE id = $1', [resource.id]))[0].name).toBe('ZZ Stale court (tab A)');
  await context.close();
});

test('a stale deactivate from a second tab is refused and the resource stays active', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const resource = await createResource(context.request, 'ZZ Stale deactivate court');
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([tabA.goto(`${origin}/scheduling/resources`), tabB.goto(`${origin}/scheduling/resources`)]);
  await tabA.getByRole('button', { name: 'Edit ZZ Stale deactivate court', exact: true }).waitFor();
  await tabB.getByRole('button', { name: 'Deactivate ZZ Stale deactivate court', exact: true }).waitFor();
  // tab A edits (new version) ...
  const dialogA = await openEdit(tabA, 'Edit ZZ Stale deactivate court', 'Edit ZZ Stale deactivate court');
  await dialogA.getByLabel('Name').fill('ZZ Stale deactivate court (edited)');
  const savedA = tabA.waitForResponse(isPatch(`/resources/${resource.id}`));
  await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await savedA).status()).toBe(200);
  // ... tab B, still on the old version, tries to deactivate
  await tabB.getByRole('button', { name: 'Deactivate ZZ Stale deactivate court', exact: true }).click();
  const confirm = tabB.getByRole('dialog');
  const refused = tabB.waitForResponse(r => r.url().includes(`/resources/${resource.id}/deactivate`));
  await confirm.getByRole('button', { name: /^Deactivate/ }).last().click();
  expect((await refused).status()).toBe(409);
  await expect(confirm.getByText(STALE)).toBeVisible();
  expect((await query<{ active: boolean }>('SELECT active FROM scheduling_resources WHERE id = $1', [resource.id]))[0].active).toBe(true);
  await context.close();
});

test('the API alone also refuses a write without the version token, and writes nothing', async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const schedule = await createSchedule(context.request, 'ZZ Token schedule');
  const res = await context.request.patch(api(`/schedules/${schedule.id}`), { data: { name: 'ZZ no token' }, headers: { 'Content-Type': 'application/json' } });
  expect(res.status()).toBe(400);
  expect((await query<{ name: string }>('SELECT name FROM scheduling_schedules WHERE id = $1', [schedule.id]))[0].name).toBe('ZZ Token schedule');
  await context.close();
});
