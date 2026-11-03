import { randomUUID } from 'node:crypto';
import type { TenantContext } from '@scheduling/core';
import type { MigrationReadExecutor } from './migrationSnapshot';

export interface CoachingBookingInput {
  occurrenceId: string;
  idempotencyKey: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}
export interface CoachingBooking {
  id: string; occurrence_id: string; customer_name: string;
  customer_email: string | null; customer_phone: string | null; notes: string | null;
  status: string; attendance: string | null; payment_status: string; coaching_attendance_version: number;
}
export type BookingResult =
  | { ok: true; booking: CoachingBooking; replayed: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'FULL' | 'DUPLICATE' | 'KEY_CONFLICT' | 'CLOSED' | 'PROTECTED_HISTORY' };

const columns = 'id,occurrence_id,customer_name,customer_email,customer_phone,notes,status,attendance,payment_status,coaching_attendance_version';
function staff(tenant: TenantContext, permission: 'scheduling.reserve' | 'scheduling.attendance') {
  if (!tenant.organisationId || tenant.actor.kind !== 'staff' || !tenant.can(permission)) throw new Error('Coaching permission denied');
}
export function validateCoachingBookingInput(value: CoachingBookingInput): CoachingBookingInput {
  if (!value || typeof value.occurrenceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.occurrenceId)
    || typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value.idempotencyKey)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
    || (value.email !== null && (typeof value.email !== 'string' || value.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())))
    || (value.phone !== null && (typeof value.phone !== 'string' || value.phone.length > 80))
    || (value.notes !== null && (typeof value.notes !== 'string' || value.notes.length > 4000))) throw new Error('Invalid coaching booking');
  return { ...value, name: value.name.trim(), email: value.email?.trim() ?? null };
}
function sameRequest(row: CoachingBooking, body: CoachingBookingInput) {
  return row.occurrence_id === body.occurrenceId && row.customer_name === body.name
    && row.customer_email === body.email && row.customer_phone === body.phone && row.notes === body.notes;
}

/** Canonical Scheduling writes only; not wired to live routes until cutover acceptance. */
export class CoachingBookings {
  constructor(private readonly sql: MigrationReadExecutor) {}

  async recover(tenant: TenantContext, key: string): Promise<CoachingBooking | null> {
    staff(tenant, 'scheduling.reserve');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw new Error('Invalid coaching booking key');
    const rows = await this.sql.query<CoachingBooking>(`SELECT ${columns} FROM scheduling_reservations
      WHERE organisation_id=$1 AND idempotency_key=$2 AND preset_key='classes_coaching'`, [tenant.organisationId, key]);
    return rows[0] ?? null;
  }

