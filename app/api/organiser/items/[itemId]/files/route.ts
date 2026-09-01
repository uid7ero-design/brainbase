import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function GET(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const files = await sql`
    SELECT id, file_name, file_url, file_size, created_at
    FROM organiser_item_files
    WHERE item_id = ${itemId} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ files });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId } = await params;
  const itemRows = await sql`
    SELECT id, board_id FROM organiser_items WHERE id = ${itemId} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (itemRows.length === 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  const boardId = itemRows[0].board_id as string;

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 15 MB).' }, { status: 400 });

  const dir = path.join(process.cwd(), 'public', 'organiser-attachments', itemId);
  await mkdir(dir, { recursive: true });

  const safeName = file.name.replace(/[^\w.\- ]/g, '_');
  const storedName = `${randomUUID()}-${safeName}`;
  const filepath = path.join(dir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const fileUrl = `/organiser-attachments/${itemId}/${storedName}`;

  const rows = await sql`
    INSERT INTO organiser_item_files (item_id, board_id, organisation_id, file_name, file_url, file_size, uploaded_by)
    VALUES (${itemId}, ${boardId}, ${session.organisationId}, ${file.name}, ${fileUrl}, ${file.size}, ${session.userId})
    RETURNING id, file_name, file_url, file_size, created_at
  `;

  return NextResponse.json({ file: rows[0] });
}
