import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  const totalOutstanding = debtors.reduce((s, d) => s + d.outstanding_amount, 0);
  const avgDaysOverdue   = debtors.reduce((s, d) => s + d.days_overdue, 0) / debtors.length;
  const avgPriority      = debtors.reduce((s, d) => s + (d.outstanding_amount * 10) + (d.days_overdue * 5), 0) / debtors.length;
  const recoveryRate     = debtors.filter(d => d.status !== 'OPEN').length / debtors.length * 100;
  const highRiskCount    = debtors.filter(d => (d.outstanding_amount * 10) + (d.days_overdue * 5) > 8000).length;
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
      avgPriority:                 Math.round(avgPriority),
      recoveryRate:                Math.round(recoveryRate),
      highRiskCount,
      topDebtors,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
