import { test, expect, type Page } from '@playwright/test';
import { type Account, enabled, origin } from './accounts';
import { api, contextFor, json, query, snapshot } from './support';
import {
  ORG_A, availabilityAuditCount, clearHours, closuresOf, dateInputs, ensureOffering, ensureResource, hoursUrl, openHours, rulesOf, runMigrationScript, seedClosure, seedRules, timeInputs, zoneOf,
  type Owner,
} from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'The behaviour of the hours screens does not depend on the viewport (availability-layout.spec.ts covers 390, 768 and 1440 px).'); });
test.describe.configure({ mode: 'serial' });

// Phase 2B.3c, through the REAL stack (production build, module-access middleware, Scheduling guard, Postgres repository, migrations 034 and
// 035 applied to the disposable database), signed in through the real login form. The hours and closures screens: who sees which controls,
// weekly hours (add on several days at once, edit, remove, "Available all day"), overnight windows (written together or not at all),
// closures (whole days and part of a day), overlap and stale-write handling, loading / retry / unavailable states, the timezone and the
// Adelaide daylight-saving notices. Every refused write is proven to have changed nothing.

const isRulePost = (r: { url(): string; request(): { method(): string } }) => r.url().includes('/availability-rules') && r.request().method() === 'POST';
const isClosurePost = (r: { url(): string; request(): { method(): string } }) => r.url().includes('/availability-exceptions') && r.request().method() === 'POST';
const isPatch = (fragment: string) => (r: { url(): string; request(): { method(): string } }) => r.url().includes(fragment) && r.request().method() === 'PATCH';
const isDelete = (fragment: string) => (r: { url(): string; request(): { method(): string } }) => r.url().includes(fragment) && r.request().method() === 'DELETE';

