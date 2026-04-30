import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const serviceType = (formData.get('serviceType') as string) || 'waste';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const fileName = file.name;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    return NextResponse.json({ error: 'Only CSV and XLSX files are supported' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  let headers: string[] = [];
  let rows: string[][] = [];

  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });

    headers = (raw[0] ?? []).map(h => String(h).trim()).filter(Boolean);
    rows = raw.slice(1, 6).map(row =>
      headers.map((_, i) => String(row[i] ?? ''))
    );
  } catch {
    return NextResponse.json({ error: 'Could not parse file. Ensure it is a valid CSV or XLSX.' }, { status: 422 });
  }

  const [record] = await sql`
    INSERT INTO uploaded_files
      (organisation_id, uploaded_by, file_name, file_url, file_type, service_type, upload_status)
    VALUES
      (${session.organisationId}, ${session.userId}, ${fileName}, '', ${ext}, ${serviceType}, 'complete')
    RETURNING id
  `;

  return NextResponse.json({ fileId: record.id, fileName, headers, rows });
}
