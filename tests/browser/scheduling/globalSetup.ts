import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ACCOUNTS, enabled, origin, stateDir, storageStatePath } from './accounts';

// Signs every synthetic account in through the application's OWN login form (real bcrypt check, real session cookie, real
// middleware) and saves each browser state. There is no session bypass: a wrong password is proven to fail first.
export default async function globalSetup() {
  if (!enabled) return;
  mkdirSync(stateDir, { recursive: true });
  const password = process.env.SCHED_BROWSER_PASSWORD as string;
  const browser = await chromium.launch();
  try {
    const bad = await browser.newContext({ ignoreHTTPSErrors: true });
    const badPage = await bad.newPage();
    await badPage.goto(`${origin}/login`, { timeout: 180_000 });
    await badPage.waitForLoadState('networkidle', { timeout: 180_000 }); // the dev server compiles on first use; wait for hydration
    await badPage.getByLabel('Username', { exact: true }).fill('manager');
    await badPage.getByLabel('Password', { exact: true }).fill('not-the-password');
    await badPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(badPage.getByText('Invalid username or password.', { exact: true }), `login page said: ${(await badPage.locator('body').innerText()).slice(0, 300)}`).toBeVisible({ timeout: 300_000 }); // the first request compiles the login page and its server action on a cold dev server
    expect((await bad.cookies()).some(c => c.name === 'session')).toBe(false);
    await bad.close();

    for (const account of ACCOUNTS) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(`${origin}/login`, { timeout: 180_000 });
      await page.waitForLoadState('networkidle', { timeout: 120_000 });
      await page.getByLabel('Username', { exact: true }).fill(account);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect.poll(async () => (await context.cookies()).some(c => c.name === 'session'), { timeout: 120_000 }).toBe(true);
      await context.storageState({ path: storageStatePath(account) });
      if (account === 'manager') {
        // Warm the routes the specs use so the dev server's first-use compilation is not counted against a test.
        for (const warm of ['/scheduling', '/scheduling/schedules', '/scheduling/resources', '/api/scheduling/status', '/api/scheduling/schedules', '/api/scheduling/resources', '/api/scheduling/audit']) {
          await page.goto(`${origin}${warm}`, { timeout: 300_000 }).catch(() => undefined);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
