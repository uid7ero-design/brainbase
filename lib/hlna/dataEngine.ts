/**
 * HLNA data engine — NL→SQL execution, trend detection, anomaly identification.
 *
 * Security model:
 *   - Only SELECT statements are executed.
 *   - organisation_id must appear in every query (prevents cross-tenant reads).
 *   - Results are capped at 200 rows.
 *   - The org ID is embedded by Claude as a literal UUID; the caller validates
 *     it matches the authenticated session before executing.
 */

import sql from '@/lib/db';

// ─── Schema description (fed to Claude as tool context) ───────────────────────

export const DB_SCHEMA = `
PostgreSQL tables — ALL scoped by organisation_id (UUID):

waste_records
  department   TEXT          -- source department: 'Waste', 'Customer Complaints', etc. Default 'Waste'.
  service_type TEXT          -- e.g. 'General Waste', 'Recycling', 'Organics', 'Hard Waste'
  suburb       TEXT
  month        TEXT          -- short name: 'Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'
  financial_year TEXT        -- e.g. '2025-26'
  tonnes       NUMERIC
  collections  INTEGER
  contamination_rate NUMERIC -- percentage, e.g. 8.5
  cost         NUMERIC
FILTER RULE: Always add "AND department = 'Waste'" when answering Waste dashboard questions.

fleet_metrics
  vehicle_id     TEXT        -- e.g. 'TRK003'
  vehicle_type   TEXT        -- e.g. 'Rear Loader', 'Side Loader', 'Hook Truck'
  make           TEXT
  year           INTEGER
  department     TEXT        -- vehicle's home department
  driver         TEXT
  km             NUMERIC     -- distance driven (km)
  wages          NUMERIC
  fuel           NUMERIC     -- fuel cost ($)
  maintenance    NUMERIC     -- maintenance cost ($)
  rego           NUMERIC
  repairs        NUMERIC
  insurance      NUMERIC
  depreciation   NUMERIC
  services       INTEGER     -- service count
  defects        INTEGER     -- defect count (breakdowns/faults)
  downtime_hours NUMERIC     -- hours vehicle was out of service
  route_minutes  NUMERIC     -- total route time (minutes)
  month          TEXT
  financial_year TEXT

service_requests
  request_id   TEXT
  service_type TEXT
  suburb       TEXT
  month        TEXT
  financial_year TEXT
  status       TEXT          -- e.g. 'Open', 'Closed', 'Pending'
  priority     TEXT          -- 'High', 'Medium', 'Low'
  days_open    INTEGER
  cost         NUMERIC

metric_snapshots              -- cross-module universal metric layer
  module_key      TEXT       -- e.g. 'waste_recycling', 'fleet_management'
  metric_key      TEXT       -- e.g. 'contamination_rate', 'fleet_availability'
  metric_label    TEXT
  value           NUMERIC
  unit            TEXT       -- e.g. '%', '$', 'tonnes'
  period_start    DATE
  period_end      DATE
  dimension       TEXT       -- optional grouping dimension e.g. 'suburb', 'vehicle_type'
  dimension_value TEXT       -- value of that dimension
  source_table    TEXT       -- originating table
`.trim();

// ─── Query execution ──────────────────────────────────────────────────────────

export type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

const ROW_LIMIT = 200;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|COPY)\b/i;

