import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  createPurchaseMatchAllocation,
  getPurchaseMatchWorkspace,
} from '@/lib/commercial/purchaseMatchAllocations';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const workspace = await getPurchaseMatchWorkspace(auth.session.organisationId, id);
  if (!workspace) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ workspace });
}
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  const { purchaseReceiptLineId, supplierBillLineId, quantity } = body;

  if (typeof purchaseReceiptLineId !== 'string' || typeof supplierBillLineId !== 'string') {
    return NextResponse.json({ error: 'Receipt line and supplier bill line are required.' }, { status: 400 });
  }
  if (typeof quantity !== 'string' && typeof quantity !== 'number') {
    return NextResponse.json({ error: 'Quantity is required.' }, { status: 400 });
  }

  try {
    const allocation = await createPurchaseMatchAllocation({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseOrderId: id,
      purchaseReceiptLineId,
      supplierBillLineId,
      quantity,
    });
    return NextResponse.json({ allocation }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create purchase match.';
    if (message.includes('exist in this organisation')) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    if (message.includes('already exists') || message.includes('changed concurrently')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
