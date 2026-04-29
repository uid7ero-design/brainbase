import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const anthropic = new Anthropic();

// ─── Per-module period comparison ─────────────────────────────────────────────

async function wasteChanged(oid: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT month,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric,1)::float AS avg_contamination,
        ROUND(SUM(tonnes)::numeric,0)::bigint AS total_tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `;
    if (rows.length < 2) return null;
    const [curr, prev] = rows as { month: string; cost: number; avg_contamination: number; total_tonnes: number }[];
    const costDelta = prev.cost > 0 ? (((curr.cost - prev.cost) / prev.cost) * 100).toFixed(1) : null;
    const contamDelta = prev.avg_contamination > 0 ? (curr.avg_contamination - prev.avg_contamination).toFixed(1) : null;
    return `Waste (${curr.month} vs ${prev.month}): Cost ${costDelta ? `${Number(costDelta) > 0 ? '+' : ''}${costDelta}%` : 'no change'} ($${Number(curr.cost).toLocaleString()} vs $${Number(prev.cost).toLocaleString()}). Contamination ${contamDelta ? `${Number(contamDelta) > 0 ? '+' : ''}${contamDelta}pp` : 'stable'} (${curr.avg_contamination}% vs ${prev.avg_contamination}%). Tonnes: ${Number(curr.total_tonnes).toLocaleString()} vs ${Number(prev.total_tonnes).toLocaleString()}.`;
  } catch { return null; }
}

async function fleetChanged(oid: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT month,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        SUM(defects)::int AS defects
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `;
    if (rows.length < 2) return null;
    const [curr, prev] = rows as { month: string; cost: number; defects: number }[];
    const costDelta = prev.cost > 0 ? (((curr.cost - prev.cost) / prev.cost) * 100).toFixed(1) : null;
    const defectDelta = curr.defects - prev.defects;
    return `Fleet (${curr.month} vs ${prev.month}): Cost ${costDelta ? `${Number(costDelta) > 0 ? '+' : ''}${costDelta}%` : 'no change'} ($${Number(curr.cost).toLocaleString()} vs $${Number(prev.cost).toLocaleString()}). Defects ${defectDelta > 0 ? `+${defectDelta}` : defectDelta} (${curr.defects} vs ${prev.defects}).`;
  } catch { return null; }
}

async function srChanged(oid: string): Promise<string | null> {
  try {
    const [curr, prev] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total,
          COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open_count,
          ROUND(AVG(CASE WHEN status='Open' THEN days_open END)::numeric,1)::float AS avg_days_open
        FROM service_requests WHERE organisation_id = ${oid}
          AND created_at >= NOW() - INTERVAL '30 days'
      `,
      sql`
        SELECT COUNT(*)::int AS total,
          COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open_count,
          ROUND(AVG(CASE WHEN status='Open' THEN days_open END)::numeric,1)::float AS avg_days_open
        FROM service_requests WHERE organisation_id = ${oid}
          AND created_at >= NOW() - INTERVAL '60 days'
          AND created_at < NOW() - INTERVAL '30 days'
      `,
    ]);
    const c = curr[0]; const p = prev[0];
    if (!Number(c?.total) && !Number(p?.total)) return null;
    const openDelta = (c?.open_count ?? 0) - (p?.open_count ?? 0);
    return `Service Requests (last 30 days vs prior 30 days): Open ${openDelta > 0 ? `+${openDelta}` : openDelta} (${c?.open_count ?? 0} vs ${p?.open_count ?? 0}). Avg days open: ${c?.avg_days_open ?? '?'} vs ${p?.avg_days_open ?? '?'} days. Total created: ${c?.total ?? 0} vs ${p?.total ?? 0}.`;
  } catch { return null; }
}

const MODULE_CHANGERS: Record<string, (oid: string) => Promise<string | null>> = {
  waste_recycling:  wasteChanged,
  fleet_management: fleetChanged,
  service_requests: srChanged,
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

  const deltaResults = await Promise.all(
    moduleKeys
      .filter(k => MODULE_CHANGERS[k])
      .map(k => MODULE_CHANGERS[k](oid))
  );
  const deltas = deltaResults.filter(Boolean) as string[];

  if (deltas.length === 0) {
    return NextResponse.json({ hasData: false, bullets: [], timestamp: new Date().toISOString() });
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are an operations analyst. Based on this period-over-period comparison data, produce a concise "What Changed?" briefing.

Data:
${deltas.join('\n')}

Return valid JSON only (no markdown):
{
  "bullets": [
    "One sentence per key change. Start with the direction: 'UP', 'DOWN', or 'STABLE'. Be specific with numbers. Max 18 words each."
  ],
  "summary": "One sentence: the single most significant change across all modules."
}

Generate 3-5 bullets covering the most meaningful movements. Ignore trivial changes (<2%). Flag anything that exceeds a known threshold.`,
      }],
    });

    const text = resp.content.find(b => b.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match[0]) as { bullets: string[]; summary: string };

    return NextResponse.json({
      bullets:   parsed.bullets ?? [],
      summary:   parsed.summary ?? '',
      hasData:   true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[hlna/whatchanged]', err);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
