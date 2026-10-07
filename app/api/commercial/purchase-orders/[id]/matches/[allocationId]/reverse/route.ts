import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { reversePurchaseMatchAllocation } from '@/lib/commercial/purchaseMatchAllocations';

type Ctx = { params: Promise<{ id: string; allocationId: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, allocationId } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  const { reason } = body;

  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A reversal reason is required.' }, { status: 400 });
  }
  try {
    const allocation = await reversePurchaseMatchAllocation({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseOrderId: id,
      allocationId,
      reason,
    });
    if (!allocation) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ allocation });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reverse purchase match.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
