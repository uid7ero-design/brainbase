import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const sqlMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@/lib/db', () => {
  const sql = (...args: unknown[]) => sqlMock(...args);
  Object.assign(sql, { transaction: (...args: unknown[]) => transactionMock(...args) });
  return { default: sql };
});

const logRecordedMock = vi.fn();
const logReversedMock = vi.fn();
vi.mock('@/lib/commercial/auditLog', () => ({
  logSupplierPaymentRecorded: (...args: unknown[]) => logRecordedMock(...args),
  logSupplierPaymentReversed: (...args: unknown[]) => logReversedMock(...args),
}));

beforeEach(() => {
  sqlMock.mockReset();
  transactionMock.mockReset();
  logRecordedMock.mockReset();
  logReversedMock.mockReset();
});

const ORG = 'org-a';
const USER = 'user-1';
const SUPPLIER = '00000000-0000-0000-0000-000000000101';
const BILL_1 = '00000000-0000-0000-0000-000000000201';
const BILL_2 = '00000000-0000-0000-0000-000000000202';

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-000000000301',
  organisation_id: ORG,
  supplier_id: SUPPLIER,
  amount_cents: 12000,
  currency: 'AUD',
  method: 'BANK_TRANSFER',
  reference: null,
  provider: null,
  provider_reference: null,
  paid_at: '2026-10-05T00:00:00.000Z',
  status: 'RECORDED',
  recorded_by: USER,
  reversed_at: null,
  reversed_by: null,
  reversal_reason: null,
  created_at: '2026-10-05T00:00:00.000Z',
  updated_at: '2026-10-05T00:00:00.000Z',
  ...overrides,
});

const allocations = [
  {
    id: 'a1', organisation_id: ORG, supplier_payment_id: '00000000-0000-0000-0000-000000000301',
    supplier_bill_id: BILL_1, supplier_id: SUPPLIER, currency: 'AUD',
    allocated_amount_cents: 5000, created_at: '2026-10-05T00:00:00.000Z',
  },
  {
    id: 'a2', organisation_id: ORG, supplier_payment_id: '00000000-0000-0000-0000-000000000301',
    supplier_bill_id: BILL_2, supplier_id: SUPPLIER, currency: 'AUD',
    allocated_amount_cents: 7000, created_at: '2026-10-05T00:00:00.000Z',
  },
];

