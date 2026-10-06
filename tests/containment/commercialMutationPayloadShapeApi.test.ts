import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authorizeMock, domainMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(), domainMock: vi.fn(),
}));
vi.mock('@/lib/commercial/authorize', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: authorizeMock };
});
vi.mock('@/lib/commercial/financeClose', () => ({
  closeFinancialPeriod: (...args: unknown[]) => domainMock(...args),
  FinanceCloseError: class extends Error {},
  reopenFinancialPeriod: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/financeAdjustments', () => ({
  reverseFinanceAdjustment: (...args: unknown[]) => domainMock(...args),
  FinanceAdjustmentError: class extends Error {},
  createFinanceAdjustment: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/financeReconciliation', () => ({
  FinanceReconciliationError: class extends Error {},
  signOffFinanceReconciliation: (...args: unknown[]) => domainMock(...args),
  prepareFinanceReconciliation: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/purchaseMatchAllocations', () => ({
  reversePurchaseMatchAllocation: (...args: unknown[]) => domainMock(...args),
  createPurchaseMatchAllocation: (...args: unknown[]) => domainMock(...args),
  getPurchaseMatchWorkspace: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/externalGl', () => ({
  retireExternalGlCostCentreMapping: (...args: unknown[]) => domainMock(...args),
  ExternalGlError: class extends Error {},
  createExternalGlCostCentreMapping: (...args: unknown[]) => domainMock(...args),
  listExternalGlCostCentreMappings: (...args: unknown[]) => domainMock(...args),
  importExternalGlEntry: (...args: unknown[]) => domainMock(...args),
  retireExternalGlAccountMapping: (...args: unknown[]) => domainMock(...args),
  createExternalGlAccountMapping: (...args: unknown[]) => domainMock(...args),
  listExternalGlAccountMappings: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/supplierPayments', () => ({
  getSupplierBillPaymentSummary: (...args: unknown[]) => domainMock(...args),
  listSupplierPaymentAllocations: (...args: unknown[]) => domainMock(...args),
  reverseSupplierPayment: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/financialPeriods', () => ({
  FinancialYearStatusError: class extends Error {},
  setFinancialYearStatus: (...args: unknown[]) => domainMock(...args),
}));

vi.mock('@/lib/commercial/supplierBills', () => ({
  cancelSupplierBill: (...args: unknown[]) => domainMock(...args),
}));

const routes = [
  ['budgeting/external-gl/cost-centre-mappings/[id]/retire/route.ts', await import('@/app/api/commercial/budgeting/external-gl/cost-centre-mappings/[id]/retire/route')],
  ['budgeting/external-gl/cost-centre-mappings/route.ts', await import('@/app/api/commercial/budgeting/external-gl/cost-centre-mappings/route')],
  ['budgeting/external-gl/entries/route.ts', await import('@/app/api/commercial/budgeting/external-gl/entries/route')],
  ['budgeting/external-gl/mappings/[id]/retire/route.ts', await import('@/app/api/commercial/budgeting/external-gl/mappings/[id]/retire/route')],
  ['budgeting/external-gl/mappings/route.ts', await import('@/app/api/commercial/budgeting/external-gl/mappings/route')],
  ['budgeting/finance-adjustments/[id]/reverse/route.ts', await import('@/app/api/commercial/budgeting/finance-adjustments/[id]/reverse/route')],
  ['budgeting/finance-adjustments/route.ts', await import('@/app/api/commercial/budgeting/finance-adjustments/route')],
  ['budgeting/financial-periods/[id]/close/route.ts', await import('@/app/api/commercial/budgeting/financial-periods/[id]/close/route')],
  ['budgeting/financial-periods/[id]/reopen/route.ts', await import('@/app/api/commercial/budgeting/financial-periods/[id]/reopen/route')],
  ['budgeting/financial-years/[id]/close/route.ts', await import('@/app/api/commercial/budgeting/financial-years/[id]/close/route')],
  ['budgeting/financial-years/[id]/reopen/route.ts', await import('@/app/api/commercial/budgeting/financial-years/[id]/reopen/route')],
  ['budgeting/reconciliations/[id]/sign-off/route.ts', await import('@/app/api/commercial/budgeting/reconciliations/[id]/sign-off/route')],
  ['budgeting/reconciliations/prepare/route.ts', await import('@/app/api/commercial/budgeting/reconciliations/prepare/route')],
  ['purchase-orders/[id]/matches/[allocationId]/reverse/route.ts', await import('@/app/api/commercial/purchase-orders/[id]/matches/[allocationId]/reverse/route')],
  ['purchase-orders/[id]/matches/route.ts', await import('@/app/api/commercial/purchase-orders/[id]/matches/route')],
  ['supplier-bills/[id]/cancel/route.ts', await import('@/app/api/commercial/supplier-bills/[id]/cancel/route')],
  ['supplier-bills/[id]/payments/[paymentId]/reverse/route.ts', await import('@/app/api/commercial/supplier-bills/[id]/payments/[paymentId]/reverse/route')],
] as const;
const ctx = { params: Promise.resolve({ id: 'entity-a', allocationId: 'allocation-a', paymentId: 'payment-a' }) };
const payloads = [null, [], 'text', 42, false];
beforeEach(() => {
  authorizeMock.mockReset();
  domainMock.mockReset();
  authorizeMock.mockResolvedValue({ ok: true, session: { userId: 'admin-a', organisationId: 'org-a', role: 'admin' } });
});
describe.each(routes)('%s request-body boundary', (_name, route) => {
  it.each(payloads)('rejects non-object JSON %j before domain access', async payload => {
    const response = await route.POST(new NextRequest('http://localhost', {
      method: 'POST', body: JSON.stringify(payload),
    }), ctx);
    expect(response.status).toBe(400);
    expect(domainMock).not.toHaveBeenCalled();
  });
  it('preserves authorization denial before reading the payload', async () => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const response = await route.POST(new NextRequest('http://localhost', { method: 'POST', body: 'null' }), ctx);
    expect(response.status).toBe(403);
    expect(domainMock).not.toHaveBeenCalled();
  });
});