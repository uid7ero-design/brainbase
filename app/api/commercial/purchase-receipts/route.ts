import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listPurchaseReceipts, createPurchaseReceipt } from '@/lib/commercial/purchaseReceipts';
import { PURCHASE_RECEIPT_STATUSES, type PurchaseReceiptStatus } from '@/lib/commercial/purchaseReceiptLifecycle';

// Phase C7.3 — mirrors app/api/commercial/purchase-orders/route.ts's
// shape exactly, including validating the status filter against the
// real status union before it ever reaches the domain layer.
export async function GET(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam && (PURCHASE_RECEIPT_STATUSES as string[]).includes(statusParam) ? (statusParam as PurchaseReceiptStatus) : undefined;

  const purchaseReceipts = await listPurchaseReceipts(auth.session.organisationId, { status });
  return NextResponse.json({ purchaseReceipts });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { purchaseOrderId, receivedDate, deliveryReference, notes } = body;
  if (typeof purchaseOrderId !== 'string' || !purchaseOrderId) {
    return NextResponse.json({ error: 'purchaseOrderId is required.' }, { status: 400 });
  }

  try {
    const purchaseReceipt = await createPurchaseReceipt({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseOrderId,
      receivedDate: receivedDate ?? null,
      deliveryReference: deliveryReference ?? null,
      notes: notes ?? null,
    });
    return NextResponse.json({ purchaseReceipt }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create purchase receipt.';
    const status = /not found for this organisation/.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
