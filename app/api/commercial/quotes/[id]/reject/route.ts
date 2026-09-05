import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { rejectQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

// 'approve' (admin) — same reasoning as accept/route.ts.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const quote = await rejectQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to reject quote.' }, { status: 400 });
  }
}
