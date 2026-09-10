import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { addPurchaseOrderLine } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.3 — mirrors app/api/commercial/invoices/[id]/lines/route.ts's
// "Option A" nested-route shape exactly. addPurchaseOrderLine() itself
// throws (via assertPurchaseOrderEditable()) when the parent PO is no
// longer DRAFT, and throws a distinct "purchase order not found for this
// organisation" message when the parent id doesn't resolve for this
// org — both are mapped below, the former to 409 (lifecycle conflict),
// the latter to 404, rather than the single conflated 404 the older
// invoice-line route uses (see updateInvoiceLine/deleteInvoiceLine,
// which return null for both cases).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { productId, description, quantity, unitPriceCents, taxCodeId, costCentreId } = body;
  if (quantity === undefined) return NextResponse.json({ error: 'quantity is required.' }, { status: 400 });

  try {
    const line = await addPurchaseOrderLine({
      organisationId: auth.session.organisationId,
      purchaseOrderId: id,
      productId: productId ?? null,
      description,
      quantity: Number(quantity),
      unitPriceCents: unitPriceCents === undefined ? undefined : Number(unitPriceCents),
      taxCodeId: taxCodeId ?? null,
      costCentreId: costCentreId ?? null,
    });
    return NextResponse.json({ line }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add line.';
    const status = /can no longer be edited/.test(message)
      ? 409
      : /not found for this organisation/.test(message)
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
