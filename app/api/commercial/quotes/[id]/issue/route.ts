import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { issueQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

// 'createEdit' (manager), not 'approve' (admin) — issuing is the
// seller's own outbound action on their own draft, not an
// approval/rejection decision (that tier is reserved for accept/reject
// below, matching COMMERCIAL_MIN_ROLE's own documented definition of
// 'approve'). Same floor as creating/editing the draft in the first
// place.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const quote = await issueQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to issue quote.' }, { status: 400 });
  }
}
