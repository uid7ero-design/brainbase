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

const { PATCH } = await import('@/app/api/dashboard/sessions/[id]/route');

function patchRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions/sess-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const params = Promise.resolve({ id: 'sess-1' });

describe('PATCH /api/dashboard/sessions/[id] — role + cross-organisation protection', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a caller below manager (e.g. viewer)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await PATCH(patchRequest({ name: 'Tuesday Cardio' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a manager from Org A cannot edit a session belonging to Org B', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    // WHERE id = ... AND organisation_id = 'org-a' matches nothing for an
    // org-b session.
    sqlMock.mockResolvedValue([]);

    const res = await PATCH(patchRequest({ name: 'Tuesday Cardio' }), { params });
    expect(res.status).toBe(404);

    // The route also issues a nested `sql`resource_id`` fragment call when
    // resource_id is omitted from the body, so check across all calls rather
    // than assuming the UPDATE is call #0.
    const sawOrgA = sqlMock.mock.calls.some(call => call.includes('org-a'));
    expect(sawOrgA).toBe(true);
  });

  it('a manager can edit a session that belongs to their own org', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock.mockResolvedValue([{
      id: 'sess-1', name: 'Tuesday Cardio', day_of_week: 2, start_time: '18:00',
      duration_minutes: 60, max_capacity: 8, session_type: 'Group', resource_id: null,
      recurring: true, price_per_session: 25, created_at: new Date().toISOString(),
    }]);

    const res = await PATCH(patchRequest({ name: 'Tuesday Cardio' }), { params });
    expect(res.status).toBe(200);
  });
});
