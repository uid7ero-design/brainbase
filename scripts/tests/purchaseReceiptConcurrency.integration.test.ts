import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Phase C7.3 — real disposable-Postgres proof that two concurrent
// `postPurchaseReceipt()` calls against receipts drawing on the SAME
// purchase-order line cannot together over-receive it, and that a
// concurrent receipt-post and PO-cancel cannot leave the system in an
// inconsistent state (a CANCELLED purchase order with a POSTED receipt
// against it, or vice versa).
//
// WHY THIS EXISTS: the entire over-receipt guard is enforced by real
// Postgres row-level locking (FOR UPDATE on the receipt row, the PO row,
// and every affected PO line row, in deterministic id order) inside one
// atomic writable-CTE statement — see postPurchaseReceiptAtomically() in
// lib/commercial/purchaseReceipts.ts. A mocked sql client can simulate
// the RESULT of a race but cannot prove the race itself is actually
// race-safe — only real MVCC/locking semantics can. Likewise, the
// PO-cancel-vs-receipt-post mutual exclusion relies on both operations
// taking a FOR UPDATE lock on the SAME purchase-order row — again only
// provable against a real database.
//
// Run ONLY via scripts/tests/verify-purchase-receipt-concurrency.sh,
// which creates the disposable postgres:16-alpine container, applies the
// real Commercial Core/Purchasing/Purchase-Receipts schema, and exports
// DATABASE_URL before this file is ever imported.
//
// TEST SEAM (mirrors scripts/tests/organiserConfirmationReplay
// .integration.test.ts's own established pattern): lib/db's tagged-
// template `sql` — the only thing lib/commercial/purchaseOrders.ts and
// lib/commercial/purchaseReceipts.ts import for persistence — is
// replaced by a Prisma-backed equivalent so the real, completely
// unmodified domain functions run their real SQL against this real
// Postgres container.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'purchaseReceiptConcurrency.integration.test.ts requires DATABASE_URL to point at a disposable ' +
      'Postgres container (see scripts/tests/verify-purchase-receipt-concurrency.sh). Refusing to run without it.'
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

// See organiserConfirmationReplay.integration.test.ts's own identical
// comment: Prisma's $queryRawUnsafe sends an explicit `text` type OID for
// string parameters, unlike the real Neon driver (which lets Postgres
// infer types) — auto-casting UUID-shaped string parameters to ::uuid
// reproduces the real driver's own inference for every UUID column this
// schema uses, with zero change to the real SQL text the domain layer
// itself emits.
const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return prisma.$queryRawUnsafe(text, ...values);
}

vi.doMock('@/lib/db', () => ({ default: neonCompatibleSql }));

let createPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').createPurchaseOrder;
let addPurchaseOrderLine: typeof import('@/lib/commercial/purchaseOrders').addPurchaseOrderLine;
let submitPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').submitPurchaseOrder;
let approvePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').approvePurchaseOrder;
let issuePurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').issuePurchaseOrder;
let cancelPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').cancelPurchaseOrder;
let getPurchaseOrder: typeof import('@/lib/commercial/purchaseOrders').getPurchaseOrder;
let createPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').createPurchaseReceipt;
let addPurchaseReceiptLine: typeof import('@/lib/commercial/purchaseReceipts').addPurchaseReceiptLine;
let postPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').postPurchaseReceipt;
let cancelPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').cancelPurchaseReceipt;
let getPurchaseReceipt: typeof import('@/lib/commercial/purchaseReceipts').getPurchaseReceipt;
let getReceivedQuantitiesForPurchaseOrder: typeof import('@/lib/commercial/purchaseReceipts').getReceivedQuantitiesForPurchaseOrder;

const ORG = 'org-a';
const USER = 'user-1';

