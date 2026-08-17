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

const { GET, POST } = await import('@/app/api/bookings/route');

describe('GET /api/bookings — organisation scoping', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a non-super_admin caller', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const req = new Request('http://localhost/api/bookings');
    const res = await GET(asNextRequest(req));
    expect(res.status).toBe(403);
  });

  it('filters strictly by the caller effective organisation, ignoring any organisation_id supplied in the URL', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    sqlMock.mockResolvedValue([{ id: 'b1', organisation_id: 'org-a' }]);

    const req = new Request('http://localhost/api/bookings?organisation_id=unrelated-org');
    const res = await GET(asNextRequest(req));
    expect(res.status).toBe(200);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const callArgs = sqlMock.mock.calls[0];
    // The template's interpolated values must include the effective org and
    // must never include the unrelated org id the caller tried to supply.
    expect(callArgs).toContain('org-a');
    expect(callArgs).not.toContain('unrelated-org');
  });
});

describe('POST /api/bookings — organisation derivation', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a non-super_admin caller', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const req = new Request('http://localhost/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'X', date: '2026-08-01', time: '10:00', session_type: 'Private' }),
    });
    const res = await POST(asNextRequest(req));
    expect(res.status).toBe(403);
  });

  it('ignores an unrestricted client-supplied organisation_id and uses the effective session organisation instead', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'real-org', role: 'super_admin', name: 'A' });
    sqlMock.mockResolvedValueOnce([{ id: 'booking-1', organisation_id: 'real-org' }]);

    const req = new Request('http://localhost/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organisation_id: 'attacker-org',
        client_name:     'Test Client',
        date:             '2026-08-01',
        time:             '10:00',
        session_type:     'Private',
      }),
    });

    const res = await POST(asNextRequest(req));
    expect(res.status).toBe(201);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toContain('real-org');
    expect(callArgs).not.toContain('attacker-org');
  });
});
