import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS, PRESET_KEYS, type CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { FixedClock, closePool, count, customerActor, ensureSchema, getPool, hasDatabase, resetData, seedOccurrence, seedOffering, seedResource, seedSchedule, staff } from './support/pgHarness';
import { makeWorld, slotBooking, type World } from './support/builders';

// Phase 2B.2 resource-concurrency hardening. The races named in the 2B.2a report are reproduced here with a second connection
// that holds a transaction open, so the interleaving is fixed and not left to timing. Each race test failed before
// 030_resource_concurrency.sql / the repository changes existed (they are the failing-first tests); the stress tests then
// check, over many random interleavings, that the same invariants hold and that no statement is ever killed as a deadlock.

const ORG = 'org-rc';
const FUTURE = '2035-06-12';
let w: World;
const clock = new FixedClock();

const sqlstateOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};
const booked = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected a reservation, got ${r.reason}`);
  return r.reservation;
};
const live = (resource: string) => count("SELECT count(*) FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL AND upper(during) > now()", [ORG, resource]);

/** Runs `fn` with repositories bound to ONE connection that has an open transaction; `finish` commits it. */
async function inTransaction<T>(fn: (tx: { config: PostgresSchedulingConfigRepository; repo: PostgresReservationRepository; sql: (text: string, params?: unknown[]) => Promise<unknown> }, finish: () => Promise<void>) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  await c.query('BEGIN');
  let finished = false;
  const finish = async () => {
    if (!finished) {
      finished = true;
      await c.query('COMMIT');
    }
  };
  try {
    return await fn(
      { config: new PostgresSchedulingConfigRepository({ sql: fromPgLike(c) }), repo: new PostgresReservationRepository({ sql: fromPgLike(c), clock }), sql: (text, params) => c.query(text, params) },
      finish,
    );
  } finally {
    if (!finished) await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}
const pending = async (p: Promise<unknown>, ms = 400) => {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  await new Promise(r => setTimeout(r, ms));
  return !settled;
};

describe.skipIf(!hasDatabase)('resource concurrency hardening (2B.2)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
    await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1');
  });

  const hire = (repo: PostgresReservationRepository, resource: string, time: string, actor = w.staff, ids = w.hire) => repo.create(actor, slotBooking(resource, FUTURE, time, 60, ids));
  const tokenOf = async (id: string) => (await w.config.listResources(w.staff)).find(r => r.id === id)!.updatedAt;

  // ─── race 1: deactivating a resource while a reservation is being created for it ──────────────────────────────

  describe('deactivation vs a new reservation', () => {
    it('a reservation in flight holds the deactivation back, which is then refused (resource_in_use) and the resource stays active', async () => {
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00')); // uncommitted: its hold is invisible to a plain guard
        const racing = w.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { active: false });
        expect(await pending(racing)).toBe(true); // it must WAIT for the booking, not race past it
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'resource_in_use' });
        expect((await w.config.listResources(w.staff)).find(r => r.id === 'court-1')!.active).toBe(true);
        expect(await live('court-1')).toBe(1);
      });
    });

    it('a deactivation in flight holds a new reservation back, which is then refused and leaves no hold on the inactive resource', async () => {
      await inTransaction(async (tx, finish) => {
        const done = await tx.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { active: false });
        expect(done.ok).toBe(true); // uncommitted
        const racing = hire(w.repo, 'court-1', '10:00');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toEqual({ ok: false, reason: 'offering_unavailable' });
        expect(await live('court-1')).toBe(0);
      });
    });

    it('the same holds for an occurrence that carries a resource (a hold written by a different statement shape)', async () => {
      await seedSchedule(ORG, 'occ-sched', 'classes_coaching');
      await seedOffering(ORG, 'occ-off', 'occ-sched', { capacity: 5 });
      await inTransaction(async (tx, finish) => {
        okOrThrow(await tx.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { active: false }));
        const racing = seedOccurrence({ id: 'occ-1', org: ORG, offeringId: 'occ-off', capacity: 5, resourceId: 'court-1' });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await sqlstateOf(racing)).toBe('SCRES');
        expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(0);
      });
    });
  });

  // ─── race 2: unlinking a resource while a reservation is being created ─────────────────────────────────────────

  describe('unlink vs a new reservation', () => {
    it('a reservation in flight holds the unlink back, which is then refused (allocation_in_use) and the link stays', async () => {
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00'));
        const racing = w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'allocation_in_use' });
        expect((await w.config.listOfferingResources(w.staff, w.hire.offering)).map(r => r.id)).toEqual(['court-1']);
      });
    });

    it('an unlink in flight holds a CUSTOMER reservation back (customers may use linked resources only): it is refused, no hold lands', async () => {
      await seedSchedule(ORG, 'pub-sched', 'resource_hire', { publicSlug: 'pub' });
      await seedOffering(ORG, 'pub-off', 'pub-sched', { capacity: null });
      await w.config.linkOfferingResource(w.staff, 'pub-off', 'court-1');
      const ids = { schedule: 'pub-sched', offering: 'pub-off' };
      await inTransaction(async (tx, finish) => {
        expect(await tx.config.unlinkOfferingResource(w.staff, 'pub-off', 'court-1')).toMatchObject({ ok: true }); // uncommitted
        const racing = hire(w.repo, 'court-1', '10:00', customerActor(ORG, 'cust-1'), ids);
        expect(await pending(racing)).toBe(true); // the customer statement must not read the link as still present
        await finish();
        expect(await racing).toEqual({ ok: false, reason: 'offering_unavailable' });
        expect(await live('court-1')).toBe(0);
        expect(await count("SELECT count(*) FROM scheduling_offering_resources WHERE offering_id = 'pub-off'")).toBe(0);
      });
    });

    it('a customer reservation in flight holds the unlink back, which is then refused', async () => {
      await seedSchedule(ORG, 'pub-sched', 'resource_hire', { publicSlug: 'pub' });
      await seedOffering(ORG, 'pub-off', 'pub-sched', { capacity: null });
      await w.config.linkOfferingResource(w.staff, 'pub-off', 'court-1');
      const ids = { schedule: 'pub-sched', offering: 'pub-off' };
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00', customerActor(ORG, 'cust-1'), ids));
        const racing = w.config.unlinkOfferingResource(w.staff, 'pub-off', 'court-1');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'allocation_in_use' });
      });
    });
  });

  // ─── race 3: a kind change against a booking or a new link ─────────────────────────────────────────────────────

  describe('kind change', () => {
    it('a reservation in flight holds a kind change back, which is then refused', async () => {
      await w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1');
      await inTransaction(async (tx, finish) => {
        booked(await hire(tx.repo, 'court-1', '10:00'));
        const racing = w.config.updateResource(w.staff, 'court-1', await tokenOf('court-1'), { kind: 'space' });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toMatchObject({ ok: false, reason: 'resource_in_use' });
        expect((await w.config.listResources(w.staff)).find(r => r.id === 'court-1')!.kind).toBe('court');
      });
    });

    it('a kind change in flight holds a link back, and the link is then refused because the new kind does not fit the offering preset', async () => {
      await seedSchedule(ORG, 'cls', 'classes_coaching'); // accepts court, space, practitioner
      await seedOffering(ORG, 'cls-off', 'cls', { capacity: 5 });
      await seedResource(ORG, 'free', 'court');
      await inTransaction(async (tx, finish) => {
        okOrThrow(await tx.config.updateResource(w.staff, 'free', await tokenOf('free'), { kind: 'room' })); // unlinked, never held: allowed; uncommitted
        const racing = w.config.linkOfferingResource(w.staff, 'cls-off', 'free');
        expect(await pending(racing)).toBe(true);
        await finish();
        await expect(racing).rejects.toMatchObject({ code: 'invalid_input' });
        expect(await count("SELECT count(*) FROM scheduling_offering_resources WHERE resource_id = 'free'")).toBe(0);
      });
    });
  });

  // ─── a writer that does NOT go through the repository (raw SQL) races exactly the same way ─────────────────────

  describe('raw link insert vs kind change (no repository, so no resource-row write to lean on)', () => {
    const rawLink = (client: { query: (t: string, p?: unknown[]) => Promise<unknown> }, offering: string, resource: string) =>
      client.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, offering, resource]);

    it('a kind change in flight holds a raw link back, which is then refused for the new kind (SCKND)', async () => {
      await seedSchedule(ORG, 'cls', 'classes_coaching');
      await seedOffering(ORG, 'cls-off', 'cls', { capacity: 5 });
      await seedResource(ORG, 'free', 'court');
      await inTransaction(async (tx, finish) => {
        await tx.sql("UPDATE scheduling_resources SET kind = 'room' WHERE organisation_id = $1 AND id = 'free'", [ORG]); // uncommitted
        const racing = rawLink(getPool(), 'cls-off', 'free');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await sqlstateOf(racing)).toBe('SCKND');
        expect(await count("SELECT count(*) FROM scheduling_offering_resources WHERE resource_id = 'free'")).toBe(0);
      });
    });

    it('a raw link in flight holds a kind change back, which is then refused (SCRIU)', async () => {
      await seedSchedule(ORG, 'cls', 'classes_coaching');
      await seedOffering(ORG, 'cls-off', 'cls', { capacity: 5 });
      await seedResource(ORG, 'free', 'court');
      await inTransaction(async (tx, finish) => {
        await rawLink({ query: tx.sql }, 'cls-off', 'free'); // uncommitted
        const racing = getPool().query("UPDATE scheduling_resources SET kind = 'space' WHERE organisation_id = $1 AND id = 'free'", [ORG]);
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await sqlstateOf(racing)).toBe('SCRIU');
        expect(await count("SELECT count(*) FROM scheduling_resources WHERE id = 'free' AND kind = 'court'")).toBe(1);
      });
    });

    it('a deactivation in flight holds a raw link back, which is then refused because the resource is inactive (SCKND)', async () => {
      await seedSchedule(ORG, 'cls', 'classes_coaching');
      await seedOffering(ORG, 'cls-off', 'cls', { capacity: 5 });
      await seedResource(ORG, 'free', 'court');
      await inTransaction(async (tx, finish) => {
        await tx.sql("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = 'free'", [ORG]); // uncommitted
        const racing = rawLink(getPool(), 'cls-off', 'free');
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await sqlstateOf(racing)).toBe('SCKND');
      });
    });
  });

  // ─── the same rules hold for ANY writer: direct SQL, as BrainBase or the standalone application would issue it ──

  describe('database-level backstop (direct SQL, no repository)', () => {
    const q = (text: string, params: unknown[] = []) => getPool().query(text, params);

    it('refuses to deactivate a resource that has a live hold (SCRIU), allows it once the hold is released or past, and always allows reactivation', async () => {
      booked(await hire(w.repo, 'court-1', '10:00'));
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBe('SCRIU');
      await q("UPDATE scheduling_resource_holds SET released_at = now() WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]);
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBeNull();
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBeNull();
    });

    it('a PAST hold never blocks a deactivation (history is not a booking that still matters)', async () => {
      booked(await w.repo.create(w.staff, slotBooking('court-1', '2026-09-01', '10:00', 60, w.hire))); // already over relative to now()
      expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE resource_id = 'court-1' AND released_at IS NULL AND upper(during) < now()")).toBe(1); // the past hold really exists
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBeNull();
    });

    it('refuses a new live hold on an inactive resource (SCRES) for a direct hold insert too', async () => {
      await q("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = 'court-1'", [ORG]);
      expect(await sqlstateOf(seedOccurrence({ id: 'occ-x', org: ORG, offeringId: w.cls.offering, capacity: 5, resourceId: 'court-1' }))).toBe('SCRES');
    });

    it('refuses a kind change once the resource is linked or has ever been held (SCRIU); allows it while neither', async () => {
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET kind = 'space' WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBe('SCRIU'); // linked
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET kind = 'space' WHERE organisation_id = $1 AND id = 'room-1'", [ORG]))).toBeNull(); // neither
      await w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1');
      booked(await hire(w.repo, 'court-1', '10:00'));
      await q("UPDATE scheduling_resource_holds SET released_at = now() WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]);
      expect(await sqlstateOf(q("UPDATE scheduling_resources SET kind = 'space' WHERE organisation_id = $1 AND id = 'court-1'", [ORG]))).toBe('SCRIU'); // released, but it has been held
    });

    it('refuses to delete a link while a live hold of that offering uses the resource (SCALU); other offerings, released and past holds do not block', async () => {
      booked(await hire(w.repo, 'court-1', '10:00'));
      expect(await sqlstateOf(q("DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]))).toBe('SCALU');
      // a second offering linked to the same resource is unaffected by the first offering's booking
      await seedSchedule(ORG, 'other', 'resource_hire');
      await seedOffering(ORG, 'other-off', 'other', { capacity: null });
      await w.config.linkOfferingResource(w.staff, 'other-off', 'court-1');
      expect(await sqlstateOf(q("DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = 'other-off'", [ORG]))).toBeNull();
      await q("UPDATE scheduling_resource_holds SET released_at = now() WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]);
      expect(await sqlstateOf(q("DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND resource_id = 'court-1'", [ORG]))).toBeNull();
    });

    it('refuses a link whose resource kind the offering preset does not accept, or whose resource is inactive (SCKND)', async () => {
      await seedSchedule(ORG, 'appts', 'appointments'); // practitioner, room, virtual
      await seedOffering(ORG, 'appts-off', 'appts', { capacity: null });
      const link = (offering: string, resource: string) => q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, offering, resource]);
      expect(await sqlstateOf(link('appts-off', 'court-1'))).toBe('SCKND'); // a court is not an appointments resource
      expect(await sqlstateOf(link('appts-off', 'room-1'))).toBeNull();
      await seedResource(ORG, 'dr-off', 'practitioner', { active: false });
      expect(await sqlstateOf(link('appts-off', 'dr-off'))).toBe('SCKND'); // inactive
    });

    it('PARITY: the database copy of the preset-kind table equals the TypeScript presets for every preset and kind', async () => {
      const kinds = ['court', 'table', 'room', 'practitioner', 'equipment', 'space', 'virtual'] as const;
      for (const key of PRESET_KEYS) {
        for (const kind of kinds) {
          const r = await getPool().query('SELECT scheduling_preset_allows_resource_kind($1, $2) AS ok', [key, kind]);
          expect(r.rows[0].ok, `${key} / ${kind}`).toBe((PRESETS[key].resources.kinds as readonly string[]).includes(kind));
        }
      }
    });

    it('legacy setResourceActive(false) is now refused while a live reservation holds the resource', async () => {
      booked(await hire(w.repo, 'court-1', '10:00'));
      await expect(w.config.setResourceActive(w.staff, 'court-1', false)).rejects.toMatchObject({ code: 'lifecycle_violation' });
    });
  });

  // ─── lock ordering and deadlock freedom ────────────────────────────────────────────────────────────────────────

  describe('lock ordering', () => {
    it('stress: deactivation, bookings, unlink, link and kind change racing on one resource never deadlock and never leave a broken state', async () => {
      await seedSchedule(ORG, 'pub-sched', 'resource_hire', { publicSlug: 'pub' });
      await seedOffering(ORG, 'pub-off', 'pub-sched', { capacity: null });
      const pubIds = { schedule: 'pub-sched', offering: 'pub-off' };
      const errors: string[] = [];
      const note = (label: string) => (e: unknown) => {
        const code = (e as { code?: string }).code ?? String(e);
        if (!['not_found', 'lifecycle_violation', 'offering_unavailable', 'invalid_input', 'conflict', 'resource_conflict'].includes(code)) errors.push(`${label}:${code}`);
      };
      let deactivated = 0;
      let unlinkedAfterCustomer = 0;
      for (let round = 0; round < 40; round++) {
        await resetData();
        w = await makeWorld(ORG, staff(ORG));
        await seedSchedule(ORG, 'pub-sched', 'resource_hire', { publicSlug: 'pub' });
        await seedOffering(ORG, 'pub-off', 'pub-sched', { capacity: null });
        await w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1');
        await w.config.linkOfferingResource(w.staff, 'pub-off', 'court-1');
        const token = await tokenOf('court-1');
        await Promise.all([
          w.config.updateResource(w.staff, 'court-1', token, { active: false }).catch(note('deactivate')),
          hire(w.repo, 'court-1', '10:00').catch(note('staff-1')),
          hire(w.repo, 'court-1', '12:00').catch(note('staff-2')),
          hire(w.repo, 'court-1', '14:00', customerActor(ORG, 'c1'), pubIds).catch(note('customer-1')),
          hire(w.repo, 'court-1', '16:00', customerActor(ORG, 'c2'), pubIds).catch(note('customer-2')),
          w.config.unlinkOfferingResource(w.staff, 'pub-off', 'court-1').catch(note('unlink')),
          w.config.unlinkOfferingResource(w.staff, w.hire.offering, 'court-1').catch(note('unlink-hire')),
        ]);
        const r = (await w.config.listResources(w.staff)).find(x => x.id === 'court-1')!;
        if (!r.active) {
          deactivated++;
          expect(await live('court-1'), 'inactive resource with a live hold').toBe(0);
        }
        // a link removed while a customer hold exists would mean the unlink guard was raced
        const heldForPub = await count("SELECT count(*) FROM scheduling_resource_holds h JOIN scheduling_reservations v ON v.organisation_id = h.organisation_id AND v.id = h.reservation_id WHERE v.offering_id = 'pub-off' AND h.released_at IS NULL");
        const linkedPub = await count("SELECT count(*) FROM scheduling_offering_resources WHERE offering_id = 'pub-off'");
        if (heldForPub > 0 && linkedPub === 0) unlinkedAfterCustomer++;
      }
      expect(errors, 'unexpected errors (a 40P01 deadlock would show here)').toEqual([]);
      expect(unlinkedAfterCustomer).toBe(0);
      expect(deactivated).toBeGreaterThanOrEqual(0);
    }, 180_000);

    it('stress: kind change racing link and booking never leaves a resource that changed kind AND is linked or held', async () => {
      const errors: string[] = [];
      const note = (label: string) => (e: unknown) => {
        const code = (e as { code?: string }).code ?? String(e);
        if (!['not_found', 'lifecycle_violation', 'offering_unavailable', 'invalid_input', 'conflict', 'resource_conflict'].includes(code)) errors.push(`${label}:${code}`);
      };
      for (let round = 0; round < 40; round++) {
        await resetData();
        w = await makeWorld(ORG, staff(ORG));
        const token = await tokenOf('court-1');
        await Promise.all([
          w.config.updateResource(w.staff, 'court-1', token, { kind: 'practitioner' }).catch(note('kind')),
          w.config.linkOfferingResource(w.staff, w.hire.offering, 'court-1').catch(note('link')),
          hire(w.repo, 'court-1', '10:00').catch(note('book')),
        ]);
        const kind = (await w.config.listResources(w.staff)).find(x => x.id === 'court-1')!.kind;
        if (kind !== 'court') {
          expect(await count("SELECT count(*) FROM scheduling_offering_resources WHERE resource_id = 'court-1'"), 'kind changed under a link').toBe(0);
          expect(await count("SELECT count(*) FROM scheduling_resource_holds WHERE resource_id = 'court-1'"), 'kind changed under a hold').toBe(0);
        }
      }
      expect(errors).toEqual([]);
    }, 180_000);
  });
});

function okOrThrow<T extends { ok: boolean }>(r: T): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}
