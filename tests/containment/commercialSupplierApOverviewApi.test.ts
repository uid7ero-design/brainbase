import { beforeEach, describe, expect, it, vi } from 'vitest';
const authorize = vi.fn();
const read = vi.fn();
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: (...args: unknown[]) => authorize(...args), COMMERCIAL_MIN_ROLE: { view: 'viewer' } }));
vi.mock('@/lib/commercial/supplierApOverview', () => ({ getSupplierApOverview: (...args: unknown[]) => read(...args) }));
const { GET } = await import('@/app/api/commercial/purchasing/ap-overview/route');
beforeEach(() => { authorize.mockReset(); read.mockReset(); authorize.mockResolvedValue({ ok: true, session: { organisationId: 'org-a' } }); });
describe('AP overview HTTP', () => {
  it('denies before any reads and disables caching', async () => {
    authorize.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await GET(new Request('http://localhost/?aging_date=2026-10-05'));
    expect(res.status).toBe(403); expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(authorize).toHaveBeenCalledWith('purchasing', 'viewer'); expect(read).not.toHaveBeenCalled();
  });
  it.each(['', '?aging_date=2026-02-29', '?aging_date=2026-10-05T12:00:00Z'])('rejects missing or invalid date %s', async query => {
    const res = await GET(new Request(`http://localhost/${query}`));
    expect(res.status).toBe(400); expect(res.headers.get('Cache-Control')).toBe('no-store'); expect(read).not.toHaveBeenCalled();
  });
  it('uses the session tenant and returns a no-store read', async () => {
    read.mockResolvedValue({ currencies: [] });
    const res = await GET(new Request('http://localhost/?aging_date=2026-10-05&organisationId=other'));
    expect(read).toHaveBeenCalledWith('org-a', '2026-10-05'); expect(await res.json()).toEqual({ report: { currencies: [] } });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('maps invariant/database failures without exposing internal details', async () => {
    read.mockRejectedValue(new Error('private database details'));
    const res = await GET(new Request('http://localhost/?aging_date=2026-10-05'));
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain('private');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
