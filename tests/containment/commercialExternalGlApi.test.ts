import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const createMappingMock = vi.fn();
const retireMappingMock = vi.fn();
const importEntryMock = vi.fn();
class MockExternalGlError extends Error { constructor(public code: string, message: string) { super(message); } }
vi.mock('@/lib/commercial/externalGl', () => ({
  createExternalGlAccountMapping: (...args: unknown[]) => createMappingMock(...args),
  retireExternalGlAccountMapping: (...args: unknown[]) => retireMappingMock(...args),
  importExternalGlEntry: (...args: unknown[]) => importEntryMock(...args),
  ExternalGlError: MockExternalGlError,
}));

const mappingsRoute = await import('@/app/api/commercial/budgeting/external-gl/mappings/route');
const retireRoute = await import('@/app/api/commercial/budgeting/external-gl/mappings/[id]/retire/route');
const entriesRoute = await import('@/app/api/commercial/budgeting/external-gl/entries/route');

const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'mapping-1' }) };

beforeEach(() => {
  authorizeMock.mockReset(); createMappingMock.mockReset(); retireMappingMock.mockReset(); importEntryMock.mockReset();
});

describe('C7.9D — external GL admin APIs', () => {
  it.each([401, 403, 503])('preserves mapping authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await mappingsRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(status);
    expect(createMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves mapping-retire authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await retireRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }), ctx);
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(retireMappingMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('preserves entry-import authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await entriesRoute.POST(new Request('http://localhost', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(importEntryMock).not.toHaveBeenCalled();
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

  it('imports immutable external entry with session tenant and preserves idempotent outcome status', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    importEntryMock.mockResolvedValue({ outcome:'IDEMPOTENT', entry:{ id:'gl-1' } });
    const response = await entriesRoute.POST(new Request('http://localhost', { method:'POST', body: JSON.stringify({
      sourceSystemId:'xero', externalEntryId:'e-1', externalAccountCode:'600', transactionDate:'2026-09-30', currency:'AUD',
      amountMinorUnits:'1234', sourcePayloadHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sourceLineageId:'import-1'
    }) }));
    expect(response.status).toBe(200);
    expect(importEntryMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId:'org-a', userId:'admin-a', externalEntryId:'e-1' }));
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
