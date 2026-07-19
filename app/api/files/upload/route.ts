import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';
import { prisma } from '@/lib/prisma';
import { mapRow, normaliseKey, normDetect, mapBinMaintenanceRow, BIN_MAINTENANCE_COLUMN_MAP } from '@/modules/bin-maintenance/csvImport';
import type { BinMaintenanceRecordInput } from '@/modules/bin-maintenance/csvImport';

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
// (BIN_MAINTENANCE_COLUMN_MAP, mapRow, normaliseKey, normDetect are imported
// from modules/bin-maintenance/csvImport — shared with the one-off rebuild script.)

/**
 * Detect department from CSV rows.
 * 1. Look for explicit 'department' column in first row.
 * 2. Auto-detect from column names — BinMaintenance checked before Waste/Fleet.
 * 3. Default to 'Waste'.
 */
function detectDepartment(rows: Record<string, unknown>[]): string {
  if (!rows.length) return 'Waste';
  const firstRow = rows[0];
  const rawCols  = Object.keys(firstRow);

  // Log actual headers for diagnostics
  console.log('[upload] raw headers:', rawCols);

  // Both a space-preserved normalised form and a fully-stripped form for each column
  const colsNorm    = rawCols.map(normaliseKey);   // "Issue Type" → "issue type"
  const colsStripped = rawCols.map(normDetect);    // "Issue Type" → "issuetype"

  const has = (terms: string[]): boolean =>
    terms.some(t => colsNorm.includes(t) || colsStripped.includes(t));

  const hasContaining = (substrings: string[]): boolean =>
    colsStripped.some(c => substrings.some(s => c.includes(s)));

  // Explicit department column wins
  const deptKey = rawCols.find(k => normDetect(k) === 'department');
  if (deptKey) {
    const val = String(firstRow[deptKey] ?? '').trim();
    if (val) {
      console.log('[upload] explicit department column:', val);
      return val;
    }
  }

  // ── BIN MAINTENANCE ────────────────────────────────────────────────────────
  // Needs: a suburb indicator + an address indicator + an issue/bin indicator
  const hasSuburb =
    has(['suburb', 'locality', 'suburbname', 'suburbtown']) ||
    hasContaining(['suburb', 'locality', 'postcode']);

  const hasAddress =
    has(['address', 'streetaddress', 'propertyaddress', 'streetno', 'sitename']) ||
    hasContaining(['address', 'streetno', 'propertyno', 'sitename']);

  const hasIssueBin =
    has([
      'issuetype', 'issue', 'issuedetail', 'issuedescription',
      'faulttype', 'fault', 'faultdescription',
      'defect', 'defecttype',
      'problemtype', 'problem',
      'complaint', 'complainttype',
      'bintype', 'bincolour', 'binsize', 'containertype', 'wastetype',
      'jobtype', 'servicefault', 'maintenancetype', 'repairtype',
    ]) ||
    hasContaining(['issue', 'fault', 'defect', 'bintype', 'complaint']);

  console.log('[upload] bin maintenance signals — suburb:', hasSuburb, 'address:', hasAddress, 'issue/bin:', hasIssueBin);

  if (hasSuburb && hasAddress && hasIssueBin) {
    console.log('[upload] → BinMaintenance');
    return 'BinMaintenance';
  }

  // ── FLEET ──────────────────────────────────────────────────────────────────
  const isFleet =
    has(['vehicleid', 'vehicle', 'truck', 'assetid', 'fleetno']) ||
    (has(['fuel']) && !has(['contaminationrate', 'contamination']));
  if (isFleet) {
    console.log('[upload] → Fleet');
    return 'Fleet';
  }

  console.log('[upload] → Waste (default)');
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
  // cellDates only for real Excel files — for CSV, xlsx's own type inference
  // pre-converts ambiguous date-like strings (day <= 12) to Date objects using
  // US M/D/Y order, silently bypassing our D/M/Y-aware normDate. CSV cells stay
  // raw strings so normDate is the single source of date parsing.
  const isCsv = ext === 'csv';
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellDates: !isCsv, raw: isCsv });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: isCsv });

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
    let recordsInserted = rawRows.length;
    if (department === 'BinMaintenance') {
      recordsInserted = await insertBinMaintenanceRecords(rawRows, session.organisationId);
    } else if (department === 'Fleet') {
      await insertFleetRecords(rawRows, fileId, session.organisationId);
    } else {
      await insertWasteRecords(rawRows, fileId, session.organisationId, department);
    }

    await sql`UPDATE uploaded_files SET upload_status = 'complete' WHERE id = ${fileId}`;

    return NextResponse.json({
      success:         true,
      fileId,
      fileName,
      department,
      recordsInserted,
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

// ─── Bin Maintenance insert ───────────────────────────────────────────────────

async function insertBinMaintenanceRecords(
  rawRows: Record<string, unknown>[],
  orgId: string,
): Promise<number> {
  // ── Diagnostics ────────────────────────────────────────────────────────────
  console.log(`[bin-maintenance] raw row count: ${rawRows.length}`);
  if (rawRows.length > 0) {
    const firstRaw = rawRows[0];
    console.log('[bin-maintenance] raw column names:', Object.keys(firstRaw));
    console.log('[bin-maintenance] first raw row values:', JSON.stringify(firstRaw));
    const firstMapped = mapRow(firstRaw, BIN_MAINTENANCE_COLUMN_MAP);
    console.log('[bin-maintenance] first row after mapRow:', JSON.stringify(firstMapped));
    // Show what each key normalises to for the first row
    const keyForms = Object.keys(firstRaw).map(k => ({ raw: k, norm: normaliseKey(k), stripped: normDetect(k), mapsTo: BIN_MAINTENANCE_COLUMN_MAP[normaliseKey(k)] ?? BIN_MAINTENANCE_COLUMN_MAP[normDetect(k)] ?? '(unmapped)' }));
    console.log('[bin-maintenance] column mapping trace:', JSON.stringify(keyForms));
  }

  const records: BinMaintenanceRecordInput[] = [];
  const rejected = { no_suburb: 0, no_address: 0, no_issue_type: 0 };

  for (const raw of rawRows) {
    const result = mapBinMaintenanceRow(raw);
    if (!result.ok) { rejected[result.reason]++; continue; }
    records.push(result.record);
  }

  console.log(`[bin-maintenance] rejected rows —`, rejected);
  console.log(`[bin-maintenance] valid rows ready for upsert: ${records.length}`);

  if (records.length === 0) return 0;

  const withTicket    = records.filter(r => !!r.ticket_number);
  const withoutTicket = records.filter(r => !r.ticket_number);

  // Upsert by (organisation_id, ticket_number) so re-uploading an updated
  // spreadsheet updates existing tickets' status/dates instead of duplicating them.
  let upsertCount = 0;
  const CHUNK = 200;
  for (let i = 0; i < withTicket.length; i += CHUNK) {
    const chunk = withTicket.slice(i, i + CHUNK);
    await prisma.$transaction(chunk.map(r => prisma.binMaintenanceJob.upsert({
      where: { organisation_id_ticket_number: { organisation_id: orgId, ticket_number: r.ticket_number! } },
      create: { organisation_id: orgId, ...r },
      update: {
        suburb: r.suburb, address: r.address, bin_type: r.bin_type, issue_type: r.issue_type,
        severity: r.severity, status: r.status, assigned_to: r.assigned_to,
        scheduled_date: r.scheduled_date, completed_date: r.completed_date, notes: r.notes,
      },
    })));
    upsertCount += chunk.length;
  }

  let createdCount = 0;
  if (withoutTicket.length > 0) {
    const result = await prisma.binMaintenanceJob.createMany({
      data: withoutTicket.map(r => ({ organisation_id: orgId, ...r })),
      skipDuplicates: false,
    });
    createdCount = result.count;
  }

  const total = upsertCount + createdCount;
  console.log(`[bin-maintenance upload] upserted ${upsertCount} (by ticket) + created ${createdCount} (no ticket) = ${total} of ${rawRows.length} rows for org ${orgId}`);
  return total;
}
