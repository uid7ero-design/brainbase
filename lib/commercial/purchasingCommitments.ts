import 'server-only';
import sql from '@/lib/db';

// Phase C7.6A — migration-free derived Purchasing commitment read model.
//
// Purchasing remains the source of truth. No committed/encumbrance cache is
// persisted on purchase orders or purchase-order lines. Supplier-bill facts
// consume commitment only while the parent PO remains ISSUED. Receipt and
// explicit match-allocation facts are deliberately absent from this model.

export type PurchaseCommitmentState =
  | 'NOT_COMMITTED'
  | 'OPEN'
  | 'PARTIALLY_CONSUMED'
  | 'CONSUMED'
  | 'INVALID_OVERBILLED';

export type CommitmentPeriodResolution = 'UNRESOLVED' | 'RESOLVED';

export interface PurchaseLineCommitment {
  purchaseOrderLineId: string;
  position: number;
  description: string;
  effectiveCostCentreId: string | null;
  state: PurchaseCommitmentState;
  orderedSubtotalCents: number;
  orderedTaxCents: number;
  orderedTotalCents: number;
  billedSubtotalCents: number;
  billedTaxCents: number;
  billedTotalCents: number;
  outstandingSubtotalCents: number;
  outstandingTaxCents: number;
  outstandingTotalCents: number;
}

export interface PurchaseOrderCommitment {
  purchaseOrderId: string;
  purchaseOrderStatus: string;
  supplierId: string;
  currency: string;
  commitmentEffectiveAt: string | null;
  periodResolution: CommitmentPeriodResolution;
  lineCount: number;
  orderedSubtotalCents: number;
  orderedTaxCents: number;
  orderedTotalCents: number;
  billedSubtotalCents: number;
  billedTaxCents: number;
  billedTotalCents: number;
  outstandingSubtotalCents: number;
  outstandingTaxCents: number;
  outstandingTotalCents: number;
  lines: PurchaseLineCommitment[];
}

export type RawPurchaseCommitmentRow = {
  purchase_order_id: string;
  purchase_order_status: string;
  supplier_id: string;
  currency: string;
  issued_at: string | null;
  purchase_order_cost_centre_id: string | null;
  line_id: string | null;
  position: number | null;
  description_snapshot: string | null;
  line_cost_centre_id: string | null;
  ordered_subtotal_cents: number | null;
  ordered_tax_cents: number | null;
  ordered_total_cents: number | null;
  billed_subtotal_cents: string;
  billed_tax_cents: string;
  billed_total_cents: string;
};

function cents(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('commitment money value is not a safe integer number of cents');
  }
  return parsed;
}

export function derivePurchaseOrderCommitment(
  rows: RawPurchaseCommitmentRow[],
): PurchaseOrderCommitment | null {
  if (rows.length === 0) return null;

  const header = rows[0];
  const isIssued = header.purchase_order_status === 'ISSUED';

  const lines = rows.flatMap<PurchaseLineCommitment>((row) => {
    if (!row.line_id) return [];

    const orderedSubtotalCents = cents(row.ordered_subtotal_cents);
    const orderedTaxCents = cents(row.ordered_tax_cents);
    const orderedTotalCents = cents(row.ordered_total_cents);
    const billedSubtotalCents = cents(row.billed_subtotal_cents);
    const billedTaxCents = cents(row.billed_tax_cents);
    const billedTotalCents = cents(row.billed_total_cents);

    const overbilled =
      billedSubtotalCents > orderedSubtotalCents
      || billedTaxCents > orderedTaxCents
      || billedTotalCents > orderedTotalCents;

    let state: PurchaseCommitmentState;
    if (!isIssued) {
      state = 'NOT_COMMITTED';
    } else if (overbilled) {
      state = 'INVALID_OVERBILLED';
    } else if (billedTotalCents === orderedTotalCents) {
      state = 'CONSUMED';
    } else if (billedTotalCents === 0) {
      state = 'OPEN';
    } else {
      state = 'PARTIALLY_CONSUMED';
    }

    return [{
      purchaseOrderLineId: row.line_id,
      position: Number(row.position ?? 0),
      description: row.description_snapshot ?? '',
      effectiveCostCentreId: row.line_cost_centre_id ?? row.purchase_order_cost_centre_id,
      state,
      orderedSubtotalCents,
      orderedTaxCents,
      orderedTotalCents,
      billedSubtotalCents,
      billedTaxCents,
      billedTotalCents,
      outstandingSubtotalCents: isIssued ? orderedSubtotalCents - billedSubtotalCents : 0,
      outstandingTaxCents: isIssued ? orderedTaxCents - billedTaxCents : 0,
      outstandingTotalCents: isIssued ? orderedTotalCents - billedTotalCents : 0,
    }];
  });

  return {
    purchaseOrderId: header.purchase_order_id,
    purchaseOrderStatus: header.purchase_order_status,
    supplierId: header.supplier_id,
    currency: header.currency,
    commitmentEffectiveAt: isIssued ? header.issued_at : null,
    periodResolution: 'UNRESOLVED',
    lineCount: lines.length,
    orderedSubtotalCents: lines.reduce((sum, line) => sum + line.orderedSubtotalCents, 0),
    orderedTaxCents: lines.reduce((sum, line) => sum + line.orderedTaxCents, 0),
    orderedTotalCents: lines.reduce((sum, line) => sum + line.orderedTotalCents, 0),
    billedSubtotalCents: lines.reduce((sum, line) => sum + line.billedSubtotalCents, 0),
    billedTaxCents: lines.reduce((sum, line) => sum + line.billedTaxCents, 0),
    billedTotalCents: lines.reduce((sum, line) => sum + line.billedTotalCents, 0),
    outstandingSubtotalCents: lines.reduce((sum, line) => sum + line.outstandingSubtotalCents, 0),
    outstandingTaxCents: lines.reduce((sum, line) => sum + line.outstandingTaxCents, 0),
    outstandingTotalCents: lines.reduce((sum, line) => sum + line.outstandingTotalCents, 0),
    lines,
  };
}

