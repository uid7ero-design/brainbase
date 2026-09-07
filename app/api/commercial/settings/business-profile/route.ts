import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getBusinessProfile, setBusinessProfile } from '@/lib/commercial/businessProfile';

// Phase C3-POLISH-R §1/§2 — the tenant's own trading identity used on
// the Quote PDF/email "FROM" (supplier) section. GET is view-role — any
// Commercial user building/downloading a quote PDF needs to read this,
// the same way they can already read tax codes; only PUT (actually
// changing the organisation's settings) requires administer, matching
// tax-code creation's own floor.
export async function GET() {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const result = await getBusinessProfile(auth.session.organisationId);
  if (!result) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const auth = await authorizeCommercialRequest('quotes', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  await setBusinessProfile(auth.session.organisationId, {
    tradingName: str(body.tradingName),
    address: str(body.address),
    email: str(body.email),
    phone: str(body.phone),
    abn: str(body.abn),
  });

  const result = await getBusinessProfile(auth.session.organisationId);
  return NextResponse.json(result);
}
