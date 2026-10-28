import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AvailabilityNotReadyError,
  SchedulingError,
  validateAvailabilityExceptionSet,
  validateAvailabilityRuleSet,
  type AvailabilityOwner,
  type NewStoredRuleInput,
  type StoredAvailabilityRule,
} from '@scheduling/core';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, count, customerActor, ensureSchema, getPool, hasDatabase, publicActor, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Phase 2B.3b: the availability repository and migration 034's guards on a real PostgreSQL (run by
// scripts/tests/verify-scheduling-phase2b3b.sh against a DISPOSABLE database, on PostgreSQL 16 and 17).
// Covers: the version token, overlap refusal (sequential AND concurrent), archived offerings and inactive resources, tenant isolation,
// the database as the authority behind the API (raw SQL is refused too), parity with the core validators, and fail-closed behaviour
// when the migration is not applied.

const A = 'org-av-a';
const B = 'org-av-b';
const tenantA = staff(A);
const tenantB = staff(B);
const suite = hasDatabase ? describe : describe.skip;

let repo: PostgresAvailabilityRepository;
const res: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
const off: AvailabilityOwner = { kind: 'offering', id: 'off-1' };

const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', validFrom: null, validTo: null, ...over });
const created = async (owner: AvailabilityOwner, over: Partial<NewStoredRuleInput> = {}, tenant = tenantA): Promise<StoredAvailabilityRule> => {
  const r = await repo.createRule(tenant, owner, rule(over));
  if (!r.ok) throw new Error(`expected a rule, got ${r.reason}`);
  return r.value;
};
const sqlstate = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};
const hash = async (table: string) => (await getPool().query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t`)).rows[0].h as string;

suite('availability repository and migration 034 on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema();
    repo = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await closePool();
  });
  beforeEach(async () => {
    await resetData();
    for (const org of [A, B]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at) VALUES ($1, $1, $1, now()) ON CONFLICT (id) DO NOTHING', [org]);
    await seedSchedule(A, 'sch-a', 'resource_hire');
    await seedSchedule(B, 'sch-b', 'resource_hire');
    await seedResource(A, 'court-1');
    await seedResource(A, 'court-2');
    await seedResource(B, 'court-b');
    await seedOffering(A, 'off-1', 'sch-a');
    await seedOffering(B, 'off-b', 'sch-b');
  });

  describe('storage and version token', () => {
    it('round-trips 24:00, orders rules, and returns a microsecond version token', async () => {
      await created(res, { dayOfWeek: 2, startTime: '13:00', endTime: '24:00' });
      await created(res, { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', label: 'Morning' });
      const rules = await repo.listRules(tenantA, res);
      expect(rules.map(r => [r.dayOfWeek, r.startTime, r.endTime])).toEqual([[1, '09:00', '12:00'], [2, '13:00', '24:00']]);
      expect(rules[0].label).toBe('Morning');
      for (const r of rules) {
        expect(r.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
        expect(r.resourceId).toBe('court-1');
        expect(r.offeringId).toBeNull();
        expect((r as unknown as Record<string, unknown>).organisationId).toBeUndefined();
      }
    });

    it('an edit needs the current version and changes it; the old version is then stale', async () => {
      const r0 = await created(res);
      const edited = await repo.updateRule(tenantA, r0.id, r0.updatedAt, { endTime: '13:00', label: 'Late morning' });
      expect(edited.ok).toBe(true);
      if (!edited.ok) return;
      expect(edited.value).toMatchObject({ endTime: '13:00', label: 'Late morning' });
      expect(edited.value.updatedAt > r0.updatedAt).toBe(true);
      const stale = await repo.updateRule(tenantA, r0.id, r0.updatedAt, { endTime: '14:00' });
      expect(stale).toEqual({ ok: false, reason: 'stale_write' });
      expect((await repo.getRule(tenantA, r0.id))?.endTime).toBe('13:00');
    });

    it('a stale or unknown delete removes nothing; the current version removes the rule', async () => {
      const r0 = await created(res);
      await repo.updateRule(tenantA, r0.id, r0.updatedAt, { label: 'x' });
      expect(await repo.deleteRule(tenantA, r0.id, r0.updatedAt)).toEqual({ ok: false, reason: 'stale_write' });
      expect(await repo.deleteRule(tenantA, 'no-such-rule', r0.updatedAt)).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.listRules(tenantA, res)).toHaveLength(1);
      const current = (await repo.getRule(tenantA, r0.id))!;
      expect(await repo.deleteRule(tenantA, r0.id, current.updatedAt)).toEqual({ ok: true, value: { id: r0.id } });
      expect(await repo.listRules(tenantA, res)).toEqual([]);
    });

    it('closures have the same version behaviour', async () => {
      const c = await repo.createException(tenantA, res, { fromDate: '2026-12-25', toDate: '2026-12-26', kind: 'closed', reason: 'Christmas' });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      const u = await repo.updateException(tenantA, c.value.id, c.value.updatedAt, { toDate: '2026-12-27' });
      expect(u.ok && u.value.toDate).toBe('2026-12-27');
      expect(await repo.updateException(tenantA, c.value.id, c.value.updatedAt, { reason: 'stale' })).toEqual({ ok: false, reason: 'stale_write' });
      expect(await repo.deleteException(tenantA, c.value.id, c.value.updatedAt)).toEqual({ ok: false, reason: 'stale_write' });
      const now = (await repo.getException(tenantA, c.value.id))!;
      expect(await repo.deleteException(tenantA, c.value.id, now.updatedAt)).toEqual({ ok: true, value: { id: c.value.id } });
    });

    it('an override cannot be stored yet (no column for its hours), and a rule needs valid fields', async () => {
      await expect(repo.createException(tenantA, res, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'override', reason: null })).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRule(tenantA, res, rule({ startTime: '12:00', endTime: '09:00' }))).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRule(tenantA, res, rule({ dayOfWeek: 7 }))).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRule(tenantA, res, rule({ endTime: '25:00' as never }))).rejects.toBeInstanceOf(SchedulingError);
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
    });
  });

  describe('overlap', () => {
    it('refuses an overlapping rule of the same owner and weekday, allows touching, other weekdays and other owners', async () => {
      await created(res, { startTime: '09:00', endTime: '12:00' });
      expect(await repo.createRule(tenantA, res, rule({ startTime: '11:59', endTime: '13:00' }))).toEqual({ ok: false, reason: 'overlap' });
      expect(await repo.createRule(tenantA, res, rule({ startTime: '08:00', endTime: '10:00' }))).toEqual({ ok: false, reason: 'overlap' });
      expect(await repo.createRule(tenantA, res, rule({ startTime: '09:30', endTime: '10:00' }))).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.createRule(tenantA, res, rule({ startTime: '12:00', endTime: '17:00' }))).ok).toBe(true); // touching
      expect((await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }))).ok).toBe(true);
      expect((await repo.createRule(tenantA, { kind: 'resource', id: 'court-2' }, rule())).ok).toBe(true);
      expect((await repo.createRule(tenantA, off, rule())).ok).toBe(true); // an offering and a resource may have the same hours: "both" is an intersection
      expect(await count("SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = 'court-1'")).toBe(3);
    });

    it('validity dates: overlapping windows with disjoint validity do not overlap', async () => {
      await created(res, { validFrom: '2026-01-01', validTo: '2026-06-30' });
      expect((await repo.createRule(tenantA, res, rule({ validFrom: '2026-07-01', validTo: null }))).ok).toBe(true);
      expect(await repo.createRule(tenantA, res, rule({ validFrom: '2026-06-30', validTo: '2026-07-31' }))).toEqual({ ok: false, reason: 'overlap' });
    });

    it('24:00 counts as the end of the day for overlap', async () => {
      await created(res, { startTime: '22:00', endTime: '24:00' });
      expect(await repo.createRule(tenantA, res, rule({ startTime: '23:30', endTime: '24:00' }))).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.createRule(tenantA, res, rule({ dayOfWeek: 2, startTime: '00:00', endTime: '02:00' }))).ok).toBe(true); // the overnight second half
    });

    it('an edit into an overlap is refused; an edit of a rule against itself is not an overlap', async () => {
      const a = await created(res, { startTime: '09:00', endTime: '12:00' });
      const b = await created(res, { startTime: '13:00', endTime: '15:00' });
      expect(await repo.updateRule(tenantA, b.id, b.updatedAt, { startTime: '11:00' })).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.getRule(tenantA, b.id))?.startTime).toBe('13:00');
      expect((await repo.updateRule(tenantA, a.id, a.updatedAt, { endTime: '12:30' })).ok).toBe(true);
    });

    it('closures: same-kind overlap is refused per owner, other owners are independent, touching dates still overlap (inclusive)', async () => {
      expect((await repo.createException(tenantA, res, { fromDate: '2026-12-24', toDate: '2026-12-26', kind: 'closed', reason: null })).ok).toBe(true);
      expect(await repo.createException(tenantA, res, { fromDate: '2026-12-26', toDate: '2026-12-28', kind: 'closed', reason: null })).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.createException(tenantA, res, { fromDate: '2026-12-27', toDate: '2026-12-28', kind: 'closed', reason: null })).ok).toBe(true);
      expect((await repo.createException(tenantA, { kind: 'resource', id: 'court-2' }, { fromDate: '2026-12-24', toDate: '2026-12-26', kind: 'closed', reason: null })).ok).toBe(true);
    });
  });

  describe('archived offerings and inactive resources', () => {
    it('an archived offering takes no new or changed availability, but its rules can be deleted', async () => {
      const r = await created(off);
      await getPool().query("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'off-1'");
      expect(await repo.createRule(tenantA, off, rule({ dayOfWeek: 3 }))).toEqual({ ok: false, reason: 'owner_archived' });
      expect(await repo.updateRule(tenantA, r.id, r.updatedAt, { endTime: '13:00' })).toEqual({ ok: false, reason: 'owner_archived' });
      expect(await repo.createException(tenantA, off, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'closed', reason: null })).toEqual({ ok: false, reason: 'owner_archived' });
      expect((await repo.deleteRule(tenantA, r.id, r.updatedAt)).ok).toBe(true);
    });

    it('an archived schedule closes its offerings the same way', async () => {
      await getPool().query("UPDATE scheduling_schedules SET archived_at = now() WHERE id = 'sch-a'");
      expect(await repo.createRule(tenantA, off, rule())).toEqual({ ok: false, reason: 'owner_archived' });
    });

    it('an inactive resource takes no new or changed availability until it is reactivated; deletes are always allowed', async () => {
      const r = await created(res);
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-1'");
      expect(await repo.createRule(tenantA, res, rule({ dayOfWeek: 3 }))).toEqual({ ok: false, reason: 'owner_inactive' });
      expect(await repo.updateRule(tenantA, r.id, r.updatedAt, { endTime: '13:00' })).toEqual({ ok: false, reason: 'owner_inactive' });
      expect(await repo.createException(tenantA, res, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'closed', reason: null })).toEqual({ ok: false, reason: 'owner_inactive' });
      await getPool().query("UPDATE scheduling_resources SET active = true WHERE id = 'court-1'");
      const fresh = (await repo.getRule(tenantA, r.id))!;
      expect((await repo.updateRule(tenantA, fresh.id, fresh.updatedAt, { endTime: '13:00' })).ok).toBe(true);
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-1'");
      const again = (await repo.getRule(tenantA, r.id))!;
      expect((await repo.deleteRule(tenantA, again.id, again.updatedAt)).ok).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('another organisation cannot see, list, edit, delete or create against these rows, and nothing changes', async () => {
      const r = await created(res);
      const c = await repo.createException(tenantA, res, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'closed', reason: null });
      if (!c.ok) throw new Error('setup');
      const before = [await hash('scheduling_availability_rules'), await hash('scheduling_availability_exceptions')];
      expect(await repo.getRule(tenantB, r.id)).toBeNull();
      expect(await repo.getException(tenantB, c.value.id)).toBeNull();
      expect(await repo.listRules(tenantB, res)).toEqual([]);
      expect(await repo.listExceptions(tenantB, res)).toEqual([]);
      expect(await repo.updateRule(tenantB, r.id, r.updatedAt, { endTime: '13:00' })).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.deleteRule(tenantB, r.id, r.updatedAt)).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.updateException(tenantB, c.value.id, c.value.updatedAt, { reason: 'x' })).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.deleteException(tenantB, c.value.id, c.value.updatedAt)).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createRule(tenantB, res, rule({ dayOfWeek: 5 }))).toEqual({ ok: false, reason: 'not_found' }); // A's resource, B's session
      expect(await repo.createException(tenantB, off, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'closed', reason: null })).toEqual({ ok: false, reason: 'not_found' });
      expect([await hash('scheduling_availability_rules'), await hash('scheduling_availability_exceptions')]).toEqual(before);
    });

    it('both organisations may use the same id and the same hours independently', async () => {
      await created(res);
      await created({ kind: 'resource', id: 'court-b' }, {}, tenantB);
      expect(await repo.listRules(tenantA, res)).toHaveLength(1);
      expect(await repo.listRules(tenantB, { kind: 'resource', id: 'court-b' })).toHaveLength(1);
      expect(await repo.listRules(tenantB, res)).toEqual([]);
    });

    it('a row of one organisation cannot be pointed at another organisation\'s owner even by raw SQL (composite foreign key)', async () => {
      const code = await sqlstate(getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('x', $1, 'court-b', 1, '09:00', '10:00')", [A]));
      expect(code).toBe('23503');
    });
  });

  describe('permissions at the repository', () => {
    it('reads need scheduling.view, writes need scheduling.manage, and self-service actors can do neither', async () => {
      const r = await created(res);
      const viewer = staff(A, ['scheduling.view']);
      const nobody = staff(A, []);
      expect(await repo.listRules(viewer, res)).toHaveLength(1);
      await expect(repo.createRule(viewer, res, rule({ dayOfWeek: 4 }))).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(repo.updateRule(viewer, r.id, r.updatedAt, { endTime: '13:00' })).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(repo.deleteRule(viewer, r.id, r.updatedAt)).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(repo.listRules(nobody, res)).rejects.toMatchObject({ code: 'permission_denied' });
      for (const actor of [publicActor(A), customerActor(A, 'cust-1')]) {
        await expect(repo.listRules(actor, res)).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(repo.createRule(actor, res, rule({ dayOfWeek: 4 }))).rejects.toMatchObject({ code: 'permission_denied' });
      }
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(1);
    });
  });

  describe('the database is the authority (raw SQL is refused as well)', () => {
    it('an overlapping raw insert, an owner change and an unsafe isolation level are refused with the documented codes', async () => {
      await created(res);
      expect(await sqlstate(getPool().query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('raw1', $1, 'court-1', 1, '10:00', '11:00')", [A]))).toBe('SCOVL');
      const r = (await repo.listRules(tenantA, res))[0];
      expect(await sqlstate(getPool().query("UPDATE scheduling_availability_rules SET resource_id = 'court-2' WHERE id = $1", [r.id]))).toBe('SCOWN');
      const c = await getPool().connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        expect(await sqlstate(c.query("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ('raw2', $1, 'court-1', 3, '10:00', '11:00')", [A]))).toBe('SCISO');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(1);
    });

    it('the existing unversioned add method is guarded too', async () => {
      const config = (await import('@scheduling/postgres')).PostgresSchedulingConfigRepository;
      const old = new config({ sql: fromPgLike(getPool()) });
      await old.addAvailabilityRule(tenantA, 'resource', 'court-1', { kind: 'hours', label: null, resourceId: null, offeringId: null, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', validFrom: null, validTo: null });
      await expect(old.addAvailabilityRule(tenantA, 'resource', 'court-1', { kind: 'hours', label: null, resourceId: null, offeringId: null, dayOfWeek: 1, startTime: '10:00', endTime: '11:00', validFrom: null, validTo: null })).rejects.toMatchObject({ code: 'conflict' });
    });
  });

  describe('concurrency', () => {
    it('30 concurrent overlapping inserts on one resource: exactly one wins, the rest are overlap, none is lost to a deadlock', async () => {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => repo.createRule(tenantA, res, rule({ startTime: '09:00', endTime: i % 2 === 0 ? '12:00' : '11:00' }))));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'overlap')).toBe(true);
      expect(await count("SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = 'court-1'")).toBe(1);
    });

    it('the same for an offering, and for closures', async () => {
      const rules = await Promise.all(Array.from({ length: 20 }, () => repo.createRule(tenantA, off, rule({ startTime: '08:00', endTime: '10:00' }))));
      expect(rules.filter(r => r.ok)).toHaveLength(1);
      const closures = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createException(tenantA, off, { fromDate: '2026-12-24', toDate: i % 2 ? '2026-12-26' : '2026-12-25', kind: 'closed', reason: null })));
      expect(closures.filter(r => r.ok)).toHaveLength(1);
    });

    it('concurrent NON-overlapping inserts all succeed (the lock serialises, it does not refuse)', async () => {
      const results = await Promise.all(Array.from({ length: 24 }, (_, i) => repo.createRule(tenantA, res, rule({ dayOfWeek: i % 7, startTime: `${String(Math.floor(i / 7) * 3).padStart(2, '0')}:00`, endTime: `${String(Math.floor(i / 7) * 3 + 2).padStart(2, '0')}:00` }))));
      expect(results.every(r => r.ok)).toBe(true);
      expect(await count("SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = 'court-1'")).toBe(24);
    });

    it('two writers racing to move different rules into the same window: at most one wins', async () => {
      const a = await created(res, { startTime: '06:00', endTime: '07:00' });
      const b = await created(res, { startTime: '15:00', endTime: '16:00' });
      const [x, y] = await Promise.all([repo.updateRule(tenantA, a.id, a.updatedAt, { startTime: '10:00', endTime: '11:00' }), repo.updateRule(tenantA, b.id, b.updatedAt, { startTime: '10:30', endTime: '11:30' })]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      const rules = await repo.listRules(tenantA, res);
      expect(validateAvailabilityRuleSet(rules.map(r => ({ id: r.id, organisationId: A, resourceId: r.resourceId, offeringId: r.offeringId, dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime as string, validFrom: r.validFrom, validTo: r.validTo })))).toEqual([]);
    });

    it('concurrent edits of one row with one version: exactly one wins, the others are stale', async () => {
      const r0 = await created(res);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.updateRule(tenantA, r0.id, r0.updatedAt, { label: `L${i}` })));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'stale_write')).toBe(true);
    });

    it('creating availability while the resource is deactivated or the offering archived: never a deadlock, and never a rule created after the owner became unavailable', async () => {
      for (let round = 0; round < 15; round++) {
        await resetData();
        await seedSchedule(A, 'sch-a', 'resource_hire');
        await seedResource(A, 'court-1');
        await seedOffering(A, 'off-1', 'sch-a');
        const sql = getPool();
        const outcomes = await Promise.allSettled([
          ...Array.from({ length: 6 }, (_, i) => repo.createRule(tenantA, res, rule({ dayOfWeek: i }))),
          sql.query("UPDATE scheduling_resources SET active = false WHERE id = 'court-1'"),
          ...Array.from({ length: 6 }, (_, i) => repo.createRule(tenantA, off, rule({ dayOfWeek: i }))),
          sql.query("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'off-1'"),
        ]);
        for (const o of outcomes) expect(o.status, JSON.stringify(o)).toBe('fulfilled');
        // Once both are unavailable nothing more can be added, and what was added before is a consistent, valid set.
        expect(await repo.createRule(tenantA, res, rule({ dayOfWeek: 6, startTime: '20:00', endTime: '21:00' }))).toEqual({ ok: false, reason: 'owner_inactive' });
        expect(await repo.createRule(tenantA, off, rule({ dayOfWeek: 6, startTime: '20:00', endTime: '21:00' }))).toEqual({ ok: false, reason: 'owner_archived' });
      }
    });
  });

  describe('parity with the core validators', () => {
    // A seeded generator: the database accepts a rule exactly when the core validator accepts the whole set.
    function prng(seed: number) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const hhmm = (m: number) => (m === 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const DATES = [null, '2026-01-01', '2026-03-31', '2026-06-30', '2026-12-31'] as const;

    for (let seed = 1; seed <= 40; seed++) {
      it(`rules, seed ${seed}: accepted by the database iff the core set validation accepts`, async () => {
        const r = prng(seed);
        const accepted: StoredAvailabilityRule[] = [];
        for (let i = 0; i < 25; i++) {
          const start = Math.floor(r() * 48) * 30;
          const end = Math.min(1440, start + (1 + Math.floor(r() * 6)) * 30);
          const from = DATES[Math.floor(r() * DATES.length)];
          const toPool = DATES.filter(d => d === null || from === null || d >= from);
          const to = toPool[Math.floor(r() * toPool.length)];
          const input = rule({ dayOfWeek: Math.floor(r() * 3), startTime: hhmm(start), endTime: hhmm(end), validFrom: from, validTo: to });
          const candidate = { id: 'candidate', organisationId: A, resourceId: 'court-1', offeringId: null, dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime as string, validFrom: input.validFrom, validTo: input.validTo };
          const existing = accepted.map(a => ({ id: a.id, organisationId: A, resourceId: 'court-1', offeringId: null, dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime as string, validFrom: a.validFrom, validTo: a.validTo }));
          const coreOk = validateAvailabilityRuleSet([...existing, candidate]).length === 0;
          const stored = await repo.createRule(tenantA, res, input);
          expect(stored.ok, `seed ${seed} #${i} ${JSON.stringify(input)}: core says ${coreOk}`).toBe(coreOk);
          if (stored.ok) accepted.push(stored.value);
        }
      });
    }

    for (let seed = 1; seed <= 20; seed++) {
      it(`closures, seed ${seed}: accepted by the database iff the core set validation accepts`, async () => {
        const r = prng(seed * 31);
        const accepted: Array<{ id: string; fromDate: string; toDate: string }> = [];
        const day = (n: number) => new Date(Date.UTC(2026, 11, 1 + n)).toISOString().slice(0, 10);
        for (let i = 0; i < 20; i++) {
          const from = Math.floor(r() * 40);
          const to = from + Math.floor(r() * 4);
          const candidate = { id: 'candidate', organisationId: A, resourceId: 'court-1', offeringId: null, fromDate: day(from), toDate: day(to), kind: 'closed' as const, reason: null };
          const coreOk = validateAvailabilityExceptionSet([...accepted.map(a => ({ ...candidate, ...a })), candidate]).length === 0;
          const stored = await repo.createException(tenantA, res, { fromDate: day(from), toDate: day(to), kind: 'closed', reason: null });
          expect(stored.ok, `seed ${seed} #${i}`).toBe(coreOk);
          if (stored.ok) accepted.push({ id: stored.value.id, fromDate: stored.value.fromDate, toDate: stored.value.toDate });
        }
      });
    }
  });

  describe('nothing here ever writes a reservation, hold or occurrence', () => {
    it('availability writes leave bookings, holds and occurrences untouched', async () => {
      const before = [await hash('scheduling_reservations'), await hash('scheduling_resource_holds'), await hash('scheduling_occurrences'), await hash('scheduling_resources'), await hash('scheduling_offerings')];
      const r = await created(res);
      await repo.updateRule(tenantA, r.id, r.updatedAt, { endTime: '13:00' });
      await repo.createException(tenantA, off, { fromDate: '2026-12-25', toDate: '2026-12-25', kind: 'closed', reason: null });
      expect([await hash('scheduling_reservations'), await hash('scheduling_resource_holds'), await hash('scheduling_occurrences'), await hash('scheduling_resources'), await hash('scheduling_offerings')]).toEqual(before);
    });
  });

  // Last: it removes and re-applies the migration, so nothing else may run against this database meanwhile (the script runs one file at a time).
  describe('fail closed when migration 034 is not applied', () => {
    it('every call reports AvailabilityNotReadyError and writes nothing; re-applying 034 restores it', async () => {
      const rollback = sqlFile('095_availability_integrity_rollback.sql');
      await runScript(rollback);
      try {
        await expect(repo.listRules(tenantA, res)).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        await expect(repo.createRule(tenantA, res, rule())).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        await expect(repo.getRule(tenantA, 'x')).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        await expect(repo.deleteRule(tenantA, 'x', '2026-01-01T00:00:00.000000Z')).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
      } finally {
        await runScript(sqlFile('034_availability_integrity.sql'));
      }
      expect((await repo.createRule(tenantA, res, rule())).ok).toBe(true);
    });

    it('the rollback and a second apply are idempotent and leave existing rules in place', async () => {
      await created(res);
      await runScript(sqlFile('095_availability_integrity_rollback.sql'));
      await runScript(sqlFile('095_availability_integrity_rollback.sql'));
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(1);
      await runScript(sqlFile('034_availability_integrity.sql'));
      await runScript(sqlFile('034_availability_integrity.sql'));
      expect(await repo.listRules(tenantA, res)).toHaveLength(1);
    });
  });
});
