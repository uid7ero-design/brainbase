import 'server-only';
import sql from '@/lib/db';
import { getPurchaseOrder, listPurchaseOrderLines, type CommercialPurchaseOrderLine } from './purchaseOrders';
import { assertPurchaseReceiptTransition, assertPurchaseReceiptEditable, type PurchaseReceiptStatus } from './purchaseReceiptLifecycle';
import {
  logPurchaseReceiptCreated, logPurchaseReceiptUpdated, logPurchaseReceiptDeleted,
  logPurchaseReceiptPosted, logPurchaseReceiptCancelled,
} from './auditLog';

// Phase C7.3 — tenant-scoped data access + business logic for
// commercial_purchase_receipts/commercial_purchase_receipt_lines. Same
// discipline as every other lib/commercial/*.ts module (see
// lib/commercial/purchaseOrders.ts, which this file mirrors closely):
// organisationId is always an explicit caller-supplied parameter (never
// resolved internally), every query is scoped by it, and structural
// tenant isolation (the composite FKs in
// scripts/create-commercial-purchase-receipts.sql) backs up every
// application-level check rather than being the only line of defence.
//
// `import 'server-only'` above — this module imports lib/db and must
// never be reachable from a Client Component bundle.
//
// C7.3 is strictly PO-backed: every receipt has a NOT NULL
// purchase_order_id, and every receipt line has a NOT NULL
// source_purchase_order_line_id — there is no standalone-receipt path
// and no unexpected/unplanned-line path anywhere in this file. No
// Supplier Bill, PO<->Bill matching, supplier payment, or budget/
// encumbrance concept exists here — all explicitly out of C7.3 scope.

export interface CommercialPurchaseReceipt {
  id: string;
  organisation_id: string;
  purchase_order_id: string;
  receipt_number: string | null;
  status: PurchaseReceiptStatus;
  received_date: string | null;
  delivery_reference: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  posted_by: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  cancelled_at: string | null;
}

export interface CommercialPurchaseReceiptLine {
  id: string;
  organisation_id: string;
  purchase_receipt_id: string;
  source_purchase_order_line_id: string;
  position: number;
  description_snapshot: string;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  quantity_received: string; // NUMERIC(14,4) — string from the driver, never coerced to float
  created_at: string;
  updated_at: string;
}

// ── Reads ─────────────────────────────────────────────────────────────

export async function listPurchaseReceipts(organisationId: string, opts: { status?: PurchaseReceiptStatus } = {}): Promise<CommercialPurchaseReceipt[]> {
  if (opts.status) {
    return (await sql`
      SELECT * FROM commercial_purchase_receipts WHERE organisation_id = ${organisationId} AND status = ${opts.status}
      ORDER BY created_at DESC
    `) as CommercialPurchaseReceipt[];
  }
  return (await sql`
    SELECT * FROM commercial_purchase_receipts WHERE organisation_id = ${organisationId} ORDER BY created_at DESC
  `) as CommercialPurchaseReceipt[];
}

// Returns null both for "does not exist" and "exists but belongs to a
// different organisation" — matching every other Commercial get*()
// function's identical tenant-isolation discipline.
export async function getPurchaseReceipt(organisationId: string, purchaseReceiptId: string): Promise<CommercialPurchaseReceipt | null> {
  const rows = (await sql`
    SELECT * FROM commercial_purchase_receipts WHERE id = ${purchaseReceiptId} AND organisation_id = ${organisationId}
  `) as CommercialPurchaseReceipt[];
  return rows[0] ?? null;
}

export async function listPurchaseReceiptLines(organisationId: string, purchaseReceiptId: string): Promise<CommercialPurchaseReceiptLine[]> {
  return (await sql`
    SELECT * FROM commercial_purchase_receipt_lines
    WHERE purchase_receipt_id = ${purchaseReceiptId} AND organisation_id = ${organisationId}
    ORDER BY position ASC
  `) as CommercialPurchaseReceiptLine[];
}

export async function getPurchaseReceiptWithLines(
  organisationId: string, purchaseReceiptId: string,
): Promise<{ purchaseReceipt: CommercialPurchaseReceipt; lines: CommercialPurchaseReceiptLine[] } | null> {
  const purchaseReceipt = await getPurchaseReceipt(organisationId, purchaseReceiptId);
  if (!purchaseReceipt) return null;
  const lines = await listPurchaseReceiptLines(organisationId, purchaseReceiptId);
  return { purchaseReceipt, lines };
}

