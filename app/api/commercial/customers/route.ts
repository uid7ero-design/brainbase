import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listCustomers, createCustomer } from '@/lib/commercial/customers';

// Phase C3 — Customers/Products are gated on the shared Commercial
// resource pool (not a dedicated 'customers'/'products' key — none
// exists, and none is needed).
//
// Phase C4.4A (Finding 3 remediation) — widened from 'quotes'-only to
// ['quotes', 'invoicing'] (OR semantics — see
// lib/commercial/authorize.ts's own header comment): Quotes and
// Invoicing are independently-entitlable capability keys by design, and
// an invoicing-only organisation must be able to create/manage
// customers to invoice, without ever being granted quotes-specific
// access anywhere else. This route itself has no notion of "quotes" or
// "invoicing" beyond this single authorization line — it is the same
// shared implementation either way, never a parallel one.

export async function GET() {
  const auth = await authorizeCommercialRequest(['quotes', 'invoicing'], COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const customers = await listCustomers(auth.session.organisationId);
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest(['quotes', 'invoicing'], COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { name, crmCompanyId, crmContactId, billingEmail, billingPhone, billingAddress, taxBusinessNumber } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  try {
    const customer = await createCustomer({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      name: name.trim(),
      crmCompanyId: crmCompanyId ?? null,
      crmContactId: crmContactId ?? null,
      billingEmail: billingEmail ?? null,
      billingPhone: billingPhone ?? null,
      billingAddress: billingAddress ?? null,
      taxBusinessNumber: taxBusinessNumber ?? null,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create customer.' }, { status: 400 });
  }
}
