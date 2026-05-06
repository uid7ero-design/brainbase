import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const anthropic = new Anthropic();

// ─── Data summaries per dashboard type ───────────────────────────────────────

async function wasteSnapshot(oid: string) {
  const [totals, monthly, contam] = await Promise.all([
    sql`
      SELECT
        ROUND(SUM(cost))::bigint           AS total_cost,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contamination,
        ROUND(MAX(contamination_rate)::numeric, 1)::float AS max_contamination,
        ROUND(SUM(tonnes)::numeric, 0)::bigint            AS total_tonnes,
        COALESCE(SUM(collections), 0)::bigint             AS total_collections,
        COUNT(DISTINCT suburb)::int                       AS suburb_count
      FROM waste_records WHERE organisation_id = ${oid}
    `,
    sql`
      SELECT month, ROUND(SUM(cost))::bigint AS cost, ROUND(AVG(contamination_rate)::numeric,1)::float AS avg_contamination
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 3
    `,
    sql`
      SELECT suburb, ROUND(AVG(contamination_rate)::numeric,1)::float AS rate
      FROM waste_records WHERE organisation_id = ${oid} AND contamination_rate IS NOT NULL
      GROUP BY suburb ORDER BY rate DESC LIMIT 3
    `,
  ]);

  const t = totals[0] ?? {};
  const [latest, prev] = monthly;
  const trendPct = latest && prev && Number(prev.cost) > 0
    ? ((Number(latest.cost) - Number(prev.cost)) / Number(prev.cost) * 100).toFixed(1)
    : null;

  const contamHot = (contam as {suburb:string; rate:number}[]).filter(r => r.rate > 8);

  return `WASTE MANAGEMENT DATA SNAPSHOT:
Total cost YTD: $${Number(t.total_cost || 0).toLocaleString()}
Total tonnes: ${Number(t.total_tonnes || 0).toLocaleString()}
Total collections: ${Number(t.total_collections || 0).toLocaleString()}
Suburbs covered: ${t.suburb_count ?? 0}
Avg contamination rate: ${t.avg_contamination ?? 'N/A'}% (target: ≤8%)
Max contamination in any suburb: ${t.max_contamination ?? 'N/A'}%
Suburbs exceeding 8% contamination threshold: ${contamHot.map(r => `${r.suburb} (${r.rate}%)`).join(', ') || 'None'}
${trendPct ? `Month-over-month cost trend: ${latest.month} vs ${prev.month}: ${Number(trendPct) > 0 ? '+' : ''}${trendPct}% ($${Number(latest.cost).toLocaleString()} vs $${Number(prev.cost).toLocaleString()})` : ''}
${monthly.length > 0 ? `Recent months: ${(monthly as {month:string;cost:number}[]).map(m => `${m.month} $${Number(m.cost).toLocaleString()}`).join(', ')}` : ''}`;
}

async function fleetSnapshot(oid: string) {
  const [totals, vehicles, monthly] = await Promise.all([
    sql`
      SELECT
        ROUND(SUM(fuel + maintenance + wages + repairs + rego + insurance))::bigint AS total_cost,
        SUM(defects)::bigint  AS total_defects,
        SUM(km)::bigint       AS total_km,
        COUNT(DISTINCT vehicle_id)::int AS vehicle_count
      FROM fleet_metrics WHERE organisation_id = ${oid}
    `,
    sql`
      SELECT vehicle_id,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        SUM(defects)::int AS defects
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY vehicle_id ORDER BY cost DESC LIMIT 5
    `,
    sql`
      SELECT month, ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `,
  ]);

  const t = totals[0] ?? {};
  const [latest, prev] = monthly as {month:string; cost:number}[];
  const trendPct = latest && prev && Number(prev.cost) > 0
    ? ((Number(latest.cost) - Number(prev.cost)) / Number(prev.cost) * 100).toFixed(1)
    : null;
  const defectAssets = (vehicles as {vehicle_id:string; cost:number; defects:number}[]).filter(v => v.defects > 0);

  return `FLEET MANAGEMENT DATA SNAPSHOT:
Total fleet cost: $${Number(t.total_cost || 0).toLocaleString()}
Total km driven: ${Number(t.total_km || 0).toLocaleString()}
Active vehicles: ${t.vehicle_count ?? 0}
Total defects recorded: ${t.total_defects ?? 0}
Top cost vehicles: ${(vehicles as {vehicle_id:string; cost:number}[]).slice(0, 3).map(v => `${v.vehicle_id} $${Number(v.cost).toLocaleString()}`).join(', ')}
Vehicles with defects: ${defectAssets.map(v => `${v.vehicle_id} (${v.defects} defects)`).join(', ') || 'None'}
${trendPct ? `Month-over-month cost trend: ${latest.month} vs ${prev.month}: ${Number(trendPct) > 0 ? '+' : ''}${trendPct}%` : ''}`;
}

