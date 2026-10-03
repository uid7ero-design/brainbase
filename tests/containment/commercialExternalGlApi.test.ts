import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const createMappingMock = vi.fn();
const retireMappingMock = vi.fn();
const listMappingsMock = vi.fn();
const createCostCentreMappingMock = vi.fn();
const retireCostCentreMappingMock = vi.fn();
const listCostCentreMappingsMock = vi.fn();
const importEntryMock = vi.fn();
const listSourcesMock = vi.fn();
class MockExternalGlError extends Error { constructor(public code: string, message: string) { super(message); } }
vi.mock('@/lib/commercial/externalGl', () => ({
  createExternalGlAccountMapping: (...args: unknown[]) => createMappingMock(...args),
  retireExternalGlAccountMapping: (...args: unknown[]) => retireMappingMock(...args),
  listExternalGlAccountMappings: (...args: unknown[]) => listMappingsMock(...args),
  createExternalGlCostCentreMapping: (...args: unknown[]) => createCostCentreMappingMock(...args),
  retireExternalGlCostCentreMapping: (...args: unknown[]) => retireCostCentreMappingMock(...args),
  listExternalGlCostCentreMappings: (...args: unknown[]) => listCostCentreMappingsMock(...args),
  importExternalGlEntry: (...args: unknown[]) => importEntryMock(...args),
  listExternalGlSourceSystemIds: (...args: unknown[]) => listSourcesMock(...args),
  ExternalGlError: MockExternalGlError,
}));

const mappingsRoute = await import('@/app/api/commercial/budgeting/external-gl/mappings/route');
const retireRoute = await import('@/app/api/commercial/budgeting/external-gl/mappings/[id]/retire/route');
const costCentreMappingsRoute = await import('@/app/api/commercial/budgeting/external-gl/cost-centre-mappings/route');
const retireCostCentreMappingRoute = await import('@/app/api/commercial/budgeting/external-gl/cost-centre-mappings/[id]/retire/route');
const entriesRoute = await import('@/app/api/commercial/budgeting/external-gl/entries/route');
const sourcesRoute = await import('@/app/api/commercial/budgeting/external-gl/sources/route');

const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'mapping-1' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  createMappingMock.mockReset();
  retireMappingMock.mockReset();
  listMappingsMock.mockReset();
  createCostCentreMappingMock.mockReset();
  retireCostCentreMappingMock.mockReset();
  listCostCentreMappingsMock.mockReset();
  importEntryMock.mockReset();
  listSourcesMock.mockReset();
});

