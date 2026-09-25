import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const logCreatedMock = vi.fn();
const logReversedMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('@/lib/commercial/auditLog', () => ({
  logPurchaseMatchAllocationCreated: (...args: unknown[]) => logCreatedMock(...args),
  logPurchaseMatchAllocationReversed: (...args: unknown[]) => logReversedMock(...args),
}));

const {
  assertPurchaseMatchCapacity,
  createPurchaseMatchAllocation,
  listPurchaseMatchAllocationsForPurchaseOrder,
  reversePurchaseMatchAllocation,
} = await import('@/lib/commercial/purchaseMatchAllocations');

const eligibility = (overrides: Record<string, unknown> = {}) => ({
  purchase_order_line_id: 'po-line-1',
  line_purchase_order_id: 'po-1',
  receipt_purchase_order_id: 'po-1',
  bill_purchase_order_id: 'po-1',
  receipt_status: 'POSTED',
  bill_status: 'POSTED',
  receipt_quantity: '10.0000',
  bill_quantity: '10.0000',
  ...overrides,
});
const allocation = (overrides: Record<string, unknown> = {}) => ({
  id: 'alloc-1',
  organisation_id: 'org-a',
  purchase_order_line_id: 'po-line-1',
  purchase_receipt_line_id: 'receipt-line-1',
  supplier_bill_line_id: 'bill-line-1',
  quantity_allocated: '6.5000',
  created_by: 'user-1',
  created_at: '2026-09-25T00:00:00.000Z',
  reversed_by: null,
  reversed_at: null,
  reversal_reason: null,
  ...overrides,
});

beforeEach(() => {
  sqlMock.mockReset();
  logCreatedMock.mockReset();
  logReversedMock.mockReset();
});

describe('Phase C7.5D1 — exact sequential allocation capacity', () => {
  it('accepts an exact remaining boundary', () => {
    expect(assertPurchaseMatchCapacity({
      allocationQuantity: '3.5000',
      receiptQuantity: '10.0000',
      billQuantity: '10.0000',
      receiptAllocated: '6.5000',
      billAllocated: '6.5000',
    })).toBe('3.5000');
  });

  it('accepts the minimum 0.0001 allocation', () => {
    expect(assertPurchaseMatchCapacity({
      allocationQuantity: '0.0001',
      receiptQuantity: '1.0000',
      billQuantity: '1.0000',
      receiptAllocated: '0',
      billAllocated: '0',
    })).toBe('0.0001');
  });
  it('rejects a 0.0001 receipt-capacity overrun', () => {
    expect(() => assertPurchaseMatchCapacity({
      allocationQuantity: '3.5001',
      receiptQuantity: '10.0000',
      billQuantity: '20.0000',
      receiptAllocated: '6.5000',
      billAllocated: '0',
    })).toThrow('receipt line remaining quantity');
  });

  it('rejects a 0.0001 bill-capacity overrun', () => {
    expect(() => assertPurchaseMatchCapacity({
      allocationQuantity: '3.5001',
      receiptQuantity: '20.0000',
      billQuantity: '10.0000',
      receiptAllocated: '0',
      billAllocated: '6.5000',
    })).toThrow('supplier bill line remaining quantity');
  });

  it('rejects zero, negative, or >4dp allocation quantities through Quantity4 validation', () => {
    for (const value of ['0', '-1', '1.23456']) {
      expect(() => assertPurchaseMatchCapacity({
        allocationQuantity: value,
        receiptQuantity: '10',
        billQuantity: '10',
        receiptAllocated: '0',
        billAllocated: '0',
      })).toThrow();
    }
  });
});

