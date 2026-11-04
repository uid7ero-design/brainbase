import { describe, expect, it } from 'vitest';
import { assessTennisMigration, tennisAttendance, tennisPriceCents, type TennisMigrationSnapshot } from '@/lib/scheduling/compatibility/tennis/migrationAssessment';

function fixture(): TennisMigrationSnapshot {
  return {
    organisationId: 'synthetic-tennis', timezone: 'Australia/Adelaide', currency: 'AUD',
    sessions: [{ id: 'session', organisation_id: 'synthetic-tennis', day_of_week: 2,
      start_date: '2026-11-03', end_mode: 'ongoing', end_after_weeks: null, end_date: null,
      start_time: '16:00:00', duration_minutes: 60, max_capacity: 2, price_per_session: '12.50', archived_at: null }],
    instances: [{ id: 'instance', organisation_id: 'synthetic-tennis', session_id: 'session', date: '2026-11-03',
      start_time: '16:00:00', duration_minutes: 60, max_capacity: 2, status: 'scheduled' }],
    bookings: [{ id: 'booking', organisation_id: 'synthetic-tennis', session_id: 'session', session_instance_id: 'instance',
      client_name: 'Synthetic player', client_email: 'synthetic@example.invalid', status: 'confirmed',
      paid: false, attendance_status: null, is_recurring: true, recurring_group_id: 'group' }],
    pauses: [],
  };
}
const codes = (s: TennisMigrationSnapshot) => assessTennisMigration(s).problems.map(p => p.code);

