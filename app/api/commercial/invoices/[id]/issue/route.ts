import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { issueInvoice } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 — mirrors app/api/commercial/quotes/[id]/issue/route.ts:
// 'createEdit' (manager), matching the C4.2 brief's own ISSUE = manager+
// floor. issueInvoice() itself is the sole source of atomicity/numbering
// correctness (see lib/commercial/invoices.ts's issueInvoiceAtomically())
// — this route only translates its thrown Error into an HTTP response.
//
// A concurrent-loss ("invoice status changed concurrently...") is
// reported as 409, not 400 — this repository's own convention reserves
// 409 for a genuine state/concurrency conflict (see the C4.2 brief's own
// error-contract guidance); every other domain rejection (missing due
// date, no lines, not found) is a 400/404 client-input problem, not a
// conflict.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const invoice = await issueInvoice({ organisationId: auth.session.organisationId, userId: auth.session.userId, invoiceId: id });
    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to issue invoice.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('concurrently')) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
