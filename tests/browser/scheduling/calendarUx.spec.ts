import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { enabled, origin } from './accounts';
import { api, contextFor, json } from './support';
import { clearHours, ensureOffering, ensureResource, seedRules, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
// serial, except for the 'before' evidence run, which must carry on past the failures it is there to show
test.describe.configure({ mode: process.env.SCHED_UX_TAG === 'before' || process.env.SCHED_UX_CONTINUE === '1' ? 'default' : 'serial' });

// Phase 2B.3e follow-up (live acceptance): the day view's time labels, the empty-resource explanation, and how long the calendar takes to load.
// The fixture is the pilot's shape: an offering with Monday 09:00-12:00 hours (Adelaide) and a linked court that has NO hours. Reference calendar:
// Adelaide +10:30 in summer, clocks forward Sun 2026-10-04 (a 23-hour day), back Sun 2027-04-04 (a 25-hour day). 2027-01-11 is a Monday.
//   SCHED_UX_TAG     'before' or 'after': prefixes screenshots and the measurement file
//   SCHED_UX_DIR     where screenshots and measurements are written (default: the system temp directory)
// Measurement tests record numbers and assert only sanity bounds; the geometry, explanation and scrolling tests assert the behaviour.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const MONDAY = '2027-01-11';
const TAG = process.env.SCHED_UX_TAG ?? 'run';
const DIR = process.env.SCHED_UX_DIR ?? path.join(process.env.TEMP ?? '/tmp', 'sched-ux');

let hire: Owner & { scheduleId: string };
let court: Owner;
/** The fixtures by name (they exist after the seed test; a worker restarted by a failure has lost the variables, not the rows). */
async function fixtures(browser: import('@playwright/test').Browser) {
  hire ??= await ensureOffering(browser, 'ZZ UX Junior Squad');
  court ??= await ensureResource(browser, 'ZZ UX Court 1');
}

const url = (owner: Owner, view: 'day' | 'week', date?: string) =>
  `${origin}/scheduling/${owner.kind === 'resource' ? 'resources' : 'offerings'}/${owner.id}/calendar${date ? `?view=${view}&date=${date}` : ''}`;
const isMobile = (info: TestInfo) => info.project.name === 'mobile';

async function open(page: Page, owner: Owner, view: 'day' | 'week', date: string) {
  await page.goto(url(owner, view, date));
  await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 60_000 });
}
async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, `${TAG}-${info.project.name}-${name}.png`), await page.screenshot({ fullPage: true }));
}
function record(info: TestInfo, key: string, value: unknown) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(path.join(DIR, `${TAG}-measurements.jsonl`), `${JSON.stringify({ project: info.project.name, key, value })}\n`);
}
async function violations(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run({ include: [['main']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id}: ${v.help}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  });
}

/**
 * Where every time label is, against the box that is supposed to hold it. A label is CUT when it straddles the bottom edge of the sticky header or an edge of the
 * scroll box (half under the header, half visible); one that is wholly scrolled out of view is not clipped, it is just not on screen. `at` is where the box is
 * resting: 'rest' (as drawn), 'top' (scrollTop 0) or 'bottom' (scrolled to the end).
 */
