import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { GUARDED_BOOKING_SQL, GUARDED_BOOKING_TOKEN_SQL, SLOW_BUMP_SQL, SLOW_GUARDED_BOOKING_SQL } from './support/guardedBooking';
import { staff, uid } from './support/pgHarness';

// BOOKING INTEGRITY GATES through the REAL @neondatabase/serverless HTTP driver, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is set.
//
// SAFETY. The suite refuses to run unless ALL hold: NEON_REHEARSAL_HOST equals the host of NEON_REHEARSAL_URL (so the operator names the endpoint knowingly), the login role is
// exactly rehearsal_037 (a role that exists only on a disposable branch; never the application role), and migration 037 is present. It writes only synthetic organisations
// (neon-gate-a, neon-gate-b) and removes them afterwards. A pilot organisation can be named with NEON_REHEARSAL_PILOT_ORG: it is READ, never written, and compared before and after.
// No credential is stored here: the URL comes from the environment.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = process.env.NEON_REHEARSAL_HOST ?? '';
const suite = URL_ !== '' ? describe : describe.skip;

const ORG = 'neon-gate-a';
const OTHER = 'neon-gate-b';
const PILOT = process.env.NEON_REHEARSAL_PILOT_ORG ?? '';
const DAY = '2026-11-16'; // a Monday
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };

type Q = { query(text: string, params?: unknown[], opts?: Record<string, unknown>): Promise<unknown>; transaction: (q: unknown[], o?: Record<string, unknown>) => Promise<unknown[]> };
let sql: Q;
let avail: PostgresAvailabilityRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
interface Fx { schedule: string; offering: string; court: string }

