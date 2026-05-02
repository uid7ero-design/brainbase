import Anthropic from '@anthropic-ai/sdk';
import sql from '@/lib/db';
import type { AgentInput, AgentOutput, Evidence } from './types';

const anthropic = new Anthropic();

const SYSTEM = `You are a data analyst for a municipal council operations platform.

You receive structured operational data from waste, fleet, and service request modules.
Your job is to identify meaningful insights: trends, anomalies, outliers, and period-over-period changes.

RULES:
- Only reference entities (suburbs, vehicle IDs, months) that appear in the data provided.
- Never invent or estimate figures.
- Each finding must cite a specific number from the data.
- Confidence reflects data volume: ≥30 rows = high (0.8–1.0), 5–29 rows = medium (0.5–0.79), <5 rows = low (<0.5).
- Flag any finding where data is thin as a warning.

Return valid JSON only:
{
  "findings": ["Each finding: specific entity + metric + direction. Max 20 words. Cite exact numbers."],
  "summary": "2 sentences: the most significant finding and its operational implication.",
  "confidence": 0.0-1.0,
  "warnings": ["Any data quality or coverage concern."],
  "evidenceSummary": "Plain English: what data was examined, which modules, how many rows, what time window covered.",
  "calculationUsed": "The key aggregations and comparisons performed, e.g. AVG(contamination_rate) GROUP BY suburb, month-over-month cost diff. Be specific.",
  "confidenceReason": "Why confidence is at this level. Cite exact row counts per module and note any gaps."
}

Generate 4–8 findings. Ignore changes under 5%.`;

// ─── Per-module data fetchers ──────────────────────────────────────────────────

async function fetchWasteInsights(oid: string) {
  const [contamRows, periodRows, suburbRows] = await Promise.all([
    sql`
      SELECT suburb,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contam,
        ROUND(SUM(cost))::bigint AS total_cost,
        ROUND(SUM(tonnes)::numeric, 0)::bigint AS total_tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY suburb
      HAVING AVG(contamination_rate) > 8
      ORDER BY avg_contam DESC
      LIMIT 5
    `,
    sql`
      SELECT month,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contam,
        ROUND(SUM(tonnes)::numeric, 0)::bigint AS total_tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 3
    `,
    sql`
      SELECT suburb,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contam
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY suburb
      ORDER BY cost DESC
      LIMIT 5
    `,
  ]);
  return { contamRows, periodRows, suburbRows };
}

async function fetchFleetInsights(oid: string) {
  const [vehicleRows, periodRows] = await Promise.all([
    sql`
      SELECT vehicle_id,
        SUM(defects)::int AS total_defects,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS total_cost,
        ROUND(SUM(downtime_hours)::numeric, 1)::float AS total_downtime
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY vehicle_id
      HAVING SUM(defects) > 0
      ORDER BY total_defects DESC
      LIMIT 5
    `,
    sql`
      SELECT month,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        SUM(defects)::int AS defects,
        ROUND(SUM(downtime_hours)::numeric, 1)::float AS downtime
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 3
    `,
  ]);
  return { vehicleRows, periodRows };
}

async function fetchSRInsights(oid: string) {
  const [suburbRows, ageRows] = await Promise.all([
    sql`
      SELECT suburb,
        COUNT(*)::int AS open_count,
        COUNT(CASE WHEN priority = 'High' THEN 1 END)::int AS high_priority,
        ROUND(AVG(days_open)::numeric, 1)::float AS avg_days_open
      FROM service_requests
      WHERE organisation_id = ${oid} AND status = 'Open'
      GROUP BY suburb
      ORDER BY open_count DESC
      LIMIT 5
    `,
    sql`
      SELECT service_type,
        COUNT(*)::int AS open_count,
        ROUND(MAX(days_open)::numeric, 0)::int AS max_days_open,
        ROUND(AVG(days_open)::numeric, 1)::float AS avg_days_open
      FROM service_requests
      WHERE organisation_id = ${oid} AND status = 'Open'
      GROUP BY service_type
      ORDER BY max_days_open DESC
      LIMIT 5
    `,
  ]);
  return { suburbRows, ageRows };
}

// ─── Module enablement ─────────────────────────────────────────────────────────

async function getEnabledModules(oid: string): Promise<string[]> {
  try {
    const rows = await sql`
      SELECT m.key FROM organisation_modules om
      JOIN modules m ON m.id = om.module_id
      WHERE om.organisation_id = ${oid} AND om.enabled = true
    `;
    return rows.map(r => r.key as string);
  } catch {
    return ['waste_recycling', 'fleet_management', 'service_requests'];
  }
}

// ─── Main agent ────────────────────────────────────────────────────────────────

