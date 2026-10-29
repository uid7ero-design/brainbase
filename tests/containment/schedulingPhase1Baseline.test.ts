import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Scheduling & Bookings Phase 1: compatibility baseline for LD Tennis.
//
// The existing tennis suite (tests/containment/tennis*.test.ts and friends)
// already covers recurrence, reconcile, archive, display, duplicate
// enrolment, pauses and the dashboard enrolment/instance routes. This file
// records ONLY behaviour that suite does not exercise, so any later
// extraction of tennis logic into the scheduling engine has a safety net
// for it: pure schedule maths pinned against a fixed clock, and the routes
// that previously had no behavioural test (public sessions list, lead
// cancel, remove-future, the super_admin-only legacy sessions routes).
//
// Nothing here touches a database: every `sql` call is a mock.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function jsonPost(url: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

// computeExpectedOccurrences is pure, but its module imports the db client
// and the recurrence module; both are inert under these mocks.
vi.mock('@/lib/tennisRecurrence', () => ({ enrolActiveLineagesIntoNewInstance: vi.fn() }));
const { computeExpectedOccurrences, HORIZON_WEEKS } = await import('@/lib/tennisSchedule');
const compat = await import('@/lib/scheduling/compatibility/tennis');

// ── 1. Schedule maths, pinned against a fixed clock ─────────────────────────

describe('LD Tennis baseline: computeExpectedOccurrences against a fixed clock', () => {
  // Wednesday 21 Oct 2026, local midnight (the function takes "today" as an argument).
  const today = new Date(2026, 9, 21);
  const MONDAY = 1;

  it('ongoing: weekly Mondays from today through the 10-week horizon, inclusive of the horizon boundary', () => {
    expect(HORIZON_WEEKS).toBe(10);
    const dates = computeExpectedOccurrences(
      { day_of_week: MONDAY, start_date: '2026-10-05', end_mode: 'ongoing', end_after_weeks: null, end_date: null }, today);
    expect(dates).toEqual([
      '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23',
      '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28',
    ]);
  });

  it('after_weeks: counts from the first occurrence on/after start_date, so a term already underway keeps its original last week', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: MONDAY, start_date: '2026-10-05', end_mode: 'after_weeks', end_after_weeks: 6, end_date: null }, today);
    // Term weeks: 5 Oct, 12 Oct, 19 Oct, 26 Oct, 2 Nov, 9 Nov. Only those on/after today remain.
    expect(dates).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('on_date: stops at the end date, inclusive', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: MONDAY, start_date: '2026-10-05', end_mode: 'on_date', end_after_weeks: null, end_date: '2026-11-09' }, today);
    expect(dates).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('a session whose start_date is in the future starts at that date, not today', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: MONDAY, start_date: '2026-11-16', end_mode: 'on_date', end_after_weeks: null, end_date: '2026-11-30' }, today);
    expect(dates).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
  });

  it('a malformed after_weeks row (no start_date) behaves as ongoing-from-today: the rule is ignored, not an error', () => {
    const malformed = { day_of_week: MONDAY, start_date: null, end_mode: 'after_weeks' as const, end_after_weeks: 4, end_date: null };
    const ongoing = { day_of_week: MONDAY, start_date: null, end_mode: 'ongoing' as const, end_after_weeks: null, end_date: null };
    expect(computeExpectedOccurrences(malformed, today)).toEqual(computeExpectedOccurrences(ongoing, today));
  });

  it('the result does not depend on the process timezone for a given local calendar day (dates are built from local components)', () => {
    const a = computeExpectedOccurrences({ day_of_week: 0, start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null }, new Date(2026, 9, 21));
    expect(a[0]).toBe('2026-10-25'); // the Sunday after Wed 21 Oct
    expect(a).toHaveLength(HORIZON_WEEKS);
  });
});

// ── 2. Compatibility mapping onto the scheduling core ───────────────────────

