import type { NewReservationInput, PresetKey, TenantContext } from '@scheduling/core';
import { PRESETS, localWindowToInstants, resolveLocalTime } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository } from '@scheduling/postgres';
import { FixedClock, getPool, seedOffering, seedResource, seedSchedule, sql } from './pgHarness';

// Input builders that produce VALID reservations for each time model, so a test states only
// what it varies. All are Adelaide-local (the BrainBase fallback timezone).

export const TZ = 'Australia/Adelaide';

export function person(name: string, email: string | null = null) {
  return { displayName: name, email, emailNormalised: email ? email.trim().toLowerCase() : null, phone: null };
}

let n = 0;
const nextEmail = () => `guest${++n}@example.com`;

/** A headcount booking on an occurrence. */
export function classBooking(occurrenceId: string, ids: { schedule: string; offering: string }, over: Partial<NewReservationInput> = {}): NewReservationInput {
  return {
    scheduleId: ids.schedule,
    presetKey: 'classes_coaching',
    presetVersion: PRESETS.classes_coaching.version,
    offeringId: ids.offering,
    resourceId: null,
    customerId: null,
    customerSnapshot: person('Guest', nextEmail()),
    timezone: TZ,
    instants: { startsAt: '2026-12-07T05:30:00Z', endsAt: '2026-12-07T06:30:00Z' },
    partySize: 1,
    span: { kind: 'occurrence', occurrenceId },
    price: { amountCents: 0, currency: 'AUD' },
    seriesId: null,
    notes: null,
    ...over,
  };
}

/** An exclusive-resource slot booking (resource_hire preset) from a local date/time. */
export function slotBooking(resourceId: string, date: string, time: string, minutes: number, ids: { schedule: string; offering: string }, over: Partial<NewReservationInput> = {}): NewReservationInput {
  const startsAt = resolveLocalTime(date, time, TZ).instant;
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60000).toISOString().replace('.000Z', 'Z');
  return {
    scheduleId: ids.schedule,
    presetKey: 'resource_hire',
    presetVersion: PRESETS.resource_hire.version,
    offeringId: ids.offering,
    resourceId,
    customerId: null,
    customerSnapshot: person('Hirer', nextEmail()),
    timezone: TZ,
    instants: { startsAt, endsAt },
    partySize: 1,
    span: { kind: 'slot', date, startTime: time, durationMinutes: minutes },
    price: { amountCents: 5000, currency: 'AUD' },
    seriesId: null,
    notes: null,
    ...over,
  };
}

/** A hotel stay: check-in/out are local dates with times of day, held as [check-in, check-out). */
export function stayBooking(roomId: string, checkIn: string, checkOut: string, ids: { schedule: string; offering: string }, over: Partial<NewReservationInput> & { inTime?: string; outTime?: string } = {}): NewReservationInput {
  const { inTime = '14:00', outTime = '10:00', ...rest } = over;
  const w = localWindowToInstants({ date: checkIn, time: inTime }, { date: checkOut, time: outTime }, TZ);
  if (!w.ok) throw new Error(w.problem);
  return {
    scheduleId: ids.schedule,
    presetKey: 'accommodation',
    presetVersion: PRESETS.accommodation.version,
    offeringId: ids.offering,
    resourceId: roomId,
    customerId: null,
    customerSnapshot: person('Guest', nextEmail()),
    timezone: TZ,
    instants: w.instants,
    partySize: 2,
    span: { kind: 'stay', checkIn, checkOut },
    price: { amountCents: 20000, currency: 'AUD' },
    seriesId: null,
    notes: null,
    ...rest,
  };
}

/** An appointment (preset v2). resourceId null asks the repository to assign one. */
export function appointmentBooking(resourceId: string | null, date: string, time: string, minutes: number, ids: { schedule: string; offering: string }, over: Partial<NewReservationInput> = {}): NewReservationInput {
  return { ...slotBooking(resourceId as string, date, time, minutes, ids, { presetKey: 'appointments', presetVersion: PRESETS.appointments.version, price: { amountCents: 9000, currency: 'AUD' }, ...over }), resourceId };
}

export interface World {
  org: string;
  staff: TenantContext;
  repo: PostgresReservationRepository;
  config: PostgresSchedulingConfigRepository;
  hire: { schedule: string; offering: string };
  stay: { schedule: string; offering: string };
  appt: { schedule: string; offering: string };
  cls: { schedule: string; offering: string };
}

/** One organisation with a hire schedule, an accommodation schedule and a class schedule. */
export async function makeWorld(org: string, staffTenant: TenantContext, clock = new FixedClock()): Promise<World> {
  const hire = { schedule: `${org}-sched-hire`, offering: `${org}-off-hire` };
  const stay = { schedule: `${org}-sched-stay`, offering: `${org}-off-stay` };
  const cls = { schedule: `${org}-sched-class`, offering: `${org}-off-class` };
  const appt = { schedule: `${org}-sched-appt`, offering: `${org}-off-appt` };
  await seedSchedule(org, hire.schedule, 'resource_hire');
  await seedOffering(org, hire.offering, hire.schedule, { capacity: null });
  await seedSchedule(org, stay.schedule, 'accommodation');
  await seedOffering(org, stay.offering, stay.schedule, { capacity: null, durationMinutes: null });
  await seedSchedule(org, appt.schedule, 'appointments');
  await seedOffering(org, appt.offering, appt.schedule, { capacity: null, durationMinutes: 30 });
  await seedSchedule(org, cls.schedule, 'classes_coaching');
  await seedOffering(org, cls.offering, cls.schedule, { capacity: 10 });
  await seedResource(org, 'court-1', 'court');
  await seedResource(org, 'room-1', 'room');
  // 031: a reservation (any actor) or occurrence may only use a resource its offering is assigned. The world assigns the two
  // resources it seeds where its offerings can use them; tests that seed more resources assign them explicitly (linkResources).
  await linkResources(org, [[hire.offering, 'court-1'], [stay.offering, 'room-1'], [cls.offering, 'court-1']]);
  return {
    org,
    staff: staffTenant,
    repo: new PostgresReservationRepository({ sql: sql(), clock }),
    config: new PostgresSchedulingConfigRepository({ sql: sql() }),
    hire,
    stay,
    appt,
    cls,
  };
}

export async function liveHolds(org: string, resourceId: string): Promise<number> {
  const r = await getPool().query('SELECT count(*)::int AS c FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [org, resourceId]);
  return r.rows[0].c;
}

export const presetOf = (k: PresetKey) => PRESETS[k];

/** Assigns resources to offerings with plain SQL (a test seam, like the other seeders). Idempotent. */
export async function linkResources(org: string, pairs: Array<[offeringId: string, resourceId: string]>) {
  for (const [offering, resource] of pairs) {
    await getPool().query(
      'INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [org, offering, resource],
    );
  }
}
