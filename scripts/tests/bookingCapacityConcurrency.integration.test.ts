import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

// LD Tennis booking capacity: real disposable-Postgres concurrency proof.
//
// PROBLEM (docs/architecture/ld-tennis-public-booking-overbooking.md): every path that
// adds a booking to a session instance reads the live count, compares it with
// max_capacity, and then INSERTs as separate statements with no lock. Two requests for the
// last place can both pass the check. A mocked sql client cannot prove or disprove a race;
// only real MVCC can.
//
// WHAT THIS DRIVES: the real, unmodified route handlers and lib code, concurrently, against
// real Postgres:
//   - POST /api/tennis/book                                   (public, unauthenticated)
//   - POST /api/dashboard/sessions/[id]/instances/[instanceId] (staff enrol by name)
//   - POST /api/dashboard/enrolments                          (staff enrol from CRM contact)
//   - POST /api/bookings                                      (super_admin, instance branch)
//   - enrolLineageIntoInstance() / propagateRecurringEnrolment() (recurring propagation)
// and asserts the one invariant that matters: live bookings never exceed max_capacity, and
// every refused request gets the SAME response it always got (409 "full"), not a 500.
//
// Run ONLY via scripts/tests/verify-booking-capacity-concurrency.sh. That script runs this
// file twice: first WITHOUT the migration (the invariant tests MUST fail: this is the
// failing regression test that exists before the fix), then WITH
// scripts/add-booking-capacity-guard.sql applied twice (they MUST pass).
//
// TEST SEAM (same as purchaseReceiptConcurrency.integration.test.ts): lib/db's `sql` is
// replaced by a Prisma-backed equivalent. Each tagged-template call is one implicit
// transaction on its own pooled connection, exactly like the Neon HTTP driver, so the real
// race window is reproduced. Prisma wraps driver errors; the seam re-throws an error whose
// `.code` is the Postgres SQLSTATE, which is what NeonDbError exposes in production.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('bookingCapacityConcurrency.integration.test.ts requires DATABASE_URL pointing at a disposable Postgres container. Refusing to run without it.');
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a hosted/Production-looking DATABASE_URL.');
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const GUARD_EXPECTED = process.env.EXPECT_CAPACITY_GUARD === '1';

process.env.SESSION_SECRET ??= 'integration-test-secret-never-real-never-production-0000';
process.env.LD_TENNIS_ORG_ID = 'org-a';

const poolUrl = DATABASE_URL + (DATABASE_URL.includes('?') ? '&' : '?') + 'connection_limit=60&pool_timeout=60';
const prisma = new PrismaClient({ datasourceUrl: poolUrl });

const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
type QueryDescriptor = { text: string; values: unknown[] };

function compileNeonCompatibleQuery(strings: TemplateStringsArray, values: unknown[]): QueryDescriptor {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return { text, values };
}

function asNeonError(err: unknown): never {
  const meta = (err as { meta?: { code?: string; message?: string } })?.meta;
  if (meta?.code) {
    const e = new Error(meta.message ?? (err as Error).message) as Error & { code?: string };
    e.code = meta.code;
    throw e;
  }
  throw err;
}

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const q = compileNeonCompatibleQuery(strings, values);
  try {
    return await prisma.$queryRawUnsafe(q.text, ...q.values);
  } catch (err) {
    return asNeonError(err);
  }
}

vi.doMock('@/lib/db', () => ({ default: neonCompatibleSql }));
vi.doMock('@/lib/rateLimit', () => ({ checkRateLimit: () => true }));
vi.doMock('@/lib/org', () => ({
  requireRole: async () => ({ organisationId: 'org-a', userId: 'user-1', homeOrganisationId: 'org-a', role: 'super_admin', name: 'T' }),
}));

let publicBook: (req: NextRequest) => Promise<Response>;
let staffEnrol: (req: NextRequest, ctx: { params: Promise<{ id: string; instanceId: string }> }) => Promise<Response>;
let contactEnrol: (req: NextRequest) => Promise<Response>;
let adminBooking: (req: NextRequest) => Promise<Response>;
let enrolLineageIntoInstance: typeof import('@/lib/tennisRecurrence').enrolLineageIntoInstance;