describe('LD Tennis baseline: legacy schedule rules map onto the core without changing meaning', () => {
  const today = new Date(2026, 9, 21);
  const cases = [
    { day_of_week: 1, start_date: '2026-10-05', end_mode: 'ongoing' as const, end_after_weeks: null, end_date: null },
    { day_of_week: 3, start_date: '2026-09-02', end_mode: 'after_weeks' as const, end_after_weeks: 12, end_date: null },
    { day_of_week: 0, start_date: '2026-10-04', end_mode: 'on_date' as const, end_after_weeks: null, end_date: '2026-12-13' },
    { day_of_week: 5, start_date: null, end_mode: 'ongoing' as const, end_after_weeks: null, end_date: null },
  ];

  it('well-formed rules round-trip exactly through the core Recurrence', () => {
    for (const rules of cases) {
      expect(compat.recurrenceToTennisRules(compat.tennisRulesToRecurrence(rules))).toEqual(rules);
    }
  });

  it('malformed rules map to what production actually does with them (ongoing), and still produce identical occurrences', () => {
    const malformed = [
      { day_of_week: 2, start_date: null, end_mode: 'after_weeks' as const, end_after_weeks: 5, end_date: null }, // no anchor
      { day_of_week: 2, start_date: '2026-10-05', end_mode: 'after_weeks' as const, end_after_weeks: 0, end_date: null }, // zero weeks
      { day_of_week: 2, start_date: '2026-10-05', end_mode: 'on_date' as const, end_after_weeks: null, end_date: null }, // no end date
    ];
    for (const rules of malformed) {
      const mapped = compat.tennisRulesToRecurrence(rules);
      expect(mapped).toMatchObject({ kind: 'weekly', end: { mode: 'ongoing' } });
      const normalised = compat.recurrenceToTennisRules(mapped);
      expect(computeExpectedOccurrences(normalised, today)).toEqual(computeExpectedOccurrences(rules, today));
    }
  });

  it('a non-weekly recurrence cannot be expressed as a tennis session and is refused rather than guessed', () => {
    expect(() => compat.recurrenceToTennisRules({ kind: 'none' })).toThrow();
  });

  it('booking statuses map; statuses the core cannot represent are surfaced as null, never coerced', () => {
    expect(compat.tennisBookingStatusToReservationStatus('confirmed')).toBe('confirmed');
    expect(compat.tennisBookingStatusToReservationStatus('pending_confirmation')).toBe('pending');
    expect(compat.tennisBookingStatusToReservationStatus('cancelled')).toBe('cancelled');
    expect(compat.tennisBookingStatusToReservationStatus('reschedule_requested')).toBeNull();
    expect(compat.tennisBookingStatusToReservationStatus('anything-else')).toBeNull();
    expect(compat.TENNIS_PRESET_KEY).toBe('classes_coaching');
  });
});

// ── 3. Routes with no previous behavioural coverage ─────────────────────────

describe('LD Tennis baseline: GET /api/tennis/sessions (public, org fixed by LD_TENNIS_ORG_ID)', () => {
  beforeEach(() => { sqlMock.mockReset(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns an empty list and never queries when the deployment org is not configured', async () => {
    vi.stubEnv('LD_TENNIS_ORG_ID', '');
    const { GET } = await import('@/app/api/tennis/sessions/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the configured organisation, to scheduled instances, and returns them under { sessions }', async () => {
    vi.stubEnv('LD_TENNIS_ORG_ID', 'org-ld');
    const rows = [{ id: 'i1', session_id: 's1', date: '2026-10-26', start_time: '16:00', enrolled_count: 3 }];
    sqlMock.mockResolvedValueOnce(rows);
    const { GET } = await import('@/app/api/tennis/sessions/route');
    const res = await GET();
    expect(await res.json()).toEqual({ sessions: rows });
    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = strings.join('?');
    expect(values).toContain('org-ld');
    expect(text).toMatch(/s\.organisation_id\s*=/);
    expect(text).toMatch(/si\.status\s*=\s*'scheduled'/);
  });

  it('a database failure degrades to an empty list with status 200, not an error (existing behaviour)', async () => {
    vi.stubEnv('LD_TENNIS_ORG_ID', 'org-ld');
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/tennis/sessions/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
    spy.mockRestore();
  });
});

describe('LD Tennis baseline: POST /api/tennis/cancel (public lead cancellation by token)', () => {
  beforeEach(() => { sqlMock.mockReset(); });

  it('400 when no token is supplied, without touching the database', async () => {
    const { POST } = await import('@/app/api/tennis/cancel/route');
    const res = await POST(jsonPost('http://localhost/api/tennis/cancel', {}));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('cancels a live lead and returns its name', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'l1', name: 'Sam' }]);
    const { POST } = await import('@/app/api/tennis/cancel/route');
    const res = await POST(jsonPost('http://localhost/api/tennis/cancel', { token: '11111111-1111-1111-1111-111111111111' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'Sam' });
    const text = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(text).toMatch(/status NOT IN \('cancelled', 'closed', 'booked'\)/);
  });

  it('404 for an unknown token; { already: true } for a lead already cancelled; 400 once past the cancellable stage', async () => {
    const { POST } = await import('@/app/api/tennis/cancel/route');
    const call = () => POST(jsonPost('http://localhost/api/tennis/cancel', { token: '11111111-1111-1111-1111-111111111111' }));

    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await call()).status).toBe(404);

    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'cancelled' }]);
    const already = await call();
    expect(already.status).toBe(200);
    expect(await already.json()).toEqual({ already: true });

    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'booked' }]);
    expect((await call()).status).toBe(400);
  });
});

