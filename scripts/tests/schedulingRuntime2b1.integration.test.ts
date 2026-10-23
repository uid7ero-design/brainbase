import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';

// Phase 2B.1 real-Postgres proof (run by scripts/tests/verify-scheduling-phase2b1.sh against a DISPOSABLE database). It
// reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL. Only two things are replaced: the
// application's database client (a pool onto that same disposable database, with Neon's tagged-template and .query shapes)
// and the session. The capability lookup, the access guard, the runtime, the shared Postgres repository, the audit module
// and the route handlers are the REAL code.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }));

vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 40 });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    p.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values).then(r => r.rows);
  const query = (text: string, params: unknown[] = []) => p.query(text, [...params]).then(r => r.rows);
  return { default: Object.assign(tag, { query }) };
});
vi.mock('@/lib/org', () => ({
  requireSession: async () => {
    if (!state.session) throw new Error('Unauthorized');
    return state.session;
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

const statusRoute = await import('@/app/api/scheduling/status/route');
const auditRoute = await import('@/app/api/scheduling/audit/route');
const { recordSchedulingAudit } = await import('@/lib/scheduling/audit');
const { staffTenantContext } = await import('@/lib/scheduling/adapters/brainbase');
const { createPostgresScheduling, fromPgLike } = await import('@scheduling/postgres');

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const hash = async (table: string) => (await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t`))[0].h;

const as = (role: string, organisationId: string, over: Record<string, unknown> = {}) => {
  state.session = { userId: `user-${organisationId}`, organisationId, homeOrganisationId: organisationId, role, name: 'T', ...over };
};
const get = (route: { GET: (r: Request) => Promise<Response> }, url = 'http://bb.test/api/scheduling/status') => route.GET(new Request(url));
const tenantOf = (org: string, role = 'manager') => staffTenantContext({ organisationId: org, userId: `user-${org}`, role, timezone: null });

suite('Scheduling 2B.1 on real Postgres', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 30 });
    pool.on('error', () => undefined);
  }, 60_000);
  afterAll(async () => { await pool?.end(); });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await q('TRUNCATE scheduling_settings, audit_logs, zz_committed CASCADE');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    // a: Perth, entitled, AUD   b: no timezone, entitled, NZD   c: entitled, NO settings row
    // d: settings but no entitlement   e: settings, entitlement disabled
    for (const [id, tz] of [['org-a', 'Australia/Perth'], ['org-b', null], ['org-c', 'Australia/Sydney'], ['org-d', 'Australia/Perth'], ['org-e', 'Australia/Perth']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $4, $5)', [`user-${id}`, id, `${id}@example.test`, id, 'manager']);
    }
    for (const [id, cur] of [['org-a', 'AUD'], ['org-b', 'NZD'], ['org-d', 'AUD'], ['org-e', 'AUD']] as const) await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, cur]);
    for (const [id, on] of [['org-a', true], ['org-b', true], ['org-c', true], ['org-e', false]] as const) {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', $2)", [id, on]);
    }
    state.session = null;
  });

  it('the registered capability exists and only the fixtures entitle anyone', async () => {
    expect(await q("SELECT active FROM modules WHERE key = 'scheduling'")).toEqual([{ active: true }]);
    expect(Number((await q<{ n: string }>("SELECT count(*) AS n FROM organisation_modules WHERE module_key = 'scheduling'"))[0].n)).toBe(4);
  });

  describe('access', () => {
    it('401 with no session', async () => {
      expect((await get(statusRoute)).status).toBe(401);
      expect((await get(auditRoute, 'http://bb.test/api/scheduling/audit')).status).toBe(401);
    });

    it('403 for an organisation with no entitlement row and for one whose entitlement is disabled', async () => {
      as('manager', 'org-d');
      expect((await get(statusRoute)).status).toBe(403);
      as('manager', 'org-e');
      expect((await get(statusRoute)).status).toBe(403);
    });

    it('403 when the module is globally inactive, whatever the organisation row says', async () => {
      await q("UPDATE modules SET active = false WHERE key = 'scheduling'");
      try {
        as('manager', 'org-a');
        expect((await get(statusRoute)).status).toBe(403);
      } finally {
        await q("UPDATE modules SET active = true WHERE key = 'scheduling'");
      }
      expect((await get(statusRoute)).status).toBe(200);
    });

    it('analyst and unknown roles are denied for an entitled organisation; viewer is read-only', async () => {
      for (const role of ['analyst', 'guest', '']) {
        as(role, 'org-a');
        expect((await get(statusRoute)).status, role).toBe(403);
      }
      as('viewer', 'org-a');
      expect(await (await get(statusRoute)).json()).toMatchObject({ access: { scope: 'reduced', permissions: ['scheduling.view'] } });
      as('manager', 'org-a');
      expect((await (await get(statusRoute)).json()).access.scope).toBe('full');
    });
  });

  describe('settings are explicit', () => {
    it('an entitled organisation with no settings row gets a controlled 503 and no row is created, even under load', async () => {
      const before = await hash('scheduling_settings');
      as('manager', 'org-c');
      const results = await Promise.all(Array.from({ length: 25 }, () => get(statusRoute)));
      for (const r of results) {
        expect(r.status).toBe(503);
        expect((await r.json()).code).toBe('SCHEDULING_NOT_CONFIGURED');
      }
      expect(await q("SELECT 1 FROM scheduling_settings WHERE organisation_id = 'org-c'")).toEqual([]);
      expect(await hash('scheduling_settings')).toBe(before);
    });

    it('the organisation timezone and currency are used; a NULL timezone falls back to Australia/Adelaide', async () => {
      as('manager', 'org-a');
      expect(await (await get(statusRoute)).json()).toMatchObject({ configured: true, timezone: 'Australia/Perth', timezone_source: 'organisation', currency: 'AUD' });
      as('manager', 'org-b');
      expect(await (await get(statusRoute)).json()).toMatchObject({ timezone: 'Australia/Adelaide', timezone_source: 'fallback', currency: 'NZD' });
    });

    it('an unusable stored timezone is a controlled error, not a silent fallback; the row is not modified', async () => {
      await q("UPDATE organisations SET timezone = 'Nowhere/Land' WHERE id = 'org-a'");
      as('manager', 'org-a');
      const res = await get(statusRoute);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('SCHEDULING_NOT_CONFIGURED');
      expect((await q<{ timezone: string }>("SELECT timezone FROM organisations WHERE id = 'org-a'"))[0].timezone).toBe('Nowhere/Land');
    });

    it('the status and audit routes change nothing in the database', async () => {
      const tables = ['scheduling_settings', 'organisations', 'organisation_modules', 'audit_logs', 'users'];
      const before = await Promise.all(tables.map(hash));
      for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
        as(role, 'org-a');
        await get(statusRoute);
        await get(auditRoute, 'http://bb.test/api/scheduling/audit');
      }
      expect(await Promise.all(tables.map(hash))).toEqual(before);
    });
  });

  describe('tenant isolation', () => {
    beforeEach(async () => {
      for (const org of ['org-a', 'org-b']) {
        await recordSchedulingAudit({
          tenant: tenantOf(org),
          action: 'scheduling.reservation.created',
          resourceType: 'reservation',
          resourceId: `${org}-res`,
          summary: { occurrence_id: `${org}-occ`, party_size: 2 },
          identity: { customerName: `Customer of ${org}`, customerEmail: `cust@${org}.example.test` },
        });
      }
    });

    it("each organisation's audit trail contains only its own entries; a named organisation in the query or headers is ignored", async () => {
      as('manager', 'org-a');
      const a = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
      expect(a.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['org-a-res']);
      const spoof = await auditRoute.GET(new Request('http://bb.test/api/scheduling/audit?organisation_id=org-b&organisationId=org-b', { headers: { 'x-organisation-id': 'org-b' } }));
      const body = await spoof.json();
      expect(body.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['org-a-res']);
      expect(JSON.stringify(body)).not.toMatch(/org-b/);
      as('manager', 'org-b');
      expect((await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json()).entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['org-b-res']);
    });

    it("the repository only ever reads the tenant's own settings", async () => {
      const persistence = createPostgresScheduling({ sql: fromPgLike(pool as never), clock: { now: () => new Date(), today: () => '2026-10-23' } });
      expect(await persistence.config.getSettings(tenantOf('org-a'))).toMatchObject({ organisationId: 'org-a', currency: 'AUD' });
      expect(await persistence.config.getSettings(tenantOf('org-b'))).toMatchObject({ organisationId: 'org-b', currency: 'NZD' });
      expect(await persistence.config.getSettings(tenantOf('org-c'))).toBeNull();
    });

    it('while a super_admin impersonates, the impersonated organisation is the one authorised and read', async () => {
      as('super_admin', 'org-b', { homeOrganisationId: 'org-a' });
      expect(await (await get(statusRoute)).json()).toMatchObject({ currency: 'NZD', timezone: 'Australia/Adelaide' });
      expect((await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json()).entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['org-b-res']);
      // the home organisation is entitled, the impersonated one is not: denied
      as('super_admin', 'org-d', { homeOrganisationId: 'org-a' });
      expect((await get(statusRoute)).status).toBe(403);
    });
  });

  describe('audit and privacy', () => {
    it('stores the identity apart from the summary, scoped to the organisation, in the shared audit_logs table', async () => {
      await recordSchedulingAudit({
        tenant: tenantOf('org-a'),
        action: 'scheduling.reservation.created',
        resourceType: 'reservation',
        resourceId: 'r-1',
        summary: { occurrence_id: 'o-1', customer_email: 'must-not-be-stored@example.test', note: 'ring 0400 000 000' },
        identity: { customerName: 'Pat Example', customerEmail: 'pat@example.test', customerPhone: '0400 111 222' },
      });
      const rows = await q<{ organisation_id: string; user_id: string; action: string; after_state: { summary: Record<string, unknown>; identity: Record<string, string>; redacted?: number } }>('SELECT * FROM audit_logs');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ organisation_id: 'org-a', user_id: 'user-org-a', action: 'scheduling.reservation.created' });
      expect(rows[0].after_state.summary).toEqual({ occurrence_id: 'o-1' });
      expect(rows[0].after_state.redacted).toBe(2);
      expect(rows[0].after_state.identity).toEqual({ customer_name: 'Pat Example', customer_email: 'pat@example.test', customer_phone: '0400 111 222' });
      expect(JSON.stringify(rows[0].after_state.summary)).not.toMatch(/Pat|example\.test|0400/);
    });

    it('a viewer never receives customer identity; manager, admin and super_admin do; the decision is made at read time', async () => {
      await recordSchedulingAudit({ tenant: tenantOf('org-a'), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: 'r-1', summary: { n: 1 }, identity: { customerName: 'Pat Example', customerEmail: 'pat@example.test' } });
      as('viewer', 'org-a');
      const viewerText = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).text();
      expect(JSON.parse(viewerText).identity_visible).toBe(false);
      expect(viewerText).not.toMatch(/Pat Example|pat@example\.test|customer_(name|email|phone)/);
      for (const role of ['manager', 'admin', 'super_admin']) {
        as(role, 'org-a');
        const body = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
        expect(body.entries[0].identity, role).toEqual({ customer_name: 'Pat Example', customer_email: 'pat@example.test' });
      }
      as('analyst', 'org-a');
      expect((await get(auditRoute, 'http://bb.test/api/scheduling/audit')).status).toBe(403);
    });

    it('a contact detail written by something else into the summary is still not returned', async () => {
      await q(
        "INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, after_state) VALUES ('x1','org-a','user-org-a','scheduling.reservation.created','reservation','r-x', $1::jsonb)",
        [JSON.stringify({ v: 1, summary: { customer_email: 'leak@example.test', phone: '0400 000 000', ref: 'ok-1', note: 'call pat@example.test' } })],
      );
      as('viewer', 'org-a');
      const text = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).text();
      expect(text).not.toMatch(/leak@example|0400|pat@example/);
      expect(JSON.parse(text).entries[0].summary).toEqual({ ref: 'ok-1' });
    });

    it('only scheduling.* entries are returned, newest first, with a bounded page and a working "before" cursor', async () => {
      await q("INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, after_state) VALUES ('other','org-a','user-org-a','impersonation.started','impersonation','x','{}'::jsonb)");
      for (let i = 0; i < 5; i++) {
        await recordSchedulingAudit({ tenant: tenantOf('org-a'), action: 'scheduling.schedule.created', resourceType: 'schedule', resourceId: `s-${i}`, summary: { i } });
        await new Promise(r => setTimeout(r, 15));
      }
      as('manager', 'org-a');
      const page = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit?limit=3')).json();
      expect(page.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['s-4', 's-3', 's-2']);
      expect(page.entries.every((e: { action: string }) => e.action.startsWith('scheduling.'))).toBe(true);
      expect(page.entries[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const older = await (await get(auditRoute, `http://bb.test/api/scheduling/audit?limit=10&before=${page.entries[2].at}`)).json();
      expect(older.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['s-1', 's-0']);
    });

    it('an audit failure never reverses an operation that already committed', async () => {
      await q("INSERT INTO zz_committed (id) VALUES ('booking-1')"); // stands for a committed booking
      await q('ALTER TABLE audit_logs RENAME TO audit_logs_gone');
      let wrote: boolean;
      try {
        wrote = await recordSchedulingAudit({ tenant: tenantOf('org-a'), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: 'booking-1', summary: { n: 1 } });
      } finally {
        await q('ALTER TABLE audit_logs_gone RENAME TO audit_logs');
      }
      expect(wrote).toBe(false);
      expect(await q('SELECT id FROM zz_committed')).toEqual([{ id: 'booking-1' }]);
      expect(await q('SELECT 1 FROM audit_logs')).toEqual([]);
    });
  });

  describe('fail closed on infrastructure failure', () => {
    it('503 with no detail when the runtime cannot read the organisation; capability checks still ran first', async () => {
      await q('ALTER TABLE organisations RENAME TO organisations_gone');
      try {
        as('manager', 'org-a');
        const res = await get(statusRoute);
        expect(res.status).toBe(503);
        expect(await res.text()).not.toMatch(/organisations|relation|42P01|SELECT/);
        // a denied organisation is still refused before any infrastructure matter is visible
        as('manager', 'org-d');
        expect((await get(statusRoute)).status).toBe(403);
      } finally {
        await q('ALTER TABLE organisations_gone RENAME TO organisations');
      }
      as('manager', 'org-a');
      expect((await get(statusRoute)).status).toBe(200);
    });

    it('503 when the entitlement lookup itself fails (the capability tables are unreadable)', async () => {
      await q('ALTER TABLE organisation_modules RENAME TO organisation_modules_gone');
      try {
        as('manager', 'org-a');
        expect((await get(statusRoute)).status).toBe(503);
      } finally {
        await q('ALTER TABLE organisation_modules_gone RENAME TO organisation_modules');
      }
    });
  });
});
