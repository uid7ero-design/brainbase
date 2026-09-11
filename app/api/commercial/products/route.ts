import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listProducts, createProduct, type CommercialProductType } from '@/lib/commercial/products';

// Phase C6.3 — widened to include 'purchasing' alongside the existing
// 'quotes'/'invoicing' readers: the product catalogue is a shared,
// capability-agnostic org resource (see createProduct()'s own lack of a
// capability-specific column), and PO lines now need the same
// catalogued-vs-ad-hoc product lookup quote/invoice lines already use.
// Read-only; POST (product/service administration) is left untouched —
// C6.3 never creates or edits products.
export async function GET() {
  const auth = await authorizeCommercialRequest(['quotes', 'invoicing', 'purchasing'], COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const products = await listProducts(auth.session.organisationId);
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  // C6.9 remediation — widened to include 'purchasing', matching the
  // sibling GET's own C6.3 widening (see that handler's comment): the
  // catalogue is one shared, capability-agnostic resource, so a
  // purchasing-only organisation must be able to create/maintain it too,
  // not just read it.
  const auth = await authorizeCommercialRequest(['quotes', 'invoicing', 'purchasing'], COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { type, name, description, sku, unitLabel, defaultUnitPriceCents, currency, defaultTaxCodeId } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (type !== 'PRODUCT' && type !== 'SERVICE') return NextResponse.json({ error: "type must be 'PRODUCT' or 'SERVICE'." }, { status: 400 });

  try {
    const product = await createProduct({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      type: type as CommercialProductType,
      name: name.trim(),
      description: description ?? null,
      sku: sku ?? null,
      unitLabel: unitLabel ?? null,
      defaultUnitPriceCents: Number(defaultUnitPriceCents ?? 0),
      currency: currency ?? 'AUD',
      defaultTaxCodeId: defaultTaxCodeId ?? null,
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create product.' }, { status: 400 });
  }
}
