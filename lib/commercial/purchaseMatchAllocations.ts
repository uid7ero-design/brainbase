import 'server-only';
import sql from '@/lib/db';
import {
  parseQuantity4,
  parseQuantity4NonNegative,
  quantity4ToDecimalString,
  remainingQuantity4,
} from './quantity';
import {
  logPurchaseMatchAllocationCreated,
  logPurchaseMatchAllocationReversed,
} from './auditLog';

// Phase C7.5D — explicit quantity allocation facts between POSTED
// Purchase Receipt lines and POSTED Supplier Bill lines.
//
// This module deliberately does not infer matches from common PO-line
// lineage and does not cache matched quantities on any parent row.
// D2 serializes every create against the shared purchase-order line row,
// then validates against a fresh READ COMMITTED snapshot while that lock
// remains held. Receipt/Bill cancellation uses the same serialization
// point, so allocation-vs-cancel and allocation-vs-allocation races cannot
// commit an impossible active match.

export interface CommercialPurchaseMatchAllocation {
  id: string;
  organisation_id: string;
  purchase_order_line_id: string;
  purchase_receipt_line_id: string;
  supplier_bill_line_id: string;
  quantity_allocated: string;
  created_by: string | null;
  created_at: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}
interface MatchEligibilityRow {
  purchase_order_line_id: string;
  line_purchase_order_id: string;
  receipt_purchase_order_id: string;
  bill_purchase_order_id: string;
  receipt_status: string;
  bill_status: string;
  receipt_quantity: string;
  bill_quantity: string;
}

interface AllocationCapacityRow {
  receipt_allocated: string;
  bill_allocated: string;
  active_pair_count: string;
}

export interface PurchaseMatchCandidateLine {
  id: string;
  purchaseOrderLineId: string;
  documentId: string;
  documentNumber: string;
  quantity: string;
  allocatedQuantity: string;
  remainingQuantity: string;
}

export interface PurchaseMatchWorkspace {
  receiptLines: PurchaseMatchCandidateLine[];
  billLines: PurchaseMatchCandidateLine[];
  allocations: CommercialPurchaseMatchAllocation[];
}

export function assertPurchaseMatchCapacity(params: {
  allocationQuantity: string | number;
  receiptQuantity: string | number;
  billQuantity: string | number;
  receiptAllocated: string | number;
  billAllocated: string | number;
}): string {
  const allocation = parseQuantity4(params.allocationQuantity);
  const receipt = parseQuantity4(params.receiptQuantity);
  const bill = parseQuantity4(params.billQuantity);
  const receiptAllocated = parseQuantity4NonNegative(params.receiptAllocated);
  const billAllocated = parseQuantity4NonNegative(params.billAllocated);

  if (receiptAllocated + allocation > receipt) {
    throw new Error('allocation quantity exceeds the receipt line remaining quantity');
  }
  if (billAllocated + allocation > bill) {
    throw new Error('allocation quantity exceeds the supplier bill line remaining quantity');
  }
  return quantity4ToDecimalString(allocation);
}
export async function listPurchaseMatchAllocationsForPurchaseOrder(
  organisationId: string,
  purchaseOrderId: string,
): Promise<CommercialPurchaseMatchAllocation[]> {
  return (await sql`
    SELECT a.*
    FROM commercial_purchase_receipt_bill_allocations a
    JOIN commercial_purchase_order_lines pol
      ON pol.id = a.purchase_order_line_id
     AND pol.organisation_id = a.organisation_id
    WHERE a.organisation_id = ${organisationId}
      AND pol.purchase_order_id = ${purchaseOrderId}
    ORDER BY a.created_at ASC, a.id ASC
  `) as CommercialPurchaseMatchAllocation[];
}

