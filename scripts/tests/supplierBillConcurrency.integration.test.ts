import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Phase C7.4 — real disposable-Postgres proof that two concurrent
// `postSupplierBill()` calls against bills drawing on the SAME
// purchase-order line cannot together over-bill it (a VALUE comparison,
// not a quantity one), and that a concurrent bill-post and PO-cancel
// cannot leave the system in an inconsistent state. Also proves the
// duplicate-supplier-invoice-number constraint's canonicalisation
// (trim + lower) is a REAL database-level guarantee, not just an
// application pre-check — a case/whitespace-different duplicate must be
// rejected by Postgres itself.
//
// WHY THIS EXISTS: the entire over-billing guard is enforced by real
// Postgres row-level locking (FOR UPDATE on the bill row, the PO row,
// and every affected PO line row, in deterministic id order) inside one
// atomic writable-CTE statement — see postSupplierBillAtomically() in
// lib/commercial/supplierBills.ts. A mocked sql client can simulate the
// RESULT of a race but cannot prove the race itself is actually
// race-safe — only real MVCC/locking semantics can. Likewise, the
// STORED generated column backing supplier_invoice_number_canonical and
// the UNIQUE constraint on top of it can only be proven against a real
// Postgres engine that actually evaluates GENERATED ALWAYS AS.
//
// Run ONLY via scripts/tests/verify-supplier-bill-concurrency.sh, which
// creates the disposable postgres:16-alpine container, applies the real
// Commercial Core/Purchasing/Purchase-Receipts/Supplier-Bills schema, and
// exports DATABASE_URL before this file is ever imported.
//
// TEST SEAM (mirrors scripts/tests/purchaseReceiptConcurrency
// .integration.test.ts's own established pattern): lib/db's tagged-
// template `sql` is replaced by a Prisma-backed equivalent so the real,
// completely unmodified domain functions run their real SQL against
// this real Postgres container.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'supplierBillConcurrency.integration.test.ts requires DATABASE_URL to point at a disposable ' +
      'Postgres container (see scripts/tests/verify-supplier-bill-concurrency.sh). Refusing to run without it.'
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    'Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. ' +
      'This suite may ONLY run against a local disposable Docker container.'
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

process.env.SESSION_SECRET ??= 'integration-test-secret-never-real-never-production-0000';

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type QueryDescriptor = { text: string; values: unknown[] };
type TxnTag = (strings: TemplateStringsArray, ...values: unknown[]) => QueryDescriptor;
type TxnBuilder = (txn: TxnTag) => QueryDescriptor[];

function compileNeonCompatibleQuery(strings: TemplateStringsArray, values: unknown[]): QueryDescriptor {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return { text, values };
}

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const query = compileNeonCompatibleQuery(strings, values);
  return prisma.$queryRawUnsafe(query.text, ...query.values);
}

type TransactionOptions = { isolationLevel?: 'ReadCommitted' };
const sqlWithTransaction = neonCompatibleSql as typeof neonCompatibleSql & {
  transaction: (builder: TxnBuilder, options?: TransactionOptions) => Promise<unknown[][]>;
};
sqlWithTransaction.transaction = async (builder: TxnBuilder, options?: TransactionOptions): Promise<unknown[][]> => {
  expect(options?.isolationLevel).toBe('ReadCommitted');
  return prisma.$transaction(async tx => {
    const txn: TxnTag = (strings, ...values) => compileNeonCompatibleQuery(strings, values);
    const queries = builder(txn);
    const results: unknown[][] = [];
    for (const query of queries) {
      results.push(await tx.$queryRawUnsafe<unknown[]>(query.text, ...query.values));
    }
    return results;
  }, { isolationLevel: 'ReadCommitted' });
};

vi.doMock('@/lib/db', () => ({ default: sqlWithTransaction }));

let createPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').createPurchaseOrder;
let addPurchaseOrderLine: typeof import('@/lib/commercial/purchaseOrders').addPurchaseOrderLine;
let submitPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').submitPurchaseOrder;
let approvePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').approvePurchaseOrder;
let issuePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').issuePurchaseOrder;
let cancelPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').cancelPurchaseOrder;
let getPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').getPurchaseOrder;
let createSupplierBill: typeof import('@/lib/commercial/supplierBills').createSupplierBill;
let addSupplierBillLine: typeof import('@/lib/commercial/supplierBills').addSupplierBillLine;
let postSupplierBill: typeof import('@/lib/commercial/supplierBills').postSupplierBill;
let cancelSupplierBill: typeof import('@/lib/commercial/supplierBills').cancelSupplierBill;
let getSupplierBill: typeof import('@/lib/commercial/supplierBills').getSupplierBill;
let getBilledAmountsForPurchaseOrder: typeof import('@/lib/commercial/supplierBills').getBilledAmountsForPurchaseOrder;

