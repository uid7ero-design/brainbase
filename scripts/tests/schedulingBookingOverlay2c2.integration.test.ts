import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { findIdentityLeaks } from '@scheduling/core';
import { PostgresReservationRepository } from '@scheduling/postgres';
import { fromPgLike } from '@scheduling/postgres';
import { classBooking, person, slotBooking } from '../../packages/scheduling-postgres/tests/support/builders';
import { FixedClock, closePool, seedOccurrence, seedOffering, seedResource, seedSchedule, staff } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.2: the READ-ONLY booking overlay API through the REAL chain (run by scripts/tests/verify-scheduling-phase2c.sh against a DISPOSABLE database, PostgreSQL 16
// and 17): signed session cookie -> middleware.ts (module access) -> the route's requireSession() -> schedulingRoute() (capability + role -> scheduling permission) ->
// handler. Only the Next cookie store and the database client are replaced; SESSION_SECRET is a throwaway test value. Nothing here reads DATABASE_URL.
//   - who may see it (manager, viewer, legacy account) and who may not (analyst, no module access, unentitled organisation, anonymous);
//   - the body carries NO customer data, for any role, and a viewer and a manager receive the same bytes;
//   - another organisation's rows and ids are invisible;
//   - bounds and malformed input are 400, before any statement that could matter;
//   - a content hash of every Scheduling table, the user and access tables and the audit log is identical after every request: reading writes nothing;
//   - a dead database is a generic 503 and a slow one a 504, with nothing internal in the body.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-overlay-matrix-0123456789';
  process.env.SCHEDULING_CALENDAR_DEADLINE_MS = '400';
  return { cookie: null as string | null, failScheduling: false, delayScheduling: 0, statements: 0 };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'session' && state.cookie ? { name, value: state.cookie } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 20 });
  type Opts = { fetchOptions?: { signal?: AbortSignal } };
  const run = (text: string, params: unknown[], opts?: Opts) => {
    state.statements += 1;
    if (state.delayScheduling > 0 && /scheduling_/.test(text)) {
      const signal = opts?.fetchOptions?.signal;
      return new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const timer = setTimeout(() => p.query(text, params).then(r => resolve(r.rows), reject), state.delayScheduling);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (state.failScheduling && /scheduling_/.test(text)) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2 relation scheduling_resources'), { code: 'ECONNREFUSED' }));
    return p.query(text, params).then(r => r.rows);
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const query = (text: string, params: unknown[] = [], opts?: Opts) => run(text, [...params], opts);
  return { default: Object.assign(tag, { query }) };
});

