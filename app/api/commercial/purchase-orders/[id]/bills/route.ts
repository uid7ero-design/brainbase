import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { listSupplierBillsForPurchaseOrder, getBilledAmountsForPurchaseOrder } from '@/lib/commercial/supplierBills';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 — the PO detail page's "linked supplier bills" panel and
// derived billed-to-date display. view floor, same as every other read
// route. billedAmounts is DERIVED (POSTED, non-cancelled bill lines
// only, grouped by source_purchase_order_line_id, summed as
// line_total_cents — a VALUE, not a quantity) — never a stored column on
// the PO or its lines.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [supplierBills, billedAmounts] = await Promise.all([
    listSupplierBillsForPurchaseOrder(auth.session.organisationId, id),
    getBilledAmountsForPurchaseOrder(auth.session.organisationId, id),
  ]);

  return NextResponse.json({ supplierBills, billedAmounts });
}
