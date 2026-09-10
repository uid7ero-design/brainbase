import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { updatePurchaseOrderLine, deletePurchaseOrderLine } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

// Phase C6.3 — mirrors app/api/commercial/invoices/[id]/lines/[lineId]/route.ts.
// Both updatePurchaseOrderLine() and deletePurchaseOrderLine() return
// null/false for "parent PO not found for this org" OR "line not found"
// (conflated, same as the invoice-line equivalents) — mapped to 404 —
// but THROW (via assertPurchaseOrderEditable()) for "parent PO is no
// longer DRAFT", mapped to 409 rather than folded into the same 404.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  const body = await req.json().catch(() => ({}));
  const { description, quantity, unitPriceCents, taxCodeId, costCentreId } = body;

  try {
    const line = await updatePurchaseOrderLine({
      organisationId: auth.session.organisationId,
      purchaseOrderId: id,
      lineId,
      description,
      quantity: quantity === undefined ? undefined : Number(quantity),
      unitPriceCents: unitPriceCents === undefined ? undefined : Number(unitPriceCents),
      taxCodeId,
      costCentreId,
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
    const ok = await deletePurchaseOrderLine({ organisationId: auth.session.organisationId, purchaseOrderId: id, lineId });
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete line.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
