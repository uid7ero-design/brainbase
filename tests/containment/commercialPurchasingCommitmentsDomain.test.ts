import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const {
  derivePurchaseOrderCommitment,
  getPurchaseOrderCommitment,
} = await import('@/lib/commercial/purchasingCommitments');

import type { RawPurchaseCommitmentRow } from '@/lib/commercial/purchasingCommitments';

const base = (overrides: Partial<RawPurchaseCommitmentRow> = {}): RawPurchaseCommitmentRow => ({
  purchase_order_id: 'po-1',
  purchase_order_status: 'ISSUED',
  supplier_id: 'supplier-1',
  currency: 'AUD',
  issued_at: '2026-09-25T00:00:00.000Z',
  purchase_order_cost_centre_id: 'cc-po',
  line_id: 'line-1',
  position: 1,
  description_snapshot: 'Consulting',
  line_cost_centre_id: null,
  ordered_subtotal_cents: 10000,
  ordered_tax_cents: 1000,
  ordered_total_cents: 11000,
  billed_subtotal_cents: '0',
  billed_tax_cents: '0',
  billed_total_cents: '0',
  ...overrides,
});

beforeEach(() => {
  sqlMock.mockReset();
});

describe('Phase C7.6A — pure derived commitment lifecycle', () => {
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED']) {
    it(`${status} produces NOT_COMMITTED and zero outstanding value`, () => {
      const result = derivePurchaseOrderCommitment([base({
        purchase_order_status: status,
        billed_subtotal_cents: '2500',
        billed_tax_cents: '250',
        billed_total_cents: '2750',
      })]);
      expect(result?.commitmentEffectiveAt).toBeNull();
      expect(result?.lines[0]).toMatchObject({
        state: 'NOT_COMMITTED',
        outstandingSubtotalCents: 0,
        outstandingTaxCents: 0,
        outstandingTotalCents: 0,
      });
    });
  }

  it('ISSUED with no posted billed value is OPEN at the full ordered amount', () => {
    const result = derivePurchaseOrderCommitment([base()]);
    expect(result?.lines[0]).toMatchObject({
      state: 'OPEN',
      outstandingSubtotalCents: 10000,
      outstandingTaxCents: 1000,
      outstandingTotalCents: 11000,
    });
    expect(result?.commitmentEffectiveAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('ISSUED with partial billed value is PARTIALLY_CONSUMED with exact integer-cents remainder', () => {
    const result = derivePurchaseOrderCommitment([base({
      billed_subtotal_cents: '4001',
      billed_tax_cents: '401',
      billed_total_cents: '4402',
    })]);
    expect(result?.lines[0]).toMatchObject({
      state: 'PARTIALLY_CONSUMED',
      outstandingSubtotalCents: 5999,
      outstandingTaxCents: 599,
      outstandingTotalCents: 6598,
    });
  });

  it('treats an issued zero-value line as CONSUMED at exactly zero cents', () => {
    const result = derivePurchaseOrderCommitment([base({
      ordered_subtotal_cents: 0,
      ordered_tax_cents: 0,
      ordered_total_cents: 0,
    })]);
    expect(result?.lines[0]).toMatchObject({
      state: 'CONSUMED',
      outstandingSubtotalCents: 0,
      outstandingTaxCents: 0,
      outstandingTotalCents: 0,
    });
  });

  it('ISSUED with exact billed value is CONSUMED', () => {
    const result = derivePurchaseOrderCommitment([base({
      billed_subtotal_cents: '10000',
      billed_tax_cents: '1000',
      billed_total_cents: '11000',
    })]);
    expect(result?.lines[0]).toMatchObject({
      state: 'CONSUMED',
      outstandingSubtotalCents: 0,
      outstandingTaxCents: 0,
      outstandingTotalCents: 0,
    });
  });

  it('surfaces overbilling as INVALID_OVERBILLED and never silently clamps the negative remainder', () => {
    const result = derivePurchaseOrderCommitment([base({
      billed_subtotal_cents: '10001',
      billed_tax_cents: '1000',
      billed_total_cents: '11001',
    })]);
    expect(result?.lines[0]).toMatchObject({
      state: 'INVALID_OVERBILLED',
      outstandingSubtotalCents: -1,
      outstandingTaxCents: 0,
      outstandingTotalCents: -1,
    });
  });

  it('line cost centre overrides the PO cost centre', () => {
    const result = derivePurchaseOrderCommitment([base({ line_cost_centre_id: 'cc-line' })]);
    expect(result?.lines[0].effectiveCostCentreId).toBe('cc-line');
  });

  it('falls back to the PO cost centre', () => {
    const result = derivePurchaseOrderCommitment([base({ line_cost_centre_id: null, purchase_order_cost_centre_id: 'cc-po' })]);
    expect(result?.lines[0].effectiveCostCentreId).toBe('cc-po');
  });

  it('keeps missing cost-centre attribution null rather than inventing a mapping', () => {
    const result = derivePurchaseOrderCommitment([base({ line_cost_centre_id: null, purchase_order_cost_centre_id: null })]);
    expect(result?.lines[0].effectiveCostCentreId).toBeNull();
  });

  it('rolls multiple lines up exactly and remains period-unresolved', () => {
    const result = derivePurchaseOrderCommitment([
      base(),
      base({
        line_id: 'line-2',
        position: 2,
        ordered_subtotal_cents: 5000,
        ordered_tax_cents: 500,
        ordered_total_cents: 5500,
        billed_subtotal_cents: '2000',
        billed_tax_cents: '200',
        billed_total_cents: '2200',
      }),
    ]);
    expect(result).toMatchObject({
      lineCount: 2,
      periodResolution: 'UNRESOLVED',
      orderedSubtotalCents: 15000,
      orderedTaxCents: 1500,
      orderedTotalCents: 16500,
      billedSubtotalCents: 2000,
      billedTaxCents: 200,
      billedTotalCents: 2200,
      outstandingSubtotalCents: 13000,
      outstandingTaxCents: 1300,
      outstandingTotalCents: 14300,
    });
  });

  it('returns a zero-line model for an existing PO with no lines', () => {
    const result = derivePurchaseOrderCommitment([base({
      line_id: null,
      position: null,
      description_snapshot: null,
      ordered_subtotal_cents: null,
      ordered_tax_cents: null,
      ordered_total_cents: null,
    })]);
    expect(result).toMatchObject({
      purchaseOrderId: 'po-1',
      lineCount: 0,
      orderedTotalCents: 0,
      billedTotalCents: 0,
      outstandingTotalCents: 0,
      lines: [],
    });
  });

  it('returns null when the PO does not resolve for the organisation', () => {
    expect(derivePurchaseOrderCommitment([])).toBeNull();
  });

  it('rejects non-integer or unsafe money facts rather than rounding them', () => {
    expect(() => derivePurchaseOrderCommitment([base({ billed_total_cents: '1.5' })]))
      .toThrow('safe integer number of cents');
  });
});

describe('Phase C7.6A — tenant-scoped derived SQL boundary', () => {
  it('uses one read statement, counts POSTED supplier bills only, and scopes every contributing table to the tenant/PO', async () => {
    sqlMock.mockResolvedValueOnce([base()]);
    const result = await getPurchaseOrderCommitment('org-a', 'po-1');
    expect(result?.purchaseOrderId).toBe('po-1');
    expect(sqlMock).toHaveBeenCalledOnce();

    const strings = sqlMock.mock.calls[0][0] as string[];
    const query = strings.join('');

    expect(query).toMatch(/csb\.status = 'POSTED'/);
    expect(query).toMatch(/SUM\(csbl\.line_subtotal_cents\)/);
    expect(query).toMatch(/SUM\(csbl\.line_tax_cents\)/);
    expect(query).toMatch(/SUM\(csbl\.line_total_cents\)/);
    expect(query).toMatch(/csbl\.organisation_id =/);
    expect(query).toMatch(/csb\.organisation_id = csbl\.organisation_id/);
    expect(query).toMatch(/source_line\.organisation_id = csbl\.organisation_id/);
    expect(query).toMatch(/source_line\.purchase_order_id =/);
    expect(query).toMatch(/csb\.source_purchase_order_id =/);
    expect(query).toMatch(/cpol\.organisation_id = cpo\.organisation_id/);
    expect(query).toMatch(/cpo\.organisation_id =/);
    expect(query).not.toMatch(/commercial_purchase_receipts|commercial_purchase_receipt_bill_allocations/);
    expect(query).not.toMatch(/financial_models|commercial_financial_periods|delivery_date/);
    expect(query).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('returns null for a cross-tenant or missing purchase order because the tenant-scoped query returns no rows', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(getPurchaseOrderCommitment('org-a', 'po-owned-by-org-b')).resolves.toBeNull();
  });
});
