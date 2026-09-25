import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { updateSupplierBillLine, deleteSupplierBillLine } from '@/lib/commercial/supplierBills';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

// Phase C7.4 — mirrors app/api/commercial/purchase-receipts/[id]/lines/[lineId]/route.ts.
// description/quantity/unitPriceCents/taxCodeId may change via PATCH —
// sourcePurchaseOrderLineId and productId are fixed at line-creation
// time.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  const body = await req.json().catch(() => ({}));
  const { description, quantity, unitPriceCents, taxCodeId } = body;

  try {
    const line = await updateSupplierBillLine({
      organisationId: auth.session.organisationId,
      supplierBillId: id,
      lineId,
      description: description ?? undefined,
      quantity: quantity !== undefined ? quantity : undefined,
      unitPriceCents: unitPriceCents !== undefined ? Number(unitPriceCents) : undefined,
      taxCodeId: taxCodeId !== undefined ? taxCodeId : undefined,
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
    const ok = await deleteSupplierBillLine({ organisationId: auth.session.organisationId, supplierBillId: id, lineId });
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete line.';
    const status = /can no longer be edited/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