beforeAll(async () => {
  ({ createPurchaseOrder, addPurchaseOrderLine, submitPurchaseOrder, approvePurchaseOrder, issuePurchaseOrder, cancelPurchaseOrder, getPurchaseOrder } = await import('@/lib/commercial/purchaseOrders'));
  ({ createPurchaseReceipt, addPurchaseReceiptLine, postPurchaseReceipt, cancelPurchaseReceipt, getPurchaseReceipt, getReceivedQuantitiesForPurchaseOrder } = await import('@/lib/commercial/purchaseReceipts'));

  await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a') ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, organisation_id, username, name) VALUES ('user-1', 'org-a', 'user-1', 'User One') ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function freshIssuedPoWithLine(qty: number): Promise<{ purchaseOrderId: string; lineId: string }> {
  const supplierRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_suppliers (organisation_id, name) VALUES ($1, 'Concurrency Test Supplier') RETURNING id`, ORG,
  );
  const supplierId = supplierRows[0].id;

  const po = await createPurchaseOrder({ organisationId: ORG, userId: USER, supplierId });
  const line = await addPurchaseOrderLine({ organisationId: ORG, purchaseOrderId: po.id, description: 'Widget', quantity: qty, unitPriceCents: 1000 });
  await submitPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await approvePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });
  await issuePurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId: po.id });

  return { purchaseOrderId: po.id, lineId: line.id };
}

async function draftReceiptWithLine(purchaseOrderId: string, lineId: string, quantityReceived: number): Promise<string> {
  const receipt = await createPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseOrderId });
  await addPurchaseReceiptLine({ organisationId: ORG, purchaseReceiptId: receipt.id, sourcePurchaseOrderLineId: lineId, quantityReceived });
  return receipt.id;
}

describe('C7.3 — real-Postgres purchase receipt posting concurrency', () => {
  it('rejects strict over-receipt in a plain sequential case', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receiptAId = await draftReceiptWithLine(purchaseOrderId, lineId, 7);
    const receiptBId = await draftReceiptWithLine(purchaseOrderId, lineId, 7);

    const posted = await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptAId });
    expect(posted.status).toBe('POSTED');
    expect(posted.receipt_number).toBeTruthy();

    await expect(postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptBId }))
      .rejects.toThrow(/would receive more than the ordered quantity/);

    const stillDraft = await getPurchaseReceipt(ORG, receiptBId);
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('TWO CONCURRENT posts against the same PO line cannot together over-receive it — exactly one wins', async () => {
    // Ordered quantity 10; two draft receipts each requesting 6 — only
    // one can be POSTED, since together they total 12 > 10. A simple
    // read-then-check would let both pass (each individually sees 0
    // already-posted at read time); only real FOR UPDATE row locking,
    // acquired inside one atomic statement, can serialize this correctly.
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receiptAId = await draftReceiptWithLine(purchaseOrderId, lineId, 6);
    const receiptBId = await draftReceiptWithLine(purchaseOrderId, lineId, 6);

    const results = await Promise.allSettled([
      postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptAId }),
      postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptBId }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/would receive more than the ordered quantity/);

    // Real row-count proof, not just the promise outcomes: exactly one of
    // the two receipts is POSTED in the database, the other is still DRAFT.
    const [a, b] = await Promise.all([getPurchaseReceipt(ORG, receiptAId), getPurchaseReceipt(ORG, receiptBId)]);
    const statuses = [a?.status, b?.status].sort();
    expect(statuses).toEqual(['DRAFT', 'POSTED']);

    // Received-to-date reflects only the winning receipt's quantity —
    // never both, never neither.
    const received = await getReceivedQuantitiesForPurchaseOrder(ORG, purchaseOrderId);
    expect(received[lineId]).toBe(6);
  });

  it('TWO CONCURRENT posts that would NOT jointly over-receive can both succeed', async () => {
    // Control case proving the guard is not simply "only one receipt per
    // PO line can ever post" — 4 + 4 against an ordered quantity of 10
    // must both succeed.
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receiptAId = await draftReceiptWithLine(purchaseOrderId, lineId, 4);
    const receiptBId = await draftReceiptWithLine(purchaseOrderId, lineId, 4);

    const results = await Promise.allSettled([
      postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptAId }),
      postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptBId }),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);

    const received = await getReceivedQuantitiesForPurchaseOrder(ORG, purchaseOrderId);
    expect(received[lineId]).toBe(8);
  });

  it('cancelling a POSTED receipt reopens the quantity for a later receipt', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(10);
    const receiptAId = await draftReceiptWithLine(purchaseOrderId, lineId, 10);
    await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptAId });

    const receiptBId = await draftReceiptWithLine(purchaseOrderId, lineId, 10);
    await expect(postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptBId }))
      .rejects.toThrow(/would receive more than the ordered quantity/);

    await cancelPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptAId, reason: 'Damaged goods returned to supplier' });

    const receivedAfterCancel = await getReceivedQuantitiesForPurchaseOrder(ORG, purchaseOrderId);
    expect(receivedAfterCancel[lineId] ?? 0).toBe(0);

    const posted = await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptBId });
    expect(posted.status).toBe('POSTED');
  });

  it('an ISSUED purchase order with a POSTED receipt cannot be cancelled (sequential)', async () => {
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(5);
    const receiptId = await draftReceiptWithLine(purchaseOrderId, lineId, 5);
    await postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptId });

    await expect(cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'No longer needed' }))
      .rejects.toThrow(/posted purchase receipts/);

    const po = await getPurchaseOrder(ORG, purchaseOrderId);
    expect(po?.status).toBe('ISSUED');

    await cancelPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptId, reason: 'Reversing to allow PO cancellation' });
    const cancelled = await cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'No longer needed' });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('CONCURRENT receipt-post and PO-cancel never leave a CANCELLED PO with a POSTED receipt against it', async () => {
    // Whichever transaction reaches the shared PO row's FOR UPDATE lock
    // first wins; the loser must re-evaluate against the now-committed
    // state and fail cleanly. The property under test is the invariant,
    // not which side wins (either outcome is a valid, consistent result).
    const { purchaseOrderId, lineId } = await freshIssuedPoWithLine(5);
    const receiptId = await draftReceiptWithLine(purchaseOrderId, lineId, 5);

    const [postResult, cancelResult] = await Promise.allSettled([
      postPurchaseReceipt({ organisationId: ORG, userId: USER, purchaseReceiptId: receiptId }),
      cancelPurchaseOrder({ organisationId: ORG, userId: USER, purchaseOrderId, reason: 'Racing the receipt post' }),
    ]);

    const po = await getPurchaseOrder(ORG, purchaseOrderId);
    const receipt = await getPurchaseReceipt(ORG, receiptId);

    // The invariant: never both POSTED+CANCELLED at once.
    expect(po?.status === 'CANCELLED' && receipt?.status === 'POSTED').toBe(false);

    if (postResult.status === 'fulfilled') {
      expect(receipt?.status).toBe('POSTED');
      expect(po?.status).toBe('ISSUED');
      expect(cancelResult.status).toBe('rejected');
    } else {
      expect(receipt?.status).toBe('DRAFT');
      expect(po?.status).toBe('CANCELLED');
      expect(cancelResult.status).toBe('fulfilled');
    }
  });
});
