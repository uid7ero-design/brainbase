import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { acceptQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

// 'approve' (admin) — accept/reject is exactly the "approval/rejection
// decision" COMMERCIAL_MIN_ROLE.approve is documented for. There is no
// customer-facing portal in C3 (out of scope), so this is a staff-side
// record of the customer's real-world decision, not a customer action.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const quote = await acceptQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to accept quote.' }, { status: 400 });
  }
}