export async function executeQuery(rawSql: string, orgId: string): Promise<QueryResult> {
  const clean = rawSql.trim().replace(/;+\s*$/, '');

  if (!/^SELECT\b/i.test(clean))     throw new Error('Only SELECT queries are permitted.');
  if (FORBIDDEN.test(clean))          throw new Error('Write operations are not permitted.');
  if (/;/.test(clean))                throw new Error('Multi-statement queries are not permitted.');
  if (!/organisation_id/i.test(clean)) throw new Error('Query must filter by organisation_id.');
  if (!clean.includes(orgId))         throw new Error('Query must reference the correct organisation ID.');

  // Inject row cap unless already present
  const limited = /\bLIMIT\b/i.test(clean) ? clean : `${clean} LIMIT ${ROW_LIMIT}`;

  // Execute — build a zero-interpolation TemplateStringsArray and call the neon tag
  const tpl = Object.assign([limited], { raw: [limited] }) as unknown as TemplateStringsArray;
  const rows = (await sql(tpl)) as unknown as Record<string, unknown>[];

  return { rows, rowCount: rows.length, truncated: rows.length === ROW_LIMIT };
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export type TrendResult = {
  direction: 'increasing' | 'decreasing' | 'stable';
  changePct: string;
  first: number;
  last: number;
  peak: number;
  peakLabel: string;
};

export function detectTrend(
  rows: Record<string, unknown>[],
  valueKey: string,
  labelKey: string,
): TrendResult | null {
  if (rows.length < 2) return null;
  const values = rows.map(r => Number(r[valueKey]) || 0);
  const labels = rows.map(r => String(r[labelKey] ?? ''));
  const first = values[0], last = values[values.length - 1];
  const changePct = first > 0 ? (((last - first) / first) * 100).toFixed(1) : '0';
  const direction = Number(changePct) > 5 ? 'increasing' : Number(changePct) < -5 ? 'decreasing' : 'stable';
  const peak = Math.max(...values);
  const peakLabel = labels[values.indexOf(peak)];
  return { direction, changePct, first, last, peak, peakLabel };
}

export type AnomalyResult = { label: string; value: number; zScore: number; direction: 'high' | 'low' };

export function findAnomalies(
  rows: Record<string, unknown>[],
  valueKey: string,
  labelKey: string,
): AnomalyResult[] {
  if (rows.length < 4) return [];
  const values = rows.map(r => Number(r[valueKey]) || 0);
  const labels = rows.map(r => String(r[labelKey] ?? ''));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std  = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  if (std === 0) return [];
  return values
    .map((v, i) => ({ label: labels[i], value: v, zScore: (v - mean) / std, direction: v > mean ? 'high' as const : 'low' as const }))
    .filter(r => Math.abs(r.zScore) > 1.5)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// ─── Formatting for Claude ────────────────────────────────────────────────────

export function formatQueryResult(result: QueryResult): string {
  if (result.rowCount === 0) return 'Query returned no rows.';

  const rows = result.rows;
  const cols = Object.keys(rows[0]);

  // Build a compact table
  const header = cols.join(' | ');
  const body   = rows
    .slice(0, 50)
    .map(r => cols.map(c => {
      const v = r[c];
      if (v == null) return '—';
      if (typeof v === 'number' || (!isNaN(Number(v)) && v !== '')) {
        return Number(v).toLocaleString('en-AU', { maximumFractionDigits: 2 });
      }
      return String(v);
    }).join(' | '))
    .join('\n');

  const tableStr = `${header}\n${'-'.repeat(header.length)}\n${body}`;
  const suffix   = result.truncated ? `\n(showing first ${ROW_LIMIT} rows)` : `\n(${result.rowCount} rows)`;

  // Attempt analytics on first numeric col vs first text col
  const numCol  = cols.find(c => rows.some(r => r[c] != null && !isNaN(Number(r[c]))));
  const textCol = cols.find(c => rows.some(r => r[c] != null && isNaN(Number(r[c]))));
  const insights: string[] = [];

  if (numCol && textCol) {
    const trend = detectTrend(rows, numCol, textCol);
    if (trend && trend.direction !== 'stable') {
      insights.push(`TREND: ${numCol} is ${trend.direction} — changed ${trend.changePct}% from ${trend.first.toLocaleString('en-AU')} to ${trend.last.toLocaleString('en-AU')}. Peak: ${trend.peak.toLocaleString('en-AU')} at ${trend.peakLabel}.`);
    }

    const anomalies = findAnomalies(rows, numCol, textCol);
    for (const a of anomalies.slice(0, 3)) {
      insights.push(`ANOMALY: ${a.label} has ${a.direction === 'high' ? 'unusually high' : 'unusually low'} ${numCol} (${a.value.toLocaleString('en-AU')}, z=${a.zScore.toFixed(1)}).`);
    }
  }

  // Basic stats for numeric cols
  for (const col of cols.filter(c => rows.every(r => r[c] == null || !isNaN(Number(r[c])))).slice(0, 3)) {
    const vals = rows.map(r => Number(r[col]) || 0).filter(v => v !== 0);
    if (vals.length < 2) continue;
    const sum = vals.reduce((s, v) => s + v, 0);
    const avg = sum / vals.length;
    insights.push(`STATS ${col}: total=${sum.toLocaleString('en-AU', { maximumFractionDigits: 0 })}, avg=${avg.toLocaleString('en-AU', { maximumFractionDigits: 1 })}, max=${Math.max(...vals).toLocaleString('en-AU', { maximumFractionDigits: 0 })}, min=${Math.min(...vals).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`);
  }

  const analyticsStr = insights.length ? `\n\nANALYTICS:\n${insights.join('\n')}` : '';

  return `${tableStr}${suffix}${analyticsStr}`;
}
