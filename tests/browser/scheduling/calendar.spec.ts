import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { enabled, origin } from './accounts';
import { api, contextFor, json, query, snapshot } from './support';
import { ORG_A, clearHours, ensureOffering, ensureResource, seedClosure, seedRules, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.describe.configure({ mode: 'serial' });

// Phase 2B.3d: the READ-ONLY availability calendar in real Chromium at 390 (mobile), 768 (tablet) and 1440 (desktop) px, signed in through the real
// login form as synthetic accounts, against a disposable PostgreSQL. Fixtures (Adelaide offering, a Perth-pinned court with a closure and a hold, a
// court with no hours, an offering with no hours) are created through the real API; the hold and the zone pin are set with direct SQL on the DISPOSABLE
// database (test setup only: the application has no way to create either from the calendar). Reference calendar: Adelaide +10:30 in summer; its clocks
// go forward Sun 2026-10-04 (a 23-hour day) and back Sun 2027-04-04 (a 25-hour day); Perth +08:00. 2027-01-11 is a Monday.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const MONDAY = '2027-01-11';

let hire: Owner & { scheduleId: string };
let empty: Owner & { scheduleId: string };
let courtA: Owner;
let courtB: Owner;

const calendarUrl = (owner: Owner, view: 'day' | 'week', date: string, extra = '') => `${origin}/scheduling/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}/calendar?view=${view}&date=${date}${extra}`;

async function open(page: Page, owner: Owner, view: 'day' | 'week', date: string) {
  await page.goto(calendarUrl(owner, view, date));
  await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 60_000 });
}
const isMobile = (info: TestInfo) => info.project.name === 'mobile';
async function attach(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(`${info.project.name}-${name}`, { body, contentType: 'image/png' });
  // Optional evidence export: set SCHED_CALENDAR_SHOTS_DIR to keep the screenshots after the harness removes its own output.
  const dir = process.env.SCHED_CALENDAR_SHOTS_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${info.project.name}-${name}.png`), body);
  }
}
async function violations(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run({ include: [['main']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
  });
}

test('seed: an Adelaide offering with two courts (one pinned to Perth, with a closure and a hold, one with no hours), and an offering with nothing', async ({ browser }) => {
  hire = await ensureOffering(browser, 'ZZ Calendar hire');
  empty = await ensureOffering(browser, 'ZZ Calendar empty hire');
  courtA = await ensureResource(browser, 'ZZ Calendar court A');
  courtB = await ensureResource(browser, 'ZZ Calendar court B');
  for (const owner of [hire, empty, courtA, courtB]) await clearHours(owner);
  await query("DELETE FROM scheduling_resource_holds WHERE id = 'zzcal-hold'");
  await query("DELETE FROM scheduling_occurrences WHERE id = 'zzcal-occ'");
  const manager = await contextFor(browser, 'manager');
  for (const court of [courtA, courtB]) {
    const link = await manager.request.post(api(`/offerings/${hire.id}/resources`), { data: { resourceId: court.id }, headers: json });
    expect([200, 201], await link.text()).toContain(link.status());
  }
  await seedRules(manager.request, hire, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
  await seedRules(manager.request, hire, { dayOfWeek: 0, startTime: '01:00', endTime: '05:00' });
  await query("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ($1, $2, 'Australia/Perth', 'backfill')", [ORG_A, courtA.id]);
  await seedRules(manager.request, courtA, { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }); // Perth 08:00-12:00 = 00:00Z-04:00Z
  await seedClosure(manager.request, courtA, { fromDate: MONDAY, toDate: MONDAY, startTime: '10:00', endTime: '10:30', reason: 'Net repair' }); // 02:00Z-02:30Z
  await manager.close();
  // A session holds court A from 00:30Z to 01:30Z (Adelaide 11:00-12:00): written the way the repository writes an occurrence that holds a resource.
  await query(
    `WITH occ AS (
       INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
       VALUES ('zzcal-occ', $1, $2, $3, '2027-01-11', '11:00', 'Australia/Adelaide', '2027-01-11T00:30:00Z', '2027-01-11T01:30:00Z', 1) RETURNING id, organisation_id, resource_id, starts_at, ends_at)
     INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
     SELECT 'zzcal-hold', organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ`,
    [ORG_A, hire.id, courtA.id],
  );
  const live = await query<{ n: string }>("SELECT count(*)::text AS n FROM scheduling_resource_holds WHERE id = 'zzcal-hold' AND released_at IS NULL");
  expect(live[0].n).toBe('1');
});

test('day view: the offering and each court side by side, in the zone they are set in, with hours, closures, the hold and the one bookable start', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, hire, 'day', MONDAY);
  await expect(page.getByRole('heading', { name: 'Calendar: ZZ Calendar hire', exact: true })).toBeVisible();
  await expect(page.getByTestId('range-heading')).toHaveText('Monday 11 January 2027');
  await expect(page.getByTestId('calendar-timezone')).toHaveText('Australia/Adelaide (UTC+10:30)');
  await expect(page.getByTestId('other-zone')).toContainText('ZZ Calendar court A’s hours are set in Australia/Perth (UTC+8)');
  await expect(page.getByTestId('calendar-legend')).toBeVisible();

  if (isMobile(info)) {
    await expect(page.getByTestId('calendar-grid')).toHaveCount(0); // narrow screens draw the agenda, not a grid
    const agenda = page.getByTestId(`agenda-${MONDAY}`);
    await expect(agenda).toBeVisible();
    await expect(agenda).toContainText('ZZ Calendar hire — open 09:00 to 17:00');
    // court A is set in Perth (08:00-12:00, closed 10:00-10:30) and is shown here in the OFFERING's zone, Adelaide (+2:30 ahead of Perth)
    await expect(agenda).toContainText('ZZ Calendar court A — open 10:30 to 12:30, 13:00 to 14:30; closed 12:30 to 13:00');
    await expect(agenda).toContainText('ZZ Calendar court B — no hours set, so not available');
  } else {
    const grid = page.getByTestId('calendar-grid');
    await expect(grid).toBeVisible();
    for (const [lane, name] of [[hire.id, 'ZZ Calendar hire'], [courtA.id, 'ZZ Calendar court A'], [courtB.id, 'ZZ Calendar court B']] as const) await expect(page.getByTestId(`lane-head-${lane}`)).toContainText(name);
    const hours = grid.locator('[data-kind=hours][data-start="2027-01-10T22:30:00Z"][data-end="2027-01-11T06:30:00Z"]');
    await expect(hours).toHaveCount(1);
    const courtAColumn = grid.locator(`[data-lane="${courtA.id}"]`);
    await expect(courtAColumn.locator('[data-kind=hours]').first()).toHaveAttribute('data-start', '2027-01-11T00:00:00Z');
    await expect(courtAColumn.locator('[data-kind=closed]')).toHaveAttribute('data-start', '2027-01-11T02:00:00Z');
    await expect(courtAColumn.locator('[data-kind=occupied]')).toHaveAttribute('data-start', '2027-01-11T00:30:00Z');
    await expect(courtAColumn.locator('[data-kind=slot]')).toHaveCount(1);
    await expect(courtAColumn.locator('[data-kind=slot]')).toHaveAttribute('data-start', '2027-01-11T02:30:00Z');
    await expect(grid.locator(`[data-lane="${courtB.id}"]`).locator('[data-kind=hours]')).toHaveCount(0); // no hours means not available, drawn as nothing
    await expect(grid.locator(`[data-lane="${courtB.id}"]`)).toHaveAttribute('data-state', 'no_hours');
  }
  // the list is always available (collapsed under the grid on wide screens) and says the same in words
  const details = page.getByTestId('calendar-agenda');
  if (!isMobile(info)) await details.locator('summary').click();
  await expect(page.getByTestId(`agenda-${MONDAY}`)).toContainText('1 bookable start: 13:00');
  await expect(page.getByTestId(`agenda-${MONDAY}`)).toContainText('held 11:00 to 12:00');
  await attach(page, info, 'day');
  await context.close();
});

test('week view: seven days, one lane at a time on wide screens, every lane in the agenda', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, hire, 'week', '2027-01-13'); // a Wednesday: the week is Monday 11th to Sunday 17th
  await expect(page.getByTestId('range-heading')).toHaveText('11 Jan to 17 Jan 2027');
  await expect(page.getByTestId('mode-week')).toHaveAttribute('aria-pressed', 'true');
  if (!isMobile(info)) {
    for (let d = 11; d <= 17; d++) await expect(page.getByTestId(`day-head-2027-01-${d}`)).toBeVisible();
    const grid = page.getByTestId('calendar-grid');
    await expect(grid.locator('[data-day]')).toHaveCount(7);
    await expect(grid.locator(`[data-day="${MONDAY}"] [data-kind=hours]`)).toHaveCount(1); // the offering's Monday hours
    await page.getByTestId('lane-select').selectOption(courtA.id);
    await expect(grid.locator(`[data-day="${MONDAY}"] [data-kind=slot]`)).toHaveCount(1);
    await expect(grid.locator(`[data-day="${MONDAY}"] [data-kind=occupied]`)).toHaveCount(1);
    await expect(grid.locator('[data-day="2027-01-12"] [data-kind]')).toHaveCount(0); // Tuesday: nothing is set, so nothing is available
  } else {
    await expect(page.getByTestId('calendar-grid')).toHaveCount(0);
    for (let d = 11; d <= 17; d++) await expect(page.getByTestId(`agenda-2027-01-${d}`)).toBeVisible();
    await expect(page.getByTestId('agenda-2027-01-12')).toContainText('no hours, not available');
  }
  await attach(page, info, 'week');
  await context.close();
});

test('navigation: previous, next, today, the date field and the day/week switch move the range and the address', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, hire, 'day', MONDAY);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('range-heading')).toHaveText('Tuesday 12 January 2027');
  await expect(page).toHaveURL(/date=2027-01-12/);
  await page.getByTestId('prev').click();
  await page.getByTestId('prev').click();
  await expect(page.getByTestId('range-heading')).toHaveText('Sunday 10 January 2027');
  await page.getByTestId('date-input').fill('2027-01-20');
  await expect(page.getByTestId('range-heading')).toHaveText('Wednesday 20 January 2027');
  await page.getByTestId('mode-week').click();
  await expect(page.getByTestId('range-heading')).toHaveText('18 Jan to 24 Jan 2027');
  await expect(page).toHaveURL(/view=week/);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('range-heading')).toHaveText('25 Jan to 31 Jan 2027');
  await page.getByTestId('today').click();
  await expect(page.getByTestId('range-heading')).not.toHaveText('25 Jan to 31 Jan 2027');
  // a reload keeps the place
  await page.goto(calendarUrl(hire, 'week', '2027-02-03'));
  await expect(page.getByTestId('range-heading')).toHaveText('1 Feb to 7 Feb 2027');
  await attach(page, info, 'navigation');
  await context.close();
});

test('daylight saving: the 23-hour and 25-hour days are labelled and drawn at their true length, and the hours keep their wall-clock time', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, hire, 'week', '2026-10-01'); // Monday 28 Sep to Sunday 4 Oct 2026: the clocks go forward on the Sunday
  await expect(page.getByTestId('calendar-dst-notice')).toContainText('Sun 4 Oct: 23-hour day: the clocks go forward');
  await expect(page.getByTestId('agenda-2026-10-04')).toContainText('23-hour day');
  await page.getByTestId('calendar-agenda').locator('summary').click().catch(() => undefined);
  if (!isMobile(info)) {
    const short = page.getByTestId('calendar-grid').locator('[data-day="2026-10-04"]');
    await expect(short).toHaveAttribute('data-minutes', '1380');
    const normal = page.getByTestId('calendar-grid').locator('[data-day="2026-10-03"]');
    await expect(normal).toHaveAttribute('data-minutes', '1440');
    const heights = await Promise.all([short, normal].map(async c => (await c.boundingBox())!.height));
    expect(heights[0]).toBeLessThan(heights[1]); // the short day is drawn shorter, not stretched to look normal
    await expect(short.locator('[data-kind=hours]')).toHaveAttribute('data-start', '2026-10-03T15:30:00Z'); // 01:00 at +09:30
    await expect(short.locator('[data-kind=hours]')).toHaveAttribute('data-end', '2026-10-03T18:30:00Z'); // 05:00 at +10:30: three hours elapsed
  } else {
    await expect(page.getByTestId('agenda-2026-10-04')).toContainText('open 01:00 to 05:00');
  }
  await open(page, hire, 'day', '2027-04-04'); // the clocks go back
  await expect(page.getByTestId('calendar-dst-notice')).toContainText('Sun 4 Apr: 25-hour day: the clocks go back');
  await expect(page.getByTestId('calendar-timezone')).toHaveText('Australia/Adelaide (UTC+10:30)'); // the offset at the START of that day
  await attach(page, info, 'daylight-saving');
  await context.close();
});

test('missing availability: an offering with no hours is drawn as unavailable, never as open', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, empty, 'week', MONDAY);
  await expect(page.getByTestId('calendar-reasons')).toContainText('No hours are saved for this offering');
  if (!isMobile(info)) {
    const grid = page.getByTestId('calendar-grid');
    await expect(grid.locator('[data-kind]')).toHaveCount(0);
  }
  await expect(page.getByTestId('calendar-timezone')).toHaveText('Australia/Adelaide (UTC+10:30)');
  await expect(page.getByText(/not fixed yet/i)).toBeVisible(); // nothing is pinned by looking
  await attach(page, info, 'no-hours');
  await context.close();
});

test('a resource calendar is drawn in the resource’s own zone with its closure and hold, and no bookable times', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await open(page, courtA, 'day', MONDAY);
  await expect(page.getByRole('heading', { name: 'Calendar: ZZ Calendar court A', exact: true })).toBeVisible();
  await expect(page.getByTestId('calendar-timezone')).toHaveText('Australia/Perth (UTC+8)');
  if (!isMobile(info)) {
    const grid = page.getByTestId('calendar-grid');
    await expect(grid.locator('[data-kind=hours]').first()).toHaveAttribute('data-start', '2027-01-11T00:00:00Z');
    await expect(grid.locator('[data-kind=closed]')).toHaveAttribute('data-start', '2027-01-11T02:00:00Z');
    await expect(grid.locator('[data-kind=occupied]')).toHaveAttribute('data-start', '2027-01-11T00:30:00Z');
    await expect(grid.locator('[data-kind=slot]')).toHaveCount(0);
  } else {
    await expect(page.getByTestId(`agenda-${MONDAY}`)).toContainText('held 08:30 to 09:30');
  }
  await context.close();
});

test('permissions: a manager can follow the link to edit hours, a viewer sees the same calendar and only "View hours", and neither can change anything here', async ({ browser }, info) => {
  const manager = await contextFor(browser, 'manager');
  const viewer = await contextFor(browser, 'viewer');
  const managerPage = await manager.newPage();
  const viewerPage = await viewer.newPage();
  await open(managerPage, hire, 'day', MONDAY);
  await open(viewerPage, hire, 'day', MONDAY);
  await expect(managerPage.getByTestId('hours-link')).toHaveText('Edit hours');
  await expect(viewerPage.getByTestId('hours-link')).toHaveText('View hours');
  await expect(viewerPage.getByText('You have view-only access to Scheduling')).toBeVisible();
  await expect(managerPage.getByText('You have view-only access to Scheduling')).toHaveCount(0);
  for (const page of [managerPage, viewerPage]) {
    await expect(page.getByTestId('calendar-timezone')).toHaveText('Australia/Adelaide (UTC+10:30)');
    await expect(page.getByRole('button', { name: /^(add|save|book|reserve|hold|remove|delete|pin)/i })).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
  }
  const text = (p: Page) => p.getByTestId(`agenda-${MONDAY}`).innerText();
  await managerPage.getByTestId('calendar-agenda').locator('summary').click().catch(() => undefined);
  await viewerPage.getByTestId('calendar-agenda').locator('summary').click().catch(() => undefined);
  expect(await text(viewerPage)).toBe(await text(managerPage));
  // the link goes to the hours screen the person already has
  await viewerPage.getByTestId('hours-link').click();
  await expect(viewerPage.getByRole('heading', { name: 'Hours: ZZ Calendar hire', exact: true })).toBeVisible({ timeout: 90_000 });
  await attach(viewerPage, info, 'viewer-hours');
  await manager.close();
  await viewer.close();
});

test('access: signed out goes to sign-in; an organisation without Scheduling and another organisation’s manager see nothing of this calendar', async ({ browser, baseURL }) => {
  const url = calendarUrl(hire, 'day', MONDAY);
  const signedOut = await browser.newContext({ ignoreHTTPSErrors: true });
  const anon = await signedOut.newPage();
  await anon.goto(url);
  await expect(anon).toHaveURL(/\/login/, { timeout: 90_000 });
  const apiAnon = await signedOut.request.get(`${origin}/api/scheduling/offerings/${hire.id}/calendar?from=${MONDAY}`);
  expect(apiAnon.status()).toBe(401);
  await signedOut.close();

  const unentitled = await contextFor(browser, 'unentitled-manager');
  const unentitledPage = await unentitled.newPage();
  await unentitledPage.goto(url);
  await expect(unentitledPage.getByTestId('calendar-screen')).toHaveCount(0);
  expect((await unentitled.request.get(`${origin}/api/scheduling/offerings/${hire.id}/calendar?from=${MONDAY}`)).status()).toBe(403);
  await unentitled.close();

  const foreign = await contextFor(browser, 'foreign-manager');
  const foreignPage = await foreign.newPage();
  await foreignPage.goto(url);
  await expect(foreignPage.getByText('This offering no longer exists', { exact: true })).toBeVisible({ timeout: 90_000 });
  const crossApi = await foreign.request.get(`${origin}/api/scheduling/offerings/${hire.id}/calendar?from=${MONDAY}`);
  expect(crossApi.status()).toBe(404);
  expect(await crossApi.text()).not.toContain('ZZ Calendar');
  await foreign.close();
  expect(baseURL).toBeTruthy();
});

test('the calendar writes nothing: every Scheduling row, the pins, the holds and the audit log are unchanged after visiting every view as a manager and a viewer', async ({ browser }) => {
  const before = await snapshot(ORG_A);
  const zones = await query<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_zones WHERE organisation_id = $1', [ORG_A]);
  for (const account of ['manager', 'viewer'] as const) {
    const context = await contextFor(browser, account);
    const page = await context.newPage();
    for (const [owner, view, date] of [[hire, 'day', MONDAY], [hire, 'week', MONDAY], [empty, 'week', MONDAY], [courtA, 'day', MONDAY], [courtB, 'week', MONDAY], [hire, 'week', '2026-10-01']] as const) {
      await open(page, owner, view, date);
    }
    await context.close();
  }
  expect(await snapshot(ORG_A)).toBe(before);
  expect((await query<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_zones WHERE organisation_id = $1', [ORG_A]))[0].n).toBe(zones[0].n);
  const emptyPin = await query<{ n: string }>('SELECT count(*)::text AS n FROM scheduling_availability_zones WHERE owner_id = $1', [empty.id]);
  expect(emptyPin[0].n).toBe('0'); // looking at an owner with no hours did not pin it
  const bookings = await query<{ n: string }>('SELECT (SELECT count(*) FROM scheduling_reservations)::text AS n');
  expect(bookings[0].n).toBe('0');
});

test('layout and accessibility: no horizontal page overflow, no axe violations, controls at least 44px, and a keyboard-only path through the controls', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  for (const [view, date] of [['day', MONDAY], ['week', MONDAY]] as const) {
    await open(page, hire, view, date);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${view}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    expect(await violations(page), `${view} axe`).toEqual([]);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main :is(button, input:not([type=hidden]), select), main a[data-variant]')) {
        if (getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) out.push(`${el.tagName} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small, `${view}: controls under 44px`).toEqual([]);
    await attach(page, info, `layout-${view}`);
  }
  // keyboard: tab to the Next button and press it; the range moves
  await open(page, hire, 'day', MONDAY);
  await page.getByTestId('next').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('range-heading')).toHaveText('Tuesday 12 January 2027');
  await page.getByTestId('mode-week').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('mode-week')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('dark appearance: the calendar has no axe violations and no sideways scroll', async ({ browser }, info) => {
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => { try { localStorage.setItem('bb-theme', 'dark'); } catch { /* storage unavailable */ } });
  await open(page, hire, 'week', MONDAY);
  expect(await violations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await attach(page, info, 'dark');
  await context.close();
});

test('teardown: the fixtures leave no hold or occurrence behind', async () => {
  await query("DELETE FROM scheduling_resource_holds WHERE id = 'zzcal-hold'");
  await query("DELETE FROM scheduling_occurrences WHERE id = 'zzcal-occ'");
  expect((await query<{ n: string }>('SELECT (SELECT count(*) FROM scheduling_resource_holds)::text AS n'))[0].n).toBe('0');
});
