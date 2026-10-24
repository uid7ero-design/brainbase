import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateQuestionInput } from '@/lib/events/registrationQuestions';
import { logEventEveQuestionsToggled } from '@/lib/events/auditLog';
import { roleGte } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

// See app/api/events/[id]/sessions/route.ts's loadOwnedEvent for why
// this check exists on every child-resource route.
async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id, eve_questions_enabled FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return (rows[0] as { id: string; eve_questions_enabled: boolean } | undefined) ?? null;
}

// GET — every question (active AND inactive) for the manager builder
// UI (§4) — viewer+, matching every other Events read's own role floor.
// Definitions only (never answers). eve_questions_enabled is the event's
// Eve opt-in (ADR 0013 §4).
// response_count (how many answers a question has; answered questions have
// their type/scope locked — see the [questionId] route) is manager+ only:
// a count on, say, "Accessibility requirements" can itself reveal personal
// information (ADR 0013 §4b), so below manager the key is absent.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const withCounts = roleGte(session.role, 'manager');
  const questions = withCounts
    ? await sql`
        SELECT q.id, q.label, q.help_text, q.field_type, q.required, q.scope, q.options, q.sort_order, q.active, q.data_category, q.template_key,
          (SELECT count(*)::int FROM event_registration_responses r WHERE r.question_id = q.id AND r.organisation_id = q.organisation_id) AS response_count
        FROM event_registration_questions q
        WHERE q.event_id = ${id} AND q.organisation_id = ${session.organisationId}
        ORDER BY q.scope, q.sort_order, q.created_at
      `
    : await sql`
        SELECT q.id, q.label, q.help_text, q.field_type, q.required, q.scope, q.options, q.sort_order, q.active, q.data_category, q.template_key
        FROM event_registration_questions q
        WHERE q.event_id = ${id} AND q.organisation_id = ${session.organisationId}
        ORDER BY q.scope, q.sort_order, q.created_at
      `;
  return NextResponse.json({ questions, eve_questions_enabled: event.eve_questions_enabled === true });
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
    INSERT INTO event_registration_questions (organisation_id, event_id, label, help_text, field_type, required, scope, options, sort_order, data_category, template_key)
    VALUES (
      ${session.organisationId}, ${id}, ${validated.label}, ${validated.help_text}, ${validated.field_type},
      ${validated.required}, ${validated.scope}, ${validated.options ? JSON.stringify(validated.options) : null}::jsonb, ${validated.sort_order},
      ${validated.data_category}, ${validated.template_key}
    )
    RETURNING id, label, help_text, field_type, required, scope, options, sort_order, active, data_category, template_key
  `;
  return NextResponse.json({ question: rows[0] }, { status: 201 });
}

// PATCH — the event's Eve opt-in (ADR 0013 §4): { eve_questions_enabled:
// boolean }. manager+, audited. While false, Eve shows none of this event's
// questions and the services refuse answers submitted through Eve. Only
// this one field; every other event field stays with the event route.
export async function PATCH(req: NextRequest, { params }: Ctx) {
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
  if (typeof body.eve_questions_enabled !== 'boolean') {
    return NextResponse.json({ error: 'eve_questions_enabled must be a boolean.' }, { status: 400 });
  }
  const next = body.eve_questions_enabled;
  const before = event.eve_questions_enabled === true;

  await sql`
    UPDATE events SET eve_questions_enabled = ${next}, updated_at = now()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `;
  if (before !== next) {
    await logEventEveQuestionsToggled({ organisationId: session.organisationId, userId: session.userId, eventId: id, before, after: next });
  }
  return NextResponse.json({ eve_questions_enabled: next });
}
