import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { cancelPurchaseReceipt } from '@/lib/commercial/purchaseReceipts';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.3 — admin+ (approve floor, per the C7.3 capability matrix),
// required non-empty reason validated at the route level before the
// domain is ever called — mirrors app/api/commercial/purchase-orders/[id]/cancel/route.ts
// exactly. cancelPurchaseReceipt() only accepts a POSTED receipt and
// never deletes or renumbers anything.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { reason } = body;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A cancel reason is required.' }, { status: 400 });
  }

  try {
    const purchaseReceipt = await cancelPurchaseReceipt({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseReceiptId: id, reason });
    return NextResponse.json({ purchaseReceipt });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel purchase receipt.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase receipt')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
