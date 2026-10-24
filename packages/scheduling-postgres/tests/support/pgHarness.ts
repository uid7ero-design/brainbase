import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { Clock, PresetKey, TenantContext } from '@scheduling/core';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { fromPgLike, type SqlExecutor } from '@scheduling/postgres';

// Real-Postgres test harness for the scheduling persistence layer. TEST-ONLY.
//
// The suites run against a DISPOSABLE database named by SCHEDULING_TEST_DATABASE_URL (a Docker
// container started by scripts/tests/verify-scheduling-phase2a.sh, or a throwaway Neon branch).
// They never read DATABASE_URL, so they cannot reach the application's database by accident.
// Pools keep idle connections for 2 minutes: re-opening hundreds of sockets per round exhausts the
// ephemeral ports of a Windows machine (thousands of TIME_WAIT sockets) and kills the test process.
// pg.Pool gives each concurrent statement its own connection, which is what makes the
// concurrency tests real races rather than serialised calls.

export const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
export const hasDatabase = TEST_URL !== '';

const SQL_DIR = path.resolve(__dirname, '../../../scheduling/sql');
export const sqlFile = (name: string) => readFileSync(path.join(SQL_DIR, name), 'utf8');
export const hostSqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../../../scripts/scheduling', name), 'utf8');

/**
 * An idle pooled connection that the server or the OS drops emits an 'error' event; without a listener
 * Node treats it as an uncaught exception and the test process dies silently. Log it and carry on: the pool
 * discards the dead client and the next query opens a new one.
 */
function withErrorLog(p: Pool): Pool {
  p.on('error', err => console.error('[pgHarness] idle client error:', (err as { code?: string }).code ?? err.message));
  return p;
}

let pool: Pool | null = null;
export function getPool(): Pool {
  if (!hasDatabase) throw new Error('SCHEDULING_TEST_DATABASE_URL is not set');
  pool ??= withErrorLog(new Pool({ connectionString: TEST_URL, max: 40, idleTimeoutMillis: 120_000, ssl: /sslmode=require|neon\.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined }));
  return pool;
}
/** A separate pool for load tests (SCHEDULING_TEST_POOL_MAX overrides the size). Caller ends it. */
export function makePool(max: number): Pool {
  if (!hasDatabase) throw new Error('SCHEDULING_TEST_DATABASE_URL is not set');
  return withErrorLog(new Pool({ connectionString: TEST_URL, max, idleTimeoutMillis: 120_000, ssl: /sslmode=require|neon.tech/.test(TEST_URL) ? { rejectUnauthorized: false } : undefined }));
}
export async function closePool() {
  await pool?.end();
  pool = null;
}
export const sql = (): SqlExecutor => fromPgLike(getPool());

/** Runs a multi-statement script (simple query protocol). */
export async function runScript(text: string) {
  await getPool().query(text);
}

const TABLES = [
  'scheduling_resource_holds',
  'scheduling_reservations',
  'scheduling_series_pauses',
  'scheduling_series',
  'scheduling_occurrences',
  'scheduling_availability_exceptions',
  'scheduling_availability_rules',
  'scheduling_offering_resources',
  'scheduling_offerings',
  'scheduling_resources',
  'scheduling_schedules',
  'scheduling_settings',
];

/**
 * Applies the shared migration. SCHEDULING_TEST_SKIP_MIGRATE=1 skips it so a mutation run can
 * break one guard and see the suites notice (re-applying would silently repair the mutation).
 */
export async function ensureSchema() {
  if (process.env.SCHEDULING_TEST_SKIP_MIGRATE === '1') return;
  await runScript(sqlFile('010_shared_schema.sql'));
  await runScript(sqlFile('030_resource_concurrency.sql'));
  await runScript(sqlFile('031_reservation_integrity.sql'));
}

export async function resetData() {
  await getPool().query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

// ─── Tenants and clock ───────────────────────────────────────────────────────

export const ALL_PERMISSIONS = ['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance'] as const;

export function staff(organisationId: string, permissions: readonly string[] = ALL_PERMISSIONS): TenantContext {
  return {
    organisationId,
    timezone: 'Australia/Adelaide',
    actor: { kind: 'staff', userId: `user-of-${organisationId}` },
    can: p => permissions.includes(p),
  };
}
export const publicActor = (organisationId: string): TenantContext => ({
  organisationId,
  timezone: 'Australia/Adelaide',
  actor: { kind: 'public' },
  can: () => false,
});
export const customerActor = (organisationId: string, customerId: string): TenantContext => ({
  organisationId,
  timezone: 'Australia/Adelaide',
  actor: { kind: 'customer', customerId },
  can: () => false,
});

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-11-01T00:00:00Z')) {}
  now() {
    return this.current;
  }
  today() {
    return this.current.toISOString().slice(0, 10);
  }
}

