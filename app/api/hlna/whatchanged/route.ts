import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const anthropic = new Anthropic();

// ─── Per-module period comparison ─────────────────────────────────────────────

async function wasteChanged(oid: string): Promise<string | null> {
  try {
    const monthRows = await sql`
      SELECT month,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric,1)::float AS avg_contamination,
        ROUND(SUM(tonnes)::numeric,0)::bigint AS total_tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `;
    if (monthRows.length < 2) return null;

    const [curr, prev] = monthRows as { month: string; cost: number; avg_contamination: number; total_tonnes: number }[];
    const costDelta   = prev.cost > 0 ? (((curr.cost - prev.cost) / prev.cost) * 100).toFixed(1) : null;
    const contamDelta = prev.avg_contamination > 0 ? (curr.avg_contamination - prev.avg_contamination).toFixed(1) : null;

    // Top 3 suburbs by cost increase between the two months
    const suburbRows = await sql`
      SELECT
        suburb,
        SUM(CASE WHEN month = ${curr.month} THEN cost ELSE 0 END)::float AS curr_cost,
        SUM(CASE WHEN month = ${prev.month} THEN cost ELSE 0 END)::float AS prev_cost,
        ROUND(AVG(CASE WHEN month = ${curr.month} THEN contamination_rate END)::numeric,1)::float AS curr_contam
      FROM waste_records
      WHERE organisation_id = ${oid} AND month IN (${curr.month}, ${prev.month})
      GROUP BY suburb
      HAVING SUM(CASE WHEN month = ${prev.month} THEN cost ELSE 0 END) > 0
      ORDER BY
        (SUM(CASE WHEN month = ${curr.month} THEN cost ELSE 0 END)
          - SUM(CASE WHEN month = ${prev.month} THEN cost ELSE 0 END))
        / NULLIF(SUM(CASE WHEN month = ${prev.month} THEN cost ELSE 0 END), 0) DESC
      LIMIT 3
    `;

    const suburbSummary = (suburbRows as { suburb: string; curr_cost: number; prev_cost: number; curr_contam: number }[])
      .map(r => {
        const pct = (((Number(r.curr_cost) - Number(r.prev_cost)) / Number(r.prev_cost)) * 100).toFixed(1);
        const contamNote = Number(r.curr_contam) > 8 ? `, contamination ${r.curr_contam}%` : '';
        return `${r.suburb} (cost ${Number(pct) >= 0 ? '+' : ''}${pct}%${contamNote})`;
      })
      .join(', ');

    return [
      `Waste (${curr.month} vs ${prev.month}): Cost ${costDelta ? `${Number(costDelta) > 0 ? '+' : ''}${costDelta}%` : 'no change'} ($${Number(curr.cost).toLocaleString()} vs $${Number(prev.cost).toLocaleString()}). Contamination ${contamDelta ? `${Number(contamDelta) > 0 ? '+' : ''}${contamDelta}pp` : 'stable'} (${curr.avg_contamination}% vs ${prev.avg_contamination}%). Tonnes: ${Number(curr.total_tonnes).toLocaleString()} vs ${Number(prev.total_tonnes).toLocaleString()}.`,
      suburbSummary ? `Top suburbs by cost movement: ${suburbSummary}.` : '',
    ].filter(Boolean).join(' ');
  } catch { return null; }
}

