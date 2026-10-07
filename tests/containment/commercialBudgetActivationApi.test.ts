import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const activateMock = vi.fn();
class MockBudgetActivationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
vi.mock('@/lib/commercial/budgetActivation', () => ({
  activateBudgetVersion: (...args: unknown[]) => activateMock(...args),
  BudgetActivationError: MockBudgetActivationError,
}));

const { POST } = await import('@/app/api/commercial/budgeting/budgets/[id]/versions/[versionId]/activate/route');

const ADMIN = { userId: 'user-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'budget-1', versionId: 'version-2' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  activateMock.mockReset();
});

describe('C7.7D — Budget activation API', () => {
  it.each([
    [401],
    [403],
    [503],
  ])('returns authorization denial %s unchanged and never activates', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await POST(new Request('http://localhost'), ctx);
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(activateMock).not.toHaveBeenCalled();
  });

  it('uses only authenticated organisation/user plus route IDs', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    activateMock.mockResolvedValue({ id: 'version-2', budget_id: 'budget-1', status: 'ACTIVE' });

    const response = await POST(
      new Request('http://localhost?organisationId=org-b&userId=evil', { method: 'POST' }),
      ctx,
    );

    expect(response.status).toBe(200);
    expect(activateMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'user-a',
      budgetId: 'budget-1',
      budgetVersionId: 'version-2',
    });
  });

  it('collapses missing/cross-tenant versions to tenant-safe 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    activateMock.mockRejectedValue(new MockBudgetActivationError('NOT_FOUND', 'details'));
    const response = await POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });

  it('returns validation conflicts as 409 with a stable code', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    activateMock.mockRejectedValue(new MockBudgetActivationError('FINANCIAL_YEAR_CLOSED', 'Budget financial year must be OPEN to activate a version.'));
    const response = await POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'FINANCIAL_YEAR_CLOSED' });
  });
});
