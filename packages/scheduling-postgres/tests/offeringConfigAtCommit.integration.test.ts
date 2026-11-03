import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAvailabilityRepository, PostgresSchedulingConfigRepository, fromPgLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { GUARDED_BOOKING_SQL, GUARDED_BOOKING_TOKEN_SQL, SLOW_GUARDED_BOOKING_TOKEN_SQL } from './support/guardedBooking';
import { closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// PHASE 2C.3 PREFLIGHT: offering configuration at commit, on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2c.sh on 16 and 17).
//
// QUESTION. Migration 037 versions what decides AVAILABILITY (rules, closures, pins, links, resource active). An offering's OWN columns (duration, price, capacity, start time, name,
// recurrence) are not versioned, and the calendar derives its slot length and grid from `offering.durationMinutes`. Could a booking commit against an offering that was edited after
// the application read it?
//
// FINDING (characterised below, deterministic, no timing luck): yes. The guarded statement already locks the offering row FOR SHARE, but does not look at what is in it.
//
// DECISION (docs/architecture/scheduling-phase2c3-offering-config-at-commit.md, option A): the statement also requires the offering's edit token (`updated_at`, the same token every
// offering form already carries) that the application read. Any offering edit moves the token; the row is share-locked, so a writer waits for an in-flight booking (which stands) and a
// booking that waited for a writer re-checks the token against the writer's new row and inserts nothing. No migration, no new coupling for standalone consumers.
//
// FAILING FIRST: SCHEDULING_SKIP_OFFERING_TOKEN=1 turns the token clause into a no-op in the fixture; the "refuses" tests below must then be RED.

const ORG = 'org-offcfg';
const OTHER = 'org-offcfg-other';
const suite = hasDatabase ? describe : describe.skip;
const DAY = '2026-11-02';
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };
const ISO = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

let avail: PostgresAvailabilityRepository;
let config: PostgresSchedulingConfigRepository;
interface Fx { schedule: string; offering: string; court: string }
const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => getPool().query(text, params).then(r => r.rows as T[]);

async function fixture(org = ORG): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  await seedSchedule(org, f.schedule, 'resource_hire');
  await seedOffering(org, f.offering, f.schedule, { capacity: null, durationMinutes: 60 });
  await seedResource(org, f.court, 'court');
  await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  const t = staff(org);
  const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
  const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
  if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  return f;
}
const versions = async (f: Fx, org = ORG) => {
  const r = await q<{ owner_kind: string; v: string }>(`SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND ((owner_kind = 'offering' AND owner_id = $2) OR (owner_kind = 'resource' AND owner_id = $3))`, [org, f.offering, f.court]);
  return { offering: r.find(x => x.owner_kind === 'offering')!.v, resource: r.find(x => x.owner_kind === 'resource')!.v };
};
const token = async (f: Fx, org = ORG) => (await q<{ t: string }>(`SELECT ${ISO} AS t FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2`, [org, f.offering]))[0].t;
const slot = (f: Fx, time = '10:00', minutes = 60) => slotBooking(f.court, DAY, time, minutes, { schedule: f.schedule, offering: f.offering }).instants;
const withToken = (f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, tok: string, key: string | null = null, org = ORG) =>
  [org, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt, key, tok];
const live = async (f: Fx) => Number((await q<{ n: number }>("SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status <> 'cancelled'", [ORG, f.offering]))[0].n);
const holds = async (f: Fx) => Number((await q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [ORG, f.court]))[0].n);
const edit = (f: Fx, set: string, org = ORG) => q(`UPDATE scheduling_offerings SET ${set} WHERE organisation_id = $1 AND id = $2`, [org, f.offering]);

/** Wait until some OTHER backend is blocked on a lock whose query text contains `marker`: the interleaving is observed, not slept for. */
async function waitUntilBlocked(marker: string) {
  for (let i = 0; i < 200; i++) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1 AND pid <> pg_backend_pid()`, [`%${marker}%`]);
    if (r[0].n > 0) return;
    await new Promise(res => setTimeout(res, 25));
  }
  throw new Error(`nothing became blocked on a lock for: ${marker}`);
}
/** Wait until a backend is running (not waiting) a statement containing `marker` (the slow booking is inside its pg_sleep, holding its locks). */
async function waitUntilRunning(marker: string) {
  for (let i = 0; i < 200; i++) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event = 'PgSleep' AND query LIKE $1 AND pid <> pg_backend_pid()`, [`%${marker}%`]);
    if (r[0].n > 0) return;
    await new Promise(res => setTimeout(res, 25));
  }
  throw new Error(`nothing is running: ${marker}`);
}