export async function getPurchaseMatchWorkspace(
  organisationId: string,
  purchaseOrderId: string,
): Promise<PurchaseMatchWorkspace | null> {
  const poRows = (await sql`
    SELECT id
    FROM commercial_purchase_orders
    WHERE id = ${purchaseOrderId}
      AND organisation_id = ${organisationId}
  `) as { id: string }[];
  if (!poRows[0]) return null;

  const receiptRows = (await sql`
    SELECT
      prl.id,
      prl.source_purchase_order_line_id AS purchase_order_line_id,
      pr.id AS document_id,
      COALESCE(pr.receipt_number, 'Posted receipt') AS document_number,
      prl.quantity_received::text AS quantity,
      COALESCE(SUM(a.quantity_allocated) FILTER (WHERE a.reversed_at IS NULL), 0)::text AS allocated_quantity
    FROM commercial_purchase_receipt_lines prl
    JOIN commercial_purchase_receipts pr
      ON pr.id = prl.purchase_receipt_id
     AND pr.organisation_id = prl.organisation_id
    LEFT JOIN commercial_purchase_receipt_bill_allocations a
      ON a.purchase_receipt_line_id = prl.id
     AND a.organisation_id = prl.organisation_id
    WHERE prl.organisation_id = ${organisationId}
      AND pr.purchase_order_id = ${purchaseOrderId}
      AND pr.status = 'POSTED'
    GROUP BY prl.id, prl.source_purchase_order_line_id, pr.id, pr.receipt_number, prl.quantity_received
    ORDER BY pr.receipt_number ASC NULLS LAST, pr.id ASC, prl.position ASC, prl.id ASC
  `) as {
    id: string; purchase_order_line_id: string; document_id: string;
    document_number: string; quantity: string; allocated_quantity: string;
  }[];

  const billRows = (await sql`
    SELECT
      sbl.id,
      sbl.source_purchase_order_line_id AS purchase_order_line_id,
      sb.id AS document_id,
      COALESCE(sb.bill_number, sb.supplier_invoice_number) AS document_number,
      sbl.quantity::text AS quantity,
      COALESCE(SUM(a.quantity_allocated) FILTER (WHERE a.reversed_at IS NULL), 0)::text AS allocated_quantity
    FROM commercial_supplier_bill_lines sbl
    JOIN commercial_supplier_bills sb
      ON sb.id = sbl.supplier_bill_id
     AND sb.organisation_id = sbl.organisation_id
    LEFT JOIN commercial_purchase_receipt_bill_allocations a
      ON a.supplier_bill_line_id = sbl.id
     AND a.organisation_id = sbl.organisation_id
    WHERE sbl.organisation_id = ${organisationId}
      AND sb.source_purchase_order_id = ${purchaseOrderId}
      AND sb.status = 'POSTED'
    GROUP BY sbl.id, sbl.source_purchase_order_line_id, sb.id, sb.bill_number, sb.supplier_invoice_number, sbl.quantity
    ORDER BY sb.bill_number ASC NULLS LAST, sb.id ASC, sbl.position ASC, sbl.id ASC
  `) as {
    id: string; purchase_order_line_id: string; document_id: string;
    document_number: string; quantity: string; allocated_quantity: string;
  }[];

  const allocations = await listPurchaseMatchAllocationsForPurchaseOrder(organisationId, purchaseOrderId);
  const toCandidate = (row: {
    id: string; purchase_order_line_id: string; document_id: string;
    document_number: string; quantity: string; allocated_quantity: string;
  }): PurchaseMatchCandidateLine => {
    const quantity = parseQuantity4NonNegative(row.quantity);
    const allocated = parseQuantity4NonNegative(row.allocated_quantity);
    return {
      id: row.id,
      purchaseOrderLineId: row.purchase_order_line_id,
      documentId: row.document_id,
      documentNumber: row.document_number,
      quantity: quantity4ToDecimalString(quantity),
      allocatedQuantity: quantity4ToDecimalString(allocated),
      remainingQuantity: quantity4ToDecimalString(remainingQuantity4(quantity, allocated)),
    };
  };

  return {
    receiptLines: receiptRows.map(toCandidate),
    billLines: billRows.map(toCandidate),
    allocations,
  };
}

