import 'server-only';
import { NeonDbError } from '@neondatabase/serverless';
import sql from '@/lib/db';
import { getPurchaseOrder, listPurchaseOrderLines, type CommercialPurchaseOrderLine } from './purchaseOrders';
import { getSupplier } from './suppliers';
import { getProduct } from './products';
import { getTaxCode } from './taxCodes';
import { sumCents, calculateFractionalLineTotals, isValidCents } from './money';
import { parseQuantity4, quantity4ToDecimalString } from './quantity';
import { assertSupplierBillTransition, assertSupplierBillEditable, type SupplierBillStatus } from './supplierBillLifecycle';
import {
  logSupplierBillCreated, logSupplierBillUpdated, logSupplierBillDeleted,
  logSupplierBillPosted, logSupplierBillCancelled,
} from './auditLog';

// Phase C7.4 — tenant-scoped data access + business logic for
// commercial_supplier_bills/commercial_supplier_bill_lines. Same
// discipline as every other lib/commercial/*.ts module (see
// lib/commercial/purchaseReceipts.ts, which this file mirrors closely):
// organisationId is always an explicit caller-supplied parameter, every
// query is scoped by it, and structural tenant isolation (the composite
// FKs in scripts/create-commercial-supplier-bills.sql) backs up every
// application-level check rather than being the only line of defence.
//
// `import 'server-only'` above — this module imports lib/db and must
// never be reachable from a Client Component bundle.
//
// C7.4 is strictly PO-backed: every bill has a NOT NULL
// source_purchase_order_id, and every bill line has a NOT NULL
// source_purchase_order_line_id — there is no standalone-bill path and
// no unmatched-line path anywhere in this file. No supplier payment, no
// payment allocation, no 3-way match/allocation table exists here — all
// explicitly out of C7.4 scope.
//
// Supplier and currency consistency are enforced STRUCTURALLY, not by a
// runtime check alone: createSupplierBill() below has no
// client-supplied supplierId or currency parameter at all — both are
// always copied directly from the linked purchase order, so there is no
// code path capable of writing a bill that disagrees with its own PO on
// either value. The database's own composite FK
// (commercial_supplier_bills_po_supplier_fkey, see the schema's Section
// 0 retrofit) makes the supplier side of this a structural guarantee
// even against a hypothetical future write path that bypassed this
// module.

export interface CommercialSupplierBill {
  id: string;
  organisation_id: string;
  supplier_id: string;
  source_purchase_order_id: string;
  supplier_invoice_number: string;
  supplier_invoice_number_canonical: string;
  bill_number: string | null;
  status: SupplierBillStatus;
  currency: string;
  bill_date: string | null;
  due_date: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  supplier_name_snapshot: string | null;
  supplier_legal_name_snapshot: string | null;
  supplier_contact_name_snapshot: string | null;
  supplier_email_snapshot: string | null;
  supplier_phone_snapshot: string | null;
  supplier_address_snapshot: string | null;
  supplier_tax_business_number_snapshot: string | null;
  supplier_reference_snapshot: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  posted_by: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  cancelled_at: string | null;
}

export interface CommercialSupplierBillLine {
  id: string;
  organisation_id: string;
  supplier_bill_id: string;
  source_purchase_order_line_id: string;
  product_id: string | null;
  position: number;
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity: string; // NUMERIC(14,4) — string from the driver, never coerced to float for money arithmetic
  unit_price_cents: number;
  tax_code_snapshot: string | null;
  tax_rate_snapshot: string; // NUMERIC(5,2) — string from the driver, never coerced to float
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
  created_at: string;
  updated_at: string;
}

const DUPLICATE_SUPPLIER_INVOICE_CONSTRAINT = 'commercial_supplier_bills_supplier_invoice_unique';

// Matched narrowly (constraint name, not just any 23505), mirroring
// lib/hr/validation.ts's isLinkedUserUniqueViolation() precedent exactly
// — an unrelated unique violation must fall through to generic handling.
function isDuplicateSupplierInvoiceNumberViolation(err: unknown): boolean {
  return err instanceof NeonDbError
    && err.code === '23505'
    && err.constraint === DUPLICATE_SUPPLIER_INVOICE_CONSTRAINT;
}

