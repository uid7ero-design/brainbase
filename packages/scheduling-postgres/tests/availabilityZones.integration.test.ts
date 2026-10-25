import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AvailabilityZonesNotReadyError,
  SchedulingError,
  type AvailabilityOwner,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
} from '@scheduling/core';
import { PostgresAvailabilityRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Migration 036 (owner-pinned availability zones, version 2b.3.3) on a real PostgreSQL, run by scripts/tests/verify-scheduling-phase2b3c.sh on
// PostgreSQL 16 and 17. What it proves:
//   1. FIRST-WRITE ATOMICITY: the owner's zone and its first rule / closure are one statement: they commit together or not at all.
//   2. CONCURRENCY: racing first writes cannot establish two zones; a pin of a transaction that rolls back does not stick.
//   3. DATABASE ENFORCEMENT: availability cannot exist without a pin, a pin cannot be changed or removed while its owner exists, tenant isolation
//      is carried by composite foreign keys, no timezone field or version token of another table moves.
//   4. THE MIGRATION: idempotent, needs 034, backfills existing availability with the zone the reader resolves today, rolls back (097) with data and
//      refuses when that would change a meaning, and the create path FAILS CLOSED when it is missing.

const A = 'org-az-a';
const B = 'org-az-b';
const ORG_TZ: Record<string, string | null> = { [A]: 'Australia/Sydney', [B]: null };
const tenantA = staff(A);
const tenantB = staff(B);
const viewerA = staff(A, ['scheduling.view']);
const suite = hasDatabase ? describe : describe.skip;

let repo: PostgresAvailabilityRepository;
const res: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
const res2: AvailabilityOwner = { kind: 'resource', id: 'court-2' };
const off: AvailabilityOwner = { kind: 'offering', id: 'off-1' };
const offPerth: AvailabilityOwner = { kind: 'offering', id: 'off-perth' };

const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
const closure = (over: Partial<NewStoredExceptionInput> = {}): NewStoredExceptionInput => ({ fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null, ...over });
const pins = (owner?: string) => count(`SELECT count(*) FROM scheduling_availability_zones${owner ? ' WHERE owner_id = $1' : ''}`, owner ? [owner] : []);
const rulesIn = (owner: string) => count('SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = $1 OR offering_id = $1', [owner]);
const zoneOf = async (owner: string) => ((await getPool().query('SELECT timezone, source, pinned_by FROM scheduling_availability_zones WHERE owner_id = $1', [owner])).rows[0] ?? null) as { timezone: string; source: string; pinned_by: string | null } | null;
const sqlstate = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};
/** A content hash of the rows of a table (or its whole content), to prove a write left it untouched. */
const hashOf = async (table: string) => (await getPool().query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t`)).rows[0].h as string;
async function runRefusing(script: string): Promise<string | null> {
  const c = await getPool().connect();
  try {
    await c.query(script);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

suite('owner-pinned availability zones on real PostgreSQL (migration 036)', () => {
  beforeAll(async () => {
    await ensureSchema(); // 010, 030, 031, 034 and 036
    await resetData();
    repo = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await resetData();
    await getPool().query('DELETE FROM organisations WHERE id IN ($1, $2)', [A, B]).catch(() => undefined);
    await closePool();
  });
  beforeEach(async () => {
    await resetData();
    for (const org of [A, B]) {
      await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, ORG_TZ[org]]);
    }
    await seedSchedule(A, 'sch-a', 'resource_hire');
    await seedSchedule(A, 'sch-perth', 'resource_hire', { timezone: 'Australia/Perth' });
    await seedSchedule(B, 'sch-b', 'resource_hire');
    await seedResource(A, 'court-1');
    await seedResource(A, 'court-2');
    await seedResource(B, 'court-b');
    await seedOffering(A, 'off-1', 'sch-a');
    await seedOffering(A, 'off-perth', 'sch-perth');
    await seedOffering(B, 'off-b', 'sch-b');
  });

  describe('the first write pins the zone in the same statement', () => {
    it('createRule pins the owner and stores the rule; the second write finds the pin and pins nothing', async () => {
      const first = await repo.createRule(tenantA, res, rule(), 'Australia/Perth');
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.pinned).toMatchObject({ timezone: 'Australia/Perth', source: 'first_rule', pinnedBy: 'user-of-org-az-a' });
      expect(await zoneOf('court-1')).toEqual({ timezone: 'Australia/Perth', source: 'first_rule', pinned_by: 'user-of-org-az-a' });
      const second = await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }), 'Australia/Perth');
      expect(second.ok && second.pinned).toBeNull();
      expect(await pins('court-1')).toBe(1);
      expect(await repo.getZone(tenantA, res)).toMatchObject({ timezone: 'Australia/Perth', source: 'first_rule' });
    });

    it('a writer requesting another zone than the existing pin gets an explicit conflict: no rule, no closure, no new pin, the pin is unchanged', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Adelaide');
      const hashRules = () => getPool().query("SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) h FROM scheduling_availability_rules t").then(r => r.rows[0].h as string);
      const before = await hashRules();
      const later = await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }), 'Australia/Perth');
      expect(later).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await repo.createRules(tenantA, res, [rule({ dayOfWeek: 3 }), rule({ dayOfWeek: 4 })], 'Australia/Perth')).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await repo.createException(tenantA, res, closure(), 'Australia/Perth')).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await hashRules()).toBe(before);
      expect(await count('SELECT count(*) FROM scheduling_availability_exceptions')).toBe(0);
      expect(await pins('court-1')).toBe(1);
      expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Adelaide');
      // the same zone is accepted, and so is a write that names no zone at all (no expectation to break)
      const same = await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }), 'Australia/Adelaide');
      expect(same.ok && same.pinned).toBeNull();
      expect((await repo.createRule(tenantA, res, rule({ dayOfWeek: 3 }))).ok).toBe(true);
    });

    it('the conflict is for the existing pin only: another organisation still gets not_found, and a missing owner is not a zone conflict', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Adelaide');
      expect(await repo.createRule(tenantB, res, rule({ dayOfWeek: 2 }), 'Australia/Perth')).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createRule(tenantA, { kind: 'resource', id: 'no-such' }, rule(), 'Australia/Perth')).toEqual({ ok: false, reason: 'not_found' });
    });

    it('a batch (an overnight window: two rules) pins once; a first closure pins with source first_closure', async () => {
      const batch = await repo.createRules(tenantA, res, [rule({ dayOfWeek: 5, startTime: '22:00', endTime: '24:00' }), rule({ dayOfWeek: 6, startTime: '00:00', endTime: '02:00' })], 'Australia/Perth');
      expect(batch.ok && batch.pinned?.source).toBe('first_rule');
      expect(await pins('court-1')).toBe(1);
      const c = await repo.createException(tenantA, res2, closure(), 'Australia/Darwin');
      expect(c.ok && c.pinned).toMatchObject({ timezone: 'Australia/Darwin', source: 'first_closure' });
    });

    it('the zone defaults to the tenant\'s own timezone only when the caller names none; it is never taken from anywhere else', async () => {
      const r = await repo.createRule(tenantA, res, rule());
      expect(r.ok && r.pinned?.timezone).toBe('Australia/Adelaide'); // the harness tenant's timezone
    });

    it('an invalid zone is refused before the database, and nothing is written', async () => {
      await expect(repo.createRule(tenantA, res, rule(), 'Not/AZone')).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRules(tenantA, res, [rule()], 'Not/AZone')).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createException(tenantA, res, closure(), '')).rejects.toBeInstanceOf(SchedulingError);
      expect(await pins()).toBe(0);
      expect(await rulesIn('court-1')).toBe(0);
    });

    it('a REFUSED first write leaves no pin behind: overlap inside the batch, archived offering, inactive resource', async () => {
      expect(await repo.createRules(tenantA, res, [rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '11:00', endTime: '13:00' })], 'Australia/Perth')).toEqual({ ok: false, reason: 'overlap' });
      await getPool().query("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'off-1'");
      expect(await repo.createRule(tenantA, off, rule(), 'Australia/Perth')).toEqual({ ok: false, reason: 'owner_archived' });
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-2'");
      expect(await repo.createException(tenantA, res2, closure(), 'Australia/Perth')).toEqual({ ok: false, reason: 'owner_inactive' });
      expect(await pins()).toBe(0);
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
    });

    it('another organisation\'s owner, or one that does not exist, pins nothing and stores nothing (not_found)', async () => {
      expect(await repo.createRule(tenantA, { kind: 'resource', id: 'court-b' }, rule(), 'Australia/Perth')).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createRules(tenantA, { kind: 'offering', id: 'nope' }, [rule()], 'Australia/Perth')).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createException(tenantB, res, closure(), 'Australia/Perth')).toEqual({ ok: false, reason: 'not_found' });
      expect(await pins()).toBe(0);
    });

    it('a viewer cannot write, and so cannot pin', async () => {
      await expect(repo.createRule(viewerA, res, rule(), 'Australia/Perth')).rejects.toBeInstanceOf(SchedulingError);
      expect(await pins()).toBe(0);
    });
  });

  describe('concurrent first writes cannot establish inconsistent zones', () => {
    it('12 simultaneous first writes naming 12 different zones: exactly ONE succeeds and pins; the other 11 get zone_mismatch naming the winner zone and write nothing', async () => {
      const zones = ['Australia/Perth', 'Australia/Sydney', 'Australia/Darwin', 'Europe/London', 'America/New_York', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/Berlin', 'America/Chicago', 'Africa/Cairo', 'Australia/Lord_Howe'];
      const results = await Promise.all(zones.map((z, i) => repo.createRule(tenantA, res, rule({ dayOfWeek: i % 7, startTime: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, endTime: `${String(9 + Math.floor(i / 7)).padStart(2, '0')}:00` }), z)));
      expect(await pins('court-1')).toBe(1);
      const stored = (await zoneOf('court-1'))!.timezone;
      expect(zones).toContain(stored);
      const ok = results.filter(r => r.ok);
      expect(ok).toHaveLength(1);
      expect(ok[0].ok && ok[0].pinned?.timezone).toBe(stored);
      const refused = results.filter(r => !r.ok);
      expect(refused).toHaveLength(11);
      expect(refused.every(r => !r.ok && r.reason === 'zone_mismatch' && r.detail === stored)).toBe(true);
      expect(await rulesIn('court-1')).toBe(1); // nothing was saved under a zone the writer did not ask for
      expect((await repo.getZone(tenantA, res))?.timezone).toBe(stored);
    });

    it('12 simultaneous first writes all naming the SAME zone: all succeed (different days), one pin, one reports it', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.createRule(tenantA, res, rule({ dayOfWeek: i % 7, startTime: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, endTime: `${String(9 + Math.floor(i / 7)).padStart(2, '0')}:00` }), 'Australia/Perth')));
      expect(results.every(r => r.ok)).toBe(true);
      expect(results.filter(r => r.ok && r.pinned)).toHaveLength(1);
      expect(await pins('court-1')).toBe(1);
      expect(await rulesIn('court-1')).toBe(12);
    });

    it('a first rule racing a first closure for one owner, naming different zones: one pin, one succeeds, the other is a zone conflict', async () => {
      for (let round = 0; round < 8; round++) {
        await resetData();
        await seedSchedule(A, 'sch-a', 'resource_hire');
        await seedResource(A, 'court-1');
        const [r, c] = await Promise.all([repo.createRule(tenantA, res, rule(), 'Australia/Perth'), repo.createException(tenantA, res, closure(), 'Europe/London')]);
        expect(await pins('court-1')).toBe(1);
        expect([r.ok, c.ok].filter(Boolean)).toHaveLength(1);
        const loser = r.ok ? c : r;
        expect(!loser.ok && loser.reason).toBe('zone_mismatch');
        expect((await rulesIn('court-1')) + (await count('SELECT count(*) FROM scheduling_availability_exceptions'))).toBe(1);
      }
    });

    it('a first rule racing a first closure naming the SAME zone: both succeed, one pin', async () => {
      for (let round = 0; round < 40; round++) {
        await resetData();
        await seedSchedule(A, 'sch-a', 'resource_hire');
        await seedResource(A, 'court-1');
        const [r, c] = await Promise.all([repo.createRule(tenantA, res, rule(), 'Australia/Perth'), repo.createException(tenantA, res, closure(), 'Australia/Perth')]);
        expect(r.ok && c.ok).toBe(true);
        expect(await pins('court-1')).toBe(1);
        expect([r, c].filter(x => x.ok && x.pinned)).toHaveLength(1);
      }
    });

    it('racing identical windows with two zones: one commits; same-zone losers are overlap, other-zone losers are zone_mismatch; one pin, one rule', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.createRule(tenantA, res, rule({ startTime: '09:00', endTime: '17:00' }), i % 2 === 0 ? 'Australia/Perth' : 'Europe/London')));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      const stored = (await zoneOf('court-1'))!.timezone;
      expect(results.filter(r => !r.ok).every(r => !r.ok && (r.reason === 'overlap' || r.reason === 'zone_mismatch'))).toBe(true);
      expect(results.filter(r => !r.ok && r.reason === 'zone_mismatch').every(r => !r.ok && r.detail === stored)).toBe(true);
      expect(results.filter(r => !r.ok && r.reason === 'zone_mismatch')).toHaveLength(5);
      expect(await pins('court-1')).toBe(1);
      expect(await rulesIn('court-1')).toBe(1);
    });

    it('owners are independent: 20 owners written at once get 20 pins', async () => {
      for (let i = 0; i < 20; i++) await seedResource(A, `r-${i}`);
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createRule(tenantA, { kind: 'resource', id: `r-${i}` }, rule(), i % 2 === 0 ? 'Australia/Perth' : 'Australia/Darwin')));
      expect(results.every(r => r.ok && r.pinned)).toBe(true);
      expect(await pins()).toBe(20);
    });

    it('a pin written by a transaction that ROLLS BACK does not stick: the waiting writer pins its own zone', async () => {
      const c = await getPool().connect();
      try {
        await c.query('BEGIN');
        await c.query("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ($1, 'court-1', 'Europe/London', 'first_rule')", [A]);
        const waiting = repo.createRule(tenantA, res, rule(), 'Australia/Perth'); // blocks on the uncommitted pin of the same owner
        const state = await Promise.race([waiting.then(() => 'done'), new Promise(r => setTimeout(() => r('waiting'), 500))]);
        expect(state).toBe('waiting');
        await c.query('ROLLBACK');
        const r = await waiting;
        expect(r.ok && r.pinned?.timezone).toBe('Australia/Perth');
        expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Perth');
      } finally {
        c.release();
      }
    });

    it('a pin written by a transaction that COMMITS wins: a waiting writer that asked for ANOTHER zone gets zone_mismatch and stores nothing; one that asked for the same zone is stored', async () => {
      for (const [requested, expectOk] of [['Australia/Perth', false], ['Europe/London', true]] as const) {
        await resetData();
        await seedSchedule(A, 'sch-a', 'resource_hire');
        await seedResource(A, 'court-1');
        const c = await getPool().connect();
        try {
          await c.query('BEGIN');
          await c.query("INSERT INTO scheduling_availability_zones (organisation_id, resource_id, timezone, source) VALUES ($1, 'court-1', 'Europe/London', 'first_rule')", [A]);
          const waiting = repo.createRule(tenantA, res, rule(), requested);
          await new Promise(r => setTimeout(r, 300));
          await c.query('COMMIT');
          const r = await waiting;
          if (expectOk) expect(r.ok && r.pinned).toBeNull();
          else expect(r).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Europe/London' });
          expect((await zoneOf('court-1'))?.timezone).toBe('Europe/London');
          expect(await rulesIn('court-1')).toBe(expectOk ? 1 : 0);
        } finally {
          c.release();
        }
      }
    });
  });

  describe('the database enforces it, for every writer', () => {
    it('availability cannot be inserted without a pin (SCZON), rules and closures alike', async () => {
      expect(await sqlstate(getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('x1', $1, 'court-1', 1, '09:00', '10:00')", [A]))).toBe('SCZON');
      expect(await sqlstate(getPool().query("INSERT INTO scheduling_availability_exceptions (id, organisation_id, offering_id, from_date, to_date, kind) VALUES ('x2', $1, 'off-1', '2027-01-01', '2027-01-01', 'closed')", [A]))).toBe('SCZON');
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
    });

    it('a missing or other-organisation owner is still reported by the foreign key, as before', async () => {
      expect(await sqlstate(getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('x1', $1, 'court-b', 1, '09:00', '10:00')", [A]))).toBe('23503');
      expect(await sqlstate(getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, day_of_week, start_time, end_time) VALUES ('x1', $1, 1, '09:00', '10:00')", [A]))).toBe('23514'); // owner CHECK
    });

    it('a pin cannot be updated (zone, owner or organisation) or deleted while its owner exists', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Perth');
      for (const sql of [
        "UPDATE scheduling_availability_zones SET timezone = 'Europe/London'",

        "UPDATE scheduling_availability_zones SET resource_id = 'court-2'",
        "UPDATE scheduling_availability_zones SET organisation_id = 'org-az-b'",
        "UPDATE scheduling_availability_zones SET pinned_by = 'someone'",
        'DELETE FROM scheduling_availability_zones',
      ]) expect([sql, await sqlstate(getPool().query(sql))]).toEqual([sql, 'SCZON']);
      expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Perth');
      // an UPDATE that changes nothing is the one thing allowed: it is how a write reads the pin it conflicts with (ON CONFLICT DO UPDATE SET timezone = timezone)
      const before = (await getPool().query("SELECT pinned_at::text p, timezone t, source s, pinned_by b FROM scheduling_availability_zones")).rows;
      expect(await sqlstate(getPool().query('UPDATE scheduling_availability_zones SET timezone = timezone'))).toBeNull();
      expect((await getPool().query("SELECT pinned_at::text p, timezone t, source s, pinned_by b FROM scheduling_availability_zones")).rows).toEqual(before);
    });

    it('a pin goes with its owner: deleting a resource that has only a pin removes the pin', async () => {
      await repo.createException(tenantA, res2, closure(), 'Australia/Perth');
      await getPool().query("DELETE FROM scheduling_availability_exceptions WHERE resource_id = 'court-2'"); // deleting availability is always allowed; the pin stays
      expect(await pins('court-2')).toBe(1);
      expect(await sqlstate(getPool().query("DELETE FROM scheduling_resources WHERE id = 'court-2' AND organisation_id = $1", [A]))).toBeNull();
      expect(await pins('court-2')).toBe(0);
    });

    it('removing every rule does not remove the pin: the zone stays decided', async () => {
      const made = await repo.createRule(tenantA, res, rule(), 'Australia/Perth');
      if (!made.ok) throw new Error('setup');
      await repo.deleteRule(tenantA, made.value.id, made.value.updatedAt);
      expect(await rulesIn('court-1')).toBe(0);
      expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Perth');
      const again = await repo.createRule(tenantA, res, rule(), 'Europe/London');
      expect(again).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Perth' });
      expect((await repo.getZone(tenantA, res))?.timezone).toBe('Australia/Perth');
    });

    it('a pin must name a valid IANA zone, exactly one owner, a source, and an owner of the SAME organisation', async () => {
      const ins = (cols: string, vals: string, params: unknown[] = []) => sqlstate(getPool().query(`INSERT INTO scheduling_availability_zones (${cols}) VALUES (${vals})`, params));
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-1', 'Not/AZone', 'first_rule'", [A])).toBe('23514');
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-1', 'UTC+10', 'first_rule'", [A])).toBe('23514');
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-1', 'Australia/Perth', 'guess'", [A])).toBe('23514');
      expect(await ins('organisation_id, resource_id, offering_id, timezone, source', "$1, 'court-1', 'off-1', 'Australia/Perth', 'first_rule'", [A])).toBe('23514');
      expect(await ins('organisation_id, timezone, source', "$1, 'Australia/Perth', 'first_rule'", [A])).toBe('23502'); // no owner: the generated owner key is NULL
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-b', 'Australia/Perth', 'first_rule'", [A])).toBe('23503'); // B's resource under A
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-1', 'Australia/Perth', 'first_rule'", [A])).toBeNull();
      expect(await ins('organisation_id, resource_id, timezone, source', "$1, 'court-1', 'Europe/London', 'first_rule'", [A])).toBe('23505'); // one pin per owner
    });

    it('tenant isolation: another organisation reads no pin, and cannot pin or write for this organisation\'s owner', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Perth');
      expect(await repo.getZone(tenantB, res)).toBeNull();
      expect(await repo.createRule(tenantB, res, rule({ dayOfWeek: 3 }), 'Europe/London')).toEqual({ ok: false, reason: 'not_found' });
      expect(await count("SELECT count(*) FROM scheduling_availability_zones WHERE organisation_id = $1", [B])).toBe(0);
      expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Perth');
    });
  });

  describe('establishing a pin touches nothing else', () => {
    it('no row of organisations, schedules, offerings or resources changes, so no timezone field and no version token moves', async () => {
      const tables = ['organisations', 'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_settings', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences'];
      const before = await Promise.all(tables.map(hashOf));
      await repo.createRule(tenantA, res, rule(), 'Australia/Perth');
      await repo.createRules(tenantA, off, [rule({ dayOfWeek: 3 }), rule({ dayOfWeek: 4 })], 'Australia/Sydney');
      await repo.createException(tenantA, offPerth, closure(), 'Australia/Perth');
      expect(await Promise.all(tables.map(hashOf))).toEqual(before);
      expect(await pins()).toBe(3);
    });

    it('changing the organisation\'s timezone or a schedule\'s timezone later does not change a pin, and the pinned zone is what getZone reports', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Sydney');
      await repo.createRule(tenantA, offPerth, rule(), 'Australia/Perth');
      await getPool().query("UPDATE organisations SET timezone = 'Europe/London' WHERE id = $1", [A]);
      await getPool().query("UPDATE scheduling_schedules SET timezone = 'Asia/Tokyo' WHERE id = 'sch-perth'");
      await getPool().query("UPDATE scheduling_schedules SET timezone = NULL WHERE id = 'sch-perth'");
      expect((await repo.getZone(tenantA, res))?.timezone).toBe('Australia/Sydney');
      expect((await repo.getZone(tenantA, offPerth))?.timezone).toBe('Australia/Perth');
      expect(await rulesIn('court-1')).toBe(1); // the rules themselves were not rewritten
    });
  });

  describe('a shared resource and several schedules', () => {
    it('a resource has ONE pinned zone whichever offering (schedule) writes or reads it; two offerings of different schedules keep their own', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Sydney'); // the resource
      await repo.createRule(tenantA, off, rule(), 'Australia/Sydney'); // an offering of a schedule with no override
      await repo.createRule(tenantA, offPerth, rule(), 'Australia/Perth'); // an offering of the Perth schedule
      await getPool().query("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, 'off-1', 'court-1'), ($1, 'off-perth', 'court-1')", [A]).catch(() => undefined);
      expect((await repo.getZone(tenantA, res))?.timezone).toBe('Australia/Sydney');
      expect((await repo.getZone(tenantA, off))?.timezone).toBe('Australia/Sydney');
      expect((await repo.getZone(tenantA, offPerth))?.timezone).toBe('Australia/Perth');
      // writing the shared resource again "from the Perth side" is a conflict: the resource is Sydney's, and nothing is saved
      const again = await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }), 'Australia/Perth');
      expect(again).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Sydney' });
      expect((await repo.getZone(tenantA, res))?.timezone).toBe('Australia/Sydney');
    });
  });

  describe('the legacy configuration repository pins too', () => {
    it('addAvailabilityRule / addAvailabilityException pin the tenant zone with the row, and a missing owner is still a foreign-key refusal', async () => {
      const config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
      await config.addAvailabilityRule(tenantA, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '08:00', endTime: '20:00', validFrom: null, validTo: null, kind: 'hours', label: null });
      expect(await zoneOf('court-1')).toMatchObject({ timezone: 'Australia/Adelaide', source: 'first_rule' });
      await config.addAvailabilityException(tenantA, 'offering', 'off-1', { resourceId: null, offeringId: 'off-1', fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null });
      expect(await zoneOf('off-1')).toMatchObject({ source: 'first_closure' });
      await expect(config.addAvailabilityRule(tenantB, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', validFrom: null, validTo: null, kind: 'hours', label: null })).rejects.toMatchObject({ code: 'not_found' });
      expect(await pins()).toBe(2);
    });
  });

  describe('the migration', () => {
    const marker = async () => count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.3'");
    const fingerprint = async () =>
      (await getPool().query(`SELECT
         (SELECT md5(string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, column_name)) FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'scheduling\\_%') AS schema_fp,
         (SELECT md5(string_agg(p.proname || md5(replace(p.prosrc, chr(13), '')), ',' ORDER BY p.proname)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'scheduling\\_%') AS fn_fp,
         (SELECT md5(string_agg(tgname || tgenabled::text, ',' ORDER BY tgname)) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'scheduling\\_%') AS trg_fp`)).rows[0] as { schema_fp: string; fn_fp: string; trg_fp: string };

    it('is idempotent: applying it again changes no object, function body, trigger or marker', async () => {
      const before = await fingerprint();
      await runScript(sqlFile('036_availability_zones.sql'));
      await runScript(sqlFile('036_availability_zones.sql'));
      expect(await fingerprint()).toEqual(before);
      expect(await marker()).toBe(1);
    });

    it('creates exactly the table, the three triggers, the two functions and the marker; it needs 034 first', async () => {
      expect((await getPool().query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%_zone%' OR tgname = 'scheduling_availability_zones_immutable' ORDER BY 1")).rows.map(r => r.tgname)).toEqual([
        'scheduling_availability_exceptions_zone', 'scheduling_availability_rules_zone', 'scheduling_availability_zones_immutable',
      ]);
      expect((await getPool().query("SELECT proname FROM pg_proc WHERE proname LIKE 'scheduling_availability_zone%' ORDER BY 1")).rows.map(r => r.proname)).toEqual(['scheduling_availability_zone_guard', 'scheduling_availability_zone_required']);
      const keep = (await getPool().query("SELECT version, description FROM scheduling_schema_migrations WHERE version = '2b.3.1'")).rows[0];
      await getPool().query("DELETE FROM scheduling_schema_migrations WHERE version = '2b.3.1'");
      try {
        expect(await runRefusing(sqlFile('036_availability_zones.sql'))).toBe('SCVER');
      } finally {
        await getPool().query('INSERT INTO scheduling_schema_migrations (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING', [keep.version, keep.description]);
      }
    });

    it('BACKFILL: availability that predates pinning keeps the meaning the reader gives it today (schedule override, else organisation, else fallback); rows are untouched', async () => {
      await runScript(sqlFile('097_availability_zones_rollback.sql')); // back to 034 only
      await seedOffering(B, 'off-b2', 'sch-b');
      const insertRule = (id: string, org: string, owner: 'resource_id' | 'offering_id', ownerId: string) =>
        getPool().query(`INSERT INTO scheduling_availability_rules (id, organisation_id, ${owner}, day_of_week, start_time, end_time) VALUES ($1, $2, $3, 1, '09:00', '10:00')`, [id, org, ownerId]);
      await insertRule('b1', A, 'resource_id', 'court-1'); //     resource of org A (Sydney)               -> Sydney
      await insertRule('b2', A, 'offering_id', 'off-1'); //       schedule without override, org Sydney     -> Sydney
      await insertRule('b3', A, 'offering_id', 'off-perth'); //   schedule override Perth                   -> Perth
      await insertRule('b4', B, 'resource_id', 'court-b'); //     org B has no timezone                    -> the platform fallback
      await getPool().query("INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, from_date, to_date, kind) VALUES ('e1', $1, 'court-2', '2027-01-01', '2027-01-01', 'closed')", [A]); // closure only -> Sydney
      const rulesBefore = await hashOf('scheduling_availability_rules');
      await runScript(sqlFile('036_availability_zones.sql'));
      const pinned = Object.fromEntries((await getPool().query('SELECT owner_id, timezone, source, pinned_by FROM scheduling_availability_zones')).rows.map(r => [r.owner_id, [r.timezone, r.source, r.pinned_by]]));
      expect(pinned).toEqual({
        'court-1': ['Australia/Sydney', 'backfill', null],
        'off-1': ['Australia/Sydney', 'backfill', null],
        'off-perth': ['Australia/Perth', 'backfill', null],
        'court-b': ['Australia/Adelaide', 'backfill', null],
        'court-2': ['Australia/Sydney', 'backfill', null],
      });
      expect(await hashOf('scheduling_availability_rules')).toBe(rulesBefore);
      expect(await marker()).toBe(1);
      // owners with no availability are not pinned
      expect(await pins('off-b')).toBe(0);
    });

    it('BACKFILL refuses (SCVER, nothing changed) when availability exists and there is no organisations.timezone to resolve it from', async () => {
      await runScript(sqlFile('097_availability_zones_rollback.sql'));
      await getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('b1', $1, 'court-1', 1, '09:00', '10:00')", [A]);
      await getPool().query('ALTER TABLE organisations RENAME TO organisations_hidden');
      try {
        expect(await runRefusing(sqlFile('036_availability_zones.sql'))).toBe('SCVER');
        expect(await getPool().query("SELECT to_regclass('scheduling_availability_zones') AS t").then(r => r.rows[0].t)).toBeNull();
        expect(await marker()).toBe(0);
      } finally {
        await getPool().query('ALTER TABLE organisations_hidden RENAME TO organisations');
        await getPool().query("DELETE FROM scheduling_availability_rules WHERE id = 'b1'");
        await runScript(sqlFile('036_availability_zones.sql'));
      }
    });

    it('with no availability at all (Production) the migration pins nothing', async () => {
      await runScript(sqlFile('097_availability_zones_rollback.sql'));
      await runScript(sqlFile('036_availability_zones.sql'));
      expect(await pins()).toBe(0);
    });

    it('ROLLBACK 097 with data present: rules, closures and every other table are kept; the schema returns to what it was before 036; reapplying gives the same objects', async () => {
      const baseline = async () => {
        await runScript(sqlFile('097_availability_zones_rollback.sql'));
        return fingerprint();
      };
      const clean = await baseline(); // 034 only
      await runScript(sqlFile('036_availability_zones.sql'));
      const withZones = await fingerprint();
      expect(withZones).not.toEqual(clean);
      await repo.createRule(tenantA, res, rule(), 'Australia/Sydney'); // chain for resource of org A = Sydney = the pin
      await repo.createRule(tenantA, offPerth, rule(), 'Australia/Perth'); // chain = schedule override Perth = the pin
      await repo.createException(tenantA, res2, closure(), 'Australia/Sydney');
      const kept = await Promise.all(['scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_schedules', 'scheduling_resources', 'scheduling_offerings', 'organisations'].map(hashOf));
      await runScript(sqlFile('097_availability_zones_rollback.sql'));
      expect(await fingerprint()).toEqual(clean);
      expect(await marker()).toBe(0);
      expect(await Promise.all(['scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_schedules', 'scheduling_resources', 'scheduling_offerings', 'organisations'].map(hashOf))).toEqual(kept);
      await runScript(sqlFile('097_availability_zones_rollback.sql')); // idempotent
      expect(await fingerprint()).toEqual(clean);
      // reapplication: the pins are rebuilt by the backfill with the same zones the reader resolves
      await runScript(sqlFile('036_availability_zones.sql'));
      expect(await fingerprint()).toEqual(withZones);
      expect((await zoneOf('court-1'))?.timezone).toBe('Australia/Sydney');
      expect((await zoneOf('off-perth'))?.timezone).toBe('Australia/Perth');
    });

    it('ROLLBACK refuses (SCVER, nothing changed) while an owner WITH availability is pinned to a zone the reader would not resolve; pins of owners with none are dropped', async () => {
      await repo.createRule(tenantA, res, rule(), 'Australia/Perth'); // the reader would say Sydney (the organisation's): a change of meaning
      await repo.createException(tenantA, res2, closure(), 'Australia/Perth');
      await getPool().query("DELETE FROM scheduling_availability_exceptions WHERE resource_id = 'court-2'"); // court-2 keeps a pin but has no availability
      const before = await fingerprint();
      expect(await runRefusing(sqlFile('097_availability_zones_rollback.sql'))).toBe('SCVER');
      expect(await fingerprint()).toEqual(before);
      expect(await pins()).toBe(2);
      // once the pin and the chain agree, the rollback is allowed
      await getPool().query("UPDATE organisations SET timezone = 'Australia/Perth' WHERE id = $1", [A]);
      expect(await runRefusing(sqlFile('097_availability_zones_rollback.sql'))).toBeNull();
      await runScript(sqlFile('036_availability_zones.sql'));
    });

    it('FAILS CLOSED when 036 is missing: every create answers AvailabilityZonesNotReadyError and writes nothing; reads and removals still work; 036 restores it', async () => {
      const made = await repo.createRule(tenantA, res, rule(), 'Australia/Sydney');
      if (!made.ok) throw new Error('setup');
      await runScript(sqlFile('097_availability_zones_rollback.sql'));
      try {
        const before = await Promise.all(['scheduling_availability_rules', 'scheduling_availability_exceptions'].map(hashOf));
        await expect(repo.createRule(tenantA, res, rule({ dayOfWeek: 3 }), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        await expect(repo.createRules(tenantA, res, [rule({ dayOfWeek: 4 }), rule({ dayOfWeek: 5 })], 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        await expect(repo.createException(tenantA, res, closure(), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        await expect(repo.createRule(tenantA, res2, rule(), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        expect(await Promise.all(['scheduling_availability_rules', 'scheduling_availability_exceptions'].map(hashOf))).toEqual(before);
        await expect(repo.capabilities(tenantA)).resolves.toMatchObject({ zones: false });
        expect(await repo.getZone(tenantA, res)).toBeNull();
        expect(await repo.listRules(tenantA, res)).toHaveLength(1); // reading still works
        expect((await repo.deleteRule(tenantA, made.value.id, made.value.updatedAt)).ok).toBe(true); // so does removing
      } finally {
        await runScript(sqlFile('036_availability_zones.sql'));
      }
      await expect(repo.capabilities(tenantA)).resolves.toMatchObject({ zones: true });
      const again = await repo.createRule(tenantA, res, rule(), 'Australia/Sydney');
      expect(again.ok && again.pinned?.timezone).toBe('Australia/Sydney');
    });

    it('the legacy configuration repository fails closed the same way', async () => {
      const config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
      await runScript(sqlFile('097_availability_zones_rollback.sql'));
      try {
        await expect(config.addAvailabilityRule(tenantA, 'resource', 'court-1', { resourceId: 'court-1', offeringId: null, dayOfWeek: 1, startTime: '08:00', endTime: '20:00', validFrom: null, validTo: null, kind: 'hours', label: null })).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
      } finally {
        await runScript(sqlFile('036_availability_zones.sql'));
      }
    });
  });
});
