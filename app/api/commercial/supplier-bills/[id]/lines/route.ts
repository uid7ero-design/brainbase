import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { addSupplierBillLine } from '@/lib/commercial/supplierBills';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 — mirrors app/api/commercial/purchase-receipts/[id]/lines/route.ts's
// shape. sourcePurchaseOrderLineId is REQUIRED (not optional) — every
// normal bill line must reference a concrete PO line. Unlike a receipt
// line, a bill line is a money fact — quantity and unitPriceCents are
// both required (the supplier's actual invoiced amount, which the
// over-billing guard checks against the PO line's ordered value only at
// POST time, not here).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { sourcePurchaseOrderLineId, productId, description, quantity, unitPriceCents, taxCodeId } = body;
  if (typeof sourcePurchaseOrderLineId !== 'string' || !sourcePurchaseOrderLineId) {
    return NextResponse.json({ error: 'sourcePurchaseOrderLineId is required.' }, { status: 400 });
  }
  if (quantity === undefined) return NextResponse.json({ error: 'quantity is required.' }, { status: 400 });

  try {
    const line = await addSupplierBillLine({
      organisationId: auth.session.organisationId,
      supplierBillId: id,
      sourcePurchaseOrderLineId,
      productId: productId ?? null,
      description: description ?? undefined,
      quantity: Number(quantity),
      unitPriceCents: unitPriceCents !== undefined ? Number(unitPriceCents) : undefined,
      taxCodeId: taxCodeId ?? null,
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
