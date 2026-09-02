import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import path from 'path';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string; fileId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { itemId, fileId } = await params;

  const rows = await sql`
    DELETE FROM organiser_item_files
    WHERE id = ${fileId} AND item_id = ${itemId} AND organisation_id = ${session.organisationId}
    RETURNING file_url
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const fileUrl = rows[0].file_url as string;
  const filepath = path.join(process.cwd(), 'public', fileUrl.replace(/^\//, ''));
  await unlink(filepath).catch(() => {});

  return NextResponse.json({ success: true });
}
