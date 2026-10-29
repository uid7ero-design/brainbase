import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

// Essio integration B3 — real disposable-Postgres suite for
//   GET /api/integrations/essio/v1/work/<idempotency key>
// Work is created through the real B2 route (POST …/v1/work), then read back.
// Run ONLY via scripts/tests/verify-essio-integration-b3.sh.
//
// Seams as in the B2 suite: lib/db (Prisma-backed tagged template) and a
// lib/org requireRole stand-in (only the admin credential route uses it).

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('essioIntegrationB3.integration.test.ts requires DATABASE_URL (run verify-essio-integration-b3.sh)');
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
vi.doMock('@/lib/org', () => ({
  requireRole: async () => ({ userId: 'user-admin', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'super_admin', name: 'Admin' }),
}));

const q = <T = Record<string, unknown>>(text: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(text, ...params);
const exec = (text: string, ...params: unknown[]) => prisma.$executeRawUnsafe(text, ...params);
const count = async (text: string, ...params: unknown[]) => Number((await q<{ n: bigint }>(text, ...params))[0].n);

let work: typeof import('@/app/api/integrations/essio/v1/work/route');
let status: typeof import('@/app/api/integrations/essio/v1/work/[idempotencyKey]/route');
let admin: typeof import('@/app/api/admin/integration-credentials/route');

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const BOARD_A = '11111111-1111-4111-8111-111111111111';
const BOARD_B = '22222222-2222-4222-8222-222222222222';
const BOARD_A2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const GROUP_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const GROUP_A2 = 'bbbbbbbb-0000-4000-8000-000000000003';
const BASE = 'http://brainbase.test';

let tokenA = '';
let tokenB = '';
const errorBodies: string[] = [];

function request(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  return new NextRequest(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function read(res: Response) {
  const text = await res.text();
  if (res.status >= 400) errorBodies.push(text);
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

function handoff(key = randomUUID()) {
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
      id: recId, key: 'IMPROVE_SEARCH_CTR:3f9a', type: 'IMPROVE_SEARCH_CTR', type_label: 'Improve search CTR',
      status: 'accepted', previous_instance: null, created_at: '2026-10-03T07:46:28.000Z', updated_at: '2026-10-03T07:46:28.000Z',
    },
    content: {
      title: 'Improve the search result for /pricing', summary: 'Summary.', reason: 'Reason.',
      suggested_action: 'Action.', expected_check: null, wording_source: 'deterministic',
    },
    target: { url: 'https://hlnalabs.com.au/pricing', path: '/pricing', query: null },
    assessment: { essio_priority_band: 'high', essio_priority_score: 72.5, essio_confidence: 0.72, note: 'Essio assessment.' },
    provenance: { calculation_version: 1, evidence_hash: 'a41c', data_through: '2026-09-29', crawl_run_id: null, evidence: [] },
  };
}

async function createWork(token: string, target: { board_id: string; group_id?: string | null }) {
  const doc = handoff();
  const res = await read(await work.POST(request('POST', '/api/integrations/essio/v1/work', token, { target, handoff: doc }, { 'idempotency-key': doc.idempotency_key })));
  expect(res.status).toBe(201);
  return { key: doc.idempotency_key, itemId: res.body.work_item.id as string };
}

async function getStatus(token: string | null, key: string, headers: Record<string, string> = {}) {
  return read(await status.GET(request('GET', `/api/integrations/essio/v1/work/${key}`, token, undefined, headers), { params: Promise.resolve({ idempotencyKey: key }) }));
}

async function createCredential(org: string, scopes: string[]) {
  const res = await read(await admin.POST(request('POST', '/api/admin/integration-credentials', null, { organisation_id: org, label: 'Essio', scopes })));
  expect(res.status).toBe(201);
  return res.body.token as string;
}

async function setCapability(org: string, enabled: boolean) {
  await exec(
    `INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'essio_integration', $2)
     ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    org, enabled,
  );
}

beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  await exec(`INSERT INTO users (id, organisation_id, username, name, status) VALUES ('user-admin', 'org-a', 'admin', 'Admin', 'ACTIVE')`);
  await exec(`INSERT INTO organiser_boards (id, organisation_id, name, position) VALUES ($1::uuid, 'org-a', 'Second board', 1)`, BOARD_A2);
  await exec(
    `INSERT INTO organiser_groups (id, board_id, organisation_id, name, position) VALUES ($1::uuid, $3::uuid, 'org-a', 'Now', 0), ($2::uuid, $4::uuid, 'org-a', 'Later', 0)`,
    GROUP_A, GROUP_A2, BOARD_A, BOARD_A2,
  );
  work = await import('@/app/api/integrations/essio/v1/work/route');
  status = await import('@/app/api/integrations/essio/v1/work/[idempotencyKey]/route');
  admin = await import('@/app/api/admin/integration-credentials/route');
  await setCapability(ORG_A, true);
  await setCapability(ORG_B, true);
  tokenA = await createCredential(ORG_A, ['work:create', 'work:read', 'targets:read']);
  tokenB = await createCredential(ORG_B, ['work:create', 'work:read']);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

describe('status of linked work', () => {
  it('returns the minimal linked response with raw status, category, updated_at and board URL', async () => {
    const { key, itemId } = await createWork(tokenA, { board_id: BOARD_A, group_id: GROUP_A });
    const res = await getStatus(tokenA, key);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      version: 1,
      state: 'linked',
      idempotency_key: key,
      work_item: {
        id: itemId,
        status: { raw: 'Not Started', category: 'not_started' },
        updated_at: expect.any(String),
        url: `https://brainbase.example/organiser?board=${BOARD_A}`,
      },
    });
    expect(Object.keys(res.body.work_item).sort()).toEqual(['id', 'status', 'updated_at', 'url']);
    const json = JSON.stringify(res.body);
    for (const leak of ['Summary.', 'notes', 'owner', 'assignee', 'priority', 'due_date', 'snapshot', 'credential', 'fingerprint', ORG_A]) {
      expect(json).not.toContain(leak);
    }
  });

  it('reflects Brainbase status changes, preserving raw text exactly', async () => {
    const { key, itemId } = await createWork(tokenA, { board_id: BOARD_A });
    const cases: Array<[string, string]> = [
      ['Working on it', 'in_progress'],
      ['Stuck', 'blocked'],
      ['Done', 'done'],
      ['Not Started', 'not_started'],
      ['Waiting on client ✋', 'other'],
      ['done', 'done'],
    ];
    for (const [raw, category] of cases) {
      await exec(`UPDATE organiser_items SET status = $1, updated_at = now() WHERE id = $2::uuid`, raw, itemId);
      const res = await getStatus(tokenA, key);
      expect(res.body.work_item.status).toEqual({ raw, category });
    }
  });

  it('keeps resolving after Brainbase users move, rename, prioritise, assign and schedule the item', async () => {
    const { key, itemId } = await createWork(tokenA, { board_id: BOARD_A, group_id: GROUP_A });
    const [before] = await q<Record<string, unknown>>(
      `SELECT request_fingerprint, handoff_fingerprint, target_board_id::text AS target_board_id, target_group_id::text AS target_group_id
       FROM organiser_item_external_links WHERE idempotency_key = $1`, key,
    );
    await exec(
      `UPDATE organiser_items SET board_id = $1::uuid, group_id = $2::uuid, name = 'Renamed by a person', priority = 'High',
         owner = 'Someone', assignee_user_id = 'user-admin', due_date = '2026-12-01', status = 'Working on it',
         updated_at = '2026-10-05T01:02:03Z' WHERE id = $3::uuid`,
      BOARD_A2, GROUP_A2, itemId,
    );
    const res = await getStatus(tokenA, key);
    expect(res.body).toMatchObject({
      state: 'linked',
      work_item: {
        id: itemId,
        status: { raw: 'Working on it', category: 'in_progress' },
        updated_at: '2026-10-05T01:02:03.000Z',
        url: `https://brainbase.example/organiser?board=${BOARD_A2}`, // current board
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Renamed|High|Someone|user-admin|2026-12-01/);
    const [after] = await q<Record<string, unknown>>(
      `SELECT request_fingerprint, handoff_fingerprint, target_board_id::text AS target_board_id, target_group_id::text AS target_group_id
       FROM organiser_item_external_links WHERE idempotency_key = $1`, key,
    );
    expect(after).toEqual(before); // original create-request identity unchanged
    expect(after).toMatchObject({ target_board_id: BOARD_A, target_group_id: GROUP_A });
  });
});

