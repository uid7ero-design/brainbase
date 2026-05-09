import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';
import { prisma } from '@/lib/prisma';
import type { BinType, Severity, MaintenanceStatus } from '@prisma/client';

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

const BIN_MAINTENANCE_COLUMN_MAP: Record<string, string> = {
  // suburb
  suburb:              'suburb',
  suburbname:          'suburb',
  'site suburb':       'suburb',
  sitesuburb:          'suburb',
  locality:            'suburb',
  area:                'suburb',
  town:                'suburb',
  city:                'suburb',
  // address (street name / full address)
  address:             'address',
  'street address':    'address',
  streetaddress:       'address',
  propertyaddress:     'address',
  'site address':      'address',
  siteaddress:         'address',
  location:            'address',
  sitename:            'address',
  site:                'address',
  streetno:            'address',
  propertyno:          'address',
  // street number — kept separate so we can combine with address
  'street number':     'street_number',
  streetnumber:        'street_number',
  'street no':         'street_number',
  streetno2:           'street_number',
  houseno:             'street_number',
  housenumber:         'street_number',
  // bin type
  'bin type':          'bin_type',
  bin_type:            'bin_type',
  bintype:             'bin_type',
  bincolour:           'bin_type',
  bincolor:            'bin_type',
  binsize:             'bin_type',
  container:           'bin_type',
  containertype:       'bin_type',
  'waste stream':      'bin_type',
  wastestream:         'bin_type',
  stream:              'bin_type',
  // issue type
  'issue type':        'issue_type',
  issue_type:          'issue_type',
  issuetype:           'issue_type',
  issue:               'issue_type',
  'issue description': 'issue_type',
  issuedescription:    'issue_type',
  issuedetail:         'issue_type',
  'fault type':        'issue_type',
  fault_type:          'issue_type',
  faulttype:           'issue_type',
  fault:               'issue_type',
  'fault description': 'issue_type',
  faultdescription:    'issue_type',
  defect:              'issue_type',
  defecttype:          'issue_type',
  problem:             'issue_type',
  problemtype:         'issue_type',
  complaint:           'issue_type',
  complainttype:       'issue_type',
  description:         'issue_type',
  'job type':          'issue_type',
  jobtype:             'issue_type',
  'service fault':     'issue_type',
  servicefault:        'issue_type',
  maintenancetype:     'issue_type',
  repairtype:          'issue_type',
  category:            'issue_type',
  'service category':  'issue_type',
  servicecategory:     'issue_type',
  'request type':      'issue_type',
  requesttype:         'issue_type',
  'service type':      'issue_type',
  servicetype:         'issue_type',
  // severity
  severity:            'severity',
  priority:            'severity',
  urgency:             'severity',
  'job priority':      'severity',
  jobpriority:         'severity',
  // status
  status:              'status',
  state:               'status',
  'job status':        'status',
  jobstatus:           'status',
  // assigned to
  'assigned to':       'assigned_to',
  assigned_to:         'assigned_to',
  assignedto:          'assigned_to',
  assignee:            'assigned_to',
  technician:          'assigned_to',
  operator:            'assigned_to',
  crew:                'assigned_to',
  worker:              'assigned_to',
  officer:             'assigned_to',
  inspector:           'assigned_to',
  // scheduled date
  'scheduled date':    'scheduled_date',
  scheduled_date:      'scheduled_date',
  scheduleddate:       'scheduled_date',
  'due date':          'scheduled_date',
  duedate:             'scheduled_date',
  'target date':       'scheduled_date',
  targetdate:          'scheduled_date',
  // notes
  notes:               'notes',
  comments:            'notes',
  remarks:             'notes',
  'additional notes':  'notes',
  additionalnotes:     'notes',
  detail:              'notes',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// For column mapping — preserves spaces so "issue type" matches the map key "issue type"
function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

// For detection only — strips ALL non-alpha chars so "Issue Type" = "issue_type" = "issuetype"
function normDetect(k: string): string {
  return k.toLowerCase().replace(/[^a-z]/g, '');
}

function mapRow(raw: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk  = normaliseKey(k);
    const nkd = normDetect(k);
    const mapped = map[nk] ?? map[nkd];
    // First non-empty write wins — don't overwrite a good value with N/A or empty
    if (mapped && !(mapped in out)) out[mapped] = v;
  }
  return out;
}

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
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellDates: true });
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
  type JobData = {
    organisation_id: string; suburb: string; address: string;
    bin_type: BinType; issue_type: string; severity: Severity;
    status: MaintenanceStatus; assigned_to: string | null;
    scheduled_date: Date | null; completed_date: null; notes: string | null;
  };

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

  const records: JobData[] = [];
  let noSuburb = 0, noAddress = 0, noIssue = 0;

  for (const raw of rawRows) {
    const rec = mapRow(raw, BIN_MAINTENANCE_COLUMN_MAP);

    const suburb    = strVal(rec.suburb);
    // Combine "Street Number" + "Site Address" (or similar) into a full address
    const streetName = strVal(rec.address);
    const streetNum  = strVal(rec.street_number);
    const address    = streetNum && streetName ? `${streetNum} ${streetName}` : (streetName || streetNum);
    const issueType  = strVal(rec.issue_type) || strVal(rec.description) || strVal(rec.fault) || strVal(rec.defect);

    if (!suburb || !address || !issueType) {
      if (!suburb)    noSuburb++;
      if (!address)   noAddress++;
      if (!issueType) noIssue++;
      continue;
    }

    records.push({
      organisation_id: orgId,
      suburb,
      address,
      bin_type:       normBinType(strVal(rec.bin_type)),
      issue_type:     issueType,
      severity:       normSeverity(strVal(rec.severity) || strVal(rec.priority)),
      status:         normStatus(strVal(rec.status) || strVal(rec.state)),
      assigned_to:    strVal(rec.assigned_to) ?? null,
      scheduled_date: normDate(rec.scheduled_date),
      completed_date: null,
      notes:          strVal(rec.notes) ?? null,
    });
  }

  console.log(`[bin-maintenance] rejected rows — no suburb: ${noSuburb}, no address: ${noAddress}, no issue_type: ${noIssue}`);
  console.log(`[bin-maintenance] valid rows ready for createMany: ${records.length}`);

  if (records.length === 0) return 0;

  const result = await prisma.binMaintenanceJob.createMany({ data: records, skipDuplicates: false });
  console.log(`[bin-maintenance upload] inserted ${result.count} of ${rawRows.length} rows for org ${orgId}`);
  return result.count;
}

