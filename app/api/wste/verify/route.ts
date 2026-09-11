import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { verifyService } from '@/lib/wste/verifyService';
import { getDemoScenario } from '@/lib/wste/demoScenarios';
import type { VerifyServiceInput } from '@/lib/wste/types';

export async function POST(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer run this verification under their old org. The
  // existing organisationId override below (already always applied, even
  // pre-fix, so a caller-supplied value in the body can never be used)
  // is unchanged.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }

  let body: Partial<VerifyServiceInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { propertyId, gpsPoints } = body;

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
  }

  // Fall back to demo scenario when no live GPS is provided
  const hasLiveGps = Array.isArray(gpsPoints) && gpsPoints.length > 0;
  let input: VerifyServiceInput | null = hasLiveGps
    ? (body as VerifyServiceInput)
    : getDemoScenario(propertyId);

  if (!input) {
    return NextResponse.json({ error: 'No GPS data and no demo scenario found for this property' }, { status: 422 });
  }

  // Enforce org scoping
  input = { ...input, organisationId: session.organisationId };

  const result = verifyService(input);
  return NextResponse.json({ result, demo: !hasLiveGps });
}
