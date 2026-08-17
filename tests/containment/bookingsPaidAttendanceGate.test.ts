import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireRole: (...args: unknown[]) => requireRoleMock(...args) };
});

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

// Intended policy for PATCH /api/bookings/[id]'s `paid` / `attendance_status`
// fields: manager and above, own organisation only. Verified via
// investigation (git blame, the route's origin commit message, and the
// dashboard UI) that super_admin-only was never a deliberate financial/
// security decision — it was the route's default from creation, with no
// role gating in the calling UI (dashboard/sessions/page.tsx renders these
// controls to any viewer of the page) and no later commit ever revisiting
// it. `roleGte` (the same helper used by requireRole) now backs this check
// instead of an exact super_admin match — no new role mechanism introduced.
describe('PATCH /api/bookings/[id] — paid/attendance role gate (manager and above, own org only)', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  // A
  it('allows a same-org manager to set `paid`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]).mockResolvedValueOnce([]);

    const res = await PATCH(patchRequest({ paid: true }), { params });
    expect(res.status).toBe(200);
  });

  // B
  it('allows a same-org manager to set `attendance_status`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]).mockResolvedValueOnce([]);

    const res = await PATCH(patchRequest({ attendance_status: 'attended' }), { params });
    expect(res.status).toBe(200);
  });

  // C
  it('rejects a same-org viewer setting `paid`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ paid: true }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1); // only the SELECT — no UPDATE attempted
  });

  // D
  it('rejects a same-org viewer setting `attendance_status`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ attendance_status: 'attended' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  // E
  it('rejects a cross-org manager setting `paid`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-b', role: 'manager', name: 'Other' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]); // booking belongs to org-a

    const res = await PATCH(patchRequest({ paid: true }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  // F
  it('rejects a cross-org manager setting `attendance_status`', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-b', role: 'manager', name: 'Other' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ attendance_status: 'attended' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  // G
  it('still allows a super_admin to set `paid` and `attendance_status`, cross-org included', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]).mockResolvedValueOnce([]); // booking belongs to org-a, caller is bb-org

    const res = await PATCH(patchRequest({ paid: true, attendance_status: 'attended' }), { params });
    expect(res.status).toBe(200);
  });

  // H
  it('still allows a manager to confirm a booking in their own org (the non-paid/attendance action path)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' });
    // Must not already be confirmed/cancelled, or the route 409s regardless of role.
    sqlMock.mockResolvedValueOnce([{ ...sameOrgBooking, status: 'pending' }]).mockResolvedValueOnce([]);

    const res = await PATCH(patchRequest({ action: 'confirm' }), { params });
    expect(res.status).toBe(200);
  });

  it('rejects a manager from a different org from confirming someone else\'s booking (unchanged)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-b', role: 'manager', name: 'Other' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]); // booking belongs to org-a

    const res = await PATCH(patchRequest({ action: 'confirm' }), { params });
    expect(res.status).toBe(403);
  });

  it('rejects a same-org viewer from setting attendance_status even without paid present (regression check)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ attendance_status: null }), { params });
    expect(res.status).toBe(403);
  });
});

// I: no attendance_status value whitelist exists in this route today (any
// string or null is accepted and written as-is) — there is nothing to test
// for rejection. Documented in the handoff report rather than fabricated
// here, since adding new input validation is outside this checkpoint's
// narrowly-scoped permission fix.

// Task 5 — mixed-payload privilege-escalation review: the paid/attendance
// branch is a strict early return (`if ('paid' in body || 'attendance_status'
// in body) { ...; return }`) that always runs before the action-based branch
// below it. A viewer cannot smuggle a restricted field through by pairing it
// with an otherwise-allowed field/action — the restricted-field branch claims
// the request first and the unrelated field is simply never read.
describe('PATCH /api/bookings/[id] — mixed-payload privilege escalation review', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('a viewer cannot bypass the paid/attendance gate by also including an allowed action', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([{ ...sameOrgBooking, status: 'pending' }]);

    const res = await PATCH(patchRequest({ paid: true, action: 'confirm' }), { params });
    expect(res.status).toBe(403);
    // No UPDATE of any kind — neither the paid field nor the confirm action — was applied.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('a viewer cannot bypass the gate by pairing attendance_status with an unrelated allowed field', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([{ ...sameOrgBooking, status: 'pending' }]);

    const res = await PATCH(patchRequest({ attendance_status: 'attended', message: 'please confirm', action: 'confirm' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('unsupported/unknown fields in the body do not grant a viewer access to paid', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'V' });
    sqlMock.mockResolvedValueOnce([sameOrgBooking]);

    const res = await PATCH(patchRequest({ paid: true, role: 'super_admin', organisation_id: 'org-a' }), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
