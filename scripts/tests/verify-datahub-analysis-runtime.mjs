import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';
import { FIXTURE_PREPARATION, SETUP_STORAGE } from './helpers/dataHubAcceptanceReceipt.mjs';
import { verifyWorkbookOverview } from './helpers/dataHubWorkbookOverviewProof.mjs';

// Invoked only by verify-datahub-profile-execution.sh after provisioning its
// disposable Docker database and seeding real profile evidence. The build,
// cookies, JWTs, role checks, APIs, Prisma, SQL and browser are real. Only the
// Neon HTTP transport is adapted to the local PostgreSQL wire protocol.
const connectionString = process.env.DATABASE_URL;
if (process.env.DATAHUB_BROWSER_PROOF !== '1' || !connectionString ||
    !['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname) ||
    new URL(connectionString).pathname !== '/testdb') throw new Error('Disposable harness required');
readFileSync('.next/BUILD_ID', 'utf8');
const directory = resolve('test-results/datahub-runtime');
const fixturePath = resolve(directory, 'fixture.json');
const { worlds, password } = JSON.parse(readFileSync(fixturePath, 'utf8'));
unlinkSync(fixturePath); // Do not retain even disposable login credentials.
const pool = new Pool({ connectionString: connectionString.replace('localhost', '127.0.0.1') });
const secret = randomBytes(32).toString('hex');
const freePort = () => new Promise((done, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)); });
});
const pause = ms => new Promise(done => setTimeout(done, ms));
let next, browser, nextLog = '';
const evidence = { checks: [], transport: 'Local Neon transport; real application and PostgreSQL', productionTouched: false,
  fixturePreparation: FIXTURE_PREPARATION, setupStorage: SETUP_STORAGE, fixtureLineageVerified: false, fixtureWorldCount: 0 };
