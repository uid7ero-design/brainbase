import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

const anthropic = new Anthropic();

const BLOCKED_PATTERN = /hidden|demo|helper|flag|label|issue|debug|test/i;

const APPROVED_FIELDS = new Set([
  'date', 'month', 'year', 'period', 'week',
  'department', 'suburb', 'zone', 'region', 'area',
  'service_type', 'service_category',
  'tonnes', 'weight', 'volume',
  'cost', 'total_cost', 'spend', 'expenditure', 'budget',
  'missed_services', 'missed_collections', 'missed_bins',
  'contamination_rate', 'contamination_rate_pct', 'contamination_pct',
  'vehicle_id', 'vehicle', 'truck', 'fleet_id', 'registration',
  'distance_km', 'km', 'kilometres', 'odometer',
  'fuel_cost', 'fuel', 'fuel_litres',
  'maintenance_cost', 'maintenance', 'repair_cost',
  'downtime_hours', 'downtime', 'unavailable_hours',
  'route_minutes', 'route_hours', 'travel_time',
  'complaint_type', 'complaint_category', 'complaint_priority',
  'complaint_status', 'status', 'priority', 'resolution',
  'response_hours', 'response_time', 'sla_hours', 'days_open',
  'collections', 'lifts', 'services',
  'defects', 'faults', 'incidents',
  'wages', 'labour_cost', 'staff_cost',
  'insurance', 'depreciation', 'rego',
  'count', 'total', 'average', 'quantity',
  'financial_year', 'fy',
  'request_id', 'complaint_id', 'ticket_id',
  'vehicle_type', 'make', 'driver',
]);

// Maps normalised CSV column names → DB field names
const CANONICAL_MAP: Record<string, string> = {
  fuel_cost: 'fuel',
  fuel_litres: 'fuel',
  labour_cost: 'wages',
  staff_cost: 'wages',
  maintenance_cost: 'maintenance',
  repair_cost: 'repairs',
  distance_km: 'km',
  kilometres: 'km',
  odometer: 'km',
  downtime: 'downtime_hours',
  unavailable_hours: 'downtime_hours',
  route_hours: 'route_minutes',
  total_cost: 'cost',
  spend: 'cost',
  expenditure: 'cost',
  contamination_rate_pct: 'contamination_rate',
  contamination_pct: 'contamination_rate',
  missed_services: 'missed_collections',
  missed_bins: 'missed_collections',
  lifts: 'collections',
  faults: 'defects',
  incidents: 'defects',
  fleet_id: 'vehicle_id',
  truck: 'vehicle_id',
  registration: 'vehicle_id',
  complaint_id: 'request_id',
  ticket_id: 'request_id',
  complaint_type: 'service_type',
  complaint_category: 'service_type',
  service_category: 'service_type',
  zone: 'suburb',
  region: 'suburb',
  area: 'suburb',
  period: 'month',
  fy: 'financial_year',
  tonnes: 'tonnes',
  weight: 'tonnes',
  volume: 'tonnes',
};

type TableName = 'fleet_metrics' | 'service_requests' | 'waste_records';

const FLEET_SIGNALS = new Set(['vehicle_id', 'fleet_id', 'truck', 'registration', 'km', 'distance_km', 'kilometres', 'fuel', 'fuel_cost', 'fuel_litres', 'maintenance', 'maintenance_cost', 'downtime_hours', 'downtime', 'route_minutes', 'driver', 'vehicle_type', 'make']);
const SR_SIGNALS    = new Set(['request_id', 'complaint_id', 'ticket_id', 'days_open', 'response_hours', 'sla_hours', 'complaint_type', 'complaint_status', 'complaint_category', 'complaint_priority', 'resolution']);

function detectTable(headers: string[]): TableName {
  const norm = headers.map(h => normaliseKey(h));
  const fleetScore = norm.filter(h => FLEET_SIGNALS.has(h)).length;
  const srScore    = norm.filter(h => SR_SIGNALS.has(h)).length;
  if (fleetScore >= 2) return 'fleet_metrics';
  if (srScore >= 2)    return 'service_requests';
  return 'waste_records';
}

function normaliseKey(col: string): string {
  return col.toLowerCase().replace(/[\s\-]/g, '_').replace(/[^a-z0-9_]/g, '');
}

function isApproved(col: string): boolean {
  return APPROVED_FIELDS.has(normaliseKey(col));
}

function sanitiseColumns(
  headers: string[],
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept: string[] = [];

  for (const h of headers) {
    if (BLOCKED_PATTERN.test(h) || !isApproved(h)) {
      dropped.push(h);
    } else {
      kept.push(h);
    }
  }

  const sanitisedRows = rows.map(row =>
    Object.fromEntries(kept.map(h => [h, row[h] ?? ''])),
  );

  return { headers: kept, rows: sanitisedRows, dropped };
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const splitLine = (line: string) =>
    line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));

  const rawHeaders = splitLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/^﻿/, ''));

  const rows = lines.slice(1, 201).map(line => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  }).filter(r => Object.values(r).some(v => v.trim()));

  return { headers, rows };
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,%]/g, ''));
  return isNaN(n) ? null : n;
}

function str(v: string | undefined): string | null {
  return v?.trim() || null;
}

// Build a normalised field map for a row: canonical DB field → value
function canonicalRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [csvKey, val] of Object.entries(row)) {
    const norm = normaliseKey(csvKey);
    const dbKey = CANONICAL_MAP[norm] ?? norm;
    if (!(dbKey in out)) out[dbKey] = val; // first write wins
  }
  return out;
}

