import { NextResponse } from 'next/server';
import { authorizeDebtorsRequest } from '@/lib/debtors/authorize';
import { prisma } from '@/lib/prisma';
import { accountResolutionRate, avgDebtorPriority, highRiskDebtorCount } from '@/modules/debtors/calculations';

export async function GET(req: Request) {
  // Phase C1.1: previously getAuthSession() only — any authenticated
  // member of the organisation, no role floor, no capability check at all
  // ('debtors' was never a registered capability key). Now composes the
  // same requireSession() -> requireCapability('debtors') -> role-floor
  // gate every other capability-registered route family uses.
  const auth = await authorizeDebtorsRequest('viewer');
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const orgId = session.organisationId;
  const fy    = new URL(req.url).searchParams.get('fy') ?? '2025-26';
  const now   = new Date();

  const debtors = await prisma.debtorAccount.findMany({
    where: { organisation_id: orgId },
    orderBy: { created_at: 'desc' },
  });

  if (debtors.length === 0) {
    return NextResponse.json({
      data: { totalOutstanding: 0, count: 0, avgDaysOverdue: 0, avgPriority: 0, recoveryRate: 0, highRiskCount: 0, topDebtors: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  // Phase C1.1: relocated to modules/debtors/calculations.ts — same
  // formulas, same rounding, same output — see that file's own comment
  // for why these are centralised without being merged into
  // computeDebtorKpi()'s similarly-named but conceptually different
  // recovery_rate.
  const totalOutstanding = debtors.reduce((s, d) => s + d.outstanding_amount, 0);
  const avgDaysOverdue   = debtors.reduce((s, d) => s + d.days_overdue, 0) / debtors.length;
  const avgPriority      = avgDebtorPriority(debtors);
  const recoveryRate     = accountResolutionRate(debtors);
  const highRiskCount    = highRiskDebtorCount(debtors);
  const topDebtors       = debtors.slice(0, 10).map(d => ({
    id:          d.id,
    account:     d.account_name,
    amount:      d.outstanding_amount,
    daysOverdue: d.days_overdue,
    status:      d.status,
  }));

  return NextResponse.json({
    data: {
      totalOutstanding:            Math.round(totalOutstanding * 100) / 100,
      count:                       debtors.length,
      avgDaysOverdue:              Math.round(avgDaysOverdue),
      avgPriority,
      recoveryRate,
      highRiskCount,
      topDebtors,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
