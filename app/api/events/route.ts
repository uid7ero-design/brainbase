import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventInput, type EventInput } from '@/lib/events/validation';

export async function GET() {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const events = await sql`
    SELECT
      e.*,
      COUNT(DISTINCT es.id)::int AS session_count,
      COUNT(DISTINCT tt.id)::int AS ticket_type_count
    FROM events e
    LEFT JOIN event_sessions es ON es.event_id = e.id
    LEFT JOIN event_ticket_types tt ON tt.event_id = e.id
    WHERE e.organisation_id = ${session.organisationId}
    GROUP BY e.id
    ORDER BY e.starts_at DESC
  `;

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  let body: EventInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const error = validateEventInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const rows = await sql`
      INSERT INTO events (
        organisation_id, name, slug, description, venue, status,
        starts_at, ends_at, timezone, created_by
      ) VALUES (
        ${session.organisationId}, ${(body.name as string).trim()}, ${body.slug as string},
        ${(body.description as string | undefined)?.trim() || null},
        ${(body.venue as string | undefined)?.trim() || null},
        ${(body.status as string | undefined) ?? 'DRAFT'},
        ${body.starts_at as string}, ${body.ends_at as string}, ${body.timezone as string},
        ${session.userId}
      )
      RETURNING *
    `;
    return NextResponse.json({ event: rows[0] }, { status: 201 });
  } catch (err) {
    // events_organisation_id_slug_key — slug already used within this
    // organisation (slugs are unique per-organisation only; see the
    // Event model's own schema comment).
    if (err instanceof Error && /organisation_id_slug_key/i.test(err.message)) {
      return NextResponse.json({ error: 'An event with this slug already exists.' }, { status: 409 });
    }
    throw err;
  }
}