describe('AP-2 recordSupplierPayment validation', () => {
  it('rejects non-positive payment amounts before any SQL', async () => {
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    await expect(recordSupplierPayment({
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 0, currency: 'AUD', method: 'CASH',
      allocations: [{ supplierBillId: BILL_1, amountCents: 1 }],
    })).rejects.toThrow(/positive integer/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('requires allocations to sum exactly to the payment amount', async () => {
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    await expect(recordSupplierPayment({
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 1000, currency: 'AUD', method: 'CASH',
      allocations: [{ supplierBillId: BILL_1, amountCents: 999 }],
    })).rejects.toThrow(/must equal amount_cents/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate bill ids inside one remittance', async () => {
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    await expect(recordSupplierPayment({
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 1000, currency: 'AUD', method: 'CASH',
      allocations: [
        { supplierBillId: BILL_1, amountCents: 500 },
        { supplierBillId: BILL_1, amountCents: 500 },
      ],
    })).rejects.toThrow(/only once/);
  });

  it('rejects duplicate UUIDs with different casing before starting a transaction', async () => {
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    const bill = 'aaaaaaaa-0000-0000-0000-000000000201';
    await expect(recordSupplierPayment({ organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 1000, currency: 'AUD', method: 'CASH', allocations: [
        { supplierBillId: bill, amountCents: 500 }, { supplierBillId: bill.toUpperCase(), amountCents: 500 },
      ] })).rejects.toThrow(/only once/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects invalid method, currency, provider identity and paid_at before transaction work', async () => {
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    const base = {
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 1000, currency: 'AUD', method: 'CASH' as const,
      allocations: [{ supplierBillId: BILL_1, amountCents: 1000 }],
    };

    await expect(recordSupplierPayment({ ...base, method: 'STRIPE' as never })).rejects.toThrow(/Invalid payment method/);
    await expect(recordSupplierPayment({ ...base, currency: 'AU' })).rejects.toThrow(/3-letter/);
    await expect(recordSupplierPayment({ ...base, providerReference: 'evt-1' })).rejects.toThrow(/provider is required/);
    await expect(recordSupplierPayment({ ...base, paidAt: 'not-a-date' })).rejects.toThrow(/valid date/);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe('AP-2 recordSupplierPayment success and guarded failure', () => {
  it('returns payment + allocations and writes the AP audit event after atomic success', async () => {
    transactionMock.mockResolvedValueOnce([[], [{ ...payment(), allocation_count: 2 }]]);
    sqlMock.mockResolvedValueOnce(allocations);

    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    const result = await recordSupplierPayment({
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 12000, currency: 'aud', method: 'BANK_TRANSFER',
      allocations: [
        { supplierBillId: BILL_1, amountCents: 5000 },
        { supplierBillId: BILL_2, amountCents: 7000 },
      ],
    });

    expect(result.payment.currency).toBe('AUD');
    expect(result.allocations).toHaveLength(2);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(logRecordedMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: ORG,
      supplierPaymentId: result.payment.id,
      supplierId: SUPPLIER,
      amountCents: 12000,
      currency: 'AUD',
    }));
  });

  it('rejects cleanly when the guarded transaction inserts nothing', async () => {
    transactionMock.mockResolvedValueOnce([[], []]);
    const { recordSupplierPayment } = await import('@/lib/commercial/supplierPayments');

    await expect(recordSupplierPayment({
      organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 12000, currency: 'AUD', method: 'BANK_TRANSFER',
      allocations: [
        { supplierBillId: BILL_1, amountCents: 5000 },
        { supplierBillId: BILL_2, amountCents: 7000 },
      ],
    })).rejects.toThrow(/could not be recorded/);

    expect(sqlMock).not.toHaveBeenCalled();
    expect(logRecordedMock).not.toHaveBeenCalled();
  });
});

describe('AP-2 supplier-bill payment read model', () => {
  it('derives PARTIALLY_PAID and remaining balance from active allocation facts', async () => {
    sqlMock
      .mockResolvedValueOnce([{ supplier_bill_id: BILL_1, total_cents: 10000, paid_cents: 3500, active_payment_count: 2 }])
      .mockResolvedValueOnce([{ ...payment({ amount_cents: 3500 }), allocated_amount_cents: 3500 }]);

    const { getSupplierBillPaymentSummary } = await import('@/lib/commercial/supplierPayments');
    const summary = await getSupplierBillPaymentSummary(ORG, BILL_1);

    expect(summary).toMatchObject({
      amount_paid_cents: 3500,
      outstanding_balance_cents: 6500,
      payment_state: 'PARTIALLY_PAID',
      active_payment_count: 2,
    });
  });

  it('returns null for a missing or wrong-tenant bill', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const { getSupplierBillPaymentSummary } = await import('@/lib/commercial/supplierPayments');
    await expect(getSupplierBillPaymentSummary('org-b', BILL_1)).resolves.toBeNull();
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

describe('AP-2 reverseSupplierPayment', () => {
  it('requires a reversal reason before SQL', async () => {
    const { reverseSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    await expect(reverseSupplierPayment({
      organisationId: ORG, userId: USER, supplierPaymentId: payment().id, reason: '   ',
    })).rejects.toThrow(/required/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('reverses once, preserves allocation history and audits affected bills', async () => {
    sqlMock
      .mockResolvedValueOnce([payment({
        status: 'REVERSED',
        reversed_at: '2026-10-05T01:00:00.000Z',
        reversed_by: USER,
        reversal_reason: 'Correction',
      })])
      .mockResolvedValueOnce(allocations);

    const { reverseSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    const result = await reverseSupplierPayment({
      organisationId: ORG, userId: USER, supplierPaymentId: payment().id, reason: ' Correction ',
    });

    expect(result.status).toBe('REVERSED');
    expect(logReversedMock).toHaveBeenCalledWith(expect.objectContaining({
      supplierBillIds: [BILL_1, BILL_2],
      reversalReason: 'Correction',
    }));
  });

  it('rejects a missing/already-reversed payment without duplicate audit effect', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const { reverseSupplierPayment } = await import('@/lib/commercial/supplierPayments');
    await expect(reverseSupplierPayment({
      organisationId: ORG, userId: USER, supplierPaymentId: payment().id, reason: 'Again',
    })).rejects.toThrow(/already reversed|concurrently/);
    expect(logReversedMock).not.toHaveBeenCalled();
  });
});

describe('AP-2 source-level concurrency and finance containment', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/supplierPayments.ts'), 'utf-8');

  it('locks target supplier bills deterministically before rechecking and inserting', () => {
    expect(source).toMatch(/ORDER BY sb\.id[\s\S]*?FOR UPDATE/);
    expect(source).toMatch(/isolationLevel: 'ReadCommitted'/);
    expect(source).toMatch(/b\.status = 'POSTED'/);
    expect(source).toMatch(/sp\.status = 'RECORDED'/);
  });

  it('uses one guarded payment CTE feeding all allocation rows', () => {
    expect(source).toMatch(/ins_payment AS \([\s\S]*?INSERT INTO commercial_supplier_payments/);
    expect(source).toMatch(/ins_allocations AS \([\s\S]*?INSERT INTO commercial_supplier_payment_allocations/);
    expect(source).toMatch(/CROSS JOIN ins_payment p/);
  });

  it('does not write any C7.8/C7.9 finance evidence table', () => {
    const writeTargets = source.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+[a-z_]+/gi) ?? [];
    expect(writeTargets.join('\n')).not.toMatch(/commercial_finance_|commercial_external_gl_|commercial_budget_/);
  });
});