describe('LD Tennis baseline: POST /api/dashboard/enrolments/remove-future', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); });
  const url = 'http://localhost/api/dashboard/enrolments/remove-future';
  const body = { client_name: 'Sam', client_email: 'sam@example.com', session_id: 's1', from_date: '2026-11-02', recurring_group_id: 'grp-1' };

  it('requires manager and does nothing for a lower role', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const { POST } = await import('@/app/api/dashboard/enrolments/remove-future/route');
    const res = await POST(jsonPost(url, body));
    expect(requireRoleMock).toHaveBeenCalledWith('manager');
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('400 when name, session or date is missing', async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'manager' });
    const { POST } = await import('@/app/api/dashboard/enrolments/remove-future/route');
    expect((await POST(jsonPost(url, { ...body, client_name: '  ' }))).status).toBe(400);
    expect((await POST(jsonPost(url, { ...body, session_id: '' }))).status).toBe(400);
    expect((await POST(jsonPost(url, { ...body, from_date: undefined }))).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("scopes both UPDATEs to the caller's organisation, stops recurrence on the current date and cancels strictly later dates", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'manager' });
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    const { POST } = await import('@/app/api/dashboard/enrolments/remove-future/route');
    const res = await POST(jsonPost(url, body));
    expect(await res.json()).toEqual({ cancelled: 2 });
    expect(sqlMock).toHaveBeenCalledTimes(2);
    for (const call of sqlMock.mock.calls) {
      const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
      expect(strings.join('?')).toMatch(/organisation_id = \?/);
      expect(values).toContain('org-a');
    }
    expect((sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?')).toMatch(/date = \?::date/);
    expect((sqlMock.mock.calls[1][0] as TemplateStringsArray).join('?')).toMatch(/date > \?::date/);
  });
});

describe('LD Tennis baseline: legacy /api/sessions routes remain super_admin-only and organisation-scoped', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); });

  it('GET /api/sessions denies a manager (the dashboard routes, not these, serve LD Tennis managers)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const { GET } = await import('@/app/api/sessions/route');
    const res = await GET();
    expect(requireRoleMock).toHaveBeenCalledWith('super_admin');
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("GET /api/sessions reads only the caller organisation's sessions", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'super_admin' });
    sqlMock.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/sessions/route');
    await GET();
    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toContain('org-a');
    expect(strings.join('?')).toMatch(/organisation_id/);
  });
});

// ── 4. Public booking (POST /api/tennis/book) ───────────────────────────────

const rateLimitMock = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => rateLimitMock(...args) }));

