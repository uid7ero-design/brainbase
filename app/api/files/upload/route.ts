import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

// ─── Column maps ──────────────────────────────────────────────────────────────

const WASTE_COLUMN_MAP: Record<string, string> = {
  department:           'department',
  service_type:         'service_type',
  'service type':       'service_type',
  service:              'service_type',
  stream:               'service_type',
  suburb:               'suburb',
  area:                 'suburb',
  locality:             'suburb',
  month:                'month',
  period:               'month',
  financial_year:       'financial_year',
  'financial year':     'financial_year',
  fy:                   'financial_year',
  year:                 'financial_year',
  tonnes:               'tonnes',
  tonnage:              'tonnes',
  weight:               'tonnes',
  collections:          'collections',
  'bin lifts':          'collections',
  services:             'collections',
  lifts:                'collections',
  contamination_rate:   'contamination_rate',
  'contamination rate': 'contamination_rate',
  contamination:        'contamination_rate',
  cost:                 'cost',
  costs:                'cost',
  amount:               'cost',
  total:                'cost',
};

const FLEET_COLUMN_MAP: Record<string, string> = {
  department:        'department',
  vehicle_id:        'vehicle_id',
  vehicle:           'vehicle_id',
  truck:             'vehicle_id',
  asset_id:          'vehicle_id',
  vehicle_type:      'vehicle_type',
  type:              'vehicle_type',
  make:              'make',
  model:             'make',
  year:              'year',
  driver:            'driver',
  operator:          'driver',
  month:             'month',
  period:            'month',
  financial_year:    'financial_year',
  'financial year':  'financial_year',
  fy:                'financial_year',
  km:                'km',
  distance:          'km',
  distance_km:       'km',
  kilometers:        'km',
  kilometres:        'km',
  fuel:              'fuel',
  fuel_cost:         'fuel',
  'fuel cost':       'fuel',
  maintenance:       'maintenance',
  maintenance_cost:  'maintenance',
  'maintenance cost':'maintenance',
  wages:             'wages',
  rego:              'rego',
  repairs:           'repairs',
  insurance:         'insurance',
  depreciation:      'depreciation',
  services:          'services',
  defects:           'defects',
  downtime_hours:    'downtime_hours',
  downtime:          'downtime_hours',
  'downtime hours':  'downtime_hours',
  route_minutes:     'route_minutes',
  route:             'route_minutes',
  'route minutes':   'route_minutes',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapRow(raw: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const mapped = map[normaliseKey(k)];
    if (mapped) out[mapped] = v;
  }
  return out;
}

/**
 * Detect department from CSV rows.
 * 1. Look for explicit 'department' column in first row.
 * 2. Auto-detect from column names if absent.
 * 3. Default to 'Waste'.
 */
function detectDepartment(rows: Record<string, unknown>[]): string {
  if (!rows.length) return 'Waste';
  const firstRow = rows[0];
  const normKeys = Object.keys(firstRow).map(k => ({ orig: k, norm: normaliseKey(k) }));

  // Explicit department column
  const deptKey = normKeys.find(k => k.norm === 'department');
  if (deptKey) {
    const val = String(firstRow[deptKey.orig] ?? '').trim();
    if (val) return val;
  }

  // Auto-detect by characteristic columns
  const cols = normKeys.map(k => k.norm);
  const isFleet = cols.some(c => ['vehicle_id', 'vehicle', 'truck', 'asset_id'].includes(c))
    || (cols.includes('fuel') && !cols.includes('contamination_rate'));
  if (isFleet) return 'Fleet';

  return 'Waste';
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/files/upload
 * Accepts multipart/form-data with a single `file` field (xlsx, xls, or csv).
 * Auto-detects department from a 'department' CSV column (or column heuristics).
 * Routes: Waste → waste_records  |  Fleet → fleet_metrics
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }

  const fileName = file.name;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload an Excel (.xlsx, .xls) or CSV file.' },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Spreadsheet is empty.' }, { status: 422 });
  }

  // Detect department before inserting file record
  const department = detectDepartment(rawRows);
  const serviceType = department.toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');

  // Insert file record
  const fileRows = await sql`
    INSERT INTO uploaded_files (organisation_id, uploaded_by, file_name, file_type, upload_status, service_type)
    VALUES (${session.organisationId}, ${session.userId}, ${fileName}, ${ext}, 'processing', ${serviceType})
    RETURNING id
  `;
  const fileId = fileRows[0].id as string;

  try {
    if (department === 'Fleet') {
      await insertFleetRecords(rawRows, fileId, session.organisationId);
    } else {
      await insertWasteRecords(rawRows, fileId, session.organisationId, department);
    }

    await sql`UPDATE uploaded_files SET upload_status = 'complete' WHERE id = ${fileId}`;

    return NextResponse.json({
      success: true,
      fileId,
      fileName,
      department,
      recordsInserted: rawRows.length,
    });
  } catch (err) {
    await sql`UPDATE uploaded_files SET upload_status = 'error' WHERE id = ${fileId}`;
    console.error('[upload] parse error:', err);
    return NextResponse.json({ error: 'Failed to parse spreadsheet.' }, { status: 500 });
  }
}

