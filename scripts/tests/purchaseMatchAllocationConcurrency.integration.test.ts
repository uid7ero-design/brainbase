import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'purchaseMatchAllocationConcurrency.integration.test.ts requires DATABASE_URL to point at a disposable local Postgres container.'
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run purchase-match concurrency tests against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing to run purchase-match concurrency tests against a non-localhost database.');
}

process.env.SESSION_SECRET ??= 'integration-test-secret-never-real-never-production-0000';

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type QueryDescriptor = { text: string; values: unknown[] };
type TxnTag = (strings: TemplateStringsArray, ...values: unknown[]) => QueryDescriptor;
type TxnBuilder = (txn: TxnTag) => QueryDescriptor[];

function compileQuery(strings: TemplateStringsArray, values: unknown[]): QueryDescriptor {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return { text, values };
}

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const query = compileQuery(strings, values);
  return prisma.$queryRawUnsafe(query.text, ...query.values);
}

type TransactionOptions = { isolationLevel?: 'ReadCommitted' };
const sqlWithTransaction = neonCompatibleSql as typeof neonCompatibleSql & {
  transaction: (builder: TxnBuilder, options?: TransactionOptions) => Promise<unknown[][]>;
};
sqlWithTransaction.transaction = async (builder, options) => {
  expect(options?.isolationLevel).toBe('ReadCommitted');
  return prisma.$transaction(async tx => {
    const txn: TxnTag = (strings, ...values) => compileQuery(strings, values);
    const queries = builder(txn);
    const results: unknown[][] = [];
    for (const query of queries) {
      results.push(await tx.$queryRawUnsafe<unknown[]>(query.text, ...query.values));
    }
    return results;
  }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 10_000 });
};

vi.doMock('@/lib/db', () => ({ default: sqlWithTransaction }));
let createPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').createPurchaseOrder;
let addPurchaseOrderLine: typeof import('@/lib/commercial/purchaseOrders').addPurchaseOrderLine;
let submitPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').submitPurchaseOrder;
let approvePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').approvePurchaseOrder;
let issuePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').issuePurchaseOrder;

let createPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').createPurchaseReceipt;
let addPurchaseReceiptLine: typeof import('@/lib/commercial/purchaseReceipts').addPurchaseReceiptLine;
let postPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').postPurchaseReceipt;
let cancelPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').cancelPurchaseReceipt;
let getPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').getPurchaseReceipt;

let createSupplierBill: typeof import('@/lib/commercial/supplierBills').createSupplierBill;
let addSupplierBillLine: typeof import('@/lib/commercial/supplierBills').addSupplierBillLine;
let postSupplierBill: typeof import('@/lib/commercial/supplierBills').postSupplierBill;
let cancelSupplierBill: typeof import('@/lib/commercial/supplierBills').cancelSupplierBill;
let getSupplierBill: typeof import('@/lib/commercial/supplierBills').getSupplierBill;

let createPurchaseMatchAllocation: typeof import('@/lib/commercial/purchaseMatchAllocations').createPurchaseMatchAllocation;
let reversePurchaseMatchAllocation: typeof import('@/lib/commercial/purchaseMatchAllocations').reversePurchaseMatchAllocation;

const ORG = 'org-a';
const USER = 'user-1';
let invoiceCounter = 0;

