import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getBudgetCommitmentConsumption } from '@/lib/commercial/budgetCommitmentResolver';

export async function GET() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const report = await getBudgetCommitmentConsumption(auth.session.organisationId);
  return NextResponse.json({ report });
}