async function labelGeometry(page: Page, at: 'rest' | 'top' | 'bottom' = 'rest') {
  await page.getByTestId('calendar-grid').evaluate((el, where) => {
    if (where === 'top') el.scrollTop = 0;
    if (where === 'bottom') el.scrollTop = el.scrollHeight;
  }, at);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid=calendar-grid]')!;
    const axis = scroller.querySelector<HTMLElement>('[aria-hidden=true][class*=calAxis]')!;
    const head = scroller.querySelector<HTMLElement>('[class*=calHead]')!;
    const s = scroller.getBoundingClientRect();
    const a = axis.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    const straddles = (top: number, bottom: number, edge: number) => top < edge - 0.5 && bottom > edge + 0.5;
    const labels = [...axis.querySelectorAll<HTMLElement>('[class*=calTick] > span')].map(span => {
      const r = span.getBoundingClientRect();
      return {
        text: span.textContent,
        aboveAxisBy: Math.round((a.top - r.top) * 10) / 10, // > 0: the label starts above the time column
        belowAxisBy: Math.round((r.bottom - a.bottom) * 10) / 10, // > 0: it ends below it
        cutAtTop: straddles(r.top, r.bottom, h.bottom) || straddles(r.top, r.bottom, h.top) || straddles(r.top, r.bottom, s.top), // half under the sticky header, or across the top edge
        cutAtBottom: straddles(r.top, r.bottom, s.bottom), // across the bottom edge of the box
        inView: r.top >= h.bottom - 0.5 && r.bottom <= s.bottom + 0.5,
        height: Math.round(r.height * 10) / 10,
      };
    });
    return { scroller: { top: s.top, bottom: s.bottom, h: s.height, scrollH: scroller.scrollHeight, clientH: scroller.clientHeight, scrollTop: Math.round(scroller.scrollTop), overflowY: getComputedStyle(scroller).overflowY }, head: { top: h.top, bottom: h.bottom }, axisTop: a.top, labels };
  });
}

