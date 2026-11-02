import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BOOKING_READ_LIMITS,
  IDENTITY_KEYS,
  buildBookingOverlay,
  decodeBookingCursor,
  encodeBookingCursor,
  findIdentityKeyLeaks,
  findIdentityLeaks,
  overlapsRange,
  resolvePageSize,
  toPage,
  toViewerReservation,
  validateBookingRange,
  type OccurrenceWithHeadcount,
  type OverlayHoldInput,
  type ViewerReservation,
} from '../src';
import { reservation } from './support/fixtures';

// Phase 2C.2 core: the bounds, the cursor, the viewer reduction, the identity guard and the overlay arrangement. All pure.

const RANGE = { fromInstant: '2026-11-02T00:00:00Z', toInstant: '2026-11-09T00:00:00Z' };

describe('validateBookingRange', () => {
  it('accepts a normal range and refuses malformed, inverted, empty and over-long ones', () => {
    expect(validateBookingRange(RANGE)).toEqual([]);
    expect(validateBookingRange({ fromInstant: 'x', toInstant: RANGE.toInstant })).toHaveLength(1);
    expect(validateBookingRange({ fromInstant: '2026-11-02', toInstant: RANGE.toInstant })).not.toEqual([]);
    expect(validateBookingRange({ fromInstant: '2026-11-02T00:00:00+10:30', toInstant: RANGE.toInstant })).not.toEqual([]); // offsets are not instants here
    expect(validateBookingRange({ fromInstant: RANGE.toInstant, toInstant: RANGE.fromInstant })).toEqual(['toInstant must be after fromInstant']);
    expect(validateBookingRange({ fromInstant: RANGE.fromInstant, toInstant: RANGE.fromInstant })).toEqual(['toInstant must be after fromInstant']);
    expect(validateBookingRange({ fromInstant: '2026-11-01T00:00:00Z', toInstant: '2026-12-02T00:00:00Z' })).toEqual([]); // 31 days
    expect(validateBookingRange({ fromInstant: '2026-11-01T00:00:00Z', toInstant: '2026-12-03T00:00:00Z' })).toEqual(['the range must be at most 31 days']);
  });
  it('bounds the number of resources', () => {
    const ok = Array.from({ length: BOOKING_READ_LIMITS.maxResources }, (_, i) => `r${i}`);
    expect(validateBookingRange(RANGE, ok)).toEqual([]);
    expect(validateBookingRange(RANGE, [...ok, 'one-more'])).toEqual(['at most 100 resources can be asked for at once']);
    expect(validateBookingRange(RANGE, [''])).not.toEqual([]);
    expect(validateBookingRange(RANGE, ['x'.repeat(129)])).not.toEqual([]);
  });
});

describe('page size and cursor', () => {
  it('defaults, accepts 1..500 and refuses the rest instead of clamping', () => {
    expect(resolvePageSize(undefined)).toEqual({ ok: true, size: 200 });
    expect(resolvePageSize(null)).toEqual({ ok: true, size: 200 });
    expect(resolvePageSize(500)).toEqual({ ok: true, size: 500 });
    for (const bad of [0, -1, 501, 1.5, Number.NaN]) expect(resolvePageSize(bad).ok).toBe(false);
  });
  it('round-trips a cursor and refuses anything that is not exactly one', () => {
    const c = { startsAt: '2026-11-02T07:30:00.123456Z', id: 'res_1:a-b.c' };
    expect(decodeBookingCursor(encodeBookingCursor(c))).toEqual(c);
    for (const bad of [null, undefined, '', 'nope', '~id', '2026-11-02T07:30:00Z~', '2026-11-02T07:30:00Z~a b', '2026-13-02T07:30:00Z~x', "2026-11-02T07:30:00Z~x'; DROP TABLE y", 'a'.repeat(300)]) {
      expect(decodeBookingCursor(bad as string)).toBeNull();
    }
  });
  it('toPage returns at most `size` rows and a cursor only when more exist', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, at: `2026-11-02T0${i}:00:00Z` }));
    const cursorOf = (r: { id: string; at: string }) => ({ startsAt: r.at, id: r.id });
    expect(toPage(rows.slice(0, 3), 3, cursorOf)).toEqual({ items: rows.slice(0, 3), nextCursor: null });
    const page = toPage(rows.slice(0, 4), 3, cursorOf);
    expect(page.items).toHaveLength(3);
    expect(decodeBookingCursor(page.nextCursor)).toEqual({ startsAt: rows[2].at, id: 'r2' });
  });
});

