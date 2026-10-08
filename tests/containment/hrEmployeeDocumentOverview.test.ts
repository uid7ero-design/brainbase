import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/hr/employeeDocumentHttp', () => ({ requireEmployeeDocumentContext: mocks.context }));
const { loadEmployeeDocumentOverview } = await import('@/lib/hr/employeeDocumentOverview');
const { GET } = await import('@/app/api/hr/documents/overview/route');
const session = { userId: 'employee-a', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'viewer' as const, name: 'Employee' };
const row = { person_id: 'person-a', first_name: 'Alex', last_name: 'Worker', documents: 4, missing_version: 1, pending_acknowledgement: 2, unlinked_employee: 0, pending_verification: 1, rejected: 1, expired: 1, expiring_soon: 1 };
beforeEach(() => {
  mocks.sql.mockReset(); mocks.context.mockReset();
  mocks.sql.mockResolvedValue([row]);
  mocks.context.mockResolvedValue({ ok: true, session });
});
describe('employee document overview boundary', () => {
  it('scopes the single aggregate to the active org and document authority, excluding manager grants', async () => {
    await loadEmployeeDocumentOverview(session);
    const [strings, ...values] = mocks.sql.mock.calls[0];
    const query = strings.join('?');
    expect(query).toContain('WHERE p.organisation_id = ?');
    expect(query).toContain('p.linked_user_id = ?');
    expect(query).toContain('administrator.organisation_id = p.organisation_id AND administrator.user_id = ?');
    expect(query).not.toMatch(/manager|assigned_user/i);
    expect(values.slice(-4)).toEqual(['org-a', false, 'employee-a', 'employee-a']);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
  it('retains active org scope for the established super-admin bypass', async () => {
    await loadEmployeeDocumentOverview({ ...session, role: 'super_admin' });
    expect(mocks.sql.mock.calls[0].slice(-4)).toEqual(['org-a', true, 'employee-a', 'employee-a']);
  });
  it('isolates live documents, current versions and same-org evidence with deterministic latest verification', async () => {
    await loadEmployeeDocumentOverview(session);
    const query = mocks.sql.mock.calls[0][0].join('?');
    for (const clause of ['d.organisation_id = p.organisation_id', 'd.deleted_at IS NULL', 'v.organisation_id = d.organisation_id', 'v.is_current = TRUE', 'acknowledgement.organisation_id = p.organisation_id', 'acknowledgement.acknowledged_by = p.linked_user_id', 'check_record.organisation_id = p.organisation_id', 'check_record.verified_at DESC, check_record.created_at DESC, check_record.id DESC']) expect(query).toContain(clause);
    expect(query).not.toMatch(/storage_key|original_filename|byte_size|comments|restricted|reminder|audit/i);
  });
  it('uses UTC calendar boundaries including today and the thirtieth day in upcoming expiry', async () => {
    const result = await loadEmployeeDocumentOverview(session, new Date('2026-10-08T23:59:59Z'));
    expect(result.as_of_date).toBe('2026-10-08'); expect(result.expiring_through).toBe('2026-11-07');
    expect(mocks.sql.mock.calls[0].slice(1, 4)).toEqual(['2026-10-08', '2026-10-08', '2026-11-07']);
    expect(mocks.sql.mock.calls[0][0].join('?')).toContain('v.expires_at >= ?::date AND v.expires_at <= ?::date');
  });
  it('allowlists counts and names without exposing additional query metadata', async () => {
    mocks.sql.mockResolvedValue([{ ...row, storage_key: 'secret' }]);
    expect((await loadEmployeeDocumentOverview(session)).people).toEqual([row]);
  });
  it('returns an empty scoped result without inventing totals', async () => {
    mocks.sql.mockResolvedValue([]);
    expect((await loadEmployeeDocumentOverview(session)).people).toEqual([]);
  });
  it.each([401, 403, 503])('preserves non-cacheable context denial %s without reading', async status => {
    mocks.context.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Denied' }, { status }) });
    const response = await GET();
    expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('returns non-cacheable success using the trusted session', async () => {
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).people).toEqual([row]);
  });
  it('fails generically on a failed read or malformed count, never returning partial data', async () => {
    mocks.sql.mockRejectedValueOnce(new Error('database secret'));
    expect(await (await GET()).json()).toEqual({ error: 'Unable to load document overview.' });
    mocks.sql.mockResolvedValue([{ ...row, expired: -1 }]);
    expect((await GET()).status).toBe(503);
  });
});
