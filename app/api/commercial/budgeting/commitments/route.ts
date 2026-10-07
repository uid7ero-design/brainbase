import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseCommitmentReport } from '@/lib/commercial/purchasingCommitments';

export async function GET(req: NextRequest) {
  void req; // organisation scope is intentionally session-derived, never request-controlled.
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const report = await getPurchaseCommitmentReport(auth.session.organisationId);
  return NextResponse.json({ report });
}
