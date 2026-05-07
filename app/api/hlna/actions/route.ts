import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const openai = new OpenAI();

type RankedAction = {
  rank: number;
  title: string;
  impact: 'high' | 'medium' | 'low';
  urgency: 'high' | 'medium' | 'low';
  effort: 'high' | 'medium' | 'low';
  detail: string;
};

// ─── Per-module data context ───────────────────────────────────────────────────

async function getModuleContext(moduleKey: string, oid: string): Promise<string> {
  try {
    if (moduleKey === 'waste_recycling') {
      const [contam, cost] = await Promise.all([
        sql`
          SELECT suburb, ROUND(AVG(contamination_rate)::numeric,1)::float AS rate
          FROM waste_records WHERE organisation_id = ${oid} AND contamination_rate IS NOT NULL
          GROUP BY suburb ORDER BY rate DESC LIMIT 5
        `,
        sql`
          SELECT service_type, ROUND(SUM(cost))::bigint AS cost
          FROM waste_records WHERE organisation_id = ${oid}
          GROUP BY service_type ORDER BY cost DESC
        `,
      ]);
      return `Waste: Highest contamination suburbs: ${(contam as {suburb:string;rate:number}[]).map(r => `${r.suburb} (${r.rate}%)`).join(', ')}. Cost by service: ${(cost as {service_type:string;cost:number}[]).map(r => `${r.service_type} $${Number(r.cost).toLocaleString()}`).join(', ')}.`;
    }
    if (moduleKey === 'fleet_management') {
      const vehicles = await sql`
        SELECT vehicle_id, SUM(defects)::int AS defects, ROUND(SUM(fuel+maintenance+repairs))::bigint AS cost
        FROM fleet_metrics WHERE organisation_id = ${oid}
        GROUP BY vehicle_id ORDER BY defects DESC, cost DESC LIMIT 5
      `;
      return `Fleet: Top concern vehicles: ${(vehicles as {vehicle_id:string;defects:number;cost:number}[]).map(v => `${v.vehicle_id} (${v.defects} defects, $${Number(v.cost).toLocaleString()})`).join(', ')}.`;
    }
    if (moduleKey === 'service_requests') {
      const [open, types] = await Promise.all([
        sql`
          SELECT suburb, COUNT(*)::int AS count FROM service_requests
          WHERE organisation_id = ${oid} AND status = 'Open'
          GROUP BY suburb ORDER BY count DESC LIMIT 4
        `,
        sql`
          SELECT service_type, COUNT(*)::int AS open FROM service_requests
          WHERE organisation_id = ${oid} AND status = 'Open'
          GROUP BY service_type ORDER BY open DESC LIMIT 4
        `,
      ]);
      return `Service Requests open: suburbs ${(open as {suburb:string;count:number}[]).map(r => `${r.suburb} (${r.count})`).join(', ')}. Types: ${(types as {service_type:string;open:number}[]).map(r => `${r.service_type} (${r.open})`).join(', ')}.`;
    }
  } catch { /* fallback */ }
  return '';
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let oid: string;
  try {
    const session = await getAuthSession();
    oid = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { moduleKey = 'waste_recycling', context = '' } = await req.json() as {
    moduleKey?: string;
    context?: string;
  };
  const moduleContext = await getModuleContext(moduleKey, oid);

  const moduleLabels: Record<string, string> = {
    waste_recycling:  'Waste & Recycling',
    fleet_management: 'Fleet Management',
    service_requests: 'Service Requests',
    logistics_freight:'Logistics & Freight',
  };
  const label = moduleLabels[moduleKey] ?? moduleKey;

  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are an operations advisor for a local government council. Based on the following ${label} data, identify the 3 most important actions the operations manager should take RIGHT NOW.

Data:
${moduleContext || 'No detailed data available. Use general best practices.'}
${context ? `\nAdditional context: ${context}` : ''}

Score each action on 3 dimensions:
- impact: business impact if action is taken (high = major cost/risk reduction, medium = moderate improvement, low = minor)
- urgency: how time-sensitive (high = act today, medium = this week, low = this month)
- effort: resource required (high = major intervention, medium = moderate work, low = quick fix)

Rank actions by: (impact × urgency) / effort — highest-priority quick wins first, then high-impact medium-effort, then strategic.

Return valid JSON only:
{
  "actions": [
    {"rank": 1, "title": "Short action title (max 10 words)", "impact": "high", "urgency": "high", "effort": "low", "detail": "One sentence: what specifically to do, naming locations/assets where relevant, and why."},
    {"rank": 2, "title": "...", "impact": "high", "urgency": "medium", "effort": "medium", "detail": "..."},
    {"rank": 3, "title": "...", "impact": "medium", "urgency": "low", "effort": "low", "detail": "..."}
  ]
}

Rules: Be specific. Use real suburb/vehicle/asset names from the data where available. Plain language. No jargon.`,
      }],
    });

    const text = resp.choices[0].message.content ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const { actions } = JSON.parse(match[0]) as { actions: RankedAction[] };

    return NextResponse.json({ actions, moduleKey, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[hlna/actions]', err);
    return NextResponse.json({ error: 'Actions failed' }, { status: 500 });
  }
}
