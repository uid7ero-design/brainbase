import { createHash } from 'node:crypto';
import { isIanaTimezone, isLocalDate, resolveLocalTime } from '@scheduling/core';
import { tennisBookingStatusToReservationStatus, type TennisScheduleRules } from './index';

// Offline migration preflight only. No database, route, provider or mutation imports.
// A valid assessment is NOT permission to import or switch the live writer.
type Row = { id: string; organisation_id: string };
export type MigrationSession = Row & TennisScheduleRules & {
  start_time: string; duration_minutes: number; max_capacity: number;
  price_per_session: string; archived_at: string | null;
};
export type MigrationInstance = Row & {
  session_id: string; date: string; start_time: string;
  duration_minutes: number; max_capacity: number; status: string;
};
export type MigrationBooking = Row & {
  session_id: string | null; session_instance_id: string | null;
  client_name: string; client_email: string | null; status: string;
  paid: boolean; attendance_status: string | null;
  is_recurring: boolean; recurring_group_id: string | null;
};
export type MigrationPause = Row & {
  session_id: string; recurring_group_id: string | null;
  pause_from: string; pause_until: string;
};
export interface TennisMigrationSnapshot {
  organisationId: string;
  timezone: string;
  currency: string;
  sessions: readonly MigrationSession[];
  instances: readonly MigrationInstance[];
  bookings: readonly MigrationBooking[];
  pauses: readonly MigrationPause[];
}
type Source = 'configuration' | 'sessions' | 'instances' | 'bookings' | 'pauses';
export type MigrationProblemCode =
  | 'INVALID_CONFIGURATION' | 'DUPLICATE_ID' | 'FOREIGN_TENANT' | 'INVALID_ID'
  | 'INVALID_RECURRENCE' | 'INVALID_MONEY' | 'INVALID_CAPACITY' | 'INVALID_WINDOW'
  | 'DST_REVIEW_REQUIRED' | 'UNKNOWN_STATUS' | 'MISSING_PARENT' | 'PARENT_MISMATCH'
  | 'DUPLICATE_SLOT' | 'LIVE_BOOKING_ON_CANCELLED_INSTANCE' | 'CAPACITY_EXCEEDED'
  | 'UNKNOWN_ATTENDANCE' | 'MISSING_CUSTOMER_NAME' | 'DUPLICATE_EMAIL'
  | 'MISSING_SERIES' | 'SERIES_IDENTITY_CONFLICT' | 'SERIES_SESSION_CONFLICT'
  | 'INVALID_PAUSE' | 'UNSUPPORTED_CLASS_PAUSE' | 'LIVE_BOOKING_IN_PAUSE';
export interface MigrationProblem { source: Source; id: string; code: MigrationProblemCode }
export interface TennisMigrationAssessment {
  version: 1;
  // Fingerprints only this explicitly projected input, not a complete database snapshot.
  projectionFingerprint: string;
  compatibleProjection: boolean;
  cutoverReady: false;
  counts: { sessions: number; instances: number; bookings: number; pauses: number; series: number };
  problems: MigrationProblem[];
  warnings: MigrationProblem[];
  preservation: { cancelledBookings: number; paidMarkers: number; attendanceMarkers: number; archivedSessions: number };
}

