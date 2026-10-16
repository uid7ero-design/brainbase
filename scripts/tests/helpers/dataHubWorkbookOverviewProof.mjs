import { expect } from '@playwright/test';
import { resolve } from 'node:path';

// Runs only inside the existing disposable local harness. All baseline reads
// use genuine routes/DB state. Delayed and malformed replies are named probes.
export async function verifyWorkbookOverview({ page, context, pool, origin, ready, evidence, directory }) {
  const url = origin + `/data-hub/import/${ready.batchId}/preparation`;
  const inventoryUrl = origin + `/api/data-hub/import-batches/${ready.batchId}/worksheets`;
  const profileUrl = origin + `/api/data-hub/worksheets/${ready.uploadId}/profile`;
  const requests = [];
  const responses = [];
  const observeResponse = async response => {
    const target = new URL(response.url());
    if (!target.pathname.startsWith(`/api/data-hub/worksheets/${ready.uploadId}/`) || !['stage', 'normalize', 'profile'].includes(target.pathname.split('/').at(-1))) return;
    const body = await response.json().catch(() => ({}));
    responses.push({ step: target.pathname.split('/').at(-1), httpStatus: response.status(), contentType: response.headers()['content-type'],
      ok: body.ok, status: body.status, code: body.code, rowCountType: typeof body.rowCount, columnCountType: typeof body.columnCount });
  };
  const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/data-hub/')) requests.push({ url: request.url(), method: request.method() }); };
  context.on('request', observe);
  context.on('response', observeResponse);
  const digest = async () => (await pool.query(`SELECT
    (SELECT count(*)::int FROM data_hub_raw_staging_runs) AS staging,
    (SELECT count(*)::int FROM data_hub_normalization_runs) AS normalization,
    (SELECT count(*)::int FROM data_hub_dataset_profile_runs) AS profiling,
    (SELECT count(*)::int FROM data_hub_analysis_reviews) AS reviews`)).rows[0];
  const before = await digest();
  try {
    await page.goto(url);
    await expect(page.getByRole('link', { name: 'Open preparation for worksheet 1', exact: true })).toBeVisible();
    if (requests.length !== 1 || requests[0].url !== inventoryUrl) throw new Error('Overview opened with more than an inventory read');
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Check preparation', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toBeVisible();
    if (requests.length !== 4 || requests.some(request => request.method !== 'GET')) throw new Error('Overview scan was not three explicit status reads');
    await page.getByLabel('Show worksheets', { exact: true }).selectOption('ready');
    await expect(page.getByRole('heading', { name: 'Data (worksheet 1)', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(directory, 'workbook-preparation-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel('Show worksheets', { exact: true }).selectOption('all');
    evidence.checks.push('Workbook overview opens with inventory only, checks three genuine preparation statuses explicitly, filters ready worksheets, supports keyboard activation and fits 390px');

    let release, arrived;
    const gate = new Promise(done => { release = done; });
    const seen = new Promise(done => { arrived = done; });
    const delayed = async route => {
      const response = await route.fetch(); arrived(); await gate;
      try { await route.fulfill({ response }); } catch { /* cancellation may discard the route */ }
    };
    await page.route(profileUrl, delayed);
    await page.getByRole('button', { name: 'Check preparation', exact: true }).click();
    await Promise.race([seen, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Overview delayed read did not arrive')), 15_000); timer.unref(); })]);
    await page.getByRole('button', { name: 'Stop checking', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('Checking stopped');
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toHaveCount(0);
    release(); await page.unroute(profileUrl, delayed);
    await page.getByRole('button', { name: 'Check preparation', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toBeVisible();
    evidence.checks.push('Workbook overview cancels a deliberately delayed genuine profile status without retaining readiness; explicit fresh check recovers');

    const corrupted = async route => { const response = await route.fetch(); const body = await response.json();
      body.worksheets[0].importBatchId = 'different-batch'; await route.fulfill({ response, json: body }); };
    await page.route(inventoryUrl, corrupted);
    await page.getByRole('button', { name: 'Refresh worksheet list', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('Couldn’t confirm');
    await expect(page.getByRole('link', { name: 'Open preparation for worksheet 1', exact: true })).toHaveCount(0);
    await page.unroute(inventoryUrl, corrupted);
    await page.getByRole('button', { name: 'Refresh worksheet list', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open preparation for worksheet 1', exact: true })).toBeVisible();
    evidence.checks.push('Deliberately mismatched workbook inventory clears all rows and readiness; genuine explicit refresh recovers');

    await pool.query('UPDATE users SET role=\'VIEWER\' WHERE id=$1', [ready.userId]);
    try {
      await page.getByRole('button', { name: 'Check preparation', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('unavailable or your access has changed');
      await expect(page.getByRole('link', { name: 'Open preparation for worksheet 1', exact: true })).toHaveCount(0);
    } finally { await pool.query('UPDATE users SET role=\'MANAGER\' WHERE id=$1', [ready.userId]); }
    const foreign = (await pool.query('SELECT id FROM import_batches WHERE organisation_id=$1 LIMIT 1', ['org-b'])).rows[0];
    if (!foreign) throw new Error('Missing owned foreign fixture');
    const denied = await context.request.get(origin + `/api/data-hub/import-batches/${foreign.id}/worksheets`);
    if (denied.status() !== 404) throw new Error('Foreign inventory exposed');
    await page.goto(origin + `/data-hub/import/${foreign.id}/preparation`);
    await expect(page.locator('main [role="alert"]')).toContainText('unavailable or your access has changed');
    await expect(page.getByRole('link', { name: /Open preparation for worksheet/ })).toHaveCount(0);
    if (requests.some(request => request.method !== 'GET') || JSON.stringify(before) !== JSON.stringify(await digest())) throw new Error('Workbook overview wrote preparation or review history');
    evidence.checks.push('Workbook overview handles live role demotion and concealed foreign inventory; all overview calls are GET and preparation/review histories remain unchanged');
  } catch (error) { console.error('Workbook status response diagnostics:', JSON.stringify(responses)); throw error; }
  finally { context.off('request', observe); context.off('response', observeResponse); }
}