function computeLineTotals(unitPriceCents: number, quantity: string | number, taxRatePercent: number) {
  const quantityScaled = parseQuantity4(quantity);
  const totals = calculateFractionalLineTotals({ unitPriceCents, quantityScaled, taxRatePercent });
  return {
    quantity: quantity4ToDecimalString(quantityScaled),
    line_subtotal_cents: totals.lineSubtotalCents,
    line_tax_cents: totals.lineTaxCents,
    line_total_cents: totals.lineTotalCents,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────

export async function listSupplierBills(organisationId: string, opts: { status?: SupplierBillStatus } = {}): Promise<CommercialSupplierBill[]> {
  if (opts.status) {
    return (await sql`
      SELECT * FROM commercial_supplier_bills WHERE organisation_id = ${organisationId} AND status = ${opts.status}
      ORDER BY created_at DESC
    `) as CommercialSupplierBill[];
  }
  return (await sql`
    SELECT * FROM commercial_supplier_bills WHERE organisation_id = ${organisationId} ORDER BY created_at DESC
  `) as CommercialSupplierBill[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — matching every other Commercial get*()
// function's identical tenant-isolation discipline.
export async function getSupplierBill(organisationId: string, supplierBillId: string): Promise<CommercialSupplierBill | null> {
  const rows = (await sql`
    SELECT * FROM commercial_supplier_bills WHERE id = ${supplierBillId} AND organisation_id = ${organisationId}
  `) as CommercialSupplierBill[];
  return rows[0] ?? null;
}

export async function listSupplierBillLines(organisationId: string, supplierBillId: string): Promise<CommercialSupplierBillLine[]> {
  return (await sql`
    SELECT * FROM commercial_supplier_bill_lines
    WHERE supplier_bill_id = ${supplierBillId} AND organisation_id = ${organisationId}
    ORDER BY position ASC
  `) as CommercialSupplierBillLine[];
}

export async function getSupplierBillWithLines(
  organisationId: string, supplierBillId: string,
): Promise<{ supplierBill: CommercialSupplierBill; lines: CommercialSupplierBillLine[] } | null> {
  const supplierBill = await getSupplierBill(organisationId, supplierBillId);
  if (!supplierBill) return null;
  const lines = await listSupplierBillLines(organisationId, supplierBillId);
  return { supplierBill, lines };
}

// Used by the PO detail page's "linked bills" panel and
// GET /api/commercial/purchase-orders/[id]/bills.
export async function listSupplierBillsForPurchaseOrder(organisationId: string, purchaseOrderId: string): Promise<CommercialSupplierBill[]> {
  return (await sql`
    SELECT * FROM commercial_supplier_bills
    WHERE organisation_id = ${organisationId} AND source_purchase_order_id = ${purchaseOrderId}
    ORDER BY created_at DESC
  `) as CommercialSupplierBill[];
}

// Billed-to-date, per PO line, in cents, DERIVED from POSTED (non-
// cancelled — cancelling a bill simply removes it from this filter,
// which is how "cancellation removes the bill from billed-to-date"
// works, with zero extra bookkeeping) bill lines only. NEVER a stored/
// cached column — see scripts/create-commercial-supplier-bills.sql's own
// header for why this must stay derived (tests/containment/
// commercialPurchasingSchema.test.ts's existing negative assertions on
// commercial_purchase_orders/commercial_purchase_order_lines depend on
// no such column ever being added there). VALUE-based (line_total_cents),
// not quantity-based, per the C7.4 brief's explicit instruction.
export async function getBilledAmountsForPurchaseOrder(
  organisationId: string, purchaseOrderId: string,
): Promise<Record<string, number>> {
  const rows = (await sql`
    SELECT csbl.source_purchase_order_line_id AS line_id, COALESCE(SUM(csbl.line_total_cents), 0) AS cents
    FROM commercial_supplier_bill_lines csbl
    JOIN commercial_supplier_bills csb ON csb.id = csbl.supplier_bill_id AND csb.organisation_id = csbl.organisation_id
    WHERE csbl.organisation_id = ${organisationId} AND csb.source_purchase_order_id = ${purchaseOrderId} AND csb.status = 'POSTED'
    GROUP BY csbl.source_purchase_order_line_id
  `) as { line_id: string; cents: string }[];

  const result: Record<string, number> = {};
  for (const row of rows) result[row.line_id] = Number(row.cents);
  return result;
}

// Total posted billed amount across the whole PO — a simple sum of the
// per-line map above, exposed separately since the PO detail page and
// the bill list both want "one number" without re-deriving it themselves.
export async function getTotalPostedBilledForPurchaseOrder(organisationId: string, purchaseOrderId: string): Promise<number> {
  const amounts = await getBilledAmountsForPurchaseOrder(organisationId, purchaseOrderId);
  return sumCents(Object.values(amounts));
}

// ── Header CRUD ──────────────────────────────────────────────────────

// C7.4 is strictly PO-backed and only an ISSUED purchase order may
// accept bills at all — mirrors createPurchaseReceipt()'s identical
// precondition. supplierId and currency are NEVER accepted as
// parameters here — both are always copied from the live PO row, so
// there is no way to construct a bill that disagrees with its own PO on
// either value (see this file's own header comment).
export async function createSupplierBill(params: {
  organisationId: string;
  userId: string;
  purchaseOrderId: string;
  supplierInvoiceNumber: string;
  billDate?: string | null;
  dueDate?: string | null;
}): Promise<CommercialSupplierBill> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase_order_id not found for this organisation');
  if (purchaseOrder.status !== 'ISSUED') {
    throw new Error(`Purchase order is ${purchaseOrder.status} — a supplier bill can only be created against an ISSUED purchase order.`);
  }

  const trimmedInvoiceNumber = params.supplierInvoiceNumber.trim();
  if (!trimmedInvoiceNumber) throw new Error('supplierInvoiceNumber is required');

  try {
    const rows = (await sql`
      INSERT INTO commercial_supplier_bills (
        organisation_id, supplier_id, source_purchase_order_id, supplier_invoice_number,
        currency, bill_date, due_date, created_by
      ) VALUES (
        ${params.organisationId}, ${purchaseOrder.supplier_id}, ${params.purchaseOrderId}, ${trimmedInvoiceNumber},
        ${purchaseOrder.currency}, ${params.billDate ?? null}, ${params.dueDate ?? null}, ${params.userId}
      )
      RETURNING *
    `) as CommercialSupplierBill[];
    const supplierBill = rows[0];

    await logSupplierBillCreated({
      organisationId: params.organisationId, userId: params.userId, supplierBillId: supplierBill.id,
      after: { source_purchase_order_id: supplierBill.source_purchase_order_id, supplier_invoice_number: supplierBill.supplier_invoice_number },
    });

    return supplierBill;
  } catch (err) {
    if (isDuplicateSupplierInvoiceNumberViolation(err)) {
      throw new Error('This supplier invoice number has already been recorded for this supplier.');
    }
    throw err;
  }
}

// DRAFT-only. source_purchase_order_id/supplier_id/currency are fixed at
// creation time — never changeable (see this file's own header comment
// on why those three are never even accepted as parameters here either).
export async function updateDraftSupplierBill(params: {
  organisationId: string;
  userId: string;
  supplierBillId: string;
  supplierInvoiceNumber?: string;
  billDate?: string | null;
  dueDate?: string | null;
}): Promise<CommercialSupplierBill | null> {
  const before = await getSupplierBill(params.organisationId, params.supplierBillId);
  if (!before) return null;
  assertSupplierBillEditable(before.status);

  const trimmedInvoiceNumber = params.supplierInvoiceNumber !== undefined ? params.supplierInvoiceNumber.trim() : undefined;
  if (trimmedInvoiceNumber !== undefined && !trimmedInvoiceNumber) {
    throw new Error('supplierInvoiceNumber cannot be blank');
  }

  try {
    const rows = (await sql`
      UPDATE commercial_supplier_bills SET
        supplier_invoice_number = COALESCE(${trimmedInvoiceNumber ?? null}, supplier_invoice_number),
        bill_date = COALESCE(${params.billDate}, bill_date),
        due_date = COALESCE(${params.dueDate}, due_date),
        updated_at = now()
      WHERE id = ${params.supplierBillId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      RETURNING *
    `) as CommercialSupplierBill[];
    const after = rows[0];
    if (!after) return null;

    await logSupplierBillUpdated({
      organisationId: params.organisationId, userId: params.userId, supplierBillId: params.supplierBillId,
      before: { supplier_invoice_number: before.supplier_invoice_number }, after: { supplier_invoice_number: after.supplier_invoice_number },
    });

    return after;
  } catch (err) {
    if (isDuplicateSupplierInvoiceNumberViolation(err)) {
      throw new Error('This supplier invoice number has already been recorded for this supplier.');
    }
    throw err;
  }
}

// Safe discard/delete for a never-posted DRAFT, mirroring
// deletePurchaseReceipt() exactly (same status-gated-in-the-WHERE-clause
// shape, same hard DELETE, same draft-only audit event).
// commercial_supplier_bill_lines has ON DELETE CASCADE onto this table,
// so line rows are cleaned up atomically by the database itself.
export async function deleteSupplierBill(params: {
  organisationId: string; userId: string; supplierBillId: string;
}): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM commercial_supplier_bills
    WHERE id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
      AND status = 'DRAFT' AND bill_number IS NULL
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logSupplierBillDeleted({ organisationId: params.organisationId, userId: params.userId, supplierBillId: params.supplierBillId });
  return true;
}

// ── Lines ─────────────────────────────────────────────────────────────
//
// source_purchase_order_line_id is REQUIRED (never optional) — the same
// C7.3 correction applied here: a normal bill line MUST reference a
// concrete PO line. Unlike a receipt line (a pure quantity fact), a bill
// line carries its own quantity/unit_price_cents/tax — the supplier's
// ACTUAL invoiced amount for this line, which may legitimately differ
// from what was ordered (this is exactly what the over-billing guard at
// post time checks against, not what line-add itself enforces).

async function recalculateSupplierBillTotals(organisationId: string, supplierBillId: string): Promise<void> {
  const lines = await listSupplierBillLines(organisationId, supplierBillId);
  const subtotal = sumCents(lines.map(l => l.line_subtotal_cents));
  const tax = sumCents(lines.map(l => l.line_tax_cents));
  const total = sumCents(lines.map(l => l.line_total_cents));
  await sql`
    UPDATE commercial_supplier_bills SET subtotal_cents = ${subtotal}, tax_cents = ${tax}, total_cents = ${total}, updated_at = now()
    WHERE id = ${supplierBillId} AND organisation_id = ${organisationId}
  `;
}

// Fetches the PO line and verifies BOTH that it belongs to this
// organisation AND that its own purchase_order_id matches the bill's
// source_purchase_order_id — the composite FK alone cannot express "this
// specific bill's specific PO", only "some PO in this organisation", so
// this application-level check is required (matching lib/commercial/
// purchaseReceipts.ts's own resolveAndAssertPoLine() discipline exactly).
async function resolveAndAssertPoLine(
  organisationId: string, purchaseOrderId: string, sourcePurchaseOrderLineId: string,
): Promise<CommercialPurchaseOrderLine> {
  const lines = await listPurchaseOrderLines(organisationId, purchaseOrderId);
  const poLine = lines.find(l => l.id === sourcePurchaseOrderLineId);
  if (!poLine) {
    throw new Error('source_purchase_order_line_id not found on this purchase order for this organisation');
  }
  return poLine;
}

export async function addSupplierBillLine(params: {
  organisationId: string;
  supplierBillId: string;
  sourcePurchaseOrderLineId: string;
  productId?: string | null;
  description?: string;
  quantity: string | number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
}): Promise<CommercialSupplierBillLine> {
  const supplierBill = await getSupplierBill(params.organisationId, params.supplierBillId);
  if (!supplierBill) throw new Error('supplier bill not found for this organisation');
  assertSupplierBillEditable(supplierBill.status);

  const quantityScaled = parseQuantity4(params.quantity);
  const quantity = quantity4ToDecimalString(quantityScaled);

  const poLine = await resolveAndAssertPoLine(params.organisationId, supplierBill.source_purchase_order_id, params.sourcePurchaseOrderLineId);

  let description = params.description ?? poLine.description_snapshot;
  const sku = poLine.sku_snapshot;
  const unit = poLine.unit_snapshot;
  let unitPriceCents = params.unitPriceCents;
  let taxCodeId = params.taxCodeId ?? null;
  const productId = params.productId ?? poLine.product_id ?? null;

  if (productId) {
    const product = await getProduct(params.organisationId, productId);
    if (!product) throw new Error('product_id not found for this organisation');
    if (params.description === undefined) description = product.name;
    if (unitPriceCents === undefined) unitPriceCents = product.default_unit_price_cents;
    if (taxCodeId === null && params.taxCodeId === undefined) taxCodeId = product.default_tax_code_id;
  }

  if (unitPriceCents === undefined) unitPriceCents = poLine.unit_price_cents;
  if (!isValidCents(unitPriceCents)) throw new Error('unitPriceCents must be a non-negative integer');

  let taxCodeSnapshot: string | null = null;
  let taxRateSnapshot = 0;
  if (taxCodeId) {
    const taxCode = await getTaxCode(params.organisationId, taxCodeId);
    if (!taxCode) throw new Error('tax_code_id not found for this organisation');
    taxCodeSnapshot = taxCode.code;
    taxRateSnapshot = Number(taxCode.rate);
  } else if (params.taxCodeId === undefined) {
    // Default to the PO line's own tax snapshot when the caller did not
    // explicitly choose a tax code — a supplier bill line is usually
    // taxed the same way the order was.
    taxCodeSnapshot = poLine.tax_code_snapshot;
    taxRateSnapshot = Number(poLine.tax_rate_snapshot);
  }

  const { line_subtotal_cents, line_tax_cents, line_total_cents } = computeLineTotals(unitPriceCents, quantity, taxRateSnapshot);

  const [{ next_position }] = (await sql`
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM commercial_supplier_bill_lines
    WHERE supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
  `) as { next_position: number }[];

  const rows = (await sql`
    INSERT INTO commercial_supplier_bill_lines (
      organisation_id, supplier_bill_id, source_purchase_order_line_id, product_id, position,
      description_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price_cents,
      tax_code_snapshot, tax_rate_snapshot, line_subtotal_cents, line_tax_cents, line_total_cents
    ) VALUES (
      ${params.organisationId}, ${params.supplierBillId}, ${params.sourcePurchaseOrderLineId}, ${productId}, ${next_position},
      ${description}, ${sku}, ${unit}, ${quantity}::numeric(14,4), ${unitPriceCents},
      ${taxCodeSnapshot}, ${taxRateSnapshot}, ${line_subtotal_cents}, ${line_tax_cents}, ${line_total_cents}
    )
    RETURNING *
  `) as CommercialSupplierBillLine[];

  await recalculateSupplierBillTotals(params.organisationId, params.supplierBillId);
  return rows[0];
}

// Only description/quantity/unitPriceCents/taxCodeId may change on an
// existing line — source_purchase_order_line_id and product_id are
// fixed at line-creation time.
export async function updateSupplierBillLine(params: {
  organisationId: string;
  supplierBillId: string;
  lineId: string;
  description?: string;
  quantity?: string | number;
  unitPriceCents?: number;
  taxCodeId?: string | null;
}): Promise<CommercialSupplierBillLine | null> {
  const supplierBill = await getSupplierBill(params.organisationId, params.supplierBillId);
  if (!supplierBill) return null;
  assertSupplierBillEditable(supplierBill.status);

  const existingRows = (await sql`
    SELECT * FROM commercial_supplier_bill_lines
    WHERE id = ${params.lineId} AND supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
  `) as CommercialSupplierBillLine[];
  const existing = existingRows[0];
  if (!existing) return null;

  const quantityScaled = parseQuantity4(params.quantity ?? existing.quantity);
  const quantity = quantity4ToDecimalString(quantityScaled);

  const unitPriceCents = params.unitPriceCents ?? existing.unit_price_cents;
  if (!isValidCents(unitPriceCents)) throw new Error('unitPriceCents must be a non-negative integer');

  let taxCodeSnapshot = existing.tax_code_snapshot;
  let taxRateSnapshot = Number(existing.tax_rate_snapshot);
  if (params.taxCodeId !== undefined) {
    if (params.taxCodeId) {
      const taxCode = await getTaxCode(params.organisationId, params.taxCodeId);
      if (!taxCode) throw new Error('tax_code_id not found for this organisation');
      taxCodeSnapshot = taxCode.code;
      taxRateSnapshot = Number(taxCode.rate);
    } else {
      taxCodeSnapshot = null;
      taxRateSnapshot = 0;
    }
  }

  const { line_subtotal_cents, line_tax_cents, line_total_cents } = computeLineTotals(unitPriceCents, quantity, taxRateSnapshot);

  const rows = (await sql`
    UPDATE commercial_supplier_bill_lines SET
      description_snapshot = COALESCE(${params.description ?? null}, description_snapshot),
      quantity = ${quantity}::numeric(14,4),
      unit_price_cents = ${unitPriceCents},
      tax_code_snapshot = ${taxCodeSnapshot},
      tax_rate_snapshot = ${taxRateSnapshot},
      line_subtotal_cents = ${line_subtotal_cents},
      line_tax_cents = ${line_tax_cents},
      line_total_cents = ${line_total_cents},
      updated_at = now()
    WHERE id = ${params.lineId} AND supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialSupplierBillLine[];

  await recalculateSupplierBillTotals(params.organisationId, params.supplierBillId);
  return rows[0] ?? null;
}

export async function deleteSupplierBillLine(params: { organisationId: string; supplierBillId: string; lineId: string }): Promise<boolean> {
  const supplierBill = await getSupplierBill(params.organisationId, params.supplierBillId);
  if (!supplierBill) return false;
  assertSupplierBillEditable(supplierBill.status);

  const rows = (await sql`
    DELETE FROM commercial_supplier_bill_lines
    WHERE id = ${params.lineId} AND supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await recalculateSupplierBillTotals(params.organisationId, params.supplierBillId);
  return true;
}

// ── Posting (the concurrency-critical operation) ────────────────────
//
// Phase C7.5C — strict, non-configurable quantity + value over-billing guard. A simple
// read-then-check or aggregate CTE is NOT sufficient (two concurrent
// posts could each read the same "not yet over" aggregate and both
// proceed) — see scripts/tests/supplierBillConcurrency.integration.test.ts
// for the real-Postgres proof this exact statement shape is required to
// pass. One compound, atomic SQL statement:
//   1. locks the bill row (must still be DRAFT) with FOR UPDATE
//   2. locks the parent PO row (must still be ISSUED) with FOR UPDATE
//   3. locks every PO line row this bill's own lines reference, in
//      deterministic id order, with FOR UPDATE (the standard two-
//      transactions-locking-overlapping-rows deadlock-avoidance idiom)
//   4. AFTER all locks are held, recomputes already-POSTED (excluding
//      this bill, excluding CANCELLED bills) billed VALUE per PO line
//      (line_total_cents, not quantity — a supplier bill is a money
//      fact) and adds this bill's own queued line amounts
//   5. rejects (the whole statement allocates nothing and flips
//      nothing) if any line's running total would exceed the PO line's
//      own ordered line_total_cents
//   6. only if every line is within its ordered value does it allocate
//      the next SUPPLIER_BILL document number and flip the bill to
//      POSTED, in the same statement
//
// The document-sequence seed INSERT is a SEPARATE statement, issued
// BEFORE this atomic WITH-chain — Postgres does not guarantee an
// unreferenced data-modifying CTE executes, so seeding the counter row
// cannot itself live inside the same statement as the conditional
// UPDATE that increments it. Mirrors issuePurchaseOrderAtomically()'s
// (lib/commercial/purchaseOrders.ts) and
// postPurchaseReceiptAtomically()'s (lib/commercial/purchaseReceipts.ts)
// own identical two-statement shape exactly.
//
// The supplier snapshot is frozen HERE, at POST time (not at bill
// creation, unlike receipts which have no snapshot at all) — the caller
// (postSupplierBill() below) fetches the CURRENT commercial_suppliers
// row before calling this function and passes it in, mirroring
// issuePurchaseOrderAtomically()'s own `supplier` parameter shape
// exactly.
async function postSupplierBillAtomically(params: {
  organisationId: string;
  supplierBillId: string;
  userId: string;
  supplier: {
    name: string;
    legal_name: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    billing_address: string | null;
    tax_business_number: string | null;
    supplier_reference: string | null;
  };
}): Promise<CommercialSupplierBill | null> {
  // Unconditional, idempotent, and harmless regardless of the target
  // bill's status — this only guarantees a counter row exists to
  // increment; it can never itself consume or leak a number.
  await sql`
    INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
    VALUES (${params.organisationId}, 'SUPPLIER_BILL', 'BILL-', 1, 6)
    ON CONFLICT (organisation_id, document_type) DO NOTHING
  `;

  const rows = (await sql`
    WITH bill_guard AS (
      SELECT id, source_purchase_order_id FROM commercial_supplier_bills
      WHERE id = ${params.supplierBillId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      FOR UPDATE
    ),
    po_guard AS (
      SELECT cpo.id FROM commercial_purchase_orders cpo
      WHERE cpo.id = (SELECT source_purchase_order_id FROM bill_guard)
        AND cpo.organisation_id = ${params.organisationId} AND cpo.status = 'ISSUED'
      FOR UPDATE
    ),
    affected_line_ids AS (
      SELECT DISTINCT source_purchase_order_line_id AS line_id
      FROM commercial_supplier_bill_lines
      WHERE supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
    ),
    locked_lines AS (
      SELECT cpol.id, cpol.quantity::numeric(14,4) AS ordered_quantity,
        cpol.line_total_cents AS ordered_value_cents
      FROM commercial_purchase_order_lines cpol
      WHERE cpol.organisation_id = ${params.organisationId}
        AND cpol.id IN (SELECT line_id FROM affected_line_ids)
      ORDER BY cpol.id
      FOR UPDATE
    ),
    already_posted AS (
      SELECT csbl.source_purchase_order_line_id AS line_id,
        COALESCE(SUM(csbl.quantity), 0)::numeric(14,4) AS quantity,
        COALESCE(SUM(csbl.line_total_cents), 0) AS cents
      FROM commercial_supplier_bill_lines csbl
      JOIN commercial_supplier_bills csb ON csb.id = csbl.supplier_bill_id AND csb.organisation_id = csbl.organisation_id
      WHERE csbl.organisation_id = ${params.organisationId} AND csb.status = 'POSTED'
        AND csbl.supplier_bill_id <> ${params.supplierBillId}
        AND csbl.source_purchase_order_line_id IN (SELECT line_id FROM affected_line_ids)
      GROUP BY csbl.source_purchase_order_line_id
    ),
    this_bill_amount AS (
      SELECT source_purchase_order_line_id AS line_id,
        COALESCE(SUM(quantity), 0)::numeric(14,4) AS quantity,
        SUM(line_total_cents) AS cents
      FROM commercial_supplier_bill_lines
      WHERE supplier_bill_id = ${params.supplierBillId} AND organisation_id = ${params.organisationId}
      GROUP BY source_purchase_order_line_id
    ),
    totals AS (
      SELECT ll.id AS line_id, ll.ordered_quantity, ll.ordered_value_cents,
        COALESCE(ap.quantity, 0) + COALESCE(tb.quantity, 0) AS total_after_quantity,
        COALESCE(ap.cents, 0) + COALESCE(tb.cents, 0) AS total_after_cents
      FROM locked_lines ll
      LEFT JOIN already_posted ap ON ap.line_id = ll.id
      LEFT JOIN this_bill_amount tb ON tb.line_id = ll.id
    ),
    validation AS (
      SELECT COUNT(*) AS line_count,
        COALESCE(bool_and(total_after_quantity <= ordered_quantity), false) AS all_within_quantity,
        COALESCE(bool_and(total_after_cents <= ordered_value_cents), false) AS all_within_value
      FROM totals
    ),
    alloc AS (
      UPDATE commercial_document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organisation_id = ${params.organisationId} AND document_type = 'SUPPLIER_BILL'
        AND EXISTS (SELECT 1 FROM bill_guard)
        AND EXISTS (SELECT 1 FROM po_guard)
        AND EXISTS (
          SELECT 1 FROM validation
          WHERE line_count > 0 AND all_within_quantity = true AND all_within_value = true
        )
      RETURNING (next_number - 1) AS allocated_number, prefix, padding
    )
    UPDATE commercial_supplier_bills SET
      status = 'POSTED',
      bill_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM alloc),
      posted_by = ${params.userId}, posted_at = now(), updated_at = now(),
      supplier_name_snapshot = ${params.supplier.name},
      supplier_legal_name_snapshot = ${params.supplier.legal_name},
      supplier_contact_name_snapshot = ${params.supplier.contact_name},
      supplier_email_snapshot = ${params.supplier.email},
      supplier_phone_snapshot = ${params.supplier.phone},
      supplier_address_snapshot = ${params.supplier.billing_address},
      supplier_tax_business_number_snapshot = ${params.supplier.tax_business_number},
      supplier_reference_snapshot = ${params.supplier.supplier_reference}
    WHERE id = ${params.supplierBillId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      AND EXISTS (SELECT 1 FROM alloc)
    RETURNING *
  `) as CommercialSupplierBill[];

  return rows[0] ?? null;
}

// admin+ (approve floor) — posting a supplier bill is a higher-trust
// action than creating/editing a draft, per the C7.4 capability matrix
// (distinct from purchase receipts, where posting is manager+). The
// precondition checks below run BEFORE the atomic statement purely to
// produce a clear, specific error message — the atomic statement above
// is the sole authority that actually decides whether the post is safe
// to apply.
export async function postSupplierBill(params: {
  organisationId: string; userId: string; supplierBillId: string;
}): Promise<CommercialSupplierBill> {
  const bundle = await getSupplierBillWithLines(params.organisationId, params.supplierBillId);
  if (!bundle) throw new Error('supplier bill not found for this organisation');
  const { supplierBill, lines } = bundle;
  assertSupplierBillTransition(supplierBill.status, 'POSTED');
  if (lines.length === 0) throw new Error('cannot post a supplier bill with no lines');

  const supplier = await getSupplier(params.organisationId, supplierBill.supplier_id);
  if (!supplier) throw new Error('supplier not found for this organisation');

  const posted = await postSupplierBillAtomically({
    organisationId: params.organisationId, supplierBillId: params.supplierBillId, userId: params.userId, supplier,
  });

  if (!posted) {
    // The atomic statement inserted/updated nothing — determine why, for
    // a clear error message only (this read is NOT the authorization
    // decision; that already happened, correctly, inside the atomic
    // statement above).
    const current = await getSupplierBill(params.organisationId, params.supplierBillId);
    if (!current || current.status !== 'DRAFT') {
      throw new Error('supplier bill status changed concurrently; post aborted');
    }
    const po = await getPurchaseOrder(params.organisationId, current.source_purchase_order_id);
    if (!po || po.status !== 'ISSUED') {
      throw new Error(`Purchase order is ${po?.status ?? 'not found'} — a supplier bill can only be posted while its purchase order is ISSUED.`);
    }
    throw new Error('One or more lines on this bill would bill beyond the ordered value or quantity of the linked purchase order line (including POSTED amounts/quantities on other bills for the same purchase order line). Reduce the bill and try again.');
  }

  await logSupplierBillPosted({
    organisationId: params.organisationId, userId: params.userId, supplierBillId: params.supplierBillId,
    billNumber: posted.bill_number!, totalCents: posted.total_cents,
  });

  return posted;
}

// admin+ (approve floor, matching cancelSupplierBill()'s own floor as
// stated in the C7.4 capability matrix) — only a POSTED bill may be
// cancelled; a non-empty, trimmed cancel_reason is mandatory. Never
// hard-deletes, never renumbers. No supplier payments exist yet in this
// phase, so there is no payment-reversal blocking to implement — see the
// C7.4 brief's own explicit note. Cancelling a bill automatically
// removes it from billed-to-date, for free, by construction:
// getBilledAmountsForPurchaseOrder() only ever sums status = 'POSTED'
// lines, so a CANCELLED bill's amounts simply stop counting the moment
// this UPDATE commits — no separate reversal bookkeeping exists or is
// needed.
export async function cancelSupplierBill(params: {
  organisationId: string; userId: string; supplierBillId: string; reason: string;
}): Promise<CommercialSupplierBill> {
  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error('cancel_reason is required');

  const supplierBill = await getSupplierBill(params.organisationId, params.supplierBillId);
  if (!supplierBill) throw new Error('supplier bill not found for this organisation');
  assertSupplierBillTransition(supplierBill.status, 'CANCELLED');

  const rows = (await sql`
    UPDATE commercial_supplier_bills SET
      status = 'CANCELLED', cancelled_by = ${params.userId}, cancelled_at = now(), cancel_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.supplierBillId} AND organisation_id = ${params.organisationId} AND status = 'POSTED'
    RETURNING *
  `) as CommercialSupplierBill[];
  const cancelled = rows[0];
  if (!cancelled) throw new Error('supplier bill status changed concurrently; cancel aborted');

  await logSupplierBillCancelled({
    organisationId: params.organisationId, userId: params.userId, supplierBillId: params.supplierBillId, cancelReason: trimmedReason,
  });

  return cancelled;
}
