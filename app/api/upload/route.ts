import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { requireRole, unauthorized } from '@/lib/org';

type ServiceType = 'waste' | 'fleet' | 'service_requests';

// ─── Column maps ─────────────────────────────────────────────────────────────

const WASTE_MAP: Record<string, string> = {
  service_type: 'service_type', 'service type': 'service_type', service: 'service_type', stream: 'service_type',
  suburb: 'suburb', area: 'suburb', locality: 'suburb', zone: 'suburb',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year', year: 'financial_year',
  tonnes: 'tonnes', tonnage: 'tonnes', weight: 'tonnes',
  collections: 'collections', 'bin lifts': 'collections', lifts: 'collections',
  contamination_rate: 'contamination_rate', 'contamination rate': 'contamination_rate', contamination: 'contamination_rate',
  cost: 'cost', costs: 'cost', amount: 'cost', total: 'cost',
};

const FLEET_MAP: Record<string, string> = {
  asset: 'vehicle_id', id: 'vehicle_id', vehicle: 'vehicle_id', 'vehicle id': 'vehicle_id',
  type: 'vehicle_type', 'vehicle type': 'vehicle_type',
  make: 'make',
  year: 'year',
  department: 'department', dept: 'department',
  driver: 'driver',
  km: 'km', kilometres: 'km', kms: 'km', odometer: 'km',
  wages: 'wages',
  fuel: 'fuel',
  maintenance: 'maintenance', maint: 'maintenance',
  rego: 'rego', 'registration cost': 'rego',
  repairs: 'repairs',
  insurance: 'insurance', ins: 'insurance',
  depreciation: 'depreciation', depr: 'depreciation',
  services: 'services',
  defects: 'defects',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year',
};

const SR_MAP: Record<string, string> = {
  'request id': 'request_id', request_id: 'request_id', 'sr id': 'request_id', reference: 'request_id',
  'service type': 'service_type', service_type: 'service_type', type: 'service_type', category: 'service_type',
  suburb: 'suburb', area: 'suburb', locality: 'suburb',
  month: 'month', period: 'month',
  financial_year: 'financial_year', 'financial year': 'financial_year', fy: 'financial_year',
  status: 'status', state: 'status',
  priority: 'priority', urgency: 'priority',
  'days open': 'days_open', days: 'days_open', duration: 'days_open', days_open: 'days_open',
  cost: 'cost', costs: 'cost', amount: 'cost',
};

const MAPS: Record<ServiceType, Record<string, string>> = {
  waste: WASTE_MAP,
  fleet: FLEET_MAP,
  service_requests: SR_MAP,
};

function normalise(k: string) { return k.trim().toLowerCase().replace(/\s+/g, ' '); }

function mapRow(raw: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = map[normalise(k)];
    if (field) out[field] = v;
  }
  return out;
}

// ─── Insert helpers ──────────────────────────────────────────────────────────

async function insertWaste(records: Record<string, unknown>[], orgId: string, fileId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO waste_records
        (organisation_id, uploaded_file_id, service_type, suburb, month, financial_year,
         tonnes, collections, contamination_rate, cost)
      VALUES (
        ${orgId}, ${fileId},
        ${(r.service_type as string) ?? null},
        ${(r.suburb as string) ?? null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null},
        ${r.tonnes != null ? Number(r.tonnes) : null},
        ${r.collections != null ? Math.round(Number(r.collections)) : null},
        ${r.contamination_rate != null ? Number(r.contamination_rate) : null},
        ${r.cost != null ? Number(r.cost) : null}
      )
    `;
  }
}

async function insertFleet(records: Record<string, unknown>[], orgId: string, fileId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO fleet_metrics
        (organisation_id, uploaded_file_id, vehicle_id, vehicle_type, make, year,
         department, driver, km, wages, fuel, maintenance, rego, repairs, insurance,
         depreciation, services, defects, month, financial_year)
      VALUES (
        ${orgId}, ${fileId},
        ${(r.vehicle_id as string) ?? null},
        ${(r.vehicle_type as string) ?? null},
        ${(r.make as string) ?? null},
        ${r.year != null ? Math.round(Number(r.year)) : null},
        ${(r.department as string) ?? null},
        ${(r.driver as string) ?? null},
        ${r.km != null ? Number(r.km) : null},
        ${r.wages != null ? Number(r.wages) : null},
        ${r.fuel != null ? Number(r.fuel) : null},
        ${r.maintenance != null ? Number(r.maintenance) : null},
        ${r.rego != null ? Number(r.rego) : null},
        ${r.repairs != null ? Number(r.repairs) : null},
        ${r.insurance != null ? Number(r.insurance) : null},
        ${r.depreciation != null ? Number(r.depreciation) : null},
        ${r.services != null ? Math.round(Number(r.services)) : null},
        ${r.defects != null ? Math.round(Number(r.defects)) : null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null}
      )
    `;
  }
}

