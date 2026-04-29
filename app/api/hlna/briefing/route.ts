import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const anthropic = new Anthropic();

// ─── Module data snapshots ─────────────────────────────────────────────────────

async function wasteSnapshot(oid: string): Promise<string | null> {
  try {
    const [t, contam] = await Promise.all([
      sql`
        SELECT
          ROUND(SUM(cost))::bigint AS total_cost,
          ROUND(AVG(contamination_rate)::numeric,1)::float AS avg_contamination,
          ROUND(SUM(tonnes)::numeric,0)::bigint AS total_tonnes,
          COUNT(CASE WHEN contamination_rate > 8 THEN 1 END)::int AS suburbs_over_threshold
        FROM waste_records WHERE organisation_id = ${oid}
      `,
      sql`
        SELECT month, ROUND(SUM(cost))::bigint AS cost
        FROM waste_records WHERE organisation_id = ${oid}
        GROUP BY month
        ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
        LIMIT 2
      `,
    ]);
    const totals = t[0] ?? {};
    if (!Number(totals.total_cost)) return null;
    const [latest, prev] = contam as {month:string; cost:number}[];
    const trend = latest && prev && Number(prev.cost) > 0
      ? `${Number(latest.cost) > Number(prev.cost) ? '+' : ''}${(((Number(latest.cost) - Number(prev.cost)) / Number(prev.cost)) * 100).toFixed(1)}% cost vs prev month`
      : null;
    return `Waste & Recycling: $${Number(totals.total_cost).toLocaleString()} total cost, ${totals.total_tonnes?.toLocaleString()} tonnes, avg contamination ${totals.avg_contamination ?? '?'}% (target ≤8%), ${totals.suburbs_over_threshold ?? 0} suburbs over threshold.${trend ? ` Trend: ${trend}.` : ''}`;
  } catch { return null; }
}

async function fleetSnapshot(oid: string): Promise<string | null> {
  try {
    const [t] = await sql`
      SELECT
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS total_cost,
        SUM(defects)::int AS total_defects,
        COUNT(DISTINCT vehicle_id)::int AS vehicle_count,
        COUNT(CASE WHEN defects > 0 THEN 1 END)::int AS vehicles_with_defects
      FROM fleet_metrics WHERE organisation_id = ${oid}
    `;
    if (!Number(t?.total_cost)) return null;
    return `Fleet Management: $${Number(t.total_cost).toLocaleString()} total cost, ${t.vehicle_count} vehicles, ${t.total_defects} defects recorded, ${t.vehicles_with_defects} vehicles with active defects.`;
  } catch { return null; }
}

async function srSnapshot(oid: string): Promise<string | null> {
  try {
    const [t] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open_count,
        COUNT(CASE WHEN priority='High' AND status='Open' THEN 1 END)::int AS high_open,
        ROUND(AVG(CASE WHEN status='Open' THEN days_open END)::numeric,1)::float AS avg_days_open
      FROM service_requests WHERE organisation_id = ${oid}
    `;
    if (!Number(t?.total)) return null;
    return `Service Requests: ${t.open_count} open (${t.high_open} high priority), avg ${t.avg_days_open ?? '?'} days open (target ≤7 days), ${t.total} total.`;
  } catch { return null; }
}

const MODULE_SNAPSHOTS: Record<string, (oid: string) => Promise<string | null>> = {
  waste_recycling:  wasteSnapshot,
  fleet_management: fleetSnapshot,
  service_requests: srSnapshot,
};

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oid = session.organisationId;

  // Discover enabled modules
  let moduleKeys: string[] = [];
  try {
    const rows = await sql`
      SELECT m.key FROM organisation_modules om
      JOIN modules m ON m.id = om.module_id
      WHERE om.organisation_id = ${oid} AND om.enabled = true
    `;
    moduleKeys = rows.map(r => r.key as string);
  } catch {
    moduleKeys = ['waste_recycling', 'fleet_management', 'service_requests'];
  }

  // Gather all available snapshots in parallel
  const snapResults = await Promise.all(
    moduleKeys
      .filter(k => MODULE_SNAPSHOTS[k])
      .map(k => MODULE_SNAPSHOTS[k](oid))
  );
  const snapshots = snapResults.filter(Boolean) as string[];

  if (snapshots.length === 0) {
    return NextResponse.json({ hasData: false, timestamp: new Date().toISOString() });
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `You are an executive briefing system for a local government council operations platform.

Data snapshot:
${snapshots.join('\n')}

Generate a concise executive briefing. Return valid JSON only (no markdown):
{
  "lines": ["3-4 plain-English insight lines. Each under 15 words. Be specific with numbers. Focus on what changed or what needs attention."],
  "urgentCount": number (0-5, how many items need immediate attention based on thresholds breached or high-priority items),
  "summary": "one sentence executive summary"
}

Rules: plain business language. No jargon. Lead with the most important finding. If a metric exceeds its target threshold, flag it.`,
      }],
    });

    const text = resp.content.find(b => b.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]) as { lines: string[]; urgentCount: number; summary: string };

    return NextResponse.json({
      greeting,
      lines:       parsed.lines ?? [],
      urgentCount: parsed.urgentCount ?? 0,
      summary:     parsed.summary ?? '',
      modules:     moduleKeys.filter(k => MODULE_SNAPSHOTS[k]),
      hasData:     true,
      timestamp:   new Date().toISOString(),
    });
  } catch (err) {
    console.error('[hlna/briefing]', err);
    return NextResponse.json({ error: 'Briefing failed' }, { status: 500 });
  }
}
