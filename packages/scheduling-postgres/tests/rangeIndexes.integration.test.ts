import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, sqlFile } from './support/pgHarness';

// Migration 041 (GiST range indexes for the booking range reads) rehearsed on a DISPOSABLE PostgreSQL. It is applied here by the test, never to any real database.
//   (a) apply 041, roll back with 099, apply again: idempotent, complete rollback;
//   (b) equivalence: the old predicate (starts_at < to AND ends_at > from) and the new one (tstzrange && tstzrange) return identical rows for random and boundary windows,
//       with the index absent AND present (and with the planner forced onto the index);
//   (c) plan: with enough rows, the new predicate uses the gist index and the old shape does not.

const suite = hasDatabase ? describe : describe.skip;
const q = async (text: string, params: unknown[] = []) => (await getPool().query(text, params)).rows;
const INDEXES = ['scheduling_reservations_range_gist', 'scheduling_occurrences_range_gist'];
const indexCount = async () => (await q('SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = ANY($1)', [INDEXES]))[0].n as number;
const marker = async () => (await q(`SELECT count(*)::int AS n FROM scheduling_schema_migrations WHERE version = '2c.4.1'`))[0].n as number;

// Deterministic PRNG so a failure reproduces.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const BASE = Date.parse('2027-03-01T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface Span { id: string; s: number; e: number }

// The timezone CHECK scans pg_timezone_names once per row (tens of ms), which makes a bulk load of thousands of rows take minutes. Swap in a cheap equivalent for the bulk
// load and restore the real definition afterwards (bookingReads.integration.test.ts does the same). The disposable database only.
const CHEAP_TZ = 'CREATE OR REPLACE FUNCTION scheduling_is_timezone(tz text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tz IS NOT NULL $$';
const REAL_TZ = 'CREATE OR REPLACE FUNCTION scheduling_is_timezone(tz text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) $$';

/** Bulk insert with triggers and foreign keys bypassed (session_replication_role = replica); CHECK constraints still apply. Test-only, on the disposable database. */
async function bulkInsert(org: string, kind: 'reservations' | 'occurrences', spans: Span[]) {
  const c: PoolClient = await getPool().connect();
  try {
    await c.query(CHEAP_TZ);
    await c.query("SET session_replication_role = 'replica'");
    const ids =spans.map(x => x.id);
    const s = spans.map(x => iso(x.s));
    const e = spans.map(x => iso(x.e));
    if (kind === 'reservations') {
      await c.query(
        `INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
                local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
         SELECT t.id, $1, 'rx-sch', 'resource_hire', 1, 'rx-off', 'slot', 'rx-res', 'c', 'UTC',
                (t.s AT TIME ZONE 'UTC')::date, (t.s AT TIME ZONE 'UTC')::time, (t.e AT TIME ZONE 'UTC')::date, (t.e AT TIME ZONE 'UTC')::time, t.s, t.e, 1, 'AUD'
           FROM unnest($2::text[], $3::timestamptz[], $4::timestamptz[]) AS t(id, s, e)`,
        [org, ids, s, e],
      );
    } else {
      await c.query(
        `INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
         SELECT t.id, $1, 'ox-' || t.id, (t.s AT TIME ZONE 'UTC')::date, (t.s AT TIME ZONE 'UTC')::time, 'UTC', t.s, t.e, 5
           FROM unnest($2::text[], $3::timestamptz[], $4::timestamptz[]) AS t(id, s, e)`,
        [org, ids, s, e],
      );
    }
  } finally {
    await c.query('RESET session_replication_role').catch(() => undefined);
    await c.query(REAL_TZ).catch(() => undefined);
    c.release();
  }
}

const OLD = (t: string) => `SELECT id FROM ${t} WHERE organisation_id = $1 AND starts_at < $3::timestamptz AND ends_at > $2::timestamptz`;
const NEW = (t: string) => `SELECT id FROM ${t} WHERE organisation_id = $1 AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`;
const ids = (rows: Array<{ id: string }>) => rows.map(r => r.id).sort();

