// Real Next server + real login/session/capability paths; disposable Postgres.
// SQL-over-HTTP is a local wire adapter, not an HR/session response fixture.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { chromium } from '@playwright/test';
import { verifyRemainingWorkflows } from './helpers/hrLocalWorkflows.mjs';
import { verifyHrSetup } from './helpers/hrLocalSetup.mjs';

const root = process.cwd();
if (!existsSync(path.join(root, 'scripts/create-hr-people.sql'))) throw new Error('Run from the repository worktree.');
const name = `hr-full-local-${randomUUID().slice(0, 8)}`;
const nextDirectory = path.resolve(root, '.next');
const devCache = path.resolve(nextDirectory, 'dev');
const previousCache = path.resolve(nextDirectory, `${name}-previous-dev`);
if (path.dirname(devCache) !== nextDirectory || path.dirname(previousCache) !== nextDirectory) throw new Error('Invalid local cache paths.');
let cacheOwned = false, cacheBackedUp = false;
const password = randomUUID();
let pool, bridge, app, browser;
let appOrigin;
let logs = '';
const exec = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server?.close(resolve) ?? resolve());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (existsSync(path.join(devCache, 'lock'))) throw new Error('Close the existing Next development server before this proof.');
  mkdirSync(nextDirectory, { recursive: true });
  if (existsSync(devCache)) { renameSync(devCache, previousCache); cacheBackedUp = true; }
  cacheOwned = true;
  console.log('Starting isolated full-app HR proof.');
  exec('docker', ['run', '-d', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=hrproof', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const mapping = exec('docker', ['port', name, '5432/tcp']).trim();
  if (!mapping.startsWith('127.0.0.1:')) throw new Error('Database must bind only loopback.');
  const databaseUrl = `postgresql://postgres:${password}@${mapping}/hrproof`;
  // Neon derives an HTTPS hostname from DATABASE_URL; numeric IPs are rewritten
  // into an invalid api.0.0.1 hostname before Next can invoke the fetch guard.
  const appDatabaseUrl = databaseUrl.replace('@127.0.0.1:', '@localhost:');
  pool = new pg.Pool({ connectionString: databaseUrl });
  for (let i = 0; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch { if (i === 30) throw new Error('Disposable database startup failed.'); await sleep(1000); }
  }
  // Prevent inherited credentials and dotenv settings from selecting live services.
  const env = { ...process.env, NODE_OPTIONS: '' };
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PASSWORD|DATABASE_URL|DIRECT_URL/i.test(key)) env[key] = '';
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (existsSync(file)) for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = '';
  }
  Object.assign(env, { DATABASE_URL: appDatabaseUrl, DIRECT_URL: databaseUrl, SESSION_SECRET: randomUUID() + randomUUID(), NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' });
  console.log('Applying repository Prisma schema to disposable database.');
  exec(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env });
  const q = (text, values) => pool.query(text, values);
  for (const file of ['create-hr-teams.sql', 'create-hr-people.sql', 'add-hr-teams-archive.sql', 'create-hr-administrators.sql', 'add-hr-people-tenant-unique.sql', 'create-hr-lifecycle-workflows.sql', 'create-hr-employee-documents.sql', 'create-hr-employee-document-assurance.sql', 'create-hr-restricted-cases.sql']) await q(readFileSync(`scripts/${file}`, 'utf8'));
  const hash = await bcrypt.hash(password, 10);
  for (const org of ['local-hr', 'local-other']) await q('INSERT INTO organisations(id,name,slug,updated_at) VALUES($1,$1,$1,now())', [org]);
  for (const user of ['local-admin', 'local-employee', 'local-manager']) await q(`INSERT INTO users(id,organisation_id,username,name,password_hash,updated_at) VALUES($1,'local-hr',$1,$1,$2,now())`, [user, hash]);
  await q("INSERT INTO modules(key,name,active,updated_at) VALUES('people','People',true,now())");
  await q("INSERT INTO organisation_modules(organisation_id,module_key,enabled,updated_at) VALUES('local-hr','people',true,now())");
  await q("INSERT INTO hr_administrators(organisation_id,user_id) VALUES('local-hr','local-admin')");
  await q("INSERT INTO hr_people(organisation_id,linked_user_id,first_name,last_name) VALUES('local-hr','local-employee','Local','Employee'),('local-other',NULL,'Foreign','Fixture')");
  let sqlCalls = 0;
  const objects = new Map();
  let storageCalls = 0;
  const emails = [];
  env.RESEND_API_KEY = 'local-email-fixture';
  env.CRON_SECRET = randomUUID();
  bridge = createServer(async (request, response) => {
    let client;
    try {
      const url = new URL(request.url, 'http://local.test');
      if (url.pathname === '/email') {
        assert.equal(request.headers.authorization, 'Bearer local-email-fixture');
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const mail = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(mail.to, 'employee@local.invalid');
        emails.push(mail);
        if (emails.length === 2) { response.destroy(); return; }
        response.setHeader('Content-Type', 'application/json');
        if (emails.length === 3) { response.statusCode = 422; response.end(JSON.stringify({ name: 'local_rejected' })); return; }
        response.end(JSON.stringify({ id: `local-email-${emails.length}` })); return;
      }
      if (url.pathname.startsWith('/blob') || url.pathname.startsWith('/objects/')) {
        const token = request.headers.authorization;
        assert.ok(['Bearer vercel_blob_rw_localemployee_fixture', 'Bearer vercel_blob_rw_localrestricted_fixture'].includes(token));
        const store = token.includes('localrestricted') ? 'localrestricted' : 'localemployee';
        storageCalls++;
        if (request.method === 'POST' && url.pathname === '/blob/delete') {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          for (const key of JSON.parse(Buffer.concat(chunks).toString()).urls) {
            const object = objects.get(key);
            if (object) { assert.equal(object.token, token); objects.delete(key); }
          }
          response.setHeader('Content-Type', 'application/json'); response.end('{}'); return;
        }
        if (url.pathname.startsWith('/objects/')) {
          const object = objects.get(decodeURIComponent(url.pathname.slice(9)));
          if (!object) { response.statusCode = 404; response.end(); return; }
          assert.equal(object.token, token);
          response.writeHead(200, { 'Content-Type': object.meta.contentType, 'Content-Length': object.bytes.length, ETag: object.meta.etag, 'Last-Modified': object.meta.uploadedAt, 'Cache-Control': 'private, no-store' });
          response.end(object.bytes); return;
        }
        const key = url.searchParams.get('pathname') ?? url.searchParams.get('url');
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'PUT') {
          assert.ok(key); assert.ok(!objects.has(key));
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          const meta = { pathname: key, url: `https://${store}.private.blob.vercel-storage.com/${key}`, downloadUrl: `https://${store}.private.blob.vercel-storage.com/${key}?download=1`, size: bytes.length, contentType: request.headers['x-content-type'] ?? 'application/pdf', etag: randomUUID(), uploadedAt: new Date().toISOString(), contentDisposition: 'attachment', cacheControl: 'private, no-store' };
          objects.set(key, { bytes, meta, token }); response.end(JSON.stringify(meta)); return;
        }
        if (request.method === 'GET') {
          const object = objects.get(key);
          if (!object) { response.statusCode = 404; response.end(JSON.stringify({ error: { code: 'not_found', message: 'Fixture object missing' } })); return; }
          assert.equal(object.token, token);
          response.end(JSON.stringify(object.meta)); return;
        }
        throw new Error('Unexpected local storage operation.');
      }
      if (request.headers['neon-connection-string'] !== appDatabaseUrl) throw new Error('Wrong fixture connection.');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      client = await pool.connect();
      if (body.queries) await client.query('BEGIN');
      const results = [];
      for (const spec of body.queries ?? [body]) {
        sqlCalls++;
        const result = await client.query({ text: spec.query, values: spec.params, rowMode: 'array', types: { getTypeParser: () => value => value } });
        results.push({ fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })), rows: result.rows, rowCount: result.rowCount, command: result.command });
      }
      if (body.queries) await client.query('COMMIT');
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body.queries ? { results } : results[0]));
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      response.statusCode = 400; response.end(JSON.stringify({ message: error.message, code: error.code }));
    } finally { client?.release(); }
  });
  const sqlPort = await listen(bridge);
  const reserved = createServer(); const appPort = await listen(reserved); await close(reserved);
  Object.assign(env, { HR_LOCAL_SQL_BRIDGE: `http://127.0.0.1:${sqlPort}/sql`, VERCEL_BLOB_API_URL: `http://127.0.0.1:${sqlPort}/blob`, HR_EMPLOYEE_DOC_BLOB_STORE_ID: 'localemployee', HR_EMPLOYEE_DOC_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_localemployee_fixture', NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'scripts/tests/helpers/hrLocalNetworkGuard.mjs')).href}` });
  Object.assign(env, { HR_RESTRICTED_BLOB_STORE_ID: 'localrestricted', HR_RESTRICTED_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_localrestricted_fixture' });
  exec(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import {fetch as sdkFetch} from 'undici';
    await assert.rejects(fetch('https://example.invalid'), /External fetch blocked/);
    await assert.rejects(sdkFetch('https://example.invalid'));
    await assert.rejects(fetch('http://localhost/sql',{headers:{'Neon-Connection-String':'postgresql://not-a-fixture'}}), /Non-fixture SQL/);
  `], { env });
  console.log('PASS: fetch/SDK external egress and non-fixture SQL are rejected.');
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(appPort)], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-24000); });
  const origin = `http://127.0.0.1:${appPort}`;
  appOrigin = origin;
  console.log('Starting real Next server with all external fetches blocked.');
  const readyDeadline = Date.now() + 120000;
  for (;;) {
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* startup */ }
    if (app.exitCode !== null || Date.now() > readyDeadline) throw new Error('Local Next server did not become ready.');
    await sleep(1000);
  }
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username', { exact: true }).fill('local-admin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  for (let i = 0; ; i++) {
    if ((await context.cookies()).some(cookie => cookie.name === 'session')) break;
    if (i === 60) throw new Error('Real login did not issue a session.');
    await sleep(1000);
  }
  console.log('Real login issued its session cookie. Checking actual HR routes.');
  const session = (await context.cookies()).find(cookie => cookie.name === 'session');
  assert.ok(session?.httpOnly); assert.equal(session.sameSite, 'Lax');
  const people = await context.request.get(`${origin}/api/hr/people`);
  assert.equal(people.status(), 200);
  const payload = await people.json(); assert.equal(payload.canManage, true);
  assert.ok(payload.people.some(person => person.first_name === 'Local'));
  assert.ok(!payload.people.some(person => person.first_name === 'Foreign'));
  const person = payload.people.find(person => person.first_name === 'Local');
  await page.goto(`${origin}/people`, { timeout: 120000 });
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await page.getByLabel('Document type', { exact: true }).fill('policy');
  await page.getByLabel('Title', { exact: true }).fill('Local full-app policy');
  await page.locator('input[type=file]').setInputFiles({ name: 'local.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Local synthetic document bytes') });
  const uploaded = page.waitForResponse(response => response.url() === `${origin}/api/hr/people/${person.id}/documents` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  const upload = await uploaded;
  assert.equal(upload.status(), 201, await upload.text());
  const created = await upload.json();
  const docId = created.document.id, versionId = created.version.id;
  const download = await context.request.get(`${origin}/api/hr/people/${person.id}/documents/${docId}/versions/${versionId}`);
  assert.equal(download.status(), 200, 'Actual version download must succeed.');
  assert.equal((await download.body()).toString(), 'Local synthetic document bytes');
  assert.ok(storageCalls >= 3); assert.equal(objects.size, 1);
  await page.getByText('Local full-app policy', { exact: true }).waitFor();
  const base = `${origin}/api/hr/people/${person.id}/documents/${docId}`;
  const replacement = await context.request.post(`${base}/versions`, { multipart: { file: { name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Local replacement bytes') } } });
  assert.equal(replacement.status(), 201, 'Replacement upload must succeed.');
  const replacementId = (await replacement.json()).version.id;
  const history = await (await context.request.get(`${base}/versions`)).json();
  assert.equal(history.versions.length, 2); assert.equal(history.versions.filter(version => version.is_current).length, 1);
  const verification = await context.request.post(`${base}/versions/${replacementId}/verifications`, { data: { decision: 'VERIFIED' } });
  assert.equal(verification.status(), 201, await verification.text());
  const employeeContext = await browser.newContext();
  await employeeContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const employeePage = await employeeContext.newPage();
  await employeePage.goto(`${origin}/login`);
  await employeePage.getByLabel('Username', { exact: true }).fill('local-employee');
  await employeePage.getByLabel('Password', { exact: true }).fill('wrong-fixture-password');
  await employeePage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await employeePage.getByText('Invalid username or password.', { exact: true }).waitFor();
  assert.ok(!(await employeeContext.cookies()).some(cookie => cookie.name === 'session'));
  await employeePage.getByLabel('Password', { exact: true }).fill(password);
  await employeePage.getByRole('button', { name: 'Sign in', exact: true }).click();
  for (let i = 0; ; i++) {
    if ((await employeeContext.cookies()).some(cookie => cookie.name === 'session')) break;
    if (i === 60) throw new Error('Employee login did not issue a session.');
    await sleep(1000);
  }
  assert.equal((await employeeContext.request.get(`${base}/versions/${replacementId}`)).status(), 200);
  assert.equal((await employeeContext.request.post(`${base}/versions/${replacementId}/acknowledgements`)).status(), 201);
  assert.equal((await employeeContext.request.post(`${base}/versions/${replacementId}/verifications`, { data: { decision: 'VERIFIED' } })).status(), 403);
  assert.equal((await employeeContext.request.delete(base)).status(), 403);
  const invalidContext = await browser.newContext();
  await invalidContext.addCookies([{ name: 'session', value: 'tampered-fixture-token', url: origin }]);
  assert.equal((await invalidContext.request.get(`${origin}/api/hr/people`)).status(), 401);
  await invalidContext.close();
  const foreign = (await q("SELECT id FROM hr_people WHERE organisation_id='local-other'")).rows[0];
  assert.equal((await context.request.get(`${origin}/api/hr/people/${foreign.id}/documents/${docId}/versions/${replacementId}`)).status(), 404);
  assert.equal((await context.request.delete(base)).status(), 200);
  assert.equal((await employeeContext.request.get(`${base}/versions/${replacementId}`)).status(), 404);
  assert.equal((await q('SELECT count(*)::int AS count FROM hr_employee_document_versions WHERE document_id=$1', [docId])).rows[0].count, 2);
  assert.equal(objects.size, 2);
  await verifyHrSetup({ origin, page, person, q });
  await verifyRemainingWorkflows({ origin, context, page, employeeContext, employeePage, person, q, emails, cronSecret: env.CRON_SECRET, password, browser });
  assert.equal((await employeeContext.request.post(`${origin}/api/auth/logout`)).status(), 200);
  assert.ok(!(await employeeContext.cookies()).some(cookie => cookie.name === 'session'));
  assert.equal((await employeeContext.request.get(`${origin}/api/hr/people`)).status(), 401);
  await employeeContext.close();
  console.log('PASS: real browser document upload, SDK download/replacement/history, HR verification, employee login/acknowledgement, denied management and logical deletion with preserved versions.');
  await q("DELETE FROM hr_administrators WHERE user_id='local-admin'");
  assert.equal((await (await context.request.get(`${origin}/api/hr/people`)).json()).canManage, false);
  await q("UPDATE organisation_modules SET enabled=false WHERE organisation_id='local-hr'");
  assert.equal((await context.request.get(`${origin}/api/hr/people`)).status(), 403);
  await q("UPDATE users SET status='INACTIVE' WHERE id='local-admin'");
  assert.equal((await context.request.get(`${origin}/api/hr/people`)).status(), 401);
  assert.ok(sqlCalls > 5);
  console.log('PASS: real login, HttpOnly session, HR tenant containment, grant revocation, entitlement denial and inactive-session denial.');
} catch (error) {
  console.error(error.stack); console.error(logs); process.exitCode = 1;
} finally {
  await browser?.close();
  if (app?.pid) {
    if (process.platform === 'win32') { try { exec('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* verify the listener below */ } }
    else app.kill('SIGTERM');
  }
  if (appOrigin) {
    const remaining = await fetch(`${appOrigin}/login`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    if (remaining) { console.error('Local app listener remained after cleanup.'); process.exitCode = 1; cacheOwned = false; }
  }
  if (cacheOwned) {
    try {
      rmSync(devCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (cacheBackedUp) renameSync(previousCache, devCache);
    } catch { console.error(`Local cache cleanup failed; preserved cache path: ${previousCache}`); process.exitCode = 1; }
  }
  bridge?.closeAllConnections(); await close(bridge); await pool?.end();
  try { exec('docker', ['rm', '-f', name]); } catch { /* failed startup */ }
  console.log('Local proof services removed.');
}
