import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';
import { computeBinMaintenanceKpi } from '@/modules/bin-maintenance/calculations';

export async function GET(req: Request) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');

  const jobs = await prisma.binMaintenanceJob.findMany({
    where: {
      organisation_id: session.organisationId,
      ...(since ? { created_at: { gte: new Date(since) } } : {}),
    },
    select: {
      id:             true,
      suburb:         true,
      address:        true,
      issue_type:     true,
      bin_type:       true,
      status:         true,
      severity:       true,
      scheduled_date: true,
      created_at:     true,
      assigned_to:    true,
    },
  });

  if (jobs.length === 0) {
    return NextResponse.json({ hasData: false });
  }

  return NextResponse.json({ hasData: true, ...computeBinMaintenanceKpi(jobs) });
}
