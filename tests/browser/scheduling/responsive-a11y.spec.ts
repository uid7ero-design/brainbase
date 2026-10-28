import { test, expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { enabled, origin } from './accounts';
import { contextFor, createOffering, createResource, createSchedule } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');

// Real Chromium viewports (390x844 mobile, 768x1024 tablet, 1440x900 desktop; see playwright.config.ts) x light and dark
// appearance. The application keeps its theme in localStorage 'bb-theme' (app/layout.tsx), so that key is set before load.
// Accessibility uses the repository's axe-core (the engine behind jest-axe / tests/a11y) inside the real page, which, unlike
// jsdom, can compute colour contrast.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const seeded = { scheduleId: '', offeringName: 'ZZ Layout session', resourceName: 'ZZ Layout court' };

test.beforeAll(async ({ browser }) => {
  const context = await contextFor(browser, 'manager');
  const schedule = await createSchedule(context.request, 'ZZ Layout schedule');
  await createOffering(context.request, schedule.id, seeded.offeringName);
  await createResource(context.request, seeded.resourceName);
  seeded.scheduleId = schedule.id;
  await context.close();
});

const PAGES: Array<[string, () => string, RegExp]> = [
  ['overview', () => '/scheduling', /Active schedules/i],
  ['schedules', () => '/scheduling/schedules', /ZZ Layout schedule/],
  ['resources', () => '/scheduling/resources', /ZZ Layout court/],
  ['schedule detail', () => `/scheduling/schedules/${seeded.scheduleId}`, /ZZ Layout session/],
];

async function prepare(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(theme => { try { localStorage.setItem('bb-theme', theme); } catch { /* storage unavailable */ } }, scheme);
}
async function show(page: Page, url: string, ready: RegExp) {
  await page.goto(`${origin}${url}`);
  await expect(page.locator('main')).toContainText(ready, { timeout: 90_000 });
  await expect(page.locator('main').getByText(/Loading/)).toHaveCount(0, { timeout: 60_000 });
}
/** The Scheduling-owned DOM: the page content and the module navigation. The shared app header is not this module's. */
const REGIONS = 'main, [aria-label="Scheduling"]';

async function violations(page: Page, include: string[] = REGIONS.split(', ')) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async selectors => {
    const present = selectors.filter(s => document.querySelector(s));
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[]; failureSummary?: string }> }> }> } }).axe;
    const result = await axe.run({ include: present.map(s => [s]) }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
  }, include);
}
async function attach(page: Page, info: TestInfo, name: string) {
  await info.attach(`${info.project.name}-${name}`, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} appearance`, () => {
    for (const [name, url, ready] of PAGES) {
      test(`${name}: real viewport, no overflow, accessible, touch targets (${scheme})`, async ({ browser }, info) => {
        const context = await contextFor(browser, 'manager');
        const page = await context.newPage();
        await prepare(page, scheme);
        await show(page, url(), ready);
        const viewport = info.project.use.viewport!;
        expect(await page.evaluate(() => window.innerWidth), 'the real viewport width').toBe(viewport.width);
        expect(await page.evaluate(() => document.documentElement.dataset.theme), 'the requested appearance is applied').toBe(scheme);

        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          const wide = [...document.querySelectorAll('main *, [aria-label="Scheduling"] *')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); })
            .slice(0, 5).map(e => `${e.tagName}.${String(e.className).slice(0, 40)}`);
          return { scroll: de.scrollWidth, inner: window.innerWidth, wide };
        });
        expect(overflow.scroll, `horizontal overflow: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.inner + 1);
        expect(overflow.wide, 'no Scheduling element may extend past the viewport').toEqual([]);

        expect(await violations(page), 'axe violations (WCAG 2.2 AA, including contrast) in the Scheduling regions').toEqual([]);

        // WCAG 2.5.8 target size (AA): a target must be at least 24 x 24 CSS px UNLESS the "spacing" exception holds: a 24 px
        // circle centred on it intersects neither another target nor the circle of another undersized target.
        const sizes = await page.evaluate(regions => {
          type T = { label: string; x: number; y: number; w: number; h: number };
          const all: T[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(regions.split(', ').map(r => `${r} :is(a[href], button, input:not([type=hidden]), select, textarea, [role=button])`).join(', '))) {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true]')) continue;
            all.push({ label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height });
          }
          const small = (t: T) => t.w < 24 || t.h < 24;
          const circleHitsRect = (cx: number, cy: number, t: T) => {
            const nx = Math.max(t.x, Math.min(cx, t.x + t.w)), ny = Math.max(t.y, Math.min(cy, t.y + t.h));
            return Math.hypot(cx - nx, cy - ny) < 12;
          };
          const failing = all.filter(t => {
            if (!small(t)) return false;
            const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
            return all.some(u => u !== t && (circleHitsRect(cx, cy, u) || (small(u) && Math.hypot(cx - (u.x + u.w / 2), cy - (u.y + u.h / 2)) < 24)));
          });
          return { total: all.length, failing: failing.map(t => `${t.label} ${Math.round(t.w)}x${Math.round(t.h)}`), under44: all.filter(t => Math.min(t.w, t.h) < 44).map(t => `${t.label} ${Math.round(t.w)}x${Math.round(t.h)}`) };
        }, REGIONS);
        if (sizes.under44.length) info.annotations.push({ type: 'touch-targets-under-44', description: `${sizes.under44.length}/${sizes.total}: ${sizes.under44.slice(0, 6).join('; ')}` });
        expect(sizes.failing, 'WCAG 2.5.8 (AA) target size: at least 24 x 24 CSS px, or the spacing exception').toEqual([]);
        await attach(page, info, `${name.replace(/ /g, '-')}-${scheme}`);
        await context.close();
      });
    }

    test(`dialogs: size, focus trap, Escape, focus return and announced errors (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'manager');
      const page = await context.newPage();
      await prepare(page, scheme);
      await show(page, '/scheduling/schedules', /ZZ Layout schedule/);
      const viewport = info.project.use.viewport!;
      const trigger = page.getByRole('button', { name: 'New schedule', exact: true }).first();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'New schedule' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');

      const box = (await dialog.boundingBox())!;
      expect(box.x, 'dialog left edge').toBeGreaterThanOrEqual(0);
      expect(box.y, 'dialog top edge').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'dialog right edge').toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.y + box.height, 'dialog bottom edge').toBeLessThanOrEqual(viewport.height + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow with the dialog open').toBe(true);
      const dialogScrollable = await dialog.evaluate(el => [...el.querySelectorAll('*'), el].some(e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)));
      if (box.height >= viewport.height - 2) expect(dialogScrollable, 'a full-height dialog must scroll inside itself').toBe(true);

      expect(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus moves into the dialog').toBe(true);
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(el => el.contains(document.activeElement)), `Tab ${i + 1} stays inside the dialog`).toBe(true);
      }
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await dialog.evaluate(el => el.contains(document.activeElement)), `Shift+Tab ${i + 1} stays inside the dialog`).toBe(true);
      }

      // an empty name is a local validation error: it must be announced (an alert or live region), tied to the dialog
      await dialog.getByRole('button', { name: 'Create schedule', exact: true }).click();
      const alert = dialog.getByRole('alert');
      await expect(alert, 'validation errors are announced to assistive technology').toContainText('Please fix the following');
      expect(await violations(page, ['[role=dialog]']), 'axe violations inside the open dialog').toEqual([]);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'focus returns to the control that opened the dialog').toBe('New schedule');
      await attach(page, info, `dialog-${scheme}`);
      await context.close();
    });
  });
}

test('keyboard: every control on the schedules page is reachable in a sensible order with a visible focus indicator', async ({ browser }, info) => {
  test.skip(info.project.name === 'tablet', 'Same layout as desktop for keyboard order.');
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await prepare(page, 'dark');
  await show(page, '/scheduling/schedules', /ZZ Layout schedule/);
  const stops: Array<{ label: string; indicator: boolean; inMain: boolean }> = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '') || s.borderColor !== '';
      return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), indicator: visible, inMain: !!el.closest('main') };
    });
    if (stop) stops.push(stop);
  }
  const labels = stops.map(s => s.label);
  expect(labels, 'the New schedule control is reachable by keyboard').toContain('New schedule');
  expect(labels.indexOf('Schedules'), 'module navigation comes before the page content').toBeLessThan(labels.indexOf('New schedule'));
  expect(stops.filter(s => !s.indicator), 'every stop shows a focus indicator').toEqual([]);
  await page.getByRole('button', { name: 'New schedule', exact: true }).first().focus();
  const indicator = await page.evaluate(() => { const s = getComputedStyle(document.activeElement as HTMLElement); return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow }; });
  expect(indicator.outline !== 'none' || indicator.shadow !== 'none', `focused primary button must be visibly focused: ${JSON.stringify(indicator)}`).toBe(true);
  await context.close();
});

test('mobile navigation: the module strip is reachable and navigates between Overview, Schedules and Resources', async ({ browser }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile layout only.');
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await prepare(page, 'dark');
  await show(page, '/scheduling', /Active schedules/i);
  const nav = page.getByRole('navigation', { name: 'Scheduling' }).or(page.locator('[aria-label="Scheduling"]')).first();
  await expect(nav).toBeVisible();
  for (const [label, heading] of [['Schedules', 'Schedules'], ['Resources', 'Resources'], ['Overview', 'Scheduling']] as const) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible({ timeout: 60_000 });
  }
  await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await context.close();
});