// Used by the PO detail page's "linked receipts" panel and
// GET /api/commercial/purchase-orders/[id]/receipts.
export async function listPurchaseReceiptsForPurchaseOrder(organisationId: string, purchaseOrderId: string): Promise<CommercialPurchaseReceipt[]> {
  return (await sql`
    SELECT * FROM commercial_purchase_receipts
    WHERE organisation_id = ${organisationId} AND purchase_order_id = ${purchaseOrderId}
    ORDER BY created_at DESC
  `) as CommercialPurchaseReceipt[];
}

// Received-to-date, per PO line, DERIVED from POSTED (non-cancelled —
// cancelling a receipt simply removes it from this filter, which is how
// "receipt cancellation reopens remaining quantity" works, with zero
// extra bookkeeping) receipt lines only. NEVER a stored/cached column —
// see scripts/create-commercial-purchase-receipts.sql's own header for
// why this must stay derived (tests/containment/
// commercialPurchasingSchema.test.ts's existing negative assertions on
// commercial_purchase_orders/commercial_purchase_order_lines depend on
// no such column ever being added there).
export async function getReceivedQuantitiesForPurchaseOrder(
  organisationId: string, purchaseOrderId: string,
): Promise<Record<string, number>> {
  const rows = (await sql`
    SELECT crl.source_purchase_order_line_id AS line_id, COALESCE(SUM(crl.quantity_received), 0) AS qty
    FROM commercial_purchase_receipt_lines crl
    JOIN commercial_purchase_receipts cpr ON cpr.id = crl.purchase_receipt_id AND cpr.organisation_id = crl.organisation_id
    WHERE crl.organisation_id = ${organisationId} AND cpr.purchase_order_id = ${purchaseOrderId} AND cpr.status = 'POSTED'
    GROUP BY crl.source_purchase_order_line_id
  `) as { line_id: string; qty: string }[];

  const result: Record<string, number> = {};
  for (const row of rows) result[row.line_id] = Number(row.qty);
  return result;
}

// ── Header CRUD ──────────────────────────────────────────────────────

// C7.3 is strictly PO-backed and only an ISSUED purchase order may
// accept receipts at all (per the explicit C7.3 instruction — a receipt
// against a PO that hasn't even been sent to the supplier, or has since
// been cancelled, makes no sense). This is a friendly precondition
// check for a clear error message; the real, final, concurrency-safe
// authority for "only an ISSUED PO may have a receipt POSTED against
// it" is postPurchaseReceiptAtomically()'s own po_guard lock below — a
// PO could theoretically be cancelled AFTER this draft is created but
// BEFORE it is posted, and that later transition is what the post-time
// guard exists to catch.
export async function createPurchaseReceipt(params: {
  organisationId: string;
  userId: string;
  purchaseOrderId: string;
  receivedDate?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
}): Promise<CommercialPurchaseReceipt> {
  const purchaseOrder = await getPurchaseOrder(params.organisationId, params.purchaseOrderId);
  if (!purchaseOrder) throw new Error('purchase_order_id not found for this organisation');
  if (purchaseOrder.status !== 'ISSUED') {
    throw new Error(`Purchase order is ${purchaseOrder.status} — a purchase receipt can only be created against an ISSUED purchase order.`);
  }

  const rows = (await sql`
    INSERT INTO commercial_purchase_receipts (
      organisation_id, purchase_order_id, received_date, delivery_reference, notes, created_by
    ) VALUES (
      ${params.organisationId}, ${params.purchaseOrderId}, ${params.receivedDate ?? null}, ${params.deliveryReference ?? null}, ${params.notes ?? null}, ${params.userId}
    )
    RETURNING *
  `) as CommercialPurchaseReceipt[];
  const purchaseReceipt = rows[0];

  await logPurchaseReceiptCreated({
    organisationId: params.organisationId, userId: params.userId, purchaseReceiptId: purchaseReceipt.id,
    after: { purchase_order_id: purchaseReceipt.purchase_order_id },
  });

  return purchaseReceipt;
}

