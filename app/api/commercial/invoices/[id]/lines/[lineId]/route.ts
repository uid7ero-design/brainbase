import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { updateInvoiceLine, deleteInvoiceLine } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

// Phase C4.2 — mirrors app/api/commercial/quotes/[id]/lines/[lineId]/route.ts.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  const body = await req.json().catch(() => ({}));
  const { description, quantity, unitPriceCents, taxCodeId, position } = body;

  try {
    const line = await updateInvoiceLine({
      organisationId: auth.session.organisationId,
      invoiceId: id,
      lineId,
      description,
      quantity: quantity === undefined ? undefined : Number(quantity),
      unitPriceCents: unitPriceCents === undefined ? undefined : Number(unitPriceCents),
      taxCodeId,
      position: position === undefined ? undefined : Number(position),
    });
    if (!line) return NextResponse.json({ error: 'Not found, or invoice no longer a draft.' }, { status: 404 });
    return NextResponse.json({ line });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update line.' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, lineId } = await params;

  try {
    const ok = await deleteInvoiceLine({ organisationId: auth.session.organisationId, invoiceId: id, lineId });
    if (!ok) return NextResponse.json({ error: 'Not found, or invoice no longer a draft.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete line.' }, { status: 400 });
  }
}
