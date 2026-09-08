import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { seedStandardAustralianTaxCodes } from '@/lib/commercial/taxCodeBootstrap';

// POST — Phase C3-POLISH-R §4. "Seed standard Australian tax codes"
// button on Commercial → Settings → Tax Codes. administer-gated, same
// floor as ordinary tax-code creation (POST /api/commercial/tax-codes) —
// this is not a more sensitive action than creating one tax code by
// hand, it just creates up to three. Idempotent: safe to click more than
// once (see lib/commercial/taxCodeBootstrap.ts's own ON CONFLICT DO
// NOTHING).
export async function POST() {
  const auth = await authorizeCommercialRequest(['quotes', 'invoicing'], COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const result = await seedStandardAustralianTaxCodes(auth.session.organisationId);
  return NextResponse.json(result);
}
