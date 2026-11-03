// Production-built Eve against an explicit localhost fixture API. This never
// contacts a real account, database or provider and is not a marketing capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

const app = resolve(process.argv[2] || 'apps/eve');
const cli = createRequire(join(app, 'package.json')).resolve('next/dist/bin/next');
const calls = [];
let mode = 'ok';
const identity = { user: { id: 'fixture-user', name: 'Fixture owner', role: 'super_admin' }, organisationId: 'fixture-org', organisation: { name: 'Fixture organiser A', slug: 'fixture-a' } };
const identityB = { ...identity, organisationId: 'fixture-org-b', organisation: { name: 'Fixture organiser B', slug: 'fixture-b' } };
const event = { id: 'fixture-event', name: 'Local fixture event', slug: 'fixture-event', status: 'DRAFT', venue: null, starts_at: '2027-01-01T10:00:00Z', ends_at: '2027-01-01T12:00:00Z', timezone: 'Australia/Adelaide', session_count: 0, ticket_type_count: 0 };
const overview = { eventCount: 1, publishedCount: 0, orderCount: 0, paidOrderCount: 0, ticketCount: 0, checkedInCount: 0, truncated: false };
const sessions = new Map([['local-fixture-token', identity]]);
const api = createServer(async (req, res) => {
  calls.push(req.url);
  const url = new URL(req.url, 'http://localhost');
  const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  assert.equal(req.headers['x-ticketing-api-key'], 'local-performance-fixture-only');
  await new Promise(r => setTimeout(r, 60));
  if (url.pathname.endsWith('/auth/login')) return send({ token: 'local-fixture-token', expiresAt: Date.now() + 300000, user: identity.user, organisationId: identity.organisationId });
  const token = req.headers['x-ticketing-session'];
  const selected = sessions.get(token);
  if (!selected) return send({ error: 'Unauthorized' }, 401);
  const isB = selected.organisationId === identityB.organisationId;
  if (url.pathname.endsWith('/auth/organisation') && req.method === 'POST') {
    let text = ''; for await (const part of req) text += part;
    const organisationId = JSON.parse(text).organisationId;
    assert([identity.organisationId, identityB.organisationId].includes(organisationId));
    const nextToken = 'local-fixture-token-' + (sessions.size + 1);
    sessions.delete(token);
    sessions.set(nextToken, organisationId === identityB.organisationId ? identityB : identity);
    return send({ token: nextToken, expiresAt: Date.now() + 300000, organisationId });
  }
  if (mode === 'revoked') return send({ error: 'Unauthorized' }, 401);
  if (mode === 'disabled') return send({ error: 'EVE_NOT_ENABLED' }, 403);
  if (url.pathname.endsWith('/auth/session')) return send({ ...selected, events: [{ ...event, ...(isB ? { id: 'fixture-event-b', name: 'Local fixture event B' } : {}) }], ...(url.searchParams.get('include') === 'overview' ? { overview: isB ? { ...overview, orderCount: 7, paidOrderCount: 3, ticketCount: 9, checkedInCount: 2 } : overview } : {}) });
  if (url.pathname.endsWith('/orders')) return send({ orders: [] });
  if (url.pathname.endsWith('/attendees')) return send({ attendees: [] });
  return send({ error: 'Unexpected fixture request' }, 404);
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const apiPort = api.address().port;
const reserve = netServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
const base = `http://localhost:${port}`;
async function expectRedirect(response, destination) {
  if (response.status === 307) { assert.match(response.headers.get('location'), destination); return; }
  // A streamed Next loading boundary commits 200 before the protected page
  // redirects; Next emits the equivalent refresh instruction in that stream.
  assert.equal(response.status, 200);
  const html = await response.text();
  const refresh = html.match(/<meta[^>]*http-equiv="refresh"[^>]*>/i)?.[0];
  assert(refresh, 'Expected an HTTP or streamed Next redirect');
  assert.match(refresh, destination);
}
let output = '';
const child = spawn(process.execPath, [cli, 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: app, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', TICKETING_API_BASE_URL: `http://localhost:${apiPort}`, TICKETING_API_SECRET: 'local-performance-fixture-only' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', b => { output += b; });
child.stderr.on('data', b => { output += b; });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('Local Next server stopped: ' + output.slice(-3000));
    try { if ((await fetch(base + '/signin')).ok) { ready = true; break; } } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 250));
  }
  assert(ready, 'Local Next server did not start');
  const unsigned = await fetch(base + '/organiser', { redirect: 'manual' });
  await expectRedirect(unsigned, /url=\/signin/);
  assert.equal(calls.length, 0, 'Unsigned requests must not call the API');
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'local-fixture', password: 'local-fixture' }) });
  assert.equal(login.status, 200);
  assert(!(await login.text()).includes('local-fixture-token'), 'The opaque session must not enter the response body');
  const cookieHeader = login.headers.get('set-cookie');
  assert.match(cookieHeader, /httponly/i);
  assert.match(cookieHeader, /samesite=strict/i);
  const cookie = cookieHeader.split(';')[0];
  const receipts = [];
  for (const [path, count] of [['/organiser', 1], ['/organiser/events', 1], ['/organiser/orders', 2], ['/organiser/attendees', 2], ['/organiser/check-in', 1]]) {
    const start = calls.length, time = performance.now();
    const result = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
    assert.equal(result.status, 200, path);
    const html = await result.text();
    assert(html.includes('Fixture organiser'), path);
    const used = calls.slice(start);
    assert.equal(used.length, count, JSON.stringify({ path, used }));
    assert(!html.includes('local-fixture-token'), 'The opaque session must not enter HTML');
    receipts.push({ path, upstream_requests: used.length, local_fixture_ms: Math.round(performance.now() - time) });
  }
  const switched = await fetch(base + '/api/auth/organisation', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ organisationId: identityB.organisationId }) });
  assert.equal(switched.status, 200);
  const cookieB = switched.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookieB, cookie, 'Switch must replace the opaque session');
  const orgBReceipts = [];
  for (const [path, count] of [['/organiser', 1], ['/organiser/events', 1], ['/organiser/orders', 2], ['/organiser/attendees', 2], ['/organiser/check-in', 1]]) {
    const start = calls.length;
    const result = await fetch(base + path, { headers: { cookie: cookieB }, redirect: 'manual' });
    assert.equal(result.status, 200);
    const html = await result.text();
    assert(html.includes('Fixture organiser B'));
    assert(!html.includes('Fixture organiser A'), 'Previous organisation identity leaked');
    if (path === '/organiser') assert.match(html, /data-testid="kpi-orders"[^>]*>7</);
    assert.equal(calls.length - start, count);
    orgBReceipts.push({ path, upstream_requests: count });
  }
  const previous = await fetch(base + '/organiser', { headers: { cookie }, redirect: 'manual' });
  await expectRedirect(previous, /reason=session/);
  for (const state of ['revoked', 'disabled']) {
    mode = state;
    const start = calls.length;
    const result = await fetch(base + '/organiser/events', { headers: { cookie: cookieB }, redirect: 'manual' });
    await expectRedirect(result, state === 'disabled' ? /reason=not-enabled/ : /reason=session/);
    assert.equal(calls.length - start, 1);
  }
  console.log(JSON.stringify({ fixture_only: true, next: createRequire(join(app, 'package.json'))('next/package.json').version, unsigned_redirect: true, revoked_redirect: true, disabled_redirect: true, switch_replaces_cookie_and_figures: true, previous_session_refused: true, routes: receipts, second_organisation: orgBReceipts }, null, 2));
} finally {
  if (child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  api.closeAllConnections();
  await new Promise(r => api.close(r));
}