export async function createPurchaseMatchAllocation(params: {
  organisationId: string;
  userId: string;
  purchaseOrderId: string;
  purchaseReceiptLineId: string;
  supplierBillLineId: string;
  quantity: string | number;
}): Promise<CommercialPurchaseMatchAllocation> {
  const allocationQuantity = quantity4ToDecimalString(parseQuantity4(params.quantity));

  // Statement 1 resolves the candidate through SAME-tenant/SAME-PO-line
  // lineage and locks that shared PO-line row. Every D2 allocator and both
  // cancellation paths serialize on this row.
  //
  // Statement 2 gets a fresh READ COMMITTED snapshot after any wait, then
  // re-checks both document statuses and active capacity before inserting.
  // The INSERT is itself guarded: failure to satisfy any invariant returns
  // no row and writes nothing.
  const [, insertRows] = await sql.transaction(txn => [
    txn`
      WITH candidate AS MATERIALIZED (
        SELECT prl.source_purchase_order_line_id AS purchase_order_line_id
        FROM commercial_purchase_receipt_lines prl
        JOIN commercial_supplier_bill_lines sbl
          ON sbl.id = ${params.supplierBillLineId}
         AND sbl.organisation_id = ${params.organisationId}
         AND sbl.source_purchase_order_line_id = prl.source_purchase_order_line_id
        WHERE prl.id = ${params.purchaseReceiptLineId}
          AND prl.organisation_id = ${params.organisationId}
      ),
      locked_line AS MATERIALIZED (
        SELECT pol.id
        FROM commercial_purchase_order_lines pol
        WHERE pol.id = (SELECT purchase_order_line_id FROM candidate)
          AND pol.organisation_id = ${params.organisationId}
          AND pol.purchase_order_id = ${params.purchaseOrderId}
        FOR UPDATE
      )
      SELECT id FROM locked_line
    `,
    txn`
      WITH eligibility AS (
        SELECT
          prl.source_purchase_order_line_id AS purchase_order_line_id,
          pol.purchase_order_id AS line_purchase_order_id,
          pr.purchase_order_id AS receipt_purchase_order_id,
          sb.source_purchase_order_id AS bill_purchase_order_id,
          pr.status AS receipt_status,
          sb.status AS bill_status,
          prl.quantity_received::text AS receipt_quantity,
          sbl.quantity::text AS bill_quantity
        FROM commercial_purchase_receipt_lines prl
        JOIN commercial_purchase_receipts pr
          ON pr.id = prl.purchase_receipt_id
         AND pr.organisation_id = prl.organisation_id
        JOIN commercial_purchase_order_lines pol
          ON pol.id = prl.source_purchase_order_line_id
         AND pol.organisation_id = prl.organisation_id
        JOIN commercial_supplier_bill_lines sbl
          ON sbl.id = ${params.supplierBillLineId}
         AND sbl.organisation_id = ${params.organisationId}
         AND sbl.source_purchase_order_line_id = prl.source_purchase_order_line_id
        JOIN commercial_supplier_bills sb
          ON sb.id = sbl.supplier_bill_id
         AND sb.organisation_id = sbl.organisation_id
        WHERE prl.id = ${params.purchaseReceiptLineId}
          AND prl.organisation_id = ${params.organisationId}
          AND pol.purchase_order_id = ${params.purchaseOrderId}
      ),
      capacity AS (
        SELECT
          COALESCE((
            SELECT SUM(quantity_allocated)
            FROM commercial_purchase_receipt_bill_allocations
            WHERE organisation_id = ${params.organisationId}
              AND purchase_receipt_line_id = ${params.purchaseReceiptLineId}
              AND reversed_at IS NULL
          ), 0)::numeric AS receipt_allocated,
          COALESCE((
            SELECT SUM(quantity_allocated)
            FROM commercial_purchase_receipt_bill_allocations
            WHERE organisation_id = ${params.organisationId}
              AND supplier_bill_line_id = ${params.supplierBillLineId}
              AND reversed_at IS NULL
          ), 0)::numeric AS bill_allocated,
          (
            SELECT COUNT(*)
            FROM commercial_purchase_receipt_bill_allocations
            WHERE organisation_id = ${params.organisationId}
              AND purchase_receipt_line_id = ${params.purchaseReceiptLineId}
              AND supplier_bill_line_id = ${params.supplierBillLineId}
              AND reversed_at IS NULL
          ) AS active_pair_count
      )
      INSERT INTO commercial_purchase_receipt_bill_allocations (
        organisation_id,
        purchase_order_line_id,
        purchase_receipt_line_id,
        supplier_bill_line_id,
        quantity_allocated,
        created_by
      )
      SELECT
        ${params.organisationId},
        e.purchase_order_line_id,
        ${params.purchaseReceiptLineId},
        ${params.supplierBillLineId},
        ${allocationQuantity}::numeric(14,4),
        ${params.userId}
      FROM eligibility e
      CROSS JOIN capacity c
      WHERE e.receipt_status = 'POSTED'
        AND e.bill_status = 'POSTED'
        AND e.receipt_purchase_order_id = e.line_purchase_order_id
        AND e.bill_purchase_order_id = e.line_purchase_order_id
        AND c.active_pair_count = 0
        AND c.receipt_allocated + ${allocationQuantity}::numeric <= e.receipt_quantity::numeric
        AND c.bill_allocated + ${allocationQuantity}::numeric <= e.bill_quantity::numeric
      RETURNING *
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const allocation = (insertRows as CommercialPurchaseMatchAllocation[])[0];
  if (!allocation) {
    // Diagnosis only. The guarded transaction above already made the
    // concurrency-safe authorization decision and wrote nothing.
    const eligibility = (await sql`
      SELECT
        prl.source_purchase_order_line_id AS purchase_order_line_id,
        pol.purchase_order_id AS line_purchase_order_id,
        pr.purchase_order_id AS receipt_purchase_order_id,
        sb.source_purchase_order_id AS bill_purchase_order_id,
        pr.status AS receipt_status,
        sb.status AS bill_status,
        prl.quantity_received::text AS receipt_quantity,
        sbl.quantity::text AS bill_quantity
      FROM commercial_purchase_receipt_lines prl
      JOIN commercial_purchase_receipts pr
        ON pr.id = prl.purchase_receipt_id
       AND pr.organisation_id = prl.organisation_id
      JOIN commercial_purchase_order_lines pol
        ON pol.id = prl.source_purchase_order_line_id
       AND pol.organisation_id = prl.organisation_id
      JOIN commercial_supplier_bill_lines sbl
        ON sbl.id = ${params.supplierBillLineId}
       AND sbl.organisation_id = ${params.organisationId}
       AND sbl.source_purchase_order_line_id = prl.source_purchase_order_line_id
      JOIN commercial_supplier_bills sb
        ON sb.id = sbl.supplier_bill_id
       AND sb.organisation_id = sbl.organisation_id
      WHERE prl.id = ${params.purchaseReceiptLineId}
        AND prl.organisation_id = ${params.organisationId}
        AND pol.purchase_order_id = ${params.purchaseOrderId}
    `) as MatchEligibilityRow[];

    const match = eligibility[0];
    if (!match) {
      throw new Error('receipt line and supplier bill line must exist in this organisation and reference the same purchase order line');
    }
    if (match.receipt_status !== 'POSTED') {
      throw new Error('purchase receipt must be POSTED before it can be matched');
    }
    if (match.bill_status !== 'POSTED') {
      throw new Error('supplier bill must be POSTED before it can be matched');
    }
    if (
      match.receipt_purchase_order_id !== match.line_purchase_order_id
      || match.bill_purchase_order_id !== match.line_purchase_order_id
    ) {
      throw new Error('receipt line and supplier bill line must belong to their shared purchase order line');
    }

    const capacityRows = (await sql`
      SELECT
        COALESCE((
          SELECT SUM(quantity_allocated)
          FROM commercial_purchase_receipt_bill_allocations
          WHERE organisation_id = ${params.organisationId}
            AND purchase_receipt_line_id = ${params.purchaseReceiptLineId}
            AND reversed_at IS NULL
        ), 0)::text AS receipt_allocated,
        COALESCE((
          SELECT SUM(quantity_allocated)
          FROM commercial_purchase_receipt_bill_allocations
          WHERE organisation_id = ${params.organisationId}
            AND supplier_bill_line_id = ${params.supplierBillLineId}
            AND reversed_at IS NULL
        ), 0)::text AS bill_allocated,
        (
          SELECT COUNT(*)
          FROM commercial_purchase_receipt_bill_allocations
          WHERE organisation_id = ${params.organisationId}
            AND purchase_receipt_line_id = ${params.purchaseReceiptLineId}
            AND supplier_bill_line_id = ${params.supplierBillLineId}
            AND reversed_at IS NULL
        )::text AS active_pair_count
    `) as AllocationCapacityRow[];
    const capacity = capacityRows[0] ?? {
      receipt_allocated: '0',
      bill_allocated: '0',
      active_pair_count: '0',
    };
    if (Number(capacity.active_pair_count) > 0) {
      throw new Error('an active allocation already exists for this receipt line and supplier bill line');
    }
    assertPurchaseMatchCapacity({
      allocationQuantity,
      receiptQuantity: match.receipt_quantity,
      billQuantity: match.bill_quantity,
      receiptAllocated: capacity.receipt_allocated,
      billAllocated: capacity.bill_allocated,
    });
    throw new Error('purchase match allocation changed concurrently; create aborted');
  }

  await logPurchaseMatchAllocationCreated({
    organisationId: params.organisationId,
    userId: params.userId,
    allocationId: allocation.id,
    after: {
      purchase_order_line_id: allocation.purchase_order_line_id,
      purchase_receipt_line_id: allocation.purchase_receipt_line_id,
      supplier_bill_line_id: allocation.supplier_bill_line_id,
      quantity_allocated: allocation.quantity_allocated,
    },
  });

  return allocation;
}

export async function reversePurchaseMatchAllocation(params: {
  organisationId: string;
  userId: string;
  purchaseOrderId: string;
  allocationId: string;
  reason: string;
}): Promise<CommercialPurchaseMatchAllocation | null> {
  const reason = params.reason.trim();
  if (!reason) throw new Error('reversal reason is required');

  const rows = (await sql`
    UPDATE commercial_purchase_receipt_bill_allocations
    SET reversed_by = ${params.userId},
        reversed_at = now(),
        reversal_reason = ${reason}
    WHERE id = ${params.allocationId}
      AND organisation_id = ${params.organisationId}
      AND reversed_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM commercial_purchase_order_lines pol
        WHERE pol.id = commercial_purchase_receipt_bill_allocations.purchase_order_line_id
          AND pol.organisation_id = commercial_purchase_receipt_bill_allocations.organisation_id
          AND pol.purchase_order_id = ${params.purchaseOrderId}
      )
    RETURNING *
  `) as CommercialPurchaseMatchAllocation[];

  const allocation = rows[0];
  if (!allocation) return null;
  await logPurchaseMatchAllocationReversed({
    organisationId: params.organisationId,
    userId: params.userId,
    allocationId: allocation.id,
    before: {
      purchase_order_line_id: allocation.purchase_order_line_id,
      purchase_receipt_line_id: allocation.purchase_receipt_line_id,
      supplier_bill_line_id: allocation.supplier_bill_line_id,
      quantity_allocated: allocation.quantity_allocated,
    },
    reason,
  });

  return allocation;
}
