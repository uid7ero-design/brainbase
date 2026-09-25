import 'server-only';
import sql from '@/lib/db';
import {
  integerQuantityToQuantity4,
  parseQuantity4NonNegative,
  quantity4ToDisplayNumber,
  remainingQuantity4,
} from './quantity';

// Phase C7.5B/C7.5C — read-only Purchasing Reconciliation.
//
// Reconciliation is a derived read model over the immutable PO facts and
// POSTED receipt/bill facts. It deliberately persists nothing: no
// received_quantity/billed_quantity/matched_quantity/status cache is added
// to commercial_purchase_orders or commercial_purchase_order_lines.
//
// C7.5C derives receipt quantity, billed quantity, and billed value as
// independent facts. Exact reconciliation requires all three dimensions to
// reach the ordered facts. This still does NOT claim receipt-line <-> bill-line
// allocation; both document types only share PO-line lineage at this phase.

export type ReceivingState = 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED';
export type BillingState = 'NOT_BILLED' | 'PARTIALLY_BILLED' | 'FULLY_BILLED';
export type BilledQuantityState = 'NOT_BILLED' | 'PARTIALLY_BILLED' | 'FULLY_BILLED';
export type LineReconciliationState =
  | 'OPEN'
  | 'RECEIVED_NOT_BILLED'
  | 'BILLED_NOT_RECEIVED'
  | 'PARTIAL'
  | 'RECONCILED';
export type PurchaseOrderReconciliationStatus = 'OPEN' | 'PARTIAL' | 'RECONCILED' | 'EXCEPTION';

export type PurchasingReconciliationExceptionCode =
  | 'BILLED_BEFORE_RECEIPT'
  | 'PARTIALLY_RECEIVED'
  | 'PARTIALLY_BILLED'
  | 'RECEIVED_NOT_BILLED'
  | 'BILLED_NOT_RECEIVED'
  | 'RECEIPT_QUANTITY_MISMATCH'
  | 'BILL_QUANTITY_MISMATCH'
  | 'PARTIALLY_BILLED_QUANTITY'
  | 'BILL_VALUE_MISMATCH';

export interface PurchasingReconciliationException {
  code: PurchasingReconciliationExceptionCode;
  severity: 'INFO' | 'ERROR';
}

export interface PurchaseLineReconciliation {
  purchaseOrderLineId: string;
  position: number;
  description: string;
  sku: string | null;
  unit: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingToReceive: number;
  billedQuantity: number;
  remainingToBillQuantity: number;
  orderedValueCents: number;
  billedValueCents: number;
  remainingToBillCents: number;
  receivingState: ReceivingState;
  billedQuantityState: BilledQuantityState;
  billingState: BillingState;
  reconciliationState: LineReconciliationState;
  exceptions: PurchasingReconciliationException[];
}

export interface PurchaseOrderReconciliation {
  purchaseOrderId: string;
  purchaseOrderStatus: string;
  currency: string;
  lineCount: number;
  fullyReceivedLineCount: number;
  fullyBilledQuantityLineCount: number;
  fullyBilledLineCount: number;
  reconciledLineCount: number;
  orderedValueCents: number;
  billedValueCents: number;
  status: PurchaseOrderReconciliationStatus;
  exceptions: PurchasingReconciliationException[];
  lines: PurchaseLineReconciliation[];
}

export type RawReconciliationRow = {
  purchase_order_id: string;
  purchase_order_status: string;
  currency: string;
  line_id: string | null;
  position: number | null;
  description_snapshot: string | null;
  sku_snapshot: string | null;
  unit_snapshot: string | null;
  ordered_quantity: number | null;
  ordered_value_cents: number | null;
  received_quantity: string;
  billed_quantity: string;
  billed_value_cents: string;
};