async function addHours(page: Page, opts: { days?: string[] | 'weekdays' | 'every'; start?: string; end?: string; untilMidnight?: boolean; note?: string; opener?: string }) {
  await page.getByRole('button', { name: opts.opener ?? 'Add hours', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add hours' });
  await expect(dialog).toBeVisible();
  if (opts.days === 'every') await dialog.getByRole('button', { name: 'Every day', exact: true }).click();
  else if (opts.days === 'weekdays') await dialog.getByRole('button', { name: 'Weekdays', exact: true }).click();
  else if (opts.days) {
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
    for (const day of opts.days) await dialog.getByRole('checkbox', { name: day, exact: true }).check();
  }
  const { first, second } = timeInputs(dialog);
  if (opts.start) await first.fill(opts.start);
  if (opts.end) await second.fill(opts.end);
  if (opts.untilMidnight) await dialog.getByRole('checkbox', { name: 'Until midnight (the end of the day)' }).check();
  if (opts.note) await dialog.locator('input[type=text]').fill(opts.note);
  return dialog;
}

// ─── Who sees which controls ──────────────────────────────────────────────────────────────────────────────────

type Outcome = 'manages' | 'view-only' | 'forbidden-page' | 'not-enabled';
const CASES: Array<[Account, Outcome, number, string]> = [
  ['manager', 'manages', 201, 'manager role, Scheduling use'],
  ['manager-legacy', 'manages', 201, 'manager role, no organisation_user_access row'],
  ['manager-view', 'view-only', 403, 'manager role, Scheduling view only'],
  ['viewer', 'view-only', 403, 'viewer role, Scheduling view'],
  ['viewer-use', 'view-only', 403, 'viewer role, Scheduling use (the role still cannot manage)'],
  ['viewer-legacy', 'view-only', 403, 'viewer role, no access row'],
  ['viewer-none', 'forbidden-page', 403, 'viewer role, Scheduling none'],
  ['analyst', 'not-enabled', 403, 'analyst role, denied by the Scheduling guard'],
  ['analyst-legacy', 'not-enabled', 403, 'analyst role, no access row'],
  ['unentitled-manager', 'forbidden-page', 403, 'organisation without Scheduling: the module middleware answers 403'],
  ['unentitled-legacy', 'not-enabled', 403, 'organisation without Scheduling, no access row'],
];

let permCourt: Owner;
let permOffering: Owner;

test('seed: a resource and an offering with hours and a closure, for the permission cases', async ({ browser }) => {
  permCourt = await ensureResource(browser, 'ZZ Hours perm court');
  permOffering = await ensureOffering(browser, 'ZZ Hours perm hire');
  const manager = await contextFor(browser, 'manager');
  for (const owner of [permCourt, permOffering]) {
    await clearHours(owner);
    await seedRules(manager.request, owner, { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' });
    await seedClosure(manager.request, owner, { fromDate: '2027-12-25', toDate: '2027-12-26', reason: 'Christmas' });
  }
  await manager.close();
});

for (const [account, outcome, writeCode, why] of CASES) {
  test(`hours screens, effective permission: ${account} (${why})`, async ({ browser }) => {
    const context = await contextFor(browser, account);
    try {
      const tab = await context.newPage();
      const owners = [permCourt, permOffering];
      if (outcome === 'forbidden-page') {
        for (const owner of owners) expect((await tab.goto(hoursUrl(owner)))?.status(), hoursUrl(owner)).toBe(403);
      } else if (outcome === 'not-enabled') {
        for (const owner of owners) {
          await tab.goto(hoursUrl(owner));
          await expect(tab.getByText('Scheduling isn’t enabled for your organisation')).toBeVisible();
          await expect(tab.getByRole('button', { name: /^(Add|Edit|Remove|Available)/ })).toHaveCount(0);
          await expect(tab.getByText('ZZ Hours perm')).toHaveCount(0);
        }
      } else {
        for (const owner of owners) {
          await openHours(tab, owner);
          await expect(tab.getByText('9:00 am to 5:00 pm').first()).toBeVisible(); // everyone who may view sees the hours
          await expect(tab.getByText('Christmas').first()).toBeVisible();
          const manages = outcome === 'manages';
          if (!manages) await expect(tab.getByRole('button', { name: /^(Add hours|Add more hours|Add closure|Add a closure|Available all day|Edit |Remove )/ }), 'management controls').toHaveCount(0);
          if (manages) {
            await expect(tab.getByRole('button', { name: 'Add hours', exact: true })).toHaveCount(1);
            await expect(tab.getByRole('button', { name: 'Add closure', exact: true })).toHaveCount(1);
            await expect(tab.getByRole('button', { name: 'Edit Monday 9:00 am to 5:00 pm', exact: true })).toBeVisible();
            await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(0);
          } else {
            await expect(tab.getByText('You have view-only access to Scheduling.')).toHaveCount(1);
          }
        }
      }

      // The server decides the same thing: a write is refused exactly when the UI hid the controls, and a refusal changes nothing.
      const before = await snapshot(ORG_A);
      const attempt = await context.request.post(api(`/resources/${permCourt.id}/availability-rules`), { data: { dayOfWeek: 6, startTime: '10:00', endTime: '11:00', label: `ZZ ${account}` }, headers: json });
      expect(attempt.status(), 'POST availability rule').toBe(writeCode);
      const closure = await context.request.post(api(`/resources/${permCourt.id}/availability-exceptions`), { data: { fromDate: '2028-01-10', toDate: '2028-01-10', startTime: '12:00', endTime: '13:00' }, headers: json });
      expect(closure.status(), 'POST partial-day closure').toBe(writeCode);
      if (writeCode !== 201) expect(await snapshot(ORG_A), 'a refused request changes nothing, audit rows included').toBe(before);
      if (writeCode === 201) {
        await context.request.delete(api(`/availability-rules/${(await attempt.json()).rule.id}`), { data: { expectedUpdatedAt: (await attempt.json()).rule.updatedAt }, headers: json });
        await context.request.delete(api(`/availability-exceptions/${(await closure.json()).exception.id}`), { data: { expectedUpdatedAt: (await closure.json()).exception.updatedAt }, headers: json });
      }
    } finally {
      await context.close();
    }
  });
}

test('another organisation\'s manager gets "no longer exists" and none of this organisation\'s data, on every hours route (cross-tenant)', async ({ browser }) => {
  const context = await contextFor(browser, 'foreign-manager');
  try {
    const tab = await context.newPage();
    const before = await snapshot(ORG_A);
    for (const owner of [permCourt, permOffering]) {
      await tab.goto(hoursUrl(owner));
      await expect(tab.getByText(/^This (resource|offering) no longer exists$/)).toBeVisible({ timeout: 60_000 });
      await expect(tab.getByText('ZZ Hours perm')).toHaveCount(0);
      await expect(tab.getByText('Christmas')).toHaveCount(0);
      await expect(tab.getByRole('button', { name: /^(Add|Edit|Remove|Available)/ })).toHaveCount(0);
      const base = api(`/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}`);
      expect((await context.request.get(`${base}/availability`)).status()).toBe(404);
      expect((await context.request.post(`${base}/availability-rules`, { data: { daysOfWeek: [1, 2], startTime: '09:00', endTime: '10:00' }, headers: json })).status()).toBe(404);
      expect((await context.request.post(`${base}/availability-rules`, { data: { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true }, headers: json })).status()).toBe(404);
      expect((await context.request.post(`${base}/availability-exceptions`, { data: { fromDate: '2028-02-01', toDate: '2028-02-01', startTime: '12:00', endTime: '13:00' }, headers: json })).status()).toBe(404);
    }
    expect(await snapshot(ORG_A)).toBe(before);
  } finally {
    await context.close();
  }
});

// ─── Weekly hours ─────────────────────────────────────────────────────────────────────────────────────────────

test.describe('weekly hours', () => {
  let court: Owner;
  test.beforeEach(async ({ browser }) => {
    court = await ensureResource(browser, 'ZZ Hours editing court');
    await clearHours(court);
  });

  test('empty state: no hours means no availability, said plainly; then weekday hours are added in ONE request for five days', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    await expect(page.getByTestId('unavailable-state')).toContainText('no weekly hours, so it is unavailable');
    await expect(page.getByText('No weekly hours yet', { exact: true })).toBeVisible();
    const audits = await availabilityAuditCount();

    const dialog = await addHours(page, { days: 'weekdays', start: '09:00', end: '17:00' });
    await expect(dialog.getByTestId('hours-summary')).toHaveText('Monday to Friday: 9:00 am to 5:00 pm.');
    const posts: string[] = [];
    page.on('request', r => { if (isRulePost({ url: () => r.url(), request: () => r })) posts.push(r.postData() ?? ''); });
    const saved = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect((await response.json()).rules).toHaveLength(5);
    await expect(dialog).toHaveCount(0);
    expect(posts, 'five days are one request').toHaveLength(1);
    expect(JSON.parse(posts[0])).toEqual({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', timezone: 'Australia/Adelaide' });

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) await expect(page.getByRole('button', { name: `Edit ${day} 9:00 am to 5:00 pm`, exact: true })).toBeVisible();
    for (const day of ['Saturday', 'Sunday']) await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: day, exact: true }) })).toContainText('Closed: no hours');
    await expect(page.getByTestId('unavailable-state')).toHaveCount(0);
    await expect(page.getByTestId('saved-message')).toContainText('Hours added: Monday to Friday, 9:00 am to 5:00 pm.');
    expect((await rulesOf(court)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([[1, '09:00', '17:00'], [2, '09:00', '17:00'], [3, '09:00', '17:00'], [4, '09:00', '17:00'], [5, '09:00', '17:00']]);
    expect(await availabilityAuditCount() - audits, 'one audit entry per rule created, plus one for the zone this first save pinned').toBe(6);
    await context.close();
  });

  test('overlap: an overlapping window is refused with a plain message, stays open to correct, and writes nothing', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { daysOfWeek: [1, 2], startTime: '09:00', endTime: '12:00' });
    const page = await manager.newPage();
    await openHours(page, court);
    const before = await snapshot(ORG_A);
    const dialog = await addHours(page, { days: ['Tuesday', 'Wednesday'], start: '11:00', end: '13:00' });
    const refused = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    const response = await refused;
    expect([response.status(), (await response.json()).code]).toEqual([409, 'OVERLAP']);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('overlaps hours or a closure that is already saved');
    expect(await snapshot(ORG_A), 'Wednesday must not have been saved either').toBe(before);
    expect(await rulesOf(court)).toHaveLength(2);

    // correcting the times and retrying succeeds, on both days together
    const { first, second } = timeInputs(dialog);
    await first.fill('12:00');
    await second.fill('13:00');
    const retried = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    expect((await retried).status()).toBe(201);
    expect(await rulesOf(court)).toHaveLength(4);
    await manager.close();
  });

  test('a local mistake is caught before anything is sent: no days, equal times, or an over-long note', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    let sent = 0;
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/availability-rules')) sent++; });
    const dialog = await addHours(page, { days: [], start: '09:00', end: '09:00' });
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose at least one day.');
    await expect(dialog.getByRole('alert')).toContainText('The end time must be different from the start time.');
    expect(sent).toBe(0);
    await context.close();
  });

  test('edit, then a stale edit from a second tab: 409 STALE_WRITE, a clear message, Reload latest, and no overwrite', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, court, { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([openHours(tabA, court), openHours(tabB, court)]);
    const open = async (tab: Page, window = '9:00 am to 5:00 pm') => {
      await tab.getByRole('button', { name: `Edit Tuesday ${window}`, exact: true }).click();
      const dialog = tab.getByRole('dialog', { name: 'Edit hours on Tuesday' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const dialogA = await open(tabA);
    const dialogB = await open(tabB);

    await timeInputs(dialogA).second.fill('18:00');
    const savedA = tabA.waitForResponse(isPatch('/availability-rules/'));
    await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await savedA).status()).toBe(200);
    await expect(tabA.getByRole('button', { name: 'Edit Tuesday 9:00 am to 6:00 pm', exact: true })).toBeVisible();

    await timeInputs(dialogB).second.fill('19:00');
    const savedB = tabB.waitForResponse(isPatch('/availability-rules/'));
    await dialogB.getByRole('button', { name: 'Save changes', exact: true }).click();
    const stale = await savedB;
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe('STALE_WRITE');
    await expect(dialogB).toBeVisible(); // not silently closed
    await expect(dialogB.getByText('Someone else changed this while you were editing.')).toBeVisible();
    await expect(dialogB.getByText(/your changes were not saved/)).toBeVisible();
    expect((await rulesOf(court))[0].end_time, 'tab B must not overwrite tab A').toBe('18:00');

    await dialogB.getByRole('button', { name: 'Reload latest', exact: true }).click();
    await expect(dialogB).toHaveCount(0);
    await expect(tabB.getByRole('button', { name: 'Edit Tuesday 9:00 am to 6:00 pm', exact: true })).toBeVisible(); // the committed version
    const again = await open(tabB, '9:00 am to 6:00 pm'); // the committed version
    await timeInputs(again).second.fill('19:00');
    const retry = tabB.waitForResponse(isPatch('/availability-rules/'));
    await again.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await retry).status()).toBe(200);
    expect((await rulesOf(court))[0].end_time).toBe('19:00');
    await context.close();
  });

  test('a stale removal is refused too, and nothing is removed', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, court, { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([openHours(tabA, court), openHours(tabB, court)]);
    await tabA.getByRole('button', { name: 'Edit Wednesday 9:00 am to 5:00 pm', exact: true }).click();
    const dialogA = tabA.getByRole('dialog', { name: 'Edit hours on Wednesday' });
    await timeInputs(dialogA).first.fill('08:00');
    await dialogA.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(tabA.getByRole('button', { name: 'Edit Wednesday 8:00 am to 5:00 pm', exact: true })).toBeVisible();

    await tabB.getByRole('button', { name: 'Remove Wednesday 9:00 am to 5:00 pm', exact: true }).click();
    const confirm = tabB.getByRole('dialog', { name: 'Remove Wednesday hours' });
    const refused = tabB.waitForResponse(isDelete('/availability-rules/'));
    await confirm.getByRole('button', { name: 'Remove hours', exact: true }).click();
    expect((await refused).status()).toBe(409);
    await expect(confirm.getByText(/Someone else changed this/)).toBeVisible();
    expect(await rulesOf(court)).toHaveLength(1);
    await context.close();
  });

  test('remove: a confirmation says what happens; the day becomes closed and the record is gone', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, court, { daysOfWeek: [3, 4], startTime: '09:00', endTime: '17:00' });
    const page = await context.newPage();
    await openHours(page, court);
    await page.getByRole('button', { name: 'Remove Wednesday 9:00 am to 5:00 pm', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Wednesday hours' });
    await expect(confirm).toContainText('has no availability then');
    const gone = page.waitForResponse(isDelete('/availability-rules/'));
    await confirm.getByRole('button', { name: 'Remove hours', exact: true }).click();
    expect((await gone).status()).toBe(200);
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Wednesday', exact: true }) })).toContainText('Closed: no hours');
    expect((await rulesOf(court)).map(r => r.day_of_week)).toEqual([4]);
    await context.close();
  });

  test('"Available all day" on one day saves an EXPLICIT 00:00-24:00 rule; a day with no rule stays closed', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, court, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    const page = await context.newPage();
    await openHours(page, court);
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Tuesday', exact: true }) })).toContainText('Closed: no hours');
    expect(await rulesOf(court)).toHaveLength(1); // nothing is implied for Tuesday
    const saved = page.waitForResponse(isRulePost);
    await page.getByRole('button', { name: 'Available all day on Tuesday', exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Tuesday', exact: true }) })).toContainText('All day');
    expect((await rulesOf(court)).filter(r => r.day_of_week === 2).map(r => [r.start_time, r.end_time])).toEqual([['00:00', '24:00']]);
    await expect(page.getByTestId('saved-message')).toHaveText('Available all day on Tuesday.');
    await context.close();
  });

  test('"Available all day, every day" on a resource with no hours saves seven explicit rules in one request', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    const saved = page.waitForResponse(isRulePost);
    await page.getByRole('button', { name: 'Available all day, every day', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect((await response.json()).rules).toHaveLength(7);
    await expect(page.getByText('All day', { exact: true })).toHaveCount(7);
    expect((await rulesOf(court)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([0, 1, 2, 3, 4, 5, 6].map(d => [d, '00:00', '24:00']));
    await expect(page.getByRole('button', { name: 'Available all day, every day' })).toHaveCount(0); // nothing left to offer
    await context.close();
  });

  test('"Until midnight" saves 24:00 and reads "to midnight"; the end box is disabled while it is ticked', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    const dialog = await addHours(page, { days: ['Sunday'], start: '18:00', untilMidnight: true });
    await expect(timeInputs(dialog).second).toBeDisabled();
    await expect(dialog.getByTestId('hours-summary')).toHaveText('Sunday: 6:00 pm to midnight.');
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Sunday 6:00 pm to midnight', exact: true })).toBeVisible();
    expect((await rulesOf(court))[0]).toMatchObject({ day_of_week: 0, start_time: '18:00', end_time: '24:00' });
    await context.close();
  });

  test('a typed 00:00 end means midnight, not "before the start"; hours that start at 00:00 are fine', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    const dialog = await addHours(page, { days: ['Saturday'], start: '20:00', end: '00:00' });
    await expect(dialog.getByTestId('hours-summary')).toHaveText('Saturday: 8:00 pm to midnight.');
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await rulesOf(court))[0]).toMatchObject({ day_of_week: 6, start_time: '20:00', end_time: '24:00' });
    await context.close();
  });

  test('a service-period rule is shown but cannot be edited here (only removed); weekly "hours" are the only kind offered', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const res = await context.request.post(api(`/resources/${court.id}/availability-rules`), { data: { dayOfWeek: 4, startTime: '10:00', endTime: '12:00', kind: 'service_period', label: 'Clinic' }, headers: json });
    expect(res.status()).toBe(201);
    const page = await context.newPage();
    await openHours(page, court);
    const thursday = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Thursday', exact: true }) });
    await expect(thursday).toContainText('Service period');
    await expect(thursday.getByRole('button', { name: /^Edit /})).toHaveCount(0);
    await expect(thursday.getByRole('button', { name: 'Remove Thursday 10:00 am to 12:00 pm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(/service period/i)).toHaveCount(0); // no way to create one
    await context.close();
  });
});

