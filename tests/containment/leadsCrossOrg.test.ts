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

describe('PATCH /api/leads/[id] — cross-organisation protection', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('a manager from Org A cannot update a lead belonging to Org B', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    // The UPDATE's WHERE clause filters by the caller's org; a lead that
    // actually belongs to org-b matches zero rows for org-a.
    sqlMock.mockResolvedValue([]);

    const res = await PATCH(patchRequest({ status: 'contacted' }), { params });
    expect(res.status).toBe(404);

    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toContain('org-a');
    expect(callArgs).not.toContain('org-b');
  });

  it('a manager can update a lead that does belong to their own org', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock.mockResolvedValue([{ id: 'lead-1', status: 'contacted', name: 'Client', email: 'c@example.com', notes: null, client_token: null }]);

    const res = await PATCH(patchRequest({ status: 'contacted' }), { params });
    expect(res.status).toBe(200);
  });
});
