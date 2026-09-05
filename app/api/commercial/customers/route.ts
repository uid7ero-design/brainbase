import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listCustomers, createCustomer } from '@/lib/commercial/customers';

// Phase C3 — Customers/Products are gated on the 'quotes' capability
// (not a dedicated 'customers'/'products' key — none exists, and none
// is needed): in C3, Quotes is the only real Commercial transactional
// workflow, and Customers/Products exist only in service of it, matching
// the C3 brief's own "Customers / Products may be available to
// organisations with any active Commercial transactional module needed
// for Quotes" guidance. Revisit if a future phase (Invoicing,
// Purchasing, ...) also needs these two resources independently of
// Quotes.

export async function GET() {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const customers = await listCustomers(auth.session.organisationId);
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
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
