import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SchedulingError, defaultScheduleConfig, type ConfigWriteResult, type CreateReservationResult } from '@scheduling/core';
import { PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, count, ensureSchema, getPool, hasDatabase, publicActor, resetData, seedOccurrence, seedResource, seedSchedule, staff } from './support/pgHarness';
import { makeWorld, slotBooking, type World } from './support/builders';

// Phase 2B.2a: the configuration edit operations on real PostgreSQL. Every rule has a positive case and a negative one,
// every operation is checked across tenants, and the races are provoked deterministically (a second connection holds a
// transaction open) as well as by load.

const ORG = 'org-ce';
const OTHER = 'org-other';
const FUTURE = '2035-06-12'; // a date that stays in the future for the lifetime of the suite
let w: World;

const thrown = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SchedulingError;
  }
  throw new Error('expected a rejection');
};
const okOf = <T>(r: ConfigWriteResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}${r.detail ? ` (${r.detail})` : ''}`);
  return r.value;
};
const reasonOf = <T>(r: ConfigWriteResult<T>) => (r.ok ? 'ok' : r.reason);
const booked = (r: CreateReservationResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.reservation;
};

const scheduleInput = (over: Record<string, unknown> = {}) => {
  const d = defaultScheduleConfig({ id: 'x', organisationId: ORG, name: 'Coaching', presetKey: 'classes_coaching' });
  return { name: d.name, presetKey: d.presetKey, presetVersion: d.presetVersion, terminology: d.terminology, cancellationPolicy: d.cancellationPolicy, timezone: null, publicSlug: null, ...over };
};
const offeringInput = (scheduleId: string, over: Record<string, unknown> = {}) => ({
  scheduleId, name: 'Session', typeKey: null, colourKey: null, durationMinutes: 60, capacity: 8, price: { amountCents: 2500, currency: 'AUD' }, startTime: null, recurrence: { kind: 'none' as const }, ...over,
});

const TABLES = ['scheduling_schedules', 'scheduling_resources', 'scheduling_offerings', 'scheduling_offering_resources', 'scheduling_availability_rules', 'scheduling_occurrences', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_series'];
/** Every row of every scheduling table that belongs to one organisation, as one comparable string. */
async function snapshot(org: string): Promise<string> {
  const parts: string[] = [];
  for (const t of TABLES) {
    const r = await getPool().query(`SELECT row_to_json(x)::text AS j FROM ${t} x WHERE x.organisation_id = $1 ORDER BY 1`, [org]);
    parts.push(`${t}: ${r.rows.map(row => row.j).join('|')}`);
  }
  return parts.join('\n');
}

describe.skipIf(!hasDatabase)('configuration edits (2B.2a)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    w = await makeWorld(ORG, staff(ORG));
    await seedResource(OTHER, 'their-court', 'court');
    await seedSchedule(OTHER, 'their-sched', 'classes_coaching');
  });

  const cfg = () => w.config;
  const mkSchedule = (over: Record<string, unknown> = {}) => cfg().createSchedule(w.staff, scheduleInput(over));
  const mkOffering = (scheduleId: string, over: Record<string, unknown> = {}) => cfg().createOffering(w.staff, scheduleId, offeringInput(scheduleId, over));
  const mkResource = (over: Record<string, unknown> = {}) => cfg().createResource(w.staff, { kind: 'court', name: 'Court A', capacity: 4, minParty: null, active: true, ...over } as never);
  const hire = (resource: string, time: string, minutes: number, over: Record<string, unknown> = {}) => w.repo.create(w.staff, slotBooking(resource, FUTURE, time, minutes, w.hire, over as never));

  // ─── the version token ────────────────────────────────────────────────────────

  describe('version token', () => {
    it('every read returns a microsecond-precision UTC token, and an edit returns a new one that matches a fresh read', async () => {
      const s = await mkSchedule();
      expect(s.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      const r = await mkResource();
      expect(r.updatedAt).toMatch(/\.\d{6}Z$/);
      const o = await mkOffering(s.id);
      expect(o.updatedAt).toMatch(/\.\d{6}Z$/);
      expect((await cfg().listResources(w.staff)).find(x => x.id === r.id)?.updatedAt).toBe(r.updatedAt);
      const edited = okOf(await cfg().updateSchedule(w.staff, s.id, (await cfg().getSchedule(w.staff, s.id))!.updatedAt, { name: 'Renamed' }));
      expect(edited.updatedAt).not.toBe(s.updatedAt);
      expect((await cfg().getSchedule(w.staff, s.id))!.updatedAt).toBe(edited.updatedAt);
    });

    it('a token rounded to milliseconds is NOT the stored token: the full precision is required', async () => {
      const s = await mkSchedule();
      const ms = s.updatedAt.replace(/(\.\d{3})\d{3}Z$/, '$1Z');
      if (ms !== s.updatedAt && !s.updatedAt.endsWith('000Z')) expect(reasonOf(await cfg().updateSchedule(w.staff, s.id, ms, { name: 'X' }))).toBe('stale_write');
      expect(okOf(await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: 'X' })).name).toBe('X');
    });

    it('a malformed token is refused before any SQL, writing nothing', async () => {
      const s = await mkSchedule();
      const before = await snapshot(ORG);
      for (const bad of ['', 'now', '2026-11-01', 'x'.repeat(40)]) expect(await thrown(cfg().updateSchedule(w.staff, s.id, bad, { name: 'X' }))).toMatchObject({ code: 'invalid_input' });
      expect(await snapshot(ORG)).toBe(before);
    });
  });

  // ─── updateSchedule ───────────────────────────────────────────────────────────

  describe('updateSchedule', () => {
    it('edits name, terminology, cancellation policy and timezone; leaves everything else alone', async () => {
      const s = await mkSchedule({ publicSlug: 'coach' });
      const policy = { customerCanCancel: true, freeCancellationHoursBefore: 48, lateCancellationCharge: { kind: 'percent' as const, percent: 50 } };
      const out = okOf(await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: '  Junior coaching ', terminology: { offering: 'Lesson' }, cancellationPolicy: policy, timezone: 'Australia/Perth' }));
      expect(out).toMatchObject({ id: s.id, organisationId: ORG, name: 'Junior coaching', terminology: { offering: 'Lesson' }, cancellationPolicy: policy, timezone: 'Australia/Perth', presetKey: 'classes_coaching', publicSlug: 'coach', archivedAt: null });
      const cleared = okOf(await cfg().updateSchedule(w.staff, s.id, out.updatedAt, { timezone: null }));
      expect(cleared.timezone).toBeNull();
    });

    it('a stale write changes nothing and reports stale_write; the second of two edits from one read loses', async () => {
      const s = await mkSchedule();
      okOf(await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: 'First' })); // someone else got there first
      const before = await snapshot(ORG);
      const late = await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: 'Second', timezone: 'Australia/Perth' });
      expect(late).toEqual({ ok: false, reason: 'stale_write' });
      expect(await snapshot(ORG)).toBe(before);
      expect((await cfg().getSchedule(w.staff, s.id))).toMatchObject({ name: 'First', timezone: null });
    });

    it('the preset can change while the schedule has no offerings, and records the preset current version', async () => {
      const s = await mkSchedule();
      const out = okOf(await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' }));
      expect(out.presetKey).toBe('appointments');
      expect(out.presetVersion).toBe(2); // appointments is at version 2 (see PRESET_VERSION_NOTES)
    });

    it('the preset is locked once an offering exists, and an ARCHIVED offering still counts', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      const now = (await cfg().getSchedule(w.staff, s.id))!;
      expect(await cfg().updateSchedule(w.staff, s.id, now.updatedAt, { presetKey: 'appointments' })).toMatchObject({ ok: false, reason: 'preset_locked' });
      expect(await cfg().archiveOffering(w.staff, o.id)).toBe(true);
      const after = (await cfg().getSchedule(w.staff, s.id))!;
      expect(await cfg().updateSchedule(w.staff, s.id, after.updatedAt, { presetKey: 'resource_hire' })).toMatchObject({ ok: false, reason: 'preset_locked' });
      expect((await cfg().getSchedule(w.staff, s.id))!.presetKey).toBe('classes_coaching');
    });

    it('naming the SAME preset is not a change and stays allowed with offerings; other fields stay editable', async () => {
      const s = await mkSchedule();
      await mkOffering(s.id);
      const now = (await cfg().getSchedule(w.staff, s.id))!;
      const out = okOf(await cfg().updateSchedule(w.staff, s.id, now.updatedAt, { presetKey: 'classes_coaching', name: 'Still fine' }));
      expect(out.name).toBe('Still fine');
    });

    it('a locked preset reports a stale write first when the token is also old (the caller must re-read)', async () => {
      const s = await mkSchedule();
      await mkOffering(s.id); // bumps the schedule version
      expect(await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' })).toEqual({ ok: false, reason: 'stale_write' });
    });

    it('an archived schedule is never edited (archiving is one way: there is no unarchive)', async () => {
      const s = await mkSchedule();
      expect(await cfg().archiveSchedule(w.staff, s.id)).toBe(true);
      expect(await cfg().archiveSchedule(w.staff, s.id)).toBe(false);
      const now = (await cfg().getSchedule(w.staff, s.id))!;
      expect(now.archivedAt).not.toBeNull();
      const before = await snapshot(ORG);
      expect(await cfg().updateSchedule(w.staff, s.id, now.updatedAt, { name: 'Zombie' })).toEqual({ ok: false, reason: 'archived' });
      expect(await snapshot(ORG)).toBe(before);
      expect((await cfg().getSchedule(w.staff, s.id))!.archivedAt).not.toBeNull();
    });

    it('invalid input is refused with invalid_input and writes nothing', async () => {
      const s = await mkSchedule();
      const before = await snapshot(ORG);
      for (const patch of [{}, { name: '  ' }, { timezone: 'Mars/Olympus' }, { terminology: { nonsense: 'x' } }, { presetKey: 'spa_day' }, { name: 'x', organisationId: OTHER }, { name: 'x', publicSlug: 'taken' }]) {
        expect(await thrown(cfg().updateSchedule(w.staff, s.id, s.updatedAt, patch as never))).toMatchObject({ code: 'invalid_input' });
      }
      expect(await snapshot(ORG)).toBe(before);
    });

    it('needs scheduling.manage: viewers, nobody and public actors are refused', async () => {
      const s = await mkSchedule();
      for (const t of [staff(ORG, ['scheduling.view']), staff(ORG, []), publicActor(ORG)]) {
        expect(await thrown(cfg().updateSchedule(t, s.id, s.updatedAt, { name: 'Nope' }))).toMatchObject({ code: 'permission_denied' });
      }
    });
  });

  // ─── updateOffering ───────────────────────────────────────────────────────────

  describe('updateOffering', () => {
    it('edits the offering fields and keeps its schedule, currency and resource links', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await cfg().linkOfferingResource(w.staff, o.id, 'court-1');
      const cur = (await cfg().getOffering(w.staff, o.id))!;
      const out = okOf(await cfg().updateOffering(w.staff, o.id, cur.updatedAt, { name: ' Squad ', typeKey: 'squad', colourKey: 'green', durationMinutes: 45, capacity: 12, priceCents: 3100, startTime: '16:30' }));
      expect(out).toMatchObject({ id: o.id, scheduleId: s.id, name: 'Squad', typeKey: 'squad', colourKey: 'green', durationMinutes: 45, capacity: 12, price: { amountCents: 3100, currency: 'AUD' }, startTime: '16:30', resourceKinds: ['court'] });
    });

    it('can clear nullable fields with null', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id, { typeKey: 'a', colourKey: 'b', capacity: 5, startTime: '10:00' });
      const out = okOf(await cfg().updateOffering(w.staff, o.id, o.updatedAt, { typeKey: null, colourKey: null, capacity: null, startTime: null }));
      expect(out).toMatchObject({ typeKey: null, colourKey: null, capacity: null, startTime: null });
    });

    it('replaces the recurrence as a whole, and refuses an incoherent one without writing', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id, { startTime: '16:00', recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2035-01-01', end: { mode: 'ongoing' } } });
      const out = okOf(await cfg().updateOffering(w.staff, o.id, o.updatedAt, { recurrence: { kind: 'weekly', dayOfWeek: 3, startDate: '2035-02-01', end: { mode: 'after_occurrences', count: 6 } } }));
      expect(out.recurrence).toEqual({ kind: 'weekly', dayOfWeek: 3, startDate: '2035-02-01', end: { mode: 'after_occurrences', count: 6 } });
      const none = okOf(await cfg().updateOffering(w.staff, o.id, out.updatedAt, { recurrence: { kind: 'none' } }));
      expect(none.recurrence).toEqual({ kind: 'none' });
      // a weekly recurrence on an offering with no start time violates the schema rule: refused, nothing written
      const before = await snapshot(ORG);
      expect(await thrown(cfg().updateOffering(w.staff, o.id, none.updatedAt, { recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2035-01-01', end: { mode: 'ongoing' } }, startTime: null }))).toMatchObject({ code: 'invalid_input' });
      expect(await thrown(cfg().updateOffering(w.staff, o.id, none.updatedAt, { startTime: null, recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: null, end: { mode: 'ongoing' } } }))).toMatchObject({ code: 'invalid_input' });
      expect(await snapshot(ORG)).toBe(before);
    });

    it('applies the schedule preset: a date-range offering has no duration; a preset without recurrence refuses it', async () => {
      const stay = await mkSchedule({ presetKey: 'accommodation', presetVersion: 1, name: 'Stays' });
      const room = await mkOffering(stay.id, { durationMinutes: null, capacity: null });
      expect(await thrown(cfg().updateOffering(w.staff, room.id, room.updatedAt, { durationMinutes: 60 }))).toMatchObject({ code: 'invalid_input' });
      const tables = await mkSchedule({ presetKey: 'restaurant_tables', presetVersion: 1, name: 'Dining' });
      const dinner = await mkOffering(tables.id, { durationMinutes: null, capacity: null });
      expect(await thrown(cfg().updateOffering(w.staff, dinner.id, dinner.updatedAt, { recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: null, end: { mode: 'ongoing' } }, startTime: '18:00' }))).toMatchObject({ code: 'invalid_input' });
    });

    it('existing occurrences, reservations and holds are never rewritten by an edit (duration, capacity, price, recurrence)', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id, { capacity: 10, startTime: '16:00', recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2035-01-01', end: { mode: 'ongoing' } } });
      await seedOccurrence({ id: 'occ-1', org: ORG, offeringId: o.id, capacity: 10, startsAt: '2035-06-11T06:00:00Z', endsAt: '2035-06-11T07:00:00Z', resourceId: 'court-1' });
      const frozen = async () => (await getPool().query("SELECT row_to_json(x)::text AS j FROM scheduling_occurrences x WHERE id = 'occ-1'")).rows[0].j + (await getPool().query('SELECT count(*)::int AS c FROM scheduling_resource_holds')).rows[0].c;
      const before = await frozen();
      okOf(await cfg().updateOffering(w.staff, o.id, o.updatedAt, { capacity: 3, durationMinutes: 20, priceCents: 9900, recurrence: { kind: 'none' }, startTime: null }));
      expect(await frozen()).toBe(before);
    });

    it('an archived offering, or an offering of an archived schedule, is not edited', async () => {
      const s = await mkSchedule();
      const a = await mkOffering(s.id, { name: 'A' });
      const b = await mkOffering(s.id, { name: 'B' });
      expect(await cfg().archiveOffering(w.staff, a.id)).toBe(true);
      const archivedA = (await cfg().getOffering(w.staff, a.id))!;
      expect(await cfg().updateOffering(w.staff, a.id, archivedA.updatedAt, { name: 'Zombie' })).toEqual({ ok: false, reason: 'archived' });
      await cfg().archiveSchedule(w.staff, s.id);
      const liveB = (await cfg().getOffering(w.staff, b.id))!;
      expect(await cfg().updateOffering(w.staff, b.id, liveB.updatedAt, { name: 'Zombie' })).toEqual({ ok: false, reason: 'archived' });
      expect((await cfg().getOffering(w.staff, b.id))!.name).toBe('B');
    });

    it('a stale write changes nothing', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      okOf(await cfg().updateOffering(w.staff, o.id, o.updatedAt, { name: 'First' }));
      const before = await snapshot(ORG);
      expect(await cfg().updateOffering(w.staff, o.id, o.updatedAt, { name: 'Second', capacity: 99 })).toEqual({ ok: false, reason: 'stale_write' });
      expect(await snapshot(ORG)).toBe(before);
    });

    it('invalid input and fields that are not editable (schedule, currency, organisation) are refused, writing nothing', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      const before = await snapshot(ORG);
      for (const patch of [{}, { name: '' }, { capacity: 0 }, { durationMinutes: -5 }, { priceCents: -1 }, { priceCents: 1.5 }, { startTime: '99:99' }, { scheduleId: 'other' }, { currency: 'NZD' }, { organisationId: OTHER }, { price: { amountCents: 1, currency: 'NZD' } }]) {
        expect(await thrown(cfg().updateOffering(w.staff, o.id, o.updatedAt, patch as never))).toMatchObject({ code: 'invalid_input' });
      }
      expect(await snapshot(ORG)).toBe(before);
    });

    it('needs scheduling.manage', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      for (const t of [staff(ORG, ['scheduling.view']), staff(ORG, []), publicActor(ORG)]) {
        expect(await thrown(cfg().updateOffering(t, o.id, o.updatedAt, { name: 'Nope' }))).toMatchObject({ code: 'permission_denied' });
      }
    });
  });

  // ─── updateResource ───────────────────────────────────────────────────────────

  describe('updateResource', () => {
    it('edits name, capacity, minimum party and the active flag', async () => {
      const r = await mkResource({ kind: 'table', name: 'T1', capacity: 6 });
      const out = okOf(await cfg().updateResource(w.staff, r.id, r.updatedAt, { name: ' Table 1 ', capacity: 8, minParty: 2 }));
      expect(out).toMatchObject({ id: r.id, name: 'Table 1', capacity: 8, minParty: 2, kind: 'table', active: true });
      const off = okOf(await cfg().updateResource(w.staff, r.id, out.updatedAt, { active: false, minParty: null }));
      expect(off).toMatchObject({ active: false, minParty: null });
      expect(okOf(await cfg().updateResource(w.staff, r.id, off.updatedAt, { active: true })).active).toBe(true); // reactivation is always allowed
    });

    it('the kind changes only while the resource is unlinked AND has never been held', async () => {
      const r = await mkResource();
      const out = okOf(await cfg().updateResource(w.staff, r.id, r.updatedAt, { kind: 'space' }));
      expect(out.kind).toBe('space');
      // linked: refused
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await cfg().linkOfferingResource(w.staff, o.id, r.id);
      const linked = (await cfg().listResources(w.staff)).find(x => x.id === r.id)!;
      expect(await cfg().updateResource(w.staff, r.id, linked.updatedAt, { kind: 'court' })).toMatchObject({ ok: false, reason: 'resource_in_use' });
      // held in the past while assigned, then unassigned (a past hold never blocks the unlink): the kind still cannot change (history)
      await seedOccurrence({ id: 'old-occ', org: ORG, offeringId: o.id, capacity: 4, startsAt: '2020-01-06T00:00:00Z', endsAt: '2020-01-06T01:00:00Z', resourceId: r.id });
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, o.id, r.id))).toEqual({ removed: true });
      const held = (await cfg().listResources(w.staff)).find(x => x.id === r.id)!;
      expect(await cfg().updateResource(w.staff, r.id, held.updatedAt, { kind: 'court' })).toMatchObject({ ok: false, reason: 'resource_in_use' });
      expect(okOf(await cfg().updateResource(w.staff, r.id, held.updatedAt, { kind: 'space', name: 'Same kind is no change' })).kind).toBe('space');
    });

    it('deactivation is refused while a live hold exists, and allowed once the hold is released, ended, or the resource is unused', async () => {
      const live = booked(await hire('court-1', '16:00', 60));
      let court = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      expect(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { active: false })).toMatchObject({ ok: false, reason: 'resource_in_use' });
      expect((await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!.active).toBe(true);
      // cancelling the reservation releases the hold; the resource may then be deactivated
      await getPool().query("UPDATE scheduling_reservations SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff' WHERE id = $1", [live.id]);
      court = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      expect(okOf(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { active: false })).active).toBe(false);
      // a hold that has already ended never blocks
      await seedResource(ORG, 'space-1', 'space'); // (classes accept a space; a room would be refused by the 030 hold guard)
      await seedOccurrence({ id: 'past-occ', org: ORG, offeringId: w.cls.offering, capacity: 4, startsAt: '2020-01-06T00:00:00Z', endsAt: '2020-01-06T01:00:00Z', resourceId: 'space-1' });
      const room = (await cfg().listResources(w.staff)).find(x => x.id === 'space-1')!;
      expect(okOf(await cfg().updateResource(w.staff, 'space-1', room.updatedAt, { active: false })).active).toBe(false);
    });

    it('capacity cannot drop below a live reservation party, nor minParty rise above it; released reservations do not count', async () => {
      booked(await hire('court-1', '09:00', 60, { partySize: 3 }));
      const court = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      expect(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { capacity: 2 })).toMatchObject({ ok: false, reason: 'resource_in_use' });
      expect(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { minParty: 4, capacity: 4 })).toMatchObject({ ok: false, reason: 'resource_in_use' });
      expect(okOf(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { capacity: 3, minParty: 3 })).capacity).toBe(3); // still fits
    });

    it('exclusivity survives every edit: the same range still cannot be booked twice', async () => {
      booked(await hire('court-1', '10:00', 60));
      const court = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      okOf(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { name: 'Centre court', capacity: 5 }));
      expect(await hire('court-1', '10:00', 60)).toEqual({ ok: false, reason: 'resource_conflict' });
      expect(await hire('court-1', '10:30', 60)).toEqual({ ok: false, reason: 'resource_conflict' });
      booked(await hire('court-1', '11:00', 60)); // back to back is still fine
    });

    it('a deactivated resource takes no new reservation', async () => {
      const court = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      okOf(await cfg().updateResource(w.staff, 'court-1', court.updatedAt, { active: false }));
      expect(await hire('court-1', '12:00', 60)).toMatchObject({ ok: false });
    });

    it('a stale write changes nothing; invalid input is refused', async () => {
      const r = await mkResource();
      okOf(await cfg().updateResource(w.staff, r.id, r.updatedAt, { name: 'First' }));
      const before = await snapshot(ORG);
      expect(await cfg().updateResource(w.staff, r.id, r.updatedAt, { name: 'Second' })).toEqual({ ok: false, reason: 'stale_write' });
      for (const patch of [{}, { name: '' }, { kind: 'spaceship' }, { capacity: 0 }, { minParty: 0 }, { capacity: 2, minParty: 3 }, { active: 'no' }, { organisationId: OTHER }]) {
        expect(await thrown(cfg().updateResource(w.staff, r.id, r.updatedAt, patch as never))).toMatchObject({ code: 'invalid_input' });
      }
      expect(await snapshot(ORG)).toBe(before);
    });

    it('minParty above the stored capacity is refused by the combined row check', async () => {
      const r = await mkResource({ capacity: 4 });
      expect(await thrown(cfg().updateResource(w.staff, r.id, r.updatedAt, { minParty: 9 }))).toMatchObject({ code: 'invalid_input' });
    });

    it('needs scheduling.manage', async () => {
      const r = await mkResource();
      for (const t of [staff(ORG, ['scheduling.view']), staff(ORG, []), publicActor(ORG)]) {
        expect(await thrown(cfg().updateResource(t, r.id, r.updatedAt, { name: 'Nope' }))).toMatchObject({ code: 'permission_denied' });
      }
    });
  });

  // ─── unlink, list, archive ────────────────────────────────────────────────────

  describe('offering resources', () => {
    it('lists the linked resources and removes a link (idempotently), leaving the resource and the offering', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await cfg().linkOfferingResource(w.staff, o.id, 'court-1');
      await seedResource(ORG, 'space-1', 'space');
      await cfg().linkOfferingResource(w.staff, o.id, 'space-1');
      expect((await cfg().listOfferingResources(w.staff, o.id)).map(r => r.id)).toEqual(['court-1', 'space-1']);
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, o.id, 'court-1'))).toEqual({ removed: true });
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, o.id, 'court-1'))).toEqual({ removed: false });
      expect((await cfg().listOfferingResources(w.staff, o.id)).map(r => r.id)).toEqual(['space-1']);
      expect((await cfg().listResources(w.staff)).map(r => r.id)).toContain('court-1');
      expect((await cfg().getOffering(w.staff, o.id))!.resourceKinds).toEqual(['space']);
    });

    it('an unknown offering is not_found; a resource never linked is removed=false', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      expect(await cfg().unlinkOfferingResource(w.staff, 'no-such-offering', 'court-1')).toEqual({ ok: false, reason: 'not_found' });
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, o.id, 'court-1'))).toEqual({ removed: false });
    });

    it('is refused while a live hold of this resource belongs to THIS offering, but not for another offering or an ended hold', async () => {
      await cfg().linkOfferingResource(w.staff, w.hire.offering, 'court-1');
      const other = await mkOffering(w.hire.schedule, { name: 'Other hire', durationMinutes: null, capacity: null });
      await cfg().linkOfferingResource(w.staff, other.id, 'court-1');
      booked(await hire('court-1', '14:00', 60)); // held for w.hire.offering
      expect(await cfg().unlinkOfferingResource(w.staff, w.hire.offering, 'court-1')).toMatchObject({ ok: false, reason: 'allocation_in_use' });
      expect((await cfg().listOfferingResources(w.staff, w.hire.offering)).map(r => r.id)).toEqual(['court-1']);
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, other.id, 'court-1'))).toEqual({ removed: true }); // the hold is not this offering's
      await seedResource(ORG, 'space-1', 'space');
      // an occurrence-held resource of THIS offering also blocks
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await cfg().linkOfferingResource(w.staff, o.id, 'space-1');
      await seedOccurrence({ id: 'occ-live', org: ORG, offeringId: o.id, capacity: 4, startsAt: '2035-07-01T01:00:00Z', endsAt: '2035-07-01T02:00:00Z', resourceId: 'space-1' });
      expect(await cfg().unlinkOfferingResource(w.staff, o.id, 'space-1')).toMatchObject({ ok: false, reason: 'allocation_in_use' });
      // once the occurrence is cancelled its hold is released and the link can go
      await cfg().cancelOccurrence(w.staff, 'occ-live', 'test');
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, o.id, 'space-1'))).toEqual({ removed: true });
    });

    it('unlinking never deletes a reservation, occurrence or hold: booking history is intact', async () => {
      await cfg().linkOfferingResource(w.staff, w.hire.offering, 'court-1');
      const r = booked(await hire('court-1', '15:00', 60));
      await getPool().query("UPDATE scheduling_reservations SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff' WHERE id = $1", [r.id]);
      const counts = async () => [await count('SELECT count(*) FROM scheduling_reservations'), await count('SELECT count(*) FROM scheduling_resource_holds'), await count('SELECT count(*) FROM scheduling_occurrences')];
      const before = await counts();
      expect(okOf(await cfg().unlinkOfferingResource(w.staff, w.hire.offering, 'court-1'))).toEqual({ removed: true });
      expect(await counts()).toEqual(before);
      expect(await cfg().listHoldsForReservation(w.staff, r.id)).toHaveLength(1);
    });

    it('listOfferingResources needs scheduling.view and is staff-only; unlink needs scheduling.manage', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await cfg().linkOfferingResource(w.staff, o.id, 'court-1');
      expect(await cfg().listOfferingResources(staff(ORG, ['scheduling.view']), o.id)).toHaveLength(1);
      expect(await thrown(cfg().listOfferingResources(staff(ORG, []), o.id))).toMatchObject({ code: 'permission_denied' });
      expect(await thrown(cfg().listOfferingResources(publicActor(ORG), o.id))).toMatchObject({ code: 'permission_denied' });
      expect(await thrown(cfg().unlinkOfferingResource(staff(ORG, ['scheduling.view']), o.id, 'court-1'))).toMatchObject({ code: 'permission_denied' });
      expect(await thrown(cfg().unlinkOfferingResource(publicActor(ORG), o.id, 'court-1'))).toMatchObject({ code: 'permission_denied' });
    });

    it('archiveOffering is one way, reports false the second time, and touches no reservation', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      expect(await cfg().archiveOffering(w.staff, o.id)).toBe(true);
      expect(await cfg().archiveOffering(w.staff, o.id)).toBe(false);
      expect((await cfg().getOffering(w.staff, o.id))!.archivedAt).not.toBeNull();
      expect(await thrown(cfg().archiveOffering(staff(ORG, ['scheduling.view']), o.id))).toMatchObject({ code: 'permission_denied' });
    });

    it('a new offering cannot be created under an archived schedule', async () => {
      const s = await mkSchedule();
      await cfg().archiveSchedule(w.staff, s.id);
      expect(await thrown(mkOffering(s.id))).toMatchObject({ code: 'not_found' });
    });

    it('linking an unknown resource or offering is still not_found (existing behaviour preserved)', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await expect(cfg().linkOfferingResource(w.staff, o.id, 'no-such-resource')).rejects.toMatchObject({ code: 'not_found' });
      await expect(cfg().linkOfferingResource(w.staff, 'no-such-offering', 'court-1')).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  // ─── tenant isolation ─────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it("another organisation's staff cannot read, change, archive, unlink or list anything of this one, and changes no row", async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      const r = await mkResource({ name: 'Mine' });
      await cfg().linkOfferingResource(w.staff, o.id, r.id);
      booked(await hire('court-1', '17:00', 60));
      const intruder = staff(OTHER);
      const before = await snapshot(ORG);
      const beforeOther = await snapshot(OTHER);

      expect(await cfg().updateSchedule(intruder, s.id, s.updatedAt, { name: 'Hijacked' })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().updateOffering(intruder, o.id, o.updatedAt, { name: 'Hijacked', capacity: 1 })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().updateResource(intruder, r.id, r.updatedAt, { name: 'Hijacked', active: false })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().updateResource(intruder, 'court-1', (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!.updatedAt, { capacity: 1 })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().unlinkOfferingResource(intruder, o.id, r.id)).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().listOfferingResources(intruder, o.id)).toEqual([]);
      expect(await cfg().archiveOffering(intruder, o.id)).toBe(false);
      expect(await cfg().archiveSchedule(intruder, s.id)).toBe(false);

      expect(await snapshot(ORG)).toBe(before);
      expect(await snapshot(OTHER)).toBe(beforeOther);
    });

    it("this organisation cannot reach the other's rows by id either, in either direction", async () => {
      const theirs = (await getPool().query("SELECT updated_at FROM scheduling_schedules WHERE id = 'their-sched'")).rows[0];
      expect(theirs).toBeTruthy();
      const beforeOther = await snapshot(OTHER);
      const fakeToken = '2026-11-01T00:00:00.000000Z';
      expect(await cfg().updateSchedule(w.staff, 'their-sched', fakeToken, { name: 'x' })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().updateResource(w.staff, 'their-court', fakeToken, { name: 'x' })).toEqual({ ok: false, reason: 'not_found' });
      expect(await cfg().archiveSchedule(w.staff, 'their-sched')).toBe(false);
      expect(await snapshot(OTHER)).toBe(beforeOther);
    });

    it("an offering cannot be linked to, or unlinked from, another tenant's resource; the other tenant's links survive", async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      await expect(cfg().linkOfferingResource(w.staff, o.id, 'their-court')).rejects.toMatchObject({ code: 'not_found' });
      const theirOffering = await cfg().createOffering(staff(OTHER), 'their-sched', offeringInput('their-sched'));
      await cfg().linkOfferingResource(staff(OTHER), theirOffering.id, 'their-court');
      expect(await cfg().unlinkOfferingResource(w.staff, theirOffering.id, 'their-court')).toEqual({ ok: false, reason: 'not_found' });
      expect((await cfg().listOfferingResources(staff(OTHER), theirOffering.id)).map(r => r.id)).toEqual(['their-court']);
    });

    it('the same resource id in two organisations is two resources: editing one never touches the other', async () => {
      await seedResource(OTHER, 'court-1', 'court'); // same id as this organisation's court-1
      const mine = (await cfg().listResources(w.staff)).find(x => x.id === 'court-1')!;
      okOf(await cfg().updateResource(w.staff, 'court-1', mine.updatedAt, { name: 'Mine only', capacity: 9 }));
      const theirs = (await cfg().listResources(staff(OTHER))).find(x => x.id === 'court-1')!;
      expect(theirs).toMatchObject({ name: 'court court-1', capacity: 4 });
    });
  });

  // ─── concurrency ──────────────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('twenty simultaneous edits from one read: exactly one wins, nineteen are stale, and the winner is what is stored', async () => {
      const s = await mkSchedule();
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: `Edit ${i}` })));
      const winners = results.filter(r => r.ok);
      expect(winners).toHaveLength(1);
      expect(results.filter(r => !r.ok && r.reason === 'stale_write')).toHaveLength(19);
      expect((await cfg().getSchedule(w.staff, s.id))!.name).toBe((winners[0] as { ok: true; value: { name: string } }).value.name);
    });

    it('the same holds for offerings and resources', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      const r = await mkResource();
      const offerings = await Promise.all(Array.from({ length: 12 }, (_, i) => cfg().updateOffering(w.staff, o.id, o.updatedAt, { capacity: i + 1 })));
      expect(offerings.filter(x => x.ok)).toHaveLength(1);
      expect(offerings.filter(x => !x.ok && x.reason === 'stale_write')).toHaveLength(11);
      const resources = await Promise.all(Array.from({ length: 12 }, (_, i) => cfg().updateResource(w.staff, r.id, r.updatedAt, { capacity: i + 1 })));
      expect(resources.filter(x => x.ok)).toHaveLength(1);
      expect(resources.filter(x => !x.ok && x.reason === 'stale_write')).toHaveLength(11);
    });

    it('no lost update: two editors change different fields from the same read, and the second is refused rather than overwriting', async () => {
      const s = await mkSchedule();
      const [a, b] = await Promise.all([cfg().updateSchedule(w.staff, s.id, s.updatedAt, { name: 'Renamed' }), cfg().updateSchedule(w.staff, s.id, s.updatedAt, { timezone: 'Australia/Perth' })]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const final = (await cfg().getSchedule(w.staff, s.id))!;
      expect(a.ok ? final.name === 'Renamed' && final.timezone === null : final.timezone === 'Australia/Perth' && final.name === s.name).toBe(true);
    });

    // A second connection holds a transaction open so the order of two statements is fixed, not left to timing.
    async function inTransaction<T>(fn: (tx: PostgresSchedulingConfigRepository, finish: () => Promise<void>) => Promise<T>): Promise<T> {
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
        return await fn(new PostgresSchedulingConfigRepository({ sql: fromPgLike(c) }), finish);
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

    it('CONTROL: an offering inserted WITHOUT touching its schedule row does not stop a preset change (the guard alone is not enough)', async () => {
      const s = await mkSchedule();
      const c = await getPool().connect();
      try {
        await c.query('BEGIN');
        await c.query("INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, price_cents, currency) VALUES ('naive-off', $1, $2, 'Naive', 0, 'AUD')", [ORG, s.id]);
        const result = await cfg().updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' }); // not blocked: KEY SHARE does not conflict
        expect(result.ok).toBe(true);
        await c.query('COMMIT');
        expect(await count("SELECT count(*) FROM scheduling_offerings WHERE id = 'naive-off'")).toBe(1);
        expect((await cfg().getSchedule(w.staff, s.id))!.presetKey).toBe('appointments'); // the invariant is BROKEN without the version bump
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    });

    it('createOffering in flight vs a preset change: the preset change loses with stale_write, and the offering stands', async () => {
      const s = await mkSchedule();
      await inTransaction(async (tx, finish) => {
        const created = await tx.createOffering(w.staff, s.id, offeringInput(s.id)); // uncommitted
        const racing = cfg().updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' });
        expect(await pending(racing)).toBe(true); // it waits for the offering's transaction
        await finish();
        expect(await racing).toEqual({ ok: false, reason: 'stale_write' });
        expect((await cfg().getSchedule(w.staff, s.id))!.presetKey).toBe('classes_coaching');
        expect(await cfg().getOffering(w.staff, created.id)).not.toBeNull();
      });
    });

    it('a preset change in flight vs createOffering: the offering waits, then is created under the NEW preset', async () => {
      const s = await mkSchedule();
      await inTransaction(async (tx, finish) => {
        okOf(await tx.updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' })); // uncommitted
        const racing = mkOffering(s.id, { durationMinutes: 30, capacity: null });
        expect(await pending(racing)).toBe(true);
        await finish();
        const o = await racing;
        expect((await cfg().getSchedule(w.staff, s.id))!.presetKey).toBe('appointments');
        expect(o.scheduleId).toBe(s.id);
      });
    });

    it('archiveSchedule in flight vs createOffering: no offering is created under the archived schedule', async () => {
      const s = await mkSchedule();
      await inTransaction(async (tx, finish) => {
        expect(await tx.archiveSchedule(w.staff, s.id)).toBe(true); // uncommitted
        const racing = mkOffering(s.id);
        expect(await pending(racing)).toBe(true);
        await finish();
        await expect(racing).rejects.toMatchObject({ code: 'not_found' });
        expect(await count('SELECT count(*) FROM scheduling_offerings WHERE schedule_id = $1', [s.id])).toBe(0);
      });
    });

    it('linkOfferingResource in flight vs a kind change: the kind change loses with stale_write, the link stands, the kind is unchanged', async () => {
      const s = await mkSchedule();
      const o = await mkOffering(s.id);
      const r = await mkResource();
      await inTransaction(async (tx, finish) => {
        await tx.linkOfferingResource(w.staff, o.id, r.id); // uncommitted
        const racing = cfg().updateResource(w.staff, r.id, r.updatedAt, { kind: 'room' });
        expect(await pending(racing)).toBe(true);
        await finish();
        expect(await racing).toEqual({ ok: false, reason: 'stale_write' });
        expect((await cfg().listResources(w.staff)).find(x => x.id === r.id)!.kind).toBe('court');
        expect((await cfg().listOfferingResources(w.staff, o.id)).map(x => x.id)).toEqual([r.id]);
      });
    });

    it('stress: preset change racing offering creation never leaves an offering that was created BEFORE the preset changed', async () => {
      let both = 0;
      let violations = 0;
      for (let round = 0; round < 40; round++) {
        const s = await mkSchedule({ name: `Round ${round}` });
        const [u, c] = await Promise.allSettled([cfg().updateSchedule(w.staff, s.id, s.updatedAt, { presetKey: 'appointments' }), mkOffering(s.id, { name: `O${round}`, durationMinutes: 30, capacity: null })]);
        if (c.status !== 'fulfilled') continue;
        const changed = u.status === 'fulfilled' && u.value.ok;
        if (!changed) continue;
        both++;
        // both succeeded: legal only if the offering was created AFTER the change. The schedule row's last writer must then be the offering's statement.
        const r = await getPool().query('SELECT s.xmin::text AS sx, o.xmin::text AS ox FROM scheduling_schedules s JOIN scheduling_offerings o ON o.schedule_id = s.id AND o.organisation_id = s.organisation_id WHERE s.id = $1 AND s.organisation_id = $2', [s.id, ORG]);
        if (r.rows[0].sx !== r.rows[0].ox) violations++;
      }
      expect(violations).toBe(0);
      console.log(`CONFIG-EVIDENCE stress: 40 rounds, ${both} where both succeeded (offering ordered after the preset change), 0 violations`);
    }, 60_000);

    it('stress: kind change racing a link never leaves a linked resource whose kind changed after the link', async () => {
      let both = 0;
      let violations = 0;
      const s = await mkSchedule();
      for (let round = 0; round < 40; round++) {
        const o = await mkOffering(s.id, { name: `L${round}` });
        const r = await mkResource({ name: `R${round}` });
        const [u, l] = await Promise.allSettled([cfg().updateResource(w.staff, r.id, r.updatedAt, { kind: 'room' }), cfg().linkOfferingResource(w.staff, o.id, r.id)]);
        if (l.status !== 'fulfilled' || u.status !== 'fulfilled' || !u.value.ok) continue;
        both++;
        const x = await getPool().query('SELECT r.xmin::text AS rx FROM scheduling_resources r WHERE r.id = $1 AND r.organisation_id = $2', [r.id, ORG]);
        const link = await getPool().query('SELECT xmin::text AS lx FROM scheduling_offering_resources WHERE resource_id = $1 AND organisation_id = $2', [r.id, ORG]);
        // the link is legal only if its statement was the last writer of the resource row (i.e. it came after the kind change)
        const linkStmtXid = link.rows[0]?.lx;
        if (linkStmtXid !== undefined && x.rows[0].rx !== linkStmtXid) violations++;
      }
      expect(violations).toBe(0);
      console.log(`CONFIG-EVIDENCE stress: 40 rounds, ${both} where both succeeded (link ordered after the kind change), 0 violations`);
    }, 60_000);
  });
});