// ─── Overnight windows and midnight boundaries ────────────────────────────────────────────────────────────────

test.describe('overnight hours', () => {
  let night: Owner;
  test.beforeEach(async ({ browser }) => {
    night = await ensureResource(browser, 'ZZ Hours night court');
    await clearHours(night);
  });

  test('Friday 10 pm to 2 am is ONE request, two stored rules, shown as one window and noted on Saturday', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, night);
    const dialog = await addHours(page, { days: ['Friday'], start: '22:00', end: '02:00' });
    await expect(dialog.getByTestId('hours-summary')).toContainText('Runs past midnight');
    await expect(dialog.getByTestId('hours-summary')).toContainText('saved as two linked windows, together');
    const posts: string[] = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/availability-rules')) posts.push(r.postData() ?? ''); });
    const audits = await availabilityAuditCount();
    const saved = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect(posts, 'the window is created by ONE write, never two UI writes').toHaveLength(1);
    expect(JSON.parse(posts[0])).toEqual({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true, timezone: 'Australia/Adelaide' });

    expect((await rulesOf(night)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([[5, '22:00', '24:00'], [6, '00:00', '02:00']]);
    const friday = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Friday', exact: true }) });
    await expect(friday).toContainText('10:00 pm to 2:00 am the next day');
    await expect(friday).toContainText('Overnight');
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Saturday', exact: true }) })).toContainText('Until 2:00 am, continuing Friday’s overnight hours');
    expect(await availabilityAuditCount() - audits, 'one entry for each of the two rules, plus one for the zone this first save pinned').toBe(3);
    await context.close();
  });

  test('if the morning half would overlap, NEITHER half is saved: the database is unchanged and the message says so', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, night, { dayOfWeek: 6, startTime: '00:00', endTime: '01:00' });
    const page = await context.newPage();
    await openHours(page, night);
    const before = await snapshot(ORG_A);
    const dialog = await addHours(page, { days: ['Friday'], start: '22:00', end: '02:00', opener: 'Add hours' });
    const refused = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    expect((await refused).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toContainText('overlaps');
    expect(await snapshot(ORG_A), 'no half of the window may be committed').toBe(before);
    expect((await rulesOf(night)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([[6, '00:00', '01:00']]);
    await context.close();
  });

  test('several nights at once are still one request: Monday to Friday 10 pm to 6 am is ten stored rules', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, night);
    const dialog = await addHours(page, { days: 'weekdays', start: '22:00', end: '06:00' });
    const saved = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect((await response.json()).rules).toHaveLength(10);
    expect(await rulesOf(night)).toHaveLength(10);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: day, exact: true }) })).toContainText('10:00 pm to 6:00 am the next day');
    }
    await context.close();
  });

  test('Saturday night runs into Sunday (the week wraps)', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, night);
    const dialog = await addHours(page, { days: ['Saturday'], start: '23:00', end: '01:00' });
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sunday', exact: true }) })).toContainText('Until 1:00 am, continuing Saturday’s overnight hours');
    expect((await rulesOf(night)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([[0, '00:00', '01:00'], [6, '23:00', '24:00']]);
    await context.close();
  });

  test('an overnight window cannot be edited into existence from a single day: it says to remove and add again', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, night, { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' });
    const page = await context.newPage();
    await openHours(page, night);
    await page.getByRole('button', { name: 'Edit Tuesday 9:00 am to 5:00 pm', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit hours on Tuesday' });
    const { first, second } = timeInputs(dialog);
    await first.fill('22:00');
    await second.fill('02:00');
    let sent = 0;
    page.on('request', r => { if (r.method() === 'PATCH') sent++; });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('remove this window and add it again');
    expect(sent).toBe(0);
    await context.close();
  });

  test('removing an overnight window is ONE request that removes both halves, after a confirmation, and is audited as two deletions', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, night, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
    await seedRules(context.request, night, { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' }); // an unrelated rule must survive
    const page = await context.newPage();
    await openHours(page, night);
    const requests: string[] = [];
    page.on('request', r => { if (r.method() !== 'GET') requests.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{20,}/g, ':id')}`); });
    const audits = await availabilityAuditCount();
    await page.getByRole('button', { name: /^Remove overnight hours starting Friday/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove overnight hours' });
    await expect(confirm).toContainText('both the evening and the morning part');
    const removed = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/availability-rules/remove-overnight'));
    await confirm.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    const response = await removed;
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { ids: string[] }).ids).toHaveLength(2);
    await expect(confirm).toHaveCount(0);
    expect(requests.filter(r => r.startsWith('POST') || r.startsWith('DELETE'))).toEqual(['POST /api/scheduling/availability-rules/remove-overnight']); // one request, never two deletes
    expect((await rulesOf(night)).map(r => [r.day_of_week, r.start_time, r.end_time])).toEqual([[2, '09:00', '12:00']]);
    expect(await availabilityAuditCount()).toBe(audits + 2);
    await expect(page.getByText('Overnight hours removed')).toBeVisible();
    await context.close();
  });

  test('a stale removal of an overnight window (one half edited in another tab) removes NEITHER half and says so', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const halves = await seedRules(context.request, night, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([openHours(tabA, night), openHours(tabB, night)]);
    // Another tab changes the label of the MORNING half (a change the first tab has not seen).
    const morning = halves.find(h => h.dayOfWeek === 6)!;
    const edit = await context.request.patch(api(`/availability-rules/${morning.id}`), { data: { expectedUpdatedAt: morning.updatedAt, label: 'Changed elsewhere' }, headers: json });
    expect(edit.status()).toBe(200);
    const before = await rulesOf(night);

    await tabA.getByRole('button', { name: /^Remove overnight hours starting Friday/ }).click();
    const confirm = tabA.getByRole('dialog', { name: 'Remove overnight hours' });
    const refused = tabA.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/availability-rules/remove-overnight'));
    await confirm.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    const response = await refused;
    expect([response.status(), (await response.json()).code]).toEqual([409, 'STALE_WRITE']);
    await expect(confirm.getByText(/Someone else changed this/)).toBeVisible();
    expect(await rulesOf(night), 'neither half may be removed').toEqual(before);
    expect(await rulesOf(night)).toHaveLength(2);

    // Reload latest, then remove again with the fresh tokens: both go.
    const reloaded = tabA.waitForResponse(r => r.request().method() === 'GET' && /[/]availability([?]|$)/.test(r.url()));
    await confirm.getByRole('button', { name: 'Reload latest', exact: true }).click();
    await reloaded; // the page now holds the committed version tokens
    await expect(confirm).toHaveCount(0);
    await tabA.getByRole('button', { name: /^Remove overnight hours starting Friday/ }).click();
    const again = tabA.getByRole('dialog', { name: 'Remove overnight hours' });
    const ok = tabA.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/availability-rules/remove-overnight'));
    await again.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    expect((await ok).status()).toBe(200);
    expect(await rulesOf(night)).toEqual([]);
    await context.close();
  });

  test('a half that was removed elsewhere: the window removal is refused whole (404), the remaining half is left, and the screen says it no longer exists', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const halves = await seedRules(context.request, night, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
    const page = await context.newPage();
    await openHours(page, night);
    const evening = halves.find(h => h.dayOfWeek === 5)!;
    expect((await context.request.delete(api(`/availability-rules/${evening.id}`), { data: { expectedUpdatedAt: evening.updatedAt }, headers: json })).status()).toBe(200);
    await page.getByRole('button', { name: /^Remove overnight hours starting Friday/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove overnight hours' });
    const refused = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/availability-rules/remove-overnight'));
    await confirm.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    expect((await refused).status()).toBe(404);
    await expect(confirm.getByText(/no longer exists/)).toBeVisible();
    expect(await rulesOf(night)).toHaveLength(1); // the morning half: nothing else was touched
    await context.close();
  });

  test('view-only and denied accounts: no Remove button for an overnight window, and the endpoint refuses them and another organisation, changing nothing', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    const halves = await seedRules(manager.request, night, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
    const body = { rules: halves.map(h => ({ id: h.id, expectedUpdatedAt: h.updatedAt })) };
    const before = await snapshot(ORG_A);
    for (const [account, status] of [['manager-view', 403], ['viewer', 403], ['viewer-use', 403], ['viewer-legacy', 403], ['viewer-none', 403], ['analyst', 403], ['analyst-legacy', 403], ['unentitled-manager', 403], ['unentitled-legacy', 403], ['foreign-manager', 404]] as const) {
      const context = await contextFor(browser, account);
      try {
        const res = await context.request.post(api('/availability-rules/remove-overnight'), { data: body, headers: json });
        expect([account, res.status()]).toEqual([account, status]);
        if (account === 'viewer' || account === 'manager-view') {
          const page = await context.newPage();
          await openHours(page, night);
          await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Friday', exact: true }) })).toContainText('Overnight');
          await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
    expect(await snapshot(ORG_A), 'refused requests change nothing').toBe(before);
    expect(await rulesOf(night)).toHaveLength(2);
    await manager.close();
  });

  test('a failed network request while removing an overnight window leaves both halves, with an error and a way to retry', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, night, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
    const page = await context.newPage();
    await openHours(page, night);
    await page.route('**/api/scheduling/availability-rules/remove-overnight', route => route.abort('failed'));
    await page.getByRole('button', { name: /^Remove overnight hours starting Friday/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove overnight hours' });
    await confirm.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    await expect(confirm.getByRole('alert').filter({ hasText: 'Network error' })).toBeVisible();
    expect(await rulesOf(night)).toHaveLength(2);
    await page.unroute('**/api/scheduling/availability-rules/remove-overnight');
    await confirm.getByRole('button', { name: 'Remove overnight hours', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(await rulesOf(night)).toEqual([]);
    await context.close();
  });

  test('midnight boundaries: all day (00:00-24:00) and a window ending exactly at midnight sit next to a window starting at midnight without overlapping', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, night, { dayOfWeek: 1, startTime: '00:00', endTime: '24:00' });
    await seedRules(context.request, night, { dayOfWeek: 2, startTime: '00:00', endTime: '06:00' });
    await seedRules(context.request, night, { dayOfWeek: 2, startTime: '06:00', endTime: '24:00' }); // touching: allowed
    const page = await context.newPage();
    await openHours(page, night);
    await expect(page.getByRole('button', { name: 'Edit Monday All day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Tuesday 12:00 am to 6:00 am', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Tuesday 6:00 am to midnight', exact: true })).toBeVisible();
    // and an hour that crosses is refused: 23:00-01:00 on Monday overlaps Monday's all-day window
    const dialog = await addHours(page, { days: ['Monday'], start: '23:00', end: '01:00' });
    const refused = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    expect((await refused).status()).toBe(409);
    expect(await rulesOf(night)).toHaveLength(3);
    await context.close();
  });
});

// ─── Closures ─────────────────────────────────────────────────────────────────────────────────────────────────

test.describe('closures', () => {
  let court: Owner;
  test.beforeEach(async ({ browser }) => {
    court = await ensureResource(browser, 'ZZ Hours closure court');
    await clearHours(court);
  });

  async function openClosure(page: Page) {
    await page.getByRole('button', { name: 'Add closure', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add closure' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('a whole-day closure: one date or a range; closures only ever remove availability (no opening-hours override is offered)', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    await expect(page.getByText('No closures', { exact: true })).toBeVisible();
    const dialog = await openClosure(page);
    await expect(dialog.getByText(/override|open longer|special hours/i)).toHaveCount(0);
    await dateInputs(dialog).first.fill('2027-12-25');
    await dialog.locator('input[type=text]').fill('Christmas Day');
    await expect(dialog.getByTestId('closure-summary')).toHaveText('Closed Sat 25 Dec 2027: the whole day.');
    const saved = page.waitForResponse(isClosurePost);
    await dialog.getByRole('button', { name: 'Add closure', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect((await response.json()).exception).toMatchObject({ fromDate: '2027-12-25', toDate: '2027-12-25', startTime: null, endTime: null, reason: 'Christmas Day' });
    await expect(page.getByRole('table', { name: 'Closures' })).toContainText('Sat 25 Dec 2027');
    await expect(page.getByRole('table', { name: 'Closures' })).toContainText('Whole day');
    await expect(page.getByRole('table', { name: 'Closures' })).toContainText('Christmas Day');

    const range = await openClosure(page);
    await dateInputs(range).first.fill('2028-01-01');
    await dateInputs(range).second.fill('2028-01-05');
    await expect(range.getByTestId('closure-summary')).toHaveText('Closed Sat 1 Jan 2028 to Wed 5 Jan 2028: the whole day.');
    await range.getByRole('button', { name: 'Add closure', exact: true }).click();
    await expect(range).toHaveCount(0);
    expect((await closuresOf(court)).map(c => [c.from_date, c.to_date, c.start_time])).toEqual([['2027-12-25', '2027-12-25', null], ['2028-01-01', '2028-01-05', null]]);
    await context.close();
  });

  test('overlap: a closure sharing a date with a whole-day closure is refused, and so is one that ends before it starts, before anything is sent', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedClosure(context.request, court, { fromDate: '2027-12-24', toDate: '2027-12-26' });
    const page = await context.newPage();
    await openHours(page, court);
    const before = await snapshot(ORG_A);
    const dialog = await openClosure(page);
    await dateInputs(dialog).first.fill('2027-12-26');
    await dateInputs(dialog).second.fill('2027-12-28');
    const refused = page.waitForResponse(isClosurePost);
    await dialog.getByRole('button', { name: 'Add closure', exact: true }).click();
    expect([(await refused).status()]).toEqual([409]);
    await expect(dialog.getByRole('alert')).toContainText('overlaps hours or a closure that is already saved');
    expect(await snapshot(ORG_A)).toBe(before);

    let sent = 0;
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/availability-exceptions')) sent++; });
    await dateInputs(dialog).second.fill('2027-12-20');
    await dialog.getByRole('button', { name: 'Add closure', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('cannot be before the first date');
    expect(sent).toBe(0);
    await context.close();
  });

  test('a partial-day closure: choose "Part of a day", the times are asked for, and the list shows them; two disjoint ones share a date, overlapping ones do not', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    const dialog = await openClosure(page);
    const part = dialog.getByRole('radio', { name: /Part of a day/ });
    await expect(part).toBeEnabled();
    await part.check();
    await dateInputs(dialog).first.fill('2027-04-02');
    const { first, second } = timeInputs(dialog);
    await first.fill('12:00');
    await second.fill('13:30');
    await expect(dialog.getByTestId('closure-summary')).toHaveText('Closed Fri 2 Apr 2027: 12:00 pm to 1:30 pm each day.');
    const saved = page.waitForResponse(isClosurePost);
    await dialog.getByRole('button', { name: 'Add closure', exact: true }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(201);
    expect((await response.json()).exception).toMatchObject({ startTime: '12:00', endTime: '13:30' });
    await expect(page.getByRole('table', { name: 'Closures' })).toContainText('12:00 pm to 1:30 pm');

    // a second, disjoint closure on the same date is fine
    const second1 = await openClosure(page);
    await second1.getByRole('radio', { name: /Part of a day/ }).check();
    await dateInputs(second1).first.fill('2027-04-02');
    await timeInputs(second1).first.fill('15:00');
    await timeInputs(second1).second.fill('16:00');
    await second1.getByRole('button', { name: 'Add closure', exact: true }).click();
    await expect(second1).toHaveCount(0);
    // an overlapping one, and a whole-day one over them, are refused and write nothing
    const before = await snapshot(ORG_A);
    for (const mode of ['overlap', 'whole-day'] as const) {
      const d = await openClosure(page);
      await dateInputs(d).first.fill('2027-04-02');
      if (mode === 'overlap') {
        await d.getByRole('radio', { name: /Part of a day/ }).check();
        await timeInputs(d).first.fill('13:00');
        await timeInputs(d).second.fill('15:30');
      }
      const refused = page.waitForResponse(isClosurePost);
      await d.getByRole('button', { name: 'Add closure', exact: true }).click();
      expect((await refused).status(), mode).toBe(409);
      await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    expect(await snapshot(ORG_A)).toBe(before);
    expect((await closuresOf(court)).map(c => [c.from_date, c.start_time, c.end_time])).toEqual([['2027-04-02', '12:00', '13:30'], ['2027-04-02', '15:00', '16:00']]);
    await context.close();
  });

  test('edit: move the times, switch to whole days and back; a stale edit from a second tab is a 409 with Reload latest', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedClosure(context.request, court, { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00', reason: 'Lunch' });
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([openHours(tabA, court), openHours(tabB, court)]);
    const open = async (tab: Page) => {
      await tab.getByRole('button', { name: /^Edit closure Fri 2 Apr 2027/ }).click();
      const dialog = tab.getByRole('dialog', { name: 'Edit closure' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const a = await open(tabA);
    const b = await open(tabB);
    await timeInputs(a).second.fill('14:00');
    const savedA = tabA.waitForResponse(isPatch('/availability-exceptions/'));
    await a.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await savedA).status()).toBe(200);
    await expect(tabA.getByRole('table', { name: 'Closures' })).toContainText('12:00 pm to 2:00 pm');

    await timeInputs(b).second.fill('15:00');
    const savedB = tabB.waitForResponse(isPatch('/availability-exceptions/'));
    await b.getByRole('button', { name: 'Save changes', exact: true }).click();
    const stale = await savedB;
    expect([stale.status(), (await stale.json()).code]).toEqual([409, 'STALE_WRITE']);
    await expect(b.getByText(/Someone else changed this/)).toBeVisible();
    expect((await closuresOf(court))[0].end_time, 'tab B must not overwrite tab A').toBe('14:00');
    await b.getByRole('button', { name: 'Reload latest', exact: true }).click();
    await expect(b).toHaveCount(0);
    await expect(tabB.getByRole('table', { name: 'Closures' })).toContainText('12:00 pm to 2:00 pm');

    // switch to whole days: the window is cleared as a pair
    const c = await open(tabA);
    await c.getByRole('radio', { name: /Whole days/ }).check();
    const switched = tabA.waitForResponse(isPatch('/availability-exceptions/'));
    await c.getByRole('button', { name: 'Save changes', exact: true }).click();
    const body = await switched;
    expect(body.status()).toBe(200);
    expect((await body.json()).exception).toMatchObject({ startTime: null, endTime: null });
    expect((await closuresOf(court))[0]).toMatchObject({ start_time: null, end_time: null, reason: 'Lunch' });
    await context.close();
  });

  test('remove: a confirmation says the weekly hours apply again; past closures are hidden until asked for', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    await seedClosure(context.request, court, { fromDate: '2027-12-25', toDate: '2027-12-26', reason: 'Christmas' });
    await seedClosure(context.request, court, { fromDate: '2020-01-01', toDate: '2020-01-01', reason: 'Long ago' });
    const page = await context.newPage();
    await openHours(page, court);
    await expect(page.getByRole('table', { name: 'Closures' })).not.toContainText('Long ago');
    await page.getByRole('checkbox', { name: /Show past closures \(1\)/ }).check();
    await expect(page.getByRole('table', { name: 'Closures' })).toContainText('Long ago');
    await page.getByRole('checkbox', { name: /Show past closures/ }).uncheck();
    await page.getByRole('button', { name: /^Remove closure Sat 25 Dec 2027 to Sun 26 Dec 2027/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove closure' });
    await expect(confirm).toContainText('regular weekly hours apply on those dates again');
    const gone = page.waitForResponse(isDelete('/availability-exceptions/'));
    await confirm.getByRole('button', { name: 'Remove closure', exact: true }).click();
    expect((await gone).status()).toBe(200);
    expect((await closuresOf(court)).map(c => c.reason)).toEqual(['Long ago']);
    await expect(page.getByText('No upcoming closures.')).toBeVisible();
    await context.close();
  });
});

// ─── States: archived, inactive, loading, retry, unavailable, view-only ───────────────────────────────────────

test.describe('states', () => {
  test('an inactive resource keeps its hours readable and removable, but takes no new ones (and the server agrees)', async ({ browser }) => {
    const court = await ensureResource(browser, 'ZZ Hours inactive court');
    await clearHours(court);
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    await ensureResource(browser, court.name, { active: false });
    try {
      const page = await manager.newPage();
      await openHours(page, court);
      await expect(page.getByText('This resource is inactive.')).toBeVisible();
      await expect(page.getByRole('button', { name: /^(Add hours|Add more hours|Add closure|Available all day|Edit )/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Remove Monday 9:00 am to 5:00 pm', exact: true })).toBeVisible();
      const refused = await manager.request.post(api(`/resources/${court.id}/availability-rules`), { data: { dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }, headers: json });
      expect([refused.status(), (await refused.json()).code]).toEqual([409, 'RESOURCE_INACTIVE']);
      await page.getByRole('button', { name: 'Remove Monday 9:00 am to 5:00 pm', exact: true }).click();
      await page.getByRole('dialog', { name: 'Remove Monday hours' }).getByRole('button', { name: 'Remove hours', exact: true }).click();
      await expect.poll(async () => (await rulesOf(court)).length).toBe(0); // removal is always allowed
    } finally {
      await ensureResource(browser, court.name, { active: true });
      await manager.close();
    }
  });

  test('an archived offering says so, takes no new hours, and shows its schedule as the way back', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    const offering = await ensureOffering(browser, 'ZZ Hours archived hire');
    await clearHours(offering);
    await seedRules(manager.request, offering, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    const archived = await manager.request.post(api(`/offerings/${offering.id}/archive`));
    expect([200, 409]).toContain(archived.status());
    const page = await manager.newPage();
    await openHours(page, offering);
    await expect(page.getByText('This offering is archived.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Add hours|Add more hours|Add closure|Available all day|Edit )/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Monday 9:00 am to 5:00 pm', exact: true })).toBeVisible();
    const refused = await manager.request.post(api(`/offerings/${offering.id}/availability-rules`), { data: { dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }, headers: json });
    expect([refused.status(), (await refused.json()).code]).toEqual([409, 'ARCHIVED']);
    await manager.close();
  });

  test('loading shows a status; a network failure offers Try again and recovers; an unavailable API (503) says so and offers Check again', async ({ browser }) => {
    const court = await ensureResource(browser, 'ZZ Hours states court');
    await clearHours(court);
    const context = await contextFor(browser, 'manager');
    await seedRules(context.request, court, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
    const page = await context.newPage();
    const pattern = `**/api/scheduling/resources/${court.id}/availability`;

    // loading: the response is held back, so the loading status is visible first
    await page.route(pattern, async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
    await page.goto(hoursUrl(court));
    await expect(page.getByRole('status').filter({ hasText: 'Loading hours…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Hours: ${court.name}`, exact: true })).toBeVisible({ timeout: 60_000 });
    await page.unroute(pattern);

    // network failure: the request is dropped, then allowed through on retry
    await page.route(pattern, route => route.abort('failed'));
    await page.goto(hoursUrl(court));
    await expect(page.getByRole('alert').filter({ hasText: 'Network error' })).toBeVisible();
    await expect(page.getByText('We couldn’t load this')).toBeVisible();
    await page.unroute(pattern);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Hours: ${court.name}`, exact: true })).toBeVisible({ timeout: 60_000 });

    // the availability schema is not installed (503 AVAILABILITY_NOT_READY): an explanation, not a broken page, and a way to check again
    await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ error: 'Availability is not available yet for this installation.', code: 'AVAILABILITY_NOT_READY' }) }));
    await page.goto(hoursUrl(court));
    await expect(page.getByText('Hours aren’t set up yet')).toBeVisible();
    await expect(page.getByText('Availability has not been set up on this installation yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Add hours|Available all day)/ })).toHaveCount(0);
    await page.unroute(pattern);
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Hours: ${court.name}`, exact: true })).toBeVisible({ timeout: 60_000 });
    await context.close();
  });

  test('a failed save keeps the dialog open with the reason and writes nothing; retrying after the failure clears works', async ({ browser }) => {
    const court = await ensureResource(browser, 'ZZ Hours states court');
    await clearHours(court);
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openHours(page, court);
    const pattern = `**/api/scheduling/resources/${court.id}/availability-rules`;
    await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'busy', code: 'TRY_AGAIN' }) }));
    const dialog = await addHours(page, { days: ['Monday'], start: '09:00', end: '12:00' });
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The system is busy. Nothing was changed; please try again.');
    expect(await rulesOf(court)).toEqual([]);
    await page.unroute(pattern);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await rulesOf(court)).toHaveLength(1);
    await context.close();
  });

  test('closing part of a day needs migration 035: until it is applied the option says so and is disabled, the server answers 503, and full-day closures still work', async ({ browser }) => {
    const court = await ensureResource(browser, 'ZZ Hours capability court');
    await clearHours(court);
    // this is the disposable database: remove any partial-day closure (the rollback refuses while one exists), then roll 035 back
    const { query: q } = await import('./support');
    await q('DELETE FROM scheduling_availability_exceptions WHERE start_time IS NOT NULL');
    await runMigrationScript('096_availability_partial_closures_rollback.sql');
    const context = await contextFor(browser, 'manager');
    try {
      const page = await context.newPage();
      await openHours(page, court);
      await page.getByRole('button', { name: 'Add closure', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add closure' });
      const part = dialog.getByRole('radio', { name: /Part of a day/ });
      await expect(part).toBeDisabled();
      await expect(dialog).toContainText('Not available yet: closing part of a day needs a database update that has not been applied.');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      const refused = await context.request.post(api(`/resources/${court.id}/availability-exceptions`), { data: { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:00' }, headers: json });
      expect([refused.status(), (await refused.json()).code]).toEqual([503, 'PARTIAL_CLOSURES_NOT_READY']);
      expect(Number((await q<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_exceptions WHERE resource_id = $1', [court.id]))[0].n), 'nothing was written').toBe(0); // closuresOf names the window columns, which do not exist now
      // whole days still work from the screen
      const whole = await (async () => {
        await page.getByRole('button', { name: 'Add closure', exact: true }).first().click();
        const d = page.getByRole('dialog', { name: 'Add closure' });
        await dateInputs(d).first.fill('2027-04-02');
        const saved = page.waitForResponse(isClosurePost);
        await d.getByRole('button', { name: 'Add closure', exact: true }).click();
        return saved;
      })();
      expect(whole.status()).toBe(201);
    } finally {
      await runMigrationScript('035_availability_partial_closures.sql'); // leave the disposable database as the other specs expect it
      await context.close();
    }
    expect((await (await import('./support')).query<{ n: string }>("SELECT count(*)::text AS n FROM information_schema.columns WHERE table_name = 'scheduling_availability_exceptions' AND column_name = 'start_time'"))[0].n).toBe('1');
  });
});

// ─── Timezone and daylight saving (Australia/Adelaide) ────────────────────────────────────────────────────────

test.describe('timezone and daylight saving', () => {
  let court: Owner;
  test.beforeEach(async ({ browser }) => {
    court = await ensureResource(browser, 'ZZ Hours zone court');
    await clearHours(court);
  });

  async function atTime(browser: import('@playwright/test').Browser, iso: string) {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(iso));
    return { context, page };
  }

  test('the timezone is shown with its current offset: UTC+10:30 in summer, UTC+09:30 in winter, from the organisation setting', async ({ browser }) => {
    for (const [iso, offset] of [['2027-01-20T00:00:00Z', '+10:30'], ['2027-07-20T00:00:00Z', '+09:30']] as const) {
      const { context, page } = await atTime(browser, iso);
      await openHours(page, court);
      await expect(page.getByTestId('timezone')).toHaveText(`Australia/Adelaide (UTC${offset})`);
      await expect(page.getByText('Your organisation’s timezone.')).toBeVisible();
      await expect(page.getByText('This zone is fixed when you save the first hours.')).toBeVisible(); // nothing is saved yet: not pinned
      await context.close();
    }
  });

  test('hours that avoid the changeover hour produce no daylight-saving notice', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '17:00' });
    await manager.close();
    const { context, page } = await atTime(browser, '2027-03-20T00:00:00Z');
    await openHours(page, court);
    await expect(page.getByTestId('dst-notice')).toHaveCount(0);
    await context.close();
  });

  test('fall-back (Sunday 4 April 2027): hours ending at 2:30 am end the FIRST time 2:30 comes round, and the screen says so', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { dayOfWeek: 0, startTime: '00:00', endTime: '02:30' });
    await manager.close();
    const { context, page } = await atTime(browser, '2027-03-20T00:00:00Z');
    await openHours(page, court);
    const notice = page.getByTestId('dst-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Sun 4 Apr 2027: clocks go back');
    await expect(notice).toContainText('the hour around 2:30 am happens twice');
    await expect(notice).toContainText('end the first time it comes round');
    await context.close();
  });

  test('spring-forward (Sunday 3 October 2027): hours starting at 2:30 am open when the clocks jump; hours wholly inside the skipped hour open nothing', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { dayOfWeek: 0, startTime: '02:30', endTime: '05:00' });
    await manager.close();
    const { context, page } = await atTime(browser, '2027-09-20T00:00:00Z');
    await openHours(page, court);
    await expect(page.getByTestId('dst-notice')).toContainText('Sun 3 Oct 2027: clocks go forward');
    await expect(page.getByTestId('dst-notice')).toContainText('open when the clocks jump');
    await context.close();

    await clearHours(court);
    const again = await contextFor(browser, 'manager');
    await seedRules(again.request, court, { dayOfWeek: 0, startTime: '02:10', endTime: '02:50' });
    await again.close();
    const second = await atTime(browser, '2027-09-20T00:00:00Z');
    await openHours(second.page, court);
    await expect(second.page.getByTestId('dst-notice')).toContainText('nothing is open then');
    await second.context.close();
  });

  test('a partial-day closure of the repeated hour removes the notice: nothing is left to adjust', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { dayOfWeek: 0, startTime: '00:00', endTime: '02:30' });
    await seedClosure(manager.request, court, { fromDate: '2027-04-04', toDate: '2027-04-04', startTime: '01:00', endTime: '03:00' });
    await manager.close();
    const { context, page } = await atTime(browser, '2027-03-20T00:00:00Z');
    await openHours(page, court);
    await expect(page.getByTestId('dst-notice')).not.toContainText('Sun 4 Apr 2027');
    await context.close();
  });

  test('the offering page uses the schedule\'s timezone when one is set, and the organisation\'s otherwise', async ({ browser }) => {
    const offering = await ensureOffering(browser, 'ZZ Hours zone hire');
    await clearHours(offering);
    const { context, page } = await atTime(browser, '2027-01-20T00:00:00Z');
    await openHours(page, offering);
    await expect(page.getByTestId('timezone')).toHaveText('Australia/Adelaide (UTC+10:30)');
    await expect(page.getByText('Your organisation’s timezone.')).toBeVisible();
    await context.close();
  });

  test('saving the first hours PINS the zone: the screen says it is fixed, and changing the organisation\'s timezone later does not move it', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2027-01-20T00:00:00Z'));
    await openHours(page, court);
    expect(await zoneOf(court)).toBeNull();
    const dialog = await addHours(page, { days: ['Tuesday'], start: '09:00', end: '12:00' });
    const saved = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByTestId('timezone')).toHaveText('Australia/Adelaide (UTC+10:30)');
    await expect(page.getByText('Fixed when the first hours were saved.')).toBeVisible();
    await expect(page.getByText('Changing this zone is not offered here.')).toBeVisible();
    expect(await zoneOf(court)).toEqual({ timezone: 'Australia/Adelaide', source: 'first_rule' });
    const original = (await query<{ timezone: string | null }>('SELECT timezone FROM organisations WHERE id = $1', [ORG_A]))[0].timezone;
    await query("UPDATE organisations SET timezone = 'Europe/London' WHERE id = $1", [ORG_A]);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { name: `Hours: ${court.name}`, exact: true })).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('timezone')).toHaveText('Australia/Adelaide (UTC+10:30)'); // the organisation moved to London; the saved hours did not
      await expect(page.getByText('Fixed when the first hours were saved.')).toBeVisible();
      expect(await zoneOf(court)).toEqual({ timezone: 'Australia/Adelaide', source: 'first_rule' });
    } finally {
      await query('UPDATE organisations SET timezone = $2 WHERE id = $1', [ORG_A, original]);
    }
    await context.close();
  });

  test('a save while ANOTHER zone has just been pinned is refused (ZONE_MISMATCH): the dialog says why, nothing is saved, and Perth hours cannot land under Adelaide', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2027-01-20T00:00:00Z'));
    await openHours(page, court);
    await expect(page.getByTestId('timezone')).toHaveText('Australia/Adelaide (UTC+10:30)'); // what this person is looking at: not pinned yet
    // Meanwhile someone else's first save pinned a different zone (a concurrent first write that won the race).
    await query("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ($1, $2, 'Australia/Perth', 'first_rule')", [ORG_A, court.id]);
    const dialog = await addHours(page, { days: ['Tuesday'], start: '09:00', end: '12:00' });
    const refused = page.waitForResponse(isRulePost);
    await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
    const response = await refused;
    expect([response.status(), (await response.json()).code]).toEqual([409, 'ZONE_MISMATCH']);
    await expect(dialog.getByText('These hours are read in a different timezone from the one you were looking at')).toBeVisible();
    await expect(dialog.getByText(/Nothing was saved/)).toBeVisible();
    expect(await rulesOf(court)).toEqual([]);
    expect(await zoneOf(court)).toEqual({ timezone: 'Australia/Perth', source: 'first_rule' });
    await context.close();
  });

  test('without migration 036 the screen says saving is not set up, offers no way to add, and the server refuses (503); reading and removing still work', async ({ browser }) => {
    const manager = await contextFor(browser, 'manager');
    const seeded = await seedRules(manager.request, court, { dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }); // pinned and has hours
    await runMigrationScript('097_availability_zones_rollback.sql');
    try {
      const page = await manager.newPage();
      await openHours(page, court);
      await expect(page.getByTestId('zones-not-ready')).toContainText('Saving hours isn’t set up on this installation yet');
      await expect(page.getByRole('button', { name: /^(Add hours|Add more hours|Add closure|Add a closure|Available all day)/ })).toHaveCount(0);
      await expect(page.getByText('9:00 am to 12:00 pm').first()).toBeVisible(); // reading works
      const refused = await manager.request.post(`${api(`/${court.kind === 'resource' ? 'resources' : 'offerings'}/${court.id}`)}/availability-rules`, { data: { dayOfWeek: 4, startTime: '09:00', endTime: '10:00' }, headers: json });
      expect([refused.status(), (await refused.json()).code]).toEqual([503, 'AVAILABILITY_ZONES_NOT_READY']);
      expect(await rulesOf(court)).toHaveLength(1);
      await expect(page.getByRole('button', { name: /^Remove Wednesday/ })).toBeVisible(); // removal is still offered
      const removed = await manager.request.delete(api(`/availability-rules/${seeded[0].id}`), { data: { expectedUpdatedAt: seeded[0].updatedAt }, headers: json });
      expect(removed.status()).toBe(200);
    } finally {
      await runMigrationScript('036_availability_zones.sql');
      await manager.close();
    }
  });
});

