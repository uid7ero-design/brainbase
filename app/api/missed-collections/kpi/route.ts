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

  const collections = await prisma.missedCollection.findMany({
    where: { organisation_id: orgId },
    orderBy: { scheduled_date: 'desc' },
  });

  if (collections.length === 0) {
    return NextResponse.json({
      data: { totalScheduled: 0, missedCount: 0, completionRate: 0, slaCompliance: 0, topRoutes: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  const missedCount     = collections.filter(c => c.status === 'OPEN').length;
  const completionRate  = collections.filter(c => c.status === 'COMPLETED').length / collections.length * 100;
  const slaCompliance   = collections.filter(c => c.completed_date !== null && c.rescheduled_date === null).length / collections.length * 100;

  const routeMap = new Map<string, number>();
  for (const c of collections) {
    if (c.route) routeMap.set(c.route, (routeMap.get(c.route) ?? 0) + 1);
  }
  const topRoutes = Array.from(routeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([route, count]) => ({ route, count }));

  return NextResponse.json({
    data: {
      totalScheduled: collections.length,
      missedCount,
      completionRate: Math.round(completionRate),
      slaCompliance:  Math.round(slaCompliance),
      topRoutes,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
