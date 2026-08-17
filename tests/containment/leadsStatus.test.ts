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

const { PATCH } = await import('@/app/api/leads/[id]/route');

function patchRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/leads/lead-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const params = Promise.resolve({ id: 'lead-1' });

describe('PATCH /api/leads/[id] — role gating and cancelled status', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a caller with no session', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await PATCH(patchRequest({ status: 'cancelled' }), { params });
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('allows a manager (LD Tennis coach role) to set status to cancelled', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'ld-tennis-org', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValue([{ id: 'lead-1', status: 'cancelled', name: 'Client', email: 'c@example.com', notes: null, client_token: null }]);

    const res = await PATCH(patchRequest({ status: 'cancelled', note: '' }), { params });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('cancelled');

    // Scoped to the caller's organisation, not an arbitrary one.
    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toContain('ld-tennis-org');
  });

  it('still rejects an invalid status (no regression from the new option)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'ld-tennis-org', role: 'manager', name: 'Luke' });
    const res = await PATCH(patchRequest({ status: 'approved' }), { params });
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('still allows the existing booked status (no regression to prior behaviour)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'ld-tennis-org', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValue([{ id: 'lead-1', status: 'booked', name: 'Client', email: 'c@example.com', notes: null, client_token: null }]);

    const res = await PATCH(patchRequest({ status: 'booked' }), { params });
    expect(res.status).toBe(200);
  });
});
