import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import {
  AvailabilityZonesNotReadyError,
  splitOvernightRule,
  type AvailabilityOwner,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type TenantContext,
} from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';

// THE REAL DRIVER. Everything else in this package is proved on node-postgres against a Docker database; the application talks to Neon through the
// HTTP driver (`neon(url)`, lib/db.ts), whose differences matter here:
//   * one statement per request, each in its own implicit transaction: there is no interactive BEGIN ... COMMIT across requests, and a request that
//     names several statements is refused. So every repository operation is ONE statement (executor.ts), and the first-write pin is a CTE inside it.
//   * every call is its own HTTPS request, so concurrent calls run on separate server connections: a real race, not a serialised queue.
//   * errors arrive as NeonDbError carrying the SQLSTATE in `.code`.
// This file runs only when SCHEDULING_NEON_DRIVER_URL names a DISPOSABLE Neon branch (a role created for it; never Production). It creates its own
// synthetic organisations' owners with unique ids and removes them. SCHEDULING_NEON_PHASE = 'pre036' (034/035 applied, 036 not) or 'post036'.

const URL = process.env.SCHEDULING_NEON_DRIVER_URL ?? '';
const PHASE = process.env.SCHEDULING_NEON_PHASE ?? 'post036';
const suite = URL ? describe : describe.skip;

const A = 'zz-drv-a';
const B = 'zz-drv-b';
const tenant = (organisationId: string, timezone: string, permissions = ['scheduling.view', 'scheduling.manage']): TenantContext => ({
  organisationId, timezone, actor: { kind: 'staff', userId: `driver-user-${organisationId}` }, can: p => permissions.includes(p),
});
const tenantA = tenant(A, 'Australia/Sydney');
const tenantB = tenant(B, 'Australia/Adelaide');

const rule = (over: Partial<NewStoredRuleInput> = {}): NewStoredRuleInput => ({ kind: 'hours', label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null, ...over });
const closure = (over: Partial<NewStoredExceptionInput> = {}): NewStoredExceptionInput => ({ fromDate: '2027-04-02', toDate: '2027-04-02', kind: 'closed', reason: null, ...over });

