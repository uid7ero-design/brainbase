import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const anthropic = new Anthropic();

// ─── Module data snapshots ─────────────────────────────────────────────────────

async function wasteSnapshot(oid: string): Promise<string | null> {
  try {
    const [totals, monthRows, suburbCost, suburbContam] = await Promise.all([
      sql`
        SELECT
          ROUND(SUM(cost))::bigint            AS total_cost,
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
      sql`
        SELECT suburb, ROUND(SUM(cost))::bigint AS cost
        FROM waste_records WHERE organisation_id = ${oid}
        GROUP BY suburb ORDER BY cost DESC LIMIT 3
      `,
      sql`
        SELECT suburb, ROUND(AVG(contamination_rate)::numeric,1)::float AS contamination
        FROM waste_records WHERE organisation_id = ${oid}
        GROUP BY suburb ORDER BY contamination DESC LIMIT 3
      `,
    ]);

    const t = totals[0] ?? {};
    if (!Number(t.total_cost)) return null;

    const [latest, prev] = monthRows as { month: string; cost: number }[];
    const trend = latest && prev && Number(prev.cost) > 0
      ? `${Number(latest.cost) > Number(prev.cost) ? '+' : ''}${(((Number(latest.cost) - Number(prev.cost)) / Number(prev.cost)) * 100).toFixed(1)}% cost vs prev month`
      : null;

    const topCostSuburbs = (suburbCost as { suburb: string; cost: number }[])
      .map(r => `${r.suburb} ($${Number(r.cost).toLocaleString()})`)
      .join(', ');

    const overThreshold = (suburbContam as { suburb: string; contamination: number }[])
      .filter(r => Number(r.contamination) > 8)
      .map(r => `${r.suburb} (${r.contamination}%)`)
      .join(', ');

    return [
      `Waste & Recycling: $${Number(t.total_cost).toLocaleString()} total cost, ${t.total_tonnes?.toLocaleString()} tonnes, avg contamination ${t.avg_contamination ?? '?'}% (target ≤8%), ${t.suburbs_over_threshold ?? 0} suburbs over threshold.${trend ? ` Trend: ${trend}.` : ''}`,
      topCostSuburbs ? `Top 3 suburbs by cost: ${topCostSuburbs}.` : '',
      overThreshold   ? `Suburbs exceeding contamination threshold (>8%): ${overThreshold}.` : '',
    ].filter(Boolean).join(' ');
  } catch { return null; }
}

async function fleetSnapshot(oid: string): Promise<string | null> {
  try {
    const [totals, topVehicles] = await Promise.all([
      sql`
        SELECT
          ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS total_cost,
          SUM(defects)::int AS total_defects,
          COUNT(DISTINCT vehicle_id)::int AS vehicle_count,
          COUNT(CASE WHEN defects > 0 THEN 1 END)::int AS vehicles_with_defects
        FROM fleet_metrics WHERE organisation_id = ${oid}
      `,
      sql`
        SELECT vehicle_id,
          SUM(defects)::int AS defects,
          ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost
        FROM fleet_metrics WHERE organisation_id = ${oid}
        GROUP BY vehicle_id
        ORDER BY defects DESC, cost DESC LIMIT 3
      `,
    ]);

    const t = totals[0] ?? {};
    if (!Number(t.total_cost)) return null;

    const vehicleList = (topVehicles as { vehicle_id: string; defects: number; cost: number }[])
      .filter(v => Number(v.defects) > 0)
      .map(v => `${v.vehicle_id} (${v.defects} defects, $${Number(v.cost).toLocaleString()})`)
      .join(', ');

    return [
      `Fleet Management: $${Number(t.total_cost).toLocaleString()} total cost, ${t.vehicle_count} vehicles, ${t.total_defects} defects recorded, ${t.vehicles_with_defects} vehicles with active defects.`,
      vehicleList ? `Highest-defect vehicles: ${vehicleList}.` : '',
    ].filter(Boolean).join(' ');
  } catch { return null; }
}

async function srSnapshot(oid: string): Promise<string | null> {
  try {
    const [totals, topAreas] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN status='Open' THEN 1 END)::int AS open_count,
          COUNT(CASE WHEN priority='High' AND status='Open' THEN 1 END)::int AS high_open,
          ROUND(AVG(CASE WHEN status='Open' THEN days_open END)::numeric,1)::float AS avg_days_open
        FROM service_requests WHERE organisation_id = ${oid}
      `,
      sql`
        SELECT suburb,
          COUNT(*)::int AS total,
          COUNT(CASE WHEN priority='High' THEN 1 END)::int AS high
        FROM service_requests WHERE organisation_id = ${oid} AND status='Open'
        GROUP BY suburb ORDER BY total DESC LIMIT 3
      `,
    ]);

    const t = totals[0] ?? {};
    if (!Number(t.total)) return null;

    const areaList = (topAreas as { suburb: string; total: number; high: number }[])
      .map(r => `${r.suburb} (${r.total} open, ${r.high} high-priority)`)
      .join(', ');

    return [
      `Service Requests: ${t.open_count} open (${t.high_open} high priority), avg ${t.avg_days_open ?? '?'} days open (target ≤7 days), ${t.total} total.`,
      areaList ? `Highest complaint areas: ${areaList}.` : '',
    ].filter(Boolean).join(' ');
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
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an executive briefing system for a local government council operations platform.

Live data:
${snapshots.map(s => `• ${s}`).join('\n')}

Generate a structured 4-part executive briefing. Return valid JSON only (no markdown):
{
  "lines": [
    "WHAT CHANGED: one sentence — name the specific suburb or vehicle with the biggest movement and its exact metric.",
    "WHY: one sentence — explain the cause, referencing the named entity above.",
    "RISK: one sentence — state the business consequence if this specific entity is not addressed.",
    "ACTION: one sentence — name the exact suburb, vehicle ID, or team to act on and the specific action required."
  ],
  "urgentCount": number (0-5, count threshold breaches or overdue high-priority items),
  "summary": "one sentence plain-English summary naming the single most critical entity"
}

HARD RULES — output will be rejected if violated:
• Every sentence MUST contain at least one specific name (suburb name, vehicle ID, or area name).
• BANNED phrases: "overall", "across the region", "in general", "multiple areas", "several suburbs", "various locations", "generally speaking".
• Use exact numbers from the data — no rounding to vague terms.
• Each line must be under 20 words.`,
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
