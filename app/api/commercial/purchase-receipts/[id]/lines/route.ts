import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { addPurchaseReceiptLine } from '@/lib/commercial/purchaseReceipts';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.3 — mirrors app/api/commercial/purchase-orders/[id]/lines/route.ts's
// shape exactly. sourcePurchaseOrderLineId is REQUIRED (not optional) —
// C7.3's own explicit correction: every normal receipt line must
// reference a concrete PO line; there is no freeform/unplanned receipt
// line in this phase. addPurchaseReceiptLine() itself throws (via
// assertPurchaseReceiptEditable()) when the parent receipt is no longer
// DRAFT, and throws a distinct "not found" message for a missing/
// cross-tenant/cross-PO source line — mapped below to 409 and 404/400
// respectively.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { sourcePurchaseOrderLineId, quantityReceived } = body;
  if (typeof sourcePurchaseOrderLineId !== 'string' || !sourcePurchaseOrderLineId) {
    return NextResponse.json({ error: 'sourcePurchaseOrderLineId is required.' }, { status: 400 });
  }
  if (quantityReceived === undefined) return NextResponse.json({ error: 'quantityReceived is required.' }, { status: 400 });

  try {
    const line = await addPurchaseReceiptLine({
      organisationId: auth.session.organisationId,
      purchaseReceiptId: id,
      sourcePurchaseOrderLineId,
      quantityReceived: Number(quantityReceived),
    });
    return NextResponse.json({ line }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add line.';
    const status = /can no longer be edited/.test(message)
      ? 409
      : /not found for this|not found on this purchase order/.test(message)
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
