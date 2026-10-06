import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
const listBudgetAccountsMock = vi.fn();
const listCostCentresMock = vi.fn();

vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});
vi.mock('@/lib/commercial/budgetAccounts', () => ({
  listBudgetAccounts: (...args: unknown[]) => listBudgetAccountsMock(...args),
}));
vi.mock('@/lib/commercial/costCentres', () => ({
  listCostCentres: (...args: unknown[]) => listCostCentresMock(...args),
}));

const route = await import('@/app/api/commercial/budgeting/external-gl/reference-data/route');

const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };

beforeEach(() => {
  authorizeMock.mockReset();
  listBudgetAccountsMock.mockReset();
  listCostCentresMock.mockReset();
});

describe('C7.9D — External GL reference-data API', () => {
  it.each([401, 403, 503])('preserves authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await route.GET();

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(listBudgetAccountsMock).not.toHaveBeenCalled();
    expect(listCostCentresMock).not.toHaveBeenCalled();
  });

  it('returns active tenant-scoped Budget accounts and cost centres only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listBudgetAccountsMock.mockResolvedValue([
      { id: 'ba-1', code: 'OPEX', name: 'Operating', organisation_id: 'org-a' },
    ]);
    listCostCentresMock.mockResolvedValue([
      { id: 'cc-1', code: 'OPS', name: 'Operations', organisation_id: 'org-a' },
    ]);

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      budgetAccounts: [{ id: 'ba-1', code: 'OPEX', name: 'Operating' }],
      costCentres: [{ id: 'cc-1', code: 'OPS', name: 'Operations' }],
    });
    expect(listBudgetAccountsMock).toHaveBeenCalledWith('org-a', { activeOnly: true });
    expect(listCostCentresMock).toHaveBeenCalledWith('org-a', { activeOnly: true });
  });
});
