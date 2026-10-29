import { test, expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { enabled } from './accounts';
import { contextFor } from './support';
import { clearHours, dateInputs, ensureOffering, ensureResource, openHours, seedClosure, seedRules, timeInputs, type Owner } from './availabilitySupport';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.describe.configure({ mode: 'serial' });

// Phase 2B.3c: the hours screens in real Chromium at 390 (mobile), 768 (tablet) and 1440 (desktop) px, in the light and dark appearance:
// no horizontal overflow, axe (WCAG 2.2 AA, with colour contrast) on the page and inside the open dialogs, 44 px touch targets (product
// decision E), a focus trap, Escape, focus return, announced errors, and a complete keyboard-only path. The application keeps its theme in
// localStorage 'bb-theme', so that key is set before load.

const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const REGIONS = 'main, [aria-label="Scheduling"]';

let populated: Owner;
let empty: Owner & { scheduleId: string };

test('seed: a resource with weekly hours, an overnight window and closures, and an offering with none', async ({ browser }) => {
  populated = await ensureResource(browser, 'ZZ Layout hours court');
  empty = await ensureOffering(browser, 'ZZ Layout hours hire');
  await clearHours(populated);
  await clearHours(empty);
  const manager = await contextFor(browser, 'manager');
  await seedRules(manager.request, populated, { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', label: 'Day' });
  await seedRules(manager.request, populated, { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', overnight: true });
  await seedRules(manager.request, populated, { dayOfWeek: 0, startTime: '00:00', endTime: '24:00' });
  await seedClosure(manager.request, populated, { fromDate: '2027-12-25', toDate: '2027-12-26', reason: 'Christmas' });
  await seedClosure(manager.request, populated, { fromDate: '2027-04-02', toDate: '2027-04-02', startTime: '12:00', endTime: '13:30', reason: 'Staff lunch' });
  await manager.close();
});

async function prepare(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(theme => { try { localStorage.setItem('bb-theme', theme); } catch { /* storage unavailable */ } }, scheme);
}
async function violations(page: Page, include: string[] = REGIONS.split(', ')) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async selectors => {
    const present = selectors.filter(s => document.querySelector(s));
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run({ include: present.map(s => [s]) }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(v => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`);
  }, include);
}
async function attach(page: Page, info: TestInfo, name: string) {
  await info.attach(`${info.project.name}-${name}`, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
}
/** Controls whose target is smaller than 44 x 44 CSS px. A checkbox or radio is measured by its label (the whole row is the target). Inline text links are exempt. */
async function under44(page: Page, scope: string): Promise<string[]> {
  return page.evaluate(selector => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${selector} :is(button, input:not([type=hidden]), select, textarea)`)) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true]')) continue;
      const input = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
      const target = input ? (el.closest('label') ?? el) : el;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (Math.min(r.width, r.height) < 43.5) out.push(`${(el.getAttribute('aria-label') || el.innerText || el.getAttribute('type') || el.tagName).trim().slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}
async function overflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.querySelectorAll('main *, [aria-label="Scheduling"] *')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); })
      .slice(0, 5).map(e => `${e.tagName}.${String(e.className).slice(0, 40)}`);
    return { scroll: de.scrollWidth, inner: window.innerWidth, wide };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} appearance`, () => {
    for (const which of ['populated', 'empty'] as const) {
      test(`${which} hours page: real viewport, no overflow, accessible, 44 px targets (${scheme})`, async ({ browser }, info) => {
        const context = await contextFor(browser, 'manager');
        const page = await context.newPage();
        await prepare(page, scheme);
        await openHours(page, which === 'populated' ? populated : empty);
        const viewport = info.project.use.viewport!;
        expect(await page.evaluate(() => window.innerWidth), 'the real viewport width').toBe(viewport.width);
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
        if (which === 'populated') {
          await expect(page.getByText('9:00 am to 5:00 pm').filter({ visible: true }).first()).toBeVisible();
          await expect(page.getByText('10:00 pm to 2:00 am the next day')).toBeVisible();
          await expect(page.getByText('All day', { exact: true }).filter({ visible: true }).first()).toBeVisible();
          await expect(page.getByText('Staff lunch').filter({ visible: true }).first()).toBeVisible();
        } else {
          await expect(page.getByText('No weekly hours yet', { exact: true })).toBeVisible();
          await expect(page.getByTestId('unavailable-state')).toBeVisible();
        }
        const o = await overflow(page);
        expect(o.scroll, `horizontal overflow: ${JSON.stringify(o)}`).toBeLessThanOrEqual(o.inner + 1);
        expect(o.wide, 'no element may extend past the viewport').toEqual([]);
        expect(await violations(page), 'axe violations (WCAG 2.2 AA, including contrast)').toEqual([]);
        expect(await under44(page, 'main'), 'every control on the hours page is at least 44 x 44 CSS px').toEqual([]);
        await attach(page, info, `hours-${which}-${scheme}`);
        await context.close();
      });
    }

    test(`view-only presentation: the same page for a viewer has no controls and stays accessible (${scheme})`, async ({ browser }, info) => {
      const context = await contextFor(browser, 'viewer');
      const page = await context.newPage();
      await prepare(page, scheme);
      await openHours(page, populated);
      await expect(page.getByText('You have view-only access to Scheduling.')).toBeVisible();
      await expect(page.getByRole('button', { name: /^(Add|Edit|Remove|Available)/ })).toHaveCount(0);
      await expect(page.getByText('Staff lunch').filter({ visible: true }).first()).toBeVisible();
      const o = await overflow(page);
      expect(o.scroll).toBeLessThanOrEqual(o.inner + 1);
      expect(await violations(page)).toEqual([]);
      await attach(page, info, `hours-viewer-${scheme}`);
      await context.close();
    });

    for (const [name, title] of [
      ['Add hours', 'Add hours'],
      ['Add closure (part of a day)', 'Add closure'],
    ] as const) {
      test(`${name} dialog: fits the viewport, 44 px targets, focus trap, Escape, focus return, announced errors, accessible (${scheme})`, async ({ browser }, info) => {
        const context = await contextFor(browser, 'manager');
        const page = await context.newPage();
        await prepare(page, scheme);
        await openHours(page, populated);
        const viewport = info.project.use.viewport!;
        const trigger = page.getByRole('button', { name: title === 'Add hours' ? 'Add hours' : 'Add closure', exact: true }).first();
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: title });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        if (name.includes('closure')) await dialog.getByRole('radio', { name: /Part of a day/ }).check();

        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow with the dialog open').toBe(true);
        const scrollable = await dialog.evaluate(el => [...el.querySelectorAll('*'), el].some(e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)));
        if (box.height >= viewport.height - 2) expect(scrollable, 'a full-height dialog must scroll inside itself').toBe(true);

        expect(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus moves into the dialog').toBe(true);
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate(el => el.contains(document.activeElement)), `Tab ${i + 1} stays inside the dialog`).toBe(true);
        }
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Shift+Tab');
          expect(await dialog.evaluate(el => el.contains(document.activeElement)), `Shift+Tab ${i + 1} stays inside the dialog`).toBe(true);
        }
        expect(await under44(page, '[role=dialog]'), 'every control in the dialog is at least 44 x 44 CSS px').toEqual([]);
        expect(await violations(page, ['[role=dialog]']), 'axe violations inside the open dialog').toEqual([]);

        // a local mistake is announced: no days chosen / no date chosen
        if (title === 'Add hours') {
          await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
          await dialog.getByRole('button', { name: 'Add hours', exact: true }).click();
          await expect(dialog.getByRole('alert'), 'validation errors are announced').toContainText('Choose at least one day.');
        } else {
          await dialog.getByRole('button', { name: 'Add closure', exact: true }).click();
          await expect(dialog.getByRole('alert'), 'validation errors are announced').toContainText('Choose the first date.');
        }
        await attach(page, info, `dialog-${title.replace(/ /g, '-')}-${scheme}`);

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'focus returns to the control that opened the dialog').toBe(title === 'Add hours' ? 'Add hours' : 'Add closure');
        await context.close();
      });
    }
  });
}