const ORG = 'org-a';
const USER = 'user-1';
let invoiceCounter = 0;
function nextInvoiceNumber(): string {
  invoiceCounter += 1;
  return `INV-${invoiceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

beforeAll(async () => {
  ({ createPurchaseOrder, addPurchaseOrderLine, submitPurchaseOrder, approvePurchaseOrder, issuePurchaseOrder, cancelPurchaseOrder, getPurchaseOrder } = await import('@/lib/commercial/purchaseOrders'));
  ({ createSupplierBill, addSupplierBillLine, postSupplierBill, cancelSupplierBill, getSupplierBill, getBilledAmountsForPurchaseOrder } = await import('@/lib/commercial/supplierBills'));

  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a') ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user-1', 'User One') ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Ordered VALUE per line = unitPriceCents * qty (no tax code selected, so
// line_total_cents === line_subtotal_cents). Returns the resolved
// ordered value alongside the PO/line ids for assertion convenience.
async function freshIssuedPoWithLine(unitPriceCents: number, quantity: number): Promise<{ purchaseOrderId: string; lineId: string; orderedValueCents: number }> {
  const supplierRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_suppliers (organisation_id, name) VALUES ($1, 'Concurrency Test Supplier') RETURNING id`, ORG,
  );
  const supplierId = supplierRows[0].id;

  const po = await createPurchaseOrder({ organisationId: ORG, userId: USER, supplierId });
  const line = await addPurchaseOrderLine({ organisationId: ORG, purchaseOrderId: po.id, description: 'Widget', quantity, unitPriceCents });
  await submitPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await approvePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await issuePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });

  return { purchaseOrderId: po.id, lineId: line.id, orderedValueCents: line.line_total_cents };
}

async function draftBillWithLine(purchaseOrderId: string, lineId: string, billQuantity: string | number, billUnitPriceCents: number): Promise<string> {
  const bill = await createSupplierBill({ organisationId: ORG, userId: USER, purchaseOrderId, supplierInvoiceNumber: nextInvoiceNumber() });
  await addSupplierBillLine({ organisationId: ORG, supplierBillId: bill.id, sourcePurchaseOrderLineId: lineId, quantity: billQuantity, unitPriceCents: billUnitPriceCents });
  return bill.id;
}

