import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

// Column aliases → waste_record field names
const COLUMN_MAP: Record<string, string> = {
  service_type:       'service_type',
  'service type':     'service_type',
  service:            'service_type',
  stream:             'service_type',
  suburb:             'suburb',
  area:               'suburb',
  locality:           'suburb',
  month:              'month',
  period:             'month',
  financial_year:     'financial_year',
  'financial year':   'financial_year',
  fy:                 'financial_year',
  year:               'financial_year',
  tonnes:             'tonnes',
  tonnage:            'tonnes',
  weight:             'tonnes',
  collections:        'collections',
  'bin lifts':        'collections',
  services:           'collections',
  lifts:              'collections',
  contamination_rate: 'contamination_rate',
  'contamination rate': 'contamination_rate',
  contamination:      'contamination_rate',
  cost:               'cost',
  costs:              'cost',
  amount:             'cost',
  total:              'cost',
};

function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const mapped = COLUMN_MAP[normaliseKey(k)];
    if (mapped) out[mapped] = v;
  }
  return out;
}

/**
 * POST /api/files/upload
 * Accepts multipart/form-data with a single `file` field (xlsx, xls, or csv).
 * Parses the spreadsheet, saves metadata to uploaded_files, and inserts
 * waste_records — all scoped to the caller's organisation.
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

  // Insert file record with status 'processing'
  const fileRows = await sql`
    INSERT INTO uploaded_files (organisation_id, uploaded_by, file_name, file_type, upload_status)
    VALUES (${session.organisationId}, ${session.userId}, ${fileName}, ${ext}, 'processing')
    RETURNING id
  `;
  const fileId = fileRows[0].id;

  try {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    if (rows.length === 0) {
      await sql`UPDATE uploaded_files SET upload_status = 'error' WHERE id = ${fileId}`;
      return NextResponse.json({ error: 'Spreadsheet is empty.' }, { status: 422 });
    }

    const records = rows.map(r => mapRow(r));

    // Batch insert waste_records
    for (const rec of records) {
      await sql`
        INSERT INTO waste_records (
          organisation_id,
          uploaded_file_id,
          service_type,
          suburb,
          month,
          financial_year,
          tonnes,
          collections,
          contamination_rate,
          cost
        ) VALUES (
          ${session.organisationId},
          ${fileId},
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

    await sql`
      UPDATE uploaded_files SET upload_status = 'complete' WHERE id = ${fileId}
    `;

    return NextResponse.json({
      success: true,
      fileId,
      fileName,
      recordsInserted: records.length,
    });
  } catch (err) {
    await sql`UPDATE uploaded_files SET upload_status = 'error' WHERE id = ${fileId}`;
    console.error('[upload] parse error:', err);
    return NextResponse.json({ error: 'Failed to parse spreadsheet.' }, { status: 500 });
  }
}
