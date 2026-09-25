import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const {
  derivePurchaseCommitmentReport,
  getPurchaseCommitmentReport,
} = await import('@/lib/commercial/purchasingCommitments');

import type { RawPurchaseCommitmentRow } from '@/lib/commercial/purchasingCommitments';

const row = (overrides: Partial<RawPurchaseCommitmentRow> = {}): RawPurchaseCommitmentRow => ({
  purchase_order_id: 'po-1',
  purchase_order_status: 'ISSUED',
  supplier_id: 'supplier-1',
  currency: 'AUD',
  issued_at: '2026-09-25T00:00:00.000Z',
  purchase_order_cost_centre_id: 'cc-1',
  line_id: 'line-1',
  position: 1,
  description_snapshot: 'Services',
  line_cost_centre_id: null,
  ordered_subtotal_cents: 10000,
  ordered_tax_cents: 1000,
  ordered_total_cents: 11000,
  billed_subtotal_cents: '4000',
  billed_tax_cents: '400',
  billed_total_cents: '4400',
  ...overrides,
});

beforeEach(() => {
  sqlMock.mockReset();
});

describe('Phase C7.6D — cross-PO commitment report derivation', () => {
  it('rolls multiple POs up by currency without inventing a cross-currency grand total', () => {
    const report = derivePurchaseCommitmentReport([
      row(),
      row({
        purchase_order_id: 'po-2',
        supplier_id: 'supplier-2',
        line_id: 'line-2',
        ordered_total_cents: 5000,
        ordered_subtotal_cents: 5000,
        ordered_tax_cents: 0,
        billed_total_cents: '1000',
        billed_subtotal_cents: '1000',
        billed_tax_cents: '0',
      }),
      row({
        purchase_order_id: 'po-3',
        supplier_id: 'supplier-3',
        currency: 'USD',
        line_id: 'line-3',
        ordered_total_cents: 9000,
        ordered_subtotal_cents: 9000,
        ordered_tax_cents: 0,
        billed_total_cents: '0',
        billed_subtotal_cents: '0',
        billed_tax_cents: '0',
      }),
    ]);

    expect(report.periodResolution).toBe('UNRESOLVED');
    expect(report.purchaseOrderCount).toBe(3);
    expect(report.lineCount).toBe(3);
    expect(report.currencies).toEqual([
      {
        currency: 'AUD',
        purchaseOrderCount: 2,
        lineCount: 2,
        orderedTotalCents: 16000,
        billedTotalCents: 5400,
        outstandingTotalCents: 10600,
      },
      {
        currency: 'USD',
        purchaseOrderCount: 1,
        lineCount: 1,
        orderedTotalCents: 9000,
        billedTotalCents: 0,
        outstandingTotalCents: 9000,
      },
    ]);
    expect(report).not.toHaveProperty('outstandingTotalCents');
  });

  it('returns an empty, explicitly unresolved report when the tenant has no issued POs', () => {
    expect(derivePurchaseCommitmentReport([])).toEqual({
      periodResolution: 'UNRESOLVED',
      purchaseOrderCount: 0,
      lineCount: 0,
      currencies: [],
      purchaseOrders: [],
    });
  });
});

describe('Phase C7.6D — tenant-scoped report SQL boundary', () => {
  it('reads only this tenant, only ISSUED POs and POSTED bills, with no receipts, matches, legacy budget model or period inference', async () => {
    sqlMock.mockResolvedValueOnce([row()]);

    const report = await getPurchaseCommitmentReport('org-a');

    expect(report.purchaseOrderCount).toBe(1);
    expect(sqlMock).toHaveBeenCalledOnce();
    const strings = sqlMock.mock.calls[0][0] as string[];
    const query = strings.join('');

    expect(query).toMatch(/csbl\.organisation_id =/);
    expect(query).toMatch(/csb\.organisation_id = csbl\.organisation_id/);
    expect(query).toMatch(/source_line\.organisation_id = csbl\.organisation_id/);
    expect(query).toMatch(/cpo\.organisation_id =/);
    expect(query).toMatch(/cpol\.organisation_id = cpo\.organisation_id/);
    expect(query).toMatch(/cpo\.status = 'ISSUED'/);
    expect(query).toMatch(/csb\.status = 'POSTED'/);
    expect(query).toMatch(/csb\.source_purchase_order_id = source_line\.purchase_order_id/);
    expect(query).not.toMatch(/commercial_purchase_receipts|purchase_match|allocations/i);
    expect(query).not.toMatch(/financial_models|commercial_financial_periods|delivery_date/);
    expect(query).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('returns only rows supplied by the tenant-scoped query', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(getPurchaseCommitmentReport('org-with-no-issued-pos')).resolves.toMatchObject({
      purchaseOrderCount: 0,
      purchaseOrders: [],
    });
  });
});
