import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';

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
const evidence = { checks: [], transport: 'Local Neon transport; real application and PostgreSQL', productionTouched: false };
try {
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
  const ready = worlds.find(world => !world.held), held = worlds.find(world => world.held);
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
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review screen overflows mobile viewport');
  await page.screenshot({ path: resolve(directory, 'counts-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Deliberately corrupt otherwise genuine count responses only for these
  // contract probes. The remaining journey uses unmodified HTTP responses.
  const countUrl = origin + endpoint(ready.uploadId) + '/analysis-count';
  const probes = ['negative', 'foreign', 'version', 'revision', 'extra', 'held', 'wrong-measure', 'invalid-json'];
  for (const kind of probes) {
    const present = kind === 'wrong-measure';
    const button = page.getByRole('button', { name: present ? 'Count present values' : 'Count rows', exact: true });
    let requests = 0;
    const observed = request => { if (request.url() === countUrl && request.method() === 'POST') requests++; };
    const corrupt = async route => {
      const actual = await route.fetch();
      if (actual.status() !== 200) throw new Error('Contract probe requires a genuine successful count');
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
      await expect(page.locator('main').getByRole('alert')).toContainText(/COUNT_RESPONSE_INVALID|COUNT_RESPONSE_MISMATCH|RESPONSE_INVALID/);
      await expect(page.locator('main').getByText(/^(Rows|Present values):/)).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('private-');
      await expect(button).toBeEnabled(); await pause(300);
      if (requests !== 1) throw new Error('Count failure automatically retried');
    } finally { await page.unroute(countUrl, corrupt); page.off('request', observed); }
    await button.click();
    await expect(page.getByText(`${present ? 'Present values: 2' : 'Rows: 3'}. Based on review 1, profile ${ready.datasetProfileRunId}.`, { exact: true })).toBeVisible();
  }
  if ((await pool.query('SELECT count(*)::int AS n FROM data_hub_analysis_reviews WHERE upload_id=$1', [ready.uploadId])).rows[0].n !== 1) throw new Error('Count response probes appended a review');
  evidence.checks.push('Eight deliberately corrupted count responses rejected without showing prior counts/private data or automatic retry; explicit genuine retries recover, review history unchanged');
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

  await open(held.uploadId); await chooseMeanings(); await chooseQuality(true);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('On hold for correction. Counts are unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Count present values', exact: true })).toBeDisabled();
  const heldCount = await api(endpoint(held.uploadId) + '/analysis-count', { requestVersion: 'v1', kind: 'ROW_COUNT' });
  if (heldCount.status !== 422 || heldCount.body.code !== 'QUALITY_HOLD') throw new Error('Hold bypassed by direct request');
  evidence.checks.push('Explicit HOLD persisted and blocks both UI counts and direct API');

  const stale = await api(endpoint(ready.uploadId) + '/analysis-review', { reviewVersion: 'v1', datasetProfileRunId: 'stale-profile', semanticChoices: [], qualityDecisions: [] });
  if (stale.status !== 409) throw new Error('Stale profile pin accepted');
  evidence.checks.push('Obsolete profile pin sent through authenticated browser returns 409 without appending');
  await pool.query('UPDATE users SET role=\'VIEWER\' WHERE id=$1', [ready.userId]);
  const denied = await api(endpoint(ready.uploadId) + '/analysis-review/plan');
  if (denied.status !== 403) throw new Error('Live role demotion failed');
  await pool.query('UPDATE users SET role=\'MANAGER\',organisation_id=\'org-b\' WHERE id=$1', [ready.userId]);
  if ((await api(endpoint(ready.uploadId) + '/analysis-review/plan')).status !== 401) throw new Error('Moved account retained session');
  await pool.query('UPDATE users SET organisation_id=\'org-a\' WHERE id=$1', [ready.userId]);
  const foreignUser = 'browser-foreign-manager';
  await pool.query('INSERT INTO users(id,organisation_id,username,email,name,password_hash,role,updated_at) SELECT $1,\'org-b\',$1,$1||\'@example.test\',\'Other manager\',password_hash,\'MANAGER\',now() FROM users WHERE id=$2', [foreignUser, ready.userId]);
  await context.clearCookies(); await page.goto(origin + '/login');
  await page.getByLabel('Username', { exact: true }).fill(foreignUser); await page.getByLabel('Password', { exact: true }).fill(password);
  const foreignLogin = page.waitForResponse(response => new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await foreignLogin;
  if ((await api(endpoint(ready.uploadId) + '/analysis-review/plan')).status !== 404) throw new Error('Foreign worksheet exposed');
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