const { middleware } = await import('@/middleware');
const { encrypt } = await import('@/lib/session');
type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const overlayRoute = (await import('@/app/api/scheduling/calendar-overlay/route')) as { GET: Handler };

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules',
  'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences',
  'scheduling_series', 'scheduling_series_pauses', 'scheduling_settings', 'organisations', 'organisation_modules', 'users', 'organisation_user_access', 'audit_logs',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of TABLES) out.push((await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`))[0].h);
  return out;
};

type Person = { id: string; org: string; role: string; access: Record<string, string> | null };
const PEOPLE: Record<string, Person> = {
  managerUse: { id: 'u-manager-use', org: 'org-a', role: 'manager', access: { scheduling: 'use' } },
  managerView: { id: 'u-manager-view', org: 'org-a', role: 'manager', access: { scheduling: 'view' } },
  viewerView: { id: 'u-viewer-view', org: 'org-a', role: 'viewer', access: { scheduling: 'view' } },
  viewerNone: { id: 'u-viewer-none', org: 'org-a', role: 'viewer', access: { crm: 'use' } },
  analyst: { id: 'u-analyst', org: 'org-a', role: 'analyst', access: { scheduling: 'view' } },
  unmanagedManager: { id: 'u-unmanaged', org: 'org-a', role: 'manager', access: null },
  unentitled: { id: 'u-unentitled', org: 'org-d', role: 'manager', access: { scheduling: 'use' } },
  otherOrg: { id: 'u-other', org: 'org-b', role: 'manager', access: { scheduling: 'use' } },
};
const signIn = async (p: Person, over: Partial<{ organisationId: string; role: string }> = {}) => {
  state.cookie = await encrypt({ userId: p.id, organisationId: over.organisationId ?? p.org, role: (over.role ?? p.role) as never, name: p.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
};
const signOut = () => { state.cookie = null; };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Outcome { status: number; json: Json; text: string; by: 'middleware' | 'route'; serverTiming: string | null }
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
async function overlay(query = '?from=2026-12-07&to=2026-12-13', method: 'GET' | 'POST' = 'GET'): Promise<Outcome> {
  const url = `http://bb.test/api/scheduling/calendar-overlay${query}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const gate = await middleware(new NextRequest(url, { method, headers }));
  if (gate.headers.get('x-middleware-next') !== '1') {
    const text = await gate.text();
    return { status: gate.status, json: text ? safeJson(text) : null, text, by: 'middleware', serverTiming: null };
  }
  const handler = (overlayRoute as unknown as Record<string, Handler | undefined>)[method];
  if (!handler) return { status: 405, json: null, text: '', by: 'route', serverTiming: null };
  const response = await handler(new Request(url, { method, headers }), { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, json: text ? safeJson(text) : null, text, by: 'route', serverTiming: response.headers.get('server-timing') };
}

const clock = new FixedClock(new Date('2026-11-01T00:00:00Z'));
const ids = { occWithCourt: '', occNoCourt: '', hire: '', hireCancelled: '' };
const BASE = Date.parse('2026-12-07T05:30:00Z'); // Monday 16:00 Adelaide
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

suite('Scheduling 2C.2 booking overlay: permission, privacy and isolation through the real chain', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 10 });
    pool.on('error', () => undefined);
    await pool.query(sqlFile('034_availability_integrity.sql'));
    await pool.query(sqlFile('035_availability_partial_closures.sql'));
    await pool.query(sqlFile('036_availability_zones.sql'));
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS organisation_user_access (user_id TEXT PRIMARY KEY REFERENCES users(id), organisation_id TEXT NOT NULL REFERENCES organisations(id),
         permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL REFERENCES users(id))`,
    );
  }, 60_000);
  afterAll(async () => {
    await pool?.query('DROP TABLE IF EXISTS organisation_user_access').catch(() => undefined);
    await pool?.query(sqlFile('097_availability_zones_rollback.sql')).catch(() => undefined);
    await pool?.query(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await pool?.end();
    await closePool();
  });

  beforeEach(async () => {
    signOut();
    state.failScheduling = false;
    state.delayScheduling = 0;
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_series_pauses, scheduling_series, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_settings CASCADE');
    await q('DELETE FROM organisation_user_access');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM audit_logs');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    for (const [id, tz] of [['org-a', 'Australia/Adelaide'], ['org-b', 'Australia/Perth'], ['org-d', 'Australia/Adelaide']] as const) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, tz]);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
    }
    for (const org of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [org]);
    for (const p of Object.values(PEOPLE)) await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $1, $4)', [p.id, p.org, `${p.id}@example.test`, p.role]);
    for (const p of Object.values(PEOPLE)) if (p.access) await q('INSERT INTO organisation_user_access (user_id, organisation_id, permissions, updated_by) VALUES ($1, $2, $3::jsonb, $1)', [p.id, p.org, JSON.stringify(p.access)]);
    await seed();
  });

  /** Bookings with recognisable customers, so a leak is easy to see. Written through the repository, as the product will. */
  async function seed() {
    const repo = new PostgresReservationRepository({ sql: fromPgLike(pool), clock });
    const manager = staff('org-a');
    await seedSchedule('org-a', 'a-class', 'classes_coaching');
    await seedOffering('org-a', 'a-class-off', 'a-class', { capacity: 10 });
    await seedSchedule('org-a', 'a-hire', 'resource_hire');
    await seedOffering('org-a', 'a-hire-off', 'a-hire', { capacity: null });
    await seedResource('org-a', 'a-court-1', 'court');
    await seedResource('org-a', 'a-court-2', 'court');
    await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-a','a-hire-off','a-court-1'),('org-a','a-hire-off','a-court-2'),('org-a','a-class-off','a-court-1')");
    ids.occWithCourt = 'occ-with-court';
    ids.occNoCourt = 'occ-no-court';
    await seedOccurrence({ id: ids.occWithCourt, org: 'org-a', offeringId: 'a-class-off', capacity: 10, resourceId: 'a-court-1', startsAt: iso(BASE), endsAt: iso(BASE + 3_600_000) });
    await seedOccurrence({ id: ids.occNoCourt, org: 'org-a', offeringId: 'a-class-off', capacity: 10, resourceId: null, startsAt: iso(BASE + 86_400_000), endsAt: iso(BASE + 86_400_000 + 3_600_000) });
    for (const [name, email] of [['Alex Nguyen', 'alex.nguyen@example.com'], ['Bo Chen', 'bo.chen@example.com']] as const) {
      const r = await repo.create(manager, classBooking(ids.occWithCourt, { schedule: 'a-class', offering: 'a-class-off' }, { instants: { startsAt: iso(BASE), endsAt: iso(BASE + 3_600_000) }, customerSnapshot: person(name, email), notes: `private note for ${name}` }));
      if (!r.ok) throw new Error(`seed enrol: ${r.reason}`);
    }
    const hire = await repo.create(manager, slotBooking('a-court-2', '2026-12-08', '10:00', 60, { schedule: 'a-hire', offering: 'a-hire-off' }, { customerSnapshot: person('Hirer Person', 'hirer.person@example.com'), notes: 'bring the key' }));
    const gone = await repo.create(manager, slotBooking('a-court-2', '2026-12-08', '12:00', 60, { schedule: 'a-hire', offering: 'a-hire-off' }, { customerSnapshot: person('Cancelled Customer', 'cancelled.customer@example.com') }));
    if (!hire.ok || !gone.ok) throw new Error('seed hire');
    ids.hire = hire.reservation.id;
    ids.hireCancelled = gone.reservation.id;
    await repo.cancel(manager, { reservationId: gone.reservation.id, cancelledBy: 'staff', reason: 'private reason', scope: 'this_occurrence' });

    const b = staff('org-b');
    await seedSchedule('org-b', 'b-class', 'classes_coaching');
    await seedOffering('org-b', 'b-class-off', 'b-class', { capacity: 5 });
    await seedResource('org-b', 'b-court', 'court');
    await q("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ('org-b','b-class-off','b-court')");
    await seedOccurrence({ id: 'b-occ', org: 'org-b', offeringId: 'b-class-off', capacity: 5, resourceId: 'b-court', startsAt: iso(BASE), endsAt: iso(BASE + 3_600_000) });
    const theirs = await repo.create(b, classBooking('b-occ', { schedule: 'b-class', offering: 'b-class-off' }, { instants: { startsAt: iso(BASE), endsAt: iso(BASE + 3_600_000) }, customerSnapshot: person('Zed Other', 'zed.other@other.example') }));
    if (!theirs.ok) throw new Error('seed other org');
  }

  const SECRETS = ['Alex', 'Nguyen', 'alex.nguyen', 'Bo Chen', 'bo.chen', 'Hirer', 'hirer.person', 'Cancelled Customer', 'cancelled.customer', 'private note', 'private reason', 'bring the key', 'Zed', 'other.example', 'example.com'];
  const STRUCTURAL = [/customer/i, /e-?mail/i, /phone/i, /notes?\b/i, /payment/i, /attendance/i, /party_?size/i, /series/i, /idempotency/i, /org-[abd]\b/, /organisation/i, /u-(manager|viewer|analyst|unmanaged|other)/, /@example\.test/];

  describe('who may see the overlay', () => {
    const ALLOWED: Array<[string, keyof typeof PEOPLE]> = [
      ['a MANAGER with use access', 'managerUse'],
      ['a MANAGER with view-only access', 'managerView'],
      ['a VIEWER with view access', 'viewerView'],
      ['a legacy account with no module restrictions', 'unmanagedManager'],
    ];
    for (const [label, who] of ALLOWED) {
      it(`${label}: 200 and exactly the manager's bytes`, async () => {
        await signIn(PEOPLE.managerUse);
        const base = await overlay();
        expect(base.status, base.text).toBe(200);
        await signIn(PEOPLE[who]);
        const r = await overlay();
        expect(r.status, r.text).toBe(200);
        expect(r.by).toBe('route');
        expect(r.text).toBe(base.text);
        expect(r.serverTiming).toMatch(/app;dur=\d+, db;dur=\d+/);
      });
    }
    it('a viewer with no module access is stopped by the module boundary (403) before the route; an analyst, an unentitled organisation are 403; anonymous and tampered cookies are 401', async () => {
      await signIn(PEOPLE.viewerNone);
      const none = await overlay();
      expect([none.status, none.by]).toEqual([403, 'middleware']);
      await signIn(PEOPLE.analyst);
      expect((await overlay()).status).toBe(403);
      await signIn(PEOPLE.unentitled);
      expect((await overlay()).status).toBe(403);
      signOut();
      expect((await overlay()).status).toBe(401);
      state.cookie = 'not-a-jwt';
      expect((await overlay()).status).toBe(401);
      await signIn(PEOPLE.managerUse);
      state.cookie = `${state.cookie}x`;
      expect((await overlay()).status).toBe(401);
    });
    it('a cookie that claims a higher role than the user row has is judged by the row; the cookie never decides', async () => {
      await signIn(PEOPLE.analyst, { role: 'super_admin' });
      expect((await overlay()).status).toBe(403);
    });
    it('only GET exists: POST, PUT, PATCH and DELETE are refused and write nothing', async () => {
      await signIn(PEOPLE.unmanagedManager);
      const before = await hashAll();
      for (const method of ['POST'] as const) expect((await overlay('?from=2026-12-07', method)).status).toBe(405);
      expect(Object.keys(overlayRoute).sort()).toEqual(['GET', 'dynamic']);
      expect(await hashAll()).toEqual(before);
    });
  });

  describe('what the body is', () => {
    it('draws the week: a court lane with the session, a lane with the booking and its cancelled sibling, the unassigned-space row, and the range in the organisation zone', async () => {
      await signIn(PEOPLE.viewerView);
      const r = await overlay('?from=2026-12-07&to=2026-12-13&includeCancelled=1');
      expect(r.status, r.text).toBe(200);
      expect(r.json.zone).toBe('Australia/Adelaide');
      expect(r.json.range).toEqual({ from: '2026-12-07', to: '2026-12-13', fromInstant: '2026-12-06T13:30:00Z', toInstant: '2026-12-13T13:30:00Z' }); // 00:00 ACDT (+10:30)
      const lanes = r.json.overlay.lanes as Array<{ resourceId: string; items: Array<{ kind: string; id: string; state?: string; status?: string; holdId: string | null; liveHeadcount?: number }> }>;
      expect(lanes.map(l => l.resourceId)).toEqual(['a-court-1', 'a-court-2']);
      expect(lanes[0].items).toEqual([expect.objectContaining({ kind: 'occurrence', id: ids.occWithCourt, liveHeadcount: 2, status: 'scheduled', placement: 'resource', holdId: expect.any(String) })]);
      expect(lanes[1].items.map(i => [i.kind, i.id, i.state])).toEqual([['booking', ids.hire, 'booked'], ['booking', ids.hireCancelled, 'cancelled']]);
      expect(lanes[1].items[1].holdId).toBeNull();
      expect(r.json.overlay.unassignedSpace.map((o: { id: string }) => o.id)).toEqual([ids.occNoCourt]);
      expect(r.json.overlay.unassignedSpace[0]).toMatchObject({ placement: 'unassigned_space', resourceId: null, holdId: null });
      expect(r.json.overlay.counts).toEqual({ occurrences: 2, slotBookings: 2, holds: 0, cancelled: 1, unassignedSpace: 1 });
      expect(r.json.overlay.truncated).toEqual({ occurrences: false, slotBookings: false, holds: false });
      const live = await overlay('?from=2026-12-07&to=2026-12-13');
      expect(live.json.overlay.counts.cancelled).toBe(0);
    });

    it('contains no customer name, email, note, reason or identifier, for a viewer or a manager, anywhere in the body', async () => {
      for (const who of [PEOPLE.viewerView, PEOPLE.managerUse]) {
        await signIn(who);
        const r = await overlay('?from=2026-12-07&to=2026-12-13&includeCancelled=1');
        for (const secret of SECRETS) expect(r.text, `${who.id} must not see ${secret}`).not.toContain(secret);
        for (const re of STRUCTURAL) expect(r.text, `${who.id}: ${re}`).not.toMatch(re);
        expect(findIdentityLeaks(r.json)).toEqual([]);
      }
    });

    it('another organisation’s rows and ids are invisible; asking for its resource or offering returns nothing of it', async () => {
      await signIn(PEOPLE.managerUse);
      const mine = await overlay('?from=2026-12-07&to=2026-12-13');
      expect(mine.text).not.toContain('b-occ');
      expect(mine.text).not.toContain('b-court');
      const asked = await overlay('?from=2026-12-07&to=2026-12-13&resourceIds=b-court&offeringId=b-class-off');
      expect(asked.status).toBe(200);
      expect(asked.json.overlay.lanes).toEqual([]);
      expect(asked.json.overlay.unassignedSpace).toEqual([]);
      await signIn(PEOPLE.otherOrg);
      const theirs = await overlay('?from=2026-12-07&to=2026-12-13');
      expect(theirs.json.zone).toBe('Australia/Perth');
      expect(theirs.json.overlay.lanes.map((l: { resourceId: string }) => l.resourceId)).toEqual(['b-court']);
      expect(theirs.text).not.toMatch(/a-court|occ-with-court|a-class|a-hire/);
      for (const secret of ['Alex', 'Hirer', 'Zed']) expect(theirs.text).not.toContain(secret);
    });

    it('a Perth organisation’s days start at Perth midnight, and an Adelaide spring-forward day is 23 hours and a fall-back day 25', async () => {
      await signIn(PEOPLE.otherOrg);
      const perth = await overlay('?from=2026-12-07');
      expect([perth.json.range.fromInstant, perth.json.range.toInstant]).toEqual(['2026-12-06T16:00:00Z', '2026-12-07T16:00:00Z']);
      await signIn(PEOPLE.managerUse);
      const forward = await overlay('?from=2026-10-04');
      expect(Date.parse(forward.json.range.toInstant) - Date.parse(forward.json.range.fromInstant)).toBe(23 * 3_600_000);
      const back = await overlay('?from=2027-04-04');
      expect(Date.parse(back.json.range.toInstant) - Date.parse(back.json.range.fromInstant)).toBe(25 * 3_600_000);
    });
  });

  describe('input is bounded and validated', () => {
    const BAD: Array<[string, string]> = [
      ['no from', ''],
      ['from not a date', '?from=2026-13-40'],
      ['to before from', '?from=2026-12-10&to=2026-12-09'],
      ['a range over 14 days', '?from=2026-12-01&to=2026-12-15'],
      ['an unknown parameter', '?from=2026-12-07&organisationId=org-b'],
      ['a repeated parameter', '?from=2026-12-07&from=2026-12-08'],
      ['an empty resource id', '?from=2026-12-07&resourceIds=a,,b'],
      ['101 resources', `?from=2026-12-07&resourceIds=${Array.from({ length: 101 }, (_, i) => `r${i}`).join(',')}`],
      ['an over-long id', `?from=2026-12-07&offeringId=${'x'.repeat(129)}`],
      ['a bad includeCancelled', '?from=2026-12-07&includeCancelled=maybe'],
      ['limit 0', '?from=2026-12-07&limit=0'],
      ['limit 501', '?from=2026-12-07&limit=501'],
      ['limit not a number', '?from=2026-12-07&limit=ten'],
    ];
    for (const [label, query] of BAD) {
      it(`${label}: 400 INVALID_INPUT and nothing is written`, async () => {
        await signIn(PEOPLE.viewerView);
        const before = await hashAll();
        const r = await overlay(query);
        expect(r.status, r.text).toBe(400);
        expect(r.json.code).toBe('INVALID_INPUT');
        expect(await hashAll()).toEqual(before);
      });
    }
    it('accepts exactly 14 days and exactly 100 resources', async () => {
      await signIn(PEOPLE.viewerView);
      expect((await overlay('?from=2026-12-01&to=2026-12-14')).status).toBe(200);
      expect((await overlay(`?from=2026-12-07&resourceIds=${Array.from({ length: 100 }, (_, i) => `r${i}`).join(',')}`)).status).toBe(200);
    });
    it('says so when a cap cut something off', async () => {
      await signIn(PEOPLE.viewerView);
      const r = await overlay('?from=2026-12-07&to=2026-12-13&limit=1');
      expect(r.json.overlay.truncated.occurrences).toBe(true);
      expect(r.json.overlay.counts.occurrences).toBe(1);
    });
  });

  describe('reading changes nothing', () => {
    it('every request in the matrix leaves every Scheduling table, the user and access tables and the audit log exactly as they were', async () => {
      const before = await hashAll();
      for (const who of [PEOPLE.managerUse, PEOPLE.viewerView, PEOPLE.analyst, PEOPLE.viewerNone, PEOPLE.unentitled, PEOPLE.otherOrg]) {
        await signIn(who);
        await overlay('?from=2026-12-07&to=2026-12-13&includeCancelled=1');
        await overlay('?from=bad');
      }
      signOut();
      await overlay();
      expect(await hashAll()).toEqual(before);
      expect((await q<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE action LIKE 'scheduling.%'"))[0].n).toBe('0');
    });
    it('the number of database statements does not grow with the number of resources', async () => {
      await signIn(PEOPLE.viewerView);
      const count = async (query: string) => {
        state.statements = 0;
        await overlay(query);
        return state.statements;
      };
      const few = await count('?from=2026-12-07&to=2026-12-13');
      for (let i = 0; i < 30; i++) await seedResource('org-a', `a-extra-${i}`, 'court');
      const many = await count('?from=2026-12-07&to=2026-12-13');
      expect(many).toBe(few);
      expect(few).toBeLessThanOrEqual(12); // session, entitlement, runtime (zone + settings) and the three reads
    });
  });

  describe('when the database misbehaves', () => {
    it('a dead database is a generic 503 with nothing internal in the body', async () => {
      await signIn(PEOPLE.viewerView);
      state.failScheduling = true;
      const r = await overlay();
      expect(r.status).toBe(503);
      expect(r.text).not.toMatch(/hunter2|ECONNREFUSED|10\.1\.2\.3|scheduling_resources|password/i);
    });
    it('a slow database is a 504 SCHEDULING_TIMEOUT after the deadline, with nothing else', async () => {
      await signIn(PEOPLE.viewerView);
      state.delayScheduling = 1500;
      const started = Date.now();
      const r = await overlay();
      expect(r.status).toBe(504);
      expect(r.json.code).toBe('SCHEDULING_TIMEOUT');
      expect(Date.now() - started).toBeLessThan(1400);
      expect(Object.keys(r.json).sort()).toEqual(['code', 'error']);
    });
  });
});