// ─── Direct seeding (test seam: bypasses the repositories on purpose) ───────

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

export async function seedSchedule(org: string, id: string, presetKey: PresetKey = 'classes_coaching', over: { publicSlug?: string | null; timezone?: string | null } = {}) {
  const cfg = defaultScheduleConfig({ id, organisationId: org, name: `${presetKey} ${id}`, presetKey });
  await getPool().query(
    `INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9) ON CONFLICT (organisation_id, id) DO NOTHING`,
    [id, org, cfg.name, presetKey, PRESETS[presetKey].version, over.publicSlug ?? null, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy), over.timezone ?? null],
  );
}

export async function seedResource(org: string, id: string, kind: 'court' | 'table' | 'room' | 'practitioner' | 'equipment' | 'space' | 'virtual' = 'court', over: { capacity?: number; active?: boolean } = {}) {
  await getPool().query(
    `INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organisation_id, id) DO NOTHING`,
    [id, org, kind, `${kind} ${id}`, over.capacity ?? 4, over.active ?? true],
  );
}

export async function seedOffering(org: string, id: string, scheduleId: string, over: { capacity?: number | null; durationMinutes?: number | null } = {}) {
  await getPool().query(
    `INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'AUD')
     ON CONFLICT (organisation_id, id) DO UPDATE SET capacity = EXCLUDED.capacity`,
    [id, org, scheduleId, `offering ${id}`, over.capacity === undefined ? 10 : over.capacity, over.durationMinutes ?? 60],
  );
}

export interface OccurrenceSeed {
  id: string;
  org: string;
  offeringId: string;
  capacity: number;
  timezone?: string;
  startsAt?: string;
  endsAt?: string;
  resourceId?: string | null;
  /** 031: an occurrence may only hold a resource its offering is assigned. The seam assigns it first unless a test says otherwise. */
  autoLink?: boolean;
}
export async function seedOccurrence(o: OccurrenceSeed) {
  if (o.resourceId && o.autoLink !== false) {
    await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.org, o.offeringId, o.resourceId]);
  }
  const tz = o.timezone ?? 'Australia/Adelaide';
  const startsAt = o.startsAt ?? '2026-12-07T05:30:00Z';
  const endsAt = o.endsAt ?? '2026-12-07T06:30:00Z';
  // One statement: an occurrence that names a resource must own its hold by the end of the
  // statement (a deferred constraint trigger enforces it), exactly as the repository writes it.
  await getPool().query(
    `WITH occ AS (
       INSERT INTO scheduling_occurrences (id, organisation_id, offering_id, resource_id, local_date, local_start_time, timezone, starts_at, ends_at, capacity)
       VALUES ($1, $2, $3, $4, ($7::timestamptz AT TIME ZONE $6)::date, ($7::timestamptz AT TIME ZONE $6)::time, $6, $7::timestamptz, $8::timestamptz, $5)
       ON CONFLICT (organisation_id, id) DO UPDATE SET capacity = EXCLUDED.capacity
       RETURNING id, organisation_id, resource_id, starts_at, ends_at)
     INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
     SELECT $9, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM occ WHERE resource_id IS NOT NULL`,
    [o.id, o.org, o.offeringId, o.resourceId ?? null, o.capacity, tz, startsAt, endsAt, uid('hold')],
  );
}

/** Convenience: a published or unpublished schedule + offering + occurrence in one call. */
export async function seedClass(org: string, ids: { schedule: string; offering: string; occurrence: string }, capacity: number, over: Partial<OccurrenceSeed> & { publicSlug?: string | null; presetKey?: PresetKey } = {}) {
  await seedSchedule(org, ids.schedule, over.presetKey ?? 'classes_coaching', { publicSlug: over.publicSlug ?? null });
  await seedOffering(org, ids.offering, ids.schedule, { capacity });
  await seedOccurrence({ id: ids.occurrence, org, offeringId: ids.offering, capacity, ...over });
}

export async function count(text: string, params: unknown[] = []): Promise<number> {
  const r = await getPool().query(text, params);
  return Number(Object.values(r.rows[0])[0]);
}