// DRAFT-only. purchase_order_id is fixed at creation time — never
// changeable, matching product_id's own "fixed at line-creation time"
// convention applied here at the header level instead.
export async function updateDraftPurchaseReceipt(params: {
  organisationId: string;
  userId: string;
  purchaseReceiptId: string;
  receivedDate?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
}): Promise<CommercialPurchaseReceipt | null> {
  const before = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
  if (!before) return null;
  assertPurchaseReceiptEditable(before.status);

  const rows = (await sql`
    UPDATE commercial_purchase_receipts SET
      received_date = COALESCE(${params.receivedDate}, received_date),
      delivery_reference = COALESCE(${params.deliveryReference}, delivery_reference),
      notes = COALESCE(${params.notes}, notes),
      updated_at = now()
    WHERE id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
    RETURNING *
  `) as CommercialPurchaseReceipt[];
  const after = rows[0];
  if (!after) return null;

  await logPurchaseReceiptUpdated({
    organisationId: params.organisationId, userId: params.userId, purchaseReceiptId: params.purchaseReceiptId,
    before: { received_date: before.received_date, delivery_reference: before.delivery_reference },
    after: { received_date: after.received_date, delivery_reference: after.delivery_reference },
  });

  return after;
}

// Safe discard/delete for a never-posted DRAFT, mirroring
// deleteDraftPurchaseOrder() exactly (same status-gated-in-the-WHERE-
// clause shape, same hard DELETE, same draft-only audit event).
// commercial_purchase_receipt_lines has ON DELETE CASCADE onto this
// table, so line rows are cleaned up atomically by the database itself.
//
// receipt_number IS NULL is technically implied by status = 'DRAFT'
// (numbering only ever happens at the DRAFT -> POSTED transition, never
// before), but both conditions are checked explicitly per the C7.3
// instruction's own eligibility wording ("never posted and unnumbered")
// and to match deleteDraftPurchaseOrder()'s own defensive-redundancy
// style.
export async function deletePurchaseReceipt(params: {
  organisationId: string; userId: string; purchaseReceiptId: string;
}): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM commercial_purchase_receipts
    WHERE id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
      AND status = 'DRAFT' AND receipt_number IS NULL
    RETURNING id
  `) as { id: string }[];
  if (rows.length === 0) return false;

  await logPurchaseReceiptDeleted({ organisationId: params.organisationId, userId: params.userId, purchaseReceiptId: params.purchaseReceiptId });
  return true;
}

// ── Lines ─────────────────────────────────────────────────────────────
//
// source_purchase_order_line_id is REQUIRED (never optional) — C7.3's
// own explicit correction from the generic C7.1 audit design: a normal
// receipt line MUST reference a concrete PO line. Description/SKU/unit
// are snapshotted from that PO line's OWN already-frozen snapshot
// columns, never from a live product join — preserving PO-line identity
// even after a later catalogue edit.

function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Fetches the PO line and verifies BOTH that it belongs to this
// organisation AND that its own purchase_order_id matches the receipt's
// purchase_order_id — the composite FK alone cannot express "this
// specific receipt's specific PO", only "some PO in this organisation",
// so this application-level check is required (matching
// lib/commercial/documentDeliveries.ts's own assertSameOrganisation()
// "structural FK plus a loud, defensive assertion" discipline).
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

export async function addPurchaseReceiptLine(params: {
  organisationId: string;
  purchaseReceiptId: string;
  sourcePurchaseOrderLineId: string;
  quantityReceived: number;
}): Promise<CommercialPurchaseReceiptLine> {
  const purchaseReceipt = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
  if (!purchaseReceipt) throw new Error('purchase receipt not found for this organisation');
  assertPurchaseReceiptEditable(purchaseReceipt.status);

  if (!isValidQuantity(params.quantityReceived)) {
    throw new Error('quantityReceived must be a positive number');
  }

  const poLine = await resolveAndAssertPoLine(params.organisationId, purchaseReceipt.purchase_order_id, params.sourcePurchaseOrderLineId);

  const [{ next_position }] = (await sql`
    SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM commercial_purchase_receipt_lines
    WHERE purchase_receipt_id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
  `) as { next_position: number }[];

  const rows = (await sql`
    INSERT INTO commercial_purchase_receipt_lines (
      organisation_id, purchase_receipt_id, source_purchase_order_line_id, position,
      description_snapshot, sku_snapshot, unit_snapshot, quantity_received
    ) VALUES (
      ${params.organisationId}, ${params.purchaseReceiptId}, ${params.sourcePurchaseOrderLineId}, ${next_position},
      ${poLine.description_snapshot}, ${poLine.sku_snapshot}, ${poLine.unit_snapshot}, ${params.quantityReceived}
    )
    RETURNING *
  `) as CommercialPurchaseReceiptLine[];

  return rows[0];
}

// Only quantityReceived may change on an existing line —
// source_purchase_order_line_id is fixed at line-creation time, matching
// product_id's own "fixed at line-creation time" convention on PO/
// invoice/quote lines.
export async function updatePurchaseReceiptLine(params: {
  organisationId: string;
  purchaseReceiptId: string;
  lineId: string;
  quantityReceived: number;
}): Promise<CommercialPurchaseReceiptLine | null> {
  const purchaseReceipt = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
  if (!purchaseReceipt) return null;
  assertPurchaseReceiptEditable(purchaseReceipt.status);

  if (!isValidQuantity(params.quantityReceived)) {
    throw new Error('quantityReceived must be a positive number');
  }

  const rows = (await sql`
    UPDATE commercial_purchase_receipt_lines SET
      quantity_received = ${params.quantityReceived},
      updated_at = now()
    WHERE id = ${params.lineId} AND purchase_receipt_id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
    RETURNING *
  `) as CommercialPurchaseReceiptLine[];
  return rows[0] ?? null;
}

export async function deletePurchaseReceiptLine(params: { organisationId: string; purchaseReceiptId: string; lineId: string }): Promise<boolean> {
  const purchaseReceipt = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
  if (!purchaseReceipt) return false;
  assertPurchaseReceiptEditable(purchaseReceipt.status);

  const rows = (await sql`
    DELETE FROM commercial_purchase_receipt_lines
    WHERE id = ${params.lineId} AND purchase_receipt_id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

