import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getBudgetActualCommittedReport } from '@/lib/commercial/budgetActualCommitted';

export async function GET(request?: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const sourceSystemId = request
    ? new URL(request.url).searchParams.get('sourceSystemId')?.trim() || null
    : null;
  const report = await getBudgetActualCommittedReport(
    auth.session.organisationId,
    sourceSystemId,
  );
  return NextResponse.json({ report });
}
