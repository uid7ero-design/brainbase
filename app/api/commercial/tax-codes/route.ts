import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listTaxCodes, createTaxCode } from '@/lib/commercial/taxCodes';

// GET is read-only, view-role — used by the Products and Quote-line
// forms to populate a tax-code dropdown from whatever an organisation
// has already configured.
export async function GET() {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const taxCodes = await listTaxCodes(auth.session.organisationId, { activeOnly: true });
  return NextResponse.json({ taxCodes });
}

// POST — Phase C3-POLISH-R §4. Tax-code configuration is org-level
// administration (creating/editing prefixes/cost-centres/tax codes),
// matching COMMERCIAL_MIN_ROLE.administer's own documented definition
// in lib/commercial/authorize.ts — the same floor
// commercial_document_sequences' configureDocumentSequence() uses, not
// the lower 'createEdit' floor used by ordinary document mutations like
// creating a quote.
export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { code, name, rate, isDefault } = body;
  if (typeof code !== 'string' || !code.trim() || typeof name !== 'string' || !name.trim() || typeof rate !== 'number') {
    return NextResponse.json({ error: 'code, name, and rate are required.' }, { status: 400 });
  }

  try {
    const taxCode = await createTaxCode({ organisationId: auth.session.organisationId, code: code.trim(), name: name.trim(), rate, isDefault: Boolean(isDefault) });
    return NextResponse.json({ taxCode }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create tax code.' }, { status: 400 });
  }
}