describe('overlapsRange (half-open)', () => {
  it('a window ending exactly at the start, or starting exactly at the end, is outside', () => {
    expect(overlapsRange({ startsAt: '2026-11-01T23:00:00Z', endsAt: RANGE.fromInstant }, RANGE)).toBe(false);
    expect(overlapsRange({ startsAt: RANGE.toInstant, endsAt: '2026-11-09T01:00:00Z' }, RANGE)).toBe(false);
    expect(overlapsRange({ startsAt: '2026-11-01T23:59:59Z', endsAt: '2026-11-02T00:00:01Z' }, RANGE)).toBe(true);
    expect(overlapsRange({ startsAt: '2026-11-03T00:00:00.5Z', endsAt: '2026-11-03T01:00:00Z' }, RANGE)).toBe(true);
  });
});

describe('the viewer reduction', () => {
  const full = reservation('resource_hire', 'sch-1', {
    customerId: 'cust-9',
    customerSnapshot: { displayName: 'Sam Taylor', email: 'sam@example.com', emailNormalised: 'sam@example.com', phone: '0400 000 000' },
    notes: 'allergic to cats, gate code 1234',
    seriesId: 'series-1',
    attendance: 'attended',
    paymentStatus: 'paid',
    participants: [{ customerId: 'cust-9', displayName: 'Sam Taylor', role: 'primary' }],
  });

  it('keeps exactly the whitelisted fields and nothing else', () => {
    const v = toViewerReservation(full);
    expect(Object.keys(v).sort()).toEqual(['endsAt', 'id', 'kind', 'occurrenceId', 'offeringId', 'resourceId', 'startsAt', 'state', 'timezone']);
    expect(v).toMatchObject({ kind: 'booking', state: 'booked', occurrenceId: null, resourceId: 'court-1' });
  });
  it('contains no customer, note, payment, attendance, series or party information anywhere in its JSON', () => {
    const json = JSON.stringify(toViewerReservation(full));
    for (const secret of ['Sam', 'Taylor', 'sam@example.com', '0400', 'gate code', 'cust-9', 'series-1', 'attended', 'paid', 'unpaid']) expect(json).not.toContain(secret);
    expect(findIdentityLeaks(toViewerReservation(full))).toEqual([]);
  });
  it('is "booked" for every live status and "cancelled" only when cancelled; an enrolment is told apart', () => {
    for (const status of ['pending', 'confirmed', 'completed', 'no_show'] as const) expect(toViewerReservation({ ...full, status }).state).toBe('booked');
    expect(toViewerReservation({ ...full, status: 'cancelled' }).state).toBe('cancelled');
    const enrol = toViewerReservation(reservation('classes_coaching', 'sch-2'));
    expect(enrol).toMatchObject({ kind: 'enrolment', occurrenceId: 'occ-1', resourceId: null });
  });
});

describe('findIdentityLeaks', () => {
  it('finds forbidden keys at any depth, in arrays, and email-like text', () => {
    expect(findIdentityLeaks({ a: { b: [{ customerName: 'x' }] } })).toEqual(['$.a.b[0].customerName']);
    expect(findIdentityLeaks({ title: 'Booked by sam@example.com' })).toEqual(['$.title (email-like text)']);
    expect(findIdentityLeaks({ ok: 1, nested: { fine: ['a', 'b'] } })).toEqual([]);
  });
  it('treats every identity key as a leak and a too-deep value as a leak (fail closed)', () => {
    for (const key of IDENTITY_KEYS) expect(findIdentityLeaks({ [key]: 1 })).toEqual([`$.${key}`]);
    let deep: unknown = 'x';
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(findIdentityLeaks(deep).length).toBeGreaterThan(0);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(findIdentityLeaks(cyclic).length).toBeGreaterThan(0);
  });
});