function strVal(v: unknown): string {
  const s = v != null ? String(v).trim() : '';
  return s;
}

function normBinType(s: string): BinType {
  const l = s.toLowerCase().replace(/[\s_-]/g, '');
  if (l.includes('recycl') || l === 'yellow') return 'RECYCLING';
  if (l.includes('organic') || l.includes('green') || l === 'fogo') return 'ORGANICS';
  if (l.includes('bulk') || l.includes('hard'))  return 'BULK_WASTE';
  return 'GENERAL_WASTE';
}

function normSeverity(s: string): Severity {
  const l = s.toLowerCase();
  if (l === 'critical' || l === 'urgent') return 'CRITICAL';
  if (l === 'high')                       return 'HIGH';
  if (l === 'low' || l === 'minor')       return 'LOW';
  return 'MEDIUM';
}

function normStatus(s: string): MaintenanceStatus {
  const l = s.toLowerCase().replace(/[\s_-]/g, '');
  if (l.startsWith('completed') || l === 'complete' || l === 'done' || l === 'resolved') return 'COMPLETED';
  if (l === 'closed' || l.startsWith('closed'))     return 'CLOSED';
  if (l === 'inprogress' || l === 'active')         return 'IN_PROGRESS';
  if (l === 'assigned')                             return 'ASSIGNED';
  if (l === 'scheduled')                            return 'SCHEDULED';
  if (l === 'escalated')                            return 'ESCALATED';
  return 'OPEN';
}

function normDate(v: unknown): Date | null {
  if (!v) return null;
  // Already a Date object (XLSX cellDates: true)
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // Excel serial number (days since 1900-01-01 with 1900 leap-year bug offset)
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
