import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { approvePurchaseOrder } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.4 — APPROVE requires admin+ (COMMERCIAL_MIN_ROLE.approve), per
// this gate's explicit floor — a higher-trust action than the
// requester's own submit. Deliberately a SEPARATE step from issue (see
// approvePurchaseOrder()'s own header comment: self-approval is allowed
// in C6.2, but approve and issue remain two distinct, deliberate
// actions — this route never chains into issuePurchaseOrder()).
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const purchaseOrder = await approvePurchaseOrder({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrderId: id });
    return NextResponse.json({ purchaseOrder });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to approve purchase order.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase order')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