async function insertServiceRequests(records: Record<string, unknown>[], orgId: string, fileId: string) {
  for (const r of records) {
    await sql`
      INSERT INTO service_requests
        (organisation_id, uploaded_file_id, request_id, service_type, suburb, month,
         financial_year, status, priority, days_open, cost)
      VALUES (
        ${orgId}, ${fileId},
        ${(r.request_id as string) ?? null},
        ${(r.service_type as string) ?? null},
        ${(r.suburb as string) ?? null},
        ${(r.month as string) ?? null},
        ${(r.financial_year as string) ?? null},
        ${(r.status as string) ?? null},
        ${(r.priority as string) ?? null},
        ${r.days_open != null ? Math.round(Number(r.days_open)) : null},
        ${r.cost != null ? Number(r.cost) : null}
      )
    `;
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Accepts multipart/form-data with:
 *   file        — .xlsx, .xls, or .csv
 *   serviceType — 'waste' | 'fleet' | 'service_requests'  (defaults to 'waste')
 *
 * Parses the first sheet, maps columns dynamically, and inserts into the
 * correct table scoped to the caller's organisation.
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireRole('manager'); } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'Forbidden') return Response.json({ error: 'Forbidden' }, { status: 403 });
    return unauthorized();
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 }); }

  const file = formData.get('file');
  if (!(file instanceof File))
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

  const rawType = (formData.get('serviceType') as string | null) ?? 'waste';
  const serviceType: ServiceType = (['waste', 'fleet', 'service_requests'] as const).includes(rawType as ServiceType)
    ? rawType as ServiceType
    : 'waste';

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: 'File exceeds 10 MB limit.' }, { status: 413 });

  const fileName = file.name;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!['xlsx', 'xls', 'csv'].includes(ext))
    return NextResponse.json({ error: 'Upload an Excel (.xlsx/.xls) or CSV file.' }, { status: 400 });

  const fileRows = await sql`
    INSERT INTO uploaded_files
      (organisation_id, uploaded_by, file_name, file_type, service_type, upload_status)
    VALUES
      (${session.organisationId}, ${session.userId}, ${fileName}, ${ext}, ${serviceType}, 'processing')
    RETURNING id
  `;
  const fileId: string = fileRows[0].id;

  try {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName], { defval: null }
    );

    if (rows.length === 0) {
      await sql`UPDATE uploaded_files SET upload_status = 'error' WHERE id = ${fileId}`;
      return NextResponse.json({ error: 'Spreadsheet is empty.' }, { status: 422 });
    }

    const map = MAPS[serviceType];
    const records = rows.map(r => mapRow(r, map));

    if (serviceType === 'waste')             await insertWaste(records, session.organisationId, fileId);
    else if (serviceType === 'fleet')        await insertFleet(records, session.organisationId, fileId);
    else if (serviceType === 'service_requests') await insertServiceRequests(records, session.organisationId, fileId);

    await sql`UPDATE uploaded_files SET upload_status = 'complete' WHERE id = ${fileId}`;

    return NextResponse.json({ success: true, fileId, fileName, serviceType, recordsInserted: records.length });
  } catch (err) {
    await sql`UPDATE uploaded_files SET upload_status = 'error' WHERE id = ${fileId}`;
    console.error('[/api/upload]', err);
    return NextResponse.json({ error: 'Failed to parse or store the file.' }, { status: 500 });
  }
}
