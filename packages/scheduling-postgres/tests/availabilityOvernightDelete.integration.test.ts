import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AvailabilityNotReadyError,
  SchedulingError,
  isOvernightWindowPair,
  splitOvernightRule,
  type AvailabilityOwner,
  type NewStoredRuleInput,
  type StoredAvailabilityRule,
} from '@scheduling/core';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Removing an overnight window (the two stored halves) in ONE statement, on a real PostgreSQL (scripts/tests/verify-scheduling-phase2b3c.sh,
// PostgreSQL 16 and 17). Creating the window was already atomic (createRules); this proves removing it is too:
//   - both halves go or neither does; each half carries its own version token;
//   - organisation and owner isolation, and no unrelated rule is ever deleted;
//   - concurrent removals, edits and creates never leave half a window, never deadlock;
//   - the SQL's notion of "the two halves of one window" is the core's isOvernightWindowPair, case by case;
//   - fail closed before migration 034.

const A = 'org-od-a';
const B = 'org-od-b';
const tenantA = staff(A);
const tenantB = staff(B);
const viewerA = staff(A, ['scheduling.view']);
const suite = hasDatabase ? describe : describe.skip;

let repo: PostgresAvailabilityRepository;
const res: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
const res2: AvailabilityOwner = { kind: 'resource', id: 'court-2' };
const off: AvailabilityOwner = { kind: 'offering', id: 'off-1' };

const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
const rulesIn = (owner: string) => count('SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = $1 OR offering_id = $1', [owner]);
const totalRules = () => count('SELECT count(*) FROM scheduling_availability_rules');

/** An overnight window on `owner`, created the way the API does (one statement). Returns [evening, morning]. */
async function overnight(owner: AvailabilityOwner, over: { day?: number; start?: string; end?: string; validFrom?: string | null; validTo?: string | null } = {}, tenant = tenantA): Promise<[StoredAvailabilityRule, StoredAvailabilityRule]> {
  const pair = splitOvernightRule({ dayOfWeek: over.day ?? 5, startTime: over.start ?? '22:00', endTime: over.end ?? '02:00', validFrom: over.validFrom ?? null, validTo: over.validTo ?? null });
  const r = await repo.createRules(tenant, owner, pair.map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, validFrom: p.validFrom, validTo: p.validTo })));
  if (!r.ok) throw new Error(`could not create the window: ${r.reason}`);
  const [evening, morning] = [...r.value].sort((a, b) => (a.endTime === '24:00' ? -1 : 1) - (b.endTime === '24:00' ? -1 : 1));
  return [evening, morning];
}
const ref = (r: StoredAvailabilityRule) => ({ id: r.id, expectedUpdatedAt: r.updatedAt });
const remove = (pair: [StoredAvailabilityRule, StoredAvailabilityRule], tenant = tenantA) => repo.deleteOvernightWindow(tenant, [ref(pair[0]), ref(pair[1])]);