async function fixture(org = ORG): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  const cfg = defaultScheduleConfig({ id: f.schedule, organisationId: org, name: 'gate', presetKey: 'resource_hire' });
  await sql.query(
    `INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone) VALUES ($1, $2, $3, 'resource_hire', $4, NULL, $5::jsonb, $6::jsonb, NULL)`,
    [f.schedule, org, cfg.name, PRESETS.resource_hire.version, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy)],
  );
  await sql.query(`INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, 'gate offering', NULL, 60, 0, 'AUD')`, [f.offering, org, f.schedule]);
  await sql.query(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', 'gate court', 4, true)`, [f.court, org]);
  await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  const t = staff(org);
  const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
  const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
  if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  return f;
}
const versions = async (f: Fx, org = ORG) => {
  const r = await rows(`SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND ((owner_kind = 'offering' AND owner_id = $2) OR (owner_kind = 'resource' AND owner_id = $3))`, [org, f.offering, f.court]);
  return { offering: String(r.find(x => x.owner_kind === 'offering')?.v), resource: String(r.find(x => x.owner_kind === 'resource')?.v) };
};
const slot = (f: Fx, time = '10:00', minutes = 60) => slotBooking(f.court, DAY, time, minutes, { schedule: f.schedule, offering: f.offering }).instants;
const params = (f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, key: string | null = null, org = ORG) => [org, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt, key];
const book = (f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, key: string | null = null) => sql.query(GUARDED_BOOKING_SQL, params(f, v, w, key)) as Promise<Array<Record<string, unknown>>>;
const live = async (f: Fx) => Number((await rows("SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status <> 'cancelled'", [ORG, f.offering]))[0].n);
const holds = async (f: Fx) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [ORG, f.court]))[0].n);
const code = (e: unknown) => (e as { code?: string }).code;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// The interleaving is OBSERVED, not slept for. pg_stat_activity truncates query text at 1024 bytes, so every statement we wait on carries a leading comment marker.
async function waitForBackend(marker: string, kind: 'running' | 'blocked') {
  const cond = kind === 'running' ? "state = 'active' AND wait_event = 'PgSleep'" : "wait_event_type = 'Lock'";
  for (let i = 0; i < 400; i++) {
    const r = await rows(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND ${cond} AND query LIKE $1 AND pid <> pg_backend_pid()`, [`%${marker}%`]);
    if (Number(r[0].n) > 0) return;
    await sleep(25);
  }
  throw new Error(`never observed a ${kind} backend for ${marker}`);
}
const marked = (marker: string, text: string) => `/* ${marker} */ ${text}`;
const go = <T>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p);

// The host contract of docs/architecture/scheduling-phase2c-availability-at-commit.md section 4.2, step 4, as a test-local mapping (no such host code exists yet: 2C.3).
async function outcome(f: Fx, v: { offering: string; resource: string }, w: { startsAt: string; endsAt: string }, key: string | null = null) {
  try {
    const r = await book(f, v, w, key);
    if (r.length === 1) return 'BOOKED';
    const still = await rows(`SELECT (SELECT count(*) FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2)::int + (SELECT count(*) FROM scheduling_resources WHERE organisation_id = $1 AND id = $3)::int AS n`, [ORG, f.offering, f.court]);
    return Number(still[0].n) === 2 ? 'AVAILABILITY_CHANGED' : 'NOT_FOUND';
  } catch (e) {
    return `ERROR_${code(e)}`;
  }
}

const PILOT_SNAPSHOT_SQL = `SELECT
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_availability_rules r WHERE organisation_id = $1) AS rules,
  (SELECT md5(string_agg(z::text, '|' ORDER BY z::text)) FROM scheduling_availability_zones z WHERE organisation_id = $1) AS zones,
  (SELECT md5(string_agg(v::text, '|' ORDER BY owner_kind, owner_id)) FROM scheduling_availability_versions v WHERE organisation_id = $1) AS versions,
  (SELECT string_agg(day_of_week||' '||start_time||'-'||end_time, ',') FROM scheduling_availability_rules WHERE organisation_id = $1) AS hours,
  (SELECT string_agg(timezone, ',') FROM scheduling_availability_zones WHERE organisation_id = $1) AS tz,
  (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id = $1) AS reservations,
  (SELECT count(*)::int FROM scheduling_resource_holds WHERE organisation_id = $1) AS holds`;
let pilotBefore: Record<string, unknown>;

suite('037 gate rehearsal: extra proofs through the REAL Neon HTTP driver', () => {
  beforeAll(async () => {
    const u = new URL(URL_);
    if (EXPECTED_HOST === '' || u.host !== EXPECTED_HOST || u.username !== 'rehearsal_037') throw new Error('refusing to run: NEON_REHEARSAL_HOST must name the endpoint, and the role must be rehearsal_037');
    sql = neon(URL_) as unknown as Q;
    const who = await rows(`SELECT current_user AS u, to_regclass('public.scheduling_availability_versions') IS NOT NULL AS has`);
    if (who[0].u !== 'rehearsal_037' || who[0].has !== true) throw new Error('refusing to run: not the rehearsal role, or 037 not applied');
    avail = new PostgresAvailabilityRepository({ sql: fromNeonHttpLike(sql as never) });
    for (const org of [ORG, OTHER]) await sql.query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, 'Australia/Adelaide']);
    pilotBefore = PILOT === '' ? {} : (await rows(PILOT_SNAPSHOT_SQL, [PILOT]))[0];
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    for (const org of [ORG, OTHER]) {
      // Dependency order; offerings and resources take their version rows with them (ON DELETE CASCADE). Best effort: a failure leaves synthetic rows on a disposable branch only.
      for (const t of ['scheduling_resource_holds', 'scheduling_reservations', 'scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_offering_resources', 'scheduling_offerings', 'scheduling_resources', 'scheduling_schedules']) {
        await sql.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [org]).catch(() => undefined);
      }
      await sql.query('DELETE FROM organisations WHERE id = $1', [org]).catch(() => undefined);
    }
  }, 60_000);

  it('A: availability changed first -> AVAILABILITY_CHANGED, and no reservation and no hold', async () => {
    const f = await fixture();
    const v = await versions(f);
    const rule = (await rows(`SELECT id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at FROM scheduling_availability_rules WHERE organisation_id = $1 AND resource_id = $2`, [ORG, f.court]))[0];
    const edit = await avail.updateRule(staff(ORG), String(rule.id), String(rule.updated_at), { startTime: '11:00' } as never);
    expect(edit.ok).toBe(true);
    expect(await outcome(f, v, slot(f))).toBe('AVAILABILITY_CHANGED');
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
  });

  it('C: 8 parallel requests for DIFFERENT but overlapping windows on one exclusive court: exactly one wins', async () => {
    const f = await fixture();
    const v = await versions(f);
    const windows = ['10:00', '10:30', '10:15', '10:45', '10:00', '10:30', '10:20', '10:40'].map(t => slot(f, t));
    const results = await Promise.allSettled(windows.map(w => book(f, v, w)));
    const won = results.filter(r => r.status === 'fulfilled' && (r.value as unknown[]).length === 1);
    expect(won).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(code(r.reason)).toBe('23P01');
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  }, 60_000);

  it('D: a kind change of a linked or booked resource is refused (SCRIU), and deactivation racing an in-flight booking waits, then is refused', async () => {
    const f = await fixture();
    await expect(sql.query(`UPDATE scheduling_resources SET kind = 'room' WHERE organisation_id = $1 AND id = $2`, [ORG, f.court])).rejects.toMatchObject({ code: 'SCRIU' });
    const v = await versions(f);
    const slow = go(sql.query(marked('gate-deact', SLOW_GUARDED_BOOKING_SQL(2)), params(f, v, slot(f), uid('d'))) as PromiseLike<unknown[]>);
    await waitForBackend('gate-deact', 'running');
    const t0 = Date.now();
    const deactP = sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2 /* gate-deact-writer */', [ORG, f.court]).then(() => 'ok', e => code(e));
    await waitForBackend('gate-deact-writer', 'blocked'); // the writer is observed waiting on the booking's lock
    const deact = await deactP;
    const waited = Date.now() - t0;
    expect(await slow).toHaveLength(1);
    expect(deact).toBe('SCRIU');
    expect(waited).toBeGreaterThan(300);
    // Unlink while a live booking holds the resource: refused by 030 (SCALU); the refused statement rolls back, so neither version moved; the booking stands.
    const before = await versions(f);
    await expect(sql.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court])).rejects.toMatchObject({ code: 'SCALU' });
    expect(await versions(f)).toEqual(before);
    expect(await outcome(f, before, slot(f, '14:00'))).toBe('BOOKED'); // unchanged versions, a free window: still bookable
    expect([await live(f), await holds(f)]).toEqual([2, 2]);
  }, 60_000);

  it('D: reactivation, a closure edit and delete, a rule delete and a re-link each bump the version exactly once', async () => {
    const f = await fixture();
    const step = async (label: string, kind: 'offering' | 'resource', act: () => Promise<unknown>) => {
      const b = await versions(f);
      await act();
      const a = await versions(f);
      return [label, BigInt(a[kind]) - BigInt(b[kind])].join(':');
    };
    const t = staff(ORG);
    const out: string[] = [];
    out.push(await step('deactivate', 'resource', () => sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court])));
    out.push(await step('same-active', 'resource', () => sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court])));
    out.push(await step('reactivate', 'resource', () => sql.query('UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = $2', [ORG, f.court])));
    const ex = await avail.createException(t, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
    if (!ex.ok) throw new Error('closure');
    out.push(await step('closure-edit', 'offering', () => avail.updateException(t, ex.value.id, ex.value.updatedAt, { reason: 'gate' } as never)));
    const cur = (await rows(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at FROM scheduling_availability_exceptions WHERE id = $1`, [ex.value.id]))[0];
    out.push(await step('closure-delete', 'offering', () => avail.deleteException(t, ex.value.id, String(cur.updated_at))));
    const rule = (await rows(`SELECT id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at FROM scheduling_availability_rules WHERE organisation_id = $1 AND offering_id = $2`, [ORG, f.offering]))[0];
    out.push(await step('rule-delete', 'offering', () => avail.deleteRule(t, String(rule.id), String(rule.updated_at))));
    out.push(await step('unlink', 'offering', () => sql.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering])));
    out.push(await step('relink', 'resource', () => sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, f.court])));
    expect(out).toEqual(['deactivate:1', 'same-active:0', 'reactivate:1', 'closure-edit:1', 'closure-delete:1', 'rule-delete:1', 'unlink:1', 'relink:1']);
  }, 60_000);

  it('Lifecycle: an archived offering books nothing (no version bump needed: the row predicate), an archive racing an in-flight booking waits for it, and an archived schedule is refused (SCARC)', async () => {
    const a = await fixture();
    const va = await versions(a);
    await sql.query('UPDATE scheduling_offerings SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, a.offering]);
    expect(await versions(a)).toEqual(va); // archive does not bump
    expect(await outcome(a, va, slot(a))).toBe('AVAILABILITY_CHANGED');
    const b = await fixture();
    const vb = await versions(b);
    const slow = go(sql.query(marked('gate-arc', SLOW_GUARDED_BOOKING_SQL(2)), params(b, vb, slot(b), uid('arc'))) as PromiseLike<unknown[]>);
    await waitForBackend('gate-arc', 'running');
    const t0 = Date.now();
    // go(): the driver's query object is a lazy thenable, so it must be started before we wait to observe it.
    const archiveP = go(sql.query('UPDATE scheduling_offerings SET archived_at = now() WHERE organisation_id = $1 AND id = $2 /* gate-arc-writer */', [ORG, b.offering]));
    await waitForBackend('gate-arc-writer', 'blocked');
    await archiveP;
    const waited = Date.now() - t0;
    expect(await slow).toHaveLength(1);
    expect(waited).toBeGreaterThan(300);
    const c = await fixture();
    const vc = await versions(c);
    await sql.query('UPDATE scheduling_schedules SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, c.schedule]);
    expect(await outcome(c, vc, slot(c))).toBe('ERROR_SCARC');
    expect([await live(a), await live(c)]).toEqual([0, 0]);
  }, 60_000);

  it('offering configuration: a duration edit does not move the availability version (so the 037-only statement books the old length), but the offering edit token refuses it', async () => {
    const f = await fixture();
    const v = await versions(f);
    const tok = String((await rows(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2`, [ORG, f.offering]))[0].t);
    await sql.query('UPDATE scheduling_offerings SET duration_minutes = 90 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]);
    expect(await versions(f)).toEqual(v); // the gap: 037 does not see an offering's own columns
    const withTok = await sql.query(GUARDED_BOOKING_TOKEN_SQL, [...params(f, v, slot(f)), tok]);
    expect(withTok).toEqual([]); // decision A (docs/architecture/scheduling-phase2c3-offering-config-at-commit.md): the stale token books nothing
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
    const fresh = String((await rows(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2`, [ORG, f.offering]))[0].t);
    expect(await sql.query(GUARDED_BOOKING_TOKEN_SQL, [...params(f, v, slot(f)), fresh])).toHaveLength(1);
  });

  it('E: a server-side statement_timeout set by SET LOCAL in a non-interactive transaction cancels the booking (57014), writes nothing, and does not leak to the next request', async () => {
    const f = await fixture();
    const v = await versions(f);
    const key = uid('to');
    const t0 = Date.now();
    const r = await sql.transaction([sql.query(`SET LOCAL statement_timeout = '1500ms'`), sql.query(SLOW_GUARDED_BOOKING_SQL(4), params(f, v, slot(f), key))] as never).then(() => 'ok', e => code(e));
    const took = Date.now() - t0;
    expect(r).toBe('57014');
    expect(took).toBeLessThan(3500);
    expect((await rows('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND idempotency_key = $2', [ORG, key]))[0].n).toBe(0);
    expect((await rows('SELECT current_setting($1) AS s', ['statement_timeout']))[0].s).toBe('0');
    expect(await book(f, await versions(f), slot(f), key)).toHaveLength(1); // the retry with the same key converges on one
    expect([await live(f), await holds(f)]).toEqual([1, 1]);
  }, 60_000);

  it('E: SET LOCAL lock_timeout in the same batch turns a long wait behind a configuration writer into 55P03 (contention, not "unavailable"), writing nothing', async () => {
    const f = await fixture();
    const v = await versions(f);
    const writer = go(sql.query(marked('gate-bump', SLOW_BUMP_SQL(3)), [ORG, 'resource', f.court]));
    await waitForBackend('gate-bump', 'running');
    const r = await sql.transaction([sql.query(`SET LOCAL lock_timeout = '700ms'`), sql.query(GUARDED_BOOKING_SQL, params(f, v, slot(f)))] as never).then(() => 'ok', e => code(e));
    await writer;
    expect(r).toBe('55P03');
    expect([await live(f), await holds(f)]).toEqual([0, 0]);
  }, 60_000);

  it('F: another organisation cannot move, rewind, re-own, forge or bump the pilot-shaped owner\'s version rows', async () => {
    const f = await fixture();
    const before = await versions(f);
    // scoped by the other organisation: touches nothing
    expect(await rows(`UPDATE scheduling_availability_versions SET version = version + 1 WHERE organisation_id = $1 AND owner_id = $2 RETURNING 1`, [OTHER, f.offering])).toEqual([]);
    await sql.query(`SELECT scheduling_bump_availability_version_of($1, 'offering', $2)`, [OTHER, f.offering]);
    expect(await versions(f)).toEqual(before);
    // even unscoped writes are refused by the guard
    await expect(sql.query(`UPDATE scheduling_availability_versions SET organisation_id = $1 WHERE organisation_id = $2 AND owner_kind = 'offering' AND owner_id = $3`, [OTHER, ORG, f.offering])).rejects.toMatchObject({ code: expect.stringMatching(/SCIMM|23503/) });
    await expect(sql.query(`UPDATE scheduling_availability_versions SET version = 0 WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2`, [ORG, f.offering])).rejects.toMatchObject({ code: 'SCIMM' });
    await expect(sql.query(`UPDATE scheduling_availability_versions SET version = version + 2 WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2`, [ORG, f.offering])).rejects.toMatchObject({ code: 'SCIMM' });
    await expect(sql.query('INSERT INTO scheduling_availability_versions (organisation_id, offering_id) VALUES ($1, $2)', [OTHER, f.offering])).rejects.toMatchObject({ code: '23503' });
    await expect(sql.query('INSERT INTO scheduling_availability_versions (organisation_id, offering_id, version) VALUES ($1, $2, 99)', [ORG, f.offering])).rejects.toMatchObject({ code: '23505' });
    expect(await versions(f)).toEqual(before);
    // and the other organisation's own versions with this organisation's ids book nothing
    expect(await sql.query(GUARDED_BOOKING_SQL, params(f, before, slot(f), null, OTHER))).toEqual([]);
    expect(await live(f)).toBe(0);
  });

  it('F (fail-closed note): a hand DELETE of a version row is not blocked, and then the owner can never be booked (nothing recreates the row)', async () => {
    const f = await fixture();
    const v = await versions(f);
    await sql.query(`DELETE FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = $2`, [ORG, f.court]);
    expect(await outcome(f, v, slot(f))).toBe('AVAILABILITY_CHANGED');
    await sql.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
    expect((await rows(`SELECT count(*)::int AS n FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_id = $2`, [ORG, f.court]))[0].n).toBe(0);
    expect(await live(f)).toBe(0);
  });

  it('G: the pilot organisation (Monday 09:00-12:00, Australia/Adelaide) is unchanged by everything above, with no reservation or hold', async () => {
    if (PILOT === '') return; // no pilot organisation named: nothing to compare
    const now = (await rows(PILOT_SNAPSHOT_SQL, [PILOT]))[0];
    expect(now).toEqual(pilotBefore); // never written by this suite
    expect(now).toMatchObject({ reservations: 0, holds: 0 });
    console.log('[gate] pilot snapshot', JSON.stringify(now));
  });

  it('cost: one guarded booking request through the driver (round trip incl. scheduling_is_timezone CHECK), 5 samples', async () => {
    const f = await fixture();
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v = await versions(f);
      const t0 = Date.now();
      expect(await book(f, v, slot(f, `${9 + i}:00`.padStart(5, '0')))).toHaveLength(1);
      ms.push(Date.now() - t0);
    }
    const ping: number[] = [];
    for (let i = 0; i < 5; i++) { const t0 = Date.now(); await sql.query('SELECT 1'); ping.push(Date.now() - t0); }
    console.log('[gate] guarded booking ms', ms.join(','), '| SELECT 1 ms', ping.join(','));
  }, 60_000);
});