describe('Phase C7.5D1 — create allocation eligibility', () => {
  it('creates an exact allocation only after eligibility and active-capacity checks', async () => {
    sqlMock
      .mockResolvedValueOnce([eligibility()])
      .mockResolvedValueOnce([{ receipt_allocated: '0', bill_allocated: '0', active_pair_count: '0' }])
      .mockResolvedValueOnce([allocation()]);

    const result = await createPurchaseMatchAllocation({
      organisationId: 'org-a',
      userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1',
      supplierBillLineId: 'bill-line-1',
      quantity: '6.5',
    });
    expect(result.quantity_allocated).toBe('6.5000');
    expect(sqlMock).toHaveBeenCalledTimes(3);
    expect(logCreatedMock).toHaveBeenCalledOnce();
    expect(logCreatedMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-a',
      allocationId: 'alloc-1',
      after: expect.objectContaining({
        purchase_order_line_id: 'po-line-1',
        quantity_allocated: '6.5000',
      }),
    }));

    const eligibilitySql = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(eligibilitySql).toMatch(/prl\.organisation_id =/);
    expect(eligibilitySql).toMatch(/sbl\.organisation_id =/);
    expect(eligibilitySql).toMatch(/sbl\.source_purchase_order_line_id = prl\.source_purchase_order_line_id/);

    const capacitySql = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(capacitySql).toMatch(/reversed_at IS NULL/g);
    expect(capacitySql).toMatch(/purchase_receipt_line_id =/);
    expect(capacitySql).toMatch(/supplier_bill_line_id =/);

    const insertSql = (sqlMock.mock.calls[2][0] as string[]).join('');
    expect(insertSql).toMatch(/INSERT INTO commercial_purchase_receipt_bill_allocations/);
    expect(insertSql).toMatch(/purchase_order_line_id/);
  });

  it('rejects cross-line or cross-tenant candidates before capacity or insert', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(createPurchaseMatchAllocation({
      organisationId: 'org-a',
      userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1',
      supplierBillLineId: 'bill-line-other',
      quantity: '1',
    })).rejects.toThrow('same purchase order line');
    expect(sqlMock).toHaveBeenCalledOnce();
  });
  it('requires both source documents to be POSTED', async () => {
    sqlMock.mockResolvedValueOnce([eligibility({ receipt_status: 'DRAFT' })]);
    await expect(createPurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1',
    })).rejects.toThrow('purchase receipt must be POSTED');

    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce([eligibility({ bill_status: 'CANCELLED' })]);
    await expect(createPurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1',
    })).rejects.toThrow('supplier bill must be POSTED');
  });

  it('rejects documents from different purchase orders', async () => {
    sqlMock.mockResolvedValueOnce([eligibility({ bill_purchase_order_id: 'po-2' })]);
    await expect(createPurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1',
    })).rejects.toThrow('shared purchase order line');
  });

  it('rejects a second active allocation for the same line pair', async () => {
    sqlMock
      .mockResolvedValueOnce([eligibility()])
      .mockResolvedValueOnce([{ receipt_allocated: '1', bill_allocated: '1', active_pair_count: '1' }]);
    await expect(createPurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1',
      purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1',
    })).rejects.toThrow('active allocation already exists');
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
describe('Phase C7.5D1 — allocation reads and reversal lifecycle', () => {
  it('lists allocations through tenant-scoped PO-line lineage', async () => {
    sqlMock.mockResolvedValueOnce([allocation()]);
    const result = await listPurchaseMatchAllocationsForPurchaseOrder('org-a', 'po-1');
    expect(result).toHaveLength(1);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(query).toMatch(/a\.organisation_id =/);
    expect(query).toMatch(/pol\.purchase_order_id =/);
    expect(query).toMatch(/pol\.organisation_id = a\.organisation_id/);
  });

  it('reverses only one active tenant-owned allocation and preserves the original quantity', async () => {
    sqlMock.mockResolvedValueOnce([allocation({
      reversed_by: 'user-2',
      reversed_at: '2026-09-25T01:00:00.000Z',
      reversal_reason: 'Wrong receipt',
    })]);

    const result = await reversePurchaseMatchAllocation({
      organisationId: 'org-a',
      userId: 'user-2',
      allocationId: 'alloc-1',
      reason: '  Wrong receipt  ',
    });

    expect(result?.quantity_allocated).toBe('6.5000');
    const query = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(query).toMatch(/organisation_id =/);
    expect(query).toMatch(/reversed_at IS NULL/);
    expect(query).not.toMatch(/DELETE/i);
    expect(logReversedMock).toHaveBeenCalledWith(expect.objectContaining({
      allocationId: 'alloc-1',
      reason: 'Wrong receipt',
    }));
  });
  it('requires a non-blank reversal reason without touching SQL', async () => {
    await expect(reversePurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1', allocationId: 'alloc-1', reason: '   ',
    })).rejects.toThrow('reversal reason is required');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns null when the allocation is missing, cross-tenant, or already reversed', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(reversePurchaseMatchAllocation({
      organisationId: 'org-a', userId: 'user-1', allocationId: 'alloc-1', reason: 'Correction',
    })).resolves.toBeNull();
    expect(logReversedMock).not.toHaveBeenCalled();
  });
});
