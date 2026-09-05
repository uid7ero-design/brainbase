import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { addQuoteLine } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json();
  const { productId, description, quantity, unitPriceCents, taxCodeId } = body;
  if (quantity === undefined) return NextResponse.json({ error: 'quantity is required.' }, { status: 400 });

  try {
    const line = await addQuoteLine({
      organisationId: auth.session.organisationId,
      quoteId: id,
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