export async function run(input: AgentInput): Promise<AgentOutput> {
  const { organisationId: oid, department } = input;

  const moduleKeys = await getEnabledModules(oid);

  const dataBlocks: string[] = [];
  const allSourceRows: unknown[] = [];
  const loadedDatasets: string[] = [];

  const COLUMN_MAP: Record<string, string[]> = {
    waste_records:    ['suburb', 'month', 'contamination_rate', 'cost', 'tonnes', 'collections'],
    fleet_metrics:    ['vehicle_id', 'month', 'fuel', 'maintenance', 'wages', 'repairs', 'defects', 'downtime_hours'],
    service_requests: ['suburb', 'service_type', 'status', 'priority', 'days_open'],
  };

  const moduleFilter = department?.toLowerCase();

  await Promise.all([
    (async () => {
      if (moduleFilter && !['waste', 'recycling'].some(k => moduleFilter.includes(k))) return;
      if (!moduleKeys.some(k => k.includes('waste'))) return;
      try {
        const { contamRows, periodRows, suburbRows } = await fetchWasteInsights(oid);
        allSourceRows.push(...contamRows, ...periodRows, ...suburbRows);
        loadedDatasets.push('waste_records');
        dataBlocks.push(
          '=== WASTE ===',
          `Period trend (last 3 months): ${JSON.stringify(periodRows)}`,
          `High-contamination suburbs (>8%): ${JSON.stringify(contamRows)}`,
          `Top suburbs by cost: ${JSON.stringify(suburbRows)}`,
        );
      } catch { /* module may not have data */ }
    })(),
    (async () => {
      if (moduleFilter && !['fleet', 'vehicle'].some(k => moduleFilter.includes(k))) return;
      if (!moduleKeys.some(k => k.includes('fleet'))) return;
      try {
        const { vehicleRows, periodRows } = await fetchFleetInsights(oid);
        allSourceRows.push(...vehicleRows, ...periodRows);
        loadedDatasets.push('fleet_metrics');
        dataBlocks.push(
          '=== FLEET ===',
          `Period trend (last 3 months): ${JSON.stringify(periodRows)}`,
          `Vehicles with defects: ${JSON.stringify(vehicleRows)}`,
        );
      } catch { /* module may not have data */ }
    })(),
    (async () => {
      if (moduleFilter && !['service', 'request', 'crm'].some(k => moduleFilter.includes(k))) return;
      if (!moduleKeys.some(k => k.includes('service'))) return;
      try {
        const { suburbRows, ageRows } = await fetchSRInsights(oid);
        allSourceRows.push(...suburbRows, ...ageRows);
        loadedDatasets.push('service_requests');
        dataBlocks.push(
          '=== SERVICE REQUESTS ===',
          `Open requests by suburb: ${JSON.stringify(suburbRows)}`,
          `Longest-pending by service type: ${JSON.stringify(ageRows)}`,
        );
      } catch { /* module may not have data */ }
    })(),
  ]);

  if (dataBlocks.length === 0) {
    return {
      agentName: 'InsightAgent',
      summary: 'No data available for the enabled modules.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Upload operational data to generate insights.'],
      sourceRows: [],
      warnings: ['No enabled module data found.'],
    };
  }

  const dataPayload = dataBlocks.join('\n');
  const queryContext = input.query ? `\nUser question: "${input.query}"` : '';

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Analyse the following operational data and return your JSON insight report.${queryContext}\n\n${dataPayload}`,
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]) as {
      findings: string[];
      summary: string;
      confidence: number;
      warnings: string[];
      evidenceSummary?: string;
      calculationUsed?: string;
      confidenceReason?: string;
    };

    const actions = parsed.findings.slice(0, 3).map(f =>
      `Investigate: ${f.slice(0, 80)}`,
    );

    const sourceColumns = [...new Set(loadedDatasets.flatMap(d => COLUMN_MAP[d] ?? []))];
    const evidence: Evidence = {
      sourceDataset:  loadedDatasets,
      sourceColumns,
      evidenceSummary: parsed.evidenceSummary ?? `Analysed ${allSourceRows.length} rows across ${loadedDatasets.join(', ')}.`,
      calculationUsed: parsed.calculationUsed ?? 'Aggregations: AVG, SUM, GROUP BY per module.',
      confidenceReason: parsed.confidenceReason ?? `Confidence based on ${allSourceRows.length} source rows.`,
      sampleRows: allSourceRows.slice(0, 5),
    };

    return {
      agentName: 'InsightAgent',
      summary: parsed.summary,
      findings: parsed.findings ?? [],
      confidence: parsed.confidence ?? 0.5,
      recommendedActions: actions,
      sourceRows: allSourceRows,
      warnings: parsed.warnings ?? [],
      evidence,
    };
  } catch (err) {
    return {
      agentName: 'InsightAgent',
      summary: 'Insight analysis failed.',
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: allSourceRows,
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
