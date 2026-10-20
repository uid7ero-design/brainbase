import { expect } from '@playwright/test';
import { resolve } from 'node:path';

export async function verifyReviewHistory({ page, pool, origin, ready, held, evidence, directory, chooseMeanings, chooseQuality, api }) {
  const base = `/api/data-hub/worksheets/${held.uploadId}`, historyPattern = origin + base + '/analysis-review/history**';
  const region = () => page.getByRole('region', { name: 'Saved review history', exact: true });
  const history = async () => { await region().getByRole('button', { name: /^(Load|Refresh) review history$/ }).click(); await expect(region().getByRole('heading', { name: /^Revision 1(?: — current saved review)?$/ })).toBeVisible(); };
  const reload = async revision => { await page.getByRole('button', { name: 'Load current review', exact: true }).click(); await expect(page.getByRole('heading', { name: `Saved review ${revision}`, exact: true })).toBeVisible(); };
  const reviewDigest = async () => (await pool.query("SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) AS digest FROM data_hub_analysis_reviews r")).rows[0].digest;
  const preparation = async () => (await pool.query(`SELECT
    (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM data_hub_raw_staging_runs r) AS raw,
    (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM data_hub_normalization_runs r) AS normalized,
    (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM data_hub_dataset_profile_runs r) AS profiled`)).rows[0];
  const originalPreparation = await preparation(), requests = [];
  const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/data-hub/')) requests.push({ path: new URL(request.url()).pathname, method: request.method() }); };
  page.on('request', observe);
  try {
    await page.goto(origin + `/data-hub/analysis/${held.uploadId}`); await reload(1);
    if (requests.some(request => request.path.includes('/history'))) throw new Error('History loaded automatically');
    await history(); await expect(region().getByText(/hold decisions/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
    await chooseMeanings(); await chooseQuality();
    await page.getByRole('button', { name: 'Save review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved review 2', exact: true })).toBeVisible();
    const beforeReads = await reviewDigest();
    await history(); await region().getByRole('button', { name: 'Compare revision 1 with current review', exact: true }).click();
    await expect(region().getByRole('region', { name: 'Review decision changes' })).toContainText('hold → continue');
    if (await reviewDigest() !== beforeReads) throw new Error('History/comparison rewrote saved reviews');
    evidence.checks.push('Real held review remains inspectable without count capability; explicit corrected save creates revision 2, genuine history/compare GETs show HOLD to CONTINUE with unchanged review history');

    await region().getByRole('button', { name: 'View decisions in revision 1', exact: true }).click();
    const detailRegion = () => region().getByRole('region', { name: 'Saved review decisions', exact: true });
    await expect(detailRegion()).toContainText('earlier saved review');
    await expect(detailRegion()).toContainText('hold');
    await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeEnabled();
    const beforeFiltering = requests.length;
    await detailRegion().getByLabel('Decision type').selectOption('holds');
    await expect(detailRegion().getByRole('listitem').first()).toContainText('hold');
    await detailRegion().getByLabel('Decision type').selectOption('fields');
    await expect(detailRegion()).not.toContainText('column all null');
    if (requests.length !== beforeFiltering) throw new Error('Local detail filters issued requests');
    await region().getByRole('button', { name: 'View decisions in revision 2', exact: true }).click();
    await expect(detailRegion()).toContainText('current saved review');
    await expect(detailRegion().getByLabel('Decision type')).toHaveValue('all');
    if (await reviewDigest() !== beforeReads) throw new Error('Detail read rewrote review decisions');
    evidence.checks.push('Genuine selected-revision detail GETs display both earlier HOLD and current CONTINUE decisions; local filters make no request, reset on selection and do not govern current count readiness');

    const detailCorrupt = async route => {
      const actual = await route.fetch(), body = await actual.json();
      if (actual.status() !== 200) throw new Error('Detail probe needs genuine success');
      body.detail.revision = 1; body.detail.actorId = 'private-detail-probe';
      await route.fulfill({ response: actual, json: body });
    };
    await page.route(origin + base + '/analysis-review/history/detail**', detailCorrupt);
    try {
      await region().getByRole('button', { name: 'View decisions in revision 2', exact: true }).click();
      await expect(region().getByRole('alert')).toContainText('RESPONSE_INVALID');
      await expect(detailRegion()).toHaveCount(0); await expect(region()).not.toContainText('private-detail-probe');
    } finally { await page.unroute(origin + base + '/analysis-review/history/detail**', detailCorrupt); }
    await history();
    evidence.checks.push('Deliberately mismatched and extra-metadata detail reply is rejected, clears prior details, hides private text and recovers only by explicit read');

    const corrupt = async route => {
      const actual = await route.fetch(), body = await actual.json();
      if (actual.status() !== 200) throw new Error('History comparison probe needs genuine success');
      body.comparison.context.uploadId = 'foreign-history-probe'; await route.fulfill({ response: actual, json: body });
    };
    await page.route(origin + base + '/analysis-review/history/compare**', corrupt);
    try {
      await region().getByRole('button', { name: 'Compare revision 1 with current review', exact: true }).click();
      await expect(region().getByRole('alert')).toContainText('RESPONSE_INVALID');
      await expect(region().getByRole('region', { name: 'Review decision changes' })).toHaveCount(0);
    } finally { await page.unroute(origin + base + '/analysis-review/history/compare**', corrupt); }
    await history();
    for (const { timeout, kind } of [{ timeout: false, kind: 'page' }, { timeout: true, kind: 'page' }, { timeout: false, kind: 'detail' }, { timeout: true, kind: 'detail' }]) {
      let release, arrived;
      const gate = new Promise(done => { release = done; }), arrival = new Promise(done => { arrived = done; });
      const delayed = async route => { const actual = await route.fetch(); if (actual.status() !== 200) throw new Error('History delay requires genuine success'); arrived(); await gate; try { await route.fulfill({ response: actual }); } catch { /* cancelled wait */ } };
      await page.route(historyPattern, delayed);
      try {
        await region().getByRole('button', { name: kind === 'detail' ? 'View decisions in revision 1' : 'Refresh review history', exact: true }).click();
        let timer; try { await Promise.race([arrival, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('History probe did not arrive')), 20_000); })]); } finally { clearTimeout(timer); }
        await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Load planning choices', exact: true })).toBeDisabled();
        if (!timeout) await region().getByRole('button', { name: 'Stop loading history', exact: true }).click();
        await expect(region().getByRole('alert')).toContainText(timeout ? 'REQUEST_TIMED_OUT' : 'REQUEST_CANCELLED', { timeout: 20_000 });
        await expect(region().getByText('Revision 1', { exact: true })).toHaveCount(0);
      } finally { release(); await page.unroute(historyPattern, delayed); }
      await history();
    }
    if (await reviewDigest() !== beforeReads) throw new Error('History transport probes appended a review');
    evidence.checks.push('Named genuine history/detail delay/cancel/deadline and deliberately foreign comparison context probes discard stale history/details, lock siblings, never retry or write, and recover by explicit genuine GET');

    await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [ready.userId]);
    try {
      await region().getByRole('button', { name: 'View decisions in revision 1', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('FORBIDDEN');
      await expect(region()).toHaveCount(0); await expect(page.getByRole('region', { name: 'Saved review results' })).toHaveCount(0);
    } finally { await pool.query("UPDATE users SET role='MANAGER' WHERE id=$1", [ready.userId]); }
    await reload(2); await history();
    evidence.checks.push('Live role demotion during a selected-detail read clears history, current review and planning/count controls; restored authority permits explicit reload');

    const stored = (await pool.query('SELECT semantic_choices,quality_decisions FROM data_hub_analysis_reviews WHERE upload_id=$1 AND revision=2', [held.uploadId])).rows[0];
    const restored = await api(base + '/analysis-review', { reviewVersion: 'v1', datasetProfileRunId: held.datasetProfileRunId,
      semanticChoices: stored.semantic_choices, qualityDecisions: stored.quality_decisions.map(item => ({ ...item, decision: item.decision === 'CONTINUE' ? 'HOLD' : item.decision })) });
    if (restored.status !== 201 || restored.body.revision !== 3) throw new Error('Concurrent explicit hold restoration failed');
    const afterAppend = await reviewDigest();
    await region().getByRole('button', { name: 'View decisions in revision 1', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('REVIEW_REVISION_MISMATCH');
    await expect(region()).toHaveCount(0); await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toHaveCount(0);
    await reload(3); await history();
    await region().getByRole('button', { name: 'Compare revision 2 with current review', exact: true }).click();
    await expect(region().getByRole('region', { name: 'Review decision changes' })).toContainText('continue → hold');
    await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review history overflows mobile viewport');
    await region().screenshot({ path: resolve(directory, 'review-history-mobile.png') }); await page.setViewportSize({ width: 1280, height: 900 });
    await region().getByRole('button', { name: 'View decisions in revision 2', exact: true }).click();
    await expect(detailRegion()).toContainText('continue');
    await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
    await detailRegion().getByLabel('Decision type').selectOption('holds');
    await expect(detailRegion()).toContainText('No recorded items match this filter.');
    await detailRegion().getByLabel('Decision type').selectOption('all');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review detail overflows mobile viewport');
    await detailRegion().screenshot({ path: resolve(directory, 'review-detail-mobile.png') }); await page.setViewportSize({ width: 1280, height: 900 });
    evidence.checks.push('A concurrently advanced current revision invalidates detail reads; explicit reload recovers, earlier CONTINUE cannot override current HOLD, empty filters stay explicit and selected details fit 390px');
    if (await reviewDigest() !== afterAppend || JSON.stringify(await preparation()) !== JSON.stringify(originalPreparation)) throw new Error('Read-only history changed durable evidence');
    if (requests.filter(request => request.path.endsWith('/analysis-review') && request.method === 'POST').length !== 2 || requests.some(request => request.path.endsWith('/analysis-count'))) throw new Error('History automatically saved or calculated a count');
    evidence.checks.push('Explicit concurrent revision 3 invalidates pinned history with 409; reload recovers current HOLD and CONTINUE to HOLD comparison, history fits 390px, preparation unchanged and only two deliberate fixture saves occurred');
  } finally { page.off('request', observe); }
}
