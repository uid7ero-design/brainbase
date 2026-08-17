import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const { POST } = await import('@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route');

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions/sess-1/instances/inst-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const params = Promise.resolve({ id: 'sess-1', instanceId: 'inst-1' });

// This is the actual route app/dashboard/sessions/page.tsx calls when a
// coach enrols a client into a session instance (not the unused
// /api/dashboard/enrolments index route) — the highest-value cross-org
// check for the real enrolment path.
describe('POST /api/dashboard/sessions/[id]/instances/[instanceId] — cross-organisation protection', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await POST(postRequest({ client_name: 'Test Client' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a manager from Org A cannot enrol into a session instance belonging to Org B', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    // Ownership join filters by org-a; an org-b instance matches nothing.
    sqlMock.mockResolvedValueOnce([]);

    const res = await POST(postRequest({ client_name: 'Test Client' }), { params });
    expect(res.status).toBe(404);
    // No booking insert was attempted after the failed ownership check.
    expect(sqlMock).toHaveBeenCalledTimes(1);

    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toContain('org-a');
  });

  it('a manager can enrol into their own org session instance when capacity allows', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock
      .mockResolvedValueOnce([{ id: 'inst-1', max_capacity: 8, date: '2026-08-20', start_time: '18:00', session_type: 'Group' }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([{ id: 'booking-1', client_name: 'Test Client', client_email: null, paid: false, attendance_status: null, status: 'confirmed', pipeline_id: null, is_recurring: false, recurring_group_id: null, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ client_name: 'Test Client' }), { params });
    expect(res.status).toBe(201);
  });

  it('rejects enrolment once the instance is at capacity', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock
      .mockResolvedValueOnce([{ id: 'inst-1', max_capacity: 4, date: '2026-08-20', start_time: '18:00', session_type: 'Group' }])
      .mockResolvedValueOnce([{ cnt: 4 }]);

    const res = await POST(postRequest({ client_name: 'Test Client' }), { params });
    expect(res.status).toBe(409);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
