import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listQuotes, createDraftQuote } from '@/lib/commercial/quotes';
import type { QuoteStatus } from '@/lib/commercial/quoteLifecycle';
import { QUOTE_STATUSES } from '@/lib/commercial/quoteLifecycle';

export async function GET(req: NextRequest) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam && (QUOTE_STATUSES as string[]).includes(statusParam) ? (statusParam as QuoteStatus) : undefined;

  const quotes = await listQuotes(auth.session.organisationId, { status });
  return NextResponse.json({ quotes });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { customerId, currency, notes, terms, expiryDate } = body;
  if (!customerId) return NextResponse.json({ error: 'customerId is required.' }, { status: 400 });

  try {
    const quote = await createDraftQuote({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      customerId,
      currency: currency ?? 'AUD',
      notes: notes ?? null,
      terms: terms ?? null,
      expiryDate: expiryDate ?? null,
    });
    return NextResponse.json({ quote }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create quote.' }, { status: 400 });
  }
}
