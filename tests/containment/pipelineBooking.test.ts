import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

type SqlMock = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown[]>>> & {
  transaction: ReturnType<typeof vi.fn>;
  unsafe: ReturnType<typeof vi.fn>;
};

const sqlCallLog: unknown[][] = [];
const sqlFn = vi.fn(async (...args: unknown[]) => {
  sqlCallLog.push(args);
  return [];
}) as unknown as SqlMock;
sqlFn.transaction = vi.fn();
sqlFn.unsafe = vi.fn((s: string) => s);

vi.mock('@/lib/db', () => ({ default: sqlFn }));

const { POST } = await import('@/app/api/admin/pipeline/[id]/booking/route');

function bookingRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/admin/pipeline/p1/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/admin/pipeline/[id]/booking', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlFn.mockClear();
    sqlFn.transaction.mockReset();
    sqlCallLog.length = 0;
  });

  it('denies a non-super_admin caller', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await POST(bookingRequest({ client_name: 'X', session_instance_id: 'inst-1' }), paramsFor('p1'));
    expect(res.status).toBe(403);
    expect(sqlFn.transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the pipeline record does not exist, before any write', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'irrelevant', role: 'super_admin', name: 'A' });
    sqlFn.mockResolvedValueOnce([]); // pipeline lookup returns nothing

    const res = await POST(bookingRequest({ client_name: 'X', session_instance_id: 'inst-1' }), paramsFor('missing-pipeline'));
    expect(res.status).toBe(404);
    expect(sqlFn.transaction).not.toHaveBeenCalled();
  });

  it('derives the organisation strictly from the pipeline record, ignoring any body-supplied organisation/pipeline id', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'caller-org', role: 'super_admin', name: 'A' });

    sqlFn
      .mockResolvedValueOnce([{ id: 'p1', organisation_id: 'org-a', title: 'Req', status: 'new' }]) // pipeline lookup
      .mockResolvedValueOnce([{ id: 'inst-1', session_id: 'sess-1', date: '2026-08-01', start_time: '10:00', duration_minutes: 60, max_capacity: 4, name: 'Group', session_type: 'Group Lesson', day_of_week: 6 }]) // instance lookup
      .mockResolvedValueOnce([{ count: 0 }]); // enrolled count

    sqlFn.transaction.mockResolvedValueOnce([
      [{ id: 'booking-1', date: '2026-08-01', time: '10:00', session_type: 'Group Lesson', status: 'confirmed', confirmed_at: null }],
      [],
      [],
    ]);

    const res = await POST(bookingRequest({
      client_name: 'Client X',
      session_instance_id: 'inst-1',
      // Neither of these fields is read anywhere by the route — they must
      // have zero effect on which organisation the booking is scoped to.
      organisation_id: 'attacker-org',
      pipeline_id: 'some-other-pipeline',
    }), paramsFor('p1'));

    expect(res.status).toBe(201);

    // Every SQL call (pipeline lookup, instance lookup, enrolled count) and
    // the transaction batch must only ever reference the derived org — the
    // attacker-supplied value never appears anywhere.
    const allArgs = [...sqlCallLog.flat(), ...sqlFn.transaction.mock.calls.flat(2)];
    expect(JSON.stringify(allArgs)).not.toContain('attacker-org');
    expect(JSON.stringify(allArgs)).not.toContain('some-other-pipeline');
  });

  it('rejects a session instance belonging to a different organisation than the pipeline (mismatched relationship)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'caller-org', role: 'super_admin', name: 'A' });

    sqlFn
      .mockResolvedValueOnce([{ id: 'p1', organisation_id: 'org-a', title: 'Req', status: 'new' }]) // pipeline belongs to org-a
      .mockResolvedValueOnce([]); // instance lookup scoped to org-a finds nothing, because the real instance belongs to org-b

    const res = await POST(bookingRequest({
      client_name: 'Client X',
      session_instance_id: 'org-b-instance',
    }), paramsFor('p1'));

    expect(res.status).toBe(404);
    expect(sqlFn.transaction).not.toHaveBeenCalled();
  });

  it('cannot substitute a different pipeline\'s organisation via any request field — only the URL id resolves the org', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'caller-org', role: 'super_admin', name: 'A' });

    // p1 resolves to org-a regardless of what the body claims.
    sqlFn
      .mockResolvedValueOnce([{ id: 'p1', organisation_id: 'org-a', title: 'Req', status: 'new' }])
      .mockResolvedValueOnce([{ id: 'inst-1', session_id: 'sess-1', date: '2026-08-01', start_time: '10:00', duration_minutes: 60, max_capacity: 4, name: 'Group', session_type: 'Group Lesson', day_of_week: 6 }])
      .mockResolvedValueOnce([{ count: 0 }]);
    sqlFn.transaction.mockResolvedValueOnce([
      [{ id: 'booking-1', date: '2026-08-01', time: '10:00', session_type: 'Group Lesson', status: 'confirmed', confirmed_at: null }],
      [], [],
    ]);

    await POST(bookingRequest({ client_name: 'X', session_instance_id: 'inst-1', pipeline_id: 'p2' }), paramsFor('p1'));

    // The instance lookup must have been scoped to org-a (p1's org), never p2's.
    const instanceLookupArgs = sqlCallLog[1];
    expect(JSON.stringify(instanceLookupArgs)).toContain('org-a');
  });

  it('creates no partial booking or pipeline update when the transaction itself fails', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'caller-org', role: 'super_admin', name: 'A' });

    sqlFn
      .mockResolvedValueOnce([{ id: 'p1', organisation_id: 'org-a', title: 'Req', status: 'new' }])
      .mockResolvedValueOnce([{ id: 'inst-1', session_id: 'sess-1', date: '2026-08-01', start_time: '10:00', duration_minutes: 60, max_capacity: 4, name: 'Group', session_type: 'Group Lesson', day_of_week: 6 }])
      .mockResolvedValueOnce([{ count: 0 }]);
    sqlFn.transaction.mockRejectedValueOnce(new Error('transaction aborted'));

    const res = await POST(bookingRequest({ client_name: 'X', session_instance_id: 'inst-1' }), paramsFor('p1'));

    expect(res.status).toBe(500);
    // The booking insert, pipeline status update, and message insert were all
    // submitted together as a single failed transaction call — never as
    // separate, independently-committable statements.
    expect(sqlFn.transaction).toHaveBeenCalledTimes(1);
    const submittedOps = sqlFn.transaction.mock.calls[0][0];
    expect(submittedOps).toHaveLength(3);
  });

  it('rejects the one-off flow with a spoofed organisation_id in the same way', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'caller-org', role: 'super_admin', name: 'A' });
    sqlFn.mockResolvedValueOnce([{ id: 'p1', organisation_id: 'org-a', title: 'Req', status: 'new' }]);
    sqlFn.transaction.mockResolvedValueOnce([
      [],
      [{ id: 'booking-2', date: '2026-08-01', time: '10:00', session_type: 'Private Lesson', status: 'pending_confirmation', confirmed_at: null }],
      [], [],
    ]);

    const res = await POST(bookingRequest({
      client_name: 'X', date: '2026-08-01', time: '10:00', session_type: 'Private Lesson',
      organisation_id: 'attacker-org',
    }), paramsFor('p1'));

    expect(res.status).toBe(201);
    const submittedOps = sqlFn.transaction.mock.calls[0][0];
    expect(JSON.stringify(submittedOps)).not.toContain('attacker-org');
  });
});

describe('No impersonation endpoint or cookie mutation is used by the booking flow', () => {
  it('the dedicated booking route never calls the impersonation endpoint or sets/reads the org_override cookie', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../../app/api/admin/pipeline/[id]/booking/route.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('/api/admin/impersonate');
    expect(source).not.toContain("'org_override'");
    expect(source).not.toContain('cookies(');
  });

  it('the admin pipeline console page no longer calls the impersonation endpoint or the withOrgOverride helper', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../../app/admin/pipeline/page.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('/api/admin/impersonate');
    expect(source).not.toContain('withOrgOverride');
    // The page must call the dedicated per-pipeline endpoint instead.
    expect(source).toContain('/booking');
  });
});
