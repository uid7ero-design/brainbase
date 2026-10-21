import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { BOOKING_CAPACITY_SQLSTATE, isBookingCapacityError } from '@/lib/bookingCapacity';

// LD Tennis booking capacity guard: application side.
//
// The guard itself is a database trigger (scripts/add-booking-capacity-guard.sql), proven
// against real Postgres by scripts/tests/verify-booking-capacity-concurrency.sh. These
// mocked tests pin the other half: every booking write path answers a guard refusal with
// the SAME response its own pre-insert capacity check already gives (never a 500), and a
// refusal that is not a capacity refusal behaves exactly as before. They also fail if a new
// "INSERT INTO bookings" site appears without the same handling, which is how the locking
// discipline is kept uniform.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const capacityError = () => Object.assign(new Error('session_instance_full'), { code: 'BKCAP' });

function asNextRequest(req: Request): NextRequest { return req as unknown as NextRequest; }
const post = (body: unknown) => asNextRequest(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({ requireRole: (...a: unknown[]) => requireRoleMock(...a) }));
const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({ default: (...a: unknown[]) => sqlMock(...a) }));
const rateLimitMock = vi.fn(() => true);
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => rateLimitMock() }));

const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
const manager = { organisationId: 'org-a', userId: 'u1', role: 'manager' };

describe('isBookingCapacityError', () => {
  it('recognises only the BKCAP SQLSTATE', () => {
    expect(BOOKING_CAPACITY_SQLSTATE).toBe('BKCAP');
    expect(isBookingCapacityError(capacityError())).toBe(true);
    expect(isBookingCapacityError({ code: 'BKCAP' })).toBe(true);
    expect(isBookingCapacityError({ code: '23505' })).toBe(false);
    expect(isBookingCapacityError(new Error('session_instance_full'))).toBe(false); // message alone is not trusted
    expect(isBookingCapacityError(null)).toBe(false);
    expect(isBookingCapacityError(undefined)).toBe(false);
    expect(isBookingCapacityError('BKCAP')).toBe(false);
  });
});

