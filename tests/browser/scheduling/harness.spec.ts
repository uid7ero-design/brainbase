import { test, expect } from '@playwright/test';
import { enabled, origin, storageStatePath } from './accounts';

test.skip(!enabled, 'Run through scripts/tests/verify-scheduling-browser-local.mjs');
test.use({ storageState: enabled ? storageStatePath('manager') : undefined });

// Harness sanity: the real app serves the Scheduling dashboard to a signed-in manager from the disposable database.
test('the harness serves the Scheduling overview to a signed-in manager', async ({ page }) => {
  await page.goto(`${origin}/scheduling`);
  await expect(page.getByRole('heading', { name: 'Scheduling', exact: true })).toBeVisible();
  const status = await page.request.get(`${origin}/api/scheduling/status`);
  expect(status.status()).toBe(200);
  const body = await status.json();
  expect(body.currency).toBe('AUD');
  expect(body.timezone).toBe('Australia/Adelaide');
});
