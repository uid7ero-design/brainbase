import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BATCH_OWNERS, SchedulingError, type AvailabilityOwner, type NewStoredExceptionInput, type NewStoredRuleInput } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Phase 2B.3e on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2b3e.sh on 16 and 17): the batched availability reads the calendar uses
// (listRulesForOwners, listExceptionsForOwners, listZonesForOwners) must return EXACTLY what the per-owner reads return, for many owners in one statement.
//   - EQUIVALENCE: for every owner, the batch rows equal listRules / listExceptions / getZone, in the same order.
//   - TENANT: ids of another organisation match nothing, whichever kind they are asked as, and the statement is scoped to the caller's organisation.
//   - PERMISSION: scheduling.view is required; a caller without it (or a non-staff actor) is refused before any statement.
//   - BOUNDS: duplicates collapse, an empty list reads nothing, more than MAX_BATCH_OWNERS ids is refused.
//   - READ ONLY and FAIL SOFT: nothing is written; before migration 036 the zone batch is empty (as getZone is null) instead of an error.

const A = 'org-bt-a';
const B = 'org-bt-b';
const tenantA = staff(A);
const viewerA = staff(A, ['scheduling.view']);
const nobodyA = staff(A, []);
const suite = hasDatabase ? describe : describe.skip;

let repo: PostgresAvailabilityRepository;
const resOwner = (id: string): AvailabilityOwner => ({ kind: 'resource', id });
const offOwner = (id: string): AvailabilityOwner => ({ kind: 'offering', id });
const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
const closure = (over: Partial<NewStoredExceptionInput> = {}): NewStoredExceptionInput => ({ fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null, ...over });
const hashAll = async () => {
  const out: string[] = [];
  for (const t of ['scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_resources', 'scheduling_offerings', 'audit_logs']) {
    out.push((await getPool().query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`)).rows[0].h as string);
  }
  return out;
};

suite('batched availability reads on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema(); // 010, 030, 031, 034 and 036
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await resetData();
    repo = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await runScript(sqlFile('096_availability_partial_closures_rollback.sql')).catch(() => undefined);
    await resetData();
    await getPool().query('DELETE FROM organisations WHERE id IN ($1, $2)', [A, B]).catch(() => undefined);
    await closePool();
  });
  beforeEach(async () => {
    await resetData();
    for (const org of [A, B]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, 'Australia/Adelaide']);
    await seedSchedule(A, 'sch-a', 'resource_hire');
    await seedSchedule(B, 'sch-b', 'resource_hire');
    for (const id of ['court-1', 'court-2', 'court-3', 'court-4']) await seedResource(A, id);
    await seedResource(B, 'court-b');
    await seedOffering(A, 'off-1', 'sch-a');
    await seedOffering(A, 'off-2', 'sch-a');
    await seedOffering(B, 'off-b', 'sch-b');
    // court-1: three rules, a whole-day and a partial closure, pinned Perth. court-2: one rule, Adelaide. court-3: closure only. court-4: nothing.
    await repo.createRules(tenantA, resOwner('court-1'), [rule({ dayOfWeek: 3 }), rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' })], 'Australia/Perth');
    await repo.createException(tenantA, resOwner('court-1'), closure(), 'Australia/Perth');
    await repo.createException(tenantA, resOwner('court-1'), closure({ fromDate: '2027-04-05', toDate: '2027-04-05', startTime: '12:00', endTime: '13:00' }), 'Australia/Perth');
    await repo.createRule(tenantA, resOwner('court-2'), rule({ dayOfWeek: 5 }), 'Australia/Adelaide');
    await repo.createException(tenantA, resOwner('court-3'), closure(), 'Australia/Darwin');
    await repo.createRule(tenantA, offOwner('off-1'), rule({ dayOfWeek: 2 }), 'Australia/Adelaide');
    await repo.createRule(tenantA, offOwner('off-2'), rule({ dayOfWeek: 4 }), 'Australia/Sydney');
    await repo.createRule(staff(B), resOwner('court-b'), rule({ dayOfWeek: 1 }), 'Australia/Perth');
    await repo.createRule(staff(B), offOwner('off-b'), rule({ dayOfWeek: 1 }), 'Australia/Perth');
  });

  const ids = ['court-1', 'court-2', 'court-3', 'court-4'];

  describe('equivalence with the per-owner reads', () => {
    it('rules: the batch is the per-owner lists, owner by owner, in the same order', async () => {
      const batch = await repo.listRulesForOwners(tenantA, 'resource', ids);
      for (const id of ids) expect(batch.filter(r => r.resourceId === id), id).toEqual(await repo.listRules(tenantA, resOwner(id)));
      expect(batch).toHaveLength(4);
      expect(batch.every(r => r.offeringId === null)).toBe(true);
    });

    it('closures: the batch is the per-owner lists, including partial-day windows', async () => {
      const batch = await repo.listExceptionsForOwners(tenantA, 'resource', ids);
      for (const id of ids) expect(batch.filter(e => e.resourceId === id), id).toEqual(await repo.listExceptions(tenantA, resOwner(id)));
      expect(batch).toHaveLength(3);
      expect(batch.filter(e => e.startTime !== null)).toHaveLength(1);
    });

    it('zones: the batch is every owner’s getZone, and an owner with no pin is simply absent', async () => {
      const batch = await repo.listZonesForOwners(tenantA, 'resource', ids);
      for (const id of ids) {
        const one = await repo.getZone(tenantA, resOwner(id));
        const row = batch.find(z => z.ownerId === id);
        if (one === null) expect(row, id).toBeUndefined();
        else expect(row, id).toEqual({ ...one, ownerId: id });
      }
      expect(batch.map(z => [z.ownerId, z.timezone]).sort()).toEqual([['court-1', 'Australia/Perth'], ['court-2', 'Australia/Adelaide'], ['court-3', 'Australia/Darwin']]);
    });

    it('offerings are read as offerings: a resource id asked as an offering matches nothing, and the reverse', async () => {
      expect((await repo.listRulesForOwners(tenantA, 'offering', ['off-1', 'off-2'])).map(r => r.offeringId).sort()).toEqual(['off-1', 'off-2']);
      expect(await repo.listRulesForOwners(tenantA, 'offering', ['court-1'])).toEqual([]);
      expect(await repo.listRulesForOwners(tenantA, 'resource', ['off-1'])).toEqual([]);
      expect((await repo.listZonesForOwners(tenantA, 'offering', ['off-1', 'off-2'])).map(z => [z.ownerId, z.timezone]).sort()).toEqual([['off-1', 'Australia/Adelaide'], ['off-2', 'Australia/Sydney']]);
      expect(await repo.listZonesForOwners(tenantA, 'offering', ['court-1'])).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('another organisation’s ids match nothing in any of the three reads, alone or mixed with this organisation’s', async () => {
      for (const kind of ['resource', 'offering'] as const) {
        const foreign = kind === 'resource' ? ['court-b'] : ['off-b'];
        expect(await repo.listRulesForOwners(tenantA, kind, foreign)).toEqual([]);
        expect(await repo.listExceptionsForOwners(tenantA, kind, foreign)).toEqual([]);
        expect(await repo.listZonesForOwners(tenantA, kind, foreign)).toEqual([]);
      }
      const mixed = await repo.listRulesForOwners(tenantA, 'resource', ['court-b', 'court-2']);
      expect(mixed.map(r => r.resourceId)).toEqual(['court-2']);
      expect((await repo.listZonesForOwners(tenantA, 'resource', ['court-b', 'court-2'])).map(z => z.ownerId)).toEqual(['court-2']);
    });

    it('the other organisation reads its own rows and none of this one', async () => {
      const b = staff(B);
      expect((await repo.listRulesForOwners(b, 'resource', ['court-b', 'court-1'])).map(r => r.resourceId)).toEqual(['court-b']);
      expect((await repo.listZonesForOwners(b, 'resource', ['court-b', 'court-1'])).map(z => [z.ownerId, z.timezone])).toEqual([['court-b', 'Australia/Perth']]);
    });

    it('an id that is not a plain id (an injection attempt, a wildcard, an empty string) is only ever a value that matches nothing', async () => {
      const hostile = ["court-1' OR '1'='1", 'court-%', '', '{court-1}', 'court-1,court-2', "'); DROP TABLE scheduling_availability_rules; --"];
      expect(await repo.listRulesForOwners(tenantA, 'resource', hostile)).toEqual([]);
      expect(await repo.listExceptionsForOwners(tenantA, 'resource', hostile)).toEqual([]);
      expect(await repo.listZonesForOwners(tenantA, 'resource', hostile)).toEqual([]);
      expect(await repo.listRulesForOwners(tenantA, 'resource', ids)).toHaveLength(4); // the table is still there
    });
  });

  describe('permission and bounds', () => {
    it('scheduling.view is required: no permission, or no staff actor, is refused and reads nothing', async () => {
      for (const t of [nobodyA, { ...tenantA, actor: { kind: 'public' as const } }]) {
        await expect(repo.listRulesForOwners(t as never, 'resource', ids)).rejects.toBeInstanceOf(SchedulingError);
        await expect(repo.listExceptionsForOwners(t as never, 'resource', ids)).rejects.toBeInstanceOf(SchedulingError);
        await expect(repo.listZonesForOwners(t as never, 'resource', ids)).rejects.toBeInstanceOf(SchedulingError);
      }
      expect((await repo.listRulesForOwners(viewerA, 'resource', ids)).length).toBe(4); // view alone is enough
    });

    it('duplicates collapse, an empty list reads nothing, and more than the maximum is refused whole', async () => {
      expect(await repo.listRulesForOwners(tenantA, 'resource', ['court-2', 'court-2', 'court-2'])).toHaveLength(1);
      expect(await repo.listRulesForOwners(tenantA, 'resource', [])).toEqual([]);
      const many = Array.from({ length: MAX_BATCH_OWNERS + 1 }, (_, i) => `x-${i}`);
      await expect(repo.listRulesForOwners(tenantA, 'resource', many)).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(repo.listZonesForOwners(tenantA, 'resource', many)).rejects.toMatchObject({ code: 'invalid_input' });
      expect(await repo.listRulesForOwners(tenantA, 'resource', many.slice(0, MAX_BATCH_OWNERS))).toEqual([]); // exactly the maximum is accepted
    });
  });

  describe('read only, and fail soft before migration 036', () => {
    it('the three reads change no row of any availability table, owner table or the audit log', async () => {
      const before = await hashAll();
      for (let i = 0; i < 3; i++) {
        await repo.listRulesForOwners(tenantA, 'resource', ids);
        await repo.listExceptionsForOwners(tenantA, 'resource', ids);
        await repo.listZonesForOwners(tenantA, 'offering', ['off-1', 'off-2']);
      }
      expect(await hashAll()).toEqual(before);
    });

    it('before migration 036 the zone batch is empty (as getZone is null), and the rule and closure batches still work', async () => {
      await resetData();
      await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [A, 'Australia/Adelaide']);
      await seedSchedule(A, 'sch-a', 'resource_hire');
      await seedResource(A, 'court-1');
      try {
        await runScript(sqlFile('097_availability_zones_rollback.sql'));
        expect(await repo.listZonesForOwners(tenantA, 'resource', ['court-1'])).toEqual([]);
        expect(await repo.getZone(tenantA, resOwner('court-1'))).toBeNull();
        expect(await repo.listRulesForOwners(tenantA, 'resource', ['court-1'])).toEqual([]);
        expect(await repo.listExceptionsForOwners(tenantA, 'resource', ['court-1'])).toEqual([]);
      } finally {
        await runScript(sqlFile('036_availability_zones.sql'));
      }
    });
  });
});
