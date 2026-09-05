import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listTaxCodes } from '@/lib/commercial/taxCodes';

// Read-only. No tax-code management UI is built in C3 (out of scope —
// the C3 nav is Overview/Customers/Products & Services/Quotes only);
// this exists solely so the Products and Quote-line forms can populate a
// tax-code dropdown from whatever an organisation has already
// configured. An organisation with none configured simply sees an empty
// list — products/lines remain valid with no tax code selected.
export async function GET() {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const taxCodes = await listTaxCodes(auth.session.organisationId, { activeOnly: true });
  return NextResponse.json({ taxCodes });
}