describe('POST /api/tennis/book: guard refusal', () => {
  const INSTANCE = { id: 'inst-1', session_id: 'sess-1', date: '2026-11-02', start_time: '16:00', duration_minutes: 60, max_capacity: 2, session_name: 'Hot Shots', session_type: 'GROUP_TERM_JUNIOR' };
  const body = { session_instance_id: 'inst-1', name: 'Sam', email: 'sam@example.com' };
  let bookingInsertError: unknown;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('LD_TENNIS_ORG_ID', 'org-ld');
    sqlMock.mockReset();
    bookingInsertError = capacityError();
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM session_instances si')) return Promise.resolve([INSTANCE]);
      if (t.includes('SELECT COUNT(*)::int AS count FROM bookings')) return Promise.resolve([{ count: 0 }]);
      if (t.includes('SELECT id FROM bookings')) return Promise.resolve([]);
      if (t.includes('INSERT INTO bookings')) return Promise.reject(bookingInsertError);
      return Object.assign(Promise.resolve([]), {});
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('answers the existing 409 "This session is full", removes the pipeline request it created, and writes no message', async () => {
    const { POST } = await import('@/app/api/tennis/book/route');
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This session is full' });
    const texts = sqlMock.mock.calls.map(text);
    const created = sqlMock.mock.calls.find(c => text(c).includes('INSERT INTO client_pipeline'))!;
    const deleted = sqlMock.mock.calls.find(c => text(c).includes('DELETE FROM client_pipeline'))!;
    expect(deleted).toBeDefined();
    expect(text(deleted)).toMatch(/organisation_id = \?/);
    expect(deleted.slice(1)).toContain('org-ld');
    expect(deleted.slice(1)[0]).toBe(created.slice(1)[0]); // same pipeline id
    expect(texts.some(t => t.includes('INSERT INTO pipeline_messages'))).toBe(false);
  });

  it('a different insert failure is unchanged: 500 "Failed to create booking", and the pipeline request is not touched', async () => {
    bookingInsertError = Object.assign(new Error('boom'), { code: '23503' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('@/app/api/tennis/book/route');
    const res = await POST(post(body));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to create booking' });
    expect(sqlMock.mock.calls.some(c => text(c).includes('DELETE FROM client_pipeline'))).toBe(false);
    spy.mockRestore();
  });
});

describe('staff enrolment paths: guard refusal', () => {
  beforeEach(() => { vi.resetModules(); requireRoleMock.mockReset().mockResolvedValue(manager); sqlMock.mockReset(); });

  it('POST /api/dashboard/enrolments (from a contact) answers 409 "Session is full"', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM contacts')) return Promise.resolve([{ id: 'c1', name: 'Sam', email: 'sam@example.com' }]);
      if (t.includes('FROM session_instances si')) return Promise.resolve([{ id: 'i1', session_id: 's1', max_capacity: 2, enrolled: 0, date: '2026-12-07', start_time: '16:00', session_type: 'X' }]);
      if (t.includes('INSERT INTO bookings')) return Promise.reject(capacityError());
      return Promise.resolve([]);
    });
    const { POST } = await import('@/app/api/dashboard/enrolments/route');
    const res = await POST(post({ session_instance_id: 'i1', contact_id: 'c1' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Session is full' });
  });

  it('POST /api/dashboard/enrolments keeps 500 for any other failure', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM contacts')) return Promise.resolve([{ id: 'c1', name: 'Sam', email: null }]);
      if (t.includes('FROM session_instances si')) return Promise.resolve([{ id: 'i1', session_id: 's1', max_capacity: 2, enrolled: 0, date: '2026-12-07', start_time: '16:00', session_type: 'X' }]);
      if (t.includes('INSERT INTO bookings')) return Promise.reject(new Error('other'));
      return Promise.resolve([]);
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('@/app/api/dashboard/enrolments/route');
    const res = await POST(post({ session_instance_id: 'i1', contact_id: 'c1' }));
    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  it('POST /api/dashboard/sessions/[id]/instances/[instanceId] (enrol by name) answers 409 "Session is full"', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM session_instances si')) return Promise.resolve([{ id: 'i1', session_id: 's1', date: '2026-12-07', start_time: '16:00', max_capacity: 2, session_type: 'X' }]);
      if (t.includes('SELECT COUNT(*)::int AS cnt FROM bookings')) return Promise.resolve([{ cnt: 0 }]);
      if (t.includes('INSERT INTO bookings')) return Promise.reject(capacityError());
      return Promise.resolve([]);
    });
    const { POST } = await import('@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route');
    const res = await POST(post({ client_name: 'Sam', frequency: 'once' }), { params: Promise.resolve({ id: 's1', instanceId: 'i1' }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Session is full' });
  });

  it('POST /api/bookings (super_admin, instance booking) answers 409 "Session instance is full"', async () => {
    requireRoleMock.mockResolvedValue({ organisationId: 'org-a', userId: 'u1', role: 'super_admin' });
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const t = strings.join('?');
      if (t.includes('FROM session_instances si')) return Promise.resolve([{ id: 'i1', session_id: 's1', date: '2026-12-07', start_time: '16:00', duration_minutes: 60, max_capacity: 2, name: 'N', session_type: 'X', day_of_week: 1 }]);
      if (t.includes('SELECT COUNT(*)::int AS count FROM bookings')) return Promise.resolve([{ count: 0 }]);
      if (t.includes('INSERT INTO bookings')) return Promise.reject(capacityError());
      return Promise.resolve([]);
    });
    const { POST } = await import('@/app/api/bookings/route');
    const res = await POST(post({ session_instance_id: 'i1', client_name: 'Sam' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Session instance is full' });
  });
});

describe('recurring propagation: guard refusal', () => {
  beforeEach(() => { vi.resetModules(); sqlMock.mockReset(); });
  const params = {
    organisationId: 'org-a', sessionId: 's1',
    instance: { id: 'i1', date: '2026-12-07', start_time: '16:00', max_capacity: 3, session_type: 'X', enrolled: 1 },
    recurringGroupId: 'g1', clientName: 'Sam', clientEmail: 'sam@example.com', pauses: [],
  };

  it('a guard refusal is reported as capacity_blocked (the outcome the pre-insert check already uses), not as an error', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => strings.join('?').includes('INSERT INTO bookings') ? Promise.reject(capacityError()) : Promise.resolve([]));
    const { enrolLineageIntoInstance } = await import('@/lib/tennisRecurrence');
    expect(await enrolLineageIntoInstance(params)).toBe('capacity_blocked');
  });

  it('any other insert failure is still an error', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => strings.join('?').includes('INSERT INTO bookings') ? Promise.reject(new Error('other')) : Promise.resolve([]));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { enrolLineageIntoInstance } = await import('@/lib/tennisRecurrence');
    expect(await enrolLineageIntoInstance(params)).toBe('error');
    spy.mockRestore();
  });
});

