import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';
import { Module, Prisma } from '@prisma/client';

interface LineItem {
  gl: string;
  description: string;
  category: 'EXPENSE' | 'RECOVERY' | 'REVENUE';
  budget_fy: number;
  ytd_actual: number;
  commitments: number;
}

interface ForecastParams {
  multiplier: number;
  as_at_date: string;
}

function computeLine(item: LineItem, multiplier: number, overrides: Record<string, number>) {
  const eofy = overrides[item.gl] !== undefined
    ? overrides[item.gl]
    : (item.ytd_actual + item.commitments) * multiplier;
  const variance = item.budget_fy - eofy;
  return {
    ...item,
    eofy_forecast:   Math.round(eofy * 100) / 100,
    variance:        Math.round(variance * 100) / 100,
    variance_pct:    item.budget_fy > 0 ? Math.round((variance / item.budget_fy) * 1000) / 10 : 0,
    has_override:    item.gl in overrides,
  };
}

function sumItems(items: ReturnType<typeof computeLine>[]) {
  return {
    budget_fy:     Math.round(items.reduce((s, i) => s + i.budget_fy, 0) * 100) / 100,
    ytd_actual:    Math.round(items.reduce((s, i) => s + i.ytd_actual, 0) * 100) / 100,
    commitments:   Math.round(items.reduce((s, i) => s + i.commitments, 0) * 100) / 100,
    eofy_forecast: Math.round(items.reduce((s, i) => s + i.eofy_forecast, 0) * 100) / 100,
    variance:      Math.round(items.reduce((s, i) => s + i.variance, 0) * 100) / 100,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ fy: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fy } = await params;
  const orgId = session.organisationId;

  let model = await prisma.financialModel.findUnique({
    where: { organisation_id_financial_year: { organisation_id: orgId, financial_year: fy } },
  });

  if (!model) {
    // Seed from metrics table where available
    const metrics = await prisma.metric.findMany({
      where: { organisation_id: orgId, module: Module.OPERATIONS },
    });

    const catMap = new Map<string, { budget_fy: number; ytd_actual: number }>();
    for (const m of metrics) {
      if (m.dimension === 'category' && m.dimension_value) {
        const key = m.dimension_value;
        if (!catMap.has(key)) catMap.set(key, { budget_fy: 0, ytd_actual: 0 });
        const entry = catMap.get(key)!;
        if (m.metric_key === 'BUDGET_LINE') entry.budget_fy  += m.metric_value;
        if (m.metric_key === 'SPEND_YTD')   entry.ytd_actual += m.metric_value;
      }
    }

    const line_items: LineItem[] = Array.from(catMap.entries()).map(([desc, v], i) => ({
      gl:          `EXP-${String(i + 1).padStart(4, '0')}`,
      description: desc,
      category:    'EXPENSE',
      budget_fy:   Math.round(v.budget_fy * 100) / 100,
      ytd_actual:  Math.round(v.ytd_actual * 100) / 100,
      commitments: 0,
    }));

    model = await prisma.financialModel.create({
      data: {
        organisation_id:    orgId,
        financial_year:     fy,
        forecast_params:    { multiplier: 1.0, as_at_date: new Date().toISOString().slice(0, 10) },
        line_items:         line_items as unknown as Prisma.InputJsonValue,
        rise_and_fall:      [] as unknown as Prisma.InputJsonValue,
        forecast_overrides: {},
      },
    });
  }

  const fp        = model.forecast_params as unknown as ForecastParams;
  const multiplier = fp.multiplier ?? 1.0;
  const overrides  = model.forecast_overrides as unknown as Record<string, number>;
  const items      = (model.line_items as unknown as LineItem[]).map(i => computeLine(i, multiplier, overrides));

  const expenses   = items.filter(i => i.category === 'EXPENSE');
  const recoveries = items.filter(i => i.category === 'RECOVERY');
  const revenue    = items.filter(i => i.category === 'REVENUE');
  const expTotals  = sumItems(expenses);
  const recTotals  = sumItems(recoveries);
  const revTotals  = sumItems(revenue);

  return NextResponse.json({
    data: {
      financial_year:    fy,
      forecast_params:   fp,
      line_items:        items,
      rise_and_fall:     model.rise_and_fall,
      summary: {
        expenses:   expTotals,
        recoveries: recTotals,
        revenue:    revTotals,
        net: {
          budget_fy:     expTotals.budget_fy - recTotals.budget_fy - revTotals.budget_fy,
          eofy_forecast: expTotals.eofy_forecast - recTotals.eofy_forecast - revTotals.eofy_forecast,
        },
      },
    },
    fetched_at: new Date().toISOString(),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ fy: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fy } = await params;
  const orgId = session.organisationId;
  const body  = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const model = await prisma.financialModel.findUnique({
    where: { organisation_id_financial_year: { organisation_id: orgId, financial_year: fy } },
  });
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const current = model.forecast_params as unknown as ForecastParams;
  await prisma.financialModel.update({
    where:  { id: model.id },
    data:   { forecast_params: { ...current, ...body } as unknown as Prisma.InputJsonValue, last_edited_by: session.userId },
  });

  return NextResponse.json({ success: true });
}
