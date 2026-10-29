import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { parseRegisterQuery, validateRegisterPagination } from '@/lib/hr/registerPaging';
const mocks = vi.hoisted(() => ({ load: vi.fn(), context: vi.fn(), documents: vi.fn() }));
vi.mock('@/lib/hr/registerPageQueries', () => ({ loadRegisterPage: mocks.load }));
vi.mock('@/lib/hr/lifecycleWorkflowRoute', () => ({ requireLifecycleWorkflowContext: mocks.context }));
vi.mock('@/lib/hr/employeeDocumentHttp', () => ({ requireEmployeeDocumentContext: mocks.documents }));
const session = { userId: 'employee', organisationId: 'active-org', role: 'viewer' };
const routes = [
  ['overview', (await import('@/app/api/hr/lifecycle/overview/route')).GET],
  ['queue', (await import('@/app/api/hr/lifecycle/queue/route')).GET],
  ['documents', (await import('@/app/api/hr/documents/overview/route')).GET],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ ok: true, context: { session } });
  mocks.documents.mockResolvedValue({ ok: true, session });
  mocks.load.mockResolvedValue({ pagination: { page: 1, page_size: 25, total: 0 }, rows: [] });
});
describe('bounded HR register transport', () => {
  it.each(['page=0','page=-1','page=1.5','page=1000000','page=1&page=2','filter=secret','organisation_id=other','user_id=admin','search=' + 'a'.repeat(201), 'search=%00'])('rejects invalid or authority-changing query %s', input => {
    expect(() => parseRegisterQuery(`http://fixture/?${input}`, 'queue')).toThrow();
  });
  it('retains literal wildcard text and normalizes the view only', () => {
    expect(parseRegisterQuery('http://fixture/?page=2&search=%20%25_%20&filter=overdue&lifecycle=offboarding', 'queue'))
      .toEqual({ page: 2, search: '%_', filter: 'overdue', lifecycle: 'offboarding' });
    expect(() => parseRegisterQuery('http://fixture/?lifecycle=all', 'documents')).toThrow();
  });
  it('rejects inconsistent pages rather than inventing partial totals', () => {
    expect(() => validateRegisterPagination({ page: 2, page_size: 25, total: 26 }, 25)).toThrow();
    expect(() => validateRegisterPagination({ page: 1, page_size: 50, total: 50 }, 50)).toThrow();
    expect(validateRegisterPagination({ page: 1, page_size: 25, total: 0 }, 0).total).toBe(0);
  });
  it.each(routes)('%s validates view input after authentication and uses only the trusted session', async (kind, get) => {
    const response = await get(new Request('http://fixture/?page=2&search=Alex&filter=all'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.load).toHaveBeenCalledWith(session, kind, { page: 2, search: 'Alex', filter: 'all', lifecycle: 'all' });
    mocks.load.mockClear();
    expect((await get(new Request('http://fixture/?organisation_id=other'))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.context.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Denied' }, { status: 401 }) });
    mocks.documents.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Denied' }, { status: 401 }) });
    expect((await get(new Request('http://fixture/?organisation_id=other'))).status).toBe(401);
  });
  it.each(routes)('%s fails closed on excessive UTF-8 output without echoing data', async (_kind, get) => {
    mocks.load.mockResolvedValue({ title: '秘密'.repeat(50000) });
    const response = await get(new Request('http://fixture/'));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('秘密');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