  async enrol(tenant: TenantContext, supplied: CoachingBookingInput): Promise<BookingResult> {
    staff(tenant, 'scheduling.reserve');
    const body = validateCoachingBookingInput(supplied);
    const replay = await this.recover(tenant, body.idempotencyKey);
    if (replay) return sameRequest(replay, body) ? { ok: true, booking: replay, replayed: true } : { ok: false, code: 'KEY_CONFLICT' };
    try {
      // Snapshot the occurrence and current price in the same statement as insertion.
      // Locks prevent an offering edit/archive from changing the confirmed snapshot.
      // Shared Scheduling triggers remain the authority on capacity and lifecycle.
      const rows = await this.sql.query<CoachingBooking>(`WITH basis AS MATERIALIZED (
        SELECT o.*,f.schedule_id,f.price_cents,f.currency,s.preset_version
        FROM scheduling_occurrences o
        JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
        JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
        WHERE o.organisation_id=$1 AND o.id=$2 AND o.status='scheduled' AND o.starts_at>now()
          AND f.archived_at IS NULL AND s.archived_at IS NULL AND s.preset_key='classes_coaching'
        FOR SHARE OF s,f,o
      ) INSERT INTO scheduling_reservations(
        id,organisation_id,schedule_id,preset_key,preset_version,offering_id,span_kind,occurrence_id,
        customer_name,customer_email,customer_email_normalised,customer_phone,timezone,
        local_start_date,local_start_time,local_end_date,local_end_time,starts_at,ends_at,
        party_size,status,price_cents,currency,notes,idempotency_key,created_by)
      SELECT $3,organisation_id,schedule_id,'classes_coaching',preset_version,offering_id,'occurrence',id,
        $4,$5,CASE WHEN $5::text IS NULL THEN NULL ELSE lower(btrim($5)) END,$6,timezone,
        local_date,local_start_time,(ends_at AT TIME ZONE timezone)::date,(ends_at AT TIME ZONE timezone)::time,starts_at,ends_at,
        1,'confirmed',price_cents,currency,$7,$8,$9 FROM basis
      ON CONFLICT (organisation_id,idempotency_key) DO NOTHING RETURNING ${columns}`,
      [tenant.organisationId, body.occurrenceId, randomUUID(), body.name, body.email, body.phone, body.notes, body.idempotencyKey, tenant.actor.kind === 'staff' ? tenant.actor.userId : null]);
      if (rows[0]) return { ok: true, booking: rows[0], replayed: false };
    } catch (error) {
      // A concurrent identical request can hit capacity or duplicate checks before
      // ON CONFLICT. Resolve committed evidence first, never repeat the insert.
      const saved = await this.recover(tenant, body.idempotencyKey);
      if (saved) return sameRequest(saved, body) ? { ok: true, booking: saved, replayed: true } : { ok: false, code: 'KEY_CONFLICT' };
      const code = (error as { code?: string }).code;
      if (code === 'SCCAP') return { ok: false, code: 'FULL' };
      if (code === '23505') return { ok: false, code: 'DUPLICATE' };
      if (['SCCLS', 'SCARC'].includes(code ?? '')) return { ok: false, code: 'CLOSED' };
      throw error; // Network/timeout is unknown, never translated to "not saved".
    }
    const saved = await this.recover(tenant, body.idempotencyKey);
    return saved ? sameRequest(saved, body) ? { ok: true, booking: saved, replayed: true } : { ok: false, code: 'KEY_CONFLICT' } : { ok: false, code: 'NOT_FOUND' };
  }

  async cancel(tenant: TenantContext, id: string): Promise<BookingResult> {
    staff(tenant, 'scheduling.reserve');
    const rows = await this.sql.query<{ result: BookingResult }>('SELECT scheduling_coaching_cancel_booking($1,$2) AS result', [tenant.organisationId, id]);
    if (rows.length !== 1) throw Error('Coaching cancellation outcome unavailable');
    return rows[0].result;
  }

  async attendance(tenant: TenantContext, id: string, value: 'attended' | 'absent' | null, expectedVersion: number, key: string): Promise<CoachingBooking | null> {
    staff(tenant, 'scheduling.attendance');
    if ((value !== null && !['attended', 'absent'].includes(value)) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
      || !/^[A-Za-z0-9_-]{16,80}$/.test(key) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid coaching attendance');
    const request = { kind: 'attendance', bookingId: id, value, expectedVersion };
    try {
      const rows = await this.sql.query<{ result: { booking: CoachingBooking | null } }>(
        'SELECT scheduling_coaching_set_attendance($1,$2,$3,$4,$5,$6) AS result',
        [tenant.organisationId, id, value, expectedVersion, key, tenant.actor.kind === 'staff' ? tenant.actor.userId : null]);
      if (rows.length !== 1) throw Error('Coaching attendance outcome unavailable');
      return rows[0].result.booking;
    } catch (error) {
      const saved = await this.sql.query<{ result: { booking: CoachingBooking } }>(`SELECT result FROM scheduling_coaching_commands
        WHERE organisation_id=$1 AND command_key=$2 AND request=$3::jsonb`, [tenant.organisationId, key, JSON.stringify(request)]);
      if (saved.length === 1) return saved[0].result.booking;
      throw error;
    }
  }
}
