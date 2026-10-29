// Built local application and owned database. Blob and Neon NETWORK transports
// are emulated; application routes, SDK, authorization and persistence are real.
import { spawn, execFileSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createSecureServer } from 'node:http2';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium, expect as baseExpect } from '@playwright/test';
import { Pool } from 'pg';
import { createPilotWorkbook } from './helpers/dataHubPilotWorkbook.mjs';
import blob from './helpers/localDataHubBlobFixture.cjs';
const expect = baseExpect.configure({ timeout: 30000 });

if (process.env.DATAHUB_PILOT_ACCEPTANCE !== '1' || process.env.DATAHUB_MAPPING_PROOF !== '1' ||
  !process.env.DATABASE_URL || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname) ||
  new URL(process.env.DATABASE_URL).pathname !== '/testdb') throw new Error('OWNED_PILOT_HARNESS_REQUIRED');
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { username, password } = JSON.parse(input); input = '';
const directory = path.resolve('test-results/runs-pilot-acceptance'); await mkdir(directory, { recursive: true });
const storage = await mkdtemp(path.join(directory, 'owned-blob-'));
const bytes = createPilotWorkbook(), sha = createHash('sha256').update(bytes).digest('hex');
const provider = blob.createProvider(storage, sha);
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace('localhost', '127.0.0.1') });
const port = await new Promise((resolve, reject) => { const listener = createServer(); listener.on('error', reject);
  listener.listen(0, '127.0.0.1', () => { const address = listener.address(); listener.close(() => resolve(address.port)); }); });