function planIndexNames(node: unknown, out: string[] = []): string[] {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'Index Name' && typeof v === 'string') out.push(v);
      else planIndexNames(v, out);
    }
  }
  return out;
}

suite('migration 041: GiST range indexes', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await runScript(sqlFile('037_availability_versions.sql'));
    await runScript(sqlFile('099_range_indexes_rollback.sql'));
    await resetData();
  });
  afterAll(async () => {
    await resetData();
    await runScript(sqlFile('099_range_indexes_rollback.sql'));
    await closePool();
  });

  describe('apply, roll back, apply again', () => {
    it('is absent before it is applied, present after, gone after the rollback, present after a second apply, and applying twice changes nothing', async () => {
      expect(await indexCount()).toBe(0);
      expect(await marker()).toBe(0);
      await runScript(sqlFile('041_range_indexes.sql'));
      expect(await indexCount()).toBe(2);
      expect(await marker()).toBe(1);
      await runScript(sqlFile('041_range_indexes.sql'));
      expect(await indexCount()).toBe(2);
      expect(await marker()).toBe(1);
      await runScript(sqlFile('099_range_indexes_rollback.sql'));
      expect(await indexCount()).toBe(0);
      expect(await marker()).toBe(0);
      await runScript(sqlFile('099_range_indexes_rollback.sql'));
      expect(await indexCount()).toBe(0);
      await runScript(sqlFile('041_range_indexes.sql'));
      expect(await indexCount()).toBe(2);
      expect(await marker()).toBe(1);
      const defs = await q('SELECT indexdef FROM pg_indexes WHERE indexname = ANY($1) ORDER BY indexname', [INDEXES]);
      for (const d of defs) {
        expect(d.indexdef).toMatch(/USING gist \(organisation_id, tstzrange\(starts_at, ends_at, '\[\)'::text\)\)/);
      }
      await runScript(sqlFile('099_range_indexes_rollback.sql'));
    });
    it('refuses to apply without marker 2c.3.1 (037) and leaves nothing behind', async () => {
      await runScript(sqlFile('099_range_indexes_rollback.sql'));
      await q(`UPDATE scheduling_schema_migrations SET version = '2c.3.1-held' WHERE version = '2c.3.1'`);
      // A script that raises inside BEGIN leaves its connection in an aborted transaction: use a dedicated connection and roll it back.
      const c = await getPool().connect();
      try {
        await expect(c.query(sqlFile('041_range_indexes.sql'))).rejects.toThrow(/needs 037/);
        await c.query('ROLLBACK');
        expect(await indexCount()).toBe(0);
        expect(await marker()).toBe(0);
      } finally {
        c.release();
        await q(`UPDATE scheduling_schema_migrations SET version = '2c.3.1' WHERE version = '2c.3.1-held'`);
      }
    });
  });

  describe('the new predicate returns exactly what the old one returns', () => {
    const ORG = 'org-eq';
    const OTHER = 'org-eq-other';
    const windows: Array<[number, number]> = [];
    beforeAll(async () => {
      await resetData();
      const rand = rng(41);
      // Anchors: boundaries are built from a small set of instants so many rows end exactly at, or start exactly at, a query edge.
      const anchors = Array.from({ length: 40 }, (_, i) => BASE + i * 6 * 60 * MIN + Math.floor(rand() * 4) * 15 * MIN);
      const durations = [MIN, 15 * MIN, 30 * MIN, 60 * MIN, 24 * 60 * MIN, 3 * 24 * 60 * MIN, 7 * 24 * 60 * MIN];
      const make = (prefix: string, n: number): Span[] => {
        const out: Span[] = [];
        let k = 0;
        const push = (s: number, e: number) => out.push({ id: `${prefix}-${++k}`, s, e });
        for (let i = 0; i < n; i++) {
          const s = BASE - 2 * 24 * 60 * MIN + Math.floor(rand() * 40 * 24 * 60) * MIN;
          push(s, s + durations[Math.floor(rand() * durations.length)]);
        }
        for (const a of anchors) {
          for (const d of [MIN, 60 * MIN, 24 * 60 * MIN]) {
            push(a - d, a); // ends exactly at an anchor
            push(a, a + d); // starts exactly at an anchor
          }
          push(a - 60 * MIN, a + 60 * MIN); // spans an anchor
        }
        return out;
      };
      const reservations = make('r', 3000);
      const occurrences = make('o', 3000);
      // Occurrences need a unique (offering, local date, local start): bulkInsert gives each its own offering.
      await bulkInsert(ORG, 'reservations', reservations);
      await bulkInsert(ORG, 'occurrences', occurrences);
      await bulkInsert(OTHER, 'reservations', reservations.slice(0, 200).map(x => ({ ...x, id: `x${x.id}` })));
      for (let i = 0; i < 150; i++) {
        const from = BASE - 24 * 60 * MIN + Math.floor(rand() * 42 * 24 * 60) * MIN;
        windows.push([from, from + (1 + Math.floor(rand() * 5 * 24 * 60)) * MIN]);
      }
      for (let i = 0; i < 150; i++) {
        const a = anchors[Math.floor(rand() * anchors.length)];
        const b = anchors[Math.floor(rand() * anchors.length)];
        const [from, to] = a < b ? [a, b] : a > b ? [b, a] : [a, a + 60 * MIN];
        windows.push([from, to]);
      }
      await q('ANALYZE scheduling_reservations');
      await q('ANALYZE scheduling_occurrences');
    });

    const compare = async (forceIndex: boolean) => {
      const c = await getPool().connect();
      try {
        await c.query(forceIndex ? 'SET enable_seqscan = off; SET enable_bitmapscan = on' : 'RESET enable_seqscan');
        let nonEmpty = 0;
        for (const [from, to] of windows) {
          for (const table of ['scheduling_reservations', 'scheduling_occurrences']) {
            const params = [ORG, iso(from), iso(to)];
            const a = ids((await c.query(OLD(table), params)).rows);
            const b = ids((await c.query(NEW(table), params)).rows);
            expect(b, `${table} ${iso(from)} .. ${iso(to)}`).toEqual(a);
            if (a.length > 0) nonEmpty++;
          }
        }
        expect(nonEmpty).toBeGreaterThan(300);
      } finally {
        await c.query('RESET enable_seqscan').catch(() => undefined);
        c.release();
      }
    };

    it('with the index absent: identical id sets for 300 random and boundary-touching windows', async () => {
      await runScript(sqlFile('099_range_indexes_rollback.sql'));
      expect(await indexCount()).toBe(0);
      await compare(false);
    });
    it('with the index present (default plans): identical id sets', async () => {
      await runScript(sqlFile('041_range_indexes.sql'));
      await compare(false);
    });
    it('with the index present and the planner forced onto it: identical id sets', async () => {
      await runScript(sqlFile('041_range_indexes.sql'));
      await compare(true);
    });
    it('the edges are half-open: ending at the start, or starting at the end, is not in range; one microsecond more is', async () => {
      const from = BASE + 100 * 24 * 60 * MIN;
      const to = from + 60 * MIN;
      await bulkInsert('org-edge', 'reservations', [
        { id: 'ends-at-from', s: from - 60 * MIN, e: from },
        { id: 'starts-at-to', s: to, e: to + 60 * MIN },
        { id: 'zero-gap-inside', s: from, e: to },
        { id: 'contains', s: from - 60 * MIN, e: to + 60 * MIN },
        { id: 'contained', s: from + 10 * MIN, e: from + 20 * MIN },
        { id: 'overlaps-start', s: from - 30 * MIN, e: from + MIN },
        { id: 'overlaps-end', s: to - MIN, e: to + 30 * MIN },
      ]);
      const got = ids(await q(NEW('scheduling_reservations'), ['org-edge', iso(from), iso(to)]));
      expect(got).toEqual(['contained', 'contains', 'overlaps-end', 'overlaps-start', 'zero-gap-inside']);
      expect(ids(await q(OLD('scheduling_reservations'), ['org-edge', iso(from), iso(to)]))).toEqual(got);
    });
  });

  describe('the planner uses the index for the new predicate', () => {
    const ORG = 'org-plan';
    beforeAll(async () => {
      await resetData();
      await runScript(sqlFile('041_range_indexes.sql'));
      const c = await getPool().connect();
      try {
        await c.query(CHEAP_TZ);
        await c.query("SET session_replication_role = 'replica'");
        // 60k reservations and 30k occurrences for one organisation: hourly spans spread over 400 days of history up to now, plus a month ahead. A little for another tenant.
        await c.query(
          `INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
                  local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
           SELECT 'p' || g, o.org, 'rx-sch', 'resource_hire', 1, 'rx-off', 'slot', 'rx-res', 'c', 'UTC',
                  (s AT TIME ZONE 'UTC')::date, (s AT TIME ZONE 'UTC')::time, (s AT TIME ZONE 'UTC' + interval '1 hour')::date, (s AT TIME ZONE 'UTC' + interval '1 hour')::time, s, s + interval '1 hour', 1, 'AUD'
             FROM (VALUES ('${ORG}', 60000), ('org-plan-other', 2000)) AS o(org, n),
                  LATERAL generate_series(1, o.n) AS g,
                  LATERAL (SELECT now() - interval '400 days' + (g::float8 / o.n) * interval '430 days' AS s) AS x`,
        );
        await c.query(
          `INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
           SELECT 'p' || g, o.org, 'ox-' || g, (s AT TIME ZONE 'UTC')::date, (s AT TIME ZONE 'UTC')::time, 'UTC', s, s + interval '1 hour', 5
             FROM (VALUES ('${ORG}', 30000), ('org-plan-other', 1000)) AS o(org, n),
                  LATERAL generate_series(1, o.n) AS g,
                  LATERAL (SELECT now() - interval '400 days' + (g::float8 / o.n) * interval '430 days' AS s) AS x`,
        );
      } finally {
        await c.query('RESET session_replication_role').catch(() => undefined);
        await c.query(REAL_TZ).catch(() => undefined);
        c.release();
      }
      await q('ANALYZE scheduling_reservations');
      await q('ANALYZE scheduling_occurrences');
    });

    // A three-day window near now (about 400 reservations of 60k). With LIMIT 201 the planner weighs the starts_at-ordered scan against the index by its row estimate: at about
    // 1000 matches (a week at this density) it still prefers the ordered scan (about 15 ms here), at a few hundred it takes the gist index (under 1 ms).
    const week = () => {
      const from = new Date(Date.now() - 1 * 24 * 3600_000);
      return [from.toISOString(), new Date(from.getTime() + 3 * 24 * 3600_000).toISOString()];
    };
    // The same shape as the repository: tenant, range, a stable order and a page limit.
    const planFor = async (table: string, predicate: 'old' | 'new') => {
      const [from, to] = week();
      const where = predicate === 'new'
        ? `tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`
        : 'x.starts_at < $3::timestamptz AND x.ends_at > $2::timestamptz';
      const rows = await q(`EXPLAIN (FORMAT JSON) SELECT x.id FROM ${table} x WHERE x.organisation_id = $1 AND ${where} ORDER BY x.starts_at, x.id LIMIT 201`, [ORG, from, to]);
      return planIndexNames(rows[0]['QUERY PLAN']);
    };

    it('the new predicate on reservations uses the gist range index', async () => {
      expect(await planFor('scheduling_reservations', 'new')).toContain('scheduling_reservations_range_gist');
    });
    it('the new predicate on occurrences uses the gist range index', async () => {
      expect(await planFor('scheduling_occurrences', 'new')).toContain('scheduling_occurrences_range_gist');
    });
    it('the old shape does not use (or need) the range index', async () => {
      for (const t of ['scheduling_reservations', 'scheduling_occurrences']) {
        expect((await planFor(t, 'old')).filter(n => n.includes('range_gist')), t).toEqual([]);
      }
    });
  });
});
