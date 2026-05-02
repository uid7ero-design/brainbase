import Anthropic from '@anthropic-ai/sdk';
import type { AgentInput, AgentOutput } from './types';

const anthropic = new Anthropic();

// Standard schema fields the platform understands
const STANDARD_SCHEMAS = {
  waste_records: ['month', 'suburb', 'service_type', 'tonnes', 'collections', 'contamination_rate', 'cost', 'department'],
  fleet_metrics: ['month', 'vehicle_id', 'vehicle_type', 'km', 'fuel', 'maintenance', 'wages', 'repairs', 'downtime_hours', 'defects'],
  service_requests: ['request_id', 'service_type', 'suburb', 'status', 'priority', 'days_open', 'cost', 'created_at'],
};

const SYSTEM = `You are a data intake specialist for a municipal council operations platform.

Your job:
1. Identify what type of operational data is in the uploaded file (waste_records, fleet_metrics, or service_requests)
2. Map uploaded column headers to the matching standard schema fields
3. Detect data quality issues: missing required fields, invalid values, duplicates, unusual outliers
4. Return a structured JSON analysis

Standard schemas:
- waste_records: ${STANDARD_SCHEMAS.waste_records.join(', ')}
- fleet_metrics: ${STANDARD_SCHEMAS.fleet_metrics.join(', ')}
- service_requests: ${STANDARD_SCHEMAS.service_requests.join(', ')}

RULES:
- Only use data provided. Never invent values.
- Confidence is based on how clearly headers map (0.9+ = clear match, 0.6–0.9 = probable, <0.6 = uncertain)
- Flag any column that cannot be mapped as a warning
- Check sample rows for obvious data quality issues (nulls in required fields, negative costs, contamination > 100%, etc.)

Return valid JSON only matching this schema:
{
  "detectedType": "waste_records|fleet_metrics|service_requests|unknown",
  "columnMapping": { "<uploaded_header>": "<standard_field>|null" },
  "unmappedColumns": ["<column>"],
  "sampleIssues": ["<description of issue in row N>"],
  "missingRequiredFields": ["<field>"],
  "confidence": 0.0-1.0,
  "summary": "One sentence describing what was found and any critical gaps.",
  "warnings": ["<warning>"]
}`;

interface DataContext {
  headers: string[];
  rows: unknown[][];
  filename: string;
  rowCount: number;
}

export async function run(input: AgentInput): Promise<AgentOutput> {
  const ctx = input.dataContext as DataContext | undefined;
  if (!ctx?.headers?.length) {
    return {
      agentName: 'DataIntakeAgent',
      summary: 'No data provided for analysis.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Upload a CSV or XLSX file to begin.'],
      sourceRows: [],
      warnings: ['dataContext must include headers and rows.'],
    };
  }

  // Build a compact data preview (headers + up to 5 sample rows)
  const sampleRows = ctx.rows.slice(0, 5);
  const dataPreview = [
    `File: ${ctx.filename} (${ctx.rowCount} rows)`,
    `Headers: ${ctx.headers.join(', ')}`,
    'Sample rows:',
    ...sampleRows.map((r, i) => `Row ${i + 1}: ${(r as unknown[]).join(', ')}`),
  ].join('\n');

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Analyse this uploaded data and return your JSON assessment.\n\n${dataPreview}`,
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]) as {
      detectedType: string;
      columnMapping: Record<string, string | null>;
      unmappedColumns: string[];
      sampleIssues: string[];
      missingRequiredFields: string[];
      confidence: number;
      summary: string;
      warnings: string[];
    };

    const mappedCount = Object.values(parsed.columnMapping).filter(Boolean).length;
    const findings: string[] = [
      `Detected data type: ${parsed.detectedType}`,
      `${mappedCount} of ${ctx.headers.length} columns mapped to standard schema`,
      ...(parsed.missingRequiredFields.length
        ? [`Missing required fields: ${parsed.missingRequiredFields.join(', ')}`]
        : ['All required fields present']),
      ...(parsed.sampleIssues.length ? parsed.sampleIssues : []),
    ];

    const actions: string[] = [];
    if (parsed.unmappedColumns.length) {
      actions.push(`Manually map columns: ${parsed.unmappedColumns.join(', ')}`);
    }
    if (parsed.missingRequiredFields.length) {
      actions.push(`Add missing columns before import: ${parsed.missingRequiredFields.join(', ')}`);
    }
    if (parsed.confidence >= 0.8 && !parsed.missingRequiredFields.length) {
      actions.push('Data looks ready — proceed with import.');
    }

    return {
      agentName: 'DataIntakeAgent',
      summary: parsed.summary,
      findings,
      confidence: parsed.confidence,
      recommendedActions: actions,
      sourceRows: sampleRows,
      warnings: parsed.warnings,
    };
  } catch (err) {
    return {
      agentName: 'DataIntakeAgent',
      summary: 'Analysis failed due to an internal error.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Retry the upload or check the file format.'],
      sourceRows: [],
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
