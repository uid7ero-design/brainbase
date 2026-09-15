import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { updatePurchaseReceiptLine, deletePurchaseReceiptLine } from '@/lib/commercial/purchaseReceipts';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

// Phase C7.3 — mirrors app/api/commercial/purchase-orders/[id]/lines/[lineId]/route.ts.
// Only quantityReceived may change via PATCH — sourcePurchaseOrderLineId
// is fixed at line-creation time.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  const body = await req.json().catch(() => ({}));
  const { quantityReceived } = body;
  if (quantityReceived === undefined) return NextResponse.json({ error: 'quantityReceived is required.' }, { status: 400 });

  try {
    const line = await updatePurchaseReceiptLine({
      organisationId: auth.session.organisationId,
      purchaseReceiptId: id,
      lineId,
      quantityReceived: Number(quantityReceived),
    });
    if (!line) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ line });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update line.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  try {
    const ok = await deletePurchaseReceiptLine({ organisationId: auth.session.organisationId, purchaseReceiptId: id, lineId });
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete line.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
