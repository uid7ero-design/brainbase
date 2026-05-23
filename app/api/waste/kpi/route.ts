import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';
import { Module } from '@prisma/client';

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

  const metrics = await prisma.metric.findMany({
    where: { organisation_id: orgId, module: Module.WASTE },
    orderBy: { period_start: 'desc' },
  });

  if (metrics.length === 0) {
    return NextResponse.json({
      data: { totalWaste: 0, totalRecycling: 0, totalOrganics: 0, diversionRate: 0, streamsByMonth: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  const totalWaste     = metrics.filter(m => m.metric_key === 'WASTE_TONNES').reduce((s, m) => s + m.metric_value, 0);
  const totalRecycling = metrics.filter(m => m.metric_key === 'RECYCLING_TONNES').reduce((s, m) => s + m.metric_value, 0);
  const totalOrganics  = metrics.filter(m => m.metric_key === 'ORGANICS_TONNES').reduce((s, m) => s + m.metric_value, 0);
  const total          = totalWaste + totalRecycling + totalOrganics;
  const diversionRate  = total > 0 ? (totalRecycling + totalOrganics) / total * 100 : 0;

  const byMonth = new Map<string, { waste: number; recycling: number; organics: number }>();
  for (const m of metrics) {
    const key = m.period_start.toISOString().slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { waste: 0, recycling: 0, organics: 0 });
    const d = byMonth.get(key)!;
    if (m.metric_key === 'WASTE_TONNES')     d.waste     += m.metric_value;
    if (m.metric_key === 'RECYCLING_TONNES') d.recycling += m.metric_value;
    if (m.metric_key === 'ORGANICS_TONNES')  d.organics  += m.metric_value;
  }

  const streamsByMonth = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, d]) => ({ month, ...d }));

  return NextResponse.json({
    data: {
      totalWaste:      Math.round(totalWaste * 100) / 100,
      totalRecycling:  Math.round(totalRecycling * 100) / 100,
      totalOrganics:   Math.round(totalOrganics * 100) / 100,
      diversionRate:   Math.round(diversionRate),
      streamsByMonth,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