const origin = `http://127.0.0.1:${port}`;
// Chromium does not expose every streamed Blob body via request.postDataBuffer.
// Redirect the real upload to an owned TLS listener so its actual bytes arrive.
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(storage, 'key.pem'),
  '-out', path.join(storage, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
const providerErrors = [];
const uploadSessions = new Set();
let uploads = 0;
const uploadServer = createSecureServer({ allowHTTP1: true, key: await readFile(path.join(storage, 'key.pem')), cert: await readFile(path.join(storage, 'cert.pem')) }, async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || '*');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    if (request.method !== 'PUT' || request.headers.origin !== origin) throw new Error('FIXTURE_REQUEST_INVALID');
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > bytes.length) throw new Error('FIXTURE_BODY_TOO_LARGE'); chunks.push(chunk); }
    const metadata = provider.accept(blob.API + request.url, request.headers.authorization, Buffer.concat(chunks));
    uploads++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(metadata));
  } catch (error) { providerErrors.push(error.message); response.writeHead(400); response.end('{}'); }
});
uploadServer.on('session', session => { uploadSessions.add(session); session.on('close', () => uploadSessions.delete(session)); });
await new Promise(resolve => uploadServer.listen(0, '127.0.0.1', resolve));
const uploadOrigin = `https://127.0.0.1:${uploadServer.address().port}`;
const preload = name => `--require "${path.resolve('scripts/tests/helpers', name).replaceAll('\\', '/')}"`;
const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATAHUB_BROWSER_PROOF: '1',
    DATAHUB_PILOT_UPLOAD_PROOF: '1', DATAHUB_PILOT_BLOB_DIRECTORY: storage, DATAHUB_PILOT_SHA256: sha,
    DATAHUB_BLOB_STORE_ID: blob.STORE, DATAHUB_BLOB_READ_WRITE_TOKEN: blob.TOKEN, VERCEL_BLOB_RETRIES: '0',
    NODE_OPTIONS: `${preload('localDataHubNeonFetch.cjs')} ${preload('localDataHubBlobFixture.cjs')}`,
  },
});
let log = '', browser, page, passed = false;
const checks = [], pageErrors = [], writes = [], networkFailures = [];
server.stdout.on('data', part => { log += part; }); server.stderr.on('data', part => { log += part; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 90; i++) { if (server.exitCode !== null) throw new Error('LOCAL_NEXT_FAILED');
    try { if ((await fetch(origin + '/login')).ok) { ready = true; break; } } catch { /* owned listener starting */ }
    await pause(500); }
  if (!ready) throw new Error('LOCAL_NEXT_TIMEOUT');
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.origin === blob.API && ['PUT', 'OPTIONS'].includes(request.method())) return route.continue({ url: uploadOrigin + url.pathname + url.search });
    return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  // Use the actual browser cookie transport. APIRequestContext does not share
  // Chromium's secure-cookie allowance for loopback HTTP origins.
  const api = (route, body) => page.evaluate(async ({ route, body }) => {
    const response = await fetch(route, { credentials: 'same-origin', cache: 'no-store', method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { route, body });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => networkFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/data-hub/')) writes.push(new URL(request.url()).pathname); });
  await page.goto(origin + '/login'); await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(async () => (await context.cookies()).some(c => c.name === 'session' && c.httpOnly && c.secure)).toBe(true);
  await page.goto(origin + '/data-hub/import');
  await page.getByLabel('Source System (optional)', { exact: true }).selectOption('mapping-proof-source');
  await page.getByLabel('Choose a CSV or Excel (.xlsx) file').setInputFiles({ name: 'synthetic-runs-pilot.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  await page.getByRole('button', { name: 'Start import', exact: true }).click();
  await page.getByRole('button', { name: 'Compare to governed schema', exact: true }).click();
  await page.getByRole('button', { name: 'Use governed schema', exact: true }).click();
  await expect(page.getByText('This import batch is now bound to governed schema v1.', { exact: true })).toBeVisible();
  expect(uploads).toBe(1);
  const batch = (await pool.query("SELECT id,status,sha256,storage_provider,source_schema_version_id FROM import_batches WHERE original_filename='synthetic-runs-pilot.xlsx' AND organisation_id='mapping-proof-org'")).rows;
  expect(batch).toHaveLength(1); expect(batch[0]).toMatchObject({ status: 'READY', sha256: sha, storage_provider: 'vercel-blob-private', source_schema_version_id: 'dhcfg-onk-mwco-sv1' });
  const worksheets = (await pool.query('SELECT id,worksheet_name FROM uploads WHERE import_batch_id=$1 ORDER BY worksheet_index', [batch[0].id])).rows;
  expect(worksheets).toHaveLength(14); const uploadId = worksheets.find(w => w.worksheet_name === 'Runs').id;
  checks.push('Real import UI, genuine SDK signed direct upload through local provider transport, finalize signature/SHA/archive validation, inspection and exact schema selection; no READY rows or lineage injected');

  await page.goto(`${origin}/data-hub/prepare/${uploadId}`);
  await page.getByRole('button', { name: 'Prepare source rows', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('confirm its saved mapping');
  expect((await pool.query('SELECT id FROM data_hub_raw_staging_runs WHERE upload_id=$1', [uploadId])).rows).toHaveLength(0);
  await page.getByRole('link', { name: 'Review units and saved mapping before first preparation' }).click();
  await page.getByLabel('How does your report mark missing values?').selectOption('NULL_ONLY');
  await page.getByLabel('Unit for Ave Bin Weight', { exact: true }).selectOption('kg');
  for (const field of ['Travel Distance Kms', 'Collection Distance Kms', 'Total Distance']) await page.getByLabel(`Unit for ${field}`, { exact: true }).selectOption('km');
  for (const field of ['Loads', 'Collections Booked', 'Collections Performed', 'Not Presented', 'Contaminated']) await page.getByLabel(`Are negative values valid for ${field}?`, { exact: true }).selectOption('FORBID');
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Save and activate reviewed mapping' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm mapping for this workbook' }); await expect(confirm).toBeDisabled();
  const stillBlocked = await api(`/api/data-hub/worksheets/${uploadId}/stage`, {});
  expect(stillBlocked.status).toBe(409); expect(stillBlocked.body.code).toBe('MAPPING_CONFIRMATION_REQUIRED');
  await page.getByRole('checkbox', { name: 'This workbook uses the displayed units and formats.' }).check(); await confirm.click();
  await expect(page.getByText(/This workbook is confirmed/)).toBeVisible();
  checks.push('Unconfirmed staging denied without run creation; explicit complete administrator mapping approval and separate workbook confirmation');
  await page.getByRole('link', { name: 'Back to worksheet preparation' }).click();
  for (const name of ['Prepare source rows', 'Standardize values', 'Build dataset profile']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('link', { name: 'Open worksheet review', exact: true }).click();
  await page.getByRole('button', { name: 'Load current review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Field meanings', exact: true })).toBeVisible();
  const fields = page.locator('select[id^="field-"]');
  for (const field of await fields.all()) { const values = await field.locator('option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
    await field.selectOption(values.includes('MEASURE') ? 'MEASURE' : values[0]); }
  await page.getByRole('button', { name: 'Review quality', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Data quality', exact: true })).toBeVisible();
  const quality = page.locator('select[id^="quality-"]');
  for (const hold of [true, false]) {
    await expect(page.getByRole('heading', { name: 'Data quality', exact: true })).toBeVisible();
    await expect(quality.first()).toBeVisible();
    let held = 0;
    for (const field of await quality.all()) { const values = await field.locator('option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
      const value = values.includes('ACKNOWLEDGE') ? 'ACKNOWLEDGE' : hold && values.includes('HOLD') ? 'HOLD' : 'CONTINUE';
      if (value === 'HOLD') held++; await field.selectOption(value); await expect(field).toHaveValue(value); }
    if (hold) expect(held).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Save review', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Saved review ${hold ? 1 : 2}`, exact: true })).toBeVisible();
    if (hold) {
      await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeDisabled();
      const denied = await api(`/api/data-hub/worksheets/${uploadId}/analysis-count`, { requestVersion: 'v1', kind: 'ROW_COUNT' });
      expect(denied.status).toBe(422);
      await page.getByRole('button', { name: 'Load current review', exact: true }).click();
      await page.getByRole('button', { name: 'Review quality', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Count rows', exact: true }).click();
  await expect(page.getByText(/^Rows: 2\. Based on review 2,/)).toBeVisible();
  const column = 'dhcfg-onk-mwco-sv1-ws-runs-c008';
  await page.getByLabel('Measure to count', { exact: true }).selectOption(column);
  await page.getByRole('button', { name: 'Count present values', exact: true }).click();
  await expect(page.getByText(/^Present values: 1\. Based on review 2,/)).toBeVisible();
  checks.push('Browser staging/normalization/profile; explicit field and quality review; HOLD denies counts; corrected revision counts 2 rows and 1 present value including zero and excluding null');
  const upload = (await pool.query('SELECT dataset_profile_run_id,raw_profile_version_id,normalized_profile_version_id FROM uploads WHERE id=$1', [uploadId])).rows[0];
  expect(upload.raw_profile_version_id).toBe(upload.normalized_profile_version_id);
  const normalized = (await pool.query(`SELECT c.source_schema_column_id,c.normalized_value,c.normalized_unit
    FROM data_hub_normalized_cells c JOIN data_hub_normalized_rows r ON r.id=c.normalized_row_id AND r.organisation_id=c.organisation_id
    JOIN data_hub_normalization_runs n ON n.id=r.normalization_run_id AND n.organisation_id=r.organisation_id
    WHERE n.upload_id=$1 ORDER BY r.source_row_number,c.source_schema_column_id`, [uploadId])).rows;
  expect(normalized).toHaveLength(42);
  expect(normalized[0].normalized_value).toBe('0001'); expect(normalized[6].normalized_value).toBe('0'); expect(normalized[8].normalized_value).toBeNull();
  expect(normalized[13].normalized_unit).toBe('bins/h'); expect(normalized[14].normalized_unit).toBe('t/h');
  expect(normalized[17]).toMatchObject({ normalized_value: '0.5', normalized_unit: 'd' });
  expect(normalized[29].normalized_value).toBe('0');
  expect((await pool.query('SELECT id FROM data_hub_dataset_profile_columns WHERE profile_run_id=$1', [upload.dataset_profile_run_id])).rows).toHaveLength(21);
  expect((await pool.query('SELECT id FROM data_hub_analysis_reviews WHERE upload_id=$1', [uploadId])).rows).toHaveLength(2);
  const history = await api(`/api/data-hub/worksheets/${uploadId}/analysis-review/history?${new URLSearchParams({ historyVersion: 'v1', datasetProfileRunId: upload.dataset_profile_run_id, expectedReviewRevision: '2' })}`);
  expect(history.status).toBe(200);
  const historyRegion = page.getByRole('region', { name: 'Saved review history', exact: true });
  await historyRegion.getByRole('button', { name: 'Load review history', exact: true }).click();
  await expect(historyRegion.getByRole('heading', { name: 'Revision 1', exact: true })).toBeVisible();
  await historyRegion.getByRole('button', { name: 'Compare revision 1 with current review', exact: true }).click();
  await expect(historyRegion.getByRole('region', { name: 'Review decision changes' })).toContainText('hold → continue');
  await historyRegion.getByRole('button', { name: 'View decisions in revision 1', exact: true }).click();
  await expect(historyRegion.getByRole('region', { name: 'Saved review decisions', exact: true })).toContainText('hold');
  await expect(page.getByRole('button', { name: 'Count rows', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(directory, 'counts-mobile.png') });
  await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [username]);
  expect((await api(`/api/data-hub/worksheets/${uploadId}/mapping-setup`)).status).toBe(403);
  expect(pageErrors).toEqual([]); expect(providerErrors).toEqual([]); checks.push('Exact pinned mapping lineage, both review revisions, real history API, phone layout and live role revocation');
  passed = true;
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    await writeFile(path.join(directory, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable')); }
  throw error;
} finally {
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [username]).catch(() => {});
  await browser?.close(); await pool.end();
  for (const session of uploadSessions) session.destroy();
  await new Promise(resolve => uploadServer.close(resolve));
  if (server.exitCode === null) { server.kill(); await Promise.race([new Promise(resolve => server.once('exit', resolve)), pause(5000)]); }
  const closed = await new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED')); socket.setTimeout(1000, () => { socket.destroy(); resolve(false); }); });
  // Only the exact mkdtemp child created above can be removed.
  if (!storage.startsWith(directory + path.sep + 'owned-blob-')) throw new Error('CLEANUP_SCOPE_INVALID');
  await rm(storage, { recursive: true, force: true });
  await writeFile(path.join(directory, 'next-server.log'), log);
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify({ passed: passed && closed, checks, uploads, observedBrowserPosts: writes,
    worksheetCount: 14, runsRuleCount: 21, pageErrors, providerErrors, networkFailures, listenerClosed: closed, ownedStorageRemoved: true,
    boundary: 'Synthetic data and owned loopback Postgres/Next only. Neon and Blob network transports emulated; no hosted provider or real pilot acceptance; Production unchanged.' }, null, 2));
  if (!closed) throw new Error('LOCAL_LISTENER_NOT_CLOSED');
}
console.log(`PASS: complete local Runs pilot journey (${checks.length} groups); hosted provider acceptance remains separate.`);
