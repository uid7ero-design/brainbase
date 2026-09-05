import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getProduct, updateProduct, deactivateProduct, reactivateProduct } from '@/lib/commercial/products';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const product = await getProduct(auth.session.organisationId, id);
  if (!product) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json();
  const { name, description, defaultUnitPriceCents, defaultTaxCodeId } = body;

  try {
    const product = await updateProduct({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      productId: id,
      name,
      description,
      defaultUnitPriceCents: defaultUnitPriceCents === undefined ? undefined : Number(defaultUnitPriceCents),
      defaultTaxCodeId,
    });
    if (!product) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ product });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update product.' }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const { active } = await req.json();
  if (typeof active !== 'boolean') return NextResponse.json({ error: '`active` (boolean) is required.' }, { status: 400 });

  const ok = active
    ? await reactivateProduct({ organisationId: auth.session.organisationId, userId: auth.session.userId, productId: id })
    : await deactivateProduct({ organisationId: auth.session.organisationId, userId: auth.session.userId, productId: id });

  if (!ok) return NextResponse.json({ error: 'Not found or already in that state.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
