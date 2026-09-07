import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { deactivateTaxCode } from '@/lib/commercial/taxCodes';

type Ctx = { params: Promise<{ id: string }> };

// DELETE deactivates (never hard-deletes) — matching
// deactivateCustomer()/deactivateProduct()'s own established convention:
// a tax code may already be referenced by an issued quote line's
// tax_code_snapshot/tax_rate_snapshot (a plain TEXT/NUMERIC snapshot,
// not an FK — see scripts/create-commercial-quotes.sql), so removing
// the row itself would be both destructive and unnecessary.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deactivateTaxCode({ organisationId: auth.session.organisationId, taxCodeId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or already inactive.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
