import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('purchasingCommitments.integration.test.ts requires a disposable local Postgres DATABASE_URL.');
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run purchasing commitment integration tests against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing to run purchasing commitment integration tests against a non-localhost database.');
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
    const results: unknown[][] = [];
    for (const query of builder(txn)) {
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
let createSupplierBill: typeof import('@/lib/commercial/supplierBills').createSupplierBill;
let addSupplierBillLine: typeof import('@/lib/commercial/supplierBills').addSupplierBillLine;
let postSupplierBill: typeof import('@/lib/commercial/supplierBills').postSupplierBill;
let cancelSupplierBill: typeof import('@/lib/commercial/supplierBills').cancelSupplierBill;
let createPurchaseMatchAllocation: typeof import('@/lib/commercial/purchaseMatchAllocations').createPurchaseMatchAllocation;
let reversePurchaseMatchAllocation: typeof import('@/lib/commercial/purchaseMatchAllocations').reversePurchaseMatchAllocation;
let getPurchaseOrderCommitment: typeof import('@/lib/commercial/purchasingCommitments').getPurchaseOrderCommitment;

const ORG = 'org-a';
const USER = 'user-1';
let invoiceCounter = 0;

beforeAll(async () => {
  ({ createPurchaseOrder, addPurchaseOrderLine, submitPurchaseOrder, approvePurchaseOrder, issuePurchaseOrder } =
    await import('@/lib/commercial/purchaseOrders'));
  ({ createPurchaseReceipt, addPurchaseReceiptLine, postPurchaseReceipt } =
    await import('@/lib/commercial/purchaseReceipts'));
  ({ createSupplierBill, addSupplierBillLine, postSupplierBill, cancelSupplierBill } =
    await import('@/lib/commercial/supplierBills'));
  ({ createPurchaseMatchAllocation, reversePurchaseMatchAllocation } =
    await import('@/lib/commercial/purchaseMatchAllocations'));
  ({ getPurchaseOrderCommitment } = await import('@/lib/commercial/purchasingCommitments'));

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

async function freshIssuedPoWithLine(quantity = 10, unitPriceCents = 1000) {
  const supplierRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_suppliers (organisation_id, name) VALUES ($1, 'Commitment Test Supplier') RETURNING id`, ORG,
  );
  const po = await createPurchaseOrder({ organisationId: ORG, userId: USER, supplierId: supplierRows[0].id });
  const line = await addPurchaseOrderLine({
    organisationId: ORG, purchaseOrderId: po.id, description: 'Service', quantity, unitPriceCents,
  });
  await submitPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await approvePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await issuePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  return { purchaseOrderId: po.id, lineId: line.id, orderedTotalCents: line.line_total_cents };
}

async function draftBillLine(purchaseOrderId: string, lineId: string, quantity: string | number, unitPriceCents = 1000) {
  invoiceCounter += 1;
  const bill = await createSupplierBill({
    organisationId: ORG,
    userId: USER,
    purchaseOrderId,
    supplierInvoiceNumber: `COMMIT-${invoiceCounter}-${Date.now()}`,
  });
  const line = await addSupplierBillLine({
    organisationId: ORG,
    supplierBillId: bill.id,
    sourcePurchaseOrderLineId: lineId,
    quantity,
    unitPriceCents,
  });
  return { billId: bill.id, lineId: line.id };
}

async function postedReceiptLine(purchaseOrderId: string, lineId: string, quantityReceived: number) {
  const receipt = await createPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseOrderId });
  const line = await addPurchaseReceiptLine({
    organisationId: ORG,
    purchaseReceiptId: receipt.id,
    sourcePurchaseOrderLineId: lineId,
    quantityReceived,
  });
  await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receipt.id });
  return { receiptId: receipt.id, lineId: line.id };
}

async function currentOutstanding(purchaseOrderId: string): Promise<number> {
  const result = await getPurchaseOrderCommitment(ORG, purchaseOrderId);
  if (!result) throw new Error('Expected commitment read model to resolve');
  return result.outstandingTotalCents;
}

describe('C7.6B — real Postgres commitment lifecycle', () => {
  it('supplier-bill posting consumes commitment and cancellation restores it', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);

    const bill = await draftBillLine(purchaseOrderId, lineId, 4, 1000);
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);

    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: bill.billId });
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents - 4000);
    await cancelSupplierBill({
      organisationId: ORG, userId: USER, supplierBillId: bill.billId, reason: 'Commitment restoration proof',
    });
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);
  });

  it('two concurrent safe bill posts yield the exact committed remainder with no lost update', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    const a = await draftBillLine(purchaseOrderId, lineId, 4, 1000);
    const b = await draftBillLine(purchaseOrderId, lineId, 4, 1000);

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: a.billId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: b.billId }),
    ]);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents - 8000);
  });

  it('a concurrent over-billing race never exposes or persists a negative commitment', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    const a = await draftBillLine(purchaseOrderId, lineId, 6, 1000);
    const b = await draftBillLine(purchaseOrderId, lineId, 6, 1000);

    const reads: number[] = [];
    const posting = Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: a.billId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: b.billId }),
    ]);
    for (let i = 0; i < 8; i++) reads.push(await currentOutstanding(purchaseOrderId));
    const results = await posting;
    reads.push(await currentOutstanding(purchaseOrderId));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(reads.every(value => value >= 0 && value <= orderedTotalCents)).toBe(true);
    expect(reads.every(value => [orderedTotalCents, orderedTotalCents - 6000].includes(value))).toBe(true);
    expect(reads.at(-1)).toBe(orderedTotalCents - 6000);
  });
});

describe('C7.6B — receipt and match allocation negative controls', () => {
  it('posting a purchase receipt does not change monetary commitment', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);
    await postedReceiptLine(purchaseOrderId, lineId, 10);
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);
  });

  it('creating and reversing a match allocation do not change monetary commitment', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    const receipt = await postedReceiptLine(purchaseOrderId, lineId, 10);
    const bill = await draftBillLine(purchaseOrderId, lineId, 10, 1000);
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: bill.billId });
    expect(await currentOutstanding(purchaseOrderId)).toBe(0);

    const allocation = await createPurchaseMatchAllocation({
      organisationId: ORG,
      userId: USER,
      purchaseOrderId,
      purchaseReceiptLineId: receipt.lineId,
      supplierBillLineId: bill.lineId,
      quantity: '10.0000',
    });
    expect(await currentOutstanding(purchaseOrderId)).toBe(0);

    await reversePurchaseMatchAllocation({
      organisationId: ORG,
      userId: USER,
      purchaseOrderId,
      allocationId: allocation.id,
      reason: 'Commitment negative-control proof',
    });
    expect(await currentOutstanding(purchaseOrderId)).toBe(0);
    expect(orderedTotalCents).toBe(10000);
  });
});

describe('C7.6B — MVCC statement-snapshot and locking proof', () => {
  it('a commitment read while bill posting is blocked on the PO line sees the pre-commit snapshot, then the next read sees the committed bill', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    const bill = await draftBillLine(purchaseOrderId, lineId, 4, 1000);

    let releaseLock!: () => void;
    let lockAcquired!: () => void;
    const acquired = new Promise<void>(resolve => { lockAcquired = resolve; });
    const release = new Promise<void>(resolve => { releaseLock = resolve; });

    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM commercial_purchase_order_lines WHERE id = $1::uuid FOR UPDATE',
        lineId,
      );
      lockAcquired();
      await release;
    }, { isolationLevel: 'ReadCommitted', timeout: 10_000 });

    await acquired;
    const posting = postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: bill.billId });

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);

    releaseLock();
    await blocker;
    await posting;
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents - 4000);
  });

  it('a commitment read while bill cancellation is blocked sees the posted bill, then the next read sees restored commitment', async () => {
    const { purchaseOrderId, lineId, orderedTotalCents } = await freshIssuedPoWithLine(10, 1000);
    const bill = await draftBillLine(purchaseOrderId, lineId, 4, 1000);
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: bill.billId });
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents - 4000);
    let releaseLock!: () => void;
    let lockAcquired!: () => void;
    const acquired = new Promise<void>(resolve => { lockAcquired = resolve; });
    const release = new Promise<void>(resolve => { releaseLock = resolve; });

    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM commercial_purchase_order_lines WHERE id = $1::uuid FOR UPDATE',
        lineId,
      );
      lockAcquired();
      await release;
    }, { isolationLevel: 'ReadCommitted', timeout: 10_000 });

    await acquired;
    const cancelling = cancelSupplierBill({
      organisationId: ORG, userId: USER, supplierBillId: bill.billId, reason: 'MVCC cancellation proof',
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents - 4000);

    releaseLock();
    await blocker;
    await cancelling;
    expect(await currentOutstanding(purchaseOrderId)).toBe(orderedTotalCents);
  });
});
