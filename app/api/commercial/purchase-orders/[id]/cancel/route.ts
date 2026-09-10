import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { cancelPurchaseOrder } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.4 — mirrors app/api/commercial/invoices/[id]/void/route.ts's
// shape: admin+ (COMMERCIAL_MIN_ROLE.approve), required non-empty reason
// validated at the route level before the domain is ever called.
// cancelPurchaseOrder() only accepts an ISSUED purchase order and never
// deletes or renumbers anything — purchase_order_number, every supplier
// snapshot field, line data, and totals are all left untouched by its
// own UPDATE (see its header comment) — this route adds no logic on
// top of that.
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
    const purchaseOrder = await cancelPurchaseOrder({ organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrderId: id, reason });
    return NextResponse.json({ purchaseOrder });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel purchase order.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition purchase order')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
