import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { enabled, origin, type Account } from './accounts';
import { api, contextFor, json, query, snapshot } from './support';
import { ORG_A, clearHours, ensureOffering, ensureResource, seedRules, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.describe.configure({ mode: 'serial' });

// Phase 2C.3c UI slices 1-2: the staff booking dialog (selection, customer details, review, submit, recovery, confirmation) in real Chromium at 390 / 768 / 1440 px, both themes, signed in through the real login form as synthetic accounts, against a
// DISPOSABLE PostgreSQL. The harness runs this file in two modes (scripts/tests/verify-scheduling-browser-local.mjs):
//   - SWITCH OFF (default; the capability IS held by organisation A): the Book button must not exist for anyone, the dialog must not render, and the page must make no booking-related request.
//   - SWITCH ON (SCHED_BROWSER_STAFF_BOOKING=on): the button exists exactly for sessions the API would serve (manager with Scheduling "use" in the entitled organisation); the selection steps read only,
//     and the booking workflow writes one booking at a time to the DISPOSABLE database only (each test cancels what it made).
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
    test(`${account}: no Book button, no dialog, no customer form, no booking-related request; every booking endpoint (including the full POST) is 404 and writes nothing`, async ({ browser }) => {
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
      // none of the slice 2 workflow exists in the page either: no dialog, no customer form, no review, no reference
      for (const selector of ['[data-testid="staff-book-dialog"]', 'form#sb-details-form', 'input[name^="sb-"]', 'textarea[name^="sb-"]', '[data-testid="confirm-booking"]', '[data-testid="confirmation"]', '[data-testid="to-details"]']) {
        await expect(page.locator(selector), selector).toHaveCount(0);
      }
      await expect(page.getByText(/Customer details|Review the booking|Booking reference|Confirm booking/)).toHaveCount(0);
      // the complete booking request, replayed by hand against the disabled API, is a plain 404 and writes nothing
      const rows = async () => (await query<{ n: number }>('SELECT (SELECT count(*) FROM scheduling_reservations)::int + (SELECT count(*) FROM scheduling_resource_holds)::int AS n'))[0].n;
      const writesBefore = await rows();
      const post = await context.request.post(api('/reservations'), {
        headers: { ...json, 'Idempotency-Key': `bk_${'0'.repeat(32)}` },
        data: { offeringId: hire.id, resourceId: court.id, start: { date: '2099-01-05', time: '10:00' }, durationMinutes: 60, partySize: 1, customer: { name: 'Off Mode', email: 'off@example.test' }, notes: 'must not be written' },
      });
      if (account === 'viewer') expect(post.status(), 'a viewer is refused by the access layer before the route is reached').toBe(403);
      else expect([post.status(), await post.json().catch(() => null)], `${account} POST /reservations`).toEqual([404, { error: 'not_found' }]);
      expect(await rows()).toBe(writesBefore);
      expect(seen.filter(u => u.startsWith('POST'))).toEqual([]);
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

    test(`opens, reads only until the customer step, completes by keyboard, has no axe violations, does not overflow, and returns focus (${scheme})`, async ({ browser }, info) => {
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
      await expect(dialog.getByRole('button', { name: 'Continue to customer details' })).toBeVisible();
      await expect(dialog.getByTestId('booking-live')).toContainText('Nothing has been booked.');
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

// ── slice 2: the booking workflow ─────────────────────────────────────────────────────────────────────────────────────────────────

const CUSTOMER = { name: 'Browser Customer', email: 'browser.customer@example.test', phone: '0400 111 222', notes: 'Synthetic browser booking' };
const adelaideToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide' }).format(new Date());
let browserRef: Browser | null = null;

async function cancelAllBookings() {
  const manager = await contextFor(browserRef!, 'manager');
  const ids = await query<{ id: string }>("SELECT id FROM scheduling_reservations WHERE organisation_id = $1 AND status = 'confirmed'", [ORG_A]);
  for (const { id } of ids) await manager.request.post(api(`/reservations/${id}/cancel`), { headers: json, data: {} });
  await manager.close();
}

async function openDialog(page: Page) {
  const book = page.getByTestId('book-button');
  await expect(book).toBeVisible({ timeout: 90_000 });
  await book.click();
  const dialog = page.getByRole('dialog', { name: /^Book ZZ Staff booking court/ });
  await expect(dialog.getByText('Choose a date')).toBeVisible({ timeout: 60_000 });
  return dialog;
}
/** The first day with times and the n-th offered start, then on to the customer step. */
async function toDetails(page: Page, nth = 0) {
  const dialog = await openDialog(page);
  await dialog.locator('button[data-empty="false"]').first().click();
  const label = dialog.locator('label:has(input[name="sb-time"])').nth(nth);
  await expect(label).toBeVisible();
  const time = await label.locator('input').getAttribute('value');
  await label.click();
  await dialog.getByTestId('to-details').click();
  await expect(dialog.getByRole('heading', { name: 'Customer details' })).toBeFocused();
  return Object.assign(dialog, { chosenTime: time });
}
async function fillCustomer(dialog: Locator) {
  await dialog.getByLabel(/Customer name/).fill(CUSTOMER.name);
  await dialog.getByLabel(/Customer email/).fill(CUSTOMER.email);
  await dialog.getByLabel(/Customer phone/).fill(CUSTOMER.phone);
  await dialog.getByLabel(/Party size/).fill('2');
  await dialog.getByLabel(/Notes/).fill(CUSTOMER.notes);
}
async function fits(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    const r = panel.getBoundingClientRect();
    return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, left: r.left, right: r.right, width: window.innerWidth };
  });
  expect(m.sideways, `${label}: sideways scroll`).toBeLessThanOrEqual(0);
  expect(m.left, label).toBeGreaterThanOrEqual(0);
  expect(m.right, label).toBeLessThanOrEqual(m.width);
  const dialog = page.getByRole('dialog');
  for (const control of await dialog.locator('button, input:not([type="radio"]), textarea').all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText().catch(() => '')) ?? '';
    if (box) expect(box.height, `${label}: ${name || (await control.getAttribute('name'))}`).toBeGreaterThanOrEqual(/^Close /.test(name) ? 28 : 40);
  }
}
const reservationRows = async () => (await query<{ n: number }>("SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND status = 'confirmed'", [ORG_A]))[0].n;
const liveHoldRows = async () => (await query<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND released_at IS NULL', [ORG_A]))[0].n;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`switch ON, ${scheme} theme: the booking workflow`, () => {
    test.beforeEach(({ browser }) => {
      test.skip(!switchOn, 'switch is off in this run');
      browserRef = browser;
    });
    test.afterEach(async () => {
      if (switchOn) await cancelAllBookings();
    });

    test(`details, review, one POST on a double click, Booked with the full reference, Copy, calendar refresh and focus return (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'manager');
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      const page = await context.newPage();
      await themed(page, scheme);
      const posts: Array<{ key: string | null; body: string; url: string }> = [];
      page.on('request', r => { if (r.method() === 'POST' && /\/api\/scheduling\//.test(r.url())) posts.push({ key: r.headers()['idempotency-key'] ?? null, body: r.postData() ?? '', url: r.url() }); });
      await openCalendar(page, court);
      const before = await reservationRows();
      const dialog = await toDetails(page);
      await fits(page, 'details');
      await attach(page, info, `${scheme}-details`);
      expect(await violations(page), 'details step').toEqual([]);

      // browser autofill is off on every customer field, so the staff member's own details are never inserted
      for (const field of await dialog.locator('form input, form textarea').all()) expect(await field.getAttribute('autocomplete')).toBe('off');

      // validation: an empty name is refused, announced in an alert summary that takes focus, and the summary links to the field
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      const summary = dialog.getByTestId('error-summary');
      await expect(summary).toBeFocused();
      await expect(summary).toHaveAttribute('role', 'alert');
      await expect(summary).toContainText('There is 1 problem to fix.');
      await expect(dialog.getByLabel(/Customer name/)).toHaveAttribute('aria-invalid', 'true');
      await attach(page, info, `${scheme}-errors`);
      expect(await violations(page), 'details with errors').toEqual([]);
      await summary.getByRole('link', { name: /Name:/ }).click();
      await expect(dialog.getByLabel(/Customer name/)).toBeFocused();
      expect(posts).toEqual([]);

      await fillCustomer(dialog);
      // Enter in a field submits the form (the button lives outside the <form> and is tied to it with form="...")
      await dialog.getByLabel(/Customer phone/).press('Enter');
      await expect(dialog.getByRole('heading', { name: 'Review the booking' })).toBeFocused();
      const review = dialog.getByTestId('review-summary');
      for (const text of [CUSTOMER.name, CUSTOMER.email, CUSTOMER.phone, CUSTOMER.notes, 'Australia/Adelaide time', '1 hour']) await expect(review).toContainText(text);
      await expect(dialog.getByText(/No payment is collected through this window/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: /pay|card|checkout/i })).toHaveCount(0);
      await fits(page, 'review');
      await attach(page, info, `${scheme}-review`);
      expect(await violations(page), 'review step').toEqual([]);
      expect(posts, 'nothing is sent before Confirm').toEqual([]);

      // a double click is ONE request
      await dialog.getByTestId('confirm-booking').dblclick();
      await expect(dialog.getByRole('heading', { name: 'Booked' })).toBeFocused({ timeout: 60_000 });
      expect(posts).toHaveLength(1);
      expect(posts[0].key).toMatch(/^bk_[0-9a-f]{32}$/);
      expect(posts[0].url.endsWith('/api/scheduling/reservations')).toBe(true);
      const sent = JSON.parse(posts[0].body) as Record<string, unknown>;
      expect(Object.keys(sent).sort()).toEqual(['basis', 'customer', 'durationMinutes', 'notes', 'offeringId', 'partySize', 'resourceId', 'start']);
      expect(sent.durationMinutes).toBe(60);
      expect(posts[0].body).not.toContain(posts[0].key!);

      const reference = await dialog.getByTestId('reservation-id').inputValue();
      expect(reference.length).toBeGreaterThan(12);
      await expect(dialog.getByTestId('booking-live')).toContainText('Booked.');
      await expect(dialog.getByTestId('confirmation-summary')).toContainText(CUSTOMER.name);
      await expect(dialog.getByText('No payment was collected.')).toBeVisible();
      await fits(page, 'booked');
      await attach(page, info, `${scheme}-booked`);
      expect(await violations(page), 'booked step').toEqual([]);

      // the server holds exactly what the screen says: one reservation, one hold, found by id and by the key
      expect(await reservationRows()).toBe(before + 1);
      expect(await liveHoldRows()).toBe(1);
      const byId = await context.request.get(api(`/reservations/${reference}`));
      expect(byId.status()).toBe(200);
      const booked = (await byId.json()).reservation;
      expect(booked.customer).toEqual({ name: CUSTOMER.name, email: CUSTOMER.email, phone: CUSTOMER.phone });
      expect(booked.partySize).toBe(2);
      const byKey = await context.request.get(api(`/reservations?idempotencyKey=${posts[0].key}`));
      expect((await byKey.json()).reservation.id).toBe(reference);

      // Copy reference
      await dialog.getByTestId('copy-reference').click();
      await expect(dialog.getByTestId('copy-status')).toHaveText('Reference copied.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(reference);

      // nothing in browser storage or the URL
      const stored = await page.evaluate(() => JSON.stringify([Object.entries(sessionStorage), Object.entries(localStorage), document.cookie]));
      expect(stored).not.toMatch(/Browser Customer|browser\.customer|0400 111|bk_/);
      expect(page.url()).not.toMatch(/Browser|bk_|browser\.customer/);

      // Done refreshes the calendar and focus returns to the Book button
      const refreshed = page.waitForRequest(r => /\/resources\/[^/]+\/calendar/.test(r.url()));
      await dialog.getByTestId('booking-done').click();
      await refreshed;
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('book-button')).toBeFocused();
      await context.close();
    });

    test(`a lost reply after the server committed: "Checking whether your booking was saved", then the SAME Booked state, exactly one booking (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      let lost = false;
      const posts: string[] = [];
      await page.route('**/api/scheduling/reservations', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts.push(route.request().headers()['idempotency-key'] ?? '');
        if (lost) return route.fallback();
        lost = true;
        await route.fetch(); // the server processes it for real and commits
        return route.abort('failed'); // ... and the browser never gets the reply
      });
      await openCalendar(page, court);
      const before = await reservationRows();
      const dialog = await toDetails(page);
      await fillCustomer(dialog);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      const checking = dialog.getByRole('heading', { name: 'Checking whether your booking was saved' });
      await expect(checking).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByTestId('booking-live')).toContainText('Do not book again');
      await expect(dialog.getByText(/failed|could not be booked/i)).toHaveCount(0);
      await attach(page, info, `${scheme}-checking`);
      expect(await violations(page), 'checking state').toEqual([]);
      await page.keyboard.press('Escape'); // cannot close while checking
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Booked' })).toBeVisible({ timeout: 30_000 });
      expect(posts).toHaveLength(1);
      expect(await reservationRows()).toBe(before + 1);
      expect(await liveHoldRows()).toBe(1);
      const reference = await dialog.getByTestId('reservation-id').inputValue();
      expect((await (await context.request.get(api(`/reservations/${reference}`))).json()).reservation.customer.name).toBe(CUSTOMER.name);
      await context.close();
    });

    // ── RELOAD RECOVERY (permanent regression): D1 close/reopen and a real page reload, each with the reply lost AFTER the write committed. ──
    test(`RECOVERY D1: lost reply, "could not confirm", Close, reopen: the ORIGINAL booking is recovered; one key; one reservation (${scheme})`, async ({ browser }) => {      test.setTimeout(150_000);
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      const keys: string[] = [];
      let lost = false;
      let blockLookups = true;
      await page.route('**/api/scheduling/reservations', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        keys.push(route.request().headers()['idempotency-key'] ?? '');
        if (lost) return route.fallback();
        lost = true;
        await route.fetch(); // committed for real
        return route.abort('failed'); // the reply is lost
      });
      await page.route(/\/api\/scheduling\/reservations\?idempotencyKey=/, route => (blockLookups ? route.abort('failed') : route.fallback()));
      await openCalendar(page, court);
      const before = await reservationRows();
      const dialog = await toDetails(page);
      await fillCustomer(dialog);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      await expect(dialog.getByRole('heading', { name: /could not confirm whether the booking was saved/ })).toBeVisible({ timeout: 60_000 });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      blockLookups = false;
      await page.getByTestId('book-button').click();
      const reopened = page.getByRole('dialog', { name: /^Book ZZ Staff booking court/ });
      await expect(reopened.getByRole('heading', { name: 'Booked' })).toBeVisible({ timeout: 30_000 });
      expect(new Set(keys).size).toBe(1);
      expect(keys).toHaveLength(1);
      expect(await reservationRows()).toBe(before + 1);
      expect(await liveHoldRows()).toBe(1);
      await context.close();
    });

    test(`RECOVERY refresh: a real page reload while the outcome is unknown reconciles the ORIGINAL key before anything else; no second booking (${scheme})`, async ({ browser }) => {      test.setTimeout(150_000);
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      const keys: string[] = [];
      let lost = false;
      await page.route('**/api/scheduling/reservations', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        keys.push(route.request().headers()['idempotency-key'] ?? '');
        if (lost) return route.fallback();
        lost = true;
        await route.fetch();
        return route.abort('failed');
      });
      await openCalendar(page, court);
      const before = await reservationRows();
      const dialog = await toDetails(page);
      await fillCustomer(dialog);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      await expect(dialog.getByRole('heading', { name: 'Checking whether your booking was saved' })).toBeVisible({ timeout: 30_000 });
      await page.reload(); // the page's memory is gone
      await expect(page.getByTestId('book-button')).toBeVisible({ timeout: 90_000 });
      await page.getByTestId('book-button').click();
      const reopened = page.getByRole('dialog', { name: /^Book ZZ Staff booking court/ });
      await expect(reopened.getByRole('heading', { name: /Booked|earlier booking/ })).toBeVisible({ timeout: 30_000 });
      await expect(reopened.getByText('Choose a date')).toHaveCount(0); // no fresh booking flow was offered
      expect(keys).toHaveLength(1);
      expect(await reservationRows()).toBe(before + 1);
      expect(await liveHoldRows()).toBe(1);
      await context.close();
    });

    test(`RESOURCE_CONFLICT from the real server: the time was taken after the dialog loaded it; the user is returned to fresh times with their details (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      await openCalendar(page, court);
      const dialog = await toDetails(page);
      const taken = dialog.chosenTime;
      await fillCustomer(dialog);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await expect(dialog.getByRole('heading', { name: 'Review the booking' })).toBeVisible();
      const res = await context.request.get(api(`/reservations/basis?offeringId=${hire.id}&resourceId=${court.id}&from=${adelaideToday()}&to=${new Date(Date.parse(`${adelaideToday()}T12:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10)}`));
      const firstDay = ((await res.json()).days as Array<{ date: string; starts: Array<{ time: string }> }>).find(d => d.starts.length > 0)!;
      // a rival booking for exactly that time lands first (an API booking without a basis)
      const rival = await context.request.post(api('/reservations'), {
        headers: { ...json, 'Idempotency-Key': `bk_${randomUUID().replace(/-/g, '')}` },
        data: { offeringId: hire.id, resourceId: court.id, start: { date: firstDay.date, time: taken }, durationMinutes: 60, partySize: 1, customer: { name: 'Rival Booker' } },
      });
      expect(rival.status(), await rival.text()).toBe(201);
      await dialog.getByTestId('confirm-booking').click();
      const heading = dialog.getByRole('heading', { name: /Choose a start time/ });
      await expect(heading).toBeVisible({ timeout: 30_000 });
      await expect(heading).toBeFocused();
      await expect(dialog.getByTestId('booking-live')).toContainText(/just taken/i);
      await expect(dialog.getByTestId('booking-live')).toContainText('Nothing was booked');
      await expect(dialog.locator(`input[name="sb-time"][value="${taken}"]`)).toHaveCount(0); // the taken start is no longer offered
      expect(await reservationRows()).toBe(1); // only the rival's
      await attach(page, info, `${scheme}-conflict`);
      expect(await violations(page), 'returned to time selection').toEqual([]);
      // pick another start: the details are still there, and it books
      await dialog.locator('label:has(input[name="sb-time"])').first().click();
      await dialog.getByTestId('to-details').click();
      await expect(dialog.getByLabel(/Customer name/)).toHaveValue(CUSTOMER.name);
      await expect(dialog.getByLabel(/Customer email/)).toHaveValue(CUSTOMER.email);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      await expect(dialog.getByRole('heading', { name: 'Booked' })).toBeVisible({ timeout: 30_000 });
      expect(await reservationRows()).toBe(2);
      expect(await liveHoldRows()).toBe(2);
      await context.close();
    });

    test(`AVAILABILITY_CHANGED: back to time selection with the details kept and the previous time preselected only if still offered (${scheme})`, async ({ browser }) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await themed(page, scheme);
      let stale = true;
      await page.route('**/api/scheduling/reservations', async route => {
        if (route.request().method() === 'POST' && stale) {
          stale = false;
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'AVAILABILITY_CHANGED', basis: {} }) });
        }
        return route.fallback();
      });
      await openCalendar(page, court);
      const dialog = await toDetails(page, 1);
      const chosen = dialog.chosenTime;
      await fillCustomer(dialog);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      await expect(dialog.getByTestId('booking-live')).toContainText(/available times changed/i, { timeout: 30_000 });
      await expect(dialog.locator(`input[name="sb-time"][value="${chosen}"]`)).toBeChecked(); // still offered: preselected
      await dialog.getByTestId('to-details').click();
      await expect(dialog.getByLabel(/Customer name/)).toHaveValue(CUSTOMER.name);
      await expect(dialog.getByLabel(/Notes/)).toHaveValue(CUSTOMER.notes);
      await dialog.getByRole('button', { name: 'Review booking' }).click();
      await dialog.getByTestId('confirm-booking').click();
      await expect(dialog.getByRole('heading', { name: 'Booked' })).toBeVisible({ timeout: 30_000 });
      expect(await reservationRows()).toBe(1);
      await context.close();
    });
  });
}