describe('Tennis migration projection preflight', () => {
  it('is deterministic, side-effect free and never grants cutover readiness', () => {
    const s = fixture(); const before = structuredClone(s);
    const report = assessTennisMigration(s);
    expect(report.compatibleProjection).toBe(true);
    expect(report.cutoverReady).toBe(false);
    expect(report.counts).toEqual({ sessions: 1, instances: 1, bookings: 1, series: 1, pauses: 0 });
    expect(report).toEqual(assessTennisMigration(s)); expect(s).toEqual(before);
  });
  it('does not leak customer snapshots in the report', () => {
    const s = fixture();
    s.bookings = [...s.bookings, { ...s.bookings[0], id: 'other', client_name: 'Another private player' }];
    const report = JSON.stringify(assessTennisMigration(s));
    expect(report).not.toContain('Synthetic player'); expect(report).not.toContain('Another private player');
    expect(report).not.toContain('example.invalid');
  });
  it('fingerprints all supplied projected fields but ignores row ordering', () => {
    const s = fixture(); s.bookings = [...s.bookings, { ...s.bookings[0], id: 'other', client_email: null }];
    const hash = assessTennisMigration(s).projectionFingerprint;
    expect(assessTennisMigration({ ...s, bookings: [...s.bookings].reverse() }).projectionFingerprint).toBe(hash);
    s.bookings[0].paid = true;
    expect(assessTennisMigration(s).projectionFingerprint).not.toBe(hash);
  });
  it.each(['Not/AZone', ''])('refuses an invalid timezone %s', timezone => {
    expect(codes({ ...fixture(), timezone })).toContain('INVALID_CONFIGURATION');
  });
  it('rejects foreign source rows before using them as parents', () => {
    const s = fixture(); s.sessions[0].organisation_id = 'foreign';
    expect(codes(s)).toContain('FOREIGN_TENANT'); expect(codes(s)).toContain('MISSING_PARENT');
  });
  it('rejects duplicate ids and does not silently overwrite a source', () => {
    const s = fixture(); s.instances = [...s.instances, { ...s.instances[0], max_capacity: 1 }];
    expect(codes(s)).toContain('DUPLICATE_ID');
  });
  it('redacts malformed source ids from diagnostics', () => {
    const s = fixture(); s.bookings[0].id = 'personal@example.invalid';
    expect(assessTennisMigration(s).problems).toContainEqual({ source: 'bookings', id: '[invalid]', code: 'INVALID_ID' });
    expect(JSON.stringify(assessTennisMigration(s))).not.toContain('personal@');
  });
  it.each(['reschedule_requested', 'unexpected'])('does not reinterpret legacy status %s', status => {
    const s = fixture(); s.bookings[0].status = status;
    expect(codes(s)).toContain('UNKNOWN_STATUS');
  });
  it('requires an explicit dated occurrence instead of inferring one from email/date', () => {
    const s = fixture(); s.bookings[0].session_instance_id = null;
    expect(codes(s)).toContain('MISSING_PARENT');
  });
  it('rejects a booking whose session and occurrence disagree', () => {
    const s = fixture(); s.sessions = [...s.sessions, { ...s.sessions[0], id: 'other-session' }];
    s.bookings[0].session_id = 'other-session'; expect(codes(s)).toContain('PARENT_MISMATCH');
  });
  it('counts pending as occupying capacity and excludes only cancelled bookings', () => {
    const s = fixture(); s.instances[0].max_capacity = 1;
    s.bookings = [...s.bookings, { ...s.bookings[0], id: 'pending', client_email: null, status: 'pending_confirmation' }];
    expect(codes(s)).toContain('CAPACITY_EXCEEDED');
    s.bookings[1].status = 'cancelled'; expect(codes(s)).not.toContain('CAPACITY_EXCEEDED');
  });
  it('flags both conflicting normalised emails without merging players', () => {
    const s = fixture(); s.bookings = [...s.bookings, { ...s.bookings[0], id: 'sibling', client_name: 'Sibling', client_email: ' SYNTHETIC@EXAMPLE.INVALID ' }];
    expect(assessTennisMigration(s).problems.filter(p => p.code === 'DUPLICATE_EMAIL').map(p => p.id).sort()).toEqual(['booking', 'sibling']);
  });
  it('refuses live enrolments on cancelled occurrences', () => {
    const s = fixture(); s.instances[0].status = 'cancelled';
    expect(codes(s)).toContain('LIVE_BOOKING_ON_CANCELLED_INSTANCE');
  });
  it('retains accounting and attendance markers as preservation counts, not financial transactions', () => {
    const s = fixture(); Object.assign(s.bookings[0], { status: 'cancelled', paid: true, attendance_status: 'attending' });
    s.sessions[0].archived_at = '2026-11-03T00:00:00Z';
    expect(assessTennisMigration(s).preservation).toEqual({ cancelledBookings: 1, paidMarkers: 1, attendanceMarkers: 1, archivedSessions: 1 });
  });
  it('refuses unknown attendance instead of silently mapping to absent', () => {
    const s = fixture(); s.bookings[0].attendance_status = 'unexpected'; expect(codes(s)).toContain('UNKNOWN_ATTENDANCE');
  });
  it('maps the actual Tennis Here marker explicitly without modifying it', () => {
    const s = fixture(); s.bookings[0].attendance_status = 'attending';
    expect(tennisAttendance(s.bookings[0].attendance_status)).toBe('attended');
    expect(codes(s)).not.toContain('UNKNOWN_ATTENDANCE');
    expect(s.bookings[0].attendance_status).toBe('attending');
    expect(tennisAttendance('late')).toBeUndefined();
  });
  it('requires explicit recurrence lineage', () => {
    const s = fixture(); s.bookings[0].recurring_group_id = null; expect(codes(s)).toContain('MISSING_SERIES');
  });
  it('detects inconsistent identities inside a recurrence group', () => {
    const s = fixture(); s.bookings = [...s.bookings, { ...s.bookings[0], id: 'other', client_name: 'Other', client_email: null }];
    expect(codes(s)).toContain('SERIES_IDENTITY_CONFLICT');
  });
  it('does not silently normalise malformed recurrence to ongoing', () => {
    const s = fixture(); s.sessions[0].end_mode = 'after_weeks'; s.sessions[0].end_after_weeks = 0;
    expect(codes(s)).toContain('INVALID_RECURRENCE');
  });
  it.each(['2026-10-04', '2026-04-05'])('requires review of Adelaide DST at %s 02:30', date => {
    const s = fixture(); Object.assign(s.instances[0], { date, start_time: '02:30:00' });
    expect(codes(s)).toContain('DST_REVIEW_REQUIRED');
  });
  it.each(['16:00:01', '25:00', '16:60'])('does not truncate or repair invalid time %s', start_time => {
    const s = fixture(); s.instances[0].start_time = start_time; expect(codes(s)).toContain('INVALID_WINDOW');
  });
  it('detects duplicate legacy slots even when times differ', () => {
    const s = fixture(); s.instances = [...s.instances, { ...s.instances[0], id: 'other', start_time: '17:00' }];
    expect(codes(s)).toContain('DUPLICATE_SLOT');
  });
  it('preserves protected live bookings inside a pause with an explicit warning, but refuses unprotected conflicts', () => {
    const s = fixture(); s.bookings[0].paid = true;
    s.pauses = [{ id: 'pause', organisation_id: s.organisationId, session_id: 'session', recurring_group_id: 'group', pause_from: '2026-11-03', pause_until: '2026-11-10' }];
    expect(assessTennisMigration(s).warnings).toContainEqual({ source: 'bookings', id: 'booking', code: 'LIVE_BOOKING_IN_PAUSE' });
    expect(assessTennisMigration(s).compatibleProjection).toBe(true); expect(s.bookings[0].status).toBe('confirmed');
    s.bookings[0].paid = false; expect(codes(s)).toContain('LIVE_BOOKING_IN_PAUSE');
    s.bookings[0].status = 'cancelled'; expect(codes(s)).not.toContain('LIVE_BOOKING_IN_PAUSE');
  });
  it('refuses unsupported class pauses and invalid date ranges', () => {
    const s = fixture(); s.pauses = [{ id: 'pause', organisation_id: s.organisationId, session_id: 'session', recurring_group_id: null, pause_from: '2026-11-10', pause_until: '2026-11-03' }];
    expect(codes(s)).toContain('UNSUPPORTED_CLASS_PAUSE'); expect(codes(s)).toContain('INVALID_PAUSE');
  });
  it.each([['0', 0], ['0.1', 10], ['12.50', 1250], ['21474836.47', 2147483647], ['21474836.48', null], ['1.005', null], ['-1', null], ['NaN', null], ['1e3', null]])('converts decimal price %s exactly', (price, cents) => {
    expect(tennisPriceCents(price as string)).toBe(cents);
  });
});