describe('LD Tennis baseline: POST /api/tennis/book (public booking, org fixed by LD_TENNIS_ORG_ID)', () => {
  const url = 'http://localhost/api/tennis/book';
  const INSTANCE = {
    id: 'inst-1', session_id: 'sess-1', date: '2026-11-02', start_time: '16:00',
    duration_minutes: 60, max_capacity: 2, session_name: 'Hot Shots', session_type: 'GROUP_TERM_JUNIOR',
  };
  const valid = { session_instance_id: 'inst-1', name: ' Sam ', email: ' Sam@Example.com ', phone: '0400' };

  const texts = () => sqlMock.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?'));
  function route(): Promise<typeof import('@/app/api/tennis/book/route')> {
    return import('@/app/api/tennis/book/route');
  }
  // Answers the route's reads/writes by statement shape.
  function installDb(opts: { instance?: object | null; enrolled?: number; duplicate?: boolean } = {}) {
    const { instance = INSTANCE, enrolled = 0, duplicate = false } = opts;
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM session_instances si')) return Promise.resolve(instance ? [instance] : []);
      if (t.includes('SELECT COUNT(*)::int AS count FROM bookings')) return Promise.resolve([{ count: enrolled }]);
      if (t.includes('SELECT id FROM bookings')) return Promise.resolve(duplicate ? [{ id: 'b0' }] : []);
      return Object.assign(Promise.resolve([]), {}); // INSERTs
    });
  }

  beforeEach(() => {
    sqlMock.mockReset();
    rateLimitMock.mockReset().mockReturnValue(true);
    vi.resetModules();
    vi.stubEnv('LD_TENNIS_ORG_ID', 'org-ld');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('503 and no database access when the deployment organisation is not configured', async () => {
    vi.stubEnv('LD_TENNIS_ORG_ID', '');
    const { POST } = await route();
    expect((await POST(jsonPost(url, valid))).status).toBe(503);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('429 when the per-IP rate limit (10 per hour) is exceeded, before reading the body or the database', async () => {
    rateLimitMock.mockReturnValue(false);
    const { POST } = await route();
    expect((await POST(jsonPost(url, valid))).status).toBe(429);
    expect(rateLimitMock.mock.calls[0][1]).toBe(10);
    expect(rateLimitMock.mock.calls[0][2]).toBe(60 * 60_000);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('400 for a missing or blank instance, name or email', async () => {
    const { POST } = await route();
    for (const bad of [{ ...valid, session_instance_id: '' }, { ...valid, name: '  ' }, { ...valid, email: '' }]) {
      expect((await POST(jsonPost(url, bad))).status).toBe(400);
    }
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('404 when the instance is not a scheduled instance of the configured organisation', async () => {
    installDb({ instance: null });
    const { POST } = await route();
    expect((await POST(jsonPost(url, valid))).status).toBe(404);
    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toContain('org-ld');
    expect(strings.join('?')).toMatch(/si\.status = 'scheduled'/);
  });

  it('409 when the session is full, and nothing is written', async () => {
    installDb({ enrolled: 2 });
    const { POST } = await route();
    const res = await POST(jsonPost(url, valid));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This session is full' });
    expect(texts().some(t => t.includes('INSERT'))).toBe(false);
  });

  it('409 when the same email (case-insensitive, trimmed) already holds a live booking on the instance', async () => {
    installDb({ duplicate: true });
    const { POST } = await route();
    const res = await POST(jsonPost(url, valid));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'You have already booked this session' });
    const dup = sqlMock.mock.calls.find(c => (c[0] as TemplateStringsArray).join('?').includes('LOWER(client_email)'))!;
    expect(dup.slice(1)).toContain('Sam@Example.com');
    expect(texts().some(t => t.includes('INSERT'))).toBe(false);
  });

  it('201: creates a pipeline request, then a CONFIRMED booking in the configured organisation, then a message; returns the booking summary', async () => {
    installDb();
    const { POST } = await route();
    const res = await POST(jsonPost(url, valid));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.booking).toMatchObject({ session_name: 'Hot Shots', date: '2026-11-02', start_time: '16:00' });

    const order = texts().map(t =>
      t.includes('FROM session_instances si') ? 'instance'
        : t.includes('SELECT COUNT(*)') ? 'count'
        : t.includes('LOWER(client_email)') ? 'duplicate'
        : t.includes('INSERT INTO client_pipeline') ? 'pipeline'
        : t.includes('INSERT INTO bookings') ? 'booking'
        : t.includes('INSERT INTO pipeline_messages') ? 'message' : 'other');
    // Characterisation of today's behaviour: capacity and duplicate are READ before
    // the INSERT with no lock or transaction, so concurrent requests can overbook.
    // The scheduling repository contract (concurrent create test) exists to prevent
    // that in the replacement; this order is what the replacement must improve on.
    expect(order).toEqual(['instance', 'count', 'duplicate', 'pipeline', 'booking', 'message']);

    const bookingCall = sqlMock.mock.calls.find(c => (c[0] as TemplateStringsArray).join('?').includes('INSERT INTO bookings'))!;
    expect(bookingCall.slice(1)).toEqual(expect.arrayContaining(['org-ld', 'sess-1', 'inst-1', 'Sam', 'Sam@Example.com', 'GROUP_TERM_JUNIOR', '16:00']));
    expect((bookingCall[0] as TemplateStringsArray).join('?')).toMatch(/'confirmed'/);
    // It creates no CRM contact: the only customer record is the booking row itself.
    expect(texts().some(t => /contacts/.test(t))).toBe(false);
  });
});

// ── 5. Single-enrolment cancel (DELETE /api/dashboard/enrolments/[id]) ──────

describe('LD Tennis baseline: DELETE /api/dashboard/enrolments/[id] cancels one booking, never deletes the row', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); });
  const ctx = { params: Promise.resolve({ id: 'booking-1' }) };
  const req = () => asNextRequest(new Request('http://localhost/api/dashboard/enrolments/booking-1', { method: 'DELETE' }));

  it('requires manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const { DELETE } = await import('@/app/api/dashboard/enrolments/[id]/route');
    expect((await DELETE(req(), ctx)).status).toBe(403);
    expect(requireRoleMock).toHaveBeenCalledWith('manager');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("soft-cancels (status = 'cancelled') only within the caller organisation and reports { deleted: true }", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'manager' });
    sqlMock.mockResolvedValueOnce([{ id: 'booking-1' }]);
    const { DELETE } = await import('@/app/api/dashboard/enrolments/[id]/route');
    const res = await DELETE(req(), ctx);
    expect(await res.json()).toEqual({ deleted: true });
    const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toMatch(/UPDATE bookings SET status = 'cancelled'/);
    expect(strings.join('?')).not.toMatch(/DELETE FROM/);
    expect(values).toEqual(['booking-1', 'org-a']);
  });

  it("404 for a booking in another organisation (the UPDATE matches nothing)", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'manager' });
    sqlMock.mockResolvedValueOnce([]);
    const { DELETE } = await import('@/app/api/dashboard/enrolments/[id]/route');
    expect((await DELETE(req(), ctx)).status).toBe(404);
  });
});
