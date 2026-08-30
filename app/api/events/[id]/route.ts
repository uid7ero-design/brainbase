import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventInput, toIsoString, mergeField, type EventInput } from '@/lib/events/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const rows = await sql`
    SELECT * FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [event_sessions, ticket_types] = await Promise.all([
    sql`SELECT * FROM event_sessions WHERE event_id = ${id} AND organisation_id = ${session.organisationId} ORDER BY starts_at`,
    sql`SELECT * FROM event_ticket_types WHERE event_id = ${id} AND organisation_id = ${session.organisationId} ORDER BY sort_order, created_at`,
  ]);

  return NextResponse.json({ event: rows[0], event_sessions, ticket_types });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const existingRows = await sql`
    SELECT * FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!existingRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const existing = existingRows[0];

  let body: Partial<EventInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // Validate the merged (existing + patch) shape — a partial PATCH must
  // never be able to leave the row in a state a POST couldn't have
  // created (e.g. ends_at before starts_at via a one-field patch).
  //
  // Merged by property presence (mergeField), not `??` — an omitted key
  // preserves the existing value, but an explicit `null` for an optional
  // field (description/venue) must actually clear it rather than being
  // silently discarded. A `null` sent for a required field (name/slug/
  // timezone/status/starts_at/ends_at) is not specially rejected here;
  // it flows into validateEventInput() below, which already rejects it.
  const merged: EventInput = {
    name: mergeField(body, 'name', existing.name),
    slug: mergeField(body, 'slug', existing.slug),
    description: mergeField(body, 'description', existing.description),
    venue: mergeField(body, 'venue', existing.venue),
    artwork_url: mergeField(body, 'artwork_url', existing.artwork_url),
    status: mergeField(body, 'status', existing.status),
    starts_at: mergeField(body, 'starts_at', toIsoString(existing.starts_at)),
    ends_at: mergeField(body, 'ends_at', toIsoString(existing.ends_at)),
    timezone: mergeField(body, 'timezone', existing.timezone),
  };
  const error = validateEventInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const rows = await sql`
      UPDATE events SET
        name = ${merged.name as string}, slug = ${merged.slug as string},
        description = ${(merged.description as string | null) ?? null},
        venue = ${(merged.venue as string | null) ?? null},
        artwork_url = ${(merged.artwork_url as string | null) || null},
        status = ${merged.status as string},
        starts_at = ${merged.starts_at as string}, ends_at = ${merged.ends_at as string},
        timezone = ${merged.timezone as string}, updated_at = now()
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING *
    `;
    if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ event: rows[0] });
  } catch (err) {
    if (err instanceof Error && /organisation_id_slug_key/i.test(err.message)) {
      return NextResponse.json({ error: 'An event with this slug already exists.' }, { status: 409 });
    }
    throw err;
  }
}
