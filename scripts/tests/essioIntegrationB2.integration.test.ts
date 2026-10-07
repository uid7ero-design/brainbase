import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

// Essio integration B2 — real disposable-Postgres suite for the API surface:
//   POST /api/integrations/essio/v1/work
//   GET  /api/integrations/essio/v1/targets
//   GET/POST /api/admin/integration-credentials, PATCH …/[credentialId]
// Run ONLY via scripts/tests/verify-essio-integration-b2.sh (throwaway
// postgres:17-alpine with the base schema + A0.1A + B1 + capability seed).
//
// Seams: lib/db (Prisma-backed tagged template, as in the B1 suite) and
// lib/org.requireRole (a stand-in that reproduces requireRole's contract —
// throw unless the DB-current role satisfies the minimum). The route handlers,
// services and SQL run unmodified.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('essioIntegrationB2.integration.test.ts requires DATABASE_URL (run verify-essio-integration-b2.sh)');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a DATABASE_URL that looks like a hosted/Production database.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
async function seamSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
  return prisma.$queryRawUnsafe(text, ...values);
}
vi.doMock('@/lib/db', () => ({ default: seamSql }));

const session = { role: 'super_admin' as string | null };
vi.doMock('@/lib/org', () => ({
  requireRole: async (min: string) => {
    if (session.role === null) throw new Error('Unauthorized');
    if (min === 'super_admin' && session.role !== 'super_admin') throw new Error('Forbidden');
    return { userId: 'user-admin', organisationId: 'org-a', homeOrganisationId: 'org-a', role: session.role, name: 'Admin' };
  },
}));