suite('removing an overnight window is atomic on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema(); // 034 (and the earlier migrations)
    await resetData();
    repo = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await resetData();
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

  describe('the removal', () => {
    it('deletes both halves together, on a resource and on an offering, and returns the rows as they were', async () => {
      for (const owner of [res, off]) {
        const pair = await overnight(owner);
        const r = await remove(pair);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.map(x => [x.dayOfWeek, x.startTime, x.endTime])).toEqual([[5, '22:00', '24:00'], [6, '00:00', '02:00']]);
        expect(r.value.map(x => x.id).sort()).toEqual(pair.map(x => x.id).sort());
        expect(await rulesIn(owner.id)).toBe(0);
      }
    });

    it('the order of the two halves does not matter', async () => {
      const pair = await overnight(res);
      const r = await repo.deleteOvernightWindow(tenantA, [ref(pair[1]), ref(pair[0])]);
      expect(r.ok).toBe(true);
      expect(await totalRules()).toBe(0);
    });

    it('the week wraps: a Saturday-night window ends on Sunday, a Sunday-night one on Monday', async () => {
      for (const day of [6, 0]) {
        const pair = await overnight(res, { day, start: '23:00', end: '01:00' });
        expect((await remove(pair)).ok).toBe(true);
      }
      expect(await totalRules()).toBe(0);
    });

    it('deletes nothing else: every other rule of the owner, of another owner and of another organisation survives', async () => {
      const bystanders = [
        await repo.createRule(tenantA, res, rule({ dayOfWeek: 2, startTime: '09:00', endTime: '12:00' })),
        await repo.createRule(tenantA, res, rule({ dayOfWeek: 6, startTime: '08:00', endTime: '24:00' })), // ends at midnight, Saturday, next to the window's morning half
        await repo.createRule(tenantA, res, rule({ dayOfWeek: 0, startTime: '00:00', endTime: '03:00' })), // starts at midnight, Sunday
        await repo.createRule(tenantA, off, rule({ dayOfWeek: 5, startTime: '22:00', endTime: '24:00' })),
        await repo.createRule(tenantB, { kind: 'resource', id: 'court-b' }, rule({ dayOfWeek: 5, startTime: '22:00', endTime: '24:00' })),
      ];
      expect(bystanders.every(b => b.ok)).toBe(true);
      const pair = await overnight(res); // Friday 22:00 to Saturday 02:00 on court-1: overlaps nothing above
      const r = await remove(pair);
      expect(r.ok).toBe(true);
      expect(await totalRules()).toBe(5);
      expect(await rulesIn('court-1')).toBe(3);
    });

    it('is allowed on an archived offering and an inactive resource (removing availability is always possible)', async () => {
      const onOffering = await overnight(off);
      const onResource = await overnight(res2);
      await getPool().query("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'off-1'");
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-2'");
      expect((await remove(onOffering)).ok).toBe(true);
      expect((await remove(onResource)).ok).toBe(true);
      expect(await totalRules()).toBe(0);
    });

    it('a window with a validity range is removed (the morning half is shifted one day)', async () => {
      const pair = await overnight(res, { validFrom: '2027-04-02', validTo: '2027-04-30' });
      expect(pair[1].validFrom).toBe('2027-04-03');
      expect((await remove(pair)).ok).toBe(true);
      expect(await totalRules()).toBe(0);
    });
  });

  describe('all or none: a half that cannot be deleted stops the other being deleted', () => {
    it('a stale half (either one) deletes nothing and reports stale_write', async () => {
      for (const which of [0, 1]) {
        const pair = await overnight(res);
        const moved = await repo.updateRule(tenantA, pair[which].id, pair[which].updatedAt, { label: 'edited elsewhere' });
        expect(moved.ok).toBe(true);
        expect(await remove(pair)).toEqual({ ok: false, reason: 'stale_write' });
        expect(await rulesIn('court-1')).toBe(2);
        await getPool().query('DELETE FROM scheduling_availability_rules');
      }
    });

    it('both halves stale: nothing deleted', async () => {
      const pair = await overnight(res);
      for (const p of pair) expect((await repo.updateRule(tenantA, p.id, p.updatedAt, { label: 'x' })).ok).toBe(true);
      expect(await remove(pair)).toEqual({ ok: false, reason: 'stale_write' });
      expect(await rulesIn('court-1')).toBe(2);
    });

    it('a half that no longer exists deletes nothing and reports not_found (the other half stays)', async () => {
      const pair = await overnight(res);
      const gone = await repo.deleteRule(tenantA, pair[1].id, pair[1].updatedAt);
      expect(gone.ok).toBe(true);
      expect(await remove(pair)).toEqual({ ok: false, reason: 'not_found' });
      expect(await rulesIn('court-1')).toBe(1);
    });

    it('an unknown id deletes nothing: the real half is left in place', async () => {
      const pair = await overnight(res);
      const r = await repo.deleteOvernightWindow(tenantA, [ref(pair[0]), { id: 'does-not-exist', expectedUpdatedAt: pair[1].updatedAt }]);
      expect(r).toEqual({ ok: false, reason: 'not_found' });
      expect(await rulesIn('court-1')).toBe(2);
    });

    it('a token with a different microsecond is stale (the full precision is compared)', async () => {
      const pair = await overnight(res);
      const bumped = pair[0].updatedAt.replace(/(\d)Z$/, d => `${(Number(d[0]) + 1) % 10}Z`);
      expect(bumped).not.toBe(pair[0].updatedAt);
      expect(await repo.deleteOvernightWindow(tenantA, [{ id: pair[0].id, expectedUpdatedAt: bumped }, ref(pair[1])])).toEqual({ ok: false, reason: 'stale_write' });
      expect(await rulesIn('court-1')).toBe(2);
    });
  });

  describe('only the two halves of one window can be removed together', () => {
    it('two unrelated rules, even with fresh tokens, are refused: not_overnight_window, nothing deleted', async () => {
      const a = await repo.createRule(tenantA, res, rule({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }));
      const b = await repo.createRule(tenantA, res, rule({ dayOfWeek: 2, startTime: '09:00', endTime: '17:00' }));
      if (!a.ok || !b.ok) throw new Error('setup');
      expect(await repo.deleteOvernightWindow(tenantA, [ref(a.value), ref(b.value)])).toEqual({ ok: false, reason: 'not_overnight_window' });
      expect(await rulesIn('court-1')).toBe(2);
    });

    it('the SQL and isOvernightWindowPair agree on every shape', async () => {
      type Shape = { name: string; evening: Partial<NewStoredRuleInput> & { owner?: AvailabilityOwner }; morning: Partial<NewStoredRuleInput> & { owner?: AvailabilityOwner } };
      const ev = { dayOfWeek: 5, startTime: '22:00', endTime: '24:00' };
      const mo = { dayOfWeek: 6, startTime: '00:00', endTime: '02:00' };
      const shapes: Shape[] = [
        { name: 'a real window', evening: ev, morning: mo },
        { name: 'the week wraps (Saturday to Sunday)', evening: { ...ev, dayOfWeek: 6 }, morning: { ...mo, dayOfWeek: 0 } },
        { name: 'two days later, not the next day', evening: ev, morning: { ...mo, dayOfWeek: 0 } },
        { name: 'the same day', evening: ev, morning: { ...mo, dayOfWeek: 5, startTime: '00:00', endTime: '02:00' } },
        { name: 'the morning runs all day', evening: ev, morning: { ...mo, endTime: '24:00' } },
        { name: 'the evening starts at midnight (a whole day)', evening: { ...ev, startTime: '00:00' }, morning: mo },
        { name: 'the evening does not reach midnight', evening: { ...ev, endTime: '23:00' }, morning: mo },
        { name: 'the morning does not start at midnight', evening: ev, morning: { ...mo, startTime: '01:00' } },
        { name: 'different kind', evening: ev, morning: { ...mo, kind: 'service_period' } },
        { name: 'validity not shifted by one day', evening: { ...ev, validFrom: '2027-04-02', validTo: '2027-04-30' }, morning: { ...mo, validFrom: '2027-04-02', validTo: '2027-04-30' } },
        { name: 'validity shifted by one day', evening: { ...ev, validFrom: '2027-04-02', validTo: '2027-04-30' }, morning: { ...mo, validFrom: '2027-04-03', validTo: '2027-05-01' } },
        { name: 'open-ended validity on both', evening: { ...ev, validFrom: null, validTo: null }, morning: { ...mo, validFrom: null, validTo: null } },
        { name: 'only the evening is bounded', evening: { ...ev, validTo: '2027-04-30' }, morning: mo },
        { name: 'a different owner of the same kind', evening: ev, morning: { ...mo, owner: res2 } },
        { name: 'a resource and an offering', evening: ev, morning: { ...mo, owner: off } },
      ];
      for (const s of shapes) {
        await getPool().query('DELETE FROM scheduling_availability_rules');
        const eOwner = s.evening.owner ?? res;
        const mOwner = s.morning.owner ?? res;
        const e = await repo.createRule(tenantA, eOwner, rule({ ...s.evening }));
        const m = await repo.createRule(tenantA, mOwner, rule({ ...s.morning }));
        if (!e.ok || !m.ok) throw new Error(`setup ${s.name}: ${!e.ok ? e.reason : !m.ok ? m.reason : ''}`);
        const expected = isOvernightWindowPair(e.value, m.value);
        const r = await repo.deleteOvernightWindow(tenantA, [ref(e.value), ref(m.value)]);
        expect([s.name, r.ok]).toEqual([s.name, expected]);
        if (!r.ok) {
          expect([s.name, r.reason]).toEqual([s.name, 'not_overnight_window']);
          expect([s.name, await totalRules()]).toEqual([s.name, 2]);
        } else {
          expect([s.name, await totalRules()]).toEqual([s.name, 0]);
        }
      }
    });

    it('the halves passed the wrong way round are still one window; a rule paired with itself is refused before the database', async () => {
      const pair = await overnight(res);
      await expect(repo.deleteOvernightWindow(tenantA, [ref(pair[0]), ref(pair[0])])).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.deleteOvernightWindow(tenantA, [ref(pair[0])] as never)).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.deleteOvernightWindow(tenantA, [ref(pair[0]), { id: pair[1].id, expectedUpdatedAt: 'yesterday' }])).rejects.toBeInstanceOf(SchedulingError);
      expect(await rulesIn('court-1')).toBe(2);
    });
  });

  describe('isolation and permission', () => {
    it('another organisation cannot remove this organisation\'s window: not_found, and the window is intact', async () => {
      const pair = await overnight(res);
      expect(await remove(pair, tenantB)).toEqual({ ok: false, reason: 'not_found' });
      expect(await rulesIn('court-1')).toBe(2);
    });

    it('one half in each organisation removes nothing in either', async () => {
      const mine = await overnight(res);
      const theirs = await overnight({ kind: 'resource', id: 'court-b' }, {}, tenantB);
      expect(await repo.deleteOvernightWindow(tenantA, [ref(mine[0]), ref(theirs[1])])).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.deleteOvernightWindow(tenantB, [ref(theirs[0]), ref(mine[1])])).toEqual({ ok: false, reason: 'not_found' });
      expect(await totalRules()).toBe(4);
    });

    it('a viewer (scheduling.view only) cannot remove, and nothing is deleted', async () => {
      const pair = await overnight(res);
      await expect(remove(pair, viewerA)).rejects.toBeInstanceOf(SchedulingError);
      expect(await rulesIn('court-1')).toBe(2);
    });
  });

  describe('concurrency', () => {
    it('12 simultaneous removals of one window: exactly one deletes it (both halves), the rest find it gone, no error', async () => {
      const pair = await overnight(res);
      const results = await Promise.all(Array.from({ length: 12 }, () => remove(pair)));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'not_found')).toBe(true);
      expect(await rulesIn('court-1')).toBe(0);
    });

    it('removals that name the halves in opposite orders never deadlock: one wins, whole', async () => {
      for (let round = 0; round < 15; round++) {
        const pair = await overnight(res);
        const [a, b] = await Promise.all([repo.deleteOvernightWindow(tenantA, [ref(pair[0]), ref(pair[1])]), repo.deleteOvernightWindow(tenantA, [ref(pair[1]), ref(pair[0])])]); // a deadlock would reject with 40P01
        expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
        expect(await rulesIn('court-1')).toBe(0);
      }
    });

    it('a removal racing an edit of one half: never half a window; the loser is told (stale_write or not_found)', async () => {
      let removed = 0;
      let edited = 0;
      for (let round = 0; round < 25; round++) {
        const pair = await overnight(res);
        const target = pair[round % 2];
        const [del, upd] = await Promise.all([remove(pair), repo.updateRule(tenantA, target.id, target.updatedAt, { label: `round ${round}` })]);
        const left = await rulesIn('court-1');
        if (del.ok) {
          removed++;
          expect(left).toBe(0);
          expect(upd.ok === false && (upd.reason === 'not_found' || upd.reason === 'stale_write')).toBe(true);
        } else {
          edited++;
          expect(del.reason).toBe('stale_write');
          expect(upd.ok).toBe(true);
          expect(left).toBe(2);
        }
        await getPool().query('DELETE FROM scheduling_availability_rules');
      }
      expect(removed + edited).toBe(25);
    });

    it('a removal racing a removal of ONE half by the single-rule delete: never half a window', async () => {
      for (let round = 0; round < 20; round++) {
        const pair = await overnight(res);
        const [del, single] = await Promise.all([remove(pair), repo.deleteRule(tenantA, pair[round % 2].id, pair[round % 2].updatedAt)]);
        const left = await rulesIn('court-1');
        if (del.ok) {
          expect(left).toBe(0);
          expect(single.ok).toBe(false);
        } else {
          expect(left).toBe(1); // the single delete won, so one half is gone, and the window removal removed nothing
          expect(single.ok).toBe(true);
          expect(del.reason).toBe('not_found');
        }
        await getPool().query('DELETE FROM scheduling_availability_rules');
      }
    });

    it('a removal does not wait for the owner lock: a writer holding it (an open create) does not block it', async () => {
      const pair = await overnight(res);
      const c = await getPool().connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT scheduling_availability_lock_owner('org-od-a', 'court-1', NULL)"); // exactly what an in-flight create holds
        const t0 = Date.now();
        const r = await remove(pair);
        expect(r.ok).toBe(true);
        expect(Date.now() - t0).toBeLessThan(2000);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    });

    it('removals and creates racing on one owner (create the next window while removing the old one) both commit whole', async () => {
      for (let round = 0; round < 10; round++) {
        const old = await overnight(res, { day: 1, start: '22:00', end: '02:00' });
        const [del, created] = await Promise.all([
          remove(old),
          repo.createRules(tenantA, res, splitOvernightRule({ dayOfWeek: 3, startTime: '21:00', endTime: '03:00', validFrom: null, validTo: null }).map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime }))),
        ]);
        expect(del.ok).toBe(true);
        expect(created.ok).toBe(true);
        expect(await rulesIn('court-1')).toBe(2);
        await getPool().query('DELETE FROM scheduling_availability_rules');
      }
    });

    it('seven windows on seven weekdays removed at once all commit, each whole', async () => {
      const windows: Array<[StoredAvailabilityRule, StoredAvailabilityRule]> = [];
      for (let d = 0; d < 7; d++) windows.push(await overnight(res, { day: d, start: '22:00', end: '02:00' }));
      expect(await rulesIn('court-1')).toBe(14);
      const results = await Promise.all(windows.map(w => remove(w)));
      expect(results.every(r => r.ok)).toBe(true);
      expect(await rulesIn('court-1')).toBe(0);
    });
  });

  describe('fail closed when migration 034 is not applied', () => {
    it('reports AvailabilityNotReadyError and deletes nothing; re-applying 034 restores it', async () => {
      const pair = await overnight(res);
      await runScript(sqlFile('096_availability_partial_closures_rollback.sql'));
      await runScript(sqlFile('095_availability_integrity_rollback.sql'));
      try {
        await expect(remove(pair)).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        expect(await rulesIn('court-1')).toBe(2);
      } finally {
        await runScript(sqlFile('034_availability_integrity.sql'));
      }
      const fresh = await repo.listRules(tenantA, res);
      expect(fresh).toHaveLength(2);
      expect((await repo.deleteOvernightWindow(tenantA, [ref(fresh[0]), ref(fresh[1])])).ok).toBe(true);
    });
  });
});
