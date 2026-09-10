import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listSuppliers, createSupplier } from '@/lib/commercial/suppliers';

// Phase C6.3 — mirrors app/api/commercial/customers/route.ts's shape,
// gated on 'purchasing' alone (not an OR-array like customers'
// ['quotes','invoicing']) — suppliers are used only by Purchasing, a
// single independently-entitlable capability key, so no shared-resource
// widening is needed here.
export async function GET() {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const suppliers = await listSuppliers(auth.session.organisationId);
  return NextResponse.json({ suppliers });
}

// Only the fields createSupplier() actually accepts are read from the
// body — organisationId/userId always come from the authenticated
// session, never the request.
export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const {
    name, legalName, contactName, email, phone, billingAddress, taxBusinessNumber,
    supplierReference, paymentTermsDays, crmCompanyId, crmContactId, notes,
  } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  try {
    const supplier = await createSupplier({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      name: name.trim(),
      legalName: legalName ?? null,
      contactName: contactName ?? null,
      email: email ?? null,
      phone: phone ?? null,
      billingAddress: billingAddress ?? null,
      taxBusinessNumber: taxBusinessNumber ?? null,
      supplierReference: supplierReference ?? null,
      paymentTermsDays: paymentTermsDays === undefined || paymentTermsDays === null ? null : Number(paymentTermsDays),
      crmCompanyId: crmCompanyId ?? null,
      crmContactId: crmContactId ?? null,
      notes: notes ?? null,
    });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create supplier.' }, { status: 400 });
  }
}