suite('offering configuration at commit (option A: the offering edit token)', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('037_availability_versions.sql'));
    await resetData();
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
    config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
    for (const org of [ORG, OTHER]) await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, 'Australia/Adelaide']);
  }, 120_000);
  afterAll(async () => { await closePool(); });

  it('CHARACTERISATION: a duration edit does not move any availability version, so the 037-only statement books the OLD length', async () => {
    const f = await fixture();
    const v = await versions(f);
    await edit(f, 'duration_minutes = 90');
    expect(await versions(f)).toEqual(v); // 037 does not see it
    const r = await q(GUARDED_BOOKING_SQL, [ORG, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, slot(f).startsAt, slot(f).endsAt, null]);
    expect(r).toHaveLength(1); // a 60-minute booking against a now-90-minute offering
  });

  it('a booking with the token it read books', async () => {
    const f = await fixture();
    const v = await versions(f);
    const r = await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), await token(f)));
    expect(r).toHaveLength(1);
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  });

  it.each([
    ['duration', 'duration_minutes = 90'],
    ['price', 'price_cents = 2500'],
    ['capacity', 'capacity = 12'],
    ['start time', "start_time = '08:00'"],
    ['name', "name = 'renamed'"],
    ['archive', 'archived_at = now()'],
  ])('REFUSES (AVAILABILITY_CHANGED shape: zero rows, no reservation, no hold) when the offering %s was edited after the application read it', async (_label, set) => {
    const f = await fixture();
    const v = await versions(f);
    const tok = await token(f);
    await edit(f, set);
    expect(await token(f)).not.toBe(tok); // every edit moves the token the forms already carry
    const r = await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok));
    expect(r).toEqual([]);
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
    if (set !== 'archived_at = now()') {
      // the retry with a fresh read books
      const again = await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, await versions(f), slot(f), await token(f)));
      expect(again).toHaveLength(1);
    }
  });

  it('a writer that COMMITS FIRST while the booking is blocked behind it: the booking re-checks the token under READ COMMITTED and inserts nothing', async () => {
    const f = await fixture();
    const v = await versions(f);
    const tok = await token(f);
    const writer = await getPool().connect();
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE scheduling_offerings SET duration_minutes = 90 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]); // uncommitted: holds the row
      const booking = q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok, uid('k')));
      await waitUntilBlocked('FROM scheduling_offerings o');
      await writer.query('COMMIT');
      expect(await booking).toEqual([]);
    } finally {
      writer.release();
    }
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
  });

  it('a BOOKING FIRST stands: the offering edit waits for the in-flight booking, then applies; the booking is not undone and a second stale booking is refused', async () => {
    const f = await fixture();
    const v = await versions(f);
    const tok = await token(f);
    const key = uid('first');
    // pg_stat_activity truncates query text at 1024 bytes, so the marker is a leading comment, not the pg_sleep at the end.
    const slow = q('/* booking-first-marker */ ' + SLOW_GUARDED_BOOKING_TOKEN_SQL(1.5), withToken(f, v, slot(f), tok, key));
    await waitUntilRunning('booking-first-marker');
    const t0 = Date.now();
    const writer = edit(f, 'duration_minutes = 90').then(() => Date.now() - t0);
    await waitUntilBlocked('UPDATE scheduling_offerings');
    expect(await slow).toHaveLength(1);
    expect(await writer).toBeGreaterThan(500); // it waited
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
    expect(await token(f)).not.toBe(tok);
    const second = await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, await versions(f), slot(f, '14:00'), tok));
    expect(second).toEqual([]); // stale token
  }, 30_000);

  it('the idempotency key still resolves a repeat: the same key with the same token inserts nothing the second time (ON CONFLICT), and the one reservation stands', async () => {
    const f = await fixture();
    const v = await versions(f);
    const tok = await token(f);
    const key = uid('idem');
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok, key))).toHaveLength(1);
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok, key))).toEqual([]);
    expect(await live(f)).toBe(1);
  });

  it('TENANT ISOLATION: the other organisation\'s token, ids or versions book nothing here, and an edit in the other organisation does not move this token', async () => {
    const f = await fixture();
    const g = await fixture(OTHER);
    const v = await versions(f);
    const tok = await token(f);
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok, null, OTHER))).toEqual([]); // this org's ids under the other organisation
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), await token(g, OTHER)))).toEqual([]); // another org's token
    await edit(g, 'duration_minutes = 45', OTHER);
    expect(await token(f)).toBe(tok);
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok))).toHaveLength(1);
  });

  it('PARTY LIMITS are already enforced by the database at commit (031, SCPTY), whatever the application read: a resource minimum raised after the read refuses the party', async () => {
    const f = await fixture();
    const v = await versions(f);
    const tok = await token(f);
    await q('UPDATE scheduling_resources SET capacity = 4, min_party = 2 WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
    await expect(q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, v, slot(f), tok))).rejects.toMatchObject({ code: 'SCPTY' }); // the statement books a party of 1
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
  });
  it('a duration edit through the REAL configuration repository (updateOffering with the form token) moves the token the statement checks, and the stale form token is then refused', async () => {
    const f = await fixture();
    const tok = await token(f);
    const res = await config.updateOffering(staff(ORG), f.offering, tok, { durationMinutes: 75 });
    expect(res.ok).toBe(true);
    expect(await token(f)).not.toBe(tok);
    const again = await config.updateOffering(staff(ORG), f.offering, tok, { durationMinutes: 80 });
    expect(again).toMatchObject({ ok: false, reason: 'stale_write' });
    expect(await q(GUARDED_BOOKING_TOKEN_SQL, withToken(f, await versions(f), slot(f), tok))).toEqual([]);
  });
});
