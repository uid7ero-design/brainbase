import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getCustomer, updateCustomer, deactivateCustomer, reactivateCustomer } from '@/lib/commercial/customers';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const customer = await getCustomer(auth.session.organisationId, id);
  if (!customer) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ customer });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json();
  const { name, crmCompanyId, crmContactId, billingEmail, billingPhone, billingAddress, taxBusinessNumber } = body;

  try {
    const customer = await updateCustomer({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      customerId: id,
      name,
      crmCompanyId,
      crmContactId,
      billingEmail,
      billingPhone,
      billingAddress,
      taxBusinessNumber,
    });
    if (!customer) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ customer });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update customer.' }, { status: 400 });
  }
}

// { active: boolean } toggles deactivate/reactivate — symmetric actions
// on the same resource, matching this codebase's PATCH-for-state-toggle
// convention rather than two bespoke DELETE/POST-restore endpoints.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const { active } = await req.json();
  if (typeof active !== 'boolean') return NextResponse.json({ error: '`active` (boolean) is required.' }, { status: 400 });

  const ok = active
    ? await reactivateCustomer({ organisationId: auth.session.organisationId, userId: auth.session.userId, customerId: id })
    : await deactivateCustomer({ organisationId: auth.session.organisationId, userId: auth.session.userId, customerId: id });

  if (!ok) return NextResponse.json({ error: 'Not found or already in that state.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
