import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { cancelSupplierBill } from '@/lib/commercial/supplierBills';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 Ã¢â‚¬â€ admin+ (approve floor), required non-empty reason
// validated at the route level before the domain is ever called Ã¢â‚¬â€
// mirrors app/api/commercial/purchase-receipts/[id]/cancel/route.ts
// exactly. cancelSupplierBill() only accepts a POSTED bill and never
// deletes or renumbers anything. AP settlement now adds a server-side
// guard: active supplier payments must be reversed before cancellation.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  const { reason } = body;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A cancel reason is required.' }, { status: 400 });
  }

  try {
    const supplierBill = await cancelSupplierBill({ organisationId: auth.session.organisationId, userId: auth.session.userId, supplierBillId: id, reason });
    return NextResponse.json({ supplierBill });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel supplier bill.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition supplier bill')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
