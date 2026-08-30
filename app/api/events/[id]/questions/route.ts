import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateQuestionInput } from '@/lib/events/registrationQuestions';

type Ctx = { params: Promise<{ id: string }> };

// See app/api/events/[id]/sessions/route.ts's loadOwnedEvent for why
// this check exists on every child-resource route.
async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] ?? null;
}

// GET — every question (active AND inactive) for the manager builder
// UI (§4) — viewer+, matching every other Events read's own role floor.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const questions = await sql`
    SELECT id, label, help_text, field_type, required, scope, options, sort_order, active
    FROM event_registration_questions
    WHERE event_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY scope, sort_order, created_at
  `;
  return NextResponse.json({ questions });
}

// POST — create a new question. manager+, matching every other Events
// mutation's role convention (ticket types, sessions, artwork).
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const validated = validateQuestionInput(body);
  if (typeof validated === 'string') return NextResponse.json({ error: validated }, { status: 400 });

  const rows = await sql`
    INSERT INTO event_registration_questions (organisation_id, event_id, label, help_text, field_type, required, scope, options, sort_order)
    VALUES (
      ${session.organisationId}, ${id}, ${validated.label}, ${validated.help_text}, ${validated.field_type},
      ${validated.required}, ${validated.scope}, ${validated.options ? JSON.stringify(validated.options) : null}::jsonb, ${validated.sort_order}
    )
    RETURNING id, label, help_text, field_type, required, scope, options, sort_order, active
  `;
  return NextResponse.json({ question: rows[0] }, { status: 201 });
}
