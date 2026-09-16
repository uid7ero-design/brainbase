import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventSessionInput, toIsoString, type EventSessionInput } from '@/lib/events/validation';
import { logEventSessionUpdated, logEventSessionDeleted } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, sessionId } = await params;

  const existingRows = await sql`
    SELECT * FROM event_sessions
    WHERE id = ${sessionId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!existingRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const existing = existingRows[0];

  let body: Partial<EventSessionInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const merged: EventSessionInput = {
    name: body.name ?? existing.name,
    starts_at: body.starts_at ?? toIsoString(existing.starts_at),
    ends_at: body.ends_at ?? toIsoString(existing.ends_at),
    capacity: body.capacity ?? existing.capacity,
  };
  const error = validateEventSessionInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const rows = await sql`
    UPDATE event_sessions SET
      name = ${merged.name as string}, starts_at = ${merged.starts_at as string},
      ends_at = ${merged.ends_at as string}, capacity = ${merged.capacity as number}, updated_at = now()
    WHERE id = ${sessionId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const updated = rows[0] as Record<string, unknown>;
  await logEventSessionUpdated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, sessionId,
    before: existing as never, after: updated as never,
  });
  return NextResponse.json({ event_session: updated });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, sessionId } = await params;

  const rows = await sql`
    DELETE FROM event_sessions
    WHERE id = ${sessionId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING id, name, starts_at, ends_at, capacity
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  await logEventSessionDeleted({
    organisationId: session.organisationId, userId: session.userId, eventId: id, sessionId,
    before: rows[0] as never,
  });
  return NextResponse.json({ success: true });
}
