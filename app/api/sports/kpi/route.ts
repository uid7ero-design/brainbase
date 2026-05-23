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

  const sports = await prisma.sportingActivity.findMany({
    where: { organisation_id: orgId },
    orderBy: { created_at: 'desc' },
  });

  if (sports.length === 0) {
    return NextResponse.json({
      data: { totalActivities: 0, totalParticipants: 0, totalSpectators: 0, totalVisitors: 0, byActivity: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  const totalParticipants = sports.reduce((s, a) => s + a.total_participants, 0);
  const totalSpectators   = sports.reduce((s, a) => s + a.spectators_per_week, 0);
  const totalVisitors     = sports.reduce((s, a) => s + a.total_visitors_per_week, 0);

  const byActivity = sports.map(a => ({
    name:         a.name,
    participants: a.total_participants,
    spectators:   a.spectators_per_week,
    visitors:     a.total_visitors_per_week,
    season:       a.season,
  }));

  return NextResponse.json({
    data: { totalActivities: sports.length, totalParticipants, totalSpectators, totalVisitors, byActivity },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
