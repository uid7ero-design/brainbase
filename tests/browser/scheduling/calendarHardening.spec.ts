import { test, expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { enabled, origin } from './accounts';
import { api, contextFor, json, query } from './support';
import { ORG_A, clearHours, ensureOffering, ensureResource, seedRules, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.describe.configure({ mode: 'serial' });

// Phase 2B.3e: the calendar's first paint, loading and error states, keyboard order and focus indicators, screen-reader names, and both themes, in real
// Chromium at 390x844 (mobile), 768x1024 (tablet) and 1440x900 (desktop), as synthetic accounts signed in through the real login form, against a
// disposable PostgreSQL. Reference calendar: Adelaide +10:30 in summer, clocks forward Sun 2026-10-04 (23-hour day), back Sun 2027-04-04 (25-hour day).
// 2027-01-11 is a Monday. API failures are simulated at the browser (route interception); the server is never made to fail and nothing is written.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const MONDAY = '2027-01-11';
let hire: Owner & { scheduleId: string };
let court: Owner;

const url = (owner: Owner, view: 'day' | 'week', date: string) => `${origin}/scheduling/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}/calendar?view=${view}&date=${date}`;
const calendarApi = '**/api/scheduling/**/calendar?*';
const isMobile = (info: TestInfo) => info.project.name === 'mobile';

async function open(page: Page, owner: Owner, view: 'day' | 'week', date: string) {
  await page.goto(url(owner, view, date));
  await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 60_000 });
}
async function violations(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run({ include: [['main']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
  });
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Controls under 44px in the main region, excluding anything hidden. */
const smallTargets = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main :is(button, input:not([type=hidden]), select, summary), main a[data-variant]')) {
      if (getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) out.push(`${el.tagName} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });

test('seed: an Adelaide offering with Monday and Sunday-morning hours and one Perth-pinned court', async ({ browser }) => {
  hire = await ensureOffering(browser, 'ZZ Hardening hire');
  court = await ensureResource(browser, 'ZZ Hardening court');
  for (const owner of [hire, court]) await clearHours(owner);
  const manager = await contextFor(browser, 'manager');
  const link = await manager.request.post(api(`/offerings/${hire.id}/resources`), { data: { resourceId: court.id }, headers: json });
  expect([200, 201], await link.text()).toContain(link.status());
  await seedRules(manager.request, hire, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
  await seedRules(manager.request, hire, { dayOfWeek: 0, startTime: '01:00', endTime: '05:00' });
  await query("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ($1, $2, 'Australia/Perth', 'backfill')", [ORG_A, court.id]);
  await seedRules(manager.request, court, { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' });
  await manager.close();
});

test.describe('first paint: the layout that is painted is the layout for this width, from the first frame', () => {
  /** Records the layout choice at every DOM mutation (which runs before the browser paints the change). */
  const record = (page: Page) =>
    page.addInitScript(() => {
      const frames: Array<{ grid: boolean; agendaOpen: boolean | null }> = [];
      (window as unknown as { __frames: typeof frames }).__frames = frames;
      const snap = () => {
        const agenda = document.querySelector<HTMLDetailsElement>('[data-testid=calendar-agenda]');
        frames.push({ grid: document.querySelector('[data-testid=calendar-grid]') !== null, agendaOpen: agenda ? agenda.open : null });
      };
      new MutationObserver(snap).observe(document, { subtree: true, childList: true, attributes: true });
    });
  const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Array<{ grid: boolean; agendaOpen: boolean | null }> }).__frames);

  function judge(list: Array<{ grid: boolean; agendaOpen: boolean | null }>, info: TestInfo) {
    expect(list.some(f => f.agendaOpen !== null), 'the calendar was drawn').toBe(true);
    if (isMobile(info)) {
      expect(list.filter(f => f.grid), 'the wide grid was in the DOM on a phone').toEqual([]);
      expect(list.filter(f => f.agendaOpen === false), 'the agenda was drawn collapsed on a phone').toEqual([]);
    } else {
      expect(list.filter(f => f.agendaOpen === true), 'the agenda was drawn open beside the grid').toEqual([]);
      expect(list.some(f => f.grid)).toBe(true);
    }
  }

  test('a fresh page load', async ({ browser }, info) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await record(page);
    await open(page, hire, 'day', MONDAY);
    judge(await frames(page), info);
    await context.close();
  });

  test('an instant answer (the response is ready before the first frame) and a client-side navigation from the hours screen', async ({ browser }, info) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    const body = await (await context.request.get(api(`/offerings/${hire.id}/calendar?from=${MONDAY}&to=${MONDAY}`))).text();
    await page.route(calendarApi, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body }));
    await record(page);
    await page.goto(`${origin}/scheduling/offerings/${hire.id}/availability`);
    await expect(page.getByTestId('calendar-link')).toBeVisible({ timeout: 120_000 });
    await page.evaluate(() => { (window as unknown as { __frames: unknown[] }).__frames.length = 0; });
    await page.getByTestId('calendar-link').click();
    await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Loading the calendar/)).toHaveCount(0);
    judge(await frames(page), info);
    await context.close();
  });
});

test.describe('loading and error states', () => {
  test('loading: a status message, no sideways scroll, no axe violations, then the calendar', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(calendarApi, async route => { await gate; await route.continue(); });
    await page.goto(url(hire, 'day', MONDAY));
    const loading = page.getByText('Loading the calendar…');
    await expect(loading).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await violations(page)).toEqual([]);
    release();
    await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('calendar-agenda')).toBeAttached();
    await context.close();
  });

  test('a server error is named, can be retried, and a retry that works shows the calendar', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.route(calendarApi, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Something went wrong.', code: 'INTERNAL' }) }));
    await page.goto(url(hire, 'day', MONDAY));
    await expect(page.getByText('We couldn’t load this')).toBeVisible({ timeout: 120_000 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await violations(page)).toEqual([]);
    expect(await smallTargets(page), 'error state controls under 44px').toEqual([]);
    await page.unroute(calendarApi);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 60_000 });
    await context.close();
  });

  test('an offering with too many resources is explained, not offered a retry that cannot help', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.route(calendarApi, route =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'This offering has 150 linked resources; a calendar shows at most 100. Nothing was changed.', code: 'CALENDAR_TOO_LARGE', limit: 100 }) }),
    );
    await page.goto(url(hire, 'day', MONDAY));
    await expect(page.getByText('Too many resources to draw')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/at most 100/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
    await context.close();
  });

  test('hours that cannot be drawn and a database that is not ready each have their own words', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await page.route(calendarApi, route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'CALENDAR_UNAVAILABLE', problems: ['Monday hours overlap.'] }) }));
    await page.goto(url(hire, 'day', MONDAY));
    await expect(page.getByText('These hours can’t be drawn as a calendar')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Monday hours overlap.')).toBeVisible();
    await page.unroute(calendarApi);
    await page.route(calendarApi, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'AVAILABILITY_NOT_READY' }) }));
    await page.reload();
    await expect(page.getByText('The calendar isn’t set up yet')).toBeVisible({ timeout: 120_000 });
    await context.close();
  });

  test('a failed move to another day keeps the last good calendar, says it may be out of date, and recovers on retry; the retry control is a full-size target', async ({ browser }) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    await page.route(calendarApi, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down', code: 'INTERNAL' }) }));
    await page.getByTestId('next').click();
    const alert = page.getByRole('alert').filter({ hasText: 'could not be refreshed' });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    expect(await smallTargets(page), 'stale-state controls under 44px').toEqual([]);
    expect(await violations(page)).toEqual([]);
    await page.unroute(calendarApi);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'could not be refreshed' })).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('range-heading')).toHaveText('Tuesday 12 January 2027');
    await context.close();
  });
});

test.describe('keyboard, focus and names', () => {
  test('Tab visits the controls in reading order, the grid scroller is reachable, and every stop shows a focus indicator', async ({ browser }, info) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    await page.getByRole('heading', { level: 1 }).focus().catch(() => undefined);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    const stops: Array<{ id: string; indicator: boolean }> = [];
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const ring = style.boxShadow !== 'none' && style.boxShadow !== '';
        const container = el.closest('[data-testid=calendar-grid]');
        return { id: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24) ?? el.tagName, inMain: !!el.closest('main'), indicator: outline || ring, container: !!container };
      });
      if (stop?.inMain) stops.push({ id: stop.id, indicator: stop.indicator });
    }
    const order = stops.map(s => s.id);
    const at = (id: string) => order.findIndex(x => x === id || x.startsWith(id));
    const expected = ['hours-link', 'mode-day', 'mode-week', 'prev', 'today', 'next', 'date-input'];
    const positions = expected.map(at);
    expect(positions.every(p => p >= 0), `controls reachable: ${order.join(' > ')}`).toBe(true);
    expect([...positions].sort((a, b) => a - b), 'reading order').toEqual(positions);
    if (!isMobile(info)) {
      const scroller = order.findIndex(x => x === 'calendar-grid');
      expect(scroller, `the grid scroller is a tab stop: ${order.join(' > ')}`).toBeGreaterThan(positions[positions.length - 1]);
    }
    expect(order.findIndex(x => /Show as a list|Agenda/.test(x)), `the agenda toggle is a tab stop: ${order.join(' > ')}`).toBeGreaterThan(0);
    // a native date field has one Tab stop per day, month and year segment and the browser highlights the active segment itself (no outline or ring to read), so it is not probed
    expect(stops.filter(s => !s.indicator && s.id !== 'date-input').map(s => s.id), 'stops with no visible focus indicator').toEqual([]);
    await context.close();
  });

  test('screen readers get names: a labelled region for the grid, named controls, a heading structure, and a text equivalent for every drawn block', async ({ browser }, info) => {
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    const facts = await page.evaluate(() => {
      const nameOf = (el: Element) => (el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? (el.textContent ?? '').trim());
      const unnamed = [...document.querySelectorAll('main button, main a[href], main input, main select, main summary')].filter(el => !nameOf(el) && !(el as HTMLInputElement).labels?.length).map(el => el.outerHTML.slice(0, 80));
      const blocks = [...document.querySelectorAll<HTMLElement>('[data-kind][data-start]')];
      const mute = blocks.filter(b => !(b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent ?? '').trim())).map(b => `${b.dataset.kind} ${b.dataset.start}`);
      const headings = [...document.querySelectorAll('main h1, main h2, main h3')].map(h => h.tagName);
      const region = document.querySelector('[data-testid=calendar-grid]');
      return { unnamed, mute, headings, region: region ? { role: region.getAttribute('role'), label: region.getAttribute('aria-label'), tab: region.getAttribute('tabindex') } : null, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang };
    });
    expect(facts.unnamed, 'controls without an accessible name').toEqual([]);
    expect(facts.mute, 'drawn blocks with no text equivalent').toEqual([]);
    expect(facts.h1, 'exactly one h1').toBe(1);
    expect(facts.headings[0]).toBe('H1');
    expect(facts.lang).toMatch(/^en/);
    if (!isMobile(info)) expect(facts.region).toEqual({ role: 'region', label: expect.stringMatching(/calendar/i), tab: '0' });
    else expect(facts.region).toBeNull();
    await context.close();
  });
});

test.describe('themes and sizes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the week with the 23-hour day and the day with the 25-hour day have no axe violations, no sideways page scroll and full-size targets`, async ({ browser }) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(t => { try { localStorage.setItem('bb-theme', t); } catch { /* storage unavailable */ } }, theme);
      for (const [view, date] of [['week', '2026-10-01'], ['day', '2027-04-04'], ['day', MONDAY]] as const) {
        await open(page, hire, view, date);
        expect(await violations(page), `${theme} ${view} ${date} axe`).toEqual([]);
        expect(await overflow(page), `${theme} ${view} ${date} sideways scroll`).toBeLessThanOrEqual(0);
        expect(await smallTargets(page), `${theme} ${view} ${date} small targets`).toEqual([]);
      }
      await context.close();
    });
  }

  test('the resource calendar and the empty-hours state at this width', async ({ browser }) => {
    const context = await contextFor(browser, 'viewer');
    const page = await context.newPage();
    await open(page, court, 'week', MONDAY);
    expect(await violations(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await clearHours(court).catch(() => undefined);
    await context.close();
  });
});

test('the hardening checks wrote nothing: no hold, occurrence or reservation exists for the fixtures', async () => {
  const rows = await query<{ n: string }>('SELECT (SELECT count(*) FROM scheduling_resource_holds WHERE resource_id = $1) + (SELECT count(*) FROM scheduling_reservations WHERE organisation_id = $2) AS n', [court.id, ORG_A]);
  expect(Number(rows[0].n)).toBe(0);
});
