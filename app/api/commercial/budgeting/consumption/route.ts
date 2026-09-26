import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getBudgetActualCommittedReport } from '@/lib/commercial/budgetActualCommitted';

export async function GET() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const report = await getBudgetActualCommittedReport(auth.session.organisationId);
  return NextResponse.json({ report });
}