const q = <T = Record<string, unknown>>(text: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(text, ...params);
const exec = (text: string, ...params: unknown[]) => prisma.$executeRawUnsafe(text, ...params);
const count = async (text: string, ...params: unknown[]) => Number((await q<{ n: bigint }>(text, ...params))[0].n);

type WorkRoute = typeof import('@/app/api/integrations/essio/v1/work/route');
type TargetsRoute = typeof import('@/app/api/integrations/essio/v1/targets/route');
type AdminRoute = typeof import('@/app/api/admin/integration-credentials/route');
type AdminItemRoute = typeof import('@/app/api/admin/integration-credentials/[credentialId]/route');
let work: WorkRoute;
let targets: TargetsRoute;
let admin: AdminRoute;
let adminItem: AdminItemRoute;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const BOARD_A = '11111111-1111-4111-8111-111111111111'; // base schema, position 0, "Board A"
const BOARD_B = '22222222-2222-4222-8222-222222222222'; // org-b
const BOARD_A2 = 'aaaaaaaa-0000-4000-8000-000000000002'; // org-a, position 1
const GROUP_A_NOW = 'bbbbbbbb-0000-4000-8000-000000000001';
const GROUP_A_LATER = 'bbbbbbbb-0000-4000-8000-000000000002';
const GROUP_A2 = 'bbbbbbbb-0000-4000-8000-000000000003';
const GROUP_B = 'bbbbbbbb-0000-4000-8000-000000000004';
const BASE = 'http://brainbase.test';

const issued: string[] = [];
const errorBodies: string[] = [];
let tokenA = '';
let credentialA = '';
let tokenB = '';

// ─── Helpers ─────────────────────────────────────────────────────────────

function request(method: string, path: string, opts: { token?: string | null; headers?: Record<string, string>; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`${BASE}${path}`, { method, headers, body });
}

async function read(res: Response) {
  const text = await res.text();
  if (res.status >= 400) errorBodies.push(text);
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

function handoff(key = randomUUID(), overrides: Record<string, unknown> = {}) {
  const recId = randomUUID();
  return {
    schema: 'essio.recommendation-handoff',
    version: 1,
    idempotency_key: key,
    source: {
      product: 'essio',
      organisation: { id: '31114a55-8ff1-4b05-b6fc-5efa33d93dcd', name: 'HLNA Labs' },
      site: { id: 'e28fda45-e31d-4b92-9dd0-796d90770039', name: 'HLNA Labs', origin: 'https://hlnalabs.com.au' },
      deep_link: `https://essio.example/sites/e28fda45-e31d-4b92-9dd0-796d90770039/recommendations/${recId}`,
    },
    recommendation: {
      id: recId,
      key: 'IMPROVE_SEARCH_CTR:3f9a',
      type: 'IMPROVE_SEARCH_CTR',
      type_label: 'Improve search CTR',
      status: 'accepted',
      previous_instance: null,
      created_at: '2026-10-03T07:46:28.000Z',
      updated_at: '2026-10-03T07:46:28.000Z',
    },
    content: {
      title: 'Improve the search result for /pricing',
      summary: '/pricing had 1,840 impressions and 22 clicks in 28 days at average position 4.6.',
      reason: 'CTR is below half of the expected CTR for its position band.',
      suggested_action: 'Review the page title and meta description against the queries it appears for.',
      expected_check: 'CTR for this page over the next 28 days.',
      wording_source: 'deterministic',
    },
    target: { url: 'https://hlnalabs.com.au/pricing', path: '/pricing', query: null },
    assessment: {
      essio_priority_band: 'high',
      essio_priority_score: 72.5,
      essio_confidence: 0.72,
      note: "Essio's evidence-based assessment; not an operational priority.",
    },
    provenance: {
      calculation_version: 1,
      evidence_hash: 'a41c'.repeat(16),
      data_through: '2026-09-29',
      crawl_run_id: null,
      evidence: [
        {
          type: 'search_metric_summary',
          id: 'sms-1',
          relationship: 'triggered_by',
          summary: '28-day page performance.',
          metrics: { impressions: 1840, clicks: 22, ctr: 0.012, position: 4.6 },
          period: { from: '2026-09-02', to: '2026-09-29' },
        },
      ],
    },
    ...overrides,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
const essioFingerprint = (doc: unknown) => createHash('sha256').update(stable(doc)).digest('hex');
// Independent re-statement of the Brainbase create-request fingerprint: exactly { target: { board_id, group_id }, handoff }.
const requestFingerprint = (boardId: string, groupId: string | null, doc: unknown) =>
  createHash('sha256').update(stable({ target: { board_id: boardId, group_id: groupId }, handoff: doc })).digest('hex');

async function postWork(token: string | null, doc: ReturnType<typeof handoff>, target: Record<string, unknown> = { board_id: BOARD_A, group_id: GROUP_A_NOW }, headers: Record<string, string> = {}) {
  return read(
    await work.POST(
      request('POST', '/api/integrations/essio/v1/work', {
        token,
        headers: { 'idempotency-key': doc.idempotency_key, ...headers },
        body: { target, handoff: doc },
      }),
    ),
  );
}

async function createCredential(org: string, scopes: string[], label = 'Essio') {
  const res = await read(await admin.POST(request('POST', '/api/admin/integration-credentials', { body: { organisation_id: org, label, scopes } })));
  expect(res.status).toBe(201);
  issued.push(res.body.token);
  return res.body as { token: string; credential: { id: string } };
}

async function setCapability(org: string, enabled: boolean) {
  await exec(
    `INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'essio_integration', $2)
     ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    org, enabled,
  );
}

const rowsForKey = async (key: string) => ({
  links: await count(`SELECT count(*) AS n FROM organiser_item_external_links WHERE idempotency_key = $1`, key),
  activity: await count(`SELECT count(*) AS n FROM organiser_activity WHERE metadata_json->>'idempotency_key' = $1`, key),
});

// ─── Setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  await exec(`INSERT INTO users (id, organisation_id, username, name, status) VALUES ('user-admin', 'org-a', 'admin', 'Admin', 'ACTIVE')`);
  await exec(`INSERT INTO organiser_boards (id, organisation_id, name, position) VALUES ($1::uuid, 'org-a', 'Alpha campaigns', 1)`, BOARD_A2);
  await exec(
    `INSERT INTO organiser_groups (id, board_id, organisation_id, name, position) VALUES
       ($1::uuid, $5::uuid, 'org-a', 'Now', 0), ($2::uuid, $5::uuid, 'org-a', 'Later', 1),
       ($3::uuid, $6::uuid, 'org-a', 'Backlog', 0), ($4::uuid, $7::uuid, 'org-b', 'B group', 0)`,
    GROUP_A_NOW, GROUP_A_LATER, GROUP_A2, GROUP_B, BOARD_A, BOARD_A2, BOARD_B,
  );
  work = await import('@/app/api/integrations/essio/v1/work/route');
  targets = await import('@/app/api/integrations/essio/v1/targets/route');
  admin = await import('@/app/api/admin/integration-credentials/route');
  adminItem = await import('@/app/api/admin/integration-credentials/[credentialId]/route');
  await setCapability(ORG_A, true);
  const a = await createCredential(ORG_A, ['work:create', 'targets:read']);
  tokenA = a.token;
  credentialA = a.credential.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

// ─── Super-admin credential management ───────────────────────────────────

describe('super-admin credential management', () => {
  it('creates a credential and returns the token exactly once, with a warning', async () => {
    const res = await read(await admin.POST(request('POST', '/api/admin/integration-credentials', {
      body: { organisation_id: ORG_A, label: 'Essio staging', scopes: ['work:create'] },
    })));
    issued.push(res.body.token);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body.token).toMatch(/^bbint_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(res.body.token_warning).toMatch(/shown only once and cannot be recovered/);
    expect(res.body.credential).toMatchObject({ organisationId: ORG_A, integrationKey: 'essio', label: 'Essio staging', scopes: ['work:create'], status: 'active', createdBy: 'user-admin' });
    expect(JSON.stringify(res.body.credential)).not.toMatch(/secret|hash/i);

    const list = await read(await admin.GET(request('GET', `/api/admin/integration-credentials?organisation_id=${ORG_A}`)));
    expect(list.status).toBe(200);
    const json = JSON.stringify(list.body);
    expect(json).not.toContain(res.body.token.slice(39));
    expect(json).not.toMatch(/secret_?hash|"token"/i);
    expect(list.body.credentials.map((c: { id: string }) => c.id)).toContain(res.body.credential.id);
  });

  it('requires a database-validated super_admin for every operation', async () => {
    const before = await count(`SELECT count(*) AS n FROM integration_credentials`);
    for (const role of [null, 'admin', 'manager', 'viewer']) {
      session.role = role;
      expect((await admin.GET(request('GET', `/api/admin/integration-credentials?organisation_id=${ORG_A}`))).status).toBe(403);
      expect((await admin.POST(request('POST', '/api/admin/integration-credentials', { body: { organisation_id: ORG_A, label: 'x', scopes: ['work:create'] } }))).status).toBe(403);
      expect((await adminItem.PATCH(request('PATCH', `/api/admin/integration-credentials/${credentialA}`, { body: { organisation_id: ORG_A, action: 'revoke' } }), { params: Promise.resolve({ credentialId: credentialA }) })).status).toBe(403);
    }
    session.role = 'super_admin';
    expect(await count(`SELECT count(*) AS n FROM integration_credentials`)).toBe(before);
    expect(await count(`SELECT count(*) AS n FROM integration_credentials WHERE id = $1::uuid AND revoked_at IS NULL`, credentialA)).toBe(1);
  });

  it('enforces allowed scopes and a real organisation', async () => {
    const post = (body: unknown) => admin.POST(request('POST', '/api/admin/integration-credentials', { body }));
    expect(await read(await post({ organisation_id: ORG_A, label: 'x', scopes: ['work:append'] }))).toMatchObject({ status: 400, body: { error: { code: 'scope_reserved' } } });
    expect(await read(await post({ organisation_id: ORG_A, label: 'x', scopes: ['admin'] }))).toMatchObject({ status: 400, body: { error: { code: 'scope_unknown' } } });
    expect(await read(await post({ organisation_id: 'org-missing', label: 'x', scopes: ['work:create'] }))).toMatchObject({ status: 400, body: { error: { code: 'invalid_organisation' } } });
    expect((await post('not an object')).status).toBe(400);
  });

  it('disable blocks the API, enable restores it, revoke blocks permanently', async () => {
    const { token, credential } = await createCredential(ORG_A, ['work:create', 'targets:read'], 'Lifecycle');
    const patch = (action: string) =>
      adminItem.PATCH(request('PATCH', `/api/admin/integration-credentials/${credential.id}`, { body: { organisation_id: ORG_A, action } }), {
        params: Promise.resolve({ credentialId: credential.id }),
      });
    const discover = async () => (await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token }))).status;

    expect(await discover()).toBe(200);
    expect((await patch('disable')).status).toBe(200);
    expect(await discover()).toBe(401);
    expect((await postWork(token, handoff())).status).toBe(401);
    expect((await patch('enable')).status).toBe(200);
    expect(await discover()).toBe(200);
    expect(await read(await patch('revoke'))).toMatchObject({ status: 200, body: { outcome: 'revoked', credential: { status: 'revoked' } } });
    expect(await discover()).toBe(401);
    expect(await read(await patch('enable'))).toMatchObject({ status: 409, body: { error: { code: 'revoked' } } });
    expect(await discover()).toBe(401);
    expect((await patch('bogus')).status).toBe(400);

    const audit = await q<{ action: string; user_id: string | null }>(
      `SELECT action, user_id FROM audit_logs WHERE resource_id = $1 ORDER BY created_at, action`, credential.id,
    );
    expect(audit.map((a) => a.action).sort()).toEqual(
      ['integration_credential.created', 'integration_credential.disabled', 'integration_credential.enabled', 'integration_credential.revoked'].sort(),
    );
    expect(audit.every((a) => a.user_id === 'user-admin')).toBe(true);
  });

  it('a credential cannot be managed through another organisation', async () => {
    const res = await adminItem.PATCH(
      request('PATCH', `/api/admin/integration-credentials/${credentialA}`, { body: { organisation_id: ORG_B, action: 'revoke' } }),
      { params: Promise.resolve({ credentialId: credentialA }) },
    );
    expect(res.status).toBe(404);
    expect(await count(`SELECT count(*) AS n FROM integration_credentials WHERE id = $1::uuid AND revoked_at IS NULL`, credentialA)).toBe(1);
  });
});

// ─── Create work ─────────────────────────────────────────────────────────

describe('create work', () => {
  it('creates exactly one Organiser item, link and activity as the Essio system actor', async () => {
    const doc = handoff();
    const res = await postWork(tokenA, doc);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toMatchObject({
      version: 1,
      created: true,
      state: 'linked',
      idempotency_key: doc.idempotency_key,
      work_item: { status: 'Not Started' },
    });
    const itemId = res.body.work_item.id as string;
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.work_item.url).toMatch(new RegExp(`/organiser\\?board=${BOARD_A}$`));
    expect(Date.parse(res.body.accepted_at)).not.toBeNaN();

    const [item] = await q<Record<string, unknown>>(`SELECT * FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(item).toMatchObject({
      organisation_id: ORG_A, name: doc.content.title, status: 'Not Started', group_id: GROUP_A_NOW,
      priority: null, owner: null, due_date: null, assignee_user_id: null, parent_item_id: null,
    });
    const notes = item.notes as string;
    for (const part of [doc.content.summary, doc.content.reason, doc.content.suggested_action, doc.content.expected_check!, doc.source.deep_link!]) {
      expect(notes).toContain(part);
    }
    expect(notes).toContain('not a Brainbase priority');

    const [activity] = await q<Record<string, unknown>>(`SELECT * FROM organiser_activity WHERE item_id = $1::uuid`, itemId);
    expect(activity).toMatchObject({ event_type: 'item.created', entity_type: 'item', actor_user_id: null, actor_name: 'Essio' });
    expect(activity.metadata_json).toEqual({
      source: 'essio',
      credential_id: credentialA,
      idempotency_key: doc.idempotency_key,
      external_recommendation_id: doc.recommendation.id,
      handoff_fingerprint: essioFingerprint(doc),
      request_fingerprint: requestFingerprint(BOARD_A, GROUP_A_NOW, doc),
    });

    const [link] = await q<Record<string, unknown>>(`SELECT * FROM organiser_item_external_links WHERE idempotency_key = $1`, doc.idempotency_key);
    expect(link).toMatchObject({
      organisation_id: ORG_A, organiser_item_id: itemId, source_system: 'essio',
      external_recommendation_id: doc.recommendation.id, source_url: doc.source.deep_link,
      handoff_fingerprint: essioFingerprint(doc), request_fingerprint: requestFingerprint(BOARD_A, GROUP_A_NOW, doc),
      target_board_id: BOARD_A, target_group_id: GROUP_A_NOW, credential_id: credentialA, item_deleted_at: null,
    });
    expect(link.handoff_snapshot).toEqual(doc);
    expect(await count(`SELECT count(*) AS n FROM users WHERE lower(name) LIKE '%essio%'`)).toBe(0);
  });

  it('a replay with the same payload returns the same item without writing', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc);
    const items = await count(`SELECT count(*) AS n FROM organiser_items`);
    // Key order in the request does not matter: the fingerprint is canonical.
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    const reordered = reverseKeys(doc) as typeof doc;
    expect(Object.keys(reordered)[0]).toBe('provenance');
    const again = await postWork(tokenA, reordered);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, state: 'linked', work_item: { id: first.body.work_item.id }, accepted_at: first.body.accepted_at });
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(items);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
  });

  it('the same key with a different payload is a 409 conflict and changes nothing', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc);
    const [before] = await q<Record<string, unknown>>(`SELECT name, notes, updated_at FROM organiser_items WHERE id = $1::uuid`, first.body.work_item.id);
    const changed = { ...doc, content: { ...doc.content, title: 'A different title' } };
    const res = await postWork(tokenA, changed);
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'idempotency_conflict' }, idempotency_key: doc.idempotency_key } });
    const [after] = await q<Record<string, unknown>>(`SELECT name, notes, updated_at FROM organiser_items WHERE id = $1::uuid`, first.body.work_item.id);
    expect(after).toEqual(before);
    const [link] = await q<{ handoff_fingerprint: string; request_fingerprint: string }>(
      `SELECT handoff_fingerprint, request_fingerprint FROM organiser_item_external_links WHERE idempotency_key = $1`, doc.idempotency_key,
    );
    expect(link).toEqual({ handoff_fingerprint: essioFingerprint(doc), request_fingerprint: requestFingerprint(BOARD_A, GROUP_A_NOW, doc) });
  });

  it('concurrent duplicates create exactly one item, link and activity', async () => {
    const doc = handoff();
    const results = await Promise.all(Array.from({ length: 8 }, () => postWork(tokenA, doc)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.work_item.id)).size).toBe(1);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
    expect(await count(`SELECT count(*) AS n FROM organiser_items WHERE id = $1::uuid`, results[0].body.work_item.id)).toBe(1);
  });

  it('a retry after the item was deleted reports it and never creates a replacement', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc);
    await exec(`DELETE FROM organiser_items WHERE id = $1::uuid`, first.body.work_item.id);
    const items = await count(`SELECT count(*) AS n FROM organiser_items`);
    const res = await postWork(tokenA, doc);
    expect(res).toMatchObject({ status: 410, body: { error: { code: 'work_item_deleted' }, state: 'item_deleted', idempotency_key: doc.idempotency_key } });
    expect(Date.parse(res.body.deleted_at)).not.toBeNaN();
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(items);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
  });

  it('a retry after the whole board was deleted is still answered from the identity (410)', async () => {
    const board = randomUUID();
    await exec(`INSERT INTO organiser_boards (id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Temporary')`, board);
    const doc = handoff();
    expect((await postWork(tokenA, doc, { board_id: board })).status).toBe(201);
    await exec(`DELETE FROM organiser_boards WHERE id = $1::uuid`, board);
    expect((await postWork(tokenA, doc, { board_id: board })).status).toBe(410);
  });

  it('rejects boards and groups outside the credential organisation or board', async () => {
    const before = await count(`SELECT count(*) AS n FROM organiser_items`);
    const doc = handoff();
    expect(await postWork(tokenA, doc, { board_id: BOARD_B })).toMatchObject({ status: 404, body: { error: { code: 'target_not_found' } } });
    expect(await postWork(tokenA, doc, { board_id: randomUUID() })).toMatchObject({ status: 404, body: { error: { code: 'target_not_found' } } });
    expect(await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_B })).toMatchObject({ status: 404, body: { error: { code: 'target_group_not_found' } } });
    expect(await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A2 })).toMatchObject({ status: 404, body: { error: { code: 'target_group_not_found' } } });
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(before);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 0, activity: 0 });
  });

  it('a request-supplied organisation id never overrides the credential organisation', async () => {
    const doc = handoff();
    expect(await postWork(tokenA, doc, { board_id: BOARD_B, organisation_id: ORG_B })).toMatchObject({ status: 404 });
    expect(await postWork(tokenA, doc, { board_id: BOARD_A, organisation_id: ORG_B })).toMatchObject({ status: 404 });
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 0, activity: 0 });
    const ok = await postWork(tokenA, doc, { board_id: BOARD_A, organisation_id: ORG_A });
    expect(ok.status).toBe(201);
    const [item] = await q<{ organisation_id: string }>(`SELECT organisation_id FROM organiser_items WHERE id = $1::uuid`, ok.body.work_item.id);
    expect(item.organisation_id).toBe(ORG_A);
  });

  it('organisation A cannot replay organisation B’s idempotency key', async () => {
    await setCapability(ORG_B, true);
    tokenB = (await createCredential(ORG_B, ['work:create', 'targets:read'], 'Essio B')).token;
    const doc = handoff();
    const inB = await postWork(tokenB, doc, { board_id: BOARD_B, group_id: GROUP_B });
    expect(inB.status).toBe(201);
    const inA = await postWork(tokenA, doc, { board_id: BOARD_A });
    expect(inA.status).toBe(201); // A gets its own identity, never B's item
    expect(inA.body.work_item.id).not.toBe(inB.body.work_item.id);
    const orgs = await q<{ organisation_id: string }>(`SELECT organisation_id FROM organiser_item_external_links WHERE idempotency_key = $1 ORDER BY organisation_id`, doc.idempotency_key);
    expect(orgs.map((o) => o.organisation_id)).toEqual([ORG_A, ORG_B]);
    await setCapability(ORG_B, false);
  });

  it('rejects malformed requests before writing anything', async () => {
    const before = await count(`SELECT count(*) AS n FROM organiser_item_external_links`);
    const doc = handoff();
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      work.POST(request('POST', '/api/integrations/essio/v1/work', { token: tokenA, headers: { 'idempotency-key': doc.idempotency_key, ...headers }, body })).then(read);
    const cases: Array<[unknown, string]> = [
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, presentation: { wording_source: 'ai_assisted' } } }, 'handoff.presentation: is not allowed'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, content: { ...doc.content, wording_source: 'ai_assisted' } } }, 'handoff.content.wording_source'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, version: 2 } }, 'handoff.version'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, schema: 'other' } }, 'handoff.schema'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, content: { ...doc.content, title: 'x'.repeat(301) } } }, 'handoff.content.title: must be at most 300 characters'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, content: { ...doc.content, summary: 'x'.repeat(4001) } } }, 'handoff.content.summary'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, source: { ...doc.source, deep_link: 'javascript:alert(1)' } } }, 'handoff.source.deep_link'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, target: { ...doc.target, query: 'q'.repeat(501) } } }, 'handoff.target.query'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, recommendation: { ...doc.recommendation, id: 'not-a-uuid' } } }, 'handoff.recommendation.id'],
      [{ target: { board_id: 'nope' }, handoff: doc }, 'target.board_id'],
      [{ target: { board_id: BOARD_A, priority: 'High' }, handoff: doc }, 'target.priority: is not allowed'],
      [{ target: { board_id: BOARD_A }, handoff: doc, assignee: 'someone' }, 'body.assignee: is not allowed'],
      [{ handoff: doc }, 'target: must be an object'],
      [{ target: { board_id: BOARD_A }, handoff: { ...doc, provenance: { ...doc.provenance, raw_rows: [] } } }, 'handoff.provenance.raw_rows: is not allowed'],
    ];
    for (const [body, issue] of cases) {
      const res = await post(body);
      expect(res.status, issue).toBe(400);
      expect(res.body.error.code).toBe('invalid_payload');
      expect((res.body.details as string[]).some((d) => d.startsWith(issue)), `${issue} in ${JSON.stringify(res.body.details)}`).toBe(true);
    }
    expect((await read(await work.POST(request('POST', '/api/integrations/essio/v1/work', { token: tokenA, headers: { 'idempotency-key': doc.idempotency_key }, raw: '{not json' })))).body.error.code).toBe('invalid_json');
    expect((await post({ target: { board_id: BOARD_A }, handoff: doc }, { 'idempotency-key': randomUUID() })).body.error.code).toBe('idempotency_key_mismatch');
    expect((await read(await work.POST(request('POST', '/api/integrations/essio/v1/work', { token: tokenA, body: { target: { board_id: BOARD_A }, handoff: doc } })))).body.error.code).toBe('idempotency_key_mismatch');
    expect((await post({ target: { board_id: BOARD_A }, handoff: doc }, { 'essio-contract-version': '2' })).body.error.code).toBe('unsupported_contract_version');
    expect(await count(`SELECT count(*) AS n FROM organiser_item_external_links`)).toBe(before);
  });

  it('rejects an oversized body before parsing or writing', async () => {
    const before = await count(`SELECT count(*) AS n FROM organiser_item_external_links`);
    const doc = handoff();
    const raw = JSON.stringify({ target: { board_id: BOARD_A }, handoff: doc, padding: 'x'.repeat(70_000) });
    const res = await read(await work.POST(request('POST', '/api/integrations/essio/v1/work', { token: tokenA, headers: { 'idempotency-key': doc.idempotency_key }, raw })));
    expect(res).toMatchObject({ status: 413, body: { error: { code: 'payload_too_large' } } });
    expect(await count(`SELECT count(*) AS n FROM organiser_item_external_links`)).toBe(before);
  });

  it('authentication, scope and module gate', async () => {
    const doc = handoff();
    const none = await postWork(null, doc);
    expect(none).toMatchObject({ status: 401, body: { error: { code: 'invalid_credentials' } } });
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect((await postWork('bbint_garbage', doc)).status).toBe(401);
    expect((await postWork(`${tokenA.slice(0, 39)}${'A'.repeat(43)}`, doc)).status).toBe(401);
    const readOnly = await createCredential(ORG_A, ['targets:read'], 'Discovery only');
    expect(await postWork(readOnly.token, doc)).toMatchObject({ status: 403, body: { error: { code: 'insufficient_scope' } } });
    await setCapability(ORG_A, false);
    expect(await postWork(tokenA, doc)).toMatchObject({ status: 403, body: { error: { code: 'integration_disabled' } } });
    await setCapability(ORG_A, true);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 0, activity: 0 });
  });
});

