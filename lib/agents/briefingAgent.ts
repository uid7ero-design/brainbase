import Anthropic from '@anthropic-ai/sdk';
import sql from '@/lib/db';
import type { AgentInput, AgentOutput, Evidence } from './types';

const anthropic = new Anthropic();

const SYSTEM = `You are an executive briefing writer for a municipal council operations platform.

You receive period-over-period operational data across waste, fleet, and service request modules.
Your job is to produce a structured executive briefing. For each module present, write one briefing section.

Each section MUST follow this exact 4-part format:
1. What changed — specific metric, direction, and magnitude with named entities
2. Why it matters — operational or financial implication
3. Risk — what happens if unaddressed (be specific, name the entity)
4. Recommended action — one concrete next step, named owner, timeframe

RULES:
- Every statement must reference a specific entity (suburb, vehicle ID, service type) from the data.
- Do not use vague phrases: "overall trend", "multiple areas", "various locations".
- Confidence reflects row count: ≥30 rows → 0.85+, 5–29 rows → 0.55–0.84, <5 rows → <0.55.
- If a module has insufficient data, include a warning instead of a section.

Return valid JSON only:
{
  "sections": [
    {
      "module": "waste|fleet|service_requests",
      "whatChanged": "...",
      "whyItMatters": "...",
      "risk": "...",
      "recommendedAction": "..."
    }
  ],
  "topFinding": "One sentence: the single most critical finding across all modules, naming the entity.",
  "confidence": 0.0-1.0,
  "warnings": ["Any data coverage or quality concern."],
  "evidenceSummary": "What data windows and datasets formed this briefing. State the time periods and row counts per module.",
  "calculationUsed": "Key period comparisons and aggregations used (e.g., month-over-month cost diff, SUM by suburb). Be specific per module.",
  "confidenceReason": "Why this confidence level. Cite row counts and data completeness per module."
}`;

async function fetchWasteData(oid: string) {
  const [monthRows, suburbRows] = await Promise.all([
    sql`
      SELECT month,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contam,
        ROUND(SUM(tonnes)::numeric, 0)::bigint AS total_tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `,
    sql`
      SELECT suburb,
        ROUND(SUM(cost))::bigint AS cost,
        ROUND(AVG(contamination_rate)::numeric, 1)::float AS avg_contam,
        ROUND(SUM(tonnes)::numeric, 0)::bigint AS tonnes
      FROM waste_records WHERE organisation_id = ${oid}
      GROUP BY suburb
      ORDER BY cost DESC
      LIMIT 5
    `,
  ]);
  return { monthRows, suburbRows };
}

async function fetchFleetData(oid: string) {
  const [monthRows, vehicleRows] = await Promise.all([
    sql`
      SELECT month,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        SUM(defects)::int AS defects,
        ROUND(SUM(downtime_hours)::numeric, 1)::float AS downtime
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY month
      ORDER BY ARRAY_POSITION(ARRAY['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'], month) DESC
      LIMIT 2
    `,
    sql`
      SELECT vehicle_id,
        SUM(defects)::int AS defects,
        ROUND(SUM(fuel + maintenance + wages + repairs))::bigint AS cost,
        ROUND(SUM(downtime_hours)::numeric, 1)::float AS downtime
      FROM fleet_metrics WHERE organisation_id = ${oid}
      GROUP BY vehicle_id
      HAVING SUM(defects) > 0
      ORDER BY defects DESC, cost DESC
      LIMIT 5
    `,
  ]);
  return { monthRows, vehicleRows };
}

async function fetchSRData(oid: string) {
  const [periodRows, suburbRows] = await Promise.all([
    sql`
      SELECT
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS recent_created,
        COUNT(CASE WHEN status = 'Open' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS recent_open,
        COUNT(CASE WHEN status = 'Open' AND created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN 1 END)::int AS prior_open,
        ROUND(AVG(CASE WHEN status = 'Open' THEN days_open END)::numeric, 1)::float AS avg_days_open
      FROM service_requests WHERE organisation_id = ${oid}
    `,
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
  ]);
  return { periodRows, suburbRows };
}

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

const COLUMN_MAP: Record<string, string[]> = {
  waste_records:    ['suburb', 'month', 'contamination_rate', 'cost', 'tonnes'],
  fleet_metrics:    ['vehicle_id', 'month', 'fuel', 'maintenance', 'wages', 'repairs', 'defects', 'downtime_hours'],
  service_requests: ['suburb', 'service_type', 'status', 'priority', 'days_open'],
};