test('seed: the pilot shape, an offering with Monday 09:00-12:00 and a linked court with no hours', async ({ browser }) => {
  hire = await ensureOffering(browser, 'ZZ UX Junior Squad');
  court = await ensureResource(browser, 'ZZ UX Court 1');
  await clearHours(hire);
  await clearHours(court);
  const manager = await contextFor(browser, 'manager');
  const link = await manager.request.post(api(`/offerings/${hire.id}/resources`), { data: { resourceId: court.id }, headers: json });
  expect([200, 201], await link.text()).toContain(link.status());
  await seedRules(manager.request, hire, { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' });
  await manager.close();
});

test.describe('1. time labels', () => {
  for (const [name, date] of [['an ordinary day', MONDAY], ['the 23-hour day', '2026-10-04'], ['the 25-hour day', '2027-04-04']] as const) {
    test(`day view, ${name}: every label is whole, inside the time column, and not under the header`, async ({ browser }, info) => {
    await fixtures(browser);
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await open(page, hire, 'day', date);
      await shot(page, info, `labels-${date}`);
      if (isMobile(info)) {
        // below 768px the grid is not drawn: the agenda carries the same information as text, with no positioned labels to clip
        await expect(page.getByTestId('calendar-grid')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        await context.close();
        return;
      }
      for (const at of ['rest', 'top', 'bottom'] as const) {
        const g = await labelGeometry(page, at);
        record(info, `labels:${date}:${at}`, g);
        expect(g.labels.length).toBeGreaterThanOrEqual(7);
        expect(g.labels.filter(l => l.inView).length, `${at}: some labels are on screen`).toBeGreaterThan(0);
        // Where the page puts the box (as drawn, and at the top) nothing is cut anywhere. Scrolled by hand to the end, labels have passed under the header like any scrolled
        // content, so only the bottom edge is checked there.
        // 'rest' is where the page puts the box: nothing is cut anywhere. 'top' and 'bottom' are the ends of the scroll range, forced here: the end itself is checked (the
        // header / top edge at the top, the bottom edge at the bottom). A label at the OTHER edge of a forced position is just scrolled content running off the box.
        const cut = (l: (typeof g.labels)[number]) => (at === 'rest' ? l.cutAtTop || l.cutAtBottom : at === 'top' ? l.cutAtTop : l.cutAtBottom);
        const bad = g.labels.filter(l => l.aboveAxisBy > 0.5 || l.belowAxisBy > 0.5 || cut(l));
        expect(bad, `${at}: ${JSON.stringify(bad)}`).toEqual([]);
      }
      // at the very top the first label (00:00) is on screen and whole, just below its line
      const top = await labelGeometry(page, 'top');
      expect(top.labels[0]).toMatchObject({ text: '00:00', inView: true, cutAtTop: false });
      await context.close();
    });
  }

  test('the grid scrolls inside its own box, so the header and the time column stay in view; the first open hour is on screen without scrolling', async ({ browser }, info) => {
    await fixtures(browser);
    test.skip(isMobile(info), 'the agenda, not the grid, is drawn below 768px');
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    const before = await labelGeometry(page, 'rest');
    record(info, 'scroller', before.scroller);
    expect(before.scroller.scrollH, 'the grid is taller than its box, so it scrolls inside it').toBeGreaterThan(before.scroller.clientH);
    expect(['auto', 'scroll']).toContain(before.scroller.overflowY);
    // the 09:00-12:00 block is visible without the user scrolling
    const hours = page.getByTestId('calendar-grid').locator('[data-kind=hours][data-start]').first();
    const hb = (await hours.boundingBox())!;
    const sb = (await page.getByTestId('calendar-grid').boundingBox())!;
    expect(hb.y).toBeGreaterThanOrEqual(sb.y);
    expect(hb.y + hb.height).toBeLessThanOrEqual(sb.y + sb.height + 1);
    // scroll the grid to the bottom: the header is still at the top of the box
    const headTopBefore = (await page.getByTestId(`lane-head-${hire.id}`).boundingBox())!.y;
    await page.getByTestId('calendar-grid').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const headTopAfter = (await page.getByTestId(`lane-head-${hire.id}`).boundingBox())!.y;
    expect(Math.abs(headTopAfter - headTopBefore), 'the sticky header moved with the content').toBeLessThanOrEqual(1);
    await shot(page, info, 'scrolled-to-bottom');
    await context.close();
  });

  test('keyboard: the grid takes focus, the arrow and page keys scroll it, and the focus ring is visible', async ({ browser }, info) => {
    await fixtures(browser);
    test.skip(isMobile(info), 'the agenda, not the grid, is drawn below 768px');
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    const grid = page.getByTestId('calendar-grid');
    await grid.focus();
    await expect(grid).toBeFocused();
    const ring = await grid.evaluate(el => { const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; });
    expect(ring, 'no focus ring on the scroll region').toBe(true);
    // the browser animates key scrolling, so each position is polled for, not read once
    const top = () => grid.evaluate(el => Math.round(el.scrollTop));
    await page.keyboard.press('Home');
    await expect.poll(top, { message: 'Home goes to the top of the grid' }).toBe(0);
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(top, { message: 'the arrow keys scrolled the page, not the grid' }).toBeGreaterThan(0);
    const arrows = await top();
    await page.keyboard.press('PageDown');
    await expect.poll(top, { message: 'PageDown moves further' }).toBeGreaterThan(arrows);
    await page.keyboard.press('End');
    await expect.poll(() => grid.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), { message: 'End goes to the end of the grid' }).toBe(true);
    // and back up from the end: the grid is not stuck at the bottom
    const atEnd = await top();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    await expect.poll(top, { message: 'ArrowUp scrolls back up from the end' }).toBeLessThan(atEnd);
    await context.close();
  });
});

test.describe('2. an offering whose court has no hours', () => {
  test('the screen says, in words and not by colour alone: the offering has hours, the court has none, so nothing is bookable', async ({ browser }, info) => {
    await fixtures(browser);
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    await shot(page, info, 'empty-court-day');
    const box = page.getByTestId('calendar-explainer');
    await expect(box).toBeVisible();
    await expect(page.getByTestId('explain-offering')).toContainText('Offering hours are set');
    await expect(page.getByTestId('explain-offering')).toContainText('09:00');
    await expect(page.getByTestId(`explain-resource-${court.id}`)).toContainText('has no hours');
    await expect(page.getByTestId('explain-bookable')).toContainText('No bookable times');
    await expect(page.getByTestId('explain-bookable')).toContainText('needs');
    // a manager is pointed at where to fix it; nothing is created from here
    await expect(page.getByTestId(`explain-resource-${court.id}`).getByRole('link', { name: /set hours|add hours|edit hours/i })).toHaveAttribute('href', new RegExp(`/scheduling/resources/${court.id}/availability`));
    expect(await violations(page)).toEqual([]);
    await context.close();
  });

  test('the empty court column is labelled in place, and is not mistaken for a closure', async ({ browser }, info) => {
    await fixtures(browser);
    test.skip(isMobile(info), 'the agenda, not the grid, is drawn below 768px');
    const context = await contextFor(browser, 'viewer');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    const col = page.locator(`[data-lane="${court.id}"]`);
    await expect(page.getByTestId(`lane-empty-${court.id}`)).toContainText('No hours set');
    // the label is on screen where the grid opens (it stays below the lane headers), not scrolled away above the working hours
    const card = (await page.getByTestId(`lane-empty-${court.id}`).boundingBox())!;
    const box = (await page.getByTestId('calendar-grid').boundingBox())!;
    const head = (await page.getByTestId(`lane-head-${court.id}`).boundingBox())!;
    expect(card.y, 'the label is below the lane header').toBeGreaterThanOrEqual(head.y + head.height - 1);
    expect(card.y + card.height, 'the label is inside the grid box').toBeLessThanOrEqual(box.y + box.height);
    await expect(col.locator('[data-kind=closed]')).toHaveCount(0);
    await expect(col.locator('[data-kind=slot][data-start]')).toHaveCount(0);
    await expect(page.getByTestId(`lane-head-${court.id}`)).toContainText('No hours');
    // a viewer is told the same, and is not offered a link they cannot use for editing
    await expect(page.getByTestId(`explain-resource-${court.id}`).getByRole('link', { name: /view hours/i })).toBeVisible();
    await context.close();
  });

  test('the same words on a phone (agenda) and in the week view', async ({ browser }, info) => {
    await fixtures(browser);
    const context = await contextFor(browser, 'viewer');
    const page = await context.newPage();
    await open(page, hire, 'week', MONDAY);
    await expect(page.getByTestId('explain-bookable')).toContainText('No bookable times');
    const agenda = page.getByTestId(`agenda-${MONDAY}`);
    if (isMobile(info)) await expect(agenda).toContainText('no hours set');
    else {
      // the week shows one lane at a time on wide screens: choose the court, which is then drawn with a note, and read it in the agenda too
      await page.getByTestId('lane-select').selectOption(court.id);
      await expect(page.getByTestId(`lane-empty-${court.id}`)).toContainText('No hours set');
      await page.getByTestId('calendar-agenda').locator('summary').click();
    }
    await expect(agenda).toContainText(/ZZ UX Court 1.*no hours set/);
    await shot(page, info, 'empty-court-week');
    await context.close();
  });

  test('when the court has hours the explanation says so and the bookable times are listed (nothing is created by looking)', async ({ browser }) => {
    await fixtures(browser);
    const manager = await contextFor(browser, 'manager');
    await seedRules(manager.request, court, { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' });
    const page = await manager.newPage();
    await open(page, hire, 'day', MONDAY);
    await expect(page.getByTestId(`explain-resource-${court.id}`)).toContainText('has hours');
    await expect(page.getByTestId('explain-bookable')).toContainText(/\d+ bookable/);
    await clearHours(court); // leave the fixture as the pilot's shape
    await manager.close();
  });
});

test.describe('3. how long the calendar takes', () => {
  interface Timing { name: string; start: number; requestStart: number; responseStart: number; responseEnd: number; server: string }
  async function install(page: Page) {
    await page.addInitScript(() => {
      const w = window as unknown as { __marks: Record<string, number> };
      w.__marks = {};
      const mark = (k: string) => { if (!(k in w.__marks)) w.__marks[k] = Math.round(performance.now()); };
      const look = () => {
        if (document.querySelector('[data-testid=calendar-screen]') && !document.body.innerText.includes('Loading the calendar')) mark('rendered');
        if (document.body && document.body.innerText.includes('Loading the calendar')) mark('loadingShown');
        if (document.querySelector('h1')) mark('firstHeading');
      };
      new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
    });
  }
  async function readTimings(page: Page) {
    return page.evaluate(() => {
      const w = window as unknown as { __marks: Record<string, number> };
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const api = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter(e => e.name.includes('/api/scheduling/'))
        .map(e => ({ name: e.name.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\?.*/, '?…'), start: Math.round(e.startTime), requestStart: Math.round(e.requestStart), responseStart: Math.round(e.responseStart), responseEnd: Math.round(e.responseEnd), server: (e.serverTiming ?? []).map(t => `${t.name};${Math.round(t.duration)}`).join(',') }));
      return { marks: w.__marks, html: { ttfb: Math.round(nav.responseStart), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) }, api };
    });
  }

  test('a cold open of the calendar with no date in the address (the link from the other screens): when each request starts, how long the API takes, and when the calendar appears', async ({ browser }, info) => {
    await fixtures(browser);
    const runs: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await install(page);
      await page.goto(url(hire, 'day'));
      await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText(/Loading the calendar/)).toHaveCount(0, { timeout: 60_000 });
      const t = await readTimings(page);
      const calendar = (t.api as Timing[]).find(x => x.name.includes('/calendar'));
      const status = (t.api as Timing[]).find(x => x.name.endsWith('/status?…') || x.name.includes('/status'));
      runs.push({ ...t, derived: { apiRequests: t.api.length, calendarStartsAfterStatusEnds: calendar && status ? calendar.start - status.responseEnd : null, calendarApiMs: calendar ? calendar.responseEnd - calendar.requestStart : null, renderAfterCalendarMs: calendar && t.marks.rendered ? t.marks.rendered - calendar.responseEnd : null } });
      if (i === 0) await shot(page, info, 'cold-open');
      await context.close();
    }
    record(info, 'cold-open', runs);
    expect(runs).toHaveLength(3);
    // the screen already knows the organisation's zone from its page, so it never asks /status first and nothing waits for it
    for (const run of runs as Array<{ api: Timing[] }>) expect(run.api.filter(x => x.name.includes('/status')), 'the calendar waited on a /status request').toEqual([]);
    for (const run of runs as Array<{ api: Timing[]; derived: { apiRequests: number } }>) expect(run.derived.apiRequests, JSON.stringify(run.api.map(x => x.name))).toBe(1);
  });

  test('switching: how many API requests each action makes, and whether any is repeated for nothing', async ({ browser }, info) => {
    await fixtures(browser);
    const context = await contextFor(browser, 'manager');
    const page = await context.newPage();
    await open(page, hire, 'day', MONDAY);
    const seen: string[] = [];
    page.on('request', r => { if (r.url().includes('/api/scheduling/')) seen.push(r.url().replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')); });
    const steps: Record<string, string[]> = {};
    const step = async (name: string, act: () => Promise<void>) => {
      seen.length = 0;
      await act();
      await expect(page.getByText(/Updating…|Loading the calendar/)).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(400);
      steps[name] = [...seen];
    };
    await step('day to week', () => page.getByTestId('mode-week').click());
    await step('week to day', () => page.getByTestId('mode-day').click());
    await step('next day', () => page.getByTestId('next').click());
    await step('previous day', () => page.getByTestId('prev').click());
    await step('change step', async () => { if (await page.getByTestId('step-select').count()) await page.getByTestId('step-select').selectOption('30'); });
    await step('reselect the same view', () => page.getByTestId('mode-day').click());
    record(info, 'requests-per-action', steps);
    expect(Object.keys(steps)).toHaveLength(6);
    await context.close();
  });
});