// ─── Create-request fingerprint (target is part of the intent) ─────────────

describe('create-request fingerprint', () => {
  it('stores both fingerprints with distinct meanings', async () => {
    const doc = handoff();
    expect((await postWork(tokenA, doc, { board_id: BOARD_A2, group_id: GROUP_A2 })).status).toBe(201);
    const [link] = await q<Record<string, unknown>>(
      `SELECT handoff_fingerprint, request_fingerprint, target_board_id::text AS target_board_id, target_group_id::text AS target_group_id,
              handoff_snapshot FROM organiser_item_external_links WHERE idempotency_key = $1`,
      doc.idempotency_key,
    );
    expect(link.handoff_fingerprint).toBe(essioFingerprint(doc)); // identical to Essio's own fingerprint
    expect(link.request_fingerprint).toBe(requestFingerprint(BOARD_A2, GROUP_A2, doc)); // target + handoff, nothing else
    expect(link.request_fingerprint).not.toBe(link.handoff_fingerprint);
    expect(link).toMatchObject({ target_board_id: BOARD_A2, target_group_id: GROUP_A2 });
    expect(link.handoff_snapshot).toEqual(doc); // the exact Essio context, no Brainbase target mixed in
  });

  it('A/E: same handoff and same target (any key order, absent group ≡ null) replays', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc, { board_id: BOARD_A });
    expect(first.status).toBe(201);
    const nullGroup = await postWork(tokenA, doc, { group_id: null, board_id: BOARD_A });
    expect(nullGroup).toMatchObject({ status: 200, body: { created: false, work_item: { id: first.body.work_item.id } } });
    const upper = await postWork(tokenA, doc, { board_id: BOARD_A.toUpperCase() });
    expect(upper).toMatchObject({ status: 200, body: { work_item: { id: first.body.work_item.id } } });
    // A request-supplied organisation id (the credential's own) is not part of the intent.
    const withOrg = await postWork(tokenA, doc, { organisation_id: ORG_A, board_id: BOARD_A });
    expect(withOrg).toMatchObject({ status: 200, body: { work_item: { id: first.body.work_item.id } } });
  });

  it('C: same key + same handoff + different board is a conflict', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW });
    const items = await count(`SELECT count(*) AS n FROM organiser_items`);
    const res = await postWork(tokenA, doc, { board_id: BOARD_A2, group_id: null });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'idempotency_conflict' } } });
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(items);
    const [item] = await q<{ board_id: string; group_id: string }>(
      `SELECT board_id::text AS board_id, group_id::text AS group_id FROM organiser_items WHERE id = $1::uuid`, first.body.work_item.id,
    );
    expect(item).toEqual({ board_id: BOARD_A, group_id: GROUP_A_NOW }); // not redirected
  });

  it('D: same key + same handoff + different group (or group added/removed) is a conflict', async () => {
    const doc = handoff();
    expect((await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW })).status).toBe(201);
    for (const target of [
      { board_id: BOARD_A, group_id: GROUP_A_LATER },
      { board_id: BOARD_A, group_id: null },
      { board_id: BOARD_A },
    ]) {
      expect(await postWork(tokenA, doc, target)).toMatchObject({ status: 409, body: { error: { code: 'idempotency_conflict' } } });
    }
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
  });

  it('B: same key + different handoff + same target is a conflict', async () => {
    const doc = handoff();
    expect((await postWork(tokenA, doc)).status).toBe(201);
    const changed = { ...doc, assessment: { ...doc.assessment, essio_priority_band: 'urgent' } };
    expect(await postWork(tokenA, changed)).toMatchObject({ status: 409, body: { error: { code: 'idempotency_conflict' } } });
  });

  it('the original target is the stored intent, not the item’s current placement', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW });
    // A Brainbase user moves the item to another group.
    await exec(`UPDATE organiser_items SET group_id = $1::uuid WHERE id = $2::uuid`, GROUP_A_LATER, first.body.work_item.id);
    expect(await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW })).toMatchObject({
      status: 200,
      body: { created: false, work_item: { id: first.body.work_item.id } },
    });
    expect((await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_LATER })).status).toBe(409);
  });

  it('6: concurrent identical requests still create exactly one item', async () => {
    const doc = handoff();
    const results = await Promise.all(Array.from({ length: 6 }, () => postWork(tokenA, doc, { board_id: BOARD_A2, group_id: GROUP_A2 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
  });

  it('7/8: after deletion, the identical request is item_deleted and a changed request is a conflict', async () => {
    const doc = handoff();
    const first = await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW });
    await exec(`DELETE FROM organiser_items WHERE id = $1::uuid`, first.body.work_item.id);
    const items = await count(`SELECT count(*) AS n FROM organiser_items`);
    expect(await postWork(tokenA, doc, { board_id: BOARD_A, group_id: GROUP_A_NOW })).toMatchObject({
      status: 410,
      body: { error: { code: 'work_item_deleted' }, state: 'item_deleted' },
    });
    expect(await postWork(tokenA, doc, { board_id: BOARD_A2, group_id: null })).toMatchObject({
      status: 409,
      body: { error: { code: 'idempotency_conflict' } },
    });
    expect(await postWork(tokenA, { ...doc, content: { ...doc.content, title: 'Changed' } }, { board_id: BOARD_A, group_id: GROUP_A_NOW })).toMatchObject({ status: 409 });
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(items);
    const [link] = await q<{ target_board_id: string; target_group_id: string }>(
      `SELECT target_board_id::text AS target_board_id, target_group_id::text AS target_group_id FROM organiser_item_external_links WHERE idempotency_key = $1`,
      doc.idempotency_key,
    );
    expect(link).toEqual({ target_board_id: BOARD_A, target_group_id: GROUP_A_NOW }); // intent survives deletion
  });
});

