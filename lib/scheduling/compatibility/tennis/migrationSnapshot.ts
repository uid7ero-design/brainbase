import type { TennisMigrationSnapshot } from './migrationAssessment';

export interface MigrationReadExecutor {
  query<T>(text: string, parameters: readonly unknown[]): Promise<T[]>;
}

// One statement gives all four projections the same MVCC snapshot. Every source
// has its own tenant predicate, including rows with broken parent references.
// No live DB client is imported here. The caller must supply an authorised executor.
export const TENNIS_MIGRATION_PROJECTION_SQL = `
SELECT o.id AS "organisationId", o.timezone, ss.currency,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',s.id,'organisation_id',s.organisation_id,'day_of_week',s.day_of_week,
    'start_date',to_char(s.start_date,'YYYY-MM-DD'),'end_mode',s.end_mode,
    'end_after_weeks',s.end_after_weeks,'end_date',to_char(s.end_date,'YYYY-MM-DD'),
    'start_time',s.start_time::text,'duration_minutes',s.duration_minutes,
    'max_capacity',s.max_capacity,'price_per_session',s.price_per_session::text,
    'archived_at',s.archived_at::text)) FROM sessions s WHERE s.organisation_id=$1), '[]'::jsonb) AS sessions,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'organisation_id',i.organisation_id,'session_id',i.session_id,
    'date',to_char(i.date,'YYYY-MM-DD'),'start_time',i.start_time::text,
    'duration_minutes',i.duration_minutes,'max_capacity',i.max_capacity,'status',i.status))
    FROM session_instances i WHERE i.organisation_id=$1), '[]'::jsonb) AS instances,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',b.id,'organisation_id',b.organisation_id,'session_id',b.session_id,
    'session_instance_id',b.session_instance_id,'client_name',b.client_name,
    'client_email',b.client_email,'status',b.status,'paid',b.paid,
    'attendance_status',b.attendance_status,'is_recurring',b.is_recurring,
    'recurring_group_id',b.recurring_group_id)) FROM bookings b WHERE b.organisation_id=$1), '[]'::jsonb) AS bookings,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',p.id,'organisation_id',p.organisation_id,'session_id',p.session_id,
    'recurring_group_id',p.recurring_group_id,'pause_from',to_char(p.pause_from,'YYYY-MM-DD'),
    'pause_until',to_char(p.pause_until,'YYYY-MM-DD'))) FROM booking_recurrence_pauses p WHERE p.organisation_id=$1), '[]'::jsonb) AS pauses
FROM organisations o JOIN scheduling_settings ss ON ss.organisation_id=o.id
WHERE o.id=$1 AND o.slug='ld-tennis' AND o.status='ACTIVE'`;

type Validator = (value: unknown) => boolean;
const string: Validator = v => typeof v === 'string';
const nullableString: Validator = v => v === null || string(v);
const number: Validator = v => typeof v === 'number' && Number.isFinite(v);
const nullableNumber: Validator = v => v === null || number(v);
const boolean: Validator = v => typeof v === 'boolean';
const row = { id: string, organisation_id: string };
const shape = (value: unknown, schema: Record<string, Validator>): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === Object.keys(schema).length && Object.entries(schema).every(([key, validate]) => Object.hasOwn(record, key) && validate(record[key]));
};
const rows = (schema: Record<string, Validator>): Validator => value => Array.isArray(value) && value.every(v => shape(v, schema));

/** Fails on malformed/missing projected fields, never fabricates an empty ledger. */
export function decodeTennisMigrationSnapshot(value: unknown): TennisMigrationSnapshot {
  if (!shape(value, {
    organisationId: string, timezone: string, currency: string,
    sessions: rows({ ...row, day_of_week: number, start_date: nullableString, end_mode: string,
      end_after_weeks: nullableNumber, end_date: nullableString, start_time: string, duration_minutes: number,
      max_capacity: number, price_per_session: string, archived_at: nullableString }),
    instances: rows({ ...row, session_id: string, date: string, start_time: string, duration_minutes: number, max_capacity: number, status: string }),
    bookings: rows({ ...row, session_id: nullableString, session_instance_id: nullableString, client_name: string,
      client_email: nullableString, status: string, paid: boolean, attendance_status: nullableString,
      is_recurring: boolean, recurring_group_id: nullableString }),
    pauses: rows({ ...row, session_id: string, recurring_group_id: nullableString, pause_from: string, pause_until: string }),
  })) throw new Error('Tennis migration source projection is invalid');
  return structuredClone(value) as TennisMigrationSnapshot;
}

export async function readTennisMigrationSnapshot(sql: MigrationReadExecutor, organisationId: string): Promise<TennisMigrationSnapshot> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(organisationId)) throw new Error('Tennis migration organisation is invalid');
  const result = await sql.query<unknown>(TENNIS_MIGRATION_PROJECTION_SQL, [organisationId]);
  if (result.length !== 1) throw new Error('Tennis migration organisation or settings unavailable');
  const snapshot = decodeTennisMigrationSnapshot(result[0]);
  if (snapshot.organisationId !== organisationId) throw new Error('Tennis migration organisation mismatch');
  return snapshot;
}