describe('C7.4 — real-Postgres supplier bill posting concurrency', () => {
  it('rejects strict over-billing in a plain sequential VALUE-only case', async () => {
    const { purchaseOrderId, lineId, orderedValueCents } = await freshIssuedPoWithLine(1000, 10); // ordered value 10000
    expect(orderedValueCents).toBe(10000);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1500); // qty 4, value 6000
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1500); // cumulative qty 8 <= 10, value 12000 > 10000

    const posted = await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId });
    expect(posted.status).toBe('POSTED');
    expect(posted.bill_number).toBeTruthy();
    expect(posted.supplier_name_snapshot).toBe('Concurrency Test Supplier'); // frozen at post time

    await expect(postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }))
      .rejects.toThrow(/would bill beyond the ordered value/);

    const stillDraft = await getSupplierBill(ORG, billBId);
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('TWO CONCURRENT posts cannot jointly exceed ordered VALUE while quantity stays within — exactly one wins', async () => {
    // Ordered qty 10/value 10000. Each bill is qty 4/value 6000, so
    // quantity would remain safe at 8 while combined value would be 12000.
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(1000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1500);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1500);

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/would bill beyond the ordered value/);

    // Real row-count proof, not just the promise outcomes.
    const [a, b] = await Promise.all([getSupplierBill(ORG, billAId), getSupplierBill(ORG, billBId)]);
    const statuses = [a?.status, b?.status].sort();
    expect(statuses).toEqual(['DRAFT', 'POSTED']);

    const billed = await getBilledAmountsForPurchaseOrder(ORG, purchaseOrderId);
    expect(billed[lineId]).toBe(6000);
  });

  it('TWO CONCURRENT posts that would NOT jointly over-bill can both succeed', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(1000, 10); // ordered value 10000
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1000); // 4000
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, 4, 1000); // 4000, together 8000 <= 10000

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);

    const billed = await getBilledAmountsForPurchaseOrder(ORG, purchaseOrderId);
    expect(billed[lineId]).toBe(8000);
  });

  it('cancelling a POSTED bill reopens the value for a later bill', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(1000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, 10, 1000); // 10000, exactly the ordered value
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId });

    const billBId = await draftBillWithLine(purchaseOrderId, lineId, 10, 1000);
    await expect(postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }))
      .rejects.toThrow(/would bill beyond the ordered value/);

    await cancelSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId, reason: 'Incorrect amount invoiced' });

    const billedAfterCancel = await getBilledAmountsForPurchaseOrder(ORG, purchaseOrderId);
    expect(billedAfterCancel[lineId] ?? 0).toBe(0);

    const posted = await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId });
    expect(posted.status).toBe('POSTED');
  });

  it('an ISSUED purchase order with a POSTED supplier bill cannot be cancelled (sequential)', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(1000, 5);
    const billId = await draftBillWithLine(purchaseOrderId, lineId, 5, 1000);
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billId });

    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'No longer needed' }))
      .rejects.toThrow(/posted supplier bills/);

    const po = await getPurchaseOrder(ORG, purchaseOrderId);
    expect(po?.status).toBe('ISSUED');

    await cancelSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billId, reason: 'Reversing to allow PO cancellation' });
    const cancelled = await cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'No longer needed' });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('CONCURRENT bill-post and PO-cancel never leave a CANCELLED PO with a POSTED bill against it', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(1000, 5);
    const billId = await draftBillWithLine(purchaseOrderId, lineId, 5, 1000);

    const [postResult, cancelResult] = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billId }),
      cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'Racing the bill post' }),
    ]);

    const po = await getPurchaseOrder(ORG, purchaseOrderId);
    const bill = await getSupplierBill(ORG, billId);

    expect(po?.status === 'CANCELLED' && bill?.status === 'POSTED').toBe(false);

    if (postResult.status === 'fulfilled') {
      expect(bill?.status).toBe('POSTED');
      expect(po?.status).toBe('ISSUED');
      expect(cancelResult.status).toBe('rejected');
    } else {
      expect(bill?.status).toBe('DRAFT');
      expect(po?.status).toBe('CANCELLED');
      expect(cancelResult.status).toBe('fulfilled');
    }
  });

  it('the duplicate-supplier-invoice-number constraint is a REAL, canonicalised (trim + lower) database guarantee', async () => {
    // Proven directly at the SQL level (not through createSupplierBill()'s
    // own error translation) — that translation only recognizes the real
    // Neon driver's NeonDbError shape (see lib/commercial/supplierBills.ts's
    // isDuplicateSupplierInvoiceNumberViolation(), unit-tested with a
    // mocked NeonDbError in tests/containment/
    // commercialSupplierBillsDomain.test.ts), which this Prisma-backed
    // test shim does not reproduce. What THIS test proves — and only a
    // real Postgres engine can prove — is that the STORED GENERATED
    // column + UNIQUE constraint themselves actually canonicalise
    // (trim + lower) and reject a case/whitespace-different duplicate at
    // the database level, independent of any application-layer check.
    const { purchaseOrderId } = await freshIssuedPoWithLine(1000, 1);
    const bill = await createSupplierBill({ organisationId: ORG, userId: USER, purchaseOrderId, supplierInvoiceNumber: `  DupTest-${Math.random().toString(36).slice(2, 8)}  ` });

    const differentCaseAndSpacing = bill.supplier_invoice_number.trim().toUpperCase();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO commercial_supplier_bills (organisation_id, supplier_id, source_purchase_order_id, supplier_invoice_number, created_by)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5)`,
      ORG, bill.supplier_id, bill.source_purchase_order_id, differentCaseAndSpacing, USER,
    )).rejects.toThrow(/23505|already exists|supplier_invoice_number_canonical/i);
  });
});


async function postedBilledQuantity(lineId: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ qty: string }[]>(
    `SELECT COALESCE(SUM(csbl.quantity), 0)::text AS qty
     FROM commercial_supplier_bill_lines csbl
     JOIN commercial_supplier_bills csb
       ON csb.id = csbl.supplier_bill_id
      AND csb.organisation_id = csbl.organisation_id
     WHERE csbl.organisation_id = $1
       AND csbl.source_purchase_order_line_id = $2::uuid
       AND csb.status = 'POSTED'`,
    ORG, lineId,
  );
  return rows[0].qty;
}

describe('C7.5C — real-Postgres fractional quantity posting concurrency', () => {
  it('rejects a sequential quantity-only over-bill while value remains safely within', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);

    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId });
    await expect(postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }))
      .rejects.toThrow(/ordered value or quantity/);
    expect(await postedBilledQuantity(lineId)).toBe('6.5000');
  });

  it('two concurrent bills cannot jointly exceed ordered quantity when value stays safely within', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await postedBilledQuantity(lineId)).toBe('6.5000');
  });

  it('two concurrent fractional bills may both post when quantity exactly reaches the boundary', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, '3.5000', 1000);

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(await postedBilledQuantity(lineId)).toBe('10.0000');
  });

  it('a 0.0001 cumulative quantity overrun cannot commit under concurrency', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, '5.0000', 1000);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, '5.0001', 1000);

    const results = await Promise.allSettled([
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId }),
      postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(Number(await postedBilledQuantity(lineId))).toBeLessThanOrEqual(10);
  });

  it('cancelling a fractional POSTED bill reopens quantity capacity', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10000, 10);
    const billAId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);
    const billBId = await draftBillWithLine(purchaseOrderId, lineId, '3.5000', 1000);
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billAId });
    await postSupplierBill({ organisationId: ORG, userId: USER, supplierBillId: billBId });
    expect(await postedBilledQuantity(lineId)).toBe('10.0000');

    await cancelSupplierBill({
      organisationId: ORG,
      userId: USER,
      supplierBillId: billAId,
      reason: 'Fractional correction',
    });
    expect(await postedBilledQuantity(lineId)).toBe('3.5000');

    const billCId = await draftBillWithLine(purchaseOrderId, lineId, '6.5000', 1000);
    const posted = await postSupplierBill({
      organisationId: ORG,
      userId: USER,
      supplierBillId: billCId,
    });
    expect(posted.status).toBe('POSTED');
    expect(await postedBilledQuantity(lineId)).toBe('10.0000');
  });
});
