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

const { PATCH } = await import('@/app/api/bookings/[id]/route');

function patchRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/bookings/booking-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const params = Promise.resolve({ id: 'booking-1' });

const sameOrgBooking = {
  id: 'booking-1', organisation_id: 'org-a', pipeline_id: null, session_id: 'sess-1',
  date: '2026-08-20', time: '18:00', session_type: 'Group', status: 'confirmed',
  paid: false, attendance_status: null,
};

// Documents current, verified behaviour of PATCH /api/bookings/[id]: the
// `paid` / `attendance_status` fields are gated to super_admin specifically,
// on top of (not replaced by) the outer requireRole('viewer') + org check.
// This means a `manager` — the role LD Tennis's coach is being assigned —
// currently CANNOT mark a booking paid or set attendance through this route,
// even for a booking in their own organisation. dashboard/sessions/page.tsx
// calls exactly this endpoint for both actions. Flagged in the handoff
// report as a product decision, not silently fixed here (this route is
// shared across every tenant on the platform, not LD Tennis-specific).
describe('PATCH /api/bookings/[id] — paid/attendance role gate (documents current behaviour)', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('rejects a manager setting `paid` on a booking in their own organisation', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ paid: true }), { params });
    expect(res.status).toBe(403);
    // Only the initial SELECT ran — no UPDATE was attempted.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a manager setting `attendance_status` on a booking in their own organisation', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ attendance_status: 'attended' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('allows a super_admin to set `paid` on a booking', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]).mockResolvedValueOnce([]);

    const res = await PATCH(patchRequest({ paid: true }), { params });
    expect(res.status).toBe(200);
  });

  it('still allows a manager to confirm a booking in their own org (the non-paid/attendance action path)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    // Must not already be confirmed/cancelled, or the route 409s regardless of role.
    sqlMock.mockResolvedValueOnce([{ ...sameOrgBooking, status: 'pending' }]).mockResolvedValueOnce([]);

    const res = await PATCH(patchRequest({ action: 'confirm' }), { params });
    expect(res.status).toBe(200);
  });

  it('rejects a manager from a different org from confirming someone else\'s booking', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-b', role: 'manager', name: 'Other' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]); // booking belongs to org-a

    const res = await PATCH(patchRequest({ action: 'confirm' }), { params });
    expect(res.status).toBe(403);
  });
});