// One SQL statement gives one PostgreSQL statement snapshot. Every
// contributing table is explicitly organisation-scoped. Only POSTED supplier
// bills contribute; DRAFT/CANCELLED bills therefore disappear automatically.
export async function getPurchaseOrderCommitment(
  organisationId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderCommitment | null> {
  const rows = (await sql`
    WITH billed AS (
      SELECT
        csbl.source_purchase_order_line_id AS line_id,
        COALESCE(SUM(csbl.line_subtotal_cents), 0) AS billed_subtotal_cents,
        COALESCE(SUM(csbl.line_tax_cents), 0) AS billed_tax_cents,
        COALESCE(SUM(csbl.line_total_cents), 0) AS billed_total_cents
      FROM commercial_supplier_bill_lines csbl
      JOIN commercial_supplier_bills csb
        ON csb.id = csbl.supplier_bill_id
       AND csb.organisation_id = csbl.organisation_id
      JOIN commercial_purchase_order_lines source_line
        ON source_line.id = csbl.source_purchase_order_line_id
       AND source_line.organisation_id = csbl.organisation_id
      WHERE csbl.organisation_id = ${organisationId}
        AND source_line.purchase_order_id = ${purchaseOrderId}
        AND csb.source_purchase_order_id = ${purchaseOrderId}
        AND csb.status = 'POSTED'
      GROUP BY csbl.source_purchase_order_line_id
    )
    SELECT
      cpo.id AS purchase_order_id,
      cpo.status AS purchase_order_status,
      cpo.supplier_id,
      cpo.currency,
      cpo.issued_at,
      cpo.cost_centre_id AS purchase_order_cost_centre_id,
      cpol.id AS line_id,
      cpol.position,
      cpol.description_snapshot,
      cpol.cost_centre_id AS line_cost_centre_id,
      cpol.line_subtotal_cents AS ordered_subtotal_cents,
      cpol.line_tax_cents AS ordered_tax_cents,
      cpol.line_total_cents AS ordered_total_cents,
      COALESCE(b.billed_subtotal_cents, 0)::text AS billed_subtotal_cents,
      COALESCE(b.billed_tax_cents, 0)::text AS billed_tax_cents,
      COALESCE(b.billed_total_cents, 0)::text AS billed_total_cents
    FROM commercial_purchase_orders cpo
    LEFT JOIN commercial_purchase_order_lines cpol
      ON cpol.purchase_order_id = cpo.id
     AND cpol.organisation_id = cpo.organisation_id
    LEFT JOIN billed b ON b.line_id = cpol.id
    WHERE cpo.id = ${purchaseOrderId}
      AND cpo.organisation_id = ${organisationId}
    ORDER BY cpol.position ASC NULLS LAST, cpol.id ASC NULLS LAST
  `) as RawPurchaseCommitmentRow[];

  return derivePurchaseOrderCommitment(rows);
}