// ─── Transactional guarantee ─────────────────────────────────────────────

describe('transactional guarantee', () => {
  const stages: Array<[string, string, (key: string, marker: string) => string]> = [
    ['external link claim', 'organiser_item_external_links', (key) => `NEW.idempotency_key = '${key}'`],
    ['Organiser item insert', 'organiser_items', (_key, marker) => `NEW.notes LIKE '%${marker}%'`],
    ['activity insert', 'organiser_activity', (key) => `NEW.metadata_json->>'idempotency_key' = '${key}'`],
  ];

  for (const [label, table, condition] of stages) {
    it(`a failure at the ${label} leaves no partial item, link or activity`, async () => {
      // key and marker are generated UUID-derived values: safe to inline into the trigger body.
      const doc = handoff();
      const marker = `marker${randomUUID().replace(/-/g, '')}`;
      doc.content.summary = `${doc.content.summary} ${marker}`;
      await exec(
        `CREATE OR REPLACE FUNCTION essio_test_fail() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN IF ${condition(doc.idempotency_key, marker)} THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $fn$`,
      );
      await exec(`CREATE TRIGGER essio_test_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION essio_test_fail()`);
      try {
        const itemsBefore = await count(`SELECT count(*) AS n FROM organiser_items`);
        const res = await postWork(tokenA, doc);
        expect(res).toMatchObject({ status: 503, body: { error: { code: 'unavailable' } } });
        expect(JSON.stringify(res.body)).not.toMatch(/injected|organiser_|trigger|sql/i);
        expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(itemsBefore);
        expect(await count(`SELECT count(*) AS n FROM organiser_items WHERE notes LIKE $1`, `%${marker}%`)).toBe(0);
        expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 0, activity: 0 });
      } finally {
        await exec(`DROP TRIGGER essio_test_fail ON ${table}`);
        await exec(`DROP FUNCTION essio_test_fail()`);
      }
      // With the fault removed, the same request succeeds once, cleanly.
      expect((await postWork(tokenA, doc)).status).toBe(201);
      expect(await rowsForKey(doc.idempotency_key)).toEqual({ links: 1, activity: 1 });
    });
  }
});

