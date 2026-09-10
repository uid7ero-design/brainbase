import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getSupplier, updateSupplier, deactivateSupplier, reactivateSupplier } from '@/lib/commercial/suppliers';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const supplier = await getSupplier(auth.session.organisationId, id);
  if (!supplier) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ supplier });
}

// A single PATCH handles both an ordinary partial field update AND the
// active/inactive toggle — `{ active: boolean }` alone (with no other
// field) behaves exactly like customers' own dedicated PATCH-for-
// state-toggle convention (app/api/commercial/customers/[id]/route.ts),
// while any other field present is a partial update via updateSupplier()
// (which itself only overwrites fields actually supplied — see its own
// COALESCE-based implementation). This is the exact GET+PATCH-only route
// shape this gate specifies (no separate PUT), with `active` folded into
// the same partial-update semantics PATCH already implies.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const {
    active, name, legalName, contactName, email, phone, billingAddress, taxBusinessNumber,
    supplierReference, paymentTermsDays, crmCompanyId, crmContactId, notes,
  } = body;

  // active-only payload: route through the dedicated activate/reactivate
  // domain functions (which also emit their own distinct audit events),
  // exactly like customers' own PATCH does — never through updateSupplier(),
  // which has no `active` parameter at all.
  const fieldKeys = ['name', 'legalName', 'contactName', 'email', 'phone', 'billingAddress', 'taxBusinessNumber', 'supplierReference', 'paymentTermsDays', 'crmCompanyId', 'crmContactId', 'notes'];
  const hasOtherFields = fieldKeys.some(k => body[k] !== undefined);

  if (typeof active === 'boolean' && !hasOtherFields) {
    const ok = active
      ? await reactivateSupplier({ organisationId: auth.session.organisationId, userId: auth.session.userId, supplierId: id })
      : await deactivateSupplier({ organisationId: auth.session.organisationId, userId: auth.session.userId, supplierId: id });
    if (!ok) return NextResponse.json({ error: 'Not found or already in that state.' }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  try {
    const supplier = await updateSupplier({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      supplierId: id,
      name,
      legalName,
      contactName,
      email,
      phone,
      billingAddress,
      taxBusinessNumber,
      supplierReference,
      paymentTermsDays: paymentTermsDays === undefined ? undefined : (paymentTermsDays === null ? null : Number(paymentTermsDays)),
      crmCompanyId,
      crmContactId,
      notes,
    });
    if (!supplier) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ supplier });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update supplier.' }, { status: 400 });
  }
}