// ── Lifecycle transitions ────────────────────────────────────────────

// Phase C7.3 — the single atomic post statement. Proves, under
// concurrency, that no two receipt posts can ever together over-receive
// the same PO line, per the explicit C7.3 requirement:
//
//   1. Lock the receipt row (FOR UPDATE), require status = 'DRAFT'.
//   2. Lock the parent PO row (FOR UPDATE), require status = 'ISSUED' —
//      this is the SAME row cancelPurchaseOrder()'s own guarded UPDATE
//      touches, so the two operations serialize against each other via
//      ordinary Postgres row-level locking: whichever transaction
//      reaches this PO row first blocks the other until it commits, and
//      the loser then re-evaluates its own guard against the
//      now-current, committed status.
//   3. Determine the full set of this receipt's own distinct PO lines,
//      then lock EVERY one of those commercial_purchase_order_lines rows
//      FOR UPDATE, in a single query ORDER BY id — a deterministic lock
//      order, so two concurrent posts touching an overlapping set of PO
//      lines can never deadlock (each acquires locks in the same
//      ascending-id order).
//   4. AFTER all locks are held, recompute — from the now-locked,
//      guaranteed-consistent state — how much of each affected PO line
//      is already POSTED from OTHER receipts, add this receipt's own
//      line quantities, and require every line's total to be <= its
//      ordered quantity.
//   5. Only if every check above passes does the statement allocate a
//      receipt number (reusing the existing commercial_document_sequences
//      allocator) and flip the receipt to POSTED — in the SAME statement,
//      so a losing/failing statement inserts and updates nothing at all.
//
// This is one single compound SQL statement (a WITH-chain ending in one
// UPDATE ... RETURNING), executed as ONE network round-trip — mirroring
// issuePurchaseOrderAtomically()/recordInvoicePayment()'s own proven
// "single atomic statement, not two round-trips with application-level
// branching in between" shape exactly. Every CTE below is referenced by
// something downstream (Postgres does not guarantee a data-modifying CTE
// runs if it is never referenced), so nothing here is a silently-skipped
// side effect.
async function postPurchaseReceiptAtomically(params: {
  organisationId: string;
  purchaseReceiptId: string;
  userId: string;
}): Promise<CommercialPurchaseReceipt | null> {
  // Unconditional, idempotent, and harmless regardless of the target
  // receipt's status — this only guarantees a counter row exists to
  // increment; it can never itself consume or leak a number. Mirrors
  // issuePurchaseOrderAtomically()'s own identical seeding step exactly
  // (a separate statement BEFORE the atomic statement, not a CTE inside
  // it).
  await sql`
    INSERT INTO commercial_document_sequences (organisation_id, document_type, prefix, next_number, padding)
    VALUES (${params.organisationId}, 'PURCHASE_RECEIPT', 'GR-', 1, 6)
    ON CONFLICT (organisation_id, document_type) DO NOTHING
  `;

  const rows = (await sql`
    WITH receipt_guard AS (
      SELECT id, purchase_order_id FROM commercial_purchase_receipts
      WHERE id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      FOR UPDATE
    ),
    po_guard AS (
      SELECT cpo.id FROM commercial_purchase_orders cpo
      WHERE cpo.id = (SELECT purchase_order_id FROM receipt_guard)
        AND cpo.organisation_id = ${params.organisationId} AND cpo.status = 'ISSUED'
      FOR UPDATE
    ),
    affected_line_ids AS (
      SELECT DISTINCT source_purchase_order_line_id AS line_id
      FROM commercial_purchase_receipt_lines
      WHERE purchase_receipt_id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
    ),
    locked_lines AS (
      SELECT cpol.id, cpol.quantity AS ordered_quantity
      FROM commercial_purchase_order_lines cpol
      WHERE cpol.organisation_id = ${params.organisationId}
        AND cpol.id IN (SELECT line_id FROM affected_line_ids)
      ORDER BY cpol.id
      FOR UPDATE
    ),
    already_posted AS (
      SELECT crl.source_purchase_order_line_id AS line_id, COALESCE(SUM(crl.quantity_received), 0) AS qty
      FROM commercial_purchase_receipt_lines crl
      JOIN commercial_purchase_receipts cpr ON cpr.id = crl.purchase_receipt_id AND cpr.organisation_id = crl.organisation_id
      WHERE crl.organisation_id = ${params.organisationId} AND cpr.status = 'POSTED'
        AND crl.purchase_receipt_id <> ${params.purchaseReceiptId}
        AND crl.source_purchase_order_line_id IN (SELECT line_id FROM affected_line_ids)
      GROUP BY crl.source_purchase_order_line_id
    ),
    this_receipt_qty AS (
      SELECT source_purchase_order_line_id AS line_id, SUM(quantity_received) AS qty
      FROM commercial_purchase_receipt_lines
      WHERE purchase_receipt_id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId}
      GROUP BY source_purchase_order_line_id
    ),
    totals AS (
      SELECT ll.id AS line_id, ll.ordered_quantity,
        COALESCE(ap.qty, 0) + COALESCE(tr.qty, 0) AS total_after
      FROM locked_lines ll
      LEFT JOIN already_posted ap ON ap.line_id = ll.id
      LEFT JOIN this_receipt_qty tr ON tr.line_id = ll.id
    ),
    validation AS (
      SELECT
        COUNT(*) AS line_count,
        COALESCE(bool_and(total_after <= ordered_quantity), false) AS all_within_tolerance
      FROM totals
    ),
    alloc AS (
      UPDATE commercial_document_sequences
      SET next_number = next_number + 1, updated_at = now()
      WHERE organisation_id = ${params.organisationId} AND document_type = 'PURCHASE_RECEIPT'
        AND EXISTS (SELECT 1 FROM receipt_guard)
        AND EXISTS (SELECT 1 FROM po_guard)
        AND EXISTS (SELECT 1 FROM validation WHERE line_count > 0 AND all_within_tolerance = true)
      RETURNING (next_number - 1) AS allocated_number, prefix, padding
    )
    UPDATE commercial_purchase_receipts SET
      status = 'POSTED',
      receipt_number = (SELECT prefix || lpad(allocated_number::text, padding, '0') FROM alloc),
      posted_by = ${params.userId},
      posted_at = now(),
      updated_at = now()
    WHERE id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId} AND status = 'DRAFT'
      AND EXISTS (SELECT 1 FROM alloc)
    RETURNING *
  `) as CommercialPurchaseReceipt[];

  return rows[0] ?? null;
}

