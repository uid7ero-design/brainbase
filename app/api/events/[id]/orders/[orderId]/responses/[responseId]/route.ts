import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logResponseEdited } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string; responseId: string }> };

// PATCH — Phase 6 §6: edit the `answer` on an existing registration
// response. manager+, matching every other Events mutation.
//
// question_id, question_label_snapshot, and field_type_snapshot are
// NEVER touched by this route — only `answer` changes. This is
// deliberate, not an oversight: those three columns are this schema's
// own historical record of exactly what question was asked and how it
// was described AT SUBMISSION TIME (see scripts/add-events-registration-
// questions.sql's own comment on this — "preserve historical response
// even if question wording later changes... do not rely solely on the
// current mutable question definition"). A manager correcting a typo in
// an attendee's answer is not the same event as the question itself
// being redefined, and must not silently rewrite which question this
// row is understood to have been answering.
//
// Tenant + relationship safety: the UPDATE's WHERE clause requires
// id = responseId AND order_id = orderId AND event_id = eventId AND
// organisation_id = session.organisationId together.
//
// Validation is against field_type_snapshot (the shape the answer
// actually has to satisfy), never the LIVE question row — a question
// that has since been edited, disabled, or deleted must not change
// what a valid edit to its historical response looks like. Known,
// honest limitation: this schema does not snapshot a question's
// `options` (SINGLE_SELECT/MULTI_SELECT's allowed values) or its
// `required` flag at response-write time — only label and field_type
// are snapshotted (see the schema itself). This route therefore
// validates SINGLE_SELECT/MULTI_SELECT answers by SHAPE only (a string,
// or an array of strings) — it cannot re-validate against the exact
// option list that existed at submission time, because that was never
// recorded. This is reported explicitly rather than silently
// pretending full validation exists.
//
// Never touches CRM: this table has no relationship to crm_contacts/
// crm_activities at all, and lib/crm/eventSync.ts never reads
// event_registration_responses — editing an answer here cannot reach
// CRM by construction, not merely by convention.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId, responseId } = await params;

  let body: { answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  if (!('answer' in body)) {
    return NextResponse.json({ error: 'No answer provided.' }, { status: 400 });
  }

  const existingRows = await sql`
    SELECT id, question_id, field_type_snapshot FROM event_registration_responses
    WHERE id = ${responseId} AND order_id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const existing = existingRows[0] as { id: string; question_id: string; field_type_snapshot: string } | undefined;
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const validated = validateAnswerAgainstSnapshot(existing.field_type_snapshot, body.answer);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const updated = await sql`
    UPDATE event_registration_responses
    SET answer = ${JSON.stringify(validated.value)}::jsonb
    WHERE id = ${responseId} AND order_id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    RETURNING id, question_id, question_label_snapshot, field_type_snapshot, answer
  `;
  if (!updated.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await logResponseEdited({
    organisationId: session.organisationId, userId: session.userId, orderId, responseId,
    questionId: existing.question_id, fieldType: existing.field_type_snapshot,
  });

  return NextResponse.json({ response: updated[0] });
}

type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string };

function validateAnswerAgainstSnapshot(fieldType: string, answer: unknown): ValidationResult {
  if (answer === null || answer === undefined || answer === '') {
    return { ok: true, value: null };
  }
  switch (fieldType) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof answer !== 'string') return { ok: false, error: 'This answer must be text.' };
      // Matches lib/events/registrationQuestions.ts's own
      // MAX_SHORT_TEXT_LENGTH/MAX_LONG_TEXT_LENGTH exactly — not
      // re-exported from that module (its own validateAnswerShape is
      // deliberately question-object-shaped, not snapshot-shaped; see
      // this file's own header comment on why edits validate against
      // the snapshot instead), but kept numerically identical so an
      // edited answer can never exceed what a fresh submission could.
      const max = fieldType === 'SHORT_TEXT' ? 300 : 4000;
      if (answer.length > max) return { ok: false, error: `This answer must be ${max} characters or fewer.` };
      const trimmed = answer.trim();
      return { ok: true, value: trimmed.length > 0 ? trimmed : null };
    }
    case 'YES_NO': {
      if (typeof answer !== 'boolean') return { ok: false, error: 'This answer must be yes or no.' };
      return { ok: true, value: answer };
    }
    case 'SINGLE_SELECT': {
      if (typeof answer !== 'string') return { ok: false, error: 'This answer must be a single option.' };
      return { ok: true, value: answer };
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(answer) || !answer.every(v => typeof v === 'string')) {
        return { ok: false, error: 'This answer must be a list of options.' };
      }
      return { ok: true, value: [...new Set(answer as string[])] };
    }
    default:
      return { ok: false, error: 'Unrecognised question type.' };
  }
}
