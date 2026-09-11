import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrderWithLines, updateDraftPurchaseOrder, deleteDraftPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { listDeliveriesForDocument } from '@/lib/commercial/documentDeliveries';
import { getSupplier } from '@/lib/commercial/suppliers';

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
//
// C6.9 remediation — also folds in the LIVE linked supplier
// (lib/commercial/suppliers.ts's getSupplier(), the same tenant-scoped
// lookup issuePurchaseOrder() itself uses to build the snapshot). Root
// cause of the pre-issue "Supplier: —" bug: the detail page only ever
// had purchase_order.supplier_id plus the supplier_*_snapshot columns,
// and those snapshot columns are null until ISSUE — there was never a
// live-supplier value in this payload for the page to fall back to.
// `supplier` here is CURRENT/live data, always fetched regardless of
// status — the client (not this route) is responsible for the
// display-only decision to ignore it once the PO is ISSUED/CANCELLED in
// favour of the frozen snapshot fields; this route does not special-case
// status because the underlying data is legitimately correct either way,
// and returning it uniformly keeps this route's shape simple and
// testable. A missing/deleted supplier resolves to `supplier: null`
// (tenant-scoped lookup, same null-safe discipline as every other
// getX(organisationId, id) in lib/commercial/*).
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const result = await getPurchaseOrderWithLines(auth.session.organisationId, id);
  if (!result) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [deliveries, supplier] = await Promise.all([
    listDeliveriesForDocument({ organisationId: auth.session.organisationId, documentType: 'purchase_order', documentId: id }),
    getSupplier(auth.session.organisationId, result.purchaseOrder.supplier_id),
  ]);
  return NextResponse.json({ ...result, deliveries, supplier });
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

// C6.9 remediation — safe discard/delete for a never-issued, never-
// submitted DRAFT purchase order. deleteDraftPurchaseOrder() itself
// enforces the full eligibility gate (status = DRAFT AND
// purchase_order_number IS NULL AND submitted_at IS NULL — see that
// function's own comment for why the submitted_at check is stricter than
// the quote/invoice precedent) atomically in its own WHERE clause; this
// route's only job is translating a false/no-match result into one
// generic 404 error that does not distinguish "never
// existed", "wrong tenant", "not a draft", "already numbered", or
// "already submitted" from each other — matching this file's own
// existing not-found discipline (see GET/PATCH above) of never letting a
// caller distinguish those cases from the response alone.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deleteDraftPurchaseOrder({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrderId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or not an eligible never-submitted draft.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
