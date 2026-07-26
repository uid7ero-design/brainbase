import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

type SqlCall = { strings: readonly string[]; values: unknown[] };
type SqlMock = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown[]>>>;

const sqlCallLog: SqlCall[] = [];
const sqlFn = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  sqlCallLog.push({ strings, values });
  return [];
}) as unknown as SqlMock;
vi.mock('@/lib/db', () => ({ default: sqlFn }));

const { GET } = await import('@/app/api/admin/pipeline/route');

describe('GET /api/admin/pipeline', () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    // mockClear (not mockReset) — mockReset would also wipe the factory
    // implementation set in vi.fn(async (strings, ...values) => {...}),
    // which is what populates sqlCallLog for the query-shape assertion below.
    sqlFn.mockClear();
    sqlCallLog.length = 0;
  });

  it('a super_admin receives pipeline rows when bookings is empty', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    sqlFn.mockResolvedValueOnce([
      {
        id: 'p1', type: 'request', title: 'Staging pipeline request — Org A', description: null,
        status: 'new', priority: 'medium', founder_note: null,
        created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
        organisation_id: 'org-a', org_name: 'Org A', submitted_by_name: 'Viewer A',
        messages: null, booking: null, // no booking exists for this row
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].id).toBe('p1');
    expect(body.requests[0].booking).toBeNull();
  });

  it('generates a pipeline_id/cp.id comparison that is type-compatible on both sides (::text = ::text)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    // Deliberately no mockResolvedValueOnce override here: a queued once-value
    // would bypass the factory implementation above (and its sqlCallLog push)
    // entirely, so this test lets the real factory run and return [].

    await GET();

    expect(sqlCallLog).toHaveLength(1);
    const queryText = sqlCallLog[0].strings.join('');
    // The booking subquery must compare pipeline_id and cp.id with the same
    // cast applied to both sides, so it never throws "operator does not
    // exist: uuid = text" regardless of which concrete type pipeline_id is —
    // native UUID (current staging schema) or legacy TEXT.
    expect(queryText).toContain('pipeline_id::text = cp.id::text');
    // The previous, incompatible one-sided cast must not reappear.
    expect(queryText).not.toContain('pipeline_id = cp.id::text');
  });

  it('a returned row can include its latest booking', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    sqlFn.mockResolvedValueOnce([
      {
        id: 'p1', type: 'request', title: 'Req', description: null,
        status: 'resolved', priority: 'medium', founder_note: null,
        created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
        organisation_id: 'org-a', org_name: 'Org A', submitted_by_name: 'Viewer A',
        messages: null,
        booking: { id: 'b1', date: '2026-08-01', time: '16:00', session_type: 'group', status: 'confirmed', confirmed_at: null },
      },
    ]);

    const res = await GET();
    const body = await res.json();
    expect(body.requests[0].booking).toEqual({
      id: 'b1', date: '2026-08-01', time: '16:00', session_type: 'group', status: 'confirmed', confirmed_at: null,
    });
  });

  it('a database/query error returns HTTP 500 with a generic body, not HTTP 200 with requests: []', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'super_admin', name: 'A' });
    sqlFn.mockRejectedValueOnce(new Error('operator does not exist: uuid = text'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to load pipeline' });
    // No SQL text, driver detail, or stack trace may leak into the response.
    expect(JSON.stringify(body)).not.toContain('operator does not exist');
    expect(JSON.stringify(body)).not.toContain('uuid');
  });

  it('a viewer receives 403', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(sqlFn).not.toHaveBeenCalled();
  });

  it('an unauthenticated request remains denied, per the existing (unchanged) route behaviour', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET();
    // The route's auth catch block was not modified — it still collapses
    // every requireRole() failure (Unauthorized or Forbidden) to a single
    // 403 response, so an anonymous caller is denied exactly as before.
    expect(res.status).toBe(403);
    expect(sqlFn).not.toHaveBeenCalled();
  });
});