async function fleetChanged(oid: string): Promise<string | null> {
  try {
    const monthRows = await sql`
      SELECT month,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        SUM(defects)::int AS defects
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `;
    if (monthRows.length < 2) return null;

    const [curr, prev] = monthRows as { month: string; cost: number; defects: number }[];
    const costDelta   = prev.cost > 0 ? (((curr.cost - prev.cost) / prev.cost) * 100).toFixed(1) : null;
    const defectDelta = curr.defects - prev.defects;

    // Top 3 vehicles by defects in current month, with month-over-month change
    const vehicleRows = await sql`
      SELECT
        vehicle_id,
        SUM(CASE WHEN month = ${curr.month} THEN defects ELSE 0 END)::int AS curr_defects,
        SUM(CASE WHEN month = ${prev.month} THEN defects ELSE 0 END)::int AS prev_defects,
        ROUND(SUM(CASE WHEN month = ${curr.month} THEN fuel + maintenance + wages + repairs ELSE 0 END))::bigint AS curr_cost
      FROM fleet_metrics
      WHERE organisation_id = ${oid} AND month IN (${curr.month}, ${prev.month})
      GROUP BY vehicle_id
      HAVING SUM(CASE WHEN month = ${curr.month} THEN defects ELSE 0 END) > 0
      ORDER BY curr_defects DESC, curr_cost DESC
      LIMIT 3
    `;

    const vehicleSummary = (vehicleRows as { vehicle_id: string; curr_defects: number; prev_defects: number; curr_cost: number }[])
      .map(v => {
        const delta = v.curr_defects - v.prev_defects;
        return `${v.vehicle_id} (${v.curr_defects} defects${delta > 0 ? `, +${delta} vs ${prev.month}` : ''})`;
      })
      .join(', ');

    return [
      `Fleet (${curr.month} vs ${prev.month}): Cost ${costDelta ? `${Number(costDelta) > 0 ? '+' : ''}${costDelta}%` : 'no change'} ($${Number(curr.cost).toLocaleString()} vs $${Number(prev.cost).toLocaleString()}). Defects ${defectDelta > 0 ? `+${defectDelta}` : defectDelta} (${curr.defects} vs ${prev.defects}).`,
      vehicleSummary ? `Vehicles with active defects in ${curr.month}: ${vehicleSummary}.` : '',
    ].filter(Boolean).join(' ');
  } catch { return null; }
}

async function srChanged(oid: string): Promise<string | null> {
  try {
    const [curr, prev, topAreas] = await Promise.all([
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
      sql`
        SELECT suburb,
          COUNT(*)::int AS open,
          COUNT(CASE WHEN priority='High' THEN 1 END)::int AS high
        FROM service_requests WHERE organisation_id = ${oid}
          AND status='Open' AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY suburb ORDER BY open DESC LIMIT 3
      `,
    ]);

    const c = curr[0]; const p = prev[0];
    if (!Number(c?.total) && !Number(p?.total)) return null;

    const openDelta = (c?.open_count ?? 0) - (p?.open_count ?? 0);
    const areaSummary = (topAreas as { suburb: string; open: number; high: number }[])
      .map(r => `${r.suburb} (${r.open} open, ${r.high} high-priority)`)
      .join(', ');

    return [
      `Service Requests (last 30 days vs prior 30 days): Open ${openDelta > 0 ? `+${openDelta}` : openDelta} (${c?.open_count ?? 0} vs ${p?.open_count ?? 0}). Avg days open: ${c?.avg_days_open ?? '?'} vs ${p?.avg_days_open ?? '?'} days. Total created: ${c?.total ?? 0} vs ${p?.total ?? 0}.`,
      areaSummary ? `Highest-volume complaint areas (last 30 days): ${areaSummary}.` : '',
    ].filter(Boolean).join(' ');
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
        content: `You are an operations analyst. Based on this period-over-period data, produce a "What Changed?" briefing.

Data:
${deltas.map(d => `• ${d}`).join('\n')}

Return valid JSON only (no markdown):
{
  "bullets": [
    "Each bullet: direction (UP/DOWN/STABLE), then a specific named entity and its exact metric change. Max 18 words."
  ],
  "summary": "One sentence naming the single most significant change, with the specific entity responsible."
}

Generate 3-5 bullets. Ignore changes under 2%.

HARD RULES — output will be rejected if violated:
• Every bullet MUST open with a named entity (a suburb, vehicle ID, or area name).
• BANNED phrases: "overall increase", "across regions", "general improvement", "multiple areas", "several suburbs", "various locations".
• Use the exact suburb names, vehicle IDs, and numbers provided in the data above.
• If suburbs or vehicles are listed in the data, you must reference at least 2 by name.`,
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