// ─── Waste insert ─────────────────────────────────────────────────────────────

async function insertWasteRecords(
  rawRows: Record<string, unknown>[],
  fileId: string,
  orgId: string,
  department: string,
) {
  for (const raw of rawRows) {
    const rec = mapRow(raw, WASTE_COLUMN_MAP);
    await sql`
      INSERT INTO waste_records (
        organisation_id, uploaded_file_id, department,
        service_type, suburb, month, financial_year,
        tonnes, collections, contamination_rate, cost
      ) VALUES (
        ${orgId}, ${fileId}, ${(rec.department as string) ?? department},
        ${(rec.service_type as string) ?? null},
        ${(rec.suburb as string) ?? null},
        ${(rec.month as string) ?? null},
        ${(rec.financial_year as string) ?? null},
        ${rec.tonnes != null ? Number(rec.tonnes) : null},
        ${rec.collections != null ? Math.round(Number(rec.collections)) : null},
        ${rec.contamination_rate != null ? Number(rec.contamination_rate) : null},
        ${rec.cost != null ? Number(rec.cost) : null}
      )
    `;
  }
}

// ─── Fleet insert ─────────────────────────────────────────────────────────────

async function insertFleetRecords(
  rawRows: Record<string, unknown>[],
  fileId: string,
  orgId: string,
) {
  for (const raw of rawRows) {
    const rec = mapRow(raw, FLEET_COLUMN_MAP);
    await sql`
      INSERT INTO fleet_metrics (
        organisation_id, uploaded_file_id,
        vehicle_id, vehicle_type, make, year, department, driver,
        km, wages, fuel, maintenance, rego, repairs, insurance, depreciation,
        services, defects, downtime_hours, route_minutes,
        month, financial_year
      ) VALUES (
        ${orgId}, ${fileId},
        ${(rec.vehicle_id as string) ?? null},
        ${(rec.vehicle_type as string) ?? null},
        ${(rec.make as string) ?? null},
        ${rec.year != null ? Math.round(Number(rec.year)) : null},
        ${(rec.department as string) ?? 'Fleet'},
        ${(rec.driver as string) ?? null},
        ${rec.km != null ? Number(rec.km) : null},
        ${rec.wages != null ? Number(rec.wages) : null},
        ${rec.fuel != null ? Number(rec.fuel) : null},
        ${rec.maintenance != null ? Number(rec.maintenance) : null},
        ${rec.rego != null ? Number(rec.rego) : null},
        ${rec.repairs != null ? Number(rec.repairs) : null},
        ${rec.insurance != null ? Number(rec.insurance) : null},
        ${rec.depreciation != null ? Number(rec.depreciation) : null},
        ${rec.services != null ? Math.round(Number(rec.services)) : null},
        ${rec.defects != null ? Math.round(Number(rec.defects)) : null},
        ${rec.downtime_hours != null ? Number(rec.downtime_hours) : null},
        ${rec.route_minutes != null ? Number(rec.route_minutes) : null},
        ${(rec.month as string) ?? null},
        ${(rec.financial_year as string) ?? null}
      )
    `;
  }
}
