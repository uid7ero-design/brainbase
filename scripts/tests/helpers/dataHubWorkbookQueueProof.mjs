import { expect } from '@playwright/test';
import { resolve } from 'node:path';

// Owned loopback fixtures only. Raw staging used real XLSX bytes in setup;
// these genuine browser routes perform normalization and profiling, not upload.
export async function verifyWorkbookQueue({ page, context, pool, origin, ready, queueWorlds, evidence, directory }) {
  if (!Array.isArray(queueWorlds) || queueWorlds.length !== 2) throw new Error('Queue fixtures missing');
  const requests = [];
  const observe = request => {
    if (new URL(request.url()).pathname.startsWith('/api/data-hub/')) requests.push({ url: request.url(), method: request.method() });
  };
  const reviewDigest = async () => (await pool.query("SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) AS digest FROM data_hub_analysis_reviews r")).rows[0].digest;
  const beforeReviews = await reviewDigest();
  context.on('request', observe);
  async function open(world) {
    await page.goto(origin + `/data-hub/import/${world.batchId}/preparation`);
    const checkbox = page.getByRole('checkbox', { name: 'Select worksheet 1 for preparation', exact: true });
    await expect(checkbox).toBeEnabled(); await checkbox.focus(); await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.getByRole('button', { name: 'Prepare selection', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirm worksheet preparation', exact: true })).toContainText('Data (worksheet 1)');
  }
  async function assertLineage(world) {
    const result = (await pool.query(`SELECT u.raw_staging_run_id, u.normalization_run_id, u.dataset_profile_run_id,
      u.normalized_by, u.profiled_by, n.status AS normalization_status, p.status AS profile_status,
      n.persisted_row_count, p.row_count::text AS profile_rows, p.column_count::text AS profile_columns,
      (SELECT count(*)::int FROM data_hub_normalization_runs WHERE upload_id=u.id) AS normalization_attempts,
      (SELECT count(*)::int FROM data_hub_dataset_profile_runs WHERE upload_id=u.id) AS profile_attempts
      FROM uploads u JOIN data_hub_normalization_runs n ON n.id=u.normalization_run_id AND n.upload_id=u.id AND n.organisation_id=u.organisation_id
      JOIN data_hub_dataset_profile_runs p ON p.id=u.dataset_profile_run_id AND p.upload_id=u.id AND p.organisation_id=u.organisation_id
        AND p.normalization_run_id=n.id AND p.worksheet_mapping_profile_version_id=n.worksheet_mapping_profile_version_id
      WHERE u.id=$1 AND u.organisation_id=$2 AND n.raw_staging_run_id=$3`, [world.uploadId, 'org-a', world.rawRunId])).rows[0];
    if (!result || result.raw_staging_run_id !== world.rawRunId || result.normalized_by !== ready.userId || result.profiled_by !== ready.userId ||
      result.normalization_status !== 'SUCCEEDED' || result.profile_status !== 'SUCCEEDED' || result.persisted_row_count !== 2 ||
      result.profile_rows !== '2' || result.profile_columns !== '4' || result.normalization_attempts !== 1 || result.profile_attempts !== 1) {
      throw new Error('Queue did not preserve genuine actor, lineage and single-attempt completion');
    }
    return result;
  }
  try {
    const complete = queueWorlds[0];
    await open(complete);
    if (requests.some(request => request.method === 'POST')) throw new Error('Selection/confirmation executed work');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(directory, 'workbook-queue-confirmation-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Start selected preparation', exact: true }).click();
    await expect(page.getByText('Selected worksheets are ready for their individual field and quality reviews.', { exact: true })).toBeVisible({ timeout: 65_000 });
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toBeVisible();
    const completePosts = requests.filter(request => request.method === 'POST').map(request => new URL(request.url).pathname);
    if (JSON.stringify(completePosts) !== JSON.stringify(['normalize', 'profile'].map(step => `/api/data-hub/worksheets/${complete.uploadId}/${step}`))) {
      throw new Error('Queue did not skip existing raw staging or posted unexpected work');
    }
    const completedLineage = await assertLineage(complete);
    await page.screenshot({ path: resolve(directory, 'workbook-queue-complete-mobile.png'), fullPage: true });
    evidence.checks.push('Confirmed selection performs genuine normalization and profiling through existing routes with authenticated actor/lineage; reuses source rows, adds no review or count, supports keyboard selection and fits 390px');
    await page.setViewportSize({ width: 1280, height: 900 });

    const cancelled = queueWorlds[1], profileUrl = origin + `/api/data-hub/worksheets/${cancelled.uploadId}/profile`;
    let release, arrived;
    const gate = new Promise(done => { release = done; }), seen = new Promise(done => { arrived = done; });
    const delayed = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const response = await route.fetch();
      if (response.status() !== 200) throw new Error('Genuine delayed profile did not succeed');
      arrived(); await gate;
      try { await route.fulfill({ response }); } catch { /* cancelled browser wait */ }
    };
    await page.route(profileUrl, delayed);
    try {
      await open(cancelled);
      await page.getByRole('button', { name: 'Start selected preparation', exact: true }).click();
      let timer;
      try { await Promise.race([seen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Genuine profile POST was not observed')), 50_000); })]); }
      finally { clearTimeout(timer); }
      await page.getByRole('button', { name: 'Stop preparation', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('Work may still finish on the server');
      await expect(page.getByRole('button', { name: 'Prepare selection', exact: true })).toBeDisabled();
      await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toHaveCount(0);
      release();
    } finally { release(); await page.unroute(profileUrl, delayed); }
    const postsAfterStop = requests.filter(request => request.method === 'POST').length;
    await page.getByRole('button', { name: 'Check preparation', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Review worksheet 1', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Prepare selection', exact: true }).click();
    await page.getByRole('button', { name: 'Start selected preparation', exact: true }).click();
    await expect(page.getByText('Selected worksheets are ready for their individual field and quality reviews.', { exact: true })).toBeVisible({ timeout: 20_000 });
    if (requests.filter(request => request.method === 'POST').length !== postsAfterStop) throw new Error('Uncertain-response recovery repeated a POST');
    await assertLineage(cancelled);
    if (JSON.stringify(await assertLineage(complete)) !== JSON.stringify(completedLineage) || await reviewDigest() !== beforeReviews ||
      requests.some(request => /analysis-(review|count|planning)/.test(request.url))) throw new Error('Queue changed prior lineage or entered analysis');
    evidence.checks.push('Deliberately delayed genuine successful profile POST can be stopped without local readiness; explicit GET recovery and confirmed rerun reuse completed work without another POST or duplicate attempt');

    await open(complete);
    await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [ready.userId]);
    const beforeDenied = requests.filter(request => request.method === 'POST').length;
    try {
      await page.getByRole('button', { name: 'Start selected preparation', exact: true }).click();
      await expect(page.locator('main [role="alert"]')).toContainText('unavailable or your access has changed');
      await expect(page.getByRole('checkbox')).toHaveCount(0);
    } finally { await pool.query("UPDATE users SET role='MANAGER' WHERE id=$1", [ready.userId]); }
    if (requests.filter(request => request.method === 'POST').length !== beforeDenied) throw new Error('Demoted queue reached mutation');
    evidence.checks.push('Live role demotion between selection and confirmation fails the fresh inventory read, clears selection/readiness and stops before preparation POST');
  } finally { context.off('request', observe); }
}
