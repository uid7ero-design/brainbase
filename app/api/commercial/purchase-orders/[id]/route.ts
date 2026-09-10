import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrderWithLines, updateDraftPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { listDeliveriesForDocument } from '@/lib/commercial/documentDeliveries';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.3 — GET returns the header plus its lines in one payload
// (mirrors invoices' own getInvoiceWithLines shape) since the detail
// page always needs both. PATCH is DRAFT-only: updateDraftPurchaseOrder()
// itself enforces this (its UPDATE has `AND status = 'DRAFT'`, and it
// throws via assertPurchaseOrderEditable() before that if the row is
// already non-DRAFT) — the route's only job is to translate that thrown
// error into a 409 so the client can distinguish "this PO is no longer
// editable" from a validation failure.
//
// No PUT route here — unlike invoices' full-replace PUT, this gate's
// Section D specifies GET+PATCH only for purchase-orders, with PATCH
// covering the DRAFT partial-update case (there is no active/inactive
// toggle concept for a purchase order the way there is for a supplier).
//
// Phase C6.5 — folds in delivery history, mirroring
// app/api/commercial/invoices/[id]/route.ts's own identical addition
// (Phase C4.3B) exactly: a small, bounded reuse of the existing
// commercial_document_deliveries read path, not new API surface. A
// wrong-tenant/missing PO 404s before the delivery lookup is ever
// reached (same ordering as the invoice route).
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const result = await getPurchaseOrderWithLines(auth.session.organisationId, id);
  if (!result) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const deliveries = await listDeliveriesForDocument({ organisationId: auth.session.organisationId, documentType: 'purchase_order', documentId: id });
  return NextResponse.json({ ...result, deliveries });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const {
    supplierId, costCentreId, supplierReference, deliveryDate,
    deliveryAddressLine1, deliveryAddressLine2, deliverySuburb, deliveryState, deliveryPostcode, deliveryCountry,
    paymentTermsDays, internalNotes, supplierNotes,
  } = body;

  try {
    const purchaseOrder = await updateDraftPurchaseOrder({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseOrderId: id,
      supplierId,
      costCentreId,
      supplierReference,
      deliveryDate,
      deliveryAddressLine1,
      deliveryAddressLine2,
      deliverySuburb,
      deliveryState,
      deliveryPostcode,
      deliveryCountry,
      paymentTermsDays: paymentTermsDays === undefined ? undefined : (paymentTermsDays === null ? null : Number(paymentTermsDays)),
      internalNotes,
      supplierNotes,
    });
    if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ purchaseOrder });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update purchase order.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
