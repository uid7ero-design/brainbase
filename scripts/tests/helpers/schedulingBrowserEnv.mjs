// Disposable, fully local environment for the Scheduling browser harness.
//
//   Docker PostgreSQL (loopback only)  <--SQL-over-HTTP bridge-->  the REAL Next server (real login, session, middleware, module
//   access, Scheduling guard and routes)  <--HTTP-->  Playwright's Chromium.
//
// The only substitute is the transport: Neon's HTTP SQL endpoint is answered by a bridge in this process that forwards each
// statement to the disposable Postgres. No session, authorisation or Scheduling response is faked. Every account is synthetic and
// is signed in through the application's own login form; nothing here reads, mints or reuses a Production secret, credential
// or session. Production, Preview and Neon are never contacted (the network guard refuses every non-loopback request).
import { createServer, request as proxyRequest } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => (server ? server.close(resolve) : resolve()));
const exec = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 180000, ...options });

export const ORGS = {
  hq: { id: 'sched-hq', name: 'Harness HQ' },
  a: { id: 'sched-org-a', name: 'Scheduling Enabled Org', timezone: 'Australia/Adelaide' },
  b: { id: 'sched-org-b', name: 'Unentitled Org' },
  c: { id: 'sched-org-c', name: 'Other Scheduling Org', timezone: 'Australia/Perth' },
};

// username -> [organisation, role, Scheduling access level or null for an account with no organisation_user_access row]
export const USERS = {
  owner: ['hq', 'SUPER_ADMIN', null],
  manager: ['a', 'MANAGER', 'use'],
  viewer: ['a', 'VIEWER', 'view'],
  'viewer-none': ['a', 'VIEWER', 'none'],
  analyst: ['a', 'ANALYST', 'use'],
  'analyst-legacy': ['a', 'ANALYST', null],
  'manager-legacy': ['a', 'MANAGER', null],
  'foreign-manager': ['c', 'MANAGER', 'use'],
  'unentitled-manager': ['b', 'MANAGER', 'use'],
  'unentitled-legacy': ['b', 'MANAGER', null],
  'viewer-legacy': ['a', 'VIEWER', null],
  'viewer-use': ['a', 'VIEWER', 'use'],
  'manager-view': ['a', 'MANAGER', 'view'],
};

const SCHEDULING_SQL = ['010_shared_schema.sql', '030_resource_concurrency.sql', '031_reservation_integrity.sql', '032_schedule_archive_ordering.sql', '033_occurrence_integrity.sql', '034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql'];