describe('findIdentityKeyLeaks (the route guard: structure only)', () => {
  it('flags a forbidden key but not free text that looks like an email, so a staff-typed offering name cannot take a calendar down', () => {
    expect(findIdentityKeyLeaks({ offeringName: 'Book via info@club.example' })).toEqual([]);
    expect(findIdentityLeaks({ offeringName: 'Book via info@club.example' })).toEqual(['$.offeringName (email-like text)']);
    expect(findIdentityKeyLeaks({ lanes: [{ items: [{ customerName: 'x' }] }] })).toEqual(['$.lanes[0].items[0].customerName']);
  });
  it('still fails closed on a cycle or an absurd depth', () => {
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(findIdentityKeyLeaks(c).length).toBeGreaterThan(0);
  });
});

// ─── the overlay ────────────────────────────────────────────────────────────

const occ = (over: Partial<OccurrenceWithHeadcount> & { id: string }): OccurrenceWithHeadcount => ({
  organisationId: 'org-1',
  offeringId: 'off-class',
  offeringName: 'Junior squad',
  resourceId: 'court-1',
  date: '2026-11-02',
  startTime: '18:00',
  timezone: 'Australia/Adelaide',
  startsAt: '2026-11-02T07:30:00Z',
  endsAt: '2026-11-02T08:30:00Z',
  durationMinutes: 60,
  capacity: 10,
  status: 'scheduled',
  liveHeadcount: 4,
  ...over,
});
const booking = (over: Partial<ViewerReservation & { offeringName: string }> & { id: string }): ViewerReservation & { offeringName: string } => ({
  offeringId: 'off-hire',
  offeringName: 'Court hire',
  kind: 'booking',
  occurrenceId: null,
  resourceId: 'court-2',
  startsAt: '2026-11-02T23:00:00Z',
  endsAt: '2026-11-03T00:00:00Z',
  timezone: 'Australia/Adelaide',
  state: 'booked',
  ...over,
});
const hold = (over: Partial<OverlayHoldInput> & { id: string }): OverlayHoldInput => ({ resourceId: 'court-1', startsAt: '2026-11-02T07:30:00Z', endsAt: '2026-11-02T08:30:00Z', reservationId: null, occurrenceId: null, ...over });

