import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  await sql`DELETE FROM crm_activities WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
