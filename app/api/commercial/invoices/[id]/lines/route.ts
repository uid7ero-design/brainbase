import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { addInvoiceLine } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 — mirrors app/api/commercial/quotes/[id]/lines/route.ts.
// addInvoiceLine() itself enforces same-org invoice/product/tax-code and
// DRAFT-only editability, and is the sole source of the authoritative,
// recalculated totals returned afterward — this route never computes
// money/tax itself.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { productId, description, quantity, unitPriceCents, taxCodeId } = body;
  if (quantity === undefined) return NextResponse.json({ error: 'quantity is required.' }, { status: 400 });

  try {
    const line = await addInvoiceLine({
      organisationId: auth.session.organisationId,
      invoiceId: id,
      productId: productId ?? null,
      description,
      quantity: Number(quantity),
      unitPriceCents: unitPriceCents === undefined ? undefined : Number(unitPriceCents),
      taxCodeId: taxCodeId ?? null,
    });
    return NextResponse.json({ line }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to add line.' }, { status: 400 });
  }
}