// manager+ (createEdit) — posting is the requester's own action, not a
// higher-trust one (matches submitPurchaseOrder()'s own role floor
// reasoning; C7.3 has no approval gate at all, see
// purchaseReceiptLifecycle.ts's own header). The precondition checks
// below run BEFORE the atomic statement purely to produce a clear,
// specific error message — the atomic statement above is the sole
// authority that actually decides whether the post is safe to apply.
export async function postPurchaseReceipt(params: {
  organisationId: string; userId: string; purchaseReceiptId: string;
}): Promise<CommercialPurchaseReceipt> {
  const bundle = await getPurchaseReceiptWithLines(params.organisationId, params.purchaseReceiptId);
  if (!bundle) throw new Error('purchase receipt not found for this organisation');
  const { purchaseReceipt, lines } = bundle;
  assertPurchaseReceiptTransition(purchaseReceipt.status, 'POSTED');
  if (lines.length === 0) throw new Error('cannot post a purchase receipt with no lines');

  const posted = await postPurchaseReceiptAtomically({
    organisationId: params.organisationId, purchaseReceiptId: params.purchaseReceiptId, userId: params.userId,
  });

  if (!posted) {
    // The atomic statement inserted/updated nothing — determine why, for
    // a clear error message only (this read is NOT the authorization
    // decision; that already happened, correctly, inside the atomic
    // statement above).
    const current = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
    if (!current || current.status !== 'DRAFT') {
      throw new Error('purchase receipt status changed concurrently; post aborted');
    }
    const po = await getPurchaseOrder(params.organisationId, current.purchase_order_id);
    if (!po || po.status !== 'ISSUED') {
      throw new Error(`Purchase order is ${po?.status ?? 'not found'} — a purchase receipt can only be posted while its purchase order is ISSUED.`);
    }
    throw new Error('One or more lines on this receipt would receive more than the ordered quantity (including quantities already posted on other receipts for the same purchase order line). Reduce the quantity and try again.');
  }

  await logPurchaseReceiptPosted({
    organisationId: params.organisationId, userId: params.userId, purchaseReceiptId: params.purchaseReceiptId,
    receiptNumber: posted.receipt_number!,
  });

  return posted;
}