describe('deleted work', () => {
  it('reports item_deleted from the surviving link, stably, without recreating anything', async () => {
    const { key, itemId } = await createWork(tokenA, { board_id: BOARD_A });
    expect((await getStatus(tokenA, key)).body.state).toBe('linked');
    await exec(`DELETE FROM organiser_items WHERE id = $1::uuid`, itemId);
    const items = await count(`SELECT count(*) AS n FROM organiser_items`);
    const first = await getStatus(tokenA, key);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ version: 1, state: 'item_deleted', idempotency_key: key, work_item: { id: null, deleted_at: expect.any(String) } });
    const second = await getStatus(tokenA, key);
    expect(second.body).toEqual(first.body); // stable
    expect(await count(`SELECT count(*) AS n FROM organiser_items`)).toBe(items);
    expect(await count(`SELECT count(*) AS n FROM organiser_item_external_links WHERE idempotency_key = $1`, key)).toBe(1);
  });

  it('a deleted item in organisation A cannot be read from organisation B', async () => {
    const { key, itemId } = await createWork(tokenA, { board_id: BOARD_A });
    await exec(`DELETE FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(await getStatus(tokenB, key)).toMatchObject({ status: 404, body: { error: { code: 'work_not_found' } } });
  });
});

describe('access boundary and tenant isolation', () => {
  it('organisation A cannot read organisation B’s Essio work', async () => {
    const inB = await createWork(tokenB, { board_id: BOARD_B });
    expect((await getStatus(tokenB, inB.key)).status).toBe(200);
    const fromA = await getStatus(tokenA, inB.key);
    expect(fromA).toMatchObject({ status: 404, body: { error: { code: 'work_not_found' } } });
    expect(JSON.stringify(fromA.body)).not.toContain(inB.itemId);
  });

  it('arbitrary or unlinked Organiser items are indistinguishable from unknown keys', async () => {
    const [unlinked] = await q<{ id: string }>(
      `INSERT INTO organiser_items (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Not from Essio') RETURNING id::text AS id`, BOARD_A,
    );
    const { itemId } = await createWork(tokenA, { board_id: BOARD_A });
    const unknown = await getStatus(tokenA, randomUUID());
    for (const key of [unlinked.id, itemId, randomUUID(), 'not-a-uuid', `${randomUUID()}x`]) {
      const res = await getStatus(tokenA, key);
      expect(res.status, key).toBe(404);
      expect(res.body).toEqual(unknown.body); // same shape whether or not something exists
    }
  });

  it('requires work:read, the module, and a valid credential', async () => {
    const { key } = await createWork(tokenA, { board_id: BOARD_A });
    const writeOnly = await createCredential(ORG_A, ['work:create', 'targets:read']);
    expect(await getStatus(writeOnly, key)).toMatchObject({ status: 403, body: { error: { code: 'insufficient_scope' } } });
    const none = await getStatus(null, key);
    expect(none).toMatchObject({ status: 401, body: { error: { code: 'invalid_credentials' } } });
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect((await getStatus(`${tokenA.slice(0, 39)}${'A'.repeat(43)}`, key)).status).toBe(401);
    await setCapability(ORG_A, false);
    expect(await getStatus(tokenA, key)).toMatchObject({ status: 403, body: { error: { code: 'integration_disabled' } } });
    await setCapability(ORG_A, true);
    expect((await getStatus(tokenA, key, { 'essio-contract-version': '2' })).status).toBe(400);
    expect((await getStatus(tokenA, key)).status).toBe(200);
  });

  it('a revoked credential can no longer read', async () => {
    const res = await read(await admin.POST(request('POST', '/api/admin/integration-credentials', null, { organisation_id: ORG_A, label: 'Temp', scopes: ['work:read'] })));
    const { key } = await createWork(tokenA, { board_id: BOARD_A });
    expect((await getStatus(res.body.token, key)).status).toBe(200);
    await exec(`UPDATE integration_credentials SET enabled = false, revoked_at = now() WHERE id = $1::uuid`, res.body.credential.id);
    expect((await getStatus(res.body.token, key)).status).toBe(401);
  });

  it('reading never writes', async () => {
    const { key } = await createWork(tokenA, { board_id: BOARD_A });
    const snapshot = async () => q(`SELECT
      (SELECT count(*) FROM organiser_items) AS items, (SELECT count(*) FROM organiser_item_external_links) AS links,
      (SELECT count(*) FROM organiser_activity) AS activity, (SELECT max(updated_at) FROM organiser_items) AS updated`);
    const before = await snapshot();
    for (let i = 0; i < 3; i++) await getStatus(tokenA, key);
    expect(await snapshot()).toEqual(before);
  });
});

describe('error hygiene', () => {
  it('error bodies never leak SQL, schema names or other organisations’ ids', () => {
    expect(errorBodies.length).toBeGreaterThan(5);
    const all = errorBodies.join('\n');
    expect(all).not.toMatch(/organiser_items|organiser_item_external_links|integration_credentials|SELECT |org-b|stack/);
  });
});
