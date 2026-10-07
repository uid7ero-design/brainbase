import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), get: vi.fn(), deactivate: vi.fn(), list: vi.fn(), sql: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/commercial/auditLog', () => ({ logFinanceDimensionReactivated: mocks.audit }));
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: mocks.auth, COMMERCIAL_MIN_ROLE: { administer: 'admin' } }));
vi.mock('@/lib/commercial/budgetAccounts', () => ({ createBudgetAccount: mocks.create, getBudgetAccount: mocks.get, deactivateBudgetAccount: mocks.deactivate, listBudgetAccounts: mocks.list }));
vi.mock('@/lib/commercial/costCentres', () => ({ createCostCentre: mocks.create, getCostCentre: mocks.get, deactivateCostCentre: mocks.deactivate, listCostCentres: mocks.list }));
const route = await import('@/app/api/commercial/budgeting/setup/[kind]/route');
const deactivate = await import('@/app/api/commercial/budgeting/setup/[kind]/[id]/deactivate/route');
const reactivate = await import('@/app/api/commercial/budgeting/setup/[kind]/[id]/reactivate/route');
const id = '00000000-0000-4000-8000-000000000801';
const request = (body: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, session: { organisationId: 'org-a', userId: 'user-a' } }); });
describe.each(['accounts', 'cost-centres'])('finance setup %s', kind => {
  const context = { params: Promise.resolve({ kind, id }) };
  it.each([401, 403, 503])('preserves denial %s', async status => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    expect((await route.GET(request({}), context)).status).toBe(status);
    expect((await route.POST(request({}), context)).status).toBe(status);
    expect((await deactivate.POST(request({}), context)).status).toBe(status);
    expect((await reactivate.POST(request({}), context)).status).toBe(status);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { code: ' ', name: 'Name' }, { code: 5, name: 'Name' }, { code: 'CODE', name: 'Name', description: {} }])('rejects malformed body %j', async body => {
    expect((await route.POST(request(body), context)).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('normalizes input and uses session identity', async () => {
    mocks.create.mockResolvedValue({ id });
    expect((await route.POST(request({ code: ' CODE ', name: ' Name ', description: ' note ', organisationId: 'foreign', userId: 'foreign' }), context)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'user-a', code: 'CODE', name: 'Name', description: 'note' });
  });
  it('maps only duplicate database codes to conflict', async () => {
    mocks.create.mockRejectedValue({ code: '23505' });
    expect((await route.POST(request({ code: 'CODE', name: 'Name' }), context)).status).toBe(409);
    mocks.create.mockRejectedValue(new Error('database unavailable'));
    await expect(route.POST(request({ code: 'CODE', name: 'Name' }), context)).rejects.toThrow('database unavailable');
  });
  it('returns 404 for a foreign record without mutation', async () => {
    mocks.get.mockResolvedValue(null);
    expect((await deactivate.POST(request({}), context)).status).toBe(404); expect(mocks.deactivate).not.toHaveBeenCalled();
  });
  it('preserves inactive records on a repeated deactivation', async () => {
    mocks.get.mockResolvedValue({ id, active: false });
    expect((await deactivate.POST(request({}), context)).status).toBe(200); expect(mocks.deactivate).not.toHaveBeenCalled();
  });
  it('reports an active-budget dependency without deleting the record', async () => {
    mocks.get.mockResolvedValue({ id, active: true }); mocks.deactivate.mockResolvedValue(false);
    expect((await deactivate.POST(request({}), context)).status).toBe(409);
  });
  it('reactivates the retained tenant record and audits the actual transition', async () => {
    mocks.sql.mockResolvedValueOnce([{ id, organisation_id: 'org-a', code: 'CODE', active: true }]);
    const response = await reactivate.POST(request({ organisationId: 'foreign' }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).record).toMatchObject({ id, code: 'CODE', active: true });
    expect(mocks.sql.mock.calls[0].slice(1)).toEqual([id, 'org-a']);
    expect(mocks.sql.mock.calls[0][0].join('')).toContain('AND active=false');
    expect(mocks.audit).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'user-a', kind, id });
  });
  it('returns 404 for foreign reactivation without an audit', async () => {
    mocks.sql.mockResolvedValueOnce([]); mocks.get.mockResolvedValueOnce(null);
    expect((await reactivate.POST(request({}), context)).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('makes repeated reactivation idempotent without duplicate audit', async () => {
    mocks.sql.mockResolvedValueOnce([]); mocks.get.mockResolvedValueOnce({ id, active: true });
    expect((await reactivate.POST(request({}), context)).status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects malformed reactivation identity before querying', async () => {
    expect((await reactivate.POST(request({}), { params: Promise.resolve({kind, id:'invalid'}) })).status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
