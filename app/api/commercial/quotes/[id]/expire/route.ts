import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { expireQuote } from '@/lib/commercial/quotes';

type Ctx = { params: Promise<{ id: string }> };

// 'createEdit' (manager) — expiry is routine document-lifecycle
// bookkeeping (marking a quote past its own expiry_date as no longer
// live), not an approval/rejection decision. There is no automatic
// scheduled-job expiry in C3 (out of scope) — this is a manual action a
// manager takes.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const quote = await expireQuote({ organisationId: auth.session.organisationId, userId: auth.session.userId, quoteId: id });
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to expire quote.' }, { status: 400 });
  }
}
