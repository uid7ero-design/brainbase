import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from '@/lib/organiser/authorize';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const color = typeof body.color === 'string' ? body.color : null;
  const position = typeof body.position === 'number' ? body.position : null;

  const rows = await sql`
    UPDATE organiser_groups SET
      name     = COALESCE(${name}, name),
      color    = COALESCE(${color}, color),
      position = COALESCE(${position}, position)
    WHERE id = ${groupId} AND organisation_id = ${session.organisationId}
    RETURNING id, name, color, position
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ group: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { groupId } = await params;

  const rows = await sql`
    DELETE FROM organiser_groups
    WHERE id = ${groupId} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
