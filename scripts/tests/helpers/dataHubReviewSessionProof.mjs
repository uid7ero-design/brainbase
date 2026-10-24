import { expect } from '@playwright/test';
import { resolve } from 'node:path';

// Real disposable DB/browser baseline; delays and corruptions are explicitly
// named transport probes after the server has produced a genuine response.
export async function verifyReviewSession({ page, pool, origin, ready, held, evidence, directory, chooseMeanings, chooseQuality }) {
  const base = origin + `/api/data-hub/worksheets/${ready.uploadId}`;
  const reviewUrl = base + '/analysis-review', planUrl = reviewUrl + '/plan';
  const load = () => page.getByRole('button', { name: 'Load current review', exact: true });
  const saved = revision => page.getByRole('heading', { name: `Saved review ${revision}`, exact: true });
  const reviewCount = async () => (await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n;
  const before = await reviewCount();
  const requests = [];
  const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/data-hub/')) requests.push(request); };
  page.on('request', observe);
  async function open(batchId = ready.batchId) { await page.goto(origin + `/data-hub/analysis/${ready.uploadId}?workbook=${batchId}`); }
  async function reload(revision = before) { await load().click(); await expect(saved(revision)).toBeVisible(); await expect(load()).toBeEnabled(); }
  async function wait(signal) {
    let timer; try { await Promise.race([signal, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Review session probe did not arrive')), 20_000); })]); }
    finally { clearTimeout(timer); }
  }
  async function delayed(url, action, check, method = 'GET') {
    let release, arrive;
    const gate = new Promise(done => { release = done; }), arrival = new Promise(done => { arrive = done; });
    const handler = async route => {
      if (route.request().method() !== method) { await route.continue(); return; }
      const response = await route.fetch(); if (!response.ok()) throw new Error('Review probe requires genuine success');
      arrive(); await gate; try { await route.fulfill({ response }); } catch { /* browser deliberately stopped waiting */ }
    };
    await page.route(url, handler);
    try { await action(); await wait(arrival); await check(); } finally { release(); await page.unroute(url, handler); }
  }
  try {
    await open(); const initialRequests = requests.length;
    await page.getByRole('button', { name: 'Load workbook navigation', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('Data (worksheet 1) · 1 of 1 available worksheets', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to workbook review status', exact: true })).toHaveAttribute('href', `/data-hub/import/${ready.batchId}/reviews`);
    if (requests.length !== initialRequests + 1 || !requests.at(-1).url().endsWith('/worksheets')) throw new Error('Navigation performed more than its explicit metadata GET');
    await reload();
    evidence.checks.push('Individual review workbook hint: explicit authorized metadata GET confirms membership and physical worksheet position; navigation alone loads/saves no review');

    await delayed(planUrl, () => load().click(), async () => {
      await page.getByRole('button', { name: 'Stop review request', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('REQUEST_CANCELLED');
      await expect(load()).toBeEnabled(); await expect(saved(before)).toHaveCount(0);
    });
    await reload();
    await delayed(base + '/analysis-count', () => page.getByRole('button', { name: 'Count rows', exact: true }).click(), async () => {
      await page.getByRole('button', { name: 'Stop review request', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('REQUEST_CANCELLED');
      await expect(page.locator('main').getByText(/^Rows:/)).toHaveCount(0);
    }, 'POST');
    await page.getByRole('button', { name: 'Count rows', exact: true }).click();
    await expect(page.getByText(`Rows: 3. Based on review ${before}, profile ${ready.datasetProfileRunId}.`, { exact: true })).toBeVisible();
    evidence.checks.push('Named delayed genuine discovery and count replies: cancellation unlocks controls, hides old results, ignores late replies; explicit genuine retries recover');

    await delayed(planUrl, () => load().click(), async () => {
      await expect(page.locator('main [role="alert"]')).toContainText('REQUEST_TIMED_OUT', { timeout: 20_000 });
      await expect(load()).toBeEnabled(); await expect(page.getByRole('heading', { name: 'Field meanings', exact: true })).toHaveCount(0);
    });
    await reload();
    const corrupt = async route => {
      const response = await route.fetch(), body = await response.json();
      body.schema.context.datasetProfileRunId = body.quality.context.datasetProfileRunId = 'obsolete-review-profile';
      await route.fulfill({ response, json: body });
    };
    await page.route(reviewUrl, corrupt);
    try { await load().click(); await expect(page.locator('main [role="alert"]')).toContainText('REVIEW_PROFILE_CHANGED'); await expect(saved(before)).toHaveCount(0); }
    finally { await page.unroute(reviewUrl, corrupt); }
    await reload();
    if (await reviewCount() !== before) throw new Error('Review reads/count probes appended history');
    evidence.checks.push('Named discovery deadline and different-profile saved-reply probes reject the session; explicit reload recovers without any review append');

    await open(held.batchId);
    await page.getByRole('button', { name: 'Load workbook navigation', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Workbook worksheet navigation' }).getByRole('alert')).toContainText('Couldn’t confirm');
    await expect(page.getByRole('link', { name: 'Back to workbook review status', exact: true })).toHaveCount(0);
    await reload(); // A bad query hint is not authority over this worksheet.
    await open(); await reload(); await chooseMeanings(); await chooseQuality();
    await expect(page.getByRole('button', { name: 'Load workbook navigation', exact: true })).toBeDisabled();
    await delayed(reviewUrl, () => page.getByRole('button', { name: 'Save review', exact: true }).click(), async () => {
      if (await reviewCount() !== before + 1) throw new Error('Cancelled save probe did not commit exactly one genuine revision');
      await page.getByRole('button', { name: 'Stop review request', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('REQUEST_CANCELLED');
      await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Load workbook navigation', exact: true })).toBeDisabled();
    }, 'POST');
    await reload(before + 1);
    if (await reviewCount() !== before + 1) throw new Error('Reload retried an uncertain save');
    evidence.checks.push('Incorrect authorized workbook hint cannot lend navigation membership; genuine save commits once before its reply is cancelled, stays locked until explicit reload, never retries or duplicates');

    await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [ready.userId]);
    try {
      await page.getByRole('button', { name: 'Load planning choices', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('FORBIDDEN');
      await expect(page.getByRole('heading', { name: 'Field meanings', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Analysis planning', exact: true })).toHaveCount(0);
    } finally { await pool.query("UPDATE users SET role='MANAGER' WHERE id=$1", [ready.userId]); }
    await reload(before + 1);
    await page.getByRole('button', { name: 'Load workbook navigation', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Back to workbook review status', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review session overflows mobile viewport');
    await page.screenshot({ path: resolve(directory, 'review-session-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    evidence.checks.push('Live planning-role demotion clears the entire review session; explicit authorized reload recovers, review and navigation fit 390px');
  } finally { page.off('request', observe); }
}