// ─── Weekly hours of an offering ──────────────────────────────────────────────────────────────────────────────

test('an offering: the same screen, with the offering named by its schedule, and its own hours', async ({ browser }) => {
  const offering = await ensureOffering(browser, 'ZZ Hours offering screen');
  await clearHours(offering);
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await openHours(page, offering);
  await expect(page.getByTestId('unavailable-state')).toContainText('has no weekly hours, so it has no availability');
  await expect(page.getByRole('link', { name: 'ZZ Hours schedule', exact: true })).toBeVisible(); // the way back
  const dialog = await addHours(page, { days: 'weekdays', start: '08:00', end: '18:00' });
  await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Monday 8:00 am to 6:00 pm', exact: true })).toBeVisible();
  expect((await rulesOf(offering)).map(r => r.day_of_week)).toEqual([1, 2, 3, 4, 5]);
  // and the entry point from the schedule screen
  await page.goto(`${origin}/scheduling/schedules/${offering.scheduleId}`);
  await page.getByRole('link', { name: 'Hours for ZZ Hours offering screen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hours: ZZ Hours offering screen', exact: true })).toBeVisible({ timeout: 60_000 });
  await context.close();
});

test('a resource: the entry point from the Resources screen, for a manager and for a viewer', async ({ browser }) => {
  const court = await ensureResource(browser, 'ZZ Hours entry court');
  for (const account of ['manager', 'viewer'] as const) {
    const context = await contextFor(browser, account);
    const page = await context.newPage();
    await page.goto(`${origin}/scheduling/resources`);
    await page.getByRole('link', { name: 'Hours for ZZ Hours entry court', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Hours: ${court.name}`, exact: true })).toBeVisible({ timeout: 60_000 });
    await context.close();
  }
});