try {
  if (worlds.length !== 3 || new Set(worlds.map(world => world.uploadId)).size !== 3) throw new Error('Lifecycle fixtures incomplete');
  for (const world of worlds) {
    const { rows } = await pool.query(`SELECT b.storage_provider, b.sha256, r.status AS raw_status,
      n.status AS normalized_status, p.status AS profile_status, r.persisted_row_count, r.persisted_cell_count,
      n.persisted_row_count AS normalized_rows, n.persisted_cell_count AS normalized_cells,
      p.row_count::text AS profile_rows, p.column_count::text AS profile_columns
      FROM uploads u JOIN import_batches b ON b.id=u.import_batch_id AND b.organisation_id=u.organisation_id
      JOIN data_hub_raw_staging_runs r ON r.id=u.raw_staging_run_id AND r.organisation_id=u.organisation_id AND r.upload_id=u.id AND r.import_batch_id=b.id
      JOIN data_hub_normalization_runs n ON n.id=u.normalization_run_id AND n.organisation_id=u.organisation_id AND n.upload_id=u.id
        AND n.raw_staging_run_id=r.id AND n.worksheet_mapping_profile_version_id=r.worksheet_mapping_profile_version_id
        AND n.import_batch_id=b.id AND n.source_schema_version_id=r.source_schema_version_id AND n.source_schema_worksheet_id=r.source_schema_worksheet_id
        AND n.worksheet_mapping_profile_id=r.worksheet_mapping_profile_id
      JOIN data_hub_dataset_profile_runs p ON p.id=u.dataset_profile_run_id AND p.organisation_id=u.organisation_id AND p.upload_id=u.id
        AND p.normalization_run_id=n.id AND p.worksheet_mapping_profile_version_id=r.worksheet_mapping_profile_version_id
        AND p.import_batch_id=b.id AND p.source_schema_version_id=r.source_schema_version_id AND p.source_schema_worksheet_id=r.source_schema_worksheet_id
      JOIN worksheet_mapping_profile_versions v ON v.id=p.worksheet_mapping_profile_version_id AND v.organisation_id=u.organisation_id
        AND v.worksheet_mapping_profile_id=r.worksheet_mapping_profile_id
      WHERE u.id=$1 AND u.organisation_id=$2 AND u.raw_staged_by=$3 AND u.normalized_by=$3 AND u.profiled_by=$3
        AND r.source_schema_version_id=$4 AND r.source_schema_worksheet_id=$5 AND r.worksheet_mapping_profile_id=$6
        AND r.worksheet_mapping_profile_version_id=$7 AND p.id=$8 AND r.id=$9 AND n.id=$10`,
    [world.uploadId, 'org-a', world.userId, world.svId, world.wsId, world.profileId, world.pvId, world.datasetProfileRunId, world.rawRunId, world.normRunId]);
    const lineage = rows[0], columns = world.wide ? 54 : 4;
    if (rows.length !== 1 || lineage.storage_provider !== 'memory' || !/^[a-f0-9]{64}$/.test(lineage.sha256) ||
        [lineage.raw_status, lineage.normalized_status, lineage.profile_status].some(status => status !== 'SUCCEEDED') ||
        lineage.persisted_row_count !== 3 || lineage.normalized_rows !== 3 || lineage.profile_rows !== '3' ||
        lineage.persisted_cell_count !== columns * 3 || lineage.normalized_cells !== columns * 3 || lineage.profile_columns !== String(columns)) {
      throw new Error('Workbook lifecycle lineage mismatch');
    }
  }
  evidence.fixtureLineageVerified = true; evidence.fixtureWorldCount = worlds.length;
  evidence.checks.push('Three synthetic XLSX fixtures inspected and raw-staged through real routes before normalization/profiling; durable tenant, actor, mapping and run lineage verified before browser use');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: connectionString,
      SESSION_SECRET: secret, NEXT_TELEMETRY_DISABLED: '1', TZ: 'Australia/Adelaide',
      NODE_OPTIONS: `--require "${resolve('scripts/tests/helpers/localDataHubNeonFetch.cjs').replaceAll('\\', '/')}"` },
  });
  next.stdout.on('data', data => { nextLog += data; }); next.stderr.on('data', data => { nextLog += data; });
  next.on('error', error => { nextLog += error.message; });
  let started = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (next.exitCode !== null) throw new Error(`Next startup failed: ${nextLog}`);
    try { if ((await fetch(origin + '/login')).ok) { started = true; break; } } catch { /* wait for listener */ }
    await pause(500);
  }
  if (!started) throw new Error(`Next startup timeout: ${nextLog}`);
  const ready = worlds.find(world => !world.held && !world.wide), held = worlds.find(world => world.held), wide = worlds.find(world => world.wide);
  const endpoint = uploadId => `/api/data-hub/worksheets/${uploadId}`;
  if ((await fetch(origin + endpoint(ready.uploadId) + '/analysis-review/plan')).status !== 401) throw new Error('Unauthenticated planning accepted');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/login');
  await page.getByLabel('Username', { exact: true }).fill(ready.userId);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await login;
  const session = (await context.cookies()).find(cookie => cookie.name === 'session');
  if (!session?.httpOnly || !session.secure || session.sameSite !== 'Lax') throw new Error('Real login did not issue protected session cookie');
  evidence.checks.push('Real form login, secure HttpOnly session, unauthenticated API denial');

  async function open(uploadId) {
    await page.goto(origin + `/data-hub/analysis/${uploadId}`);
    await page.getByRole('button', { name: 'Load current review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Field meanings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load current review', exact: true })).toBeEnabled();
  }
  async function chooseMeanings() {
    const fields = page.locator('select[id^="field-"]');
    for (let index = 0; index < await fields.count(); index++) {
      const field = fields.nth(index);
      const values = await field.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      await field.selectOption(values.includes('MEASURE') ? 'MEASURE' : values[0]);
    }
    await page.getByRole('button', { name: 'Review quality', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Data quality', exact: true })).toBeVisible();
  }
  async function chooseQuality(onHold = false) {
    const fields = page.locator('select[id^="quality-"]'); let holdChosen = false;
    for (let index = 0; index < await fields.count(); index++) {
      const field = fields.nth(index);
      const values = await field.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      const value = onHold && values.includes('HOLD') ? 'HOLD' : values.includes('ACKNOWLEDGE') ? 'ACKNOWLEDGE' : 'CONTINUE';
      if (value === 'HOLD') holdChosen = true;
      await field.selectOption(value);
    }
    if (onHold && !holdChosen) throw new Error('Hold fixture did not require explicit review');
  }
  async function api(path, body) {
    return page.evaluate(async ({ path, body }) => {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
    }, { path, body });
  }
  async function waitForProbe(signal) {
    let timer;
    try { await Promise.race([signal, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Genuine planning probe response did not arrive')), 20_000);
    })]); } finally { clearTimeout(timer); }
  }
  await verifyWorkbookOverview({ page, context, pool, origin, ready, evidence, directory });
  await page.goto(origin + '/data-hub/import');
  await page.getByRole('button', { name: 'Review worksheets in analysis-ready.xlsx', exact: true }).click();
  await page.getByRole('link', { name: 'Data (worksheet 1) — review and count', exact: true }).click();
  await expect(page).toHaveURL(origin + `/data-hub/analysis/${ready.uploadId}`);
  await page.getByRole('button', { name: 'Load current review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Field meanings', exact: true })).toBeVisible();
  evidence.checks.push('Import history to persisted worksheet navigation through real metadata API, without file reinspection');
  await expect(page.getByLabel('Amount (field 2)', { exact: true })).toBeVisible();
  await chooseMeanings(); await chooseQuality();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved review 1', exact: true })).toBeVisible();
  const stored = (await pool.query('SELECT reviewed_by_id FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows;
  if (stored.length !== 1 || stored[0].reviewed_by_id !== ready.userId) throw new Error('Review did not preserve authenticated actor');
  await page.getByRole('button', { name: 'Count rows', exact: true }).click();
  await expect(page.getByText(`Rows: 3. Based on review 1, profile ${ready.datasetProfileRunId}.`, { exact: true })).toBeVisible();
  await page.getByLabel('Measure to count', { exact: true }).selectOption(ready.col2);
  await page.getByRole('button', { name: 'Count present values', exact: true }).click();
  await expect(page.getByText(`Present values: 2. Based on review 1, profile ${ready.datasetProfileRunId}.`, { exact: true })).toBeVisible();
  evidence.checks.push('Plan, explicit semantic and quality choices, append, reload, row count 3, present count 2 including zero and excluding null, session actor');
  const planningUrl = origin + endpoint(ready.uploadId) + '/analysis-planning';
  const planningPattern = planningUrl + '**';
  const planningSection = page.getByRole('region', { name: 'Analysis planning', exact: true });
  const selection = { datasetProfileRunId: ready.datasetProfileRunId,
    selection: { selectionVersion: 'v1', expectedReviewRevision: 1, includeRowCount: true, measureColumnIds: [ready.col2] } };
  const beforePlanning = (await pool.query('SELECT * FROM data_hub_analysis_reviews WHERE upload_id=$1 ORDER BY revision', [ready.uploadId])).rows;
  const plannedMessage = '2 requests planned from saved review 1. Counts have not been calculated.';
  let executions = 0;
  const observeExecution = request => {
    if (request.method() === 'POST' && /\/analysis-(count|review)$/.test(new URL(request.url()).pathname)) executions++;
  };
  page.on('request', observeExecution);
  await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click();
  const planningMeasure = planningSection.getByRole('checkbox', { name: 'Present values — Amount (field 2)', exact: true });
  await planningMeasure.focus(); await planningMeasure.press('Space'); await expect(planningMeasure).toBeChecked();
  // Delay an otherwise genuine response to prove sibling save/count controls lock.
  let releasePlan, planArrived;
  const heldResponse = new Promise(done => { releasePlan = done; });
  const arrival = new Promise(done => { planArrived = done; });
  const delayPlan = async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const actual = await route.fetch(); planArrived(); await heldResponse;
    await route.fulfill({ response: actual });
  };
  await page.route(planningPattern, delayPlan);
  try {
    await planningSection.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
    await waitForProbe(arrival);
    await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
  } finally { releasePlan(); }
  await expect(planningSection.getByText(plannedMessage, { exact: true })).toBeVisible();
  await page.unroute(planningPattern, delayPlan);
  if (executions !== 0) throw new Error('Planning called count or save');
  if (JSON.stringify((await pool.query('SELECT * FROM data_hub_analysis_reviews WHERE upload_id=$1 ORDER BY revision', [ready.uploadId])).rows) !== JSON.stringify(beforePlanning)) throw new Error('Planning changed review history');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Planning controls overflow mobile viewport');
  await page.screenshot({ path: resolve(directory, 'planning-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  evidence.checks.push('Real catalog GET and selected-plan POST: row and present descriptions, session scope, sibling control lock, no count/save calls, identical review history, mobile fit');
  // These are deliberate transport contract probes after the genuine flow above.
  for (const kind of ['invalid-json', 'foreign', 'revision', 'extra', 'unknown-error', 'too-large', 'wrong-content-type']) {
    let requests = 0;
    const corruptPlan = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      requests++;
      const actual = await route.fetch();
      if (actual.status() !== 200) throw new Error('Planning probe requires genuine success');
      if (kind === 'invalid-json') { await route.fulfill({ response: actual, body: 'private-planning-probe' }); return; }
      if (kind === 'too-large') { await route.fulfill({ response: actual, body: ' '.repeat(1_048_577) }); return; }
      if (kind === 'wrong-content-type') { await route.fulfill({ response: actual, contentType: 'text/html', body: 'private-planning-probe' }); return; }
      if (kind === 'unknown-error') { await route.fulfill({ response: actual, status: 503, json: { ok: false, code: 'private-planning-probe' } }); return; }
      const payload = await actual.json();
      if (kind === 'foreign') payload.plans[0].context.uploadId = 'other-worksheet';
      if (kind === 'revision') payload.reviewRevision = 2;
      if (kind === 'extra') payload.privateValues = ['private-planning-probe'];
      await route.fulfill({ response: actual, json: payload });
    };
    await page.route(planningPattern, corruptPlan);
    try {
      await planningSection.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
      await expect(planningSection.getByRole('alert')).toContainText(/PLANNING_RESPONSE_INVALID|PLANNING_RESPONSE_MISMATCH/);
      await expect(planningSection.getByRole('region', { name: 'Planned requests', exact: true })).toHaveCount(0);
      await expect(planningSection.getByRole('group', { name: 'Requests to plan', exact: true })).toHaveCount(0);
      await expect(planningSection).not.toContainText('private-');
      await expect(planningSection.getByRole('button', { name: 'Load planning choices', exact: true })).toBeEnabled();
      await pause(200); if (requests !== 1) throw new Error('Planning failure automatically retried');
    } finally { await page.unroute(planningPattern, corruptPlan); }
    await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click();
    await planningSection.getByRole('checkbox', { name: 'Present values — Amount (field 2)', exact: true }).check();
    await planningSection.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
    await expect(planningSection.getByText(plannedMessage, { exact: true })).toBeVisible();
  }
  for (const kind of ['cancel', 'timeout', 'navigate']) {
    let releaseResponse, responseArrived; let requests = 0;
    const waiting = new Promise(done => { releaseResponse = done; });
    const arrived = new Promise(done => { responseArrived = done; });
    const delayCatalog = async route => {
      requests++; const actual = await route.fetch(); responseArrived(); await waiting;
      // A browser may have discarded the interception after explicit abort.
      await route.fulfill({ response: actual }).catch(() => {});
    };
    await page.route(planningPattern, delayCatalog);
    try {
      await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click(); await waitForProbe(arrived);
      if (kind === 'navigate') {
        await page.getByRole('link', { name: 'Back to Data Hub imports', exact: true }).click();
        await expect(page).toHaveURL(origin + '/data-hub/import');
      } else {
        if (kind === 'cancel') await planningSection.getByRole('button', { name: 'Cancel planning', exact: true }).click();
        await expect(planningSection.getByRole('alert')).toContainText(kind === 'cancel' ? 'REQUEST_CANCELLED' : 'REQUEST_TIMED_OUT', { timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeEnabled();
        await expect(planningSection.getByRole('region', { name: 'Planned requests', exact: true })).toHaveCount(0);
        if (kind === 'timeout') {
          await page.setViewportSize({ width: 390, height: 844 });
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Timeout recovery overflows mobile viewport');
          await page.screenshot({ path: resolve(directory, 'planning-timeout-mobile.png'), fullPage: true });
          await page.setViewportSize({ width: 1280, height: 900 });
        }
      }
      if (requests !== 1) throw new Error('Aborted planning automatically retried');
    } finally { releaseResponse(); await page.unroute(planningPattern, delayCatalog); }
    if (kind === 'navigate') await open(ready.uploadId);
    await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click();
    await planningSection.getByRole('checkbox', { name: 'Present values — Amount (field 2)', exact: true }).check();
    const planButton = planningSection.getByRole('button', { name: 'Plan selected requests', exact: true });
    await planButton.focus(); await planButton.press('Enter');
    await expect(planningSection.getByText(plannedMessage, { exact: true })).toBeVisible();
  }
  page.off('request', observeExecution);
  if (executions !== 0) throw new Error('Planning probes called count or save');
  evidence.checks.push('Seven deliberately corrupted planning replies rejected, including oversized and non-JSON bodies; prior choices/plans clear, explicit genuine recovery');
  evidence.checks.push('Genuine catalog responses delayed for cancellation, 15-second timeout and navigation: locks release, late replies discarded, no automatic retry/count/save; keyboard selections and Enter submission recover');
  // Navigation clears the pre-existing measure choice; restore it for the
  // independent count-response probes below.
  await page.getByLabel('Measure to count', { exact: true }).selectOption(ready.col2);
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review screen overflows mobile viewport');
  await page.screenshot({ path: resolve(directory, 'counts-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Deliberately corrupt otherwise genuine count responses only for these
  // contract probes. The remaining journey uses unmodified HTTP responses.
  const countUrl = origin + endpoint(ready.uploadId) + '/analysis-count';
  const probes = ['negative', 'foreign', 'version', 'revision', 'extra', 'held', 'wrong-measure', 'invalid-json', 'unknown-error'];
  for (const kind of probes) {
    const present = kind === 'wrong-measure';
    const button = page.getByRole('button', { name: present ? 'Count present values' : 'Count rows', exact: true });
    let requests = 0;
    const observed = request => { if (request.url() === countUrl && request.method() === 'POST') requests++; };
    const corrupt = async route => {
      const actual = await route.fetch();
      if (actual.status() !== 200) throw new Error('Contract probe requires a genuine successful count');
      if (kind === 'unknown-error') {
        await route.fulfill({ response: actual, status: 503, json: { ok: false, code: 'private-response-probe' } }); return;
      }
      if (kind === 'invalid-json') {
        await route.fulfill({ response: actual, body: 'private-response-probe' }); return;
      }
      const body = await actual.json();
      if (kind === 'negative') body.result.count = -1;
      if (kind === 'foreign') body.result.context.uploadId = 'other-worksheet';
      if (kind === 'version') body.result.resultVersion = 'v2';
      if (kind === 'revision') body.reviewRevision = 0;
      if (kind === 'extra') body.result.sourceValues = ['private-response-probe'];
      if (kind === 'held') body.result.plan.readinessState = 'BLOCKED_QUALITY_HOLD';
      if (kind === 'wrong-measure') body.result.plan.sourceSchemaColumnId = 'other-measure';
      await route.fulfill({ response: actual, json: body });
    };
    page.on('request', observed); await page.route(countUrl, corrupt);
    try {
      await button.click();
      await expect(page.locator('main').getByRole('alert')).toContainText(/COUNT_RESPONSE_INVALID|COUNT_RESPONSE_MISMATCH|RESPONSE_INVALID|REQUEST_FAILED/);
      await expect(page.locator('main').getByText(/^(Rows|Present values):/)).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('private-');
      await expect(button).toBeEnabled(); await pause(300);
      if (requests !== 1) throw new Error('Count failure automatically retried');
    } finally { await page.unroute(countUrl, corrupt); page.off('request', observed); }
    await button.click();
    await expect(page.getByText(`${present ? 'Present values: 2' : 'Rows: 3'}. Based on review 1, profile ${ready.datasetProfileRunId}.`, { exact: true })).toBeVisible();
  }
  if ((await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n !== 1) throw new Error('Count response probes appended a review');
  evidence.checks.push('Nine deliberately corrupted count responses rejected without showing prior counts/private data or automatic retry; explicit genuine retries recover, review history unchanged');
  const reloaded = await api(endpoint(ready.uploadId) + '/analysis-review');
  if (reloaded.status !== 200 || reloaded.cache !== 'private, no-store' || reloaded.body.revision !== 1) throw new Error('Reload/caching failed');
  await page.reload(); await page.getByRole('button', { name: 'Load current review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved review 1', exact: true })).toBeVisible();
  await expect(page.getByLabel('Amount (field 2)', { exact: true })).toHaveValue('MEASURE');
  await page.getByRole('button', { name: 'Review quality', exact: true }).click();
  await expect(page.locator('select[id^="quality-"]').first()).toHaveValue('ACKNOWLEDGE');
  if ((await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n !== 1) throw new Error('Reload or preview appended review automatically');
  evidence.checks.push('Saved explicit meanings and matched quality decisions restored after reload; reads/preview append nothing');
  evidence.checks.push('Saved review survives browser reload; private no-store responses; mobile controls fit');

  // A role edit invalidates prior results and requires a new quality preview.
  await page.getByLabel('Amount (field 2)', { exact: true }).selectOption('MEASURE');
  await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toHaveCount(0);
  await chooseMeanings(); await chooseQuality();
  const blocker = await pool.connect();
  await blocker.query('SELECT pg_advisory_lock(90704191)');
  await pool.query(`CREATE FUNCTION browser_save_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(90704191); RETURN NEW; END $$;
    CREATE TRIGGER browser_save_gate BEFORE INSERT ON data_hub_analysis_reviews FOR EACH ROW EXECUTE FUNCTION browser_save_gate();`);
  const beforeFailure = (await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n;
  try {
    await page.getByRole('button', { name: 'Save review', exact: true }).click();
    // Release the lock after Prisma's real transaction timeout. This simulates
    // unavailable persistence without intercepting or mocking HTTP responses.
    await pause(6500);
  } finally { await blocker.query('SELECT pg_advisory_unlock(90704191)'); blocker.release(); }
  await expect(page.locator('main').getByRole('alert')).toContainText('REVIEW_SAVE_FAILED');
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
  await pool.query('DROP TRIGGER browser_save_gate ON data_hub_analysis_reviews; DROP FUNCTION browser_save_gate()');
  const afterFailure = (await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n;
  if (beforeFailure !== afterFailure) throw new Error('Timed-out save inserted review');
  await page.getByRole('button', { name: 'Load current review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved review 1', exact: true })).toBeVisible();
  evidence.checks.push('Real timed-out database save: no duplicate append, retry disabled until reload, saved review recovered');

  // Another explicit review append after discovery must invalidate the open
  // screen's selection, rather than silently adopting a newer revision.
  await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click();
  await planningSection.getByRole('checkbox', { name: 'Present values — Amount (field 2)', exact: true }).check();
  const reviewBody = { reviewVersion: 'v1', datasetProfileRunId: ready.datasetProfileRunId,
    semanticChoices: [{ sourceSchemaColumnId: ready.col1, role: 'IDENTIFIER' }, { sourceSchemaColumnId: ready.col2, role: 'MEASURE' }], qualityDecisions: [] };
  const previewUpdate = await api(endpoint(ready.uploadId) + '/analysis-review/plan', reviewBody);
  if (previewUpdate.status !== 200) throw new Error('Concurrent review fixture preview failed');
  reviewBody.qualityDecisions = previewUpdate.body.quality.items.map(item => ({ code: item.code, scope: item.scope,
    ...(item.sourceSchemaColumnId ? { sourceSchemaColumnId: item.sourceSchemaColumnId } : {}),
    decision: item.action === 'ACKNOWLEDGE_NOTICE' ? 'ACKNOWLEDGE' : 'CONTINUE' }));
  const advanced = await api(endpoint(ready.uploadId) + '/analysis-review', reviewBody);
  if (advanced.status !== 201 || advanced.body.revision !== 2) throw new Error('Concurrent explicit review did not advance');
  await planningSection.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
  await expect(planningSection.getByRole('alert')).toContainText('REVIEW_REVISION_MISMATCH');
  await expect(planningSection.getByRole('group', { name: 'Requests to plan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load current review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved review 2', exact: true })).toBeVisible();
  await planningSection.getByRole('button', { name: 'Load planning choices', exact: true }).click();
  await planningSection.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
  await expect(planningSection.getByText('1 request planned from saved review 2. Counts have not been calculated.', { exact: true })).toBeVisible();
  if ((await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n !== 2) throw new Error('Planning after review change appended history');
  evidence.checks.push('Real review advances after discovery: stale selection denied, choices clear, explicit review/catalog refresh plans revision 2 without extra append');

  // Wide metadata is prepared by the same real normalization/profiling path.
  // Only discovery replies are paged; selected requests still replan as one
  // current-review-pinned bundle, preserving exact click order across pages.
  if (!wide?.extraColumnIds?.length) throw new Error('Wide fixture missing');
  await open(wide.uploadId); await chooseMeanings(); await chooseQuality();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved review 1', exact: true })).toBeVisible();
  const widePlanning = page.getByRole('region', { name: 'Analysis planning', exact: true });
  const wideUrl = origin + endpoint(wide.uploadId) + '/analysis-planning';
  let wideExecutions = 0; let selectedBody;
  const observeWide = request => {
    if (request.method() === 'POST' && /\/analysis-(count|review)$/.test(new URL(request.url()).pathname)) wideExecutions++;
    if (request.url() === wideUrl && request.method() === 'POST') selectedBody = request.postDataJSON();
  };
  page.on('request', observeWide);
  await widePlanning.getByRole('button', { name: 'Load planning choices', exact: true }).click();
  await expect(widePlanning.getByText('Measures 1–50 of 51. Selections are kept across pages.', { exact: true })).toBeVisible();
  if (await widePlanning.getByRole('checkbox').count() !== 51) throw new Error('Discovery rendered an unbounded inventory');
  await widePlanning.getByRole('checkbox', { name: 'Present values — Amount (field 2)', exact: true }).check();
  for (let position = 5; position <= 22; position++) await widePlanning.getByRole('checkbox', { name: `Present values — Amount (field ${position})`, exact: true }).check();
  await widePlanning.getByRole('button', { name: 'Next measures', exact: true }).click();
  await expect(widePlanning.getByText('Measures 51–51 of 51. Selections are kept across pages.', { exact: true })).toBeVisible();
  const lastMeasure = widePlanning.getByRole('checkbox', { name: 'Present values — Amount (field 54)', exact: true });
  await expect(lastMeasure).toBeDisabled();
  await widePlanning.getByRole('button', { name: 'Remove Amount (field 2)', exact: true }).click();
  await lastMeasure.check();
  await expect(widePlanning.getByText('20 of 20 requests selected. Present values include zero; missing values are excluded.', { exact: true })).toBeVisible();
  await widePlanning.getByRole('button', { name: 'Plan selected requests', exact: true }).click();
  await expect(widePlanning.getByText('20 requests planned from saved review 1. Counts have not been calculated.', { exact: true })).toBeVisible();
  const expectedSelection = [...wide.extraColumnIds.slice(0, 18), wide.extraColumnIds.at(-1)];
  if (JSON.stringify(selectedBody) !== JSON.stringify({ datasetProfileRunId: wide.datasetProfileRunId,
    selection: { selectionVersion: 'v1', expectedReviewRevision: 1, includeRowCount: true, measureColumnIds: expectedSelection } })) throw new Error('Cross-page selection order changed');
  if (wideExecutions !== 0) throw new Error('Paged planning executed count/save');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Paged planning overflows mobile viewport');
  await widePlanning.screenshot({ path: resolve(directory, 'planning-paging-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  const widePattern = wideUrl + '**';
  const corruptPage = async route => {
    const actual = await route.fetch(); if (actual.status() !== 200) throw new Error('Page probe requires genuine success');
    const payload = await actual.json(); payload.page.nextOffset = 0;
    await route.fulfill({ response: actual, json: payload });
  };
  await page.route(widePattern, corruptPage);
  try {
    await widePlanning.getByRole('button', { name: 'Previous measures', exact: true }).click();
    await expect(widePlanning.getByRole('alert')).toContainText('PLANNING_RESPONSE_INVALID');
    await expect(widePlanning.getByRole('region', { name: 'Selected measures', exact: true })).toHaveCount(0);
    await expect(widePlanning.getByRole('region', { name: 'Planned requests', exact: true })).toHaveCount(0);
  } finally { await page.unroute(widePattern, corruptPage); }
  await widePlanning.getByRole('button', { name: 'Load planning choices', exact: true }).click();
  await expect(widePlanning.getByText('Measures 1–50 of 51. Selections are kept across pages.', { exact: true })).toBeVisible();
  page.off('request', observeWide);
  if (wideExecutions !== 0 || (await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [wide.uploadId])).rows[0].n !== 1) throw new Error('Paged planning changed review history');
  evidence.checks.push('51 real reviewed measures: bounded 50/1 pages, off-page removal, global 20-request limit and exact cross-page order; no count/save calls or extra review, mobile fit');
  evidence.checks.push('One deliberate invalid page cursor rejects the whole reply, clearing selections/plans; explicit genuine reload recovers');

  await open(held.uploadId); await chooseMeanings(); await chooseQuality(true);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('On hold for correction. Counts are unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Count present values', exact: true })).toBeDisabled();
  const heldCount = await api(endpoint(held.uploadId) + '/analysis-count', { requestVersion: 'v1', kind: 'ROW_COUNT' });
  if (heldCount.status !== 422 || heldCount.body.code !== 'QUALITY_HOLD') throw new Error('Hold bypassed by direct request');
  const heldPage = await api(endpoint(held.uploadId) + '/analysis-planning?' + new URLSearchParams({ pageVersion: 'v1', datasetProfileRunId: held.datasetProfileRunId,
    expectedReviewRevision: '1', pageSize: '50', offset: '0' }));
  if (heldPage.status !== 422 || heldPage.body.code !== 'QUALITY_HOLD') throw new Error('Paged hold bypassed');
  await expect(page.getByRole('button', { name: 'Load planning choices', exact: true })).toBeDisabled();
  for (const body of [undefined, { ...selection, datasetProfileRunId: held.datasetProfileRunId,
    selection: { ...selection.selection, measureColumnIds: [] } }]) {
    const result = await api(endpoint(held.uploadId) + '/analysis-planning', body);
    if (result.status !== 422 || result.body.code !== 'QUALITY_HOLD') throw new Error('Planning hold bypassed');
  }
  evidence.checks.push('Explicit HOLD persisted and blocks both UI counts and direct API');

  const stale = await api(endpoint(ready.uploadId) + '/analysis-review', { reviewVersion: 'v1', datasetProfileRunId: 'stale-profile', semanticChoices: [], qualityDecisions: [] });
  if (stale.status !== 409) throw new Error('Stale profile pin accepted');
  for (const body of [{ ...selection, datasetProfileRunId: 'obsolete-profile' },
    { ...selection, selection: { ...selection.selection, expectedReviewRevision: 999 } }]) {
    if ((await api(endpoint(ready.uploadId) + '/analysis-planning', body)).status !== 409) throw new Error('Stale planning pin accepted');
  }
  evidence.checks.push('Planning UI and direct requests enforce quality hold; obsolete profile and review pins return 409');
  evidence.checks.push('Obsolete profile pin sent through authenticated browser returns 409 without appending');
  await pool.query('UPDATE users SET role=\'VIEWER\' WHERE id=$1', [ready.userId]);
  const denied = await api(endpoint(ready.uploadId) + '/analysis-review/plan');
  if (denied.status !== 403) throw new Error('Live role demotion failed');
  for (const body of [undefined, selection]) if ((await api(endpoint(ready.uploadId) + '/analysis-planning', body)).status !== 403) throw new Error('Planning demotion failed');
  await pool.query('UPDATE users SET role=\'MANAGER\',organisation_id=\'org-b\' WHERE id=$1', [ready.userId]);
  if ((await api(endpoint(ready.uploadId) + '/analysis-review/plan')).status !== 401) throw new Error('Moved account retained session');
  for (const body of [undefined, selection]) if ((await api(endpoint(ready.uploadId) + '/analysis-planning', body)).status !== 401) throw new Error('Planning moved session accepted');
  await pool.query('UPDATE users SET organisation_id=\'org-a\' WHERE id=$1', [ready.userId]);
  const foreignUser = 'browser-foreign-manager';
  await pool.query('INSERT INTO users(id,organisation_id,username,email,name,password_hash,role,updated_at) SELECT $1,\'org-b\',$1,$1||\'@example.test\',\'Other manager\',password_hash,\'MANAGER\',now() FROM users WHERE id=$2', [foreignUser, ready.userId]);
  await context.clearCookies(); await page.goto(origin + '/login');
  await page.getByLabel('Username', { exact: true }).fill(foreignUser); await page.getByLabel('Password', { exact: true }).fill(password);
  const foreignLogin = page.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await foreignLogin;
  if ((await api(endpoint(ready.uploadId) + '/analysis-review/plan')).status !== 404) throw new Error('Foreign worksheet exposed');
  for (const body of [undefined, selection]) if ((await api(endpoint(ready.uploadId) + '/analysis-planning', body)).status !== 404) throw new Error('Planning foreign worksheet exposed');
  evidence.checks.push('DB role demotion 403, moved session 401, separately logged-in foreign organisation 404');
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join('; ')}`);
  evidence.checks.push('No browser page exceptions');
  evidence.passed = true;
  writeFileSync(resolve(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  if (next?.pid) {
    if (process.platform === 'win32') await new Promise(done => {
      const stop = spawn('taskkill', ['/PID', String(next.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); stop.on('exit', done); stop.on('error', done);
    }); else next.kill('SIGTERM');
  }
  writeFileSync(resolve(directory, 'next-server.log'), nextLog);
  await pool.end(); // Outer shell always removes its own Docker container.
}