suite(`availability on the REAL Neon HTTP driver (${PHASE})`, () => {
  const sql = neon(URL);
  const run = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => sql.query(text, params) as Promise<T[]>;
  const repo = new PostgresAvailabilityRepository({ sql: fromNeonHttpLike(sql as unknown as { query(text: string, params?: unknown[]): Promise<unknown> }) });
  const made: Array<{ kind: 'resource' | 'offering'; id: string; org: string }> = [];
  let n = 0;
  const stamp = Date.now().toString(36);

  async function resource(org = A): Promise<AvailabilityOwner> {
    const id = `zz-r-${stamp}-${++n}`;
    await run("INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', $3, 4, true)", [id, org, `ZZ ${id}`]);
    made.push({ kind: 'resource', id, org });
    return { kind: 'resource', id };
  }
  async function offering(schedule = 'zz-sch-a', org = A): Promise<AvailabilityOwner> {
    const id = `zz-o-${stamp}-${++n}`;
    await run("INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, $4, 10, 60, 0, 'AUD')", [id, org, schedule, `ZZ ${id}`]);
    made.push({ kind: 'offering', id, org });
    return { kind: 'offering', id };
  }
  const count = async (text: string, params: unknown[] = []) => Number((await run<{ n: string }>(text, params))[0].n);
  const rulesOf = (o: AvailabilityOwner) => count(`SELECT count(*) AS n FROM scheduling_availability_rules WHERE ${o.kind}_id = $1`, [o.id]);
  const pinsOf = (o: AvailabilityOwner) => count('SELECT count(*) AS n FROM scheduling_availability_zones WHERE owner_id = $1', [o.id]);
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'no-code';
    }
  };

  afterAll(async () => {
    // remove what this run created: rules and closures first, then the owners (a pin goes with its owner)
    for (const o of made.reverse()) {
      await run(`DELETE FROM scheduling_availability_rules WHERE ${o.kind}_id = $1`, [o.id]).catch(() => undefined);
      await run(`DELETE FROM scheduling_availability_exceptions WHERE ${o.kind}_id = $1`, [o.id]).catch(() => undefined);
      await run(`DELETE FROM ${o.kind === 'resource' ? 'scheduling_resources' : 'scheduling_offerings'} WHERE id = $1 AND organisation_id = $2`, [o.id, o.org]).catch(() => undefined);
    }
  }, 120_000);

  beforeAll(async () => {
    const who = (await run<{ u: string; v: string }>('SELECT current_user AS u, current_setting(\'transaction_isolation\') AS v'))[0];
    expect(who.u).toBe('driver_proof'); // the disposable role, never an owner
    expect(who.v).toBe('read committed'); // what the 034/035/036 guards require
  }, 120_000);

  describe('what the driver is (documented limits, observed)', () => {
    it('runs one statement per request: a request that names several statements is refused, so nothing relies on a multi-statement transaction', async () => {
      expect(await codeOf(run('SELECT 1 AS a; SELECT 2 AS b'))).toBe('42601'); // "cannot insert multiple commands into a prepared statement"
      // two requests never share a transaction: a value set "locally" in one is gone in the next
      expect(await codeOf(run("SELECT set_config('zz.driver_probe', 'x', true)"))).toBeNull();
      expect((await run<{ v: string | null }>("SELECT current_setting('zz.driver_probe', true) AS v"))[0].v ?? '').toBe('');
    });

    it('carries the SQLSTATE of a database error in .code (what the repository maps)', async () => {
      expect(await codeOf(run('SELECT * FROM scheduling_does_not_exist'))).toBe('42P01');
      expect(await codeOf(run('SELECT nope FROM scheduling_resources'))).toBe('42703');
    });

    it('a data-modifying CTE with RETURNING runs, atomically, as ONE request (the shape of every pinned create)', async () => {
      const o = await resource();
      expect(await codeOf(run("WITH x AS (UPDATE scheduling_resources SET name = name WHERE id = $1 AND organisation_id = $2 RETURNING id) SELECT count(*)::int AS n FROM x", [o.id, A]))).toBeNull();
    });
  });

  if (PHASE === 'pre036') {
    describe('BEFORE migration 036 the create path fails closed under the real driver', () => {
      it('reads work: rules and closures list, the zone is null, capabilities say zones are not installed', async () => {
        const o = await resource();
        expect(await repo.listRules(tenantA, o)).toEqual([]);
        expect(await repo.listExceptions(tenantA, o)).toEqual([]);
        expect(await repo.getZone(tenantA, o)).toBeNull();
        await expect(repo.capabilities(tenantA)).resolves.toMatchObject({ zones: false });
      });

      it('every create is refused with AvailabilityZonesNotReadyError (the driver reported 42P01) and NOTHING is written', async () => {
        const o = await resource();
        const off = await offering();
        await expect(repo.createRule(tenantA, o, rule(), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        await expect(repo.createRules(tenantA, o, splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null }).map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime })), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        await expect(repo.createException(tenantA, off, closure(), 'Australia/Sydney')).rejects.toBeInstanceOf(AvailabilityZonesNotReadyError);
        expect(await rulesOf(o)).toBe(0);
        expect(await count('SELECT count(*) AS n FROM scheduling_availability_exceptions WHERE offering_id = $1', [off.id])).toBe(0);
        expect(await count("SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'scheduling_availability_zones'")).toBe(0);
      });


    });
    return;
  }

  describe('first-write atomicity over HTTP', () => {
    it('the first rule pins the owner zone in the same request; a second write naming that zone finds the pin; naming ANOTHER zone is an explicit conflict; tokens are microsecond strings', async () => {
      const o = await resource();
      const first = await repo.createRule(tenantA, o, rule(), 'Australia/Adelaide');
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.pinned).toMatchObject({ timezone: 'Australia/Adelaide', source: 'first_rule', pinnedBy: 'driver-user-zz-drv-a' });
      expect(first.value.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      const second = await repo.createRule(tenantA, o, rule({ dayOfWeek: 2 }), 'Australia/Adelaide');
      expect(second.ok && second.pinned).toBeNull();
      // a writer that asked for Australia/Perth cannot save hours under the existing Australia/Adelaide pin: explicit conflict, nothing written
      const rulesBefore = await rulesOf(o);
      expect(await repo.createRule(tenantA, o, rule({ dayOfWeek: 3 }), 'Australia/Perth')).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await repo.createRules(tenantA, o, [rule({ dayOfWeek: 4 }), rule({ dayOfWeek: 5 })], 'Australia/Perth')).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await repo.createException(tenantA, o, closure(), 'Australia/Perth')).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Adelaide' });
      expect(await rulesOf(o)).toBe(rulesBefore);
      expect(await count('SELECT count(*) AS n FROM scheduling_availability_exceptions WHERE resource_id = $1', [o.id])).toBe(0);
      expect((await repo.getZone(tenantA, o))?.timezone).toBe('Australia/Adelaide');
      expect(await pinsOf(o)).toBe(1);
    });

    it('a REFUSED first write leaves no pin: a self-overlapping batch, an archived offering and an inactive resource', async () => {
      const o = await resource();
      expect(await repo.createRules(tenantA, o, [rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '11:00', endTime: '13:00' })], 'Australia/Perth')).toEqual({ ok: false, reason: 'overlap' });
      const off = await offering();
      await run('UPDATE scheduling_offerings SET archived_at = now() WHERE id = $1 AND organisation_id = $2', [off.id, A]);
      expect(await repo.createRule(tenantA, off, rule(), 'Australia/Perth')).toEqual({ ok: false, reason: 'owner_archived' });
      const dead = await resource();
      await run('UPDATE scheduling_resources SET active = false WHERE id = $1 AND organisation_id = $2', [dead.id, A]);
      expect(await repo.createException(tenantA, dead, closure(), 'Australia/Perth')).toEqual({ ok: false, reason: 'owner_inactive' });
      for (const x of [o, off, dead]) {
        expect(await pinsOf(x)).toBe(0);
        expect(await rulesOf(x)).toBe(0);
      }
    });

    it('the database refuses availability that has no pin, over the same driver (SCZON)', async () => {
      const o = await resource();
      expect(await codeOf(run("INSERT INTO scheduling_availability_rules (id, organisation_id, resource_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, 1, '09:00', '10:00')", [`zz-raw-${stamp}-${++n}`, A, o.id]))).toBe('SCZON');
    });

    it('a pin cannot be changed or removed through the driver, and a write cannot change it', async () => {
      const o = await resource();
      await repo.createRule(tenantA, o, rule(), 'Australia/Perth');
      expect(await codeOf(run("UPDATE scheduling_availability_zones SET timezone = 'Europe/London' WHERE owner_id = $1", [o.id]))).toBe('SCZON');
      expect(await codeOf(run('DELETE FROM scheduling_availability_zones WHERE owner_id = $1', [o.id]))).toBe('SCZON');
      expect((await repo.getZone(tenantA, o))?.timezone).toBe('Australia/Perth');
    });

    it('tenant isolation: another organisation cannot pin, write or read this organisation\'s owner', async () => {
      const o = await resource();
      expect(await repo.createRule(tenantB, o, rule(), 'Europe/London')).toEqual({ ok: false, reason: 'not_found' });
      expect(await repo.getZone(tenantB, o)).toBeNull();
      expect(await pinsOf(o)).toBe(0);
      const mine = await repo.createRule(tenantA, o, rule(), 'Australia/Perth');
      expect(mine.ok).toBe(true);
      expect(await repo.getZone(tenantB, o)).toBeNull();
    });
  });

  describe('concurrent first writes over separate HTTP requests (a real race on the server)', () => {
    it('12 simultaneous first writes naming 12 different zones: exactly ONE succeeds and pins; the other 11 get zone_mismatch naming the winner and write nothing', async () => {
      const o = await resource();
      const zones = ['Australia/Perth', 'Australia/Sydney', 'Australia/Darwin', 'Europe/London', 'America/New_York', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/Berlin', 'America/Chicago', 'Africa/Cairo', 'Australia/Lord_Howe'];
      const results = await Promise.all(zones.map((z, i) => repo.createRule(tenantA, o, rule({ dayOfWeek: i % 7, startTime: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, endTime: `${String(9 + Math.floor(i / 7)).padStart(2, '0')}:00` }), z)));
      expect(await pinsOf(o)).toBe(1);
      const stored = (await repo.getZone(tenantA, o))!.timezone;
      expect(zones).toContain(stored);
      const ok = results.filter(r => r.ok);
      expect(ok).toHaveLength(1);
      expect(ok[0].ok && ok[0].pinned?.timezone).toBe(stored);
      const refused = results.filter(r => !r.ok);
      expect(refused).toHaveLength(11);
      expect(refused.every(r => !r.ok && r.reason === 'zone_mismatch' && r.detail === stored)).toBe(true);
      expect(await rulesOf(o)).toBe(1);
    }, 120_000);

    it('12 simultaneous first writes all naming the SAME zone: all succeed, one pin, one reports it', async () => {
      const o = await resource();
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.createRule(tenantA, o, rule({ dayOfWeek: i % 7, startTime: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`, endTime: `${String(9 + Math.floor(i / 7)).padStart(2, '0')}:00` }), 'Australia/Perth')));
      expect(results.every(r => r.ok)).toBe(true);
      expect(results.filter(r => r.ok && r.pinned)).toHaveLength(1);
      expect(await pinsOf(o)).toBe(1);
      expect(await rulesOf(o)).toBe(12);
    }, 120_000);

    it('racing identical windows with two zones: one commits; same-zone losers are overlap, other-zone losers are zone_mismatch; one pin, one rule', async () => {
      const o = await resource();
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.createRule(tenantA, o, rule(), i % 2 === 0 ? 'Australia/Perth' : 'Europe/London')));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      const stored = (await repo.getZone(tenantA, o))!.timezone;
      expect(results.filter(r => !r.ok && r.reason === 'zone_mismatch')).toHaveLength(5);
      expect(results.filter(r => !r.ok && r.reason === 'zone_mismatch').every(r => !r.ok && r.detail === stored)).toBe(true);
      expect(results.filter(r => !r.ok && r.reason === 'overlap')).toHaveLength(4);
      expect(await pinsOf(o)).toBe(1);
      expect(await rulesOf(o)).toBe(1);
    }, 120_000);

    it('a first rule racing a first closure of the same owner naming different zones: one pin, one succeeds, the other is a zone conflict', async () => {
      const o = await offering();
      const [r, c] = await Promise.all([repo.createRule(tenantA, o, rule(), 'Australia/Perth'), repo.createException(tenantA, o, closure(), 'Europe/London')]);
      expect(await pinsOf(o)).toBe(1);
      expect([r.ok, c.ok].filter(Boolean)).toHaveLength(1);
      const loser = r.ok ? c : r;
      expect(!loser.ok && loser.reason).toBe('zone_mismatch');
    }, 120_000);
  });

  describe('the rest of the availability behaviour, over the driver', () => {
    it('overlapping weekly rules are refused, touching ones accepted; stale writes are refused; the token is compared at microsecond precision', async () => {
      const o = await resource();
      const a = await repo.createRule(tenantA, o, rule({ startTime: '09:00', endTime: '12:00' }), 'Australia/Sydney');
      if (!a.ok) throw new Error('setup');
      expect(await repo.createRule(tenantA, o, rule({ startTime: '11:00', endTime: '13:00' }), 'Australia/Sydney')).toEqual({ ok: false, reason: 'overlap' });
      expect((await repo.createRule(tenantA, o, rule({ startTime: '12:00', endTime: '24:00' }), 'Australia/Sydney')).ok).toBe(true);
      const moved = await repo.updateRule(tenantA, a.value.id, a.value.updatedAt, { label: 'peak' });
      expect(moved.ok).toBe(true);
      expect(await repo.updateRule(tenantA, a.value.id, a.value.updatedAt, { label: 'stale' })).toEqual({ ok: false, reason: 'stale_write' });
    });

    it('concurrent edits of one row with one token: exactly one wins, the others are stale', async () => {
      const o = await resource();
      const a = await repo.createRule(tenantA, o, rule(), 'Australia/Sydney');
      if (!a.ok) throw new Error('setup');
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.updateRule(tenantA, a.value.id, a.value.updatedAt, { label: `edit ${i}` })));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok && r.reason === 'stale_write')).toHaveLength(7);
    }, 120_000);

    it('archived offering and inactive resource refuse availability (SCARC / SCRES arrive through the driver)', async () => {
      const off = await offering();
      const res = await resource();
      await repo.createRule(tenantA, off, rule(), 'Australia/Sydney');
      await repo.createRule(tenantA, res, rule(), 'Australia/Sydney');
      await run('UPDATE scheduling_offerings SET archived_at = now() WHERE id = $1 AND organisation_id = $2', [off.id, A]);
      await run('UPDATE scheduling_resources SET active = false WHERE id = $1 AND organisation_id = $2', [res.id, A]);
      expect(await repo.createRule(tenantA, off, rule({ dayOfWeek: 2 }), 'Australia/Sydney')).toEqual({ ok: false, reason: 'owner_archived' });
      expect(await repo.createRule(tenantA, res, rule({ dayOfWeek: 2 }), 'Australia/Sydney')).toEqual({ ok: false, reason: 'owner_inactive' });
    });

    it('an overnight window is created atomically, a self-overlapping pair is refused whole, and removing the window is all-or-none', async () => {
      const o = await resource();
      const pair = splitOvernightRule({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00', validFrom: null, validTo: null }).map(p => rule({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime }));
      const created = await repo.createRules(tenantA, o, pair, 'Australia/Sydney');
      expect(created.ok && created.value.map(r => [r.dayOfWeek, r.startTime, r.endTime])).toEqual([[5, '22:00', '24:00'], [6, '00:00', '02:00']]);
      if (!created.ok) return;
      const [evening, morning] = [created.value[0], created.value[1]];
      // a stale half removes nothing
      const edited = await repo.updateRule(tenantA, morning.id, morning.updatedAt, { label: 'x' });
      expect(edited.ok).toBe(true);
      expect(await repo.deleteOvernightWindow(tenantA, [{ id: evening.id, expectedUpdatedAt: evening.updatedAt }, { id: morning.id, expectedUpdatedAt: morning.updatedAt }])).toEqual({ ok: false, reason: 'stale_write' });
      expect(await rulesOf(o)).toBe(2);
      // fresh tokens: 8 simultaneous removals, one wins, both halves go
      const fresh = await repo.listRules(tenantA, o);
      const refs = fresh.map(r => ({ id: r.id, expectedUpdatedAt: r.updatedAt })) as [{ id: string; expectedUpdatedAt: string }, { id: string; expectedUpdatedAt: string }];
      const results = await Promise.all(Array.from({ length: 8 }, () => repo.deleteOvernightWindow(tenantA, refs)));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'not_found')).toBe(true);
      expect(await rulesOf(o)).toBe(0);
    }, 120_000);

    it('partial-day closures (035): stored, overlap refused, a whole-day closure over a partial one refused, disjoint accepted', async () => {
      const o = await resource();
      expect((await repo.createException(tenantA, o, closure({ startTime: '12:00', endTime: '13:00' }), 'Australia/Sydney')).ok).toBe(true);
      expect((await repo.createException(tenantA, o, closure({ startTime: '15:00', endTime: '16:00' }), 'Australia/Sydney')).ok).toBe(true);
      expect(await repo.createException(tenantA, o, closure({ startTime: '12:30', endTime: '13:30' }), 'Australia/Sydney')).toEqual({ ok: false, reason: 'overlap' });
      expect(await repo.createException(tenantA, o, closure(), 'Australia/Sydney')).toEqual({ ok: false, reason: 'overlap' });
      await expect(repo.capabilities(tenantA)).resolves.toEqual({ partialClosures: true, zones: true });
    });
  });

  describe('a shared resource across schedules with different timezones', () => {
    it('the resource has one pinned zone; offerings of different schedules keep their own; nothing moves when the organisation or schedule timezone changes', async () => {
      const court = await resource();
      const plain = await offering('zz-sch-a');
      const perth = await offering('zz-sch-perth');
      await repo.createRule(tenantA, court, rule(), 'Australia/Sydney');
      await repo.createRule(tenantA, plain, rule(), 'Australia/Sydney'); // schedule without override: the organisation's zone
      await repo.createRule(tenantA, perth, rule(), 'Australia/Perth'); // the Perth schedule's override
      await run("INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3), ($1, $4, $3)", [A, plain.id, court.id, perth.id]).catch(() => undefined); // the link guards (030/031) may refuse a kind/preset mismatch: incidental here
      const before = await Promise.all([court, plain, perth].map(x => repo.getZone(tenantA, x)));
      expect(before.map(z => z?.timezone)).toEqual(['Australia/Sydney', 'Australia/Sydney', 'Australia/Perth']);
      const again = await repo.createRule(tenantA, court, rule({ dayOfWeek: 2 }), 'Australia/Perth'); // written "from the Perth side": the resource is Sydney's, so it is a conflict
      expect(again).toEqual({ ok: false, reason: 'zone_mismatch', detail: 'Australia/Sydney' });
      // changing the organisation's and the schedule's timezone later (here as the owner would) does not reinterpret the pins
      await run("UPDATE organisations SET timezone = 'Europe/London' WHERE id = $1", [A]).catch(() => undefined); // the driver role may not write organisations: that is fine, and itself the point
      await run("UPDATE scheduling_schedules SET timezone = 'Asia/Tokyo' WHERE id = 'zz-sch-a'");
      await run("UPDATE scheduling_schedules SET timezone = NULL WHERE id = 'zz-sch-a'");
      expect(await Promise.all([court, plain, perth].map(x => repo.getZone(tenantA, x)))).toEqual(before);
      await run('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND resource_id = $2', [A, court.id]).catch(() => undefined);
    });

    it('creating a pin touches no other table: schedules, offerings and resources (version tokens included) are byte-identical', async () => {
      const court = await resource();
      const snap = async () => (await run<{ h: string }>(
        `SELECT md5(coalesce((SELECT string_agg(s::text, '|' ORDER BY id) FROM scheduling_schedules s WHERE organisation_id = $1), '') ||
                    coalesce((SELECT string_agg(o::text, '|' ORDER BY id) FROM scheduling_offerings o WHERE organisation_id = $1), '') ||
                    coalesce((SELECT string_agg(r::text, '|' ORDER BY id) FROM scheduling_resources r WHERE organisation_id = $1), '')) AS h`,
        [A],
      ))[0].h;
      const before = await snap();
      await repo.createRule(tenantA, court, rule(), 'Australia/Perth');
      expect(await snap()).toBe(before);
    });
  });
});