// ─── Discovery ───────────────────────────────────────────────────────────

describe('target discovery', () => {
  it('returns only the credential organisation’s boards and groups, ids and names, deterministically', async () => {
    await exec(`INSERT INTO organiser_items (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Secret item name')`, BOARD_A2);
    const first = await read(await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token: tokenA })));
    const second = await read(await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token: tokenA })));
    expect(first.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.version).toBe(1);
    expect(first.body.organisation).toEqual({ id: ORG_A, name: 'Org A' });
    const boards = first.body.boards as Array<{ id: string; name: string; groups: Array<{ id: string; name: string }> }>;
    expect(boards.slice(0, 2)).toEqual([
      { id: BOARD_A, name: 'Board A', groups: [{ id: GROUP_A_NOW, name: 'Now' }, { id: GROUP_A_LATER, name: 'Later' }] },
      { id: BOARD_A2, name: 'Alpha campaigns', groups: [{ id: GROUP_A2, name: 'Backlog' }] },
    ]);
    for (const board of boards) {
      expect(Object.keys(board).sort()).toEqual(['groups', 'id', 'name']);
      for (const group of board.groups) expect(Object.keys(group).sort()).toEqual(['id', 'name']);
    }
    const json = JSON.stringify(first.body);
    for (const leak of [BOARD_B, GROUP_B, 'B group', 'Board B', 'Secret item name', 'Seed item', 'User A', 'user-admin', 'position', 'color']) {
      expect(json).not.toContain(leak);
    }
  });

  it('organisation B sees only its own targets', async () => {
    await setCapability(ORG_B, true);
    const res = await read(await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token: tokenB })));
    expect(res.status).toBe(200);
    expect(res.body.organisation.id).toBe(ORG_B);
    expect(res.body.boards).toEqual([{ id: BOARD_B, name: 'Board B', groups: [{ id: GROUP_B, name: 'B group' }] }]);
    await setCapability(ORG_B, false);
  });

  it('requires targets:read, the module, and a credential', async () => {
    const writeOnly = await createCredential(ORG_A, ['work:create'], 'Write only');
    expect(await read(await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token: writeOnly.token })))).toMatchObject({ status: 403, body: { error: { code: 'insufficient_scope' } } });
    expect((await targets.GET(request('GET', '/api/integrations/essio/v1/targets'))).status).toBe(401);
    await setCapability(ORG_A, false);
    expect(await read(await targets.GET(request('GET', '/api/integrations/essio/v1/targets', { token: tokenA })))).toMatchObject({ status: 403, body: { error: { code: 'integration_disabled' } } });
    await setCapability(ORG_A, true);
  });
});

// ─── Error hygiene (last) ────────────────────────────────────────────────

describe('error hygiene', () => {
  it('no error body leaks SQL, internal names, credential ids or token material', () => {
    expect(errorBodies.length).toBeGreaterThan(20);
    const all = errorBodies.join('\n');
    expect(all).not.toMatch(/organiser_items|organiser_item_external_links|integration_credentials|audit_logs|SELECT |INSERT |stack|at \w+ \(/);
    expect(all).not.toContain(credentialA);
    for (const token of issued) expect(all).not.toContain(token.slice(39));
  });
});
