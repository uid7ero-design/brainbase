import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { postSupplierBill } from '@/lib/commercial/supplierBills';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 — admin+ (approve floor). Unlike purchase receipts (posted
// at manager+), posting a supplier bill is a higher-trust action per the
// explicit C7.4 capability matrix — it allocates a permanent bill_number
// and represents a real payable fact. All of the actual posting logic —
// the parent PO's ISSUED check, the strict over-billing guard, and the
// atomic bill-number allocation + supplier-snapshot freeze — lives
// entirely in postSupplierBill()/postSupplierBillAtomically()
// (lib/commercial/supplierBills.ts); this route never retries on failure
// and never allocates or guesses a number itself.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const supplierBill = await postSupplierBill({ organisationId: auth.session.organisationId, userId: auth.session.userId, supplierBillId: id });
    return NextResponse.json({ supplierBill });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post supplier bill.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently') || message.includes('Cannot transition supplier bill')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes('beyond the ordered value') || message.includes('ISSUED') || message.includes('no lines')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
