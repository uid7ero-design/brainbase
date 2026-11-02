import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { TZ } from './support/builders';
import { closePool, ensureSchema, getPool, hasDatabase, makePool, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// Migration 037 (per-owner availability versions) rehearsed on a DISPOSABLE PostgreSQL. It is applied here by the test, never to any real database. This file proves the table
// and its triggers; availabilityAtCommit.integration.test.ts proves the booking statement that uses them.

const ORG = 'org-ver';
const OTHER = 'org-ver-other';
const suite = hasDatabase ? describe : describe.skip;
let avail: PostgresAvailabilityRepository;
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };

const pool = () => getPool();
const q = async (text: string, params: unknown[] = []) => (await pool().query(text, params)).rows;
const version = async (org: string, kind: 'offering' | 'resource', id: string): Promise<number> =>
  Number((await q('SELECT version FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = $2 AND owner_id = $3', [org, kind, id]))[0]?.version);
const tokens = async (org: string, offering: string, resource: string) => ({
  offering: (await q('SELECT updated_at FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2', [org, offering]))[0].updated_at.toISOString(),
  resource: (await q('SELECT updated_at FROM scheduling_resources WHERE organisation_id = $1 AND id = $2', [org, resource]))[0].updated_at.toISOString(),
});

async function owners(org = ORG) {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  await seedSchedule(org, f.schedule, 'resource_hire');
  await seedOffering(org, f.offering, f.schedule, { capacity: null });
  await seedResource(org, f.court, 'court');
  return f;
}
const link = (f: { offering: string; court: string }, org = ORG) => q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);