const idValid = (id: string) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
// The live Tennis UI labels `attending` as "Here"; Scheduling stores `attended`.
// Keep the source value in provenance rather than rewriting the historical source.
export function tennisAttendance(value: string | null): 'attended' | 'absent' | null | undefined {
  if (value === null) return null;
  if (value === 'attending') return 'attended';
  if (value === 'absent') return 'absent';
  return undefined;
}
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => order(a, b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Decimal text to integer minor units; never round a historical amount. */
export function tennisPriceCents(price: string): number | null {
  if (typeof price !== 'string' || !/^\d+(\.\d{1,2})?$/.test(price)) return null;
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(2147483647) ? Number(cents) : null; // target PostgreSQL integer
}

/** No identities are matched, records dropped, timestamps invented or writes performed. */
export function assessTennisMigration(snapshot: TennisMigrationSnapshot): TennisMigrationAssessment {
  const problems: MigrationProblem[] = [];
  const warnings: MigrationProblem[] = [];
  const add = (source: Source, id: string, code: MigrationProblemCode) => {
    // Diagnostics must not echo malformed ids which could contain customer input.
    const safeId = idValid(id) ? id : '[invalid]';
    if (!problems.some(p => p.source === source && p.id === safeId && p.code === code)) problems.push({ source, id: safeId, code });
  };
  const validConfig = idValid(snapshot.organisationId) && isIanaTimezone(snapshot.timezone) && /^[A-Z]{3}$/.test(snapshot.currency);
  if (!validConfig) add('configuration', '', 'INVALID_CONFIGURATION');
  function index<T extends Row>(source: Source, rows: readonly T[]) {
    const result = new Map<string, T>();
    for (const row of rows) {
      if (!idValid(row.id)) { add(source, row.id, 'INVALID_ID'); continue; }
      if (row.organisation_id !== snapshot.organisationId) { add(source, row.id, 'FOREIGN_TENANT'); continue; }
      if (result.has(row.id)) add(source, row.id, 'DUPLICATE_ID');
      else result.set(row.id, row);
    }
    return result;
  }
  const sessions = index('sessions', snapshot.sessions);
  const instances = index('instances', snapshot.instances);
  const bookings = index('bookings', snapshot.bookings);
  const pauses = index('pauses', snapshot.pauses);
  function window(source: Source, id: string, date: string, time: string, duration: number) {
    if (!positive(duration) || duration > 1440 || !isLocalDate(date) || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(time)) {
      add(source, id, 'INVALID_WINDOW'); return;
    }
    if (validConfig && resolveLocalTime(date, time.slice(0, 5), snapshot.timezone).kind !== 'ok') add(source, id, 'DST_REVIEW_REQUIRED');
  }
  for (const s of sessions.values()) {
    if (!positive(s.max_capacity)) add('sessions', s.id, 'INVALID_CAPACITY');
    if (tennisPriceCents(s.price_per_session) === null) add('sessions', s.id, 'INVALID_MONEY');
    if (!Number.isInteger(s.day_of_week) || s.day_of_week < 0 || s.day_of_week > 6
      || (s.start_date !== null && !isLocalDate(s.start_date))
      || !['ongoing', 'after_weeks', 'on_date'].includes(s.end_mode)
      || (s.end_mode === 'after_weeks' && (!s.start_date || !positive(s.end_after_weeks ?? 0)))
      || (s.end_mode === 'on_date' && (!s.end_date || !isLocalDate(s.end_date) || (s.start_date !== null && s.end_date < s.start_date)))) {
      add('sessions', s.id, 'INVALID_RECURRENCE');
    }
    // Anchor only validates the time when the legacy template has no start date.
    window('sessions', s.id, s.start_date ?? '2000-01-03', s.start_time, s.duration_minutes);
  }
  const slots = new Map<string, string>();
  for (const i of instances.values()) {
    if (!sessions.has(i.session_id)) add('instances', i.id, 'MISSING_PARENT');
    if (!positive(i.max_capacity)) add('instances', i.id, 'INVALID_CAPACITY');
    if (!['scheduled', 'cancelled'].includes(i.status)) add('instances', i.id, 'UNKNOWN_STATUS');
    window('instances', i.id, i.date, i.start_time, i.duration_minutes);
    const slot = JSON.stringify([i.session_id, i.date]); // legacy unique key, not guessed target time
    const previous = slots.get(slot);
    if (previous) { add('instances', i.id, 'DUPLICATE_SLOT'); add('instances', previous, 'DUPLICATE_SLOT'); }
    else slots.set(slot, i.id);
  }
  const emails = new Map<string, string>();
  const headcounts = new Map<string, number>();
  const series = new Map<string, MigrationBooking[]>();
  for (const b of bookings.values()) {
    const instance = b.session_instance_id ? instances.get(b.session_instance_id) : undefined;
    if (!instance || !b.session_id || !sessions.has(b.session_id)) add('bookings', b.id, 'MISSING_PARENT');
    else if (instance.session_id !== b.session_id) add('bookings', b.id, 'PARENT_MISMATCH');
    if (!tennisBookingStatusToReservationStatus(b.status)) add('bookings', b.id, 'UNKNOWN_STATUS');
    if (typeof b.client_name !== 'string' || !b.client_name.trim()) add('bookings', b.id, 'MISSING_CUSTOMER_NAME');
    if (tennisAttendance(b.attendance_status) === undefined) add('bookings', b.id, 'UNKNOWN_ATTENDANCE');
    if (b.is_recurring && !b.recurring_group_id) add('bookings', b.id, 'MISSING_SERIES');
    if (b.recurring_group_id) {
      if (!idValid(b.recurring_group_id)) add('bookings', b.id, 'INVALID_ID');
      const members = series.get(b.recurring_group_id) ?? [];
      members.push(b); series.set(b.recurring_group_id, members);
    }
    if (b.status !== 'cancelled' && instance) {
      if (instance.status === 'cancelled') add('bookings', b.id, 'LIVE_BOOKING_ON_CANCELLED_INSTANCE');
      headcounts.set(instance.id, (headcounts.get(instance.id) ?? 0) + 1);
      const email = b.client_email?.trim().toLowerCase();
      if (email) {
        const key = JSON.stringify([instance.id, email]);
        const previous = emails.get(key);
        if (previous) { add('bookings', b.id, 'DUPLICATE_EMAIL'); add('bookings', previous, 'DUPLICATE_EMAIL'); }
        else emails.set(key, b.id);
      }
    }
  }
  for (const [id, count] of headcounts) if (count > instances.get(id)!.max_capacity) add('instances', id, 'CAPACITY_EXCEEDED');
  for (const members of series.values()) {
    // A group id is explicit lineage, never email-based identity inference.
    if (new Set(members.map(b => b.session_id)).size > 1) for (const b of members) add('bookings', b.id, 'SERIES_SESSION_CONFLICT');
    if (new Set(members.map(b => JSON.stringify([b.client_name, b.client_email?.trim().toLowerCase() ?? null]))).size > 1) {
      for (const b of members) add('bookings', b.id, 'SERIES_IDENTITY_CONFLICT');
    }
  }
  for (const p of pauses.values()) {
    if (!sessions.has(p.session_id)) add('pauses', p.id, 'MISSING_PARENT');
    if (!isLocalDate(p.pause_from) || !isLocalDate(p.pause_until) || p.pause_until < p.pause_from) add('pauses', p.id, 'INVALID_PAUSE');
    if (!p.recurring_group_id) { add('pauses', p.id, 'UNSUPPORTED_CLASS_PAUSE'); continue; }
    const members = series.get(p.recurring_group_id);
    if (!members) { add('pauses', p.id, 'MISSING_SERIES'); continue; }
    for (const b of members) {
      if (b.session_id !== p.session_id) add('pauses', p.id, 'PARENT_MISMATCH');
      const date = b.session_instance_id ? instances.get(b.session_instance_id)?.date : undefined;
      // Legacy can preserve paid/attended bookings inside a pause. Never cancel them during import.
      if (date && b.status !== 'cancelled' && date >= p.pause_from && date <= p.pause_until) {
        if (b.paid || b.attendance_status !== null) {
          if (!warnings.some(w => w.id === b.id && w.code === 'LIVE_BOOKING_IN_PAUSE')) warnings.push({ source: 'bookings', id: b.id, code: 'LIVE_BOOKING_IN_PAUSE' });
        } else add('bookings', b.id, 'LIVE_BOOKING_IN_PAUSE');
      }
    }
  }
  problems.sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
  warnings.sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
  return {
    version: 1,
    projectionFingerprint: createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex'),
    compatibleProjection: problems.length === 0,
    cutoverReady: false,
    counts: { sessions: snapshot.sessions.length, instances: snapshot.instances.length, bookings: snapshot.bookings.length, pauses: snapshot.pauses.length, series: series.size },
    problems,
    warnings,
    preservation: {
      cancelledBookings: snapshot.bookings.filter(b => b.status === 'cancelled').length,
      paidMarkers: snapshot.bookings.filter(b => b.paid).length,
      attendanceMarkers: snapshot.bookings.filter(b => b.attendance_status !== null).length,
      archivedSessions: snapshot.sessions.filter(s => s.archived_at !== null).length,
    },
  };
}
