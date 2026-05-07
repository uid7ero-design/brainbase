import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const openai = new OpenAI();

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

async function tennisWeatherLine(): Promise<string> {
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=-34.93&longitude=138.60&daily=precipitation_probability_max&timezone=Australia%2FAdelaide&forecast_days=7',
      { next: { revalidate: 3600 } },
    );
    const data = await res.json() as { daily: { time: string[]; precipitation_probability_max: number[] } };
    const days = data.daily.time.map((d, i) => ({
      label: i === 0 ? 'today' : i === 1 ? 'tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
      rain:  Math.round(data.daily.precipitation_probability_max[i] ?? 0),
    }));
    const rainDays  = days.filter(d => d.rain > 60);
    const clearDays = days.filter(d => d.rain < 30);
    if (rainDays.length > 0) {
      return `Weather: ${rainDays.length} day${rainDays.length > 1 ? 's' : ''} with high rain risk this week (${rainDays.map(d => `${d.label} ${d.rain}%`).join(', ')}). ${clearDays.length} clear day${clearDays.length !== 1 ? 's' : ''} available for sessions.`;
    }
    return `Weather: Clear conditions all week — ${clearDays.length} of 7 days with <30% rain chance. Good opportunity to push bookings.`;
  } catch {
    return '';
  }
}

async function tennisSnapshot(oid: string): Promise<string | null> {
  try {
    const [contactStats, attentionRows, leadsRows, weatherLine] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN status = 'active'   THEN 1 END)::int AS active_count,
          COUNT(CASE WHEN status = 'lead'     THEN 1 END)::int AS lead_count,
          COUNT(CASE WHEN status = 'inactive' THEN 1 END)::int AS inactive_count,
          COUNT(CASE WHEN status != 'inactive' AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '7 days') THEN 1 END)::int AS needs_attention
        FROM contacts WHERE organisation_id = ${oid}
      `,
      sql`
        SELECT name, last_contacted_at
        FROM contacts
        WHERE organisation_id = ${oid}
          AND status != 'inactive'
          AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '7 days')
        ORDER BY last_contacted_at ASC NULLS FIRST
        LIMIT 3
      `,
      sql`
        SELECT COUNT(*)::int AS pending FROM tennis_leads
        WHERE organisation_id = ${oid} AND status = 'new'
      `,
      tennisWeatherLine(),
    ]);

    const t = contactStats[0] ?? {};
    if (!Number(t.total)) return null;

    const attention    = (attentionRows as { name: string; last_contacted_at: string | null }[]).map(r => r.name).join(', ');
    const pendingLeads = Number((leadsRows[0] as { pending: number })?.pending ?? 0);

    return [
      `Tennis Contacts: ${t.total} total — ${t.active_count} active, ${t.lead_count} leads, ${t.inactive_count} inactive. ${t.needs_attention} contact${t.needs_attention !== 1 ? 's' : ''} need${t.needs_attention === 1 ? 's' : ''} attention (not contacted in 7+ days).`,
      attention    ? `Overdue follow-ups: ${attention}.` : '',
      pendingLeads > 0 ? `${pendingLeads} new lead${pendingLeads !== 1 ? 's' : ''} awaiting review.` : '',
      weatherLine,
    ].filter(Boolean).join(' ');
  } catch { return null; }
}

const MODULE_SNAPSHOTS: Record<string, (oid: string) => Promise<string | null>> = {
  waste_recycling:   wasteSnapshot,
  fleet_management:  fleetSnapshot,
  service_requests:  srSnapshot,
  ld_tennis:         tennisSnapshot,
};

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  let oid: string;
  try {
    const session = await getAuthSession();
    oid = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let moduleKeys: string[] = [];
  const ldTennisOrgId = process.env.LD_TENNIS_ORG_ID;
  if (ldTennisOrgId && oid === ldTennisOrgId) {
    moduleKeys = ['ld_tennis'];
  } else {
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
    const isTennis = moduleKeys.includes('ld_tennis');
    const systemContext = isTennis
      ? 'You are a coaching business briefing assistant for a tennis coach. Focus on client follow-ups, new leads, and session management.'
      : 'You are an executive briefing system for a local government council operations platform.';

    const actionGuide = isTennis
      ? '"ACTION: one sentence — name the specific client or lead to contact and the exact next step (call, email, book session)."'
      : '"ACTION: one sentence — name the exact suburb, vehicle ID, or team to act on and the specific action required."';

    const whatChangedGuide = isTennis
      ? '"WHAT CHANGED: one sentence — state the most pressing follow-up need with exact numbers (e.g. how many overdue, who is waiting)."'
      : '"WHAT CHANGED: one sentence — name the specific suburb or vehicle with the biggest movement and its exact metric."';

    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `${systemContext}

Live data:
${snapshots.map(s => `• ${s}`).join('\n')}

Generate a structured 4-part executive briefing. Return valid JSON only (no markdown):
{
  "lines": [
    ${whatChangedGuide},
    "WHY: one sentence — explain the cause or context.",
    "RISK: one sentence — state the business consequence if not addressed.",
    ${actionGuide}
  ],
  "urgentCount": number (0-5, count of overdue contacts or high-priority items),
  "summary": "one sentence plain-English summary of the single most critical item"
}

HARD RULES — output will be rejected if violated:
• Use exact numbers from the data — no rounding to vague terms.
• BANNED phrases: "overall", "in general", "multiple areas", "several", "various", "generally speaking".
• Each line must be under 20 words.`,
      }],
    });

    const text = resp.choices[0].message.content ?? '';
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