suite('migration 037: per-owner availability versions', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await runScript(sqlFile('098_availability_versions_rollback.sql'));
    await runScript(sqlFile('037_availability_versions.sql'));
    await resetData();
    for (const org of [ORG, OTHER]) await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, 'Australia/Adelaide']);
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(pool()) });
  });
  afterAll(async () => {
    await resetData();
    await closePool();
  });

  describe('rows exist for every owner, with or without availability rules', () => {
    it('a new offering and a new resource each have a row at version 0 before any rule exists', async () => {
      const f = await owners();
      expect(await version(ORG, 'offering', f.offering)).toBe(0);
      expect(await version(ORG, 'resource', f.court)).toBe(0);
    });
    it('the backfill creates rows for owners that already exist, ruled or not (rollback, then apply)', async () => {
      const ruled = await owners();
      await link(ruled);
      await avail.createRule(staff(ORG), { kind: 'offering', id: ruled.offering }, hours, TZ);
      const bare = await owners();
      await runScript(sqlFile('098_availability_versions_rollback.sql'));
      expect(await q("SELECT to_regclass('public.scheduling_availability_versions') AS t")).toEqual([{ t: null }]);
      await runScript(sqlFile('037_availability_versions.sql'));
      for (const f of [ruled, bare]) {
        expect(await version(ORG, 'offering', f.offering)).toBe(0);
        expect(await version(ORG, 'resource', f.court)).toBe(0);
      }
      const missing = await q(`SELECT count(*)::int AS n FROM scheduling_offerings o WHERE NOT EXISTS (SELECT 1 FROM scheduling_availability_versions v WHERE v.organisation_id = o.organisation_id AND v.owner_kind = 'offering' AND v.owner_id = o.id)`);
      expect(missing[0].n).toBe(0);
    });
    it('applying it twice changes nothing (idempotent): same rows, same versions, still 8 triggers, one registry row', async () => {
      const f = await owners();
      await link(f);
      const before = await q('SELECT organisation_id, owner_kind, owner_id, version::text FROM scheduling_availability_versions ORDER BY 1, 2, 3');
      await runScript(sqlFile('037_availability_versions.sql'));
      expect(await q('SELECT organisation_id, owner_kind, owner_id, version::text FROM scheduling_availability_versions ORDER BY 1, 2, 3')).toEqual(before);
      expect((await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname IN ('scheduling_availability_versions_forward','scheduling_offerings_version_row','scheduling_resources_version_row','scheduling_availability_rules_bump_version','scheduling_availability_exceptions_bump_version','scheduling_availability_zones_bump_version','scheduling_offering_resources_bump_version','scheduling_resources_active_bump')`))[0].n).toBe(8);
      expect(await q(`SELECT count(*)::int AS n FROM scheduling_schema_migrations WHERE version = '2c.3.1'`)).toEqual([{ n: 1 }]);
    });
  });

  describe('every change to what decides availability moves the right versions', () => {
    it('a first rule (which pins the zone) moves its owner; editing and removing the rule move it again; the other owner is unmoved', async () => {
      const f = await owners();
      const created = await avail.createRule(staff(ORG), { kind: 'offering', id: f.offering }, hours, TZ);
      expect(created.ok).toBe(true);
      const afterCreate = await version(ORG, 'offering', f.offering);
      expect(afterCreate).toBeGreaterThanOrEqual(1);
      expect(await version(ORG, 'resource', f.court)).toBe(0);
      const id = (created as unknown as { value?: { id: string } }).value?.id ?? (await q('SELECT id FROM scheduling_availability_rules WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering]))[0].id;
      await q('UPDATE scheduling_availability_rules SET end_time = $3 WHERE organisation_id = $1 AND id = $2', [ORG, id, '18:00']);
      const afterEdit = await version(ORG, 'offering', f.offering);
      expect(afterEdit).toBeGreaterThan(afterCreate);
      await q('DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND id = $2', [ORG, id]);
      expect(await version(ORG, 'offering', f.offering)).toBeGreaterThan(afterEdit);
    });
    it('a closure moves its owner', async () => {
      const f = await owners();
      await avail.createRule(staff(ORG), { kind: 'resource', id: f.court }, hours, TZ);
      const before = await version(ORG, 'resource', f.court);
      await q(`INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, offering_id, from_date, to_date, kind) VALUES ($1, $2, $3, NULL, '2026-11-02', '2026-11-02', 'closed')`, [uid('ex'), ORG, f.court]);
      expect(await version(ORG, 'resource', f.court)).toBe(before + 1);
    });
    it('linking and unlinking a resource moves BOTH the offering and the resource', async () => {
      const f = await owners();
      await link(f);
      expect([await version(ORG, 'offering', f.offering), await version(ORG, 'resource', f.court)]).toEqual([1, 1]);
      await q('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court]);
      expect([await version(ORG, 'offering', f.offering), await version(ORG, 'resource', f.court)]).toEqual([2, 2]);
    });
    it('a resource becoming inactive (and active again) moves the resource only', async () => {
      const f = await owners();
      await q('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
      expect([await version(ORG, 'offering', f.offering), await version(ORG, 'resource', f.court)]).toEqual([0, 1]);
      await q('UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
      expect(await version(ORG, 'resource', f.court)).toBe(2);
    });
    it('things that do not decide availability do not move a version: renaming, capacity, a no-op update', async () => {
      const f = await owners();
      await q('UPDATE scheduling_resources SET name = $3, capacity = 7 WHERE organisation_id = $1 AND id = $2', [ORG, f.court, 'Renamed']);
      await q('UPDATE scheduling_resources SET active = active WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
      await q('UPDATE scheduling_offerings SET name = $3 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering, 'Renamed too']);
      expect([await version(ORG, 'offering', f.offering), await version(ORG, 'resource', f.court)]).toEqual([0, 0]);
    });
    it('no edit token moves because of a bump: updated_at of the offering and the resource is unchanged by rules, closures and links', async () => {
      const f = await owners();
      const before = await tokens(ORG, f.offering, f.court);
      await link(f);
      await avail.createRule(staff(ORG), { kind: 'offering', id: f.offering }, hours, TZ);
      await avail.createRule(staff(ORG), { kind: 'resource', id: f.court }, hours, TZ);
      await q(`INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, offering_id, from_date, to_date, kind) VALUES ($1, $2, NULL, $3, '2026-11-02', '2026-11-02', 'closed')`, [uid('ex'), ORG, f.offering]);
      expect(await version(ORG, 'offering', f.offering)).toBeGreaterThanOrEqual(3);
      expect(await tokens(ORG, f.offering, f.court)).toEqual(before);
    });
  });

  describe('the database enforces the rules of the table itself', () => {
    it('a row cannot name another organisation\'s owner (composite foreign key), and organisations never share a row', async () => {
      const mine = await owners(ORG);
      await expect(pool().query('INSERT INTO scheduling_availability_versions (organisation_id, offering_id) VALUES ($1, $2)', [OTHER, mine.offering])).rejects.toMatchObject({ code: '23503' });
      const theirs = await owners(OTHER);
      await link(theirs, OTHER);
      expect(await version(ORG, 'offering', mine.offering)).toBe(0);
      expect(await version(OTHER, 'offering', theirs.offering)).toBe(1);
    });
    it('a row names exactly one owner', async () => {
      const f = await owners();
      await expect(pool().query('INSERT INTO scheduling_availability_versions (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, f.court])).rejects.toMatchObject({ code: '23514' });
      await expect(pool().query('INSERT INTO scheduling_availability_versions (organisation_id) VALUES ($1)', [ORG])).rejects.toMatchObject({ code: '23502' });
    });
    it('a version only moves forward by one: a rewind, a skip and a change of owner are refused (SCIMM)', async () => {
      const f = await owners();
      await link(f);
      for (const set of ['version = version - 1', 'version = version + 2', 'version = 0']) {
        await expect(pool().query(`UPDATE scheduling_availability_versions SET ${set} WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2`, [ORG, f.offering])).rejects.toMatchObject({ code: 'SCIMM' });
      }
      await expect(pool().query(`UPDATE scheduling_availability_versions SET offering_id = $3 WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2`, [ORG, f.offering, 'x'])).rejects.toBeTruthy();
      expect(await version(ORG, 'offering', f.offering)).toBe(1);
    });
    it('deleting an owner removes its row, and the cascade does not resurrect it (bumps only update)', async () => {
      const f = await owners();
      await link(f);
      await avail.createRule(staff(ORG), { kind: 'resource', id: f.court }, hours, TZ);
      await q('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering]);
      // The existing schema does not cascade from a resource to its rules (owners are archived, not deleted): the rules go first, then the owner.
      await q('DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND resource_id = $2', [ORG, f.court]);
      await q('DELETE FROM scheduling_availability_zones WHERE organisation_id = $1 AND resource_id = $2', [ORG, f.court]).catch(() => undefined);
      await q('DELETE FROM scheduling_resources WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
      expect(await q("SELECT 1 FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = $2", [ORG, f.court])).toEqual([]);
      expect(await q('SELECT 1 FROM scheduling_availability_rules WHERE organisation_id = $1 AND resource_id = $2', [ORG, f.court])).toEqual([]);
    });
  });

  describe('lock order: offering, then resource, in writers and readers alike', () => {
    it('60 concurrent link toggles and share-lockers in the documented order finish with no deadlock (40P01)', async () => {
      const f = await owners();
      const workers = makePool(30);
      try {
        const errors: string[] = [];
        const run = async (i: number) => {
          const c = await workers.connect();
          try {
            await c.query('BEGIN');
            if (i % 2 === 0) {
              await c.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [ORG, f.offering, f.court]);
              await c.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court]);
            } else {
              await c.query("SELECT 1 FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2 FOR SHARE", [ORG, f.offering]);
              await c.query("SELECT pg_sleep(0.01), 1 FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = $2 FOR SHARE", [ORG, f.court]);
            }
            await c.query('COMMIT');
          } catch (err) {
            await c.query('ROLLBACK').catch(() => undefined);
            errors.push((err as { code?: string }).code ?? String(err));
          } finally {
            c.release();
          }
        };
        await Promise.all(Array.from({ length: 60 }, (_, i) => run(i)));
        expect(errors.filter(e => e === '40P01')).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await workers.end();
      }
    });
  });

  describe('rollback is independent and complete', () => {
    it('removes the table, the eight triggers and the marker, leaves every other row, and applying again restores it', async () => {
      const f = await owners();
      await link(f);
      await runScript(sqlFile('098_availability_versions_rollback.sql'));
      expect(await q("SELECT to_regclass('public.scheduling_availability_versions') AS t")).toEqual([{ t: null }]);
      expect((await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND (tgname LIKE '%\\_version\\_row' OR tgname LIKE '%\\_bump\\_version' OR tgname = 'scheduling_resources_active_bump')`))[0].n).toBe(0);
      expect(await q(`SELECT 1 FROM scheduling_schema_migrations WHERE version = '2c.3.1'`)).toEqual([]);
      expect((await q('SELECT 1 FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering])).length).toBe(1);
      await runScript(sqlFile('098_availability_versions_rollback.sql')); // idempotent
      await runScript(sqlFile('037_availability_versions.sql'));
      expect(await version(ORG, 'offering', f.offering)).toBe(0);
    });
  });
});
