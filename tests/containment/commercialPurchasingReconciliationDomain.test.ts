import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const {
  derivePurchaseOrderReconciliation,
  getPurchaseOrderReconciliation,
} = await import('@/lib/commercial/purchasingReconciliation');
import type { RawReconciliationRow } from '@/lib/commercial/purchasingReconciliation';

const base = (overrides: Partial<RawReconciliationRow> = {}): RawReconciliationRow => ({
  purchase_order_id: 'po-1',
  purchase_order_status: 'ISSUED',
  currency: 'AUD',
  line_id: 'line-1',
  position: 1,
  description_snapshot: 'Consulting',
  sku_snapshot: null,
  unit_snapshot: 'hour',
  ordered_quantity: 10,
  ordered_value_cents: 11000,
  received_quantity: '0',
  billed_value_cents: '0',
  ...overrides,
});

beforeEach(() => {
  sqlMock.mockReset();
});

describe('Phase C7.5B — derived purchasing reconciliation states', () => {
  it('returns null for a PO that does not resolve for the organisation', () => {
    expect(derivePurchaseOrderReconciliation([])).toBeNull();
  });

  it('classifies no receipt/no bill as OPEN', () => {
    const result = derivePurchaseOrderReconciliation([base()]);
    expect(result?.status).toBe('OPEN');
    expect(result?.lines[0]).toMatchObject({
      receivingState: 'NOT_RECEIVED',
      billingState: 'NOT_BILLED',
      reconciliationState: 'OPEN',
      remainingToReceive: 10,
      remainingToBillCents: 11000,
    });
  });

  it('preserves fractional receipt quantities and classifies partial progress', () => {
    const result = derivePurchaseOrderReconciliation([base({ received_quantity: '6.5000', billed_value_cents: '5500' })]);
    expect(result?.status).toBe('PARTIAL');
    expect(result?.lines[0]).toMatchObject({
      receivedQuantity: 6.5,
      remainingToReceive: 3.5,
      receivingState: 'PARTIALLY_RECEIVED',
      billingState: 'PARTIALLY_BILLED',
      reconciliationState: 'PARTIAL',
    });
    expect(result?.lines[0].exceptions.map(e => e.code)).toEqual(expect.arrayContaining(['PARTIALLY_RECEIVED', 'PARTIALLY_BILLED']));
  });

  it('classifies fully received with no bill as RECEIVED_NOT_BILLED', () => {
    const result = derivePurchaseOrderReconciliation([base({ received_quantity: '10.0000' })]);
    expect(result?.lines[0].reconciliationState).toBe('RECEIVED_NOT_BILLED');
    expect(result?.status).toBe('PARTIAL');
  });

  it('classifies billed before receipt without pretending quantity matching exists', () => {
    const result = derivePurchaseOrderReconciliation([base({ billed_value_cents: '5500' })]);
    expect(result?.lines[0].reconciliationState).toBe('BILLED_NOT_RECEIVED');
    expect(result?.lines[0].exceptions.map(e => e.code)).toEqual(expect.arrayContaining(['BILLED_BEFORE_RECEIPT', 'BILLED_NOT_RECEIVED']));
    expect(result?.status).toBe('PARTIAL');
  });

  it('requires exact receipt quantity AND exact billed value for RECONCILED', () => {
    const result = derivePurchaseOrderReconciliation([base({ received_quantity: '10.0000', billed_value_cents: '11000' })]);
    expect(result?.status).toBe('RECONCILED');
    expect(result?.reconciledLineCount).toBe(1);
    expect(result?.fullyReceivedLineCount).toBe(1);
    expect(result?.fullyBilledLineCount).toBe(1);
    expect(result?.lines[0].reconciliationState).toBe('RECONCILED');
  });

  it('treats a zero-value line as financially complete at exactly zero cents', () => {
    const result = derivePurchaseOrderReconciliation([base({ ordered_value_cents: 0, received_quantity: '10.0000', billed_value_cents: '0' })]);
    expect(result?.status).toBe('RECONCILED');
    expect(result?.fullyBilledLineCount).toBe(1);
    expect(result?.lines[0].billingState).toBe('FULLY_BILLED');
    expect(result?.lines[0].exceptions).not.toContainEqual({ code: 'RECEIVED_NOT_BILLED', severity: 'INFO' });
  });

  it('surfaces impossible over-receipt/over-bill data as EXCEPTION instead of hiding it', () => {
    const result = derivePurchaseOrderReconciliation([base({ received_quantity: '10.5000', billed_value_cents: '11001' })]);
    expect(result?.status).toBe('EXCEPTION');
    expect(result?.lines[0].exceptions).toEqual(expect.arrayContaining([
      { code: 'RECEIPT_QUANTITY_MISMATCH', severity: 'ERROR' },
      { code: 'BILL_VALUE_MISMATCH', severity: 'ERROR' },
    ]));
    expect(result?.lines[0].remainingToReceive).toBe(0);
    expect(result?.lines[0].remainingToBillCents).toBe(0);
  });

  it('rolls multiple PO lines up independently at header level', () => {
    const result = derivePurchaseOrderReconciliation([
      base({ line_id: 'line-1', position: 1, received_quantity: '10', billed_value_cents: '11000' }),
      base({ line_id: 'line-2', position: 2, ordered_quantity: 4, ordered_value_cents: 4400, received_quantity: '2', billed_value_cents: '0' }),
    ]);
    expect(result).toMatchObject({
      lineCount: 2,
      fullyReceivedLineCount: 1,
      fullyBilledLineCount: 1,
      reconciledLineCount: 1,
      orderedValueCents: 15400,
      billedValueCents: 11000,
      status: 'PARTIAL',
    });
  });
});

describe('Phase C7.5B — reconciliation SQL boundary', () => {
  it('uses one read statement, scopes every contributing fact to the organisation/PO, and counts POSTED receipt/bill facts only', async () => {
    sqlMock.mockResolvedValueOnce([base()]);
    const result = await getPurchaseOrderReconciliation('org-a', 'po-1');
    expect(result?.purchaseOrderId).toBe('po-1');
    expect(sqlMock).toHaveBeenCalledOnce();

    const strings = sqlMock.mock.calls[0][0] as string[];
    const query = strings.join('');
    expect(query).toMatch(/cpr\.status = 'POSTED'/);
    expect(query).toMatch(/csb\.status = 'POSTED'/);
    expect(query).toMatch(/crl\.organisation_id =/);
    expect(query).toMatch(/csbl\.organisation_id =/);
    expect(query).toMatch(/cpo\.organisation_id =/);
    expect(query).toMatch(/cpr\.purchase_order_id =/);
    expect(query).toMatch(/csb\.source_purchase_order_id =/);
    expect(query).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  });

  it('returns a zero-line OPEN reconciliation for an existing PO with no lines', async () => {
    sqlMock.mockResolvedValueOnce([base({
      line_id: null,
      position: null,
      description_snapshot: null,
      ordered_quantity: null,
      ordered_value_cents: null,
    })]);
    const result = await getPurchaseOrderReconciliation('org-a', 'po-empty');
    expect(result).toMatchObject({ lineCount: 0, status: 'OPEN', lines: [] });
  });
});
