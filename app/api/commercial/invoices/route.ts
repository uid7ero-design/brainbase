import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listInvoices, createDraftInvoice } from '@/lib/commercial/invoices';
import type { InvoiceStatus } from '@/lib/commercial/invoiceLifecycle';
import { INVOICE_STATUSES } from '@/lib/commercial/invoiceLifecycle';

// Phase C4.2 — mirrors app/api/commercial/quotes/route.ts's shape
// exactly. organisationId always comes from authorizeCommercialRequest()'s
// own session resolution, never from request input.
//
// The GET filter surface is deliberately status-only, matching what
// lib/commercial/invoices.ts's listInvoices() actually supports today —
// a customer/search filter would require either duplicating query logic
// here (this route must call the domain layer, never reimplement it) or
// extending the domain layer speculatively, neither of which this phase
// needs (per its own "do not overbuild filters" instruction).
export async function GET(req: NextRequest) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam && (INVOICE_STATUSES as string[]).includes(statusParam) ? (statusParam as InvoiceStatus) : undefined;

  const invoices = await listInvoices(auth.session.organisationId, { status });
  return NextResponse.json({ invoices });
}

// Only the fields a standalone draft may legitimately be created with are
// read from the body — invoice_number/status/snapshots/issued metadata/
// totals are exclusively server/domain-controlled and are never accepted
// here, matching createDraftInvoice()'s own parameter list exactly (it
// has no way to set any of those fields even if a caller tried).
export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { customerId, currency, notes, terms, dueDate, paymentTermsDays } = body;
  if (!customerId) return NextResponse.json({ error: 'customerId is required.' }, { status: 400 });

  try {
    const invoice = await createDraftInvoice({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      customerId,
      currency: currency ?? 'AUD',
      notes: notes ?? null,
      terms: terms ?? null,
      dueDate: dueDate ?? null,
      paymentTermsDays: paymentTermsDays === undefined || paymentTermsDays === null ? null : Number(paymentTermsDays),
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create invoice.' }, { status: 400 });
  }
}
