import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

/** PATCH /api/integrations/[id] — update name / config / enabled / schedule */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { name, config, enabled, schedule } = body;
  const { id } = await params;

  // Only update provided fields
  const existing = await sql`
    SELECT * FROM integrations WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `;
  if (!existing.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const rows = await sql`
    UPDATE integrations SET
      name     = ${name     ?? existing[0].name},
      config   = ${config   ? JSON.stringify(config) : existing[0].config},
      enabled  = ${enabled  ?? existing[0].enabled},
      schedule = ${schedule ?? existing[0].schedule}
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  return NextResponse.json({ integration: rows[0] });
}

/** DELETE /api/integrations/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { id } = await params;
  await sql`
    DELETE FROM integrations
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `;
  return NextResponse.json({ success: true });
}