describe('buildBookingOverlay', () => {
  it('draws a session with a court in that court’s lane, backed by its hold, and a booking in its own lane', () => {
    const o = buildBookingOverlay({
      range: RANGE,
      occurrences: [occ({ id: 'occ-1' })],
      slotBookings: [booking({ id: 'res-1' })],
      holds: [hold({ id: 'h1', occurrenceId: 'occ-1' }), hold({ id: 'h2', resourceId: 'court-2', reservationId: 'res-1', startsAt: '2026-11-02T23:00:00Z', endsAt: '2026-11-03T00:00:00Z' })],
    });
    expect(o.lanes.map(l => l.resourceId)).toEqual(['court-1', 'court-2']);
    expect(o.lanes[0].items).toEqual([expect.objectContaining({ kind: 'occurrence', id: 'occ-1', holdId: 'h1', placement: 'resource', remaining: 6 })]);
    expect(o.lanes[1].items).toEqual([expect.objectContaining({ kind: 'booking', id: 'res-1', holdId: 'h2', state: 'booked' })]);
    expect(o.counts).toEqual({ occurrences: 1, slotBookings: 1, holds: 0, cancelled: 0, unassignedSpace: 0 }); // the holds are explained by their owners, not drawn twice
    expect(o.unassignedSpace).toEqual([]);
  });

  it('puts a session with no resource in the unassigned-space row and never in a lane', () => {
    const o = buildBookingOverlay({ range: RANGE, occurrences: [occ({ id: 'occ-free', resourceId: null, liveHeadcount: 10 })], slotBookings: [], holds: [] });
    expect(o.lanes).toEqual([]);
    expect(o.unassignedSpace).toEqual([expect.objectContaining({ id: 'occ-free', placement: 'unassigned_space', resourceId: null, holdId: null, remaining: 0 })]);
    expect(o.counts.unassignedSpace).toBe(1);
  });

  it('keeps a cancelled session and booking in place, flagged, with no hold; a released hold is not input', () => {
    const o = buildBookingOverlay({
      range: RANGE,
      occurrences: [occ({ id: 'occ-x', status: 'cancelled' })],
      slotBookings: [booking({ id: 'res-x', state: 'cancelled' })],
      holds: [],
    });
    expect(o.lanes[0].items[0]).toMatchObject({ kind: 'occurrence', status: 'cancelled', holdId: null });
    expect(o.lanes[1].items[0]).toMatchObject({ kind: 'booking', state: 'cancelled', holdId: null });
    expect(o.counts.cancelled).toBe(2);
  });

  it('even if a (buggy) caller passes a live hold for a cancelled owner, the cancelled owner is not backed by it and the hold shows as occupied time', () => {
    const o = buildBookingOverlay({ range: RANGE, occurrences: [occ({ id: 'occ-x', status: 'cancelled' })], slotBookings: [], holds: [hold({ id: 'h-orphan', occurrenceId: 'occ-x' })] });
    expect(o.lanes[0].items.map(i => [i.kind, i.id])).toEqual([['occurrence', 'occ-x'], ['hold', 'h-orphan']]);
  });

  it('shows a hold whose owner is not in the read as occupied time, without guessing at an identity', () => {
    const o = buildBookingOverlay({ range: RANGE, occurrences: [], slotBookings: [], holds: [hold({ id: 'h-1', reservationId: 'res-elsewhere' }), hold({ id: 'h-2', resourceId: 'court-3' })] });
    expect(o.lanes.flatMap(l => l.items)).toEqual([
      { kind: 'hold', id: 'h-1', resourceId: 'court-1', startsAt: '2026-11-02T07:30:00Z', endsAt: '2026-11-02T08:30:00Z', owner: 'booking', ownerId: 'res-elsewhere' },
      expect.objectContaining({ kind: 'hold', id: 'h-2', owner: 'unknown', ownerId: null }),
    ]);
    expect(o.counts.holds).toBe(2);
  });

  it('does not draw an enrolment as a block: it is part of its session’s headcount', () => {
    const enrol = { ...booking({ id: 'res-e' }), kind: 'enrolment' as const, occurrenceId: 'occ-1', resourceId: null };
    const o = buildBookingOverlay({ range: RANGE, occurrences: [occ({ id: 'occ-1' })], slotBookings: [enrol], holds: [] });
    expect(o.lanes.flatMap(l => l.items).map(i => i.id)).toEqual(['occ-1']);
    expect(o.counts.slotBookings).toBe(0);
  });

  it('orders lanes by resource id and items by start, kind and id; is deterministic; does not modify its input', () => {
    const input = {
      range: RANGE,
      occurrences: [occ({ id: 'b', startsAt: '2026-11-03T07:30:00Z' }), occ({ id: 'a', startsAt: '2026-11-02T07:30:00Z' }), occ({ id: 'z', resourceId: 'court-0' })],
      slotBookings: [booking({ id: 'r2', resourceId: 'court-1', startsAt: '2026-11-02T07:30:00Z' })],
      holds: [],
    };
    const before = JSON.stringify(input);
    const o = buildBookingOverlay(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(buildBookingOverlay(input)).toEqual(o);
    expect(o.lanes.map(l => l.resourceId)).toEqual(['court-0', 'court-1']);
    expect(o.lanes[1].items.map(i => i.id)).toEqual(['a', 'r2', 'b']); // same start: the session before the booking
  });

  it('carries the truncation flags through, and never contains an identity key for any input', () => {
    const o = buildBookingOverlay({ range: RANGE, occurrences: [occ({ id: 'o1' })], slotBookings: [booking({ id: 'r1' })], holds: [hold({ id: 'h9' })], truncated: { slotBookings: true } });
    expect(o.truncated).toEqual({ occurrences: false, slotBookings: true, holds: false });
    expect(findIdentityLeaks(o)).toEqual([]);
  });
});

describe('bookingOverlay.ts is pure', () => {
  const src = readFileSync(path.resolve(__dirname, '../src/bookingOverlay.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('imports only types, takes no clock, is not async and writes nothing', () => {
    for (const m of src.matchAll(/^import\s+(type\s+)?\{[^}]*\}\s+from\s+'[^']+'/gm)) expect(m[0]).toMatch(/^import type/);
    expect(src).not.toMatch(/\bDate\.now\(|new Date\(\)|Math\.random|\basync\b|\bawait\b|Promise|fetch\(|process\.env/);
    expect(src).not.toMatch(/ReservationRepository|SchedulingConfigRepository|insert|upsert|\bsave\w*\(|\bwrite\w*\(/i);
  });
});