beforeAll(async () => {
  ({ createPurchaseOrder, addPurchaseOrderLine, submitPurchaseOrder, approvePurchaseOrder, issuePurchaseOrder } =
    await import('@/lib/commercial/purchaseOrders'));
  ({ createPurchaseReceipt, addPurchaseReceiptLine, postPurchaseReceipt, cancelPurchaseReceipt, getPurchaseReceipt } =
    await import('@/lib/commercial/purchaseReceipts'));
  ({ createSupplierBill, addSupplierBillLine, postSupplierBill, cancelSupplierBill, getSupplierBill } =
    await import('@/lib/commercial/supplierBills'));
  ({ createPurchaseMatchAllocation, reversePurchaseMatchAllocation } =
    await import('@/lib/commercial/purchaseMatchAllocations'));

  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a') ON CONFLICT (id) DO NOTHING`
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user-1', 'User One') ON CONFLICT (id) DO NOTHING`
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function freshIssuedPoWithLine(quantity = 20): Promise<{ purchaseOrderId: string; lineId: string }> {
  const supplierRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_suppliers (organisation_id, name) VALUES ($1, 'Match Test Supplier') RETURNING id`, ORG,
  );
  const supplierId = supplierRows[0].id;
  const po = await createPurchaseOrder({ organisationId: ORG, userId: USER, supplierId });
  const line = await addPurchaseOrderLine({
    organisationId: ORG, purchaseOrderId: po.id, description: 'Service', quantity, unitPriceCents: 1000,
  });
  await submitPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await approvePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await issuePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  return { purchaseOrderId: po.id, lineId: line.id };
}
async function postedReceiptLine(
  purchaseOrderId: string,
  lineId: string,
  quantity: string | number,
): Promise<{ receiptId: string; lineId: string }> {
  const receipt = await createPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseOrderId });
  const line = await addPurchaseReceiptLine({
    organisationId: ORG,
    purchaseReceiptId: receipt.id,
    sourcePurchaseOrderLineId: lineId,
    quantityReceived: Number(quantity),
  });
  await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receipt.id });
  return { receiptId: receipt.id, lineId: line.id };
}

async function postedBillLine(
  purchaseOrderId: string,
  lineId: string,
  quantity: string | number,
): Promise<{ billId: string; lineId: string }> {
  invoiceCounter += 1;
  const bill = await createSupplierBill({
    organisationId: ORG,
    userId: USER,
    purchaseOrderId,
    supplierInvoiceNumber: `MATCH-${invoiceCounter}-${Date.now()}`,
  });
  const line = await addSupplierBillLine({
    organisationId: ORG,
    supplierBillId: bill.id,
    sourcePurchaseOrderLineId: lineId,
    quantity,
    unitPriceCents: 1000,
  });
  await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: bill.id });
  return { billId: bill.id, lineId: line.id };
}

async function activeAllocationCount(params: {
  receiptLineId?: string;
  billLineId?: string;
}): Promise<number> {
  const conditions: string[] = [`organisation_id = $1`, `reversed_at IS NULL`];
  const values: unknown[] = [ORG];
  if (params.receiptLineId) {
    values.push(params.receiptLineId);
    conditions.push(`purchase_receipt_line_id = $${values.length}::uuid`);
  }
  if (params.billLineId) {
    values.push(params.billLineId);
    conditions.push(`supplier_bill_line_id = $${values.length}::uuid`);
  }
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) AS count FROM commercial_purchase_receipt_bill_allocations WHERE ${conditions.join(' AND ')}`,
    ...values,
  );
  return Number(rows[0].count);
}
describe('C7.5D2 — real Postgres allocation serialization', () => {
  it('two concurrent allocations cannot jointly exceed one receipt-line capacity', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(20);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, '10.0000');
    const billA = await postedBillLine(purchaseOrderId, lineId, '6.0000');
    const billB = await postedBillLine(purchaseOrderId, lineId, '6.0000');

    const results = await Promise.allSettled([
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: billA.lineId, quantity: '6.0000',
      }),
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: billB.lineId, quantity: '6.0000',
      }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await activeAllocationCount({ receiptLineId: receipt.lineId })).toBe(1);
  });

  it('two concurrent allocations can both commit when they exactly reach the receipt boundary', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(20);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, '10.0000');
    const billA = await postedBillLine(purchaseOrderId, lineId, '6.5000');
    const billB = await postedBillLine(purchaseOrderId, lineId, '3.5000');

    const results = await Promise.allSettled([
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: billA.lineId, quantity: '6.5000',
      }),
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: billB.lineId, quantity: '3.5000',
      }),
    ]);

    expect(results.map(r => r.status === 'fulfilled' ? 'fulfilled' : String(r.reason?.message))).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(await activeAllocationCount({ receiptLineId: receipt.lineId })).toBe(2);
  });

  it('two concurrent allocations cannot jointly exceed one supplier-bill-line capacity', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(20);
    const receiptA = await postedReceiptLine(purchaseOrderId, lineId, '6.0000');
    const receiptB = await postedReceiptLine(purchaseOrderId, lineId, '6.0000');
    const bill = await postedBillLine(purchaseOrderId, lineId, '10.0000');

    const results = await Promise.allSettled([
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receiptA.lineId, supplierBillLineId: bill.lineId, quantity: '6.0000',
      }),
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receiptB.lineId, supplierBillLineId: bill.lineId, quantity: '6.0000',
      }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await activeAllocationCount({ billLineId: bill.lineId })).toBe(1);
  });
});
describe('C7.5D2 — allocation versus cancellation', () => {
  it('receipt cancellation can never commit together with a new active allocation against that receipt', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, '5.0000');
    const bill = await postedBillLine(purchaseOrderId, lineId, '5.0000');

    const [allocationResult, cancelResult] = await Promise.allSettled([
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: bill.lineId, quantity: '5.0000',
      }),
      cancelPurchaseReceipt({
        organisationId: ORG, userId: USER, purchaseReceiptId: receipt.receiptId, reason: 'Race test',
      }),
    ]);

    const current = await getPurchaseReceipt(ORG, receipt.receiptId);
    const active = await activeAllocationCount({ receiptLineId: receipt.lineId });
    expect(current?.status === 'CANCELLED' && active > 0).toBe(false);

    if (allocationResult.status === 'fulfilled') {
      expect(current?.status).toBe('POSTED');
      expect(active).toBe(1);
      expect(cancelResult.status).toBe('rejected');
    } else {
      expect(current?.status).toBe('CANCELLED');
      expect(active).toBe(0);
      expect(cancelResult.status).toBe('fulfilled');
    }
  });

  it('supplier-bill cancellation can never commit together with a new active allocation against that bill', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, '5.0000');
    const bill = await postedBillLine(purchaseOrderId, lineId, '5.0000');

    const [allocationResult, cancelResult] = await Promise.allSettled([
      createPurchaseMatchAllocation({
        organisationId: ORG, userId: USER,
        purchaseReceiptLineId: receipt.lineId, supplierBillLineId: bill.lineId, quantity: '5.0000',
      }),
      cancelSupplierBill({
        organisationId: ORG, userId: USER, supplierBillId: bill.billId, reason: 'Race test',
      }),
    ]);

    const current = await getSupplierBill(ORG, bill.billId);
    const active = await activeAllocationCount({ billLineId: bill.lineId });
    expect(current?.status === 'CANCELLED' && active > 0).toBe(false);

    if (allocationResult.status === 'fulfilled') {
      expect(current?.status).toBe('POSTED');
      expect(active).toBe(1);
      expect(cancelResult.status).toBe('rejected');
    } else {
      expect(current?.status).toBe('CANCELLED');
      expect(active).toBe(0);
      expect(cancelResult.status).toBe('fulfilled');
    }
  });

  it('reversing the active allocation reopens cancellation for both source documents', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, '5.0000');
    const bill = await postedBillLine(purchaseOrderId, lineId, '5.0000');
    const allocation = await createPurchaseMatchAllocation({
      organisationId: ORG, userId: USER,
      purchaseReceiptLineId: receipt.lineId, supplierBillLineId: bill.lineId, quantity: '5.0000',
    });

    await expect(cancelPurchaseReceipt({
      organisationId: ORG, userId: USER, purchaseReceiptId: receipt.receiptId, reason: 'Blocked',
    })).rejects.toThrow(/active purchase match allocations/);
    await expect(cancelSupplierBill({
      organisationId: ORG, userId: USER, supplierBillId: bill.billId, reason: 'Blocked',
    })).rejects.toThrow(/active purchase match allocations/);

    await reversePurchaseMatchAllocation({
      organisationId: ORG, userId: USER, allocationId: allocation.id, reason: 'Correcting match',
    });

    await expect(cancelPurchaseReceipt({
      organisationId: ORG, userId: USER, purchaseReceiptId: receipt.receiptId, reason: 'After reversal',
    })).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(cancelSupplierBill({
      organisationId: ORG, userId: USER, supplierBillId: bill.billId, reason: 'After reversal',
    })).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});
