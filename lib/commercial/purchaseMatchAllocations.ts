import 'server-only';
import sql from '@/lib/db';
import {
  parseQuantity4,
  parseQuantity4NonNegative,
  quantity4ToDecimalString,
} from './quantity';
import {
  logPurchaseMatchAllocationCreated,
  logPurchaseMatchAllocationReversed,
} from './auditLog';

// Phase C7.5D1 — explicit quantity allocation facts between POSTED
// Purchase Receipt lines and POSTED Supplier Bill lines.
//
// This module deliberately does not infer matches from common PO-line
// lineage and does not cache matched quantities on any parent row.
// C7.5D2 will add lock-first concurrency serialization around creation;
// D1 establishes the schema, sequential invariants, and audit lifecycle.

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

export async function createPurchaseMatchAllocation(params: {
  organisationId: string;
  userId: string;
  purchaseReceiptLineId: string;
  supplierBillLineId: string;
  quantity: string | number;
}): Promise<CommercialPurchaseMatchAllocation> {
  const allocationQuantity = quantity4ToDecimalString(parseQuantity4(params.quantity));

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

  const canonicalQuantity = assertPurchaseMatchCapacity({
    allocationQuantity,
    receiptQuantity: match.receipt_quantity,
    billQuantity: match.bill_quantity,
    receiptAllocated: capacity.receipt_allocated,
    billAllocated: capacity.bill_allocated,
  });

  const rows = (await sql`
    INSERT INTO commercial_purchase_receipt_bill_allocations (
      organisation_id,
      purchase_order_line_id,
      purchase_receipt_line_id,
      supplier_bill_line_id,
      quantity_allocated,
      created_by
    ) VALUES (
      ${params.organisationId},
      ${match.purchase_order_line_id},
      ${params.purchaseReceiptLineId},
      ${params.supplierBillLineId},
      ${canonicalQuantity},
      ${params.userId}
    )
    RETURNING *
  `) as CommercialPurchaseMatchAllocation[];

  const allocation = rows[0];
  if (!allocation) throw new Error('failed to create purchase match allocation');
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