function classifyLine(row: RawReconciliationRow): PurchaseLineReconciliation | null {
  if (!row.line_id) return null;

  const orderedQuantity = Number(row.ordered_quantity ?? 0);
  const orderedQuantityFixed = integerQuantityToQuantity4(orderedQuantity);
  const receivedQuantityFixed = parseQuantity4NonNegative(row.received_quantity);
  const billedQuantityFixed = parseQuantity4NonNegative(row.billed_quantity);
  const receivedQuantity = quantity4ToDisplayNumber(receivedQuantityFixed);
  const billedQuantity = quantity4ToDisplayNumber(billedQuantityFixed);
  const orderedValueCents = Number(row.ordered_value_cents ?? 0);
  const billedValueCents = Number(row.billed_value_cents);

  const receiptOver = receivedQuantityFixed > orderedQuantityFixed;
  const billQuantityOver = billedQuantityFixed > orderedQuantityFixed;
  const billValueOver = billedValueCents > orderedValueCents;

  const receivingState: ReceivingState =
    receivedQuantityFixed === 0 ? 'NOT_RECEIVED'
      : receivedQuantityFixed >= orderedQuantityFixed ? 'FULLY_RECEIVED'
        : 'PARTIALLY_RECEIVED';

  const billedQuantityState: BilledQuantityState =
    billedQuantityFixed === 0 ? 'NOT_BILLED'
      : billedQuantityFixed >= orderedQuantityFixed ? 'FULLY_BILLED'
        : 'PARTIALLY_BILLED';

  const billingState: BillingState =
    billedValueCents === orderedValueCents ? 'FULLY_BILLED'
      : billedValueCents <= 0 ? 'NOT_BILLED'
        : billedValueCents >= orderedValueCents ? 'FULLY_BILLED'
          : 'PARTIALLY_BILLED';

  const quantitiesExact =
    receivedQuantityFixed === orderedQuantityFixed
    && billedQuantityFixed === orderedQuantityFixed;
  const hasBillActivity = billedQuantityFixed > 0 || billedValueCents > 0;

  let reconciliationState: LineReconciliationState;
  if (quantitiesExact && billedValueCents === orderedValueCents) {
    reconciliationState = 'RECONCILED';
  } else if (receivedQuantityFixed === 0 && !hasBillActivity) {
    reconciliationState = 'OPEN';
  } else if (receivedQuantityFixed === orderedQuantityFixed && !hasBillActivity) {
    reconciliationState = 'RECEIVED_NOT_BILLED';
  } else if (receivedQuantityFixed === 0 && hasBillActivity) {
    reconciliationState = 'BILLED_NOT_RECEIVED';
  } else {
    reconciliationState = 'PARTIAL';
  }

  const exceptions: PurchasingReconciliationException[] = [];
  if (receiptOver) exceptions.push({ code: 'RECEIPT_QUANTITY_MISMATCH', severity: 'ERROR' });
  if (billQuantityOver) exceptions.push({ code: 'BILL_QUANTITY_MISMATCH', severity: 'ERROR' });
  if (billValueOver) exceptions.push({ code: 'BILL_VALUE_MISMATCH', severity: 'ERROR' });
  if (!receiptOver && receivedQuantityFixed > 0 && receivedQuantityFixed < orderedQuantityFixed) {
    exceptions.push({ code: 'PARTIALLY_RECEIVED', severity: 'INFO' });
  }
  if (!billQuantityOver && billedQuantityFixed > 0 && billedQuantityFixed < orderedQuantityFixed) {
    exceptions.push({ code: 'PARTIALLY_BILLED_QUANTITY', severity: 'INFO' });
  }
  if (!billValueOver && billedValueCents > 0 && billedValueCents < orderedValueCents) {
    exceptions.push({ code: 'PARTIALLY_BILLED', severity: 'INFO' });
  }
  if (receivedQuantityFixed === orderedQuantityFixed && orderedValueCents > 0 && !hasBillActivity) {
    exceptions.push({ code: 'RECEIVED_NOT_BILLED', severity: 'INFO' });
  }
  if (receivedQuantityFixed === 0 && hasBillActivity) {
    exceptions.push({ code: 'BILLED_BEFORE_RECEIPT', severity: 'INFO' });
    exceptions.push({ code: 'BILLED_NOT_RECEIVED', severity: 'INFO' });
  }

  return {
    purchaseOrderLineId: row.line_id,
    position: Number(row.position ?? 0),
    description: row.description_snapshot ?? '',
    sku: row.sku_snapshot,
    unit: row.unit_snapshot,
    orderedQuantity,
    receivedQuantity,
    remainingToReceive: quantity4ToDisplayNumber(remainingQuantity4(orderedQuantityFixed, receivedQuantityFixed)),
    billedQuantity,
    remainingToBillQuantity: quantity4ToDisplayNumber(remainingQuantity4(orderedQuantityFixed, billedQuantityFixed)),
    orderedValueCents,
    billedValueCents,
    remainingToBillCents: Math.max(0, orderedValueCents - billedValueCents),
    receivingState,
    billedQuantityState,
    billingState,
    reconciliationState,
    exceptions,
  };
}

