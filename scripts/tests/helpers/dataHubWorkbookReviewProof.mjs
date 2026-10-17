import { expect } from '@playwright/test';
import { resolve } from 'node:path';

// Synthetic loopback fixtures only. Genuine GET baselines and named transport
// probes; assert the full preparation/review history digest stays unchanged.
export async function verifyWorkbookReviews({ page, context, pool, origin, ready, held, queueWorlds, evidence, directory, phase }) {
  const requests = [], responses = [];
  const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/data-hub/')) requests.push({ url: request.url(), method: request.method() }); };
  const observeResponse = response => { if (response.url().endsWith('/analysis-status')) responses.push(response); };
  const digest = async () => (await pool.query(`SELECT
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_raw_staging_runs r) AS staging,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_normalization_runs r) AS normalization,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_dataset_profile_runs r) AS profiling,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM data_hub_analysis_reviews r) AS reviews`)).rows[0];
  const before = await digest();
  context.on('request', observe); context.on('response', observeResponse);
  async function open(world) {
    await page.goto(origin + `/data-hub/import/${world.batchId}/reviews`);
    await expect(page.getByRole('heading', { name: 'Data (worksheet 1)', exact: true })).toBeVisible();
  }
  async function check(label) {
    await page.getByRole('button', { name: 'Check saved reviews', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('li').getByText(label, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Check saved reviews', exact: true })).toBeEnabled();
  }
  try {
    if (phase === 'before') {
      await open(ready);
      if (requests.length !== 1 || !requests[0].url.endsWith('/worksheets')) throw new Error('Review page opened beyond inventory');
      await check('Review required');
      await open(queueWorlds[0]); await check('Preparation required');
      await expect(page.getByRole('link', { name: 'Open review for worksheet 1', exact: true })).toHaveCount(0);
      evidence.checks.push('Workbook review page opens with inventory only; keyboard-initiated genuine GET distinguishes missing saved review from missing preparation without writing');
    } else {
      await open(ready); await check('Saved review complete');
      await expect(page.getByText('The saved review includes acknowledged quality notices.', { exact: true })).toBeVisible();
      const current = (await pool.query('SELECT revision FROM data_hub_analysis_reviews WHERE upload_id=$1 ORDER BY revision DESC LIMIT 1', [ready.uploadId])).rows[0];
      await expect(page.getByText(`Saved review ${current.revision} · profile ${ready.datasetProfileRunId}`, { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(directory, 'workbook-reviews-mobile.png'), fullPage: true });
      await page.getByLabel('Show review status', { exact: true }).selectOption('hold');
      await expect(page.getByText('No worksheets match this view.', { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(held); await check('Quality hold');
      await expect(page.getByText('The saved review has a quality hold. Review the required corrections before continuing.', { exact: true })).toBeVisible();
      evidence.checks.push('Workbook review observations show latest persisted revision/profile, acknowledged notices and genuine quality hold separately; filters read nothing and layout fits 390px');

      const statusUrl = origin + `/api/data-hub/worksheets/${ready.uploadId}/analysis-status`;
      await open(ready); await check('Saved review complete');
      let release, arrived;
      const gate = new Promise(done => { release = done; }), seen = new Promise(done => { arrived = done; });
      const delayed = async route => { const response = await route.fetch(); arrived(); await gate; try { await route.fulfill({ response }); } catch { /* stopped browser wait */ } };
      await page.route(statusUrl, delayed);
      try {
        await page.getByRole('button', { name: 'Check saved reviews', exact: true }).click();
        let timer; try { await Promise.race([seen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Review status probe did not arrive')), 15_000); })]); } finally { clearTimeout(timer); }
        await page.getByRole('button', { name: 'Stop checking', exact: true }).click();
        await expect(page.locator('main [role="alert"]')).toContainText('Checking stopped');
        await expect(page.getByText(`Saved review ${current.revision} · profile ${ready.datasetProfileRunId}`, { exact: true })).toHaveCount(0);
      } finally { release(); await page.unroute(statusUrl, delayed); }
      await check('Saved review complete');
      const mismatched = async route => { const response = await route.fetch(), body = await response.json(); body.status.uploadId = 'foreign'; await route.fulfill({ response, json: body }); };
      await page.route(statusUrl, mismatched); await check('Status unconfirmed'); await page.unroute(statusUrl, mismatched); await check('Saved review complete');
      evidence.checks.push('Named delayed genuine review GET and mismatched-identity response probes clear old observations; late replies cannot restore them and explicit genuine recheck recovers');

      await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [ready.userId]);
      try {
        await page.getByRole('button', { name: 'Check saved reviews', exact: true }).click();
        await expect(page.locator('main [role="alert"]')).toContainText('unavailable or your access has changed');
        await expect(page.getByRole('heading', { name: 'Data (worksheet 1)', exact: true })).toHaveCount(0);
      } finally { await pool.query("UPDATE users SET role='MANAGER' WHERE id=$1", [ready.userId]); }
      const foreign = (await pool.query('SELECT id FROM uploads WHERE organisation_id=$1 LIMIT 1', ['org-b'])).rows[0];
      if (!foreign) throw new Error('Foreign review fixture missing');
      const status = await page.evaluate(async id => (await fetch(`/api/data-hub/worksheets/${id}/analysis-status`, { cache: 'no-store' })).status, foreign.id);
      if (status !== 404) throw new Error('Foreign review status was not concealed');
      evidence.checks.push('Live role demotion clears workbook review observations; foreign worksheet review status remains concealed with 404');
    }
    for (const response of responses) {
      if (!response.headers()['cache-control']?.includes('no-store')) throw new Error('Review observation was cacheable');
    }
    if (requests.some(request => request.method !== 'GET') || JSON.stringify(before) !== JSON.stringify(await digest())) throw new Error('Workbook review observation changed preparation/review history');
  } finally { context.off('request', observe); context.off('response', observeResponse); }
}