const ORG = 'org-a';
let seq = 0;

beforeAll(async () => {
  ({ POST: publicBook } = await import('@/app/api/tennis/book/route'));
  ({ POST: staffEnrol } = await import('@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route'));
  ({ POST: contactEnrol } = await import('@/app/api/dashboard/enrolments/route'));
  ({ POST: adminBooking } = await import('@/app/api/bookings/route'));
  ({ enrolLineageIntoInstance } = await import('@/lib/tennisRecurrence'));
  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a') ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user-1', 'User One') ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => { await prisma.$disconnect(); });

function req(url: string, body: unknown): NextRequest {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest;
}

async function freshInstance(capacity: number, preFilled = 0): Promise<{ sessionId: string; instanceId: string }> {
  const n = ++seq;
  const sessionId = `sess-${n}`;
  const instanceId = `inst-${n}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO sessions (id, organisation_id, name, day_of_week, start_time, session_type, max_capacity) VALUES ($1, $2, 'Hot Shots', 1, '16:00', 'GROUP_TERM_JUNIOR', $3)`,
    sessionId, ORG, capacity);
  await prisma.$executeRawUnsafe(
    `INSERT INTO session_instances (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status) VALUES ($1, $2, $3, '2026-12-07', '16:00', 60, $4, 'scheduled')`,
    instanceId, sessionId, ORG, capacity);
  for (let i = 0; i < preFilled; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status) VALUES ($1, $2, $3, $4, $5, $6, '2026-12-07', '16:00', 'GROUP_TERM_JUNIOR', 'confirmed')`,
      `pre-${n}-${i}`, ORG, sessionId, instanceId, `Pre ${i}`, `pre${n}_${i}@example.com`);
  }
  return { sessionId, instanceId };
}

async function liveCount(instanceId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*)::int AS c FROM bookings WHERE session_instance_id = $1 AND status != 'cancelled'`, instanceId);
  return rows[0].c;
}

