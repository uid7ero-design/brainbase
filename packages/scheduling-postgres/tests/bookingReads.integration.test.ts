import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { neon } from '@neondatabase/serverless';
import { findIdentityLeaks, type BookingReadQuery, type TenantContext } from '@scheduling/core';
import { PostgresBookingReadRepository, PostgresReservationRepository, PostgresSchedulingConfigRepository, fromNeonHttpLike, fromPgLike, type SqlExecutor } from '@scheduling/postgres';
import { classBooking, person, slotBooking } from './support/builders';
import { installNeonLikeFetch } from './support/neonLikeFetch';
import { FixedClock, TEST_URL, closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOccurrence, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// PHASE 2C.2 on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2c.sh on 16 and 17): the READ side of bookings.
//   - tenant-scoped, bounded range reads of occurrences, reservations (viewer-reduced and full) and live holds, and the overlay built from them;
//   - stable keyset pagination; the half-open range; cancelled things only on request; a session with no resource is returned, not hidden;
//   - a viewer read selects NO customer column; the full read needs scheduling.reserve and is refused before any SQL runs;
//   - READ-ONLY, proved three ways: every method runs on a connection the SERVER holds read-only (a write would fail with 25006), a content hash of every Scheduling
//     table (and organisations and audit_logs) is identical afterwards, and no statement text contains a write keyword;
//   - the same answers through the real Neon driver code;
//   - the statements use the indexes (EXPLAIN) at a few thousand rows.

const A = 'org-reads-a';
const B = 'org-reads-b';
const manager = staff(A);
const viewer = staff(A, ['scheduling.view']);
const nobody = staff(A, []);
const managerB = staff(B);
const suite = hasDatabase ? describe : describe.skip;

const clock = new FixedClock(new Date('2026-11-01T00:00:00Z'));
const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;
const BASE = Date.parse('2026-12-07T05:30:00Z'); // Monday 16:00 Adelaide (ACDT, UTC+10:30)
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const RANGE = { fromInstant: '2026-12-01T00:00:00Z', toInstant: '2026-12-31T00:00:00Z' };

const SCHEDULING_TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules', 'scheduling_availability_exceptions',
  'scheduling_availability_zones', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences', 'scheduling_series', 'scheduling_series_pauses', 'scheduling_settings',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of [...SCHEDULING_TABLES, 'organisations', 'audit_logs']) out.push((await getPool().query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`)).rows[0].h as string);
  return out;
};

interface Spy {
  exec: SqlExecutor;
  log: Array<{ text: string; params: readonly unknown[] }>;
}
const spy = (inner: SqlExecutor): Spy => {
  const log: Spy['log'] = [];
  return { log, exec: { query: (text, params) => (log.push({ text, params: params ?? [] }), inner.query(text, params)) } };
};

let reads: PostgresBookingReadRepository;
let reservations: PostgresReservationRepository;
let config: PostgresSchedulingConfigRepository;

const ids = {
  classSchedule: 'rd-sch-class',
  classOffering: 'rd-off-class',
  hireSchedule: 'rd-sch-hire',
  hireOffering: 'rd-off-hire',
  courtA: 'rd-court-a',
  courtB: 'rd-court-b',
  otherSchedule: 'rd-b-sch',
  otherOffering: 'rd-b-off',
  otherCourt: 'rd-b-court',
};
const classIds = () => ({ schedule: ids.classSchedule, offering: ids.classOffering });
const hireIds = () => ({ schedule: ids.hireSchedule, offering: ids.hireOffering });

/** Wipes the Scheduling tables and seeds the two organisations' schedules, offerings and resources. Every test starts from this. */
async function world() {
  await resetData();
  await seedSchedule(A, ids.classSchedule, 'classes_coaching');
  await seedOffering(A, ids.classOffering, ids.classSchedule, { capacity: 10 });
  await seedSchedule(A, ids.hireSchedule, 'resource_hire');
  await seedOffering(A, ids.hireOffering, ids.hireSchedule, { capacity: null });
  await seedResource(A, ids.courtA, 'court');
  await seedResource(A, ids.courtB, 'court');
  await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1,$2,$3),($1,$2,$4),($1,$5,$3)', [A, ids.hireOffering, ids.courtA, ids.courtB, ids.classOffering]);
  await seedSchedule(B, ids.otherSchedule, 'classes_coaching');
  await seedOffering(B, ids.otherOffering, ids.otherSchedule, { capacity: 5 });
  await seedResource(B, ids.otherCourt, 'court');
  await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1,$2,$3)', [B, ids.otherOffering, ids.otherCourt]);
}

