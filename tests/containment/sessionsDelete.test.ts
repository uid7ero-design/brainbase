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

const findFirstMock = vi.fn();
const transactionMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findFirst: (...args: unknown[]) => findFirstMock(...args), deleteMany: vi.fn() },
    sessionInstance: { deleteMany: vi.fn() },
    booking: { deleteMany: vi.fn() },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const { DELETE } = await import('@/app/api/dashboard/sessions/[id]/route');

describe('DELETE /api/dashboard/sessions/[id] — cross-organisation protection', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    findFirstMock.mockReset();
    transactionMock.mockReset();
  });

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await DELETE(asNextRequest(new Request('http://localhost/x')), { params: Promise.resolve({ id: 'sess-1' }) });
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('a manager from Organisation A cannot delete a session (and its instances/bookings) belonging to Organisation B', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    // The ownership pre-check queries WHERE organisation_id = 'org-a' — a
    // session that actually belongs to org-b is correctly not found for org-a.
    findFirstMock.mockResolvedValue(null);

    const res = await DELETE(asNextRequest(new Request('http://localhost/x')), { params: Promise.resolve({ id: 'org-b-session' }) });

    expect(res.status).toBe(404);
    // No mutation of any kind was attempted — ownership is verified strictly
    // before any child or parent row is touched.
    expect(transactionMock).not.toHaveBeenCalled();
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org-b-session', organisation_id: 'org-a' } }),
    );
  });

  it('deletes bookings, instances, and the session in a single transaction when ownership is verified', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    findFirstMock.mockResolvedValue({ id: 'sess-1' });
    transactionMock.mockResolvedValue([{ count: 2 }, { count: 1 }, { count: 1 }]);

    const res = await DELETE(asNextRequest(new Request('http://localhost/x')), { params: Promise.resolve({ id: 'sess-1' }) });

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    // All three operations were submitted together as one atomic batch.
    const submittedOps = transactionMock.mock.calls[0][0];
    expect(submittedOps).toHaveLength(3);
  });

  it('returns a failure and deletes nothing if the transaction itself rejects', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    findFirstMock.mockResolvedValue({ id: 'sess-1' });
    transactionMock.mockRejectedValue(new Error('transaction failed'));

    const res = await DELETE(asNextRequest(new Request('http://localhost/x')), { params: Promise.resolve({ id: 'sess-1' }) });
    expect(res.status).toBe(500);
  });
});
