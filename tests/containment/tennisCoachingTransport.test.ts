import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ access: vi.fn(), safety: vi.fn(), sql: vi.fn(), list: vi.fn(), attendance: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/tennisBusiness/coachingAccess', () => ({ coachingAccess: mocks.access }));
vi.mock('@/lib/tennisBusiness/coachingSafety', () => ({ coachingCapacityReady: mocks.safety }));
vi.mock('@/app/api/dashboard/sessions/route', () => ({ GET: mocks.list, POST: vi.fn() }));
vi.mock('@/app/api/bookings/[id]/route', () => ({ PATCH: mocks.attendance }));
const { handleCoaching } = await import('@/lib/tennisBusiness/coachingTransport');
const id = '10000000-0000-4000-8000-000000000001';
function request(method = 'GET', body?: unknown, origin = 'https://local.test') {
  return new NextRequest('https://local.test/api/business/tennis/coaching/sessions', { method, headers: { origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.access.mockResolvedValue({ ok: true, session: { organisationId: 'a', role: 'admin' }, modules: ['scheduling'] });
  mocks.safety.mockResolvedValue(true); mocks.sql.mockResolvedValue([{ id }]);
  mocks.list.mockImplementation(async () => Response.json({ sessions: [{ id }] }));
  mocks.attendance.mockImplementation(async () => Response.json({ booking: { id } }));
});
describe('LD-only coaching transport retains legacy business authority', () => {
  it.each([401,403,404,503])('denies access %s before touching legacy handlers or record queries', async status => {
    mocks.access.mockResolvedValue({ ok: false, status });
    expect((await handleCoaching(request(), ['sessions'])).status).toBe(status); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('uses the saved legacy list, with private/no-store and no second booking source', async () => {
    const response = await handleCoaching(request(), ['sessions']); expect(await response.json()).toEqual({ sessions: [{ id }] }); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(mocks.list).toHaveBeenCalledOnce();
  });
  it('refuses foreign-origin writes before database access', async () => {
    expect((await handleCoaching(request('PATCH', { paid: true }, 'https://foreign.test'), ['bookings', id])).status).toBe(403); expect(mocks.safety).not.toHaveBeenCalled(); expect(mocks.attendance).not.toHaveBeenCalled();
  });
  it('fails closed if the capacity guard is missing or cannot be checked', async () => {
    mocks.safety.mockResolvedValue(false); expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings',id])).status).toBe(503);
    mocks.safety.mockRejectedValue(new Error('catalog unavailable')); expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings',id])).status).toBe(503); expect(mocks.attendance).not.toHaveBeenCalled();
  });
  it('refuses a foreign booking even for a platform owner working in LD Tennis', async () => {
    mocks.access.mockResolvedValue({ ok: true, session: { organisationId: 'a', role: 'super_admin' }, modules: ['scheduling'] }); mocks.sql.mockResolvedValue([]);
    expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings',id])).status).toBe(404); expect(mocks.attendance).not.toHaveBeenCalled();
  });
  it('permits only attendance/paid marker changes, never a general booking or payment command', async () => {
    expect((await handleCoaching(request('PATCH', { action: 'confirm' }), ['bookings',id])).status).toBe(400);
    expect((await handleCoaching(request('PATCH', { attendance_status: 'present' }), ['bookings',id])).status).toBe(200); expect(mocks.attendance).toHaveBeenCalledOnce();
    expect((await handleCoaching(request('POST', {}), ['payments'])).status).toBe(404);
  });
  it('does not dispatch unknown paths, arbitrary module names, or unsupported methods', async () => {
    expect((await handleCoaching(request(), ['..','contacts'])).status).toBe(404);
    expect((await handleCoaching(request('DELETE'), ['sessions'])).status).toBe(405);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('accepts existing CUID booking identifiers and rejects oversized or encoded path identifiers', async () => {
    expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings', 'cm9oldbooking123'])).status).toBe(200);
    expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings', 'a'.repeat(129)])).status).toBe(404);
    expect((await handleCoaching(request('PATCH', { paid: true }), ['bookings', '%2fcontacts'])).status).toBe(404);
    expect(mocks.attendance).toHaveBeenCalledOnce();
  });
  it('turns an unconfirmed legacy failure into a generic error without retrying it', async () => {
    mocks.attendance.mockRejectedValue(new Error('synthetic database detail'));
    const response = await handleCoaching(request('PATCH', { paid: true }), ['bookings',id]); expect(response.status).toBe(503); expect(await response.text()).not.toContain('database detail'); expect(mocks.attendance).toHaveBeenCalledOnce();
  });
});
