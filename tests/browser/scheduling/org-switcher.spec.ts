import { test, expect } from '@playwright/test';
import { enabled, origin } from './accounts';
import { api, contextFor, json } from './support';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'The organisation switcher is the desktop header control.'); });

// Defect: while a platform owner impersonates an organisation, every page first painted the header as if they were NOT
// impersonating ("Organisation <home>" and no "Viewing as" banner) and corrected itself only after /api/me and
// /api/admin/impersonate answered. The impersonation is known on the server (session.organisationId differs from
// session.homeOrganisationId), so the first paint must already be right.
test('a platform owner sees the impersonated organisation from first paint, with no wrong-organisation flash', async ({ browser }, info) => {
  const context = await contextFor(browser, 'owner');
  expect((await context.request.post(`${origin}/api/admin/impersonate`, { data: { orgId: 'sched-org-a' }, headers: json })).status()).toBe(200);
  const page = await context.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('bb-theme', 'dark'); } catch { /* storage unavailable */ } });
  // sample the visible header from the first moment a body exists
  await page.addInitScript(() => {
    const samples: string[] = [];
    (window as unknown as { __samples: string[] }).__samples = samples;
    const tick = () => {
      const text = document.body?.innerText?.slice(0, 400) ?? '';
      if (text) samples.push(/VIEWING AS/i.test(text) ? 'banner' : /ORGANISATION/i.test(text) ? 'home-label' : 'other');
    };
    const id = setInterval(tick, 20);
    setTimeout(() => clearInterval(id), 8000);
  });
  await page.goto(`${origin}/scheduling`);
  await expect(page.getByText(/Viewing as/i).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const samples = await page.evaluate(() => (window as unknown as { __samples: string[] }).__samples);
  const firstBanner = samples.indexOf('banner');
  const wrong = samples.slice(0, firstBanner < 0 ? samples.length : firstBanner).filter(s => s === 'home-label').length;
  info.annotations.push({ type: 'header-samples', description: `${samples.length} samples, ${wrong} wrong-organisation samples before the banner` });
  expect(wrong, 'the header must never show the owner\'s home organisation label while impersonating').toBe(0);

  // switching through the real control, and ending impersonation
  await page.goto(`${origin}/admin/orgs`);
  await page.getByRole('button', { name: /Switch organisation/ }).click();
  await page.getByRole('button', { name: 'Unentitled Org', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/admin/orgs'), { timeout: 60_000 }); // the switcher navigates to /dashboard itself
  await page.goto(`${origin}/scheduling`);
  await expect(page.getByText('Scheduling isn’t enabled for your organisation')).toBeVisible({ timeout: 60_000 });
  expect((await context.request.get(api('/status'))).status()).toBe(403);
  await page.getByRole('button', { name: 'Return to Brainbase' }).click();
  await expect.poll(async () => (await (await context.request.get(`${origin}/api/admin/impersonate`)).json()).orgId, { timeout: 30_000 }).toBeNull();
  await context.close();
});

test('a platform owner who is not impersonating sees their own organisation, with no banner', async ({ browser }) => {
  const context = await contextFor(browser, 'owner');
  const page = await context.newPage();
  await page.goto(`${origin}/admin/founder`);
  await expect(page.getByRole('button', { name: /Switch organisation/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Viewing as/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Organisation: Harness HQ/ })).toBeVisible();
  await context.close();
});