// admin+ (approve floor, matching cancelPurchaseOrder()'s own floor) —
// only a POSTED receipt may be cancelled; a non-empty, trimmed
// cancel_reason is mandatory. Never hard-deletes, never renumbers.
// Cancelling a receipt automatically "reopens" the quantity it
// contributed, for free, by construction: getReceivedQuantitiesForPurchaseOrder()
// only ever sums status = 'POSTED' lines, so a CANCELLED receipt's
// quantities simply stop counting toward received-to-date the moment
// this UPDATE commits — no separate reversal bookkeeping exists or is
// needed.
export async function cancelPurchaseReceipt(params: {
  organisationId: string; userId: string; purchaseReceiptId: string; reason: string;
}): Promise<CommercialPurchaseReceipt> {
  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error('cancel_reason is required');

  const purchaseReceipt = await getPurchaseReceipt(params.organisationId, params.purchaseReceiptId);
  if (!purchaseReceipt) throw new Error('purchase receipt not found for this organisation');
  assertPurchaseReceiptTransition(purchaseReceipt.status, 'CANCELLED');

  const rows = (await sql`
    UPDATE commercial_purchase_receipts SET
      status = 'CANCELLED', cancelled_by = ${params.userId}, cancelled_at = now(), cancel_reason = ${trimmedReason}, updated_at = now()
    WHERE id = ${params.purchaseReceiptId} AND organisation_id = ${params.organisationId} AND status = 'POSTED'
    RETURNING *
  `) as CommercialPurchaseReceipt[];
  const cancelled = rows[0];
  if (!cancelled) throw new Error('purchase receipt status changed concurrently; cancel aborted');

  await logPurchaseReceiptCancelled({
    organisationId: params.organisationId, userId: params.userId, purchaseReceiptId: params.purchaseReceiptId, cancelReason: trimmedReason,
  });

  return cancelled;
}
