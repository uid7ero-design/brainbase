import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  getPurchaseReceiptWithLines, updateDraftPurchaseReceipt, deletePurchaseReceipt,
  getReceivedQuantitiesForPurchaseOrder,
} from '@/lib/commercial/purchaseReceipts';
import { getPurchaseOrderWithLines } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.3 — mirrors app/api/commercial/purchase-orders/[id]/route.ts's
// shape exactly. GET additionally folds in the parent purchase order
// (with its own lines) and the derived, org-scoped received-to-date map
// for that PO — everything the receipt detail/create-from-PO UI needs
// (ordered / previously received / remaining / this-draft's-own
// quantity) in one payload, with the server remaining the sole
// authority for the actual over-receipt decision at post time.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const result = await getPurchaseReceiptWithLines(auth.session.organisationId, id);
  if (!result) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const poResult = await getPurchaseOrderWithLines(auth.session.organisationId, result.purchaseReceipt.purchase_order_id);
  const receivedQuantities = await getReceivedQuantitiesForPurchaseOrder(auth.session.organisationId, result.purchaseReceipt.purchase_order_id);

  return NextResponse.json({
    ...result,
    purchaseOrder: poResult?.purchaseOrder ?? null,
    purchaseOrderLines: poResult?.lines ?? [],
    receivedQuantities,
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { receivedDate, deliveryReference, notes } = body;

  try {
    const purchaseReceipt = await updateDraftPurchaseReceipt({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseReceiptId: id,
      receivedDate,
      deliveryReference,
      notes,
    });
    if (!purchaseReceipt) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ purchaseReceipt });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update purchase receipt.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// Safe discard/delete for a never-posted DRAFT — deletePurchaseReceipt()
// itself enforces the full eligibility gate (status = DRAFT AND
// receipt_number IS NULL) atomically in its own WHERE clause; this
// route's only job is translating a false result into one generic 404.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deletePurchaseReceipt({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseReceiptId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or not an eligible never-posted draft.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