async function srSnapshot(oid: string) {
  const [totals, byType] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int                                                             AS total,
        COUNT(CASE WHEN status = 'Open'    THEN 1 END)::int                      AS open_count,
        COUNT(CASE WHEN status = 'Closed'  THEN 1 END)::int                      AS closed_count,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END)::int                      AS pending_count,
        COUNT(CASE WHEN priority = 'High' AND status = 'Open' THEN 1 END)::int  AS high_open,
        ROUND(AVG(CASE WHEN status = 'Open' THEN days_open END)::numeric, 1)::float AS avg_days_open,
        ROUND(AVG(cost)::numeric, 0)::int                                        AS avg_cost
      FROM service_requests WHERE organisation_id = ${oid}
    `,
    sql`
      SELECT service_type, COUNT(*)::int AS count, COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open
      FROM service_requests WHERE organisation_id = ${oid}
      GROUP BY service_type ORDER BY count DESC LIMIT 5
    `,
  ]);

  const t = totals[0] ?? {};
  const total = Number(t.total || 0);
  const closed = Number(t.closed_count || 0);
  const resolutionRate = total > 0 ? ((closed / total) * 100).toFixed(1) : '0';

  return `SERVICE REQUESTS DATA SNAPSHOT:
Total requests: ${total}
Open: ${t.open_count ?? 0}, Closed: ${t.closed_count ?? 0}, Pending: ${t.pending_count ?? 0}
High-priority open requests: ${t.high_open ?? 0}
Resolution rate: ${resolutionRate}% (target: ≥75%)
Avg days open (open requests): ${t.avg_days_open ?? 'N/A'} days (target: ≤7 days)
Top request types: ${(byType as {service_type:string; count:number; open:number}[]).map(r => `${r.service_type} (${r.count} total, ${r.open} open)`).join(', ')}`;
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

async function generateInsight(snapshot: string, dashboardType: string): Promise<{
  headline: string;
  trend: string | null;
  trendDir: 'up' | 'down' | 'flat';
  trendPositive: boolean;
  anomaly: string | null;
  recommendation: string;
  confidence: 'High' | 'Medium' | 'Low';
  rowsAnalysed: number;
}> {
  const contextLabels: Record<string, string> = {
    waste:            'waste management operations',
    fleet:            'fleet operations',
    service_requests: 'service request management',
  };

  const trendGoodDir: Record<string, string> = {
    waste:            'down (lower cost and contamination is better)',
    fleet:            'down (lower cost and fewer defects is better)',
    service_requests: 'down (fewer open SRs and faster resolution is better)',
  };

  const resp = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `You are an executive analyst for a local government council. Analyse this ${contextLabels[dashboardType] ?? dashboardType} data and return a JSON object ONLY (no markdown, no explanation).

Data:
${snapshot}

Return exactly this JSON structure:
{
  "headline": "1-2 sentence executive summary of the most important finding. Be specific with numbers.",
  "trend": "e.g. '+12% cost vs last month' or null if no trend data",
  "trendDir": "up" | "down" | "flat",
  "trendPositive": boolean (true if the trend direction is positive/good, considering ${trendGoodDir[dashboardType] ?? 'lower is better'}),
  "anomaly": "Single sentence describing the most significant outlier or risk, or null if none",
  "recommendation": "One actionable recommendation for the council executive",
  "confidence": "High" | "Medium" | "Low" (based on data completeness),
  "rowsAnalysed": number (estimate of the number of data records this insight is based on — extract from the snapshot numbers if available, otherwise 0)
}`,
    }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let oid: string;
  try {
    const session = await getAuthSession();
    oid = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { dashboardType } = await req.json() as { dashboardType: string };

  try {
    let snapshot = '';
    if (dashboardType === 'waste')            snapshot = await wasteSnapshot(oid);
    else if (dashboardType === 'fleet')       snapshot = await fleetSnapshot(oid);
    else if (dashboardType === 'service_requests') snapshot = await srSnapshot(oid);
    else return NextResponse.json({ error: 'Unknown dashboard type' }, { status: 400 });

    // No data in DB yet
    if (!snapshot.trim()) {
      return NextResponse.json({ hasData: false, timestamp: new Date().toISOString() });
    }

    const insight = await generateInsight(snapshot, dashboardType);
    return NextResponse.json({ ...insight, hasData: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[hlna/insight]', err);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
