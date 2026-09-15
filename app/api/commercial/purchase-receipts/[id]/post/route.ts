import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { postPurchaseReceipt } from '@/lib/commercial/purchaseReceipts';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.3 — manager+ (createEdit floor, per the C7.3 capability
// matrix: posting a draft receipt is the requester's own action, no
// approval gate exists for receipts). All of the actual posting logic —
// the parent PO's ISSUED check, the strict over-receipt guard, and the
// atomic receipt-number allocation — lives entirely in
// postPurchaseReceipt()/postPurchaseReceiptAtomically()
// (lib/commercial/purchaseReceipts.ts); this route never retries on
// failure and never allocates or guesses a number itself, mirroring
// app/api/commercial/purchase-orders/[id]/issue/route.ts's own identical
// discipline.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const purchaseReceipt = await postPurchaseReceipt({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseReceiptId: id });
    return NextResponse.json({ purchaseReceipt });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post purchase receipt.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase receipt')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes('more than the ordered quantity') || message.includes('ISSUED') || message.includes('no lines')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