async function insertWasteRecords(orgId: string, rows: Record<string, string>[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const r = canonicalRow(row);
    try {
      await sql`
        INSERT INTO waste_records
          (organisation_id, service_type, suburb, month, financial_year, department, tonnes, collections, contamination_rate, cost)
        VALUES (
          ${orgId}::uuid,
          ${str(r.service_type)},
          ${str(r.suburb)},
          ${str(r.month)},
          ${str(r.financial_year)},
          ${str(r.department)},
          ${num(r.tonnes)},
          ${num(r.collections)},
          ${num(r.contamination_rate)},
          ${num(r.cost)}
        )
      `;
      inserted++;
    } catch { /* skip malformed rows */ }
  }
  return inserted;
}

async function insertFleetMetrics(orgId: string, rows: Record<string, string>[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const r = canonicalRow(row);
    try {
      await sql`
        INSERT INTO fleet_metrics
          (organisation_id, vehicle_id, vehicle_type, make, year, department, driver,
           km, wages, fuel, maintenance, rego, repairs, insurance, depreciation,
           services, defects, downtime_hours, route_minutes, month, financial_year)
        VALUES (
          ${orgId}::uuid,
          ${str(r.vehicle_id)},
          ${str(r.vehicle_type)},
          ${str(r.make)},
          ${num(r.year)},
          ${str(r.department)},
          ${str(r.driver)},
          ${num(r.km)},
          ${num(r.wages)},
          ${num(r.fuel)},
          ${num(r.maintenance)},
          ${num(r.rego)},
          ${num(r.repairs)},
          ${num(r.insurance)},
          ${num(r.depreciation)},
          ${num(r.services)},
          ${num(r.defects)},
          ${num(r.downtime_hours)},
          ${num(r.route_minutes)},
          ${str(r.month)},
          ${str(r.financial_year)}
        )
      `;
      inserted++;
    } catch { /* skip malformed rows */ }
  }
  return inserted;
}

async function insertServiceRequests(orgId: string, rows: Record<string, string>[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const r = canonicalRow(row);
    try {
      await sql`
        INSERT INTO service_requests
          (organisation_id, request_id, service_type, suburb, month, financial_year,
           status, priority, days_open, cost)
        VALUES (
          ${orgId}::uuid,
          ${str(r.request_id)},
          ${str(r.service_type)},
          ${str(r.suburb)},
          ${str(r.month)},
          ${str(r.financial_year)},
          ${str(r.status)},
          ${str(r.priority)},
          ${num(r.days_open)},
          ${num(r.cost)}
        )
      `;
      inserted++;
    } catch { /* skip malformed rows */ }
  }
  return inserted;
}

export async function POST(req: NextRequest) {
  let orgId: string;
  try {
    const session = await getAuthSession();
    orgId = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log('[UPLOAD] orgId:', orgId);

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 }); }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

  const text = await file.text();
  const { headers: rawHeaders, rows: rawRows } = parseCSV(text);

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Could not parse CSV — ensure it has a header row.' }, { status: 400 });
  }

  const { headers, rows, dropped } = sanitiseColumns(rawHeaders, rawRows);

  if (dropped.length) {
    console.info('[trial/upload] stripped columns:', dropped.join(', '));
  }

  if (headers.length === 0) {
    return NextResponse.json({ error: 'No recognised operational columns found in this CSV.' }, { status: 400 });
  }

  // Detect target table and persist rows
  const table = detectTable(headers);

  let insertedCount = 0;
  try {
    if (table === 'fleet_metrics') {
      insertedCount = await insertFleetMetrics(orgId, rows);
    } else if (table === 'service_requests') {
      insertedCount = await insertServiceRequests(orgId, rows);
    } else {
      insertedCount = await insertWasteRecords(orgId, rows);
    }
    console.log(`[UPLOAD] inserted ${insertedCount} rows into ${table} for org ${orgId}`);
  } catch (err) {
    console.error('[UPLOAD] DB insert error:', err);
    // Non-fatal: still return briefing so UI doesn't break
  }

  // Generate Claude briefing from sanitised CSV
  const sample = rows.slice(0, 25);
  const prompt = `You are an operational intelligence analyst reviewing a CSV dataset for the first time.

File: ${file.name}
Total rows: ${rawRows.length}
Columns: ${headers.join(', ')}

Sample data (first ${sample.length} rows):
${JSON.stringify(sample, null, 2)}

Generate a JSON briefing that gives the user genuine, specific insights from this data:

{
  "dataType": "waste | fleet | service_requests | finance | hr | property | general",
  "summary": "2–3 sentence headline finding with specific numbers from the data. Name the most important pattern or outlier.",
  "findings": [
    "Specific finding 1 — include actual numbers/values from the data",
    "Specific finding 2 — include actual numbers/values from the data",
    "Specific finding 3 — include actual numbers/values from the data"
  ],
  "risks": [
    "One risk or anomaly found in the data — be specific"
  ],
  "recommendations": [
    "Concrete action 1 based on the data",
    "Concrete action 2 based on the data"
  ],
  "keyMetric": {
    "label": "The single most important metric column name",
    "value": "Its aggregate (total, average, or range)",
    "context": "Why this metric matters"
  },
  "suggestedQuestions": [
    "A question the user could ask HLNA about this data",
    "Another question",
    "Another question"
  ],
  "confidence": 0.6
}

Return valid JSON only.`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1200,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const briefing = JSON.parse(match[0]);
    return NextResponse.json({
      briefing,
      headers,
      rowCount: rows.length,
      fileName: file.name,
      table,
      insertedCount,
    });
  } catch (err) {
    console.error('[trial/upload]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
