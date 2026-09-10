import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { submitPurchaseOrder } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.4 — mirrors app/api/commercial/invoices/[id]/issue/route.ts's
// shape: 'createEdit' (manager+) — submitting a DRAFT the requester
// themselves authored for approval is the requester's own action, not a
// higher-trust one (see submitPurchaseOrder()'s own header comment).
// submitPurchaseOrder() is the sole source of transition/lock
// correctness — this route only translates its thrown Error into an
// HTTP response. A wrong-state attempt (assertPurchaseOrderTransition's
// "Cannot transition purchase order from X to Y") and a genuine
// concurrent-status race both map to 409 (a conflict with current
// state), distinct from the 400 "no lines" business-rule rejection and
// the 404 not-found/cross-org case.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const purchaseOrder = await submitPurchaseOrder({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrderId: id });
    return NextResponse.json({ purchaseOrder });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to submit purchase order.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase order')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
