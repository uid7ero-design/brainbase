import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { voidInvoice } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string }> };

// Phase C4.2 — VOID requires admin+ (COMMERCIAL_MIN_ROLE.approve), matching
// the C4.2 brief's explicit floor and authorize.ts's own documented
// rationale for that tier ("a higher-trust action than an ordinary edit").
// void_reason validation (non-empty after trim) is enforced by
// voidInvoice() itself — this route only forwards the raw body value and
// translates the resulting Error.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { reason } = body;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A void reason is required.' }, { status: 400 });
  }

  try {
    const invoice = await voidInvoice({ organisationId: auth.session.organisationId, userId: auth.session.userId, invoiceId: id, voidReason: reason });
    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to void invoice.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    // Phase C5.2 — a paid/partially-paid invoice's void attempt and a
    // genuine concurrent-status-change race both surface as this same
    // atomic UPDATE affecting zero rows; both are conflicts with the
    // invoice's current state, so both map to 409, distinguished only
    // by the message text (voidInvoice() itself, lib/commercial/invoices.ts,
    // determines which one actually happened via a follow-up read).
    if (message.includes('concurrently') || message.includes('recorded payments')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
