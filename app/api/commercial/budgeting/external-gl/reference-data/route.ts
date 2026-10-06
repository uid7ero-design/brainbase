import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listBudgetAccounts } from '@/lib/commercial/budgetAccounts';
import { listCostCentres } from '@/lib/commercial/costCentres';

export async function GET() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const [budgetAccounts, costCentres] = await Promise.all([
    listBudgetAccounts(auth.session.organisationId, { activeOnly: true }),
    listCostCentres(auth.session.organisationId, { activeOnly: true }),
  ]);

  return NextResponse.json(
    {
      budgetAccounts: budgetAccounts.map(account => ({
        id: account.id,
        code: account.code,
        name: account.name,
      })),
      costCentres: costCentres.map(costCentre => ({
        id: costCentre.id,
        code: costCentre.code,
        name: costCentre.name,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