/** A class session `dayOffset` days after BASE (16:00 Adelaide), with or without a court. */
async function occ(dayOffset: number, over: { resourceId?: string | null; org?: string; offering?: string; capacity?: number } = {}) {
  const id = uid('occ');
  const startsAt = iso(BASE + dayOffset * DAY);
  const endsAt = iso(BASE + dayOffset * DAY + HOUR);
  await seedOccurrence({ id, org: over.org ?? A, offeringId: over.offering ?? ids.classOffering, capacity: over.capacity ?? 10, resourceId: over.resourceId ?? null, startsAt, endsAt });
  return { id, startsAt, endsAt };
}
const enrol = async (o: { id: string; startsAt: string; endsAt: string }, name: string, email: string) => {
  const r = await reservations.create(manager, classBooking(o.id, classIds(), { instants: { startsAt: o.startsAt, endsAt: o.endsAt }, customerSnapshot: person(name, email), partySize: 1, notes: `private note for ${name}` }));
  if (!r.ok) throw new Error(`enrol failed: ${r.reason}`);
  return r.reservation;
};
const hire = async (court: string, day: number, time: string, who = 'Hirer Person') => {
  const b = slotBooking(court, `2026-12-${String(day).padStart(2, '0')}`, time, 60, hireIds(), { customerSnapshot: person(who, `${who.split(' ')[0].toLowerCase()}${day}${time.replace(':', '')}@example.com`), notes: 'bring the key' });
  const r = await reservations.create(manager, b);
  if (!r.ok) throw new Error(`hire failed: ${r.reason}`);
  return r.reservation;
};
suite('booking reads on real PostgreSQL (Phase 2C.2)', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await resetData();
    for (const org of [A, B]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, 'Australia/Adelaide']);
    reads = new PostgresBookingReadRepository({ sql: fromPgLike(getPool()) });
    reservations = new PostgresReservationRepository({ sql: fromPgLike(getPool()), clock });
    config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
  });
  afterAll(async () => {
    await resetData();
    await closePool();
  });

  // ─── occurrences ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('occurrences', () => {
    it('returns the sessions in range with headcount; a session with no court is included; cancelled ones only on request', async () => {
      await world();
      const withCourt = await occ(0, { resourceId: ids.courtA });
      const noCourt = await occ(1);
      const cancelled = await occ(2, { resourceId: ids.courtA });
      await enrol(withCourt, 'Alex Nguyen', 'alex.nguyen@example.com');
      await enrol(withCourt, 'Bo Chen', 'bo.chen@example.com');
      const gone = await enrol(noCourt, 'Cy Dunn', 'cy@example.com');
      await reservations.cancel(manager, { reservationId: gone.id, cancelledBy: 'staff', reason: 'moved', scope: 'this_occurrence' });
      await config.cancelOccurrence(manager, cancelled.id, 'closed');

      const page = await reads.listOccurrencesInRange(viewer, RANGE);
      expect(page.nextCursor).toBeNull();
      expect(page.items.map(o => o.id)).toEqual([withCourt.id, noCourt.id]);
      expect(page.items[0]).toMatchObject({ resourceId: ids.courtA, liveHeadcount: 2, capacity: 10, status: 'scheduled', offeringName: expect.any(String), date: '2026-12-07', startTime: '16:00', durationMinutes: 60, timezone: 'Australia/Adelaide' });
      expect(page.items[1]).toMatchObject({ resourceId: null, liveHeadcount: 0 }); // its only enrolment was cancelled
      const all = await reads.listOccurrencesInRange(viewer, { ...RANGE, includeCancelled: true });
      expect(all.items.map(o => [o.id, o.status])).toEqual([[withCourt.id, 'scheduled'], [noCourt.id, 'scheduled'], [cancelled.id, 'cancelled']]);
    });

    it('is half-open: a session ending exactly at the start, or starting exactly at the end, is outside', async () => {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      expect((await reads.listOccurrencesInRange(viewer, { fromInstant: o.endsAt, toInstant: iso(Date.parse(o.endsAt) + HOUR) })).items).toEqual([]);
      expect((await reads.listOccurrencesInRange(viewer, { fromInstant: iso(Date.parse(o.startsAt) - HOUR), toInstant: o.startsAt })).items).toEqual([]);
      expect((await reads.listOccurrencesInRange(viewer, { fromInstant: iso(Date.parse(o.startsAt) + 1000), toInstant: iso(Date.parse(o.startsAt) + 2000) })).items.map(x => x.id)).toEqual([o.id]);
    });

    it('a resource filter narrows resource-bound sessions and never hides one that has no resource; an offering filter narrows by offering', async () => {
      await world();
      const a = await occ(0, { resourceId: ids.courtA });
      const free = await occ(1);
      expect((await reads.listOccurrencesInRange(viewer, { ...RANGE, resourceIds: [ids.courtB] })).items.map(o => o.id)).toEqual([free.id]);
      expect((await reads.listOccurrencesInRange(viewer, { ...RANGE, resourceIds: [ids.courtA] })).items.map(o => o.id)).toEqual([a.id, free.id]);
      expect((await reads.listOccurrencesInRange(viewer, { ...RANGE, offeringId: ids.hireOffering })).items).toEqual([]);
      expect((await reads.listOccurrencesInRange(viewer, { ...RANGE, offeringId: ids.classOffering })).items).toHaveLength(2);
    });
  });

  // ─── pagination ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('walks 25 sessions in pages of 10 with no gap and no repeat', async () => {
      await world();
      const made = [];
      for (let i = 0; i < 25; i++) made.push(await occ(i));
      const seen: string[] = [];
      let after: string | null = null;
      let pages = 0;
      do {
        const page: Awaited<ReturnType<typeof reads.listOccurrencesInRange>> = await reads.listOccurrencesInRange(viewer, { fromInstant: '2026-12-06T00:00:00Z', toInstant: '2027-01-05T00:00:00Z', limit: 10, after });
        pages++;
        expect(page.items.length).toBeLessThanOrEqual(10);
        seen.push(...page.items.map(o => o.id));
        after = page.nextCursor;
      } while (after);
      expect(pages).toBe(3);
      expect(seen).toEqual(made.map(m => m.id));
    }, 60_000);

    it('a boundary survives rows being added before it, and sessions being cancelled, between two requests', async () => {
      await world();
      const made = [];
      for (let i = 2; i < 12; i++) made.push(await occ(i));
      const first = await reads.listOccurrencesInRange(viewer, { ...RANGE, limit: 4 });
      expect(first.items.map(o => o.id)).toEqual(made.slice(0, 4).map(m => m.id));
      const early = await occ(0); // lands BEFORE the cursor
      await config.cancelOccurrence(manager, made[1].id, 'x'); // already returned
      await config.cancelOccurrence(manager, made[5].id, 'x'); // not yet returned: simply no longer listed
      const second = await reads.listOccurrencesInRange(viewer, { ...RANGE, limit: 4, after: first.nextCursor });
      expect(second.items.map(o => o.id)).toEqual([made[4], made[6], made[7], made[8]].map(m => m.id));
      expect(second.items.some(o => o.id === early.id)).toBe(false);
    }, 60_000);

    it('two sessions with the same start are ordered by id and a page boundary between them loses neither', async () => {
      await world();
      await seedSchedule(A, 'rd-sch-class2', 'classes_coaching');
      await seedOffering(A, 'rd-off-class2', 'rd-sch-class2', { capacity: 10 });
      // The slot unique key allows one class at a time per offering, so the tie is across two offerings.
      for (const [id, offering] of [['tie-b', 'rd-off-class2'], ['tie-a', ids.classOffering]] as const) {
        await seedOccurrence({ id, org: A, offeringId: offering, capacity: 10, startsAt: iso(BASE), endsAt: iso(BASE + HOUR), resourceId: null });
      }
      const p1 = await reads.listOccurrencesInRange(viewer, { ...RANGE, limit: 1 });
      expect(p1.items.map(o => o.id)).toEqual(['tie-a']);
      const p2 = await reads.listOccurrencesInRange(viewer, { ...RANGE, limit: 1, after: p1.nextCursor });
      expect(p2.items.map(o => o.id)).toEqual(['tie-b']);
      expect(p2.nextCursor).toBeNull();
    });

    it('refuses a tampered cursor, an unknown page size and a bad range as invalid input, before touching the database', async () => {
      await world();
      const s = spy(fromPgLike(getPool()));
      const r = new PostgresBookingReadRepository({ sql: s.exec });
      for (const bad of [{ after: 'not-a-cursor' }, { after: "2026-12-07T05:30:00Z~x'; DROP TABLE y" }, { limit: 0 }, { limit: 501 }, { limit: 2.5 }] as Array<Partial<BookingReadQuery>>) {
        await expect(r.listOccurrencesInRange(viewer, { ...RANGE, ...bad })).rejects.toMatchObject({ code: 'invalid_input' });
      }
      expect(s.log).toHaveLength(0);
    });
  });

  // ─── reservations: reduced for viewers, full for staff who may reserve ───────────────────────────────────────────────────────────

  describe('reservations', () => {
    it('the viewer read selects no customer column: the statement text names none, and no name, email, note or party size is in the result', async () => {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      await hire(ids.courtB, 8, '10:00', 'Hirer Person');
      const s = spy(fromPgLike(getPool()));
      const r = new PostgresBookingReadRepository({ sql: s.exec });
      const page = await r.listReservationsInRange(viewer, RANGE);
      expect(page.items).toHaveLength(2);
      const statement = s.log.map(l => l.text).join('\n');
      for (const column of ['customer_name', 'customer_email', 'customer_phone', 'customer_id', 'customer_email_normalised', 'notes', 'payment_status', 'attendance', 'series_id', 'created_by', 'idempotency_key', 'cancel_reason', 'price_cents', 'party_size']) {
        expect(statement, `the viewer statement must not mention ${column}`).not.toContain(column);
      }
      const json = JSON.stringify(page);
      for (const secret of ['Alex', 'Nguyen', 'alex.nguyen', 'Hirer', 'hirer', 'private note', 'bring the key']) expect(json).not.toContain(secret);
      expect(findIdentityLeaks(page)).toEqual([]);
      expect(page.items.map(i => Object.keys(i).sort())).toEqual(page.items.map(() => ['endsAt', 'id', 'kind', 'occurrenceId', 'offeringId', 'offeringName', 'resourceId', 'startsAt', 'state', 'timezone']));
    });

    it('tells an enrolment from a booking, flags a cancelled one and hides it unless asked', async () => {
      await world();
      const o = await occ(0);
      const e = await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      const h = await hire(ids.courtA, 8, '10:00');
      await reservations.cancel(manager, { reservationId: h.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      expect((await reads.listReservationsInRange(viewer, RANGE)).items.map(i => [i.id, i.kind, i.state])).toEqual([[e.id, 'enrolment', 'booked']]);
      const all = await reads.listReservationsInRange(viewer, { ...RANGE, includeCancelled: true });
      expect(all.items.map(i => [i.kind, i.state]).sort()).toEqual([['booking', 'cancelled'], ['enrolment', 'booked']]);
      expect((await reads.listReservationsInRange(viewer, { ...RANGE, includeCancelled: true, kind: 'booking' })).items.map(i => i.id)).toEqual([h.id]);
      await expect(reads.listReservationsInRange(viewer, { ...RANGE, kind: 'other' as never })).rejects.toMatchObject({ code: 'invalid_input' });
    });

    it('the FULL read needs scheduling.reserve: a viewer is refused before any SQL runs, a manager gets the customer detail', async () => {
      await world();
      const o = await occ(0);
      await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      const s = spy(fromPgLike(getPool()));
      const r = new PostgresBookingReadRepository({ sql: s.exec });
      await expect(r.listReservationDetailsInRange(viewer, RANGE)).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(r.listReservationDetailsInRange(nobody, RANGE)).rejects.toMatchObject({ code: 'permission_denied' });
      expect(s.log).toHaveLength(0);
      const detail = await r.listReservationDetailsInRange(manager, RANGE);
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0]).toMatchObject({ customerSnapshot: { displayName: 'Alex Nguyen', email: 'alex.nguyen@example.com' }, partySize: 1, notes: 'private note for Alex Nguyen' });
    });

    it('a member of staff who can reserve but not view is refused (view is the floor for every read)', async () => {
      await world();
      const reserveOnly = staff(A, ['scheduling.reserve']);
      await expect(reads.listReservationDetailsInRange(reserveOnly, RANGE)).rejects.toMatchObject({ code: 'permission_denied' });
    });
  });

  // ─── holds ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('live holds', () => {
    it('returns live holds only: a cancelled booking and a cancelled session release theirs', async () => {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      const kept = await hire(ids.courtB, 8, '10:00');
      const dropped = await hire(ids.courtB, 8, '12:00');
      await reservations.cancel(manager, { reservationId: dropped.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      let holds = (await reads.listLiveHoldsInRange(viewer, RANGE)).items;
      expect(holds.map(h => [h.resourceId, h.occurrenceId, h.reservationId])).toEqual([[ids.courtA, o.id, null], [ids.courtB, null, kept.id]]);
      await config.cancelOccurrence(manager, o.id, 'x');
      holds = (await reads.listLiveHoldsInRange(viewer, RANGE)).items;
      expect(holds.map(h => h.reservationId)).toEqual([kept.id]);
      expect((await reads.listLiveHoldsInRange(viewer, { ...RANGE, resourceIds: [ids.courtA] })).items).toEqual([]);
    });
  });

  // ─── the overlay ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('the overlay', () => {
    it('draws sessions, bookings and holds the way the calendar will: court lanes, an unassigned-space row, cancelled flagged', async () => {
      await world();
      const withCourt = await occ(0, { resourceId: ids.courtA });
      const noCourt = await occ(1);
      const cancelled = await occ(2, { resourceId: ids.courtA });
      for (const [n, e] of [['Alex Nguyen', 'alex.nguyen@example.com'], ['Bo Chen', 'bo@example.com'], ['Cy Dunn', 'cy@example.com'], ['Di Evans', 'di@example.com']]) await enrol(withCourt, n, e);
      const b = await hire(ids.courtB, 8, '10:00');
      const gone = await hire(ids.courtB, 8, '12:00');
      await reservations.cancel(manager, { reservationId: gone.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      await config.cancelOccurrence(manager, cancelled.id, 'x');

      const overlay = await reads.readBookingOverlay(viewer, { ...RANGE, includeCancelled: true });
      expect(overlay.lanes.map(l => l.resourceId)).toEqual([ids.courtA, ids.courtB]);
      expect(overlay.lanes[0].items.map(i => [i.kind, i.id])).toEqual([['occurrence', withCourt.id], ['occurrence', cancelled.id]]);
      expect(overlay.lanes[0].items[0]).toMatchObject({ liveHeadcount: 4, remaining: 6, placement: 'resource', holdId: expect.any(String) });
      expect(overlay.lanes[0].items[1]).toMatchObject({ status: 'cancelled', holdId: null });
      expect(overlay.lanes[1].items.map(i => [i.kind, i.id, (i as { state?: string }).state])).toEqual([['booking', b.id, 'booked'], ['booking', gone.id, 'cancelled']]);
      expect(overlay.unassignedSpace.map(o => o.id)).toEqual([noCourt.id]);
      expect(overlay.counts).toEqual({ occurrences: 3, slotBookings: 2, holds: 0, cancelled: 2, unassignedSpace: 1 });
      expect(overlay.truncated).toEqual({ occurrences: false, slotBookings: false, holds: false });
      expect(findIdentityLeaks(overlay)).toEqual([]);
      expect(JSON.stringify(overlay)).not.toMatch(/Alex|Nguyen|alex\.|Hirer|hirer|private note|bring the key/);

      const live = await reads.readBookingOverlay(viewer, RANGE);
      expect(live.counts.cancelled).toBe(0);
      expect(live.lanes.flatMap(l => l.items).some(i => (i as { state?: string; status?: string }).state === 'cancelled' || (i as { status?: string }).status === 'cancelled')).toBe(false);
    });

    it('the overlay is the same for a viewer and a manager (no customer data for any role)', async () => {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      await hire(ids.courtB, 8, '10:00');
      expect(await reads.readBookingOverlay(viewer, RANGE)).toEqual(await reads.readBookingOverlay(manager, RANGE));
    });

    it('says so when a cap cut something off', async () => {
      await world();
      for (let i = 0; i < 5; i++) await occ(i);
      const overlay = await reads.readBookingOverlay(viewer, { ...RANGE, limit: 3 });
      expect(overlay.counts.occurrences).toBe(3);
      expect(overlay.truncated.occurrences).toBe(true);
      expect(overlay.truncated.slotBookings).toBe(false);
    });

    it('sends THREE statements however many resources there are (1, 5, 20, 50)', async () => {
      await world();
      for (const n of [1, 5, 20, 50]) {
        const ids50 = Array.from({ length: n }, (_, i) => `rd-many-${n}-${i}`);
        for (const id of ids50) await seedResource(A, id, 'court');
        const s = spy(fromPgLike(getPool()));
        const r = new PostgresBookingReadRepository({ sql: s.exec });
        await r.readBookingOverlay(viewer, { ...RANGE, resourceIds: ids50 });
        expect(s.log, `${n} resources`).toHaveLength(3);
      }
    });
  });

  // ─── bounds ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('bounds and permissions', () => {
    it('refuses a range over 31 days, more than 100 resources, a malformed instant and a limit over 500', async () => {
      await world();
      await expect(reads.listOccurrencesInRange(viewer, { fromInstant: '2026-12-01T00:00:00Z', toInstant: '2027-02-01T00:00:00Z' })).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(reads.readBookingOverlay(viewer, { ...RANGE, resourceIds: Array.from({ length: 101 }, (_, i) => `r${i}`) })).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(reads.listLiveHoldsInRange(viewer, { fromInstant: 'tomorrow', toInstant: RANGE.toInstant })).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(reads.listReservationsInRange(viewer, { ...RANGE, limit: 501 })).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(reads.listOccurrencesInRange(viewer, { ...RANGE, resourceIds: Array.from({ length: 100 }, (_, i) => `r${i}`) })).resolves.toBeDefined();
    });

    it('every read needs scheduling.view', async () => {
      await world();
      for (const call of [
        () => reads.listOccurrencesInRange(nobody, RANGE),
        () => reads.listReservationsInRange(nobody, RANGE),
        () => reads.listLiveHoldsInRange(nobody, RANGE),
        () => reads.readBookingOverlay(nobody, RANGE),
      ]) await expect(call()).rejects.toMatchObject({ code: 'permission_denied' });
    });
  });

  // ─── tenant isolation ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('another organisation’s sessions, bookings, holds and ids are invisible, whichever way they are asked for', async () => {
      await world();
      const mine = await occ(0, { resourceId: ids.courtA });
      const theirs = await occ(1, { org: B, offering: ids.otherOffering, resourceId: ids.otherCourt });
      const theirEnrolment = await reservations.create(managerB, classBooking(theirs.id, { schedule: ids.otherSchedule, offering: ids.otherOffering }, { instants: { startsAt: theirs.startsAt, endsAt: theirs.endsAt }, customerSnapshot: person('Zed Other', 'zed@other.example') }));
      expect(theirEnrolment.ok).toBe(true);

      for (const who of [viewer, manager]) {
        expect((await reads.listOccurrencesInRange(who, RANGE)).items.map(o => o.id)).toEqual([mine.id]);
        expect((await reads.listOccurrencesInRange(who, { ...RANGE, offeringId: ids.otherOffering })).items).toEqual([]);
        expect((await reads.listOccurrencesInRange(who, { ...RANGE, resourceIds: [ids.otherCourt] })).items.map(o => o.id)).toEqual([mine.id].filter(() => false));
        expect((await reads.listReservationsInRange(who, RANGE)).items).toEqual([]);
        expect((await reads.listLiveHoldsInRange(who, { ...RANGE, resourceIds: [ids.otherCourt] })).items).toEqual([]);
        expect(JSON.stringify(await reads.readBookingOverlay(who, { ...RANGE, resourceIds: [ids.otherCourt] }))).not.toContain(theirs.id);
      }
      expect((await reads.listReservationDetailsInRange(manager, RANGE)).items).toEqual([]);
      expect((await reads.listOccurrencesInRange(managerB, RANGE)).items.map(o => o.id)).toEqual([theirs.id]);
      expect(JSON.stringify(await reads.readBookingOverlay(viewer, RANGE))).not.toMatch(/Zed|other\.example/);
    });
  });

  // ─── read-only ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('every read leaves the database unchanged', () => {
    async function exercise(r: PostgresBookingReadRepository, who: TenantContext, whoViewer: TenantContext) {
      await r.listOccurrencesInRange(whoViewer, { ...RANGE, includeCancelled: true });
      await r.listOccurrencesInRange(whoViewer, { ...RANGE, limit: 2 });
      await r.listReservationsInRange(whoViewer, { ...RANGE, includeCancelled: true });
      await r.listReservationsInRange(whoViewer, { ...RANGE, kind: 'booking', resourceIds: [ids.courtA, ids.courtB] });
      await r.listReservationDetailsInRange(who, { ...RANGE, includeCancelled: true });
      await r.listLiveHoldsInRange(whoViewer, RANGE);
      await r.readBookingOverlay(whoViewer, { ...RANGE, includeCancelled: true });
    }
    async function populate() {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      await occ(1);
      await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      const h = await hire(ids.courtB, 8, '10:00');
      await reservations.cancel(manager, { reservationId: h.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
    }

    it('a content hash of every Scheduling table, organisations and audit_logs is identical afterwards', async () => {
      await populate();
      const before = await hashAll();
      await exercise(reads, manager, viewer);
      expect(await hashAll()).toEqual(before);
    });

    it('every method runs on a connection the SERVER holds read-only: a write would fail with 25006', async () => {
      await populate();
      const ro = new Pool({ connectionString: TEST_URL, max: 4, options: '-c default_transaction_read_only=on' });
      try {
        await expect(ro.query('CREATE TEMP TABLE zz_probe (x int)')).rejects.toMatchObject({ code: '25006' }); // the guard is real
        await expect(ro.query("UPDATE scheduling_occurrences SET capacity = capacity WHERE organisation_id = 'x'")).rejects.toMatchObject({ code: '25006' });
        const r = new PostgresBookingReadRepository({ sql: fromPgLike(ro) });
        await exercise(r, manager, viewer);
      } finally {
        await ro.end();
      }
    });

    it('no statement the repository sends contains a write keyword or a function call that writes', async () => {
      await populate();
      const s = spy(fromPgLike(getPool()));
      const r = new PostgresBookingReadRepository({ sql: s.exec });
      await exercise(r, manager, viewer);
      expect(s.log.length).toBeGreaterThan(0);
      for (const { text } of s.log) {
        expect(text.trimStart()).toMatch(/^SELECT\b/);
        expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|LOCK|FOR\s+(UPDATE|SHARE|NO\s+KEY)|nextval|pg_advisory|set_config|scheduling_cancel_occurrence)\b/i);
      }
    });
  });

  // ─── the real Neon driver code ───────────────────────────────────────────────────────────────────────────────────────────────────

  describe('through the real Neon HTTP driver code', () => {
    it('gives exactly the answers the direct connection gives, one request per statement', async () => {
      await world();
      const o = await occ(0, { resourceId: ids.courtA });
      await occ(1);
      await enrol(o, 'Alex Nguyen', 'alex.nguyen@example.com');
      await hire(ids.courtB, 8, '10:00');
      const fake = installNeonLikeFetch(getPool());
      try {
        const sqlNeon = neon(['postgres:', '', ['driver', 'driver'].join(':') + '@ep-test.example.neon.tech', 'neondb'].join('/')) as unknown as { query(text: string, params?: unknown[]): Promise<unknown> };
        const viaDriver = new PostgresBookingReadRepository({ sql: fromNeonHttpLike(sqlNeon) });
        fake.statements.length = 0;
        const overlay = await viaDriver.readBookingOverlay(viewer, { ...RANGE, includeCancelled: true });
        expect(fake.statements).toHaveLength(3);
        expect(overlay).toEqual(await reads.readBookingOverlay(viewer, { ...RANGE, includeCancelled: true }));
        expect(await viaDriver.listReservationDetailsInRange(manager, RANGE)).toEqual(await reads.listReservationDetailsInRange(manager, RANGE));
        expect(await viaDriver.listOccurrencesInRange(viewer, { ...RANGE, resourceIds: [ids.courtA, ids.courtB], limit: 1 })).toEqual(await reads.listOccurrencesInRange(viewer, { ...RANGE, resourceIds: [ids.courtA, ids.courtB], limit: 1 }));
      } finally {
        fake.restore();
      }
    });
  });

  // ─── indexes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('the statements use the indexes', () => {
    it('at thousands of rows a month-long read uses an index on reservations and holds; occurrences need the proposed (organisation, start) index (migration 041)', async () => {
      await world();
      // 8000 occurrences (two organisations), 4000 reservations and 4000 holds in org A (8 courts, hourly), all written with triggers off in ONE disposable session.
      const c = await getPool().connect();
      try {
        // scheduling_is_timezone() reads pg_timezone_names on EVERY row (about 12 ms each), which makes a bulk load of thousands of rows take minutes. Swap in a trivial
        // check for the load only (this database is disposable and the original is restored below).
        await c.query('CREATE OR REPLACE FUNCTION scheduling_is_timezone(tz text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tz IS NOT NULL $$');
        await c.query('SET session_replication_role = replica');
        await c.query(
          `INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) SELECT 'rd-bulk-' || g, $1, 'court', 'bulk ' || g, 4, true FROM generate_series(1, 8) g ON CONFLICT DO NOTHING`,
          [A],
        );
        await c.query(
          `INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
           SELECT 'rd-occ-' || o.org || '-' || g || '-' || h, o.org, o.off, NULL, ((timestamptz '2025-06-01 05:30+00' + g * interval '1 day' + h * interval '1 hour') AT TIME ZONE 'Australia/Adelaide')::date, ((timestamptz '2025-06-01 05:30+00' + g * interval '1 day' + h * interval '1 hour') AT TIME ZONE 'Australia/Adelaide')::time, 'Australia/Adelaide',
                  timestamptz '2025-06-01 05:30+00' + g * interval '1 day' + h * interval '1 hour', timestamptz '2025-06-01 06:30+00' + g * interval '1 day' + h * interval '1 hour', 10
             FROM generate_series(0, 579) g CROSS JOIN generate_series(0, 6) h CROSS JOIN (VALUES ($1::text, $2::text), ($3::text, $4::text)) AS o(org, off)`,
          [A, ids.classOffering, B, ids.otherOffering],
        );
        await c.query(
          `INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, contact_link, timezone,
              local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, price_cents, currency, status, created_by)
           SELECT 'rd-res-' || g, $1, $2, 'resource_hire', 1, $3, 'slot', 'rd-bulk-' || (g % 8 + 1), 'Bulk Person', 'none', 'Australia/Adelaide',
                  (ts AT TIME ZONE 'Australia/Adelaide')::date, (ts AT TIME ZONE 'Australia/Adelaide')::time, ((ts + interval '1 hour') AT TIME ZONE 'Australia/Adelaide')::date, ((ts + interval '1 hour') AT TIME ZONE 'Australia/Adelaide')::time,
                  ts, ts + interval '1 hour', 1, 0, 'AUD', 'confirmed', 'bulk'
             FROM (SELECT g, timestamptz '2026-01-01 00:00+00' + (g / 8) * interval '17 hours' AS ts FROM generate_series(0, 3999) g) x`,
          [A, ids.hireSchedule, ids.hireOffering],
        );
        await c.query(
          `INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
           SELECT 'rd-hold-' || id, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM scheduling_reservations WHERE id LIKE 'rd-res-%'`,
        );
      } finally {
        await c.query('SET session_replication_role = DEFAULT').catch(() => undefined);
        await c.query('CREATE OR REPLACE FUNCTION scheduling_is_timezone(tz text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) $$').catch(() => undefined);
        c.release();
      }
      await getPool().query('ANALYZE scheduling_occurrences; ANALYZE scheduling_reservations; ANALYZE scheduling_resource_holds');
      const window = { fromInstant: '2026-12-01T00:00:00Z', toInstant: '2026-12-08T00:00:00Z' };
      const planOf = async (withProposedIndex: boolean) => {
        if (withProposedIndex) await getPool().query('CREATE INDEX IF NOT EXISTS zz_prototype_041_occ ON scheduling_occurrences (organisation_id, ends_at); CREATE INDEX IF NOT EXISTS zz_prototype_041_res ON scheduling_reservations (organisation_id, ends_at); ANALYZE scheduling_occurrences; ANALYZE scheduling_reservations');
        else await getPool().query('DROP INDEX IF EXISTS zz_prototype_041_occ; DROP INDEX IF EXISTS zz_prototype_041_res; ANALYZE scheduling_occurrences; ANALYZE scheduling_reservations');
        const s = spy(fromPgLike(getPool()));
        const r = new PostgresBookingReadRepository({ sql: s.exec });
        await r.listOccurrencesInRange(viewer, window);
        await r.listReservationsInRange(viewer, window);
        await r.listLiveHoldsInRange(viewer, window);
        const plans: string[] = [];
        for (const { text, params } of s.log) plans.push(JSON.stringify((await getPool().query(`EXPLAIN (FORMAT JSON) ${text}`, [...params])).rows[0]['QUERY PLAN']));
        return plans;
      };
      const summary = (p: string) => [...new Set([...p.matchAll(/"(Node Type|Index Name|Relation Name)":"([^"]+)"/g)].map(m => m[2]))].join(' > ');
      const scans = (p: string, relation: string) => [...p.matchAll(new RegExp(`"Node Type":"([^"]+)"[^{}]*"Relation Name":"${relation}"`, 'g'))].map(m => m[1]);
      const without = await planOf(false);
      for (const [i, p] of without.entries()) console.log(`[plan without 041, statement ${i}]`, summary(p));
      const withIdx = await planOf(true);
      for (const [i, p] of withIdx.entries()) console.log(`[plan with 041, statement ${i}]`, summary(p));
      expect(scans(withIdx[1], 'scheduling_reservations'), 'reservations plan').not.toContain('Seq Scan');
      expect(scans(withIdx[2], 'scheduling_resource_holds'), 'holds plan').not.toContain('Seq Scan');
      expect(scans(withIdx[0], 'scheduling_occurrences'), 'occurrences plan with the proposed index').not.toContain('Seq Scan');
      await getPool().query('DROP INDEX IF EXISTS zz_prototype_041_occ; DROP INDEX IF EXISTS zz_prototype_041_res');
    }, 180_000);
  });
});