describe('C7.9D/C7.9F — external GL APIs', () => {
  it.each([401, 403, 503])('preserves mapping authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await mappingsRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(status);
    expect(createMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves mapping-list authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await mappingsRoute.GET(new Request('http://localhost'));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(listMappingsMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves cost-centre mapping-list authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await costCentreMappingsRoute.GET(new Request('http://localhost'));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(listCostCentreMappingsMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves mapping-retire authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await retireRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }), ctx);
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(retireMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves cost-centre mapping authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await costCentreMappingsRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(createCostCentreMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves cost-centre mapping-retire authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await retireCostCentreMappingRoute.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }),
      ctx,
    );
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(retireCostCentreMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves entry-import authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await entriesRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(importEntryMock).not.toHaveBeenCalled();
  });

  it('lists account mappings under admin auth using session tenant and explicit filters', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listMappingsMock.mockResolvedValue([{
      id: 'mapping-1',
      source_system_id: 'xero',
      external_gl_account_code: '600',
      budget_account_code: 'OPEX',
      budget_account_name: 'Operating costs',
      status: 'ACTIVE',
    }]);

    const response = await mappingsRoute.GET(new Request(
      'http://localhost?organisationId=org-b&sourceSystemId=xero&status=ACTIVE',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      mappings: [{
        id: 'mapping-1',
        source_system_id: 'xero',
        external_gl_account_code: '600',
        budget_account_code: 'OPEX',
        budget_account_name: 'Operating costs',
        status: 'ACTIVE',
      }],
    });
    expect(listMappingsMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      sourceSystemId: 'xero',
      status: 'ACTIVE',
    });
  });

  it('lists cost-centre mappings under admin auth using session tenant and explicit filters', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listCostCentreMappingsMock.mockResolvedValue([{
      id: 'cc-mapping-1',
      source_system_id: 'xero',
      external_cost_centre_code: 'OPS-EXT',
      cost_centre_code: 'OPS',
      cost_centre_name: 'Operations',
      status: 'RETIRED',
    }]);

    const response = await costCentreMappingsRoute.GET(new Request(
      'http://localhost?organisationId=org-b&sourceSystemId=xero&status=RETIRED',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      mappings: [{
        id: 'cc-mapping-1',
        source_system_id: 'xero',
        external_cost_centre_code: 'OPS-EXT',
        cost_centre_code: 'OPS',
        cost_centre_name: 'Operations',
        status: 'RETIRED',
      }],
    });
    expect(listCostCentreMappingsMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      sourceSystemId: 'xero',
      status: 'RETIRED',
    });
  });

  it('rejects invalid account and cost-centre mapping status filters without querying mappings', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });

    const accountResponse = await mappingsRoute.GET(new Request(
      'http://localhost?status=UNKNOWN',
    ));
    const costCentreResponse = await costCentreMappingsRoute.GET(new Request(
      'http://localhost?status=UNKNOWN',
    ));

    expect(accountResponse.status).toBe(400);
    expect(costCentreResponse.status).toBe(400);
    expect(listMappingsMock).not.toHaveBeenCalled();
    expect(listCostCentreMappingsMock).not.toHaveBeenCalled();
  });

  it('requires budgeting/administer and trusts only session tenant/user for mapping', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    createMappingMock.mockResolvedValue({ id: 'mapping-1' });
    const response = await mappingsRoute.POST(new Request('http://localhost?organisationId=org-b', {
      method: 'POST',
      body: JSON.stringify({ sourceSystemId:'xero', externalAccountCode:'600', budgetAccountId:'ba-1', effectiveFrom:'2026-07-01' }),
    }));
    expect(response.status).toBe(201);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(createMappingMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId:'org-a', userId:'admin-a' }));
  });

  it('retires a mapping under admin auth and session tenant only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    retireMappingMock.mockResolvedValue({ id:'mapping-1', status:'RETIRED' });
    const response = await retireRoute.POST(new Request('http://localhost', { method:'POST', body: JSON.stringify({ effectiveTo:'2026-12-31' }) }), ctx);
    expect(response.status).toBe(200);
    expect(retireMappingMock).toHaveBeenCalledWith({ organisationId:'org-a', userId:'admin-a', mappingId:'mapping-1', effectiveTo:'2026-12-31' });
  });

  it('creates a governed cost-centre mapping under budgeting/administer using only session tenant/user', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    createCostCentreMappingMock.mockResolvedValue({ id: 'cc-mapping-1' });

    const response = await costCentreMappingsRoute.POST(new Request('http://localhost?organisationId=org-b', {
      method: 'POST',
      body: JSON.stringify({
        sourceSystemId: 'xero',
        externalCostCentreCode: 'OPS-EXT',
        costCentreId: 'cc-1',
        effectiveFrom: '2026-07-01',
      }),
    }));

    expect(response.status).toBe(201);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(createCostCentreMappingMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'admin-a',
      sourceSystemId: 'xero',
      externalCostCentreCode: 'OPS-EXT',
      costCentreId: 'cc-1',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });
  });

  it('retires a governed cost-centre mapping under session tenant only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    retireCostCentreMappingMock.mockResolvedValue({ id: 'mapping-1', status: 'RETIRED' });

    const response = await retireCostCentreMappingRoute.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ effectiveTo: '2026-12-31' }),
      }),
      ctx,
    );

    expect(response.status).toBe(200);
    expect(retireCostCentreMappingMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'admin-a',
      mappingId: 'mapping-1',
      effectiveTo: '2026-12-31',
    });
  });

  it('imports immutable external entry with session tenant and preserves idempotent outcome status', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    importEntryMock.mockResolvedValue({
      outcome:'IDEMPOTENT',
      entry:{ id:'gl-1' },
      staleReconciliationCount:0,
    });
    const response = await entriesRoute.POST(new Request('http://localhost', { method:'POST', body: JSON.stringify({
      sourceSystemId:'xero', externalEntryId:'e-1', externalAccountCode:'600', transactionDate:'2026-09-30', currency:'AUD',
      amountMinorUnits:'1234', sourcePayloadHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sourceLineageId:'import-1'
    }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome:'IDEMPOTENT',
      staleReconciliationCount:0,
    });
    expect(importEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId:'org-a',
      userId:'admin-a',
      externalEntryId:'e-1',
    }));
  });

  it('returns 201 and surfaces the stale reconciliation count from a governed new external fact import', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    importEntryMock.mockResolvedValue({
      outcome:'IMPORTED',
      entry:{ id:'gl-2' },
      staleReconciliationCount:1,
    });

    const response = await entriesRoute.POST(new Request('http://localhost', {
      method:'POST',
      body: JSON.stringify({
        sourceSystemId:'xero',
        externalEntryId:'e-2',
        externalAccountCode:'600',
        transactionDate:'2026-09-30',
        currency:'AUD',
        amountMinorUnits:'50',
        sourcePayloadHash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        sourceLineageId:'import-2',
      }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      outcome:'IMPORTED',
      entry:{ id:'gl-2' },
      staleReconciliationCount:1,
    });
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(importEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId:'org-a',
      userId:'admin-a',
      externalEntryId:'e-2',
    }));
  });

  it.each([401, 403, 503])('preserves source-list authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await sourcesRoute.GET();

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(listSourcesMock).not.toHaveBeenCalled();
  });

  it('lists finance source IDs under budgeting/view using only the session tenant', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listSourcesMock.mockResolvedValue(['myob', 'xero']);

    const response = await sourcesRoute.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ sourceSystemIds: ['myob', 'xero'] });
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(listSourcesMock).toHaveBeenCalledWith('org-a');
  });

  it('maps invalid input to 400, not-found to 404, and conflicts to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    createMappingMock.mockRejectedValueOnce(new MockExternalGlError('INVALID_INPUT','bad'));
    expect((await mappingsRoute.POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status).toBe(400);
    createMappingMock.mockRejectedValueOnce(new MockExternalGlError('NOT_FOUND','cross-tenant detail'));
    const notFound = await mappingsRoute.POST(new Request('http://localhost',{method:'POST',body:'{}'}));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'Not found.' });
    importEntryMock.mockRejectedValueOnce(new MockExternalGlError('EXTERNAL_IDENTITY_CONFLICT','conflict'));
    expect((await entriesRoute.POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status).toBe(409);
  });
});
