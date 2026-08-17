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

const { POST } = await import('@/app/api/dashboard/enrolments/route');

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/enrolments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const validBody = { session_instance_id: 'inst-1', contact_id: 'contact-1' };

describe('POST /api/dashboard/enrolments — role + cross-organisation protection', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
  });

  it('denies a caller below manager (e.g. viewer)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects enrolling a contact that belongs to a different org, before touching sessions', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    // Contact lookup filtered by org-a finds nothing — the contact is org-b's.
    sqlMock.mockResolvedValueOnce([]);

    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Contact not found');
    // No further lookups or inserts were attempted.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects enrolling into a session instance that belongs to a different org', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock
      .mockResolvedValueOnce([{ id: 'contact-1', name: 'Client', email: 'c@example.com' }]) // contact found in org-a
      .mockResolvedValueOnce([]); // instance lookup filtered by org-a finds nothing — it's org-b's

    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Instance not found');
    // No booking insert was attempted after the failed ownership check.
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('enrols successfully when both the contact and instance belong to the caller org', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    sqlMock
      .mockResolvedValueOnce([{ id: 'contact-1', name: 'Client', email: 'c@example.com' }])
      .mockResolvedValueOnce([{ id: 'inst-1', session_id: 'sess-1', max_capacity: 8, enrolled: 2, date: '2026-08-20', start_time: '18:00', session_type: 'Group' }])
      .mockResolvedValueOnce([{ id: 'booking-1', client_name: 'Client', client_email: 'c@example.com', paid: false, attendance_status: null, status: 'confirmed', pipeline_id: null, is_recurring: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(201);
  });
});
