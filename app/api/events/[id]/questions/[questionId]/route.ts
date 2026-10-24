import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateQuestionInput, FIELD_TYPES, QUESTION_SCOPES } from '@/lib/events/registrationQuestions';

type Ctx = { params: Promise<{ id: string; questionId: string }> };

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] ?? null;
}

// PATCH — edit a question, toggle active/inactive, or change sort_order
// (§4's "edit / remove-or-deactivate / reorder"). manager+. Deliberately
// no DELETE handler on this route at all: §4 asks for deactivation, not
// hard deletion, and the database's own FK
// (event_registration_responses.question_id ON DELETE RESTRICT) would
// reject a hard delete of any question with existing responses anyway
// — this route simply never attempts one, matching the "no hard
// delete of financial/order-adjacent history" discipline the rest of
// this module (cancel, not delete, an order) already established.
//
// Every field is independently optional in the request body — a
// reorder-only request (just sort_order) or an active-only toggle
// doesn't need to resend the whole question. Fields that ARE present
// are still run through the exact same validateQuestionInput() shape
// checks a full create uses, merged onto the current row.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, questionId } = await params;

  const event = await loadOwnedEvent(eventId, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const existingRows = await sql`
    SELECT q.id, q.label, q.help_text, q.field_type, q.required, q.scope, q.options, q.sort_order, q.active, q.data_category, q.template_key,
      EXISTS (SELECT 1 FROM event_registration_responses r WHERE r.question_id = q.id AND r.organisation_id = q.organisation_id) AS answered
    FROM event_registration_questions q
    WHERE q.id = ${questionId} AND q.event_id = ${eventId} AND q.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const existing = existingRows[0] as {
    id: string; label: string; help_text: string | null; field_type: string; required: boolean;
    scope: string; options: string[] | null; sort_order: number; active: boolean;
    data_category: string; template_key: string | null; answered: boolean;
  } | undefined;
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // active is handled independently of the shape-validated fields — a
  // pure boolean toggle, not subject to label/field_type/options rules.
  let active = existing.active;
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be a boolean.' }, { status: 400 });
    active = body.active;
  }

  // A question's template link is permanent: it can't be added, changed or
  // removed, so a built-in question's protected category can't be escaped.
  if ('template_key' in body && (body.template_key ?? null) !== (existing.template_key ?? null)) {
    return NextResponse.json({ error: 'A question’s built-in template cannot be changed.' }, { status: 400 });
  }

  const hasContentFields = ['label', 'help_text', 'field_type', 'required', 'scope', 'options', 'sort_order', 'data_category'].some(k => k in body);
  let label = existing.label, helpText = existing.help_text, fieldType = existing.field_type as typeof FIELD_TYPES[number];
  let required = existing.required, scope = existing.scope as typeof QUESTION_SCOPES[number], options = existing.options, sortOrder = existing.sort_order;
  let dataCategory = existing.data_category;

  if (hasContentFields) {
    const merged = validateQuestionInput({
      label: body.label ?? existing.label,
      help_text: 'help_text' in body ? body.help_text : existing.help_text,
      field_type: body.field_type ?? existing.field_type,
      required: 'required' in body ? body.required : existing.required,
      scope: body.scope ?? existing.scope,
      options: 'options' in body ? body.options : existing.options,
      sort_order: body.sort_order ?? existing.sort_order,
      data_category: 'data_category' in body ? body.data_category : existing.data_category,
      template_key: existing.template_key,
    });
    if (typeof merged === 'string') return NextResponse.json({ error: merged }, { status: 400 });
    // Once answered, a question's meaning must not change underneath its
    // answers: its type and scope are fixed, and select options can be
    // added but never removed or renamed (an existing answer must stay one
    // of the options). Wording edits stay allowed — every answer keeps the
    // label/help text it was given under (snapshots). To ask something
    // different, deactivate this question and add a new one.
    if (existing.answered) {
      if (merged.field_type !== existing.field_type || merged.scope !== existing.scope) {
        return NextResponse.json({ error: 'This question already has answers, so its type and who it is asked of cannot change. Deactivate it and add a new question instead.' }, { status: 409 });
      }
      const kept = new Set(merged.options ?? []);
      if ((existing.options ?? []).some(o => !kept.has(o))) {
        return NextResponse.json({ error: 'This question already has answers, so its existing options cannot be removed or renamed. You can add options, or deactivate it and add a new question.' }, { status: 409 });
      }
    }
    ({ label, help_text: helpText, field_type: fieldType, required, scope, options, sort_order: sortOrder, data_category: dataCategory } = merged);
  } else if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order)) return NextResponse.json({ error: 'sort_order must be an integer.' }, { status: 400 });
    sortOrder = body.sort_order as number;
  }

  const rows = await sql`
    UPDATE event_registration_questions
    SET label = ${label}, help_text = ${helpText}, field_type = ${fieldType}, required = ${required},
        scope = ${scope}, options = ${options ? JSON.stringify(options) : null}::jsonb, sort_order = ${sortOrder}, active = ${active},
        data_category = ${dataCategory}, updated_at = now()
    WHERE id = ${questionId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    RETURNING id, label, help_text, field_type, required, scope, options, sort_order, active, data_category, template_key
  `;
  return NextResponse.json({ question: rows[0] });
}