test('keyboard only: the page is reachable in a sensible order with a visible focus indicator, and a closure can be added without a mouse', async ({ browser }, info) => {
  test.skip(info.project.name === 'tablet', 'The desktop and mobile layouts cover keyboard order.');
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await prepare(page, 'dark');
  await openHours(page, populated);
  const stops: Array<{ label: string; indicator: boolean }> = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '');
      return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60), indicator: visible };
    });
    if (stop) stops.push(stop);
  }
  const labels = stops.map(s => s.label);
  for (const expected of ['Add hours', 'Edit Monday 9:00 am to 5:00 pm', 'Remove Monday 9:00 am to 5:00 pm', 'Add more hours on Monday', 'Add closure']) expect(labels, `${expected} is reachable by keyboard`).toContain(expected);
  expect(labels.indexOf('Add hours'), 'the weekly hours come before the closures').toBeLessThan(labels.indexOf('Add closure'));
  expect(labels.indexOf('Edit Monday 9:00 am to 5:00 pm'), 'Monday comes before Tuesday').toBeLessThan(labels.indexOf('Edit Tuesday 9:00 am to 5:00 pm'));
  expect(stops.filter(s => !s.indicator), 'every stop shows a focus indicator').toEqual([]);

  // open the dialog with Enter, toggle a day with Space, Escape returns focus
  const add = page.getByRole('button', { name: 'Add hours', exact: true }).first();
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add hours' });
  await expect(dialog).toBeVisible();
  const monday = dialog.getByRole('checkbox', { name: 'Monday', exact: true });
  await monday.focus();
  expect(await monday.isChecked()).toBe(true);
  await page.keyboard.press('Space');
  expect(await monday.isChecked(), 'Space toggles a day').toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();

  // a closure, keyboard path: Enter opens, the reason field submits the form with Enter
  await page.getByRole('button', { name: 'Add closure', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  const closure = page.getByRole('dialog', { name: 'Add closure' });
  await expect(closure).toBeVisible();
  await dateInputs(closure).first.fill('2028-02-14');
  const reason = closure.locator('input[type=text]');
  await reason.fill('Keyboard closure');
  const saved = page.waitForResponse(r => r.url().includes('/availability-exceptions') && r.request().method() === 'POST');
  await reason.press('Enter');
  expect((await saved).status()).toBe(201);
  await expect(closure).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Closures' }).or(page.getByRole('list', { name: 'Closures' })).first()).toContainText('Keyboard closure');
  await context.close();
});

test('mobile: the dialogs and the week stay usable at 390 px: day rows stack, the actions wrap, nothing is cut off', async ({ browser }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile layout only.');
  const context = await contextFor(browser, 'manager');
  const page = await context.newPage();
  await prepare(page, 'light');
  await openHours(page, populated);
  const monday = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Monday', exact: true }) });
  const box = (await monday.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390);
  // the day name sits above its windows (one column), not beside them
  const name = (await monday.getByRole('heading', { name: 'Monday', exact: true }).boundingBox())!;
  const windows = (await monday.getByText('9:00 am to 5:00 pm').boundingBox())!;
  expect(windows.y, 'windows are below the day name at 390 px').toBeGreaterThan(name.y);
  await page.getByRole('button', { name: 'Add hours', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add hours' });
  const { first, second } = timeInputs(dialog);
  for (const input of [first, second]) {
    const b = (await input.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  }
  await context.close();
});
