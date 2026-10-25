import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AvailabilityNotReadyError,
  PartialClosuresNotReadyError,
  SchedulingError,
  checkExceptionWrite,
  splitOvernightRule,
  type AvailabilityOwner,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type StoredAvailabilityException,
} from '@scheduling/core';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, count, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff } from './support/pgHarness';

// Phase 2B.3c: the two additions the availability screens need, on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2b3c.sh
// against a DISPOSABLE database, on PostgreSQL 16 and 17).
//   1. createRules: several rules of one owner in ONE statement, all or none. This is how an overnight window (two rules) and "the same
//      hours on five weekdays" are written without a half ever being committed, and it needs no new database function: the 034 guard's
//      row trigger sees the rows an earlier tuple of the same statement inserted.
//   2. Migration 035 (partial-day closures: start_time/end_time on an exception, overlap compared over time ranges), its fail-closed
//      behaviour before it is applied, and its rollback (which refuses while a partial-day closure exists).

const A = 'org-bc-a';
const B = 'org-bc-b';
const tenantA = staff(A);
const tenantB = staff(B);
const viewerA = staff(A, ['scheduling.view']);
const suite = hasDatabase ? describe : describe.skip;

let repo: PostgresAvailabilityRepository;
const res: AvailabilityOwner = { kind: 'resource', id: 'court-1' };
const off: AvailabilityOwner = { kind: 'offering', id: 'off-1' };

const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
const closure = (over: Partial<NewStoredExceptionInput> = {}): NewStoredExceptionInput => ({ fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null, ...over });
const rulesIn = (owner: string) => count('SELECT count(*) FROM scheduling_availability_rules WHERE resource_id = $1 OR offering_id = $1', [owner]);
const exceptionsIn = (owner: string) => count('SELECT count(*) FROM scheduling_availability_exceptions WHERE resource_id = $1 OR offering_id = $1', [owner]);
// Line endings are not part of the comparison: a Windows checkout is CRLF, and the committed bytes are LF.
const bodyHash = async (fn: string) => (await getPool().query("SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE proname = $1", [fn])).rows[0].h as string;
const sqlstateOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};

/** Runs a migration script on its own connection: a refusal leaves the explicit transaction aborted, so it is rolled back here. */
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