export function derivePurchaseOrderReconciliation(rows: RawReconciliationRow[]): PurchaseOrderReconciliation | null {
  if (rows.length === 0) return null;

  const header = rows[0];
  const lines = rows.map(classifyLine).filter((line): line is PurchaseLineReconciliation => line !== null);
  const exceptions = lines.flatMap(line => line.exceptions);

  const fullyReceivedLineCount = lines.filter(line => line.receivingState === 'FULLY_RECEIVED').length;
  const fullyBilledQuantityLineCount = lines.filter(line => line.billedQuantityState === 'FULLY_BILLED').length;
  const fullyBilledLineCount = lines.filter(line => line.billingState === 'FULLY_BILLED').length;
  const reconciledLineCount = lines.filter(line => line.reconciliationState === 'RECONCILED').length;
  const orderedValueCents = lines.reduce((sum, line) => sum + line.orderedValueCents, 0);
  const billedValueCents = lines.reduce((sum, line) => sum + line.billedValueCents, 0);

  let status: PurchaseOrderReconciliationStatus;
  if (exceptions.some(exception => exception.severity === 'ERROR')) {
    status = 'EXCEPTION';
  } else if (lines.length === 0 || lines.every(line => line.reconciliationState === 'OPEN')) {
    status = 'OPEN';
  } else if (lines.every(line => line.reconciliationState === 'RECONCILED')) {
    status = 'RECONCILED';
  } else {
    status = 'PARTIAL';
  }

  return {
    purchaseOrderId: header.purchase_order_id,
    purchaseOrderStatus: header.purchase_order_status,
    currency: header.currency,
    lineCount: lines.length,
    fullyReceivedLineCount,
    fullyBilledQuantityLineCount,
    fullyBilledLineCount,
    reconciledLineCount,
    orderedValueCents,
    billedValueCents,
    status,
    exceptions,
    lines,
  };
}

// One SQL statement gives the API one PostgreSQL statement snapshot rather
// than independently reading PO/receipts/bills across multiple commits.
// Every contributing row is explicitly tenant-scoped and only POSTED
// receipt/bill headers contribute. Draft and cancelled documents therefore
// disappear from reconciliation automatically.
export async function getPurchaseOrderReconciliation(
  organisationId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderReconciliation | null> {
  const rows = (await sql`
    WITH received AS (
      SELECT
        crl.source_purchase_order_line_id AS line_id,
        COALESCE(SUM(crl.quantity_received), 0) AS received_quantity
      FROM commercial_purchase_receipt_lines crl
      JOIN commercial_purchase_receipts cpr
        ON cpr.id = crl.purchase_receipt_id
       AND cpr.organisation_id = crl.organisation_id
      WHERE crl.organisation_id = ${organisationId}
        AND cpr.purchase_order_id = ${purchaseOrderId}
        AND cpr.status = 'POSTED'
      GROUP BY crl.source_purchase_order_line_id
    ),
    billed AS (
      SELECT
        csbl.source_purchase_order_line_id AS line_id,
        COALESCE(SUM(csbl.quantity), 0)::numeric(14,4) AS billed_quantity,
        COALESCE(SUM(csbl.line_total_cents), 0) AS billed_value_cents
      FROM commercial_supplier_bill_lines csbl
      JOIN commercial_supplier_bills csb
        ON csb.id = csbl.supplier_bill_id
       AND csb.organisation_id = csbl.organisation_id
      WHERE csbl.organisation_id = ${organisationId}
        AND csb.source_purchase_order_id = ${purchaseOrderId}
        AND csb.status = 'POSTED'
      GROUP BY csbl.source_purchase_order_line_id
    )
    SELECT
      cpo.id AS purchase_order_id,
      cpo.status AS purchase_order_status,
      cpo.currency,
      cpol.id AS line_id,
      cpol.position,
      cpol.description_snapshot,
      cpol.sku_snapshot,
      cpol.unit_snapshot,
      cpol.quantity AS ordered_quantity,
      cpol.line_total_cents AS ordered_value_cents,
      COALESCE(r.received_quantity, 0)::text AS received_quantity,
      COALESCE(b.billed_quantity, 0)::text AS billed_quantity,
      COALESCE(b.billed_value_cents, 0)::text AS billed_value_cents
    FROM commercial_purchase_orders cpo
    LEFT JOIN commercial_purchase_order_lines cpol
      ON cpol.purchase_order_id = cpo.id
     AND cpol.organisation_id = cpo.organisation_id
    LEFT JOIN received r ON r.line_id = cpol.id
    LEFT JOIN billed b ON b.line_id = cpol.id
    WHERE cpo.id = ${purchaseOrderId}
      AND cpo.organisation_id = ${organisationId}
    ORDER BY cpol.position ASC NULLS LAST, cpol.id ASC NULLS LAST
  `) as RawReconciliationRow[];

  return derivePurchaseOrderReconciliation(rows);
}
