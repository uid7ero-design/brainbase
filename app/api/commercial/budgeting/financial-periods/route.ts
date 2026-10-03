import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  listFinancialPeriods,
  listFinancialYears,
} from '@/lib/commercial/financialPeriods';
import { listFinancialPeriodCloses } from '@/lib/commercial/financeClose';

export async function GET() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const years = await listFinancialYears(auth.session.organisationId);
  const yearRows = await Promise.all(years.map(async year => {
    const periods = await listFinancialPeriods(auth.session.organisationId, year.id);
    const periodRows = await Promise.all(periods.map(async period => ({
      ...period,
      closes: await listFinancialPeriodCloses(auth.session.organisationId, period.id),
    })));
    return { ...year, periods: periodRows };
  }));

  return NextResponse.json(
    { years: yearRows },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
