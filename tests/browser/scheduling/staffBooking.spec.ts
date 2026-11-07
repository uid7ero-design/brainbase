import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { enabled, origin, type Account } from './accounts';
import { api, contextFor, json, snapshot } from './support';
import { ORG_A, clearHours, ensureOffering, ensureResource, seedRules, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.describe.configure({ mode: 'serial' });

// Phase 2C.3c UI slice 1: the read-only staff booking dialog in real Chromium at 390 / 768 / 1440 px, both themes, signed in through the real login form as synthetic accounts, against a
// DISPOSABLE PostgreSQL. The harness runs this file in two modes (scripts/tests/verify-scheduling-browser-local.mjs):
//   - SWITCH OFF (default; the capability IS held by organisation A): the Book button must not exist for anyone, the dialog must not render, and the page must make no booking-related request.
//   - SWITCH ON (SCHED_BROWSER_STAFF_BOOKING=on): the button exists exactly for sessions the API would serve (manager with Scheduling "use" in the entitled organisation), and the dialog reads only.
// The spec reads which mode it is in from the app itself (GET basis: 404 means off), so it never assumes.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
let hire: Owner & { scheduleId: string };
let court: Owner;
let switchOn = false;

const calendarUrl = (owner: Owner) => `${origin}/scheduling/resources/${owner.id}/calendar?view=day`;
const isMobile = (info: TestInfo) => info.project.name === 'mobile';

async function themed(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(theme => { try { localStorage.setItem('bb-theme', theme); } catch { /* storage unavailable */ } }, scheme);
}
async function openCalendar(page: Page, owner: Owner) {
  await page.goto(calendarUrl(owner));
  await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 60_000 });
}
async function violations(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run({ include: [['[role="dialog"]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
  });
}
async function attach(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: false });
  await info.attach(`${info.project.name}-${name}`, { body, contentType: 'image/png' });
  const dir = process.env.SCHED_BOOKING_SHOTS_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${info.project.name}-${name}.png`), body);
  }
}
/** Requests a calendar page must not make unless the dialog is open: anything about booking or the discovery chain. */
const bookingRequest = (url: string) => /\/api\/scheduling\/(reservations|schedules|offerings\/[^/?]+\/resources)/.test(url);

test('seed: an Adelaide hire offering with one linked court, open Mondays 09:00-17:00', async ({ browser }) => {
  hire = await ensureOffering(browser, 'ZZ Staff booking hire');
  court = await ensureResource(browser, 'ZZ Staff booking court');
  for (const owner of [hire, court]) await clearHours(owner);
  const manager = await contextFor(browser, 'manager');
  const link = await manager.request.post(api(`/offerings/${hire.id}/resources`), { data: { resourceId: court.id }, headers: json });
  expect([200, 201], await link.text()).toContain(link.status());
  for (const owner of [hire, court]) await seedRules(manager.request, owner, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
  await manager.close();
});

test('which mode is the app in? (a probe through the real API, not an assumption)', async ({ browser }) => {
  const manager = await contextFor(browser, 'manager');
  const from = new Date().toISOString().slice(0, 10);
  const res = await manager.request.get(api(`/reservations/basis?offeringId=${hire.id}&resourceId=${court.id}&from=${from}&to=${from}`));
  switchOn = res.status() === 200;
  if (!switchOn) {
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  }
  await manager.close();
  console.log(`staff booking mode: ${switchOn ? 'ON' : 'OFF'}`);
});

test.describe('switch OFF: the capability is held but nothing exists', () => {
  test.beforeEach(() => test.skip(switchOn, 'switch is on in this run'));

  for (const account of ['manager', 'owner', 'viewer', 'manager-legacy'] as Account[]) {
    test(`${account}: no Book button, no dialog, no booking-related request; every booking endpoint is 404`, async ({ browser }) => {
      const context = await contextFor(browser, account);
      const page = await context.newPage();
      const seen: string[] = [];
      page.on('request', r => { if (bookingRequest(r.url())) seen.push(`${r.method()} ${r.url()}`); });
      await openCalendar(page, court).catch(async () => undefined);
      await expect(page.getByTestId('book-button')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Book\b/ })).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(seen).toEqual([]);
      const from = new Date().toISOString().slice(0, 10);
      for (const [method, p] of [['GET', `/reservations/basis?offeringId=${hire.id}&resourceId=${court.id}&from=${from}&to=${from}`], ['GET', '/reservations?idempotencyKey=bk_00000000000000000000000000000000'], ['GET', '/reservations/anything']] as const) {
        const res = await context.request.fetch(api(p), { method });
        expect([res.status(), await res.json().catch(() => null)], `${account} ${method} ${p}`).toEqual([404, { error: 'not_found' }]);
      }
      await context.close();
    });
  }
});

test.describe('switch ON: who sees the button', () => {
  test.beforeEach(() => test.skip(!switchOn, 'switch is off in this run'));

  // The page is decided server-side with the same rules as the API, so each row equals "would the basis endpoint answer 200 for this person".
  const EXPECTED: Array<[Account, boolean, string]> = [
    ['manager', true, 'manager with Scheduling "use" in the entitled organisation'],
    ['manager-legacy', true, 'manager with no managed-access row (role decides)'],
    ['viewer', false, 'viewer (no scheduling.reserve)'],
    ['viewer-use', false, 'viewer with managed level "use" (the role still lacks scheduling.reserve)'],
    ['analyst', false, 'analyst (unknown to the permission table)'],
    ['manager-view', false, 'manager whose managed Scheduling level is "view"'],
    ['foreign-manager', false, 'manager of another organisation that holds Scheduling but NOT the capability'],
    ['unentitled-manager', false, 'manager of an organisation without Scheduling'],
  ];
  for (const [account, visible, why] of EXPECTED) {
    test(`${account}: ${visible ? 'sees' : 'does not see'} the Book button (${why}), and the API agrees`, async ({ browser }) => {
      const context = await contextFor(browser, account);
      const page = await context.newPage();
      await page.goto(calendarUrl(court));
      if (visible) {
        await expect(page.getByTestId('book-button')).toBeVisible({ timeout: 90_000 });
      } else {
        // wait until the page has settled into whatever it shows (calendar, error or access message), then assert the button is absent
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('main, body').first()).toBeVisible();
        await Promise.race([
          page.getByTestId('calendar-screen').waitFor({ timeout: 20_000 }).catch(() => undefined),
          page.getByRole('alert').first().waitFor({ timeout: 20_000 }).catch(() => undefined),
          page.getByText(/not enabled|not available|sign in/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined),
        ]);
        await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByTestId('book-button')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      const from = new Date().toISOString().slice(0, 10);
      const res = await context.request.get(api(`/reservations/basis?offeringId=${hire.id}&resourceId=${court.id}&from=${from}&to=${from}`));
      expect(res.status() === 200, `${account}: api ${res.status()}`).toBe(visible);
      await context.close();
    });
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`switch ON, ${scheme} theme: the dialog`, () => {
    test.beforeEach(() => test.skip(!switchOn, 'switch is off in this run'));

    test(`opens, reads only, completes by keyboard, has no axe violations, does not overflow, and returns focus (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      const writes: string[] = [];
      page.on('request', r => { if (/\/api\/scheduling\//.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
      const before = await snapshot(ORG_A);
      await openCalendar(page, court);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);

      const book = page.getByTestId('book-button');
      await expect(book).toBeVisible();
      expect((await book.boundingBox())!.height).toBeGreaterThanOrEqual(44 - 1);
      await book.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: /^Book ZZ Staff booking court/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Choose a date')).toBeVisible({ timeout: 60_000 });
      await expect(dialog.getByTestId('duration')).toHaveText('1 hour');
      await expect(dialog.getByTestId('zone')).toContainText('Australia/Adelaide time');
      await attach(page, info, `${scheme}-date`);
      expect(await violations(page), 'date step').toEqual([]);

      // keyboard only: the first day that has times
      const day = dialog.locator('button[data-empty="false"]').first();
      await expect(day).toBeVisible();
      await day.focus();
      await page.keyboard.press('Enter');
      const times = dialog.getByRole('radio');
      await expect(times.first()).toBeAttached();
      await expect(times).toHaveCount(8);
      await expect(dialog.getByRole('heading', { name: /Choose a start time/ })).toBeFocused();
      await attach(page, info, `${scheme}-time`);
      expect(await violations(page), 'time step').toEqual([]);
      await times.first().focus();
      await page.keyboard.press('ArrowDown');
      await expect(times.nth(1)).toBeChecked();
      await expect(dialog.getByTestId('prepared')).toBeVisible();
      await expect(dialog.getByText(/Nothing has been booked or saved/)).toBeVisible();
      await attach(page, info, `${scheme}-ready`);
      expect(await violations(page), 'ready step').toEqual([]);

      // the page itself does not scroll sideways, the dialog fits the viewport, and the targets are large enough
      const metrics = await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]') as HTMLElement;
        const r = panel.getBoundingClientRect();
        return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, left: r.left, right: r.right, width: window.innerWidth };
      });
      expect(metrics.sideways).toBeLessThanOrEqual(0);
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(metrics.width);
      for (const control of await dialog.locator('button, label').all()) {
        const box = await control.boundingBox();
        if (box && (await control.isVisible())) expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(30); // the close icon is 30px by the shared Dialog; every action is 44px
      }
      if (isMobile(info)) expect((await dialog.boundingBox())!.width).toBeGreaterThan(300);

      // Escape closes it and focus returns to the Book button
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(book).toBeFocused();

      // nothing was written, anywhere
      expect(writes).toEqual([]);
      expect(await snapshot(ORG_A)).toBe(before);
      await context.close();
    });
  });
}

test.describe('switch ON: a gate closing under the user', () => {
  test.beforeEach(() => test.skip(!switchOn, 'switch is off in this run'));

  test('a 404 from the booking read closes the dialog and removes the button until reload', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openCalendar(page, court);
    await page.route('**/api/scheduling/reservations/basis**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await page.getByTestId('book-button').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('book-button')).toHaveCount(0);
    await context.close();
  });

  test('a resource with no facility-hire offering explains itself and offers nothing to book', async ({ browser }) => {
    const unlinked = await ensureResource(browser, 'ZZ Staff booking unlinked court');
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await openCalendar(page, unlinked);
    await page.getByTestId('book-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Nothing can be booked on this resource.')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await context.close();
  });
});