export async function run(input: AgentInput): Promise<AgentOutput> {
  const { organisationId: oid } = input;
  const moduleKeys = await getEnabledModules(oid);

  const dataBlocks: string[] = [];
  const allSourceRows: unknown[] = [];
  const loadedDatasets: string[] = [];

  await Promise.all([
    (async () => {
      if (!moduleKeys.some(k => k.includes('waste'))) return;
      try {
        const { monthRows, suburbRows } = await fetchWasteData(oid);
        allSourceRows.push(...monthRows, ...suburbRows);
        loadedDatasets.push('waste_records');
        if (monthRows.length >= 1) {
          dataBlocks.push(
            '=== WASTE MODULE ===',
            `Monthly trend: ${JSON.stringify(monthRows)}`,
            `Top suburbs by cost: ${JSON.stringify(suburbRows)}`,
          );
        }
      } catch { /* no data */ }
    })(),
    (async () => {
      if (!moduleKeys.some(k => k.includes('fleet'))) return;
      try {
        const { monthRows, vehicleRows } = await fetchFleetData(oid);
        allSourceRows.push(...monthRows, ...vehicleRows);
        loadedDatasets.push('fleet_metrics');
        if (monthRows.length >= 1) {
          dataBlocks.push(
            '=== FLEET MODULE ===',
            `Monthly trend: ${JSON.stringify(monthRows)}`,
            `Vehicles with defects: ${JSON.stringify(vehicleRows)}`,
          );
        }
      } catch { /* no data */ }
    })(),
    (async () => {
      if (!moduleKeys.some(k => k.includes('service'))) return;
      try {
        const { periodRows, suburbRows } = await fetchSRData(oid);
        allSourceRows.push(...periodRows, ...suburbRows);
        loadedDatasets.push('service_requests');
        dataBlocks.push(
          '=== SERVICE REQUESTS MODULE ===',
          `Period summary: ${JSON.stringify(periodRows)}`,
          `Open requests by suburb: ${JSON.stringify(suburbRows)}`,
        );
      } catch { /* no data */ }
    })(),
  ]);

  if (dataBlocks.length === 0) {
    return {
      agentName: 'BriefingAgent',
      summary: 'No module data available to generate a briefing.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Upload operational data to enable briefings.'],
      sourceRows: [],
      warnings: ['No enabled module data found.'],
    };
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Generate the executive briefing from the following operational data.\n\n${dataBlocks.join('\n')}`,
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]) as {
      sections: Array<{
        module: string;
        whatChanged: string;
        whyItMatters: string;
        risk: string;
        recommendedAction: string;
      }>;
      topFinding: string;
      confidence: number;
      warnings: string[];
      evidenceSummary?: string;
      calculationUsed?: string;
      confidenceReason?: string;
    };

    const findings = (parsed.sections ?? []).flatMap(s => [
      `[${s.module.toUpperCase()}] What changed: ${s.whatChanged}`,
      `[${s.module.toUpperCase()}] Why it matters: ${s.whyItMatters}`,
      `[${s.module.toUpperCase()}] Risk: ${s.risk}`,
    ]);

    const actions = (parsed.sections ?? []).map(s =>
      `[${s.module.toUpperCase()}] ${s.recommendedAction}`,
    );

    const sourceColumns = [...new Set(loadedDatasets.flatMap(d => COLUMN_MAP[d] ?? []))];
    const evidence: Evidence = {
      sourceDataset:   loadedDatasets,
      sourceColumns,
      evidenceSummary: parsed.evidenceSummary ?? `Briefing across ${loadedDatasets.join(', ')} — ${allSourceRows.length} rows.`,
      calculationUsed: parsed.calculationUsed ?? 'Period-over-period comparisons, SUM and AVG aggregations per module.',
      confidenceReason: parsed.confidenceReason ?? `Confidence based on ${allSourceRows.length} rows from ${loadedDatasets.length} module(s).`,
      sampleRows: allSourceRows.slice(0, 5),
    };

    return {
      agentName: 'BriefingAgent',
      summary: parsed.topFinding,
      findings,
      confidence: parsed.confidence ?? 0.7,
      recommendedActions: actions,
      sourceRows: allSourceRows,
      warnings: parsed.warnings ?? [],
      evidence,
    };
  } catch (err) {
    return {
      agentName: 'BriefingAgent',
      summary: 'Briefing generation failed.',
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: allSourceRows,
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
