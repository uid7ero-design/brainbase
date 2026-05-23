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
    where: { organisation_id: orgId, module: Module.OPERATIONS },
    orderBy: { period_start: 'desc' },
  });

  if (metrics.length === 0) {
    return NextResponse.json({
      data: { totalBudget: 0, ytdSpend: 0, eofyForecast: 0, variance: 0, byCategory: [] },
      fetched_at: now.toISOString(), fy, org_id: orgId,
    });
  }

  const totalBudget   = metrics.filter(m => m.metric_key === 'BUDGET_TOTAL').reduce((s, m) => s + m.metric_value, 0);
  const ytdSpend      = metrics.filter(m => m.metric_key === 'SPEND_YTD').reduce((s, m) => s + m.metric_value, 0);
  const eofyForecast  = metrics.filter(m => m.metric_key === 'EOFY_FORECAST').reduce((s, m) => s + m.metric_value, 0);
  const variance      = totalBudget > 0 ? (ytdSpend / totalBudget) * 100 : 0;

  const catMap = new Map<string, number>();
  for (const m of metrics) {
    if (m.dimension === 'category') {
      const key = m.dimension_value ?? 'Other';
      catMap.set(key, (catMap.get(key) ?? 0) + m.metric_value);
    }
  }
  const byCategory = Array.from(catMap.entries())
    .map(([category, value]) => ({ category, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return NextResponse.json({
    data: {
      totalBudget:  Math.round(totalBudget * 100) / 100,
      ytdSpend:     Math.round(ytdSpend * 100) / 100,
      eofyForecast: Math.round(eofyForecast * 100) / 100,
      variance:     Math.round(variance),
      byCategory,
    },
    fetched_at: now.toISOString(), fy, org_id: orgId,
  });
}
