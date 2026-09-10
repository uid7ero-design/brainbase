import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { issuePurchaseOrder } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.4 — the highest-risk transition. ISSUE requires admin+
// (COMMERCIAL_MIN_ROLE.approve), one deliberate step after APPROVE (this
// route never combines approve+issue). Number allocation, the
// APPROVED-status guard, and the supplier snapshot are ALL owned by
// issuePurchaseOrder()'s own atomic statement
// (issuePurchaseOrderAtomically() in lib/commercial/purchaseOrders.ts) —
// this route allocates nothing itself and simply forwards the resulting
// purchase_order_number in the response. No retry/idempotency logic is
// added here: the atomic guard itself is what makes a second concurrent
// issue attempt on the same row safe (it necessarily finds the row no
// longer APPROVED and throws the same "changed concurrently" error,
// mapped to 409 below), so an accidental double-click double-submit can
// never allocate a second number.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const purchaseOrder = await issuePurchaseOrder({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrderId: id });
    return NextResponse.json({ purchaseOrder });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to issue purchase order.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase order')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