async function statuses(results: Response[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  for (const r of results) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

const ROUNDS = 4;

describe('LD Tennis booking capacity under concurrent requests (real Postgres)', () => {
  it('public booking: N parallel requests for a capacity-2 instance confirm exactly 2 and refuse the rest with the existing 409', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { instanceId } = await freshInstance(2);
      const results = await Promise.all(Array.from({ length: 14 }, (_, i) =>
        publicBook(req('http://localhost/api/tennis/book', { session_instance_id: instanceId, name: `P${i}`, email: `p${round}_${i}@example.com` }))));
      const by = await statuses(results);
      expect(await liveCount(instanceId), `round ${round}: ${JSON.stringify(by)}`).toBe(2);
      expect(by[201]).toBe(2);
      expect(by[409]).toBe(12);
      expect(Object.keys(by).sort()).toEqual(['201', '409']); // no 500s
      const bodies = await Promise.all(results.filter(r => r.status === 409).map(r => r.clone().json()));
      expect(bodies.every(b => b.error === 'This session is full')).toBe(true);
    }
  });

  it('public booking: a refused request leaves no orphan client_pipeline request behind', async () => {
    const { instanceId } = await freshInstance(1);
    await prisma.$executeRawUnsafe(`DELETE FROM client_pipeline WHERE organisation_id = $1`, ORG);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      publicBook(req('http://localhost/api/tennis/book', { session_instance_id: instanceId, name: `Q${i}`, email: `q_${i}@example.com` }))));
    const created = results.filter(r => r.status === 201).length;
    const pipelines = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM client_pipeline WHERE organisation_id = $1`, ORG);
    expect(await liveCount(instanceId)).toBe(1);
    expect(created).toBe(1);
    expect(pipelines[0].c).toBe(1);
  });

  it('staff enrol by name: parallel enrolments never exceed capacity; refusals are the existing 409 "Session is full"', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { sessionId, instanceId } = await freshInstance(3);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        staffEnrol(req('http://localhost/x', { client_name: `S${round}_${i}`, client_email: `s${round}_${i}@example.com`, frequency: 'once' }),
          { params: Promise.resolve({ id: sessionId, instanceId }) })));
      const by = await statuses(results);
      expect(await liveCount(instanceId), `round ${round}: ${JSON.stringify(by)}`).toBe(3);
      expect(by[201]).toBe(3);
      expect(by[409]).toBe(9);
      expect(Object.keys(by).sort()).toEqual(['201', '409']);
    }
  });

  it('staff enrol from a CRM contact: parallel enrolments never exceed capacity', async () => {
    const { instanceId } = await freshInstance(2);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `contact-${++seq}`;
      ids.push(id);
      await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, organisation_id, name, email) VALUES ($1, $2, $3, $4)`, id, ORG, `C${i}`, `c_${id}@example.com`);
    }
    const results = await Promise.all(ids.map(cid => contactEnrol(req('http://localhost/x', { session_instance_id: instanceId, contact_id: cid }))));
    const by = await statuses(results);
    expect(await liveCount(instanceId), JSON.stringify(by)).toBe(2);
    expect(by[201]).toBe(2);
    expect(by[409]).toBe(8);
    expect(Object.keys(by).sort()).toEqual(['201', '409']);
  });

  it('super_admin instance booking (/api/bookings): parallel requests never exceed capacity', async () => {
    const { sessionId, instanceId } = await freshInstance(2);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      adminBooking(req('http://localhost/x', { session_id: sessionId, session_instance_id: instanceId, client_name: `A${i}`, client_email: `a_${i}@example.com` }))));
    const by = await statuses(results);
    expect(await liveCount(instanceId), JSON.stringify(by)).toBe(2);
    expect(by[201]).toBe(2);
    expect(by[409]).toBe(8);
    expect(Object.keys(by).sort()).toEqual(['201', '409']);
  });

  it('all four booking paths racing for the same instance together never exceed capacity', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { sessionId, instanceId } = await freshInstance(3);
      const cids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = `mixc-${++seq}`;
        cids.push(id);
        await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, organisation_id, name, email) VALUES ($1, $2, $3, $4)`, id, ORG, `M${i}`, `m_${id}@example.com`);
      }
      const calls: Promise<Response>[] = [];
      for (let i = 0; i < 4; i++) {
        calls.push(publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: `MP${i}`, email: `mp${round}_${i}@example.com` })));
        calls.push(staffEnrol(req('http://localhost/x', { client_name: `MS${i}`, client_email: `ms${round}_${i}@example.com`, frequency: 'once' }), { params: Promise.resolve({ id: sessionId, instanceId }) }));
        calls.push(contactEnrol(req('http://localhost/x', { session_instance_id: instanceId, contact_id: cids[i] })));
        calls.push(adminBooking(req('http://localhost/x', { session_id: sessionId, session_instance_id: instanceId, client_name: `MA${i}`, client_email: `ma${round}_${i}@example.com` })));
      }
      const results = await Promise.all(calls);
      const by = await statuses(results);
      expect(await liveCount(instanceId), `round ${round}: ${JSON.stringify(by)}`).toBe(3);
      expect(by[201]).toBe(3);
      expect(Object.keys(by).sort()).toEqual(['201', '409']);
    }
  });

  it('recurring propagation: concurrent lineage enrolments fill only the remaining place and report capacity_blocked, never "error"', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { sessionId, instanceId } = await freshInstance(2, 1); // one place left
      const instance = { id: instanceId, date: '2026-12-07', start_time: '16:00', max_capacity: 2, session_type: 'GROUP_TERM_JUNIOR', enrolled: 1 };
      const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => enrolLineageIntoInstance({
        organisationId: ORG, sessionId, instance, recurringGroupId: `grp-${round}-${i}`,
        clientName: `R${i}`, clientEmail: `r${round}_${i}@example.com`, pauses: [],
      })));
      expect(await liveCount(instanceId), `round ${round}: ${JSON.stringify(outcomes)}`).toBe(2);
      expect(outcomes.filter(o => o === 'enrolled')).toHaveLength(1);
      expect(outcomes.filter(o => o === 'capacity_blocked')).toHaveLength(7);
      expect(outcomes).not.toContain('error');
    }
  });

  it('sequential behaviour is unchanged: the response body of a successful public booking and of a full-session refusal', async () => {
    const { instanceId } = await freshInstance(1);
    const ok = await publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: ' Sam ', email: 'sam@example.com', phone: '0400' }));
    expect(ok.status).toBe(201);
    const okBody = await ok.json();
    expect(okBody.success).toBe(true);
    expect(Object.keys(okBody.booking).sort()).toEqual(['date', 'id', 'session_name', 'start_time']);
    const full = await publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: 'Pat', email: 'pat@example.com' }));
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'This session is full' });
  });

  it('a cancelled booking frees its place, and inserting a cancelled row never consumes one', async () => {
    const { sessionId, instanceId } = await freshInstance(1, 1);
    await prisma.$executeRawUnsafe(`UPDATE bookings SET status = 'cancelled' WHERE session_instance_id = $1`, instanceId);
    const ok = await publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: 'Again', email: 'again@example.com' }));
    expect(ok.status).toBe(201);
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, organisation_id, session_id, session_instance_id, client_name, date, time, session_type, status) VALUES ($1, $2, $3, $4, 'Hist', '2026-12-07', '16:00', 'X', 'cancelled')`,
      `cancelled-${++seq}`, ORG, sessionId, instanceId);
    expect(await liveCount(instanceId)).toBe(1);
  });

  it('bookings with no instance (legacy one-off appointments) are not capacity-limited by the guard', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, organisation_id, client_name, date, time, session_type, status) VALUES ($1, $2, 'Solo', '2026-12-07', '09:00', 'PRIVATE', 'pending_confirmation')`,
      `solo-${++seq}`, ORG);
  });

  it('capacity changes are respected: lowering max_capacity below the live count blocks further bookings but keeps existing ones', async () => {
    const { instanceId } = await freshInstance(4, 3);
    await prisma.$executeRawUnsafe(`UPDATE session_instances SET max_capacity = 2 WHERE id = $1`, instanceId);
    const res = await publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: 'Late', email: 'late@example.com' }));
    expect(res.status).toBe(409);
    expect(await liveCount(instanceId)).toBe(3);
  });

  it('concurrent maintenance (reconcile-style instance UPDATE and booking cancel) alongside bookings produces no deadlock and no overbooking', async () => {
    const { sessionId, instanceId } = await freshInstance(3);
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) {
      work.push(publicBook(req('http://localhost/x', { session_instance_id: instanceId, name: `D${i}`, email: `d_${i}@example.com` })));
      if (i % 3 === 0) {
        work.push(prisma.$executeRawUnsafe(`UPDATE session_instances SET start_time = '16:00', duration_minutes = 60, max_capacity = 3 WHERE session_id = $1 AND status = 'scheduled'`, sessionId));
        work.push(prisma.$executeRawUnsafe(`UPDATE bookings SET status = 'cancelled' WHERE session_instance_id = $1 AND client_name = 'D0'`, instanceId));
      }
    }
    const settled = await Promise.allSettled(work);
    const failures = settled.filter(s => s.status === 'rejected');
    expect(failures.map(f => String((f as PromiseRejectedResult).reason)).join('\n')).toBe('');
    expect(await liveCount(instanceId)).toBeLessThanOrEqual(3);
  });

  it('the guard is present exactly when this run expects it (so the "before" run proves the failing state)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM pg_trigger WHERE tgname = 'bookings_capacity_guard' AND NOT tgisinternal`);
    expect(rows[0].c).toBe(GUARD_EXPECTED ? 1 : 0);
  });
});