describe('locking discipline: no booking write path bypasses the guard handling', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
    return out;
  }
  const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
  const sites = ['app', 'lib', 'components', 'services', 'modules']
    .flatMap(d => walk(path.join(ROOT, d)))
    .filter(f => /INSERT INTO bookings/.test(readFileSync(f, 'utf8')))
    .map(rel).sort();

  it('the set of files that INSERT INTO bookings is exactly the known six; a new one must be added here deliberately', () => {
    expect(sites).toEqual([
      'app/api/bookings/route.ts',
      'app/api/dashboard/enrolments/route.ts',
      'app/api/dashboard/sessions/[id]/instances/[instanceId]/route.ts',
      'app/api/tennis/book/route.ts',
      'lib/tennisRecurrence.ts',
    ].sort());
  });

  for (const file of sites) {
    it(`${file} handles the guard refusal`, () => {
      const src = read(file);
      expect(src).toContain("from '@/lib/bookingCapacity'");
      expect(src).toMatch(/isBookingCapacityError\(err\)/);
    });
  }

  it('no insert-site file can send an email, take a payment or notify: a refused booking has no side effect to undo', () => {
    for (const f of sites) {
      const src = read(f);
      expect(src, f).not.toMatch(/from '[^']*(email|resend|stripe|notif|payment)[^']*'/i);
      expect(src, f).not.toMatch(/\b(sendEmail|sendMail|stripe\.|resend\.|notify\w*\()/i);
    }
  });

  it('recurring propagation reaches the guard through the same insert in lib/tennisRecurrence.ts (reconcile, pause-clear, weekly toggle and generate all call it)', () => {
    for (const f of ['lib/tennisSchedule.ts', 'app/api/dashboard/enrolments/[id]/route.ts', 'app/api/dashboard/enrolments/[id]/pause/route.ts']) {
      expect(read(f), f).toMatch(/tennisRecurrence/);
      expect(read(f), f).not.toMatch(/INSERT INTO bookings/);
    }
  });

  it('no code path re-activates a cancelled booking or moves a booking to another instance (so inserts are the only way a count grows)', () => {
    const files = ['app', 'lib'].flatMap(d => walk(path.join(ROOT, d)));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/UPDATE bookings SET([^`]*)`/g)) {
        const stmt = m[1];
        const setPart = stmt.split(/\bWHERE\b/)[0];
        expect(setPart, `${rel(f)}: ${stmt.slice(0, 80)}`).not.toMatch(/session_instance_id\s*=/);
        // Any status written by an UPDATE must be 'cancelled', or a confirm/reschedule that
        // keeps the booking live (it is already counted) -- never a path from cancelled to live.
        for (const x of setPart.matchAll(/status\s*=\s*'(\w+)'/g)) {
          expect(['cancelled', 'confirmed', 'reschedule_requested'], `${rel(f)}: ${stmt.slice(0, 80)}`).toContain(x[1]);
        }
      }
    }
  });
});

describe('scripts/add-booking-capacity-guard.sql', () => {
  const sqlText = read('scripts/add-booking-capacity-guard.sql');
  const code = sqlText.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  it('creates one function and one BEFORE INSERT row trigger on bookings, idempotently', () => {
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.booking_capacity_guard\(\)/);
    expect(code).toMatch(/DROP TRIGGER IF EXISTS bookings_capacity_guard ON public\.bookings;/);
    expect(code).toMatch(/CREATE TRIGGER bookings_capacity_guard\s+BEFORE INSERT ON public\.bookings\s+FOR EACH ROW/);
    expect(code.match(/CREATE TRIGGER/g)).toHaveLength(1);
  });

  it('serialises per instance with a transaction-scoped advisory lock and raises the BKCAP SQLSTATE', () => {
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('booking_capacity:' \|\| NEW\.session_instance_id, 0\)\)/);
    expect(code).toMatch(/ERRCODE = 'BKCAP'/);
    expect(code).not.toMatch(/FOR UPDATE/i); // deliberately no row lock on session_instances/bookings
  });

  it('counts exactly what the routes count, and never limits instance-less or already-cancelled rows', () => {
    expect(code).toMatch(/WHERE session_instance_id = NEW\.session_instance_id\s+AND status != 'cancelled'/);
    expect(code).toMatch(/NEW\.session_instance_id IS NULL OR NEW\.status IS NOT DISTINCT FROM 'cancelled'/);
    expect(code).toMatch(/live_count >= instance_capacity/);
  });

  it('fails closed under REPEATABLE READ with its own SQLSTATE', () => {
    expect(code).toMatch(/current_setting\('transaction_isolation'\) = 'repeatable read'/);
    expect(code).toMatch(/ERRCODE = 'BKISO'/);
  });

  it('is additive: no table, column, index, constraint or row is changed or removed', () => {
    expect(code).not.toMatch(/\bALTER TABLE\b|\bDROP TABLE\b|\bDROP COLUMN\b|\bTRUNCATE\b|\bDELETE FROM\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT INTO\b|\bCREATE (UNIQUE )?INDEX\b/i);
  });

  it('documents the pre-check, verification and rollback in its header', () => {
    expect(sqlText).toMatch(/PRE-CHECK/);
    expect(sqlText).toMatch(/VERIFY after applying/);
    expect(sqlText).toMatch(/ROLLBACK/);
    expect(sqlText).toMatch(/DROP TRIGGER IF EXISTS bookings_capacity_guard ON public\.bookings;\n--\s+DROP FUNCTION IF EXISTS public\.booking_capacity_guard\(\);/);
  });
});
