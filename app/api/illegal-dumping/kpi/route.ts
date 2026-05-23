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

  const incidents = await prisma.illegalDumping.findMany({
    where: { organisation_id: orgId },
    orderBy: { report_date: 'desc' },
  });

  if (incidents.length === 0) {
    return NextResponse.json({
      data: {
        totalIncidents: 0, recoveryRate: 0, topSuburbs: [],
        severityBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  const resolved     = incidents.filter(i => i.status === 'CLOSED' || i.resolution_date !== null).length;
  const recoveryRate = resolved / incidents.length * 100;

  const subMap = new Map<string, number>();
  for (const i of incidents) {
    if (i.suburb) subMap.set(i.suburb, (subMap.get(i.suburb) ?? 0) + 1);
  }
  const topSuburbs = Array.from(subMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([suburb, count]) => ({ suburb, count }));

  return NextResponse.json({
    data: {
      totalIncidents: incidents.length,
      recoveryRate:   Math.round(recoveryRate),
      topSuburbs,
      severityBreakdown: {
        CRITICAL: incidents.filter(i => i.severity === 'CRITICAL').length,
        HIGH:     incidents.filter(i => i.severity === 'HIGH').length,
        MEDIUM:   incidents.filter(i => i.severity === 'MEDIUM').length,
        LOW:      incidents.filter(i => i.severity === 'LOW').length,
      },
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
