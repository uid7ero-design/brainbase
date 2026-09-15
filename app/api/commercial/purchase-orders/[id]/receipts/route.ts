import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { listPurchaseReceiptsForPurchaseOrder, getReceivedQuantitiesForPurchaseOrder } from '@/lib/commercial/purchaseReceipts';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.3 — the PO detail page's "linked receipts" panel and derived
// received-to-date display. view floor, same as every other read route.
// receivedQuantities is DERIVED (POSTED, non-cancelled receipt lines
// only, grouped by source_purchase_order_line_id) — never a stored
// column on the PO or its lines (see scripts/create-commercial-purchase-
// receipts.sql's own header for why, and
// tests/containment/commercialPurchasingSchema.test.ts's existing
// negative assertions this must never violate).
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [purchaseReceipts, receivedQuantities] = await Promise.all([
    listPurchaseReceiptsForPurchaseOrder(auth.session.organisationId, id),
    getReceivedQuantitiesForPurchaseOrder(auth.session.organisationId, id),
  ]);

  return NextResponse.json({ purchaseReceipts, receivedQuantities });
}