suite('availability batches and partial-day closures on real PostgreSQL', () => {
  let guardBody034 = '';

  beforeAll(async () => {
    await ensureSchema(); // 034, not 035: it also puts 034's own exception guard back, whatever ran before
    await resetData();
    guardBody034 = await bodyHash('scheduling_availability_exception_integrity'); // captured from 034 itself, BEFORE 096 runs
    await runScript(sqlFile('096_availability_partial_closures_rollback.sql')); // idempotent: a clean 034-only start
    expect(await bodyHash('scheduling_availability_exception_integrity')).toBe(guardBody034); // 096 restores exactly 034's guard
    repo = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  }, 60_000);
  afterAll(async () => {
    await resetData();
    await runScript(sqlFile('096_availability_partial_closures_rollback.sql')); // leave the database as 034 left it for the next suite
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

  describe('createRules: one statement, all or none', () => {
    it('stores a batch together and returns the rules in week order', async () => {
      const r = await repo.createRules(tenantA, res, [rule({ dayOfWeek: 3 }), rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2, startTime: '00:00', endTime: '24:00' })]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.map(x => [x.dayOfWeek, x.startTime, x.endTime])).toEqual([[1, '09:00', '17:00'], [2, '00:00', '24:00'], [3, '09:00', '17:00']]);
      for (const x of r.value) expect(x.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      expect(await rulesIn('court-1')).toBe(3);
    });

    it('an overnight window is two rules stored together, on a resource and on an offering', async () => {
      for (const owner of [res, off]) {
        const pair = splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null });
        const r = await repo.createRules(tenantA, owner, pair.map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime })));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.map(x => [x.dayOfWeek, x.startTime, x.endTime])).toEqual([[5, '22:00', '24:00'], [6, '00:00', '02:00']]);
      }
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(4);
    });

    it('a batch that overlaps an EXISTING rule stores nothing: the tuples before the refused one are not left behind', async () => {
      await repo.createRule(tenantA, res, rule({ dayOfWeek: 2, startTime: '10:00', endTime: '12:00' }));
      for (const order of [[1, 2, 3], [3, 2, 1], [2, 1, 3]]) {
        const r = await repo.createRules(tenantA, res, order.map(d => rule({ dayOfWeek: d, startTime: '11:00', endTime: '13:00' })));
        expect(r).toEqual({ ok: false, reason: 'overlap' });
        expect(await rulesIn('court-1')).toBe(1);
      }
    });

    it('a batch that overlaps ITSELF is refused whole: the guard sees the rows the same statement inserted', async () => {
      const r = await repo.createRules(tenantA, res, [rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '11:00', endTime: '13:00' })]);
      expect(r).toEqual({ ok: false, reason: 'overlap' });
      expect(await rulesIn('court-1')).toBe(0);
      const touching = await repo.createRules(tenantA, res, [rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '12:00', endTime: '24:00' })]);
      expect(touching.ok).toBe(true);
      expect(await rulesIn('court-1')).toBe(2);
    });

    it('an archived offering or an inactive resource refuses the whole batch', async () => {
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-2'");
      expect(await repo.createRules(tenantA, { kind: 'resource', id: 'court-2' }, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })])).toEqual({ ok: false, reason: 'owner_inactive' });
      await getPool().query("UPDATE scheduling_offerings SET archived_at = now() WHERE id = 'off-1'");
      expect(await repo.createRules(tenantA, off, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })])).toEqual({ ok: false, reason: 'owner_archived' });
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
    });

    it('tenant isolation: another organisation\'s owner, or one that does not exist, stores nothing and reads as not_found', async () => {
      expect(await repo.createRules(tenantA, { kind: 'resource', id: 'court-b' }, [rule()])).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createRules(tenantB, res, [rule()])).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.createRules(tenantA, { kind: 'offering', id: 'nope' }, [rule()])).toEqual({ ok: false, reason: 'not_found' });
      expect(await count('SELECT count(*) FROM scheduling_availability_rules')).toBe(0);
      const own = await repo.createRules(tenantB, { kind: 'resource', id: 'court-b' }, [rule({ dayOfWeek: 4 }), rule({ dayOfWeek: 5 })]);
      expect(own.ok).toBe(true);
      expect(await count("SELECT count(*) FROM scheduling_availability_rules WHERE organisation_id = 'org-bc-b'")).toBe(2);
      expect(await repo.listRules(tenantA, res)).toEqual([]);
    });

    it('needs the management permission, valid rules, and at most 14 of them', async () => {
      await expect(repo.createRules(viewerA, res, [rule()])).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(repo.createRules(tenantA, res, [])).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRules(tenantA, res, [rule(), rule({ dayOfWeek: 9 })])).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRules(tenantA, res, [rule({ startTime: '12:00', endTime: '09:00' })])).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createRules(tenantA, res, Array.from({ length: 15 }, (_, i) => rule({ dayOfWeek: i % 7 })))).rejects.toBeInstanceOf(SchedulingError);
      expect(await rulesIn('court-1')).toBe(0);
    });

    it('concurrent identical batches: exactly one commits, whole; the others are refused and leave nothing', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 }), rule({ dayOfWeek: 3 })])));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'overlap')).toBe(true);
      expect(await rulesIn('court-1')).toBe(3);
    });

    it('concurrent batches that overlap in opposite tuple order never deadlock: one wins, whole', async () => {
      for (let round = 0; round < 8; round++) {
        await getPool().query('DELETE FROM scheduling_availability_rules');
        const a = repo.createRules(tenantA, res, [rule({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }), rule({ dayOfWeek: 2, startTime: '09:00', endTime: '10:00' })]);
        const b = repo.createRules(tenantA, res, [rule({ dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }), rule({ dayOfWeek: 1, startTime: '09:30', endTime: '10:30' })]);
        const [ra, rb] = await Promise.all([a, b]); // a deadlock would reject with 40P01 and fail the test
        expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
        expect(await rulesIn('court-1')).toBe(2);
      }
    });

    it('concurrent batches with disjoint windows (seven overnight pairs, one per weekday) all commit, whole', async () => {
      const results = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6].map(d => {
          const pair = splitOvernightRule({ dayOfWeek: d, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null });
          return repo.createRules(tenantA, res, pair.map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime })));
        }),
      );
      expect(results.every(r => r.ok)).toBe(true);
      expect(await rulesIn('court-1')).toBe(14);
    });

    it('a batch racing the owner being deactivated or archived is never a deadlock and never leaves a rule on an unavailable owner', async () => {
      for (let round = 0; round < 6; round++) {
        await getPool().query('DELETE FROM scheduling_availability_rules');
        await getPool().query("UPDATE scheduling_resources SET active = true WHERE id = 'court-1'");
        const batch = repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })]);
        const stop = getPool().query("UPDATE scheduling_resources SET active = false WHERE id = 'court-1'");
        const [r] = await Promise.all([batch, stop]);
        const stored = await rulesIn('court-1');
        expect(r.ok ? stored === 2 : stored === 0).toBe(true); // all or none, whichever won the race
      }
    });

    it('writes no reservation, hold or occurrence', async () => {
      await repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })]);
      expect(await count('SELECT (SELECT count(*) FROM scheduling_reservations) + (SELECT count(*) FROM scheduling_occurrences) + (SELECT count(*) FROM scheduling_resource_holds)')).toBe(0);
    });
  });

  describe('before migration 035 (034 only)', () => {
    it('reports no partial-day capability, and full-day closures behave exactly as before', async () => {
      expect(await repo.capabilities(tenantA)).toEqual({ partialClosures: false });
      const c = await repo.createException(tenantA, res, closure({ fromDate: '2027-04-02', toDate: '2027-04-05', reason: 'Easter' }));
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.value).toMatchObject({ startTime: null, endTime: null, fromDate: '2027-04-02', toDate: '2027-04-05' });
      expect((await repo.listExceptions(tenantA, res)).map(e => [e.startTime, e.endTime])).toEqual([[null, null]]);
      expect(await repo.createException(tenantA, res, closure({ fromDate: '2027-04-05', toDate: '2027-04-06' }))).toEqual({ ok: false, reason: 'overlap' });
    });

    it('a partial-day closure is refused with PartialClosuresNotReadyError and nothing is written (fail closed)', async () => {
      const before = await exceptionsIn('court-1');
      await expect(repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }))).rejects.toBeInstanceOf(PartialClosuresNotReadyError);
      expect(await exceptionsIn('court-1')).toBe(before);
      const full = await repo.createException(tenantA, res, closure({ fromDate: '2027-05-01', toDate: '2027-05-01' }));
      expect(full.ok).toBe(true);
      if (!full.ok) return;
      await expect(repo.updateException(tenantA, full.value.id, full.value.updatedAt, { startTime: '12:00', endTime: '13:00' })).rejects.toBeInstanceOf(PartialClosuresNotReadyError);
      const still = (await repo.getException(tenantA, full.value.id))!;
      expect(still.updatedAt).toBe(full.value.updatedAt); // untouched
      expect([still.startTime, still.endTime]).toEqual([null, null]);
    });

    it('weekly rules and batches are unaffected', async () => {
      expect((await repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })])).ok).toBe(true);
    });

    it('the one-sided or backwards window is refused by the repository before it reaches the database', async () => {
      await expect(repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: null }))).rejects.toBeInstanceOf(SchedulingError);
      await expect(repo.createException(tenantA, res, closure({ startTime: '13:00', endTime: '12:00' }))).rejects.toBeInstanceOf(SchedulingError);
    });
  });

  describe('migration 035 applied', () => {
    let guardBody035 = '';
    beforeAll(async () => {
      await runScript(sqlFile('035_availability_partial_closures.sql'));
      guardBody035 = await bodyHash('scheduling_availability_exception_integrity');
    }, 60_000);

    it('replaces only the exception guard function, adds the window columns, the constraint and the marker', async () => {
      expect(guardBody035).not.toBe(guardBody034);
      expect(await count("SELECT count(*) FROM information_schema.columns WHERE table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time','end_time')")).toBe(2);
      expect(await count("SELECT count(*) FROM pg_constraint WHERE conname = 'scheduling_availability_exceptions_window_ck'")).toBe(1);
      expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.2'")).toBe(1);
      expect(await count("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname LIKE 'scheduling_availability_%'")).toBe(4);
      expect(await repo.capabilities(tenantA)).toEqual({ partialClosures: true });
    });

    it('is idempotent: applying it again changes nothing', async () => {
      await runScript(sqlFile('035_availability_partial_closures.sql'));
      await runScript(sqlFile('035_availability_partial_closures.sql'));
      expect(await bodyHash('scheduling_availability_exception_integrity')).toBe(guardBody035);
      expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.2'")).toBe(1);
    });

    it('stores a partial-day closure, round-trips 24:00, and a full-day closure keeps no window', async () => {
      const a = await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:30', reason: 'Lunch' }));
      const b = await repo.createException(tenantA, res, closure({ fromDate: '2027-04-09', toDate: '2027-04-09', startTime: '22:00', endTime: '24:00' }));
      const c = await repo.createException(tenantA, res, closure({ fromDate: '2027-04-10', toDate: '2027-04-12' }));
      for (const r of [a, b, c]) expect(r.ok).toBe(true);
      const list = await repo.listExceptions(tenantA, res);
      expect(list.map(e => [e.fromDate, e.startTime, e.endTime])).toEqual([['2027-04-02', '12:00', '13:30'], ['2027-04-09', '22:00', '24:00'], ['2027-04-10', null, null]]);
    });

    it('two closures on one date may remove different times; overlapping times and whole-day vs partial are refused, either order', async () => {
      expect((await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }))).ok).toBe(true);
      expect((await repo.createException(tenantA, res, closure({ startTime: '15:00', endTime: '16:00' }))).ok).toBe(true);
      expect((await repo.createException(tenantA, res, closure({ startTime: '13:00', endTime: '14:00' }))).ok).toBe(true); // touching
      expect(await repo.createException(tenantA, res, closure({ startTime: '12:30', endTime: '12:45' }))).toEqual({ ok: false, reason: 'overlap' });
      expect(await repo.createException(tenantA, res, closure({ startTime: '11:00', endTime: '24:00' }))).toEqual({ ok: false, reason: 'overlap' });
      expect(await repo.createException(tenantA, res, closure())).toEqual({ ok: false, reason: 'overlap' }); // whole day over partials
      expect((await repo.createException(tenantA, res, closure({ fromDate: '2027-04-03', toDate: '2027-04-03' }))).ok).toBe(true); // another date
      expect(await repo.createException(tenantA, res, closure({ fromDate: '2027-04-03', toDate: '2027-04-04', startTime: '09:00', endTime: '10:00' }))).toEqual({ ok: false, reason: 'overlap' }); // the whole-day 3rd
      expect((await repo.createException(tenantA, off, closure({ startTime: '12:00', endTime: '13:00' }))).ok).toBe(true); // another owner
    });

    it('a pre-existing full-day closure keeps its meaning: it still covers every time of its dates', async () => {
      await getPool().query(
        "INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, from_date, to_date, kind) VALUES ('legacy-1', $1, 'court-2', '2027-06-01', '2027-06-02', 'closed')",
        [A],
      );
      expect(await repo.createException(tenantA, { kind: 'resource', id: 'court-2' }, closure({ fromDate: '2027-06-02', toDate: '2027-06-02', startTime: '08:00', endTime: '09:00' }))).toEqual({ ok: false, reason: 'overlap' });
    });

    it('edits: change the window, clear it to make the closure full-day, set one on a full-day closure; stale tokens are refused', async () => {
      const made = await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }));
      if (!made.ok) throw new Error('setup');
      const moved = await repo.updateException(tenantA, made.value.id, made.value.updatedAt, { startTime: '14:00', endTime: '15:00' });
      expect(moved.ok && [moved.value.startTime, moved.value.endTime]).toEqual(['14:00', '15:00']);
      expect(await repo.updateException(tenantA, made.value.id, made.value.updatedAt, { startTime: '16:00', endTime: '17:00' })).toEqual({ ok: false, reason: 'stale_write' });
      const cleared = await repo.updateException(tenantA, made.value.id, moved.ok ? moved.value.updatedAt : '', { startTime: null, endTime: null });
      expect(cleared.ok && [cleared.value.startTime, cleared.value.endTime]).toEqual([null, null]);
      const again = await repo.updateException(tenantA, made.value.id, cleared.ok ? cleared.value.updatedAt : '', { startTime: '10:00', endTime: '11:00' });
      expect(again.ok && [again.value.startTime, again.value.endTime]).toEqual(['10:00', '11:00']);
      await expect(repo.updateException(tenantA, made.value.id, again.ok ? again.value.updatedAt : '', { startTime: '10:00' })).rejects.toBeInstanceOf(SchedulingError);
    });

    it('an edit that would overlap another closure of the owner is refused and changes nothing', async () => {
      await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }));
      const other = await repo.createException(tenantA, res, closure({ startTime: '15:00', endTime: '16:00' }));
      if (!other.ok) throw new Error('setup');
      expect(await repo.updateException(tenantA, other.value.id, other.value.updatedAt, { startTime: '12:30', endTime: '13:30' })).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.getException(tenantA, other.value.id))?.updatedAt).toBe(other.value.updatedAt);
    });

    it('the database refuses raw SQL too: a backwards or one-sided window (CHECK), an overlap (SCOVL), an owner change (SCOWN)', async () => {
      const raw = (cols: string, vals: string) =>
        getPool().query(`INSERT INTO scheduling_availability_exceptions (id, organisation_id, resource_id, from_date, to_date, kind, ${cols}) VALUES (gen_random_uuid()::text, $1, 'court-1', '2027-07-01', '2027-07-01', 'closed', ${vals})`, [A]);
      expect(await sqlstateOf(raw('start_time, end_time', "'13:00', '12:00'"))).toBe('23514');
      expect(await sqlstateOf(raw('start_time, end_time', "'12:00', '12:00'"))).toBe('23514');
      expect(await sqlstateOf(raw('start_time', "'12:00'"))).toBe('23514');
      expect(await sqlstateOf(raw('start_time, end_time', "'12:00', '13:00'"))).toBeNull();
      expect(await sqlstateOf(raw('start_time, end_time', "'12:30', '14:00'"))).toBe('SCOVL');
      expect(await sqlstateOf(raw('start_time, end_time', "'13:00', '24:00'"))).toBeNull();
      const row = (await repo.listExceptions(tenantA, res)).find(e => e.fromDate === '2027-07-01');
      expect(await sqlstateOf(getPool().query("UPDATE scheduling_availability_exceptions SET resource_id = 'court-2' WHERE id = $1", [row!.id]))).toBe('SCOWN');
    });

    it('concurrent overlapping partial-day closures: exactly one commits; disjoint ones all commit', async () => {
      const same = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createException(tenantA, res, closure({ fromDate: '2027-08-01', toDate: '2027-08-01', startTime: `10:${String(i).padStart(2, '0')}`, endTime: '11:30' }))));
      expect(same.filter(r => r.ok)).toHaveLength(1);
      const disjoint = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.createException(tenantA, res, closure({ fromDate: '2027-08-02', toDate: '2027-08-02', startTime: `${String(i * 2).padStart(2, '0')}:00`, endTime: `${String(i * 2 + 1).padStart(2, '0')}:00` }))));
      expect(disjoint.every(r => r.ok)).toBe(true);
    });

    it('parity: the database and the core advisory check agree on seeded sets of partial-day and full-day closures', async () => {
      let seed = 20271004;
      const next = (n: number) => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed % n;
      };
      const hhmm = (m: number) => (m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      for (let round = 0; round < 12; round++) {
        await getPool().query('DELETE FROM scheduling_availability_exceptions');
        const stored: StoredAvailabilityException[] = [];
        for (let i = 0; i < 14; i++) {
          const day = 1 + next(5);
          const length = next(3);
          const partial = next(3) > 0;
          const s = next(23) * 60 + next(4) * 15;
          const e = Math.min(1440, s + 15 + next(8) * 60);
          const candidate = closure({ fromDate: `2027-09-${String(day).padStart(2, '0')}`, toDate: `2027-09-${String(day + length).padStart(2, '0')}`, ...(partial && e > s ? { startTime: hhmm(s), endTime: hhmm(e) } : {}) });
          const advisory = checkExceptionWrite(res, stored, candidate);
          expect(advisory.problems, JSON.stringify(candidate)).toEqual([]);
          const r = await repo.createException(tenantA, res, candidate);
          expect(r.ok, `${JSON.stringify(candidate)} vs ${JSON.stringify(stored.map(x => [x.fromDate, x.toDate, x.startTime, x.endTime]))}`).toBe(!advisory.overlaps);
          if (r.ok) stored.push(r.value);
        }
      }
    });

    it('availability never touches a reservation, hold or occurrence', async () => {
      await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }));
      expect(await count('SELECT (SELECT count(*) FROM scheduling_reservations) + (SELECT count(*) FROM scheduling_occurrences) + (SELECT count(*) FROM scheduling_resource_holds)')).toBe(0);
    });

    it('rollback 096 REFUSES while a partial-day closure exists and changes nothing', async () => {
      await repo.createException(tenantA, res, closure({ startTime: '12:00', endTime: '13:00' }));
      expect(await runRefusing(sqlFile('096_availability_partial_closures_rollback.sql'))).toBe('SCVER');
      expect(await count("SELECT count(*) FROM information_schema.columns WHERE table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time','end_time')")).toBe(2);
      expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.2'")).toBe(1);
      expect(await bodyHash('scheduling_availability_exception_integrity')).toBe(guardBody035);
      expect(await exceptionsIn('court-1')).toBe(1);
    });

    it('rollback 096 with only full-day closures: restores 034\'s guard byte for byte, keeps the data, drops the columns; idempotent; 035 re-applies', async () => {
      await getPool().query('DELETE FROM scheduling_availability_exceptions');
      await repo.createException(tenantA, res, closure({ fromDate: '2027-10-01', toDate: '2027-10-03', reason: 'kept' }));
      await runScript(sqlFile('096_availability_partial_closures_rollback.sql'));
      await runScript(sqlFile('096_availability_partial_closures_rollback.sql'));
      expect(await bodyHash('scheduling_availability_exception_integrity')).toBe(guardBody034);
      expect(await count("SELECT count(*) FROM information_schema.columns WHERE table_name = 'scheduling_availability_exceptions' AND column_name IN ('start_time','end_time')")).toBe(0);
      expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.2'")).toBe(0);
      expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.3.1'")).toBe(1); // 034 stays in force
      expect(await repo.capabilities(tenantA)).toEqual({ partialClosures: false });
      const kept = await repo.listExceptions(tenantA, res);
      expect(kept.map(e => [e.fromDate, e.toDate, e.reason, e.startTime])).toEqual([['2027-10-01', '2027-10-03', 'kept', null]]);
      expect(await repo.createException(tenantA, res, closure({ fromDate: '2027-10-02', toDate: '2027-10-02' }))).toEqual({ ok: false, reason: 'overlap' }); // 034's guard works again
      await runScript(sqlFile('035_availability_partial_closures.sql'));
      await runScript(sqlFile('035_availability_partial_closures.sql'));
      expect(await bodyHash('scheduling_availability_exception_integrity')).toBe(guardBody035);
      expect(await repo.capabilities(tenantA)).toEqual({ partialClosures: true });
    });

    it('035 refuses to run without 034', async () => {
      await getPool().query("DELETE FROM scheduling_availability_exceptions");
      const keep = (await getPool().query("SELECT version, description FROM scheduling_schema_migrations WHERE version = '2b.3.1'")).rows[0];
      await getPool().query("DELETE FROM scheduling_schema_migrations WHERE version = '2b.3.1'");
      try {
        expect(await runRefusing(sqlFile('035_availability_partial_closures.sql'))).toBe('SCVER');
      } finally {
        await getPool().query('INSERT INTO scheduling_schema_migrations (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING', [keep.version, keep.description]);
      }
    });
  });

  describe('fail closed when migration 034 is not applied', () => {
    it('createRules reports AvailabilityNotReadyError and writes nothing; re-applying 034 restores it', async () => {
      await runScript(sqlFile('096_availability_partial_closures_rollback.sql'));
      const rollback = sqlFile('095_availability_integrity_rollback.sql');
      await runScript(rollback);
      try {
        await expect(repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })])).rejects.toBeInstanceOf(AvailabilityNotReadyError);
        await expect(repo.capabilities(tenantA)).resolves.toEqual({ partialClosures: false });
        expect(await rulesIn('court-1')).toBe(0);
      } finally {
        await runScript(sqlFile('034_availability_integrity.sql'));
      }
      expect((await repo.createRules(tenantA, res, [rule({ dayOfWeek: 1 }), rule({ dayOfWeek: 2 })])).ok).toBe(true);
    });
  });
});
