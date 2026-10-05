import { beforeEach, describe, expect, it, vi } from 'vitest';
const authorize = vi.fn();
const read = vi.fn();
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: (...args: unknown[]) => authorize(...args), COMMERCIAL_MIN_ROLE: { view: 'viewer' } }));
vi.mock('@/lib/commercial/supplierApOverview', () => ({ getSupplierApOverview: (...args: unknown[]) => read(...args) }));
const { GET } = await import('@/app/api/commercial/purchasing/ap-overview/route');
beforeEach(() => { authorize.mockReset(); read.mockReset(); authorize.mockResolvedValue({ ok: true, session: { organisationId: 'org-a' } }); });
describe('AP overview HTTP', () => {
  it('validates the historical basis and retains tenant/date/filter scoping', async () => {
    read.mockResolvedValue({balance_basis:'HISTORICAL_RECORDED_BALANCE',as_of_timezone:'UTC'});
    const response = await GET(new Request('http://localhost/?aging_date=2026-10-03&balance_basis=HISTORICAL_RECORDED_BALANCE&organisationId=other&page=2'));
    expect(response.status).toBe(200); expect(read).toHaveBeenCalledWith('org-a','2026-10-03',expect.objectContaining({page:2}),'HISTORICAL_RECORDED_BALANCE');
    expect((await response.json()).report.as_of_timezone).toBe('UTC');
  });
  it('rejects an unsupported balance basis before reading', async () => {
    expect((await GET(new Request('http://localhost/?aging_date=2026-10-03&balance_basis=OTHER'))).status).toBe(400); expect(read).not.toHaveBeenCalled();
  });
  it('returns a controlled 409 when history timestamps are incomplete', async () => {
    read.mockRejectedValue(new Error('Supplier AP history is incomplete'));
    const response = await GET(new Request('http://localhost/?aging_date=2026-10-03&balance_basis=HISTORICAL_RECORDED_BALANCE'));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('AP_HISTORY_INCOMPLETE'); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
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
    expect(read).toHaveBeenCalledWith('org-a', '2026-10-05', { search: '', currency: null, supplierId: null, bucket: null, page: 1, supplierPage: 1, pageSize: 50 }); expect(await res.json()).toEqual({ report: { currencies: [] } });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('maps invariant/database failures without exposing internal details', async () => {
    read.mockRejectedValue(new Error('private database details'));
    const res = await GET(new Request('http://localhost/?aging_date=2026-10-05'));
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain('private');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each(['page=0','page=-1','page=1.5','page=1e3','page=1000001','supplier_page=0','page_size=101','page_size=0','currency=aud','supplier_id=other','bucket=OTHER', `search=${'a'.repeat(201)}`])('rejects invalid filters %s before a read', async query => {
    const res = await GET(new Request(`http://localhost/?aging_date=2026-10-05&${query}`));
    expect(res.status).toBe(400); expect(read).not.toHaveBeenCalled(); expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('passes validated paging and filters without trusting a client tenant', async () => {
    const id = '00000000-0000-0000-0000-000000000101';
    read.mockResolvedValue({});
    await GET(new Request(`http://localhost/?aging_date=2026-10-05&search=INV&currency=AUD&supplier_id=${id}&bucket=DAYS_1_30&page=2&supplier_page=3&page_size=20&organisationId=hostile`));
    expect(read).toHaveBeenCalledWith('org-a','2026-10-05',{ search:'INV', currency:'AUD', supplierId:id, bucket:'DAYS_1_30', page:2, supplierPage:3, pageSize:20 });
  });
});