export async function startSchedulingBrowserEnv({ root = process.cwd(), log = console.log } = {}) {
  if (!existsSync(path.join(root, 'packages/scheduling/sql/010_shared_schema.sql'))) throw new Error('Run from the repository worktree.');
  const name = `sched-browser-${randomUUID().slice(0, 8)}`;
  // The harness serves a real PRODUCTION build (next build + next start behind a loopback TLS proxy): no on-demand compilation,
  // so no dev-server manifest races, and the session cookie is the Secure one production issues. SCHED_BROWSER_MODE=dev selects
  // the webpack dev server instead (faster to start, but unstable under concurrent first-use compilation on Windows).
  const production = (process.env.SCHED_BROWSER_MODE ?? 'production') !== 'dev';
  const nextDirectory = path.resolve(root, '.next');
  const taskDirectory = path.resolve(root, `.${name}`);
  const previousCache = path.join(taskDirectory, 'previous-next');
  if (existsSync(path.join(nextDirectory, 'dev/lock')) || existsSync(path.join(nextDirectory, 'lock'))) throw new Error('Close the existing Next server/build before this harness.');
  mkdirSync(taskDirectory);
  let cacheBackedUp = false;
  if (existsSync(nextDirectory)) { renameSync(nextDirectory, previousCache); cacheBackedUp = true; }

  const runSecret = randomBytes(24).toString('hex'); // generated per run for the synthetic accounts and the disposable database; never printed or stored
  let pool, bridge, app, tlsProxy, logs = '';
  const stop = async () => {
    tlsProxy?.closeAllConnections?.();
    await close(tlsProxy);
    if (app?.pid) {
      if (process.platform === 'win32') { try { exec('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }
      else app.kill('SIGTERM');
    }
    await close(bridge);
    await pool?.end().catch(() => {});
    try { exec('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* already gone */ }
    await sleep(1500); // let the server release its files before they are removed (Windows holds them briefly)
    const remove = target => { try { rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); } catch (error) { console.error(`Could not remove ${target}: ${error.message}`); } };
    remove(nextDirectory);
    if (cacheBackedUp) renameSync(previousCache, nextDirectory);
    remove(taskDirectory);
  };
  try {
    log(`Starting disposable PostgreSQL 17 (${name}).`);
    exec('docker', ['run', '-d', '--name', name, '-e', `POSTGRES_PASSWORD=${runSecret}`, '-e', 'POSTGRES_DB=schedbrowser', '-p', '127.0.0.1::5432', 'postgres:17-alpine', '-c', 'max_connections=300']);
    const mapping = exec('docker', ['port', name, '5432/tcp']).trim().split('\n')[0];
    if (!mapping.startsWith('127.0.0.1:')) throw new Error('The database must bind only the loopback interface.');
    const databaseUrl = `postgresql://postgres:${runSecret}@${mapping}/schedbrowser`;
    // Neon derives an HTTPS host from DATABASE_URL, so the app uses `localhost` (a numeric IP is rewritten into an invalid host).
    const appDatabaseUrl = databaseUrl.replace('@127.0.0.1:', '@localhost:');
    pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    for (let i = 0; ; i++) {
      try { await pool.query('SELECT 1'); break; } catch { if (i === 40) throw new Error('The disposable database did not start.'); await sleep(1000); }
    }
    const q = (text, values) => pool.query(text, values);

    // Never inherit credentials or dotenv values that could select a live service.
    const env = { ...process.env, NODE_OPTIONS: '' };
    for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PASSWORD|DATABASE_URL|DIRECT_URL/i.test(key)) env[key] = '';
    for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
      if (existsSync(path.join(root, file))) for (const match of readFileSync(path.join(root, file), 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = '';
    }
    Object.assign(env, { DATABASE_URL: appDatabaseUrl, DIRECT_URL: databaseUrl, SESSION_SECRET: randomUUID() + randomUUID(), NODE_ENV: production ? 'production' : 'development', NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' });

    log('Applying the repository Prisma schema, user administration and the Scheduling schema chain (010, 110, 120, 030-033).');
    exec(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env, cwd: root });
    const file = relative => readFileSync(path.join(root, relative), 'utf8').replace(/\r/g, '');
    // Production's registry tables come from the repository scripts (with their defaults), not from the Prisma model.
    await q('DROP TABLE IF EXISTS organisation_modules, modules CASCADE');
    await q(file('scripts/create-modules.sql'));
    await q(file('scripts/create-organisation-modules.sql'));
    await q(file('scripts/create-organisation-user-administration.sql'));
    await q(file(`packages/scheduling/sql/${SCHEDULING_SQL[0]}`));
    await q(file('scripts/scheduling/110_brainbase_host.sql'));
    await q(file('scripts/scheduling/120_brainbase_capability.sql'));
    for (const sqlFile of SCHEDULING_SQL.slice(1)) await q(file(`packages/scheduling/sql/${sqlFile}`));

    log('Seeding synthetic organisations, accounts and access.');
    const hash = await bcrypt.hash(runSecret, 10);
    for (const org of Object.values(ORGS)) await q('INSERT INTO organisations(id,name,slug,timezone,updated_at) VALUES($1,$2,$1,$3,now())', [org.id, org.name, org.timezone ?? null]);
    for (const [username, [org, role]] of Object.entries(USERS)) {
      await q('INSERT INTO users(id,organisation_id,username,name,role,status,password_hash,updated_at) VALUES($1,$2,$1,$3,$4::"UserRole",\'ACTIVE\',$5,now())', [username, ORGS[org].id, `Test ${username}`, role, hash]);
    }
    for (const [username, [, , level]] of Object.entries(USERS)) {
      if (level === null) continue;
      await q('INSERT INTO organisation_user_access(user_id,organisation_id,permissions,updated_by) SELECT id, organisation_id, $2::jsonb, \'owner\' FROM users WHERE id=$1', [username, JSON.stringify({ scheduling: level })]);
    }
    for (const org of ['a', 'c']) {
      await q("INSERT INTO organisation_modules(organisation_id,module_key,enabled,updated_at) VALUES($1,'scheduling',true,now())", [ORGS[org].id]);
      await q("INSERT INTO scheduling_settings(organisation_id,currency) VALUES($1,'AUD')", [ORGS[org].id]);
    }

    // SQL-over-HTTP bridge: the transport Neon's serverless driver speaks, answered by the disposable database.
    bridge = createServer(async (request, response) => {
      let client;
      try {
        if (request.headers['neon-connection-string'] !== appDatabaseUrl) throw new Error('Wrong fixture connection.');
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        client = await pool.connect();
        if (body.queries) await client.query('BEGIN');
        const results = [];
        for (const spec of body.queries ?? [body]) {
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
    Object.assign(env, { SCHEDULING_LOCAL_SQL_BRIDGE: `http://127.0.0.1:${sqlPort}/sql`, NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'scripts/tests/helpers/schedulingLocalNetworkGuard.mjs')).href}` });
    exec(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      await assert.rejects(fetch('https://example.invalid'), /External fetch blocked/);
      await assert.rejects(fetch('http://localhost/sql',{headers:{'Neon-Connection-String':'postgresql://not-a-fixture'}}), /Non-fixture SQL/);
    `], { env, cwd: root });
    log('PASS: external egress and non-fixture SQL are rejected.');

    if (production) {
      // Offline font fixture: typography is not this harness's subject, and the build must not reach Google Fonts.
      const fontFixture = path.join(taskDirectory, 'font-fixture.cjs');
      const fontDirectory = path.join(root, 'node_modules/next/dist/esm/next-devtools/server/font').replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');
      writeFileSync(fontFixture, `module.exports = new Proxy({}, { get(_target, url) {
        if (typeof url !== 'string') return undefined;
        const family = new URL(url).searchParams.get('family').split(':')[0];
        const file = family.includes('Mono') ? 'geist-mono-latin.woff2' : 'geist-latin.woff2';
        return "/* latin */\\n@font-face {font-family: '"+family+"';font-style:normal;font-weight:100 900;src:url(${fontDirectory}/"+file+") format('woff2');}";
      }});`);
      env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = fontFixture;
      log('Building the optimised production app (webpack) with all external egress blocked. This takes several minutes.');
      await new Promise((resolve, reject) => {
        const build = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const out = [];
        for (const stream of [build.stdout, build.stderr]) stream.on('data', chunk => { out.push(String(chunk)); if (out.length > 400) out.shift(); });
        const timeout = setTimeout(() => {
          if (process.platform === 'win32') { try { exec('taskkill', ['/PID', String(build.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* reported below */ } } else build.kill('SIGKILL');
        }, 1_200_000);
        build.once('error', error => { clearTimeout(timeout); reject(error); });
        build.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`The production build exited ${code}.
${out.join('').slice(-6000)}`)); });
      });
    }
    log(production ? 'Starting the real Next production server.' : 'Starting the real Next dev server (webpack).');
    app = spawn(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', ...(production ? [] : ['--webpack']), '--hostname', '127.0.0.1', '--port', String(appPort)], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-24000); });
    const appOrigin = `http://127.0.0.1:${appPort}`;
    let origin = appOrigin;
    if (production) {
      // The production session cookie is Secure, so the browser talks to the app through a loopback-only TLS proxy (self-signed).
      const keyFile = path.join(taskDirectory, 'loopback.key');
      const certFile = path.join(taskDirectory, 'loopback.crt');
      const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
      exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'ignore' });
      tlsProxy = createTlsServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
        const upstream = proxyRequest(`${appOrigin}${req.url}`, { method: req.method, headers: { ...req.headers, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'https' } }, incoming => {
          res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
        });
        upstream.on('error', () => {
          if (res.destroyed) return;
          if (res.headersSent) { res.destroy(); return; }
          res.writeHead(502); res.end();
        });
        res.once('close', () => upstream.destroy());
        req.pipe(upstream);
      });
      origin = `https://127.0.0.1:${await listen(tlsProxy)}`;
    }
    const deadline = Date.now() + 240000;
    for (;;) {
      try { if ((await fetch(`${appOrigin}/login`, { signal: AbortSignal.timeout(60000) })).ok) break; } catch { /* starting */ }
      if (app.exitCode !== null || Date.now() > deadline) throw new Error(`The Next server did not become ready.\n${logs}`);
      await sleep(1000);
    }
    return { origin, databaseUrl, password: runSecret, q, logs: () => logs, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
