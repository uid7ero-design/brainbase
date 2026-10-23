import 'server-only';
import sql from '@/lib/db';

export const FIELD_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT'] as const;
export type FieldType = typeof FIELD_TYPES[number];
export const QUESTION_SCOPES = ['ORDER', 'ATTENDEE'] as const;
export type QuestionScope = typeof QUESTION_SCOPES[number];

const SELECT_FIELD_TYPES: readonly FieldType[] = ['SINGLE_SELECT', 'MULTI_SELECT'];
const MAX_LABEL_LENGTH = 200;
const MAX_HELP_TEXT_LENGTH = 500;
const MAX_SHORT_TEXT_LENGTH = 300;
const MAX_LONG_TEXT_LENGTH = 4000;
const MAX_OPTIONS = 20;
const MAX_OPTION_LENGTH = 120;

export type QuestionRow = {
  id: string;
  label: string;
  help_text: string | null;
  field_type: FieldType;
  required: boolean;
  scope: QuestionScope;
  options: string[] | null;
  sort_order: number;
  active: boolean;
  // Eve (ADR 0013 §4): answers may reveal sensitive information (health/
  // accessibility, a third party's details). On Eve, answering one needs
  // the buyer's explicit acknowledgement — see checkEveAnswerPolicy.
  sensitive: boolean;
};

// ── Manager CRUD (§4) ─────────────────────────────────────────────────
// Every function below is tenant-scoped by (organisationId, eventId)
// arguments the caller must already have server-derived (session +
// loadOwnedEvent) — matching every other lib/events/*.ts function's
// own convention of trusting its arguments rather than re-deriving
// tenancy itself.

export async function listAllQuestions(organisationId: string, eventId: string): Promise<QuestionRow[]> {
  const rows = await sql`
    SELECT id, label, help_text, field_type, required, scope, options, sort_order, active, sensitive
    FROM event_registration_questions
    WHERE organisation_id = ${organisationId} AND event_id = ${eventId}
    ORDER BY scope, sort_order, created_at
  `;
  return rows as QuestionRow[];
}

// Active-only, ordered — the exact shape the public checkout/register
// routes need to render/validate against. Never returns an inactive
// question: retiring a question via §4's "deactivate" action removes
// it from every future public registration immediately, without
// touching any response already recorded against it (§3's history
// requirement — responses keep their own snapshot, independent of
// this list).
export async function listActiveQuestions(organisationId: string, eventId: string): Promise<QuestionRow[]> {
  const rows = await sql`
    SELECT id, label, help_text, field_type, required, scope, options, sort_order, active, sensitive
    FROM event_registration_questions
    WHERE organisation_id = ${organisationId} AND event_id = ${eventId} AND active = true
    ORDER BY scope, sort_order, created_at
  `;
  return rows as QuestionRow[];
}

export type QuestionInput = {
  label: string;
  help_text: string | null;
  field_type: FieldType;
  required: boolean;
  scope: QuestionScope;
  options: string[] | null;
  sort_order: number;
  sensitive: boolean;
};

// Returns a human-readable error string on failure, or null if the
// input is well-formed. Never throws — the same "typed check against
// attacker/organiser-controlled JSON" discipline
// lib/events/publicValidation.ts already established.
export function validateQuestionInput(body: {
  label?: unknown; help_text?: unknown; field_type?: unknown; required?: unknown;
  scope?: unknown; options?: unknown; sort_order?: unknown; sensitive?: unknown;
}): string | QuestionInput {
  if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > MAX_LABEL_LENGTH) {
    return `Label is required and must be ${MAX_LABEL_LENGTH} characters or fewer.`;
  }
  if (body.help_text !== undefined && body.help_text !== null) {
    if (typeof body.help_text !== 'string' || body.help_text.length > MAX_HELP_TEXT_LENGTH) {
      return `Help text must be ${MAX_HELP_TEXT_LENGTH} characters or fewer.`;
    }
  }
  if (typeof body.field_type !== 'string' || !FIELD_TYPES.includes(body.field_type as FieldType)) {
    return `field_type must be one of: ${FIELD_TYPES.join(', ')}.`;
  }
  const fieldType = body.field_type as FieldType;
  if (typeof body.scope !== 'string' || !QUESTION_SCOPES.includes(body.scope as QuestionScope)) {
    return `scope must be one of: ${QUESTION_SCOPES.join(', ')}.`;
  }
  const required = body.required === true;
  if (body.sensitive !== undefined && typeof body.sensitive !== 'boolean') return 'sensitive must be a boolean.';
  const sensitive = body.sensitive === true;
  const sortOrder = Number.isInteger(body.sort_order) ? (body.sort_order as number) : 0;

  let options: string[] | null = null;
  if (SELECT_FIELD_TYPES.includes(fieldType)) {
    if (!Array.isArray(body.options) || body.options.length === 0) {
      return 'At least one option is required for a select question.';
    }
    if (body.options.length > MAX_OPTIONS) {
      return `A select question may have at most ${MAX_OPTIONS} options.`;
    }
    const cleaned: string[] = [];
    for (const raw of body.options) {
      if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_OPTION_LENGTH) {
        return `Each option must be a non-empty string of ${MAX_OPTION_LENGTH} characters or fewer.`;
      }
      cleaned.push(raw.trim());
    }
    if (new Set(cleaned).size !== cleaned.length) {
      return 'Options must be unique.';
    }
    options = cleaned;
  } else if (body.options !== undefined && body.options !== null) {
    return 'options is only valid for SINGLE_SELECT/MULTI_SELECT questions.';
  }

  return {
    label: body.label.trim(),
    help_text: typeof body.help_text === 'string' && body.help_text.trim() ? body.help_text.trim() : null,
    field_type: fieldType,
    required,
    scope: body.scope as QuestionScope,
    options,
    sort_order: sortOrder,
    sensitive,
  };
}

// ── Public-side answer validation (§Step 5/§9) ──────────────────────
//
// Runs server-side, after fetching the event's own CURRENT active
// question list — never trusts the client's own idea of which
// questions exist or are required (§5's "server remains authoritative
// for validation; client validation is UX only"). A submitted
// question_id that doesn't match any of this event's own active
// questions is rejected outright — this is what makes a cross-event/
// cross-tenant question id structurally impossible to attach an
// answer to, independent of the database-level composite FK that
// would also reject it at write time.

export type SubmittedAnswer = { question_id: string; answer: unknown };

export type ValidatedAnswer = { question: QuestionRow; answer: unknown };

// A discriminated result, deliberately NOT "string means error, else
// value" — a valid text/select answer IS itself a string, so
// overloading the return type on `typeof result === 'string'` would
// misidentify a genuine answer as an error message. `value: null`
// means "optional and blank, nothing to store" (a real, valid
// outcome), distinct from `ok: false` (rejected).
type AnswerValidationResult =
  | { ok: true; value: unknown | null }
  | { ok: false; error: string };

function validateAnswerShape(question: QuestionRow, answer: unknown): AnswerValidationResult {
  if (answer === null || answer === undefined || answer === '') {
    if (question.required) return { ok: false, error: `${question.label} is required.` };
    return { ok: true, value: null };
  }
  switch (question.field_type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof answer !== 'string') return { ok: false, error: `${question.label} must be text.` };
      const max = question.field_type === 'SHORT_TEXT' ? MAX_SHORT_TEXT_LENGTH : MAX_LONG_TEXT_LENGTH;
      if (answer.length > max) return { ok: false, error: `${question.label} must be ${max} characters or fewer.` };
      const trimmed = answer.trim();
      if (!trimmed) return question.required ? { ok: false, error: `${question.label} is required.` } : { ok: true, value: null };
      return { ok: true, value: trimmed };
    }
    case 'YES_NO': {
      if (typeof answer !== 'boolean') return { ok: false, error: `${question.label} must be yes or no.` };
      return { ok: true, value: answer };
    }
    case 'SINGLE_SELECT': {
      if (typeof answer !== 'string' || !(question.options ?? []).includes(answer)) {
        return { ok: false, error: `${question.label} must be one of the provided options.` };
      }
      return { ok: true, value: answer };
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(answer) || answer.length === 0) {
        return question.required ? { ok: false, error: `${question.label} is required.` } : { ok: true, value: null };
      }
      const allowed = new Set(question.options ?? []);
      for (const item of answer) {
        if (typeof item !== 'string' || !allowed.has(item)) {
          return { ok: false, error: `${question.label} contains an invalid option.` };
        }
      }
      return { ok: true, value: [...new Set(answer as string[])] };
    }
    default:
      return { ok: false, error: `${question.label} has an unrecognised field type.` };
  }
}

export type ValidatedResponses = {
  orderAnswers: ValidatedAnswer[];
  attendeeAnswers: ValidatedAnswer[][]; // one array per attendee, same order as the attendees array
};

// `orderResponses` / `attendeeResponsesList` come from the (already
// structurally-validated) public request body. `questions` is the
// event's own live active list, fetched by the caller. Returns an
// error string, or the validated, normalised answers ready to persist
// — every entry paired with its full QuestionRow so the caller never
// needs a second lookup to know a question's scope/field_type/label
// when writing the response snapshot columns.
export function validateSubmittedResponses(
  questions: QuestionRow[],
  orderResponses: SubmittedAnswer[],
  attendeeResponsesList: SubmittedAnswer[][],
): string | ValidatedResponses {
  const byId = new Map(questions.map(q => [q.id, q]));
  const orderQuestions = questions.filter(q => q.scope === 'ORDER');
  const attendeeQuestions = questions.filter(q => q.scope === 'ATTENDEE');

  const orderAnswers: ValidatedAnswer[] = [];
  const seenOrderIds = new Set<string>();
  for (const submitted of orderResponses) {
    if (typeof submitted.question_id !== 'string') return 'Invalid response — missing question reference.';
    const question = byId.get(submitted.question_id);
    if (!question || question.scope !== 'ORDER') return 'Invalid response — unknown question.';
    if (seenOrderIds.has(question.id)) return 'Duplicate response for the same question.';
    seenOrderIds.add(question.id);
    const result = validateAnswerShape(question, submitted.answer);
    if (!result.ok) return result.error;
    if (result.value !== null) orderAnswers.push({ question, answer: result.value });
  }
  for (const question of orderQuestions) {
    if (question.required && !seenOrderIds.has(question.id)) return `${question.label} is required.`;
  }

  // attendeeResponsesList's own length (one entry per attendee) is
  // already validated against the submitted quantity by the caller's
  // existing attendee-count check — nothing further to enforce here.
  const attendeeAnswers: ValidatedAnswer[][] = [];
  for (const submittedForAttendee of attendeeResponsesList) {
    const answersForThisAttendee: ValidatedAnswer[] = [];
    const seenAttendeeIds = new Set<string>();
    for (const submitted of submittedForAttendee) {
      if (typeof submitted.question_id !== 'string') return 'Invalid response — missing question reference.';
      const question = byId.get(submitted.question_id);
      if (!question || question.scope !== 'ATTENDEE') return 'Invalid response — unknown question.';
      if (seenAttendeeIds.has(question.id)) return 'Duplicate response for the same question.';
      seenAttendeeIds.add(question.id);
      const result = validateAnswerShape(question, submitted.answer);
      if (!result.ok) return result.error;
      if (result.value !== null) answersForThisAttendee.push({ question, answer: result.value });
    }
    for (const question of attendeeQuestions) {
      if (question.required && !seenAttendeeIds.has(question.id)) return `${question.label} is required.`;
    }
    attendeeAnswers.push(answersForThisAttendee);
  }

  return { orderAnswers, attendeeAnswers };
}

// ── Eve answer policy (ADR 0013 §4) ──────────────────────────────────
//
// Applied by the shared free/paid services for productSurface 'EVE' only,
// AFTER validateSubmittedResponses and BEFORE anything is reserved:
//   - an event that has not opted in (events.eve_questions_enabled = false)
//     accepts no answers at all through Eve, even to optional questions a
//     tampered client might submit — its questions were never shown on Eve
//     or covered by Eve's notices;
//   - an answer to a question marked sensitive needs the buyer's explicit
//     acknowledgement (sensitive_consent === true, never defaulted). An
//     unanswered optional sensitive question needs nothing.
// Returns an error message, or null when the submission may proceed. The
// BrainBase surface is unaffected (its form has no such control).
export function checkEveAnswerPolicy(
  submitted: { orderResponses: SubmittedAnswer[]; attendeeResponses: SubmittedAnswer[][] },
  validated: ValidatedResponses,
  opts: { eveQuestionsEnabled: boolean; sensitiveConsent: boolean },
): string | null {
  const anySubmitted = submitted.orderResponses.length > 0 || submitted.attendeeResponses.some(a => a.length > 0);
  if (!opts.eveQuestionsEnabled) {
    return anySubmitted ? 'This event is not collecting registration answers here.' : null;
  }
  const answeredSensitive = [...validated.orderAnswers, ...validated.attendeeAnswers.flat()].some(a => a.question.sensitive);
  if (answeredSensitive && !opts.sensitiveConsent) {
    return 'Please confirm you agree to the organiser collecting the information marked as sensitive.';
  }
  return null;
}

// The single place the services ask "what does this product surface require
// of these answers?" — so the shared free/paid services stay product-neutral
// (they pass the surface through; they never branch on it themselves).
// Returns the refusal message, or the consent timestamp to store on
// sensitive rows (null when there is none to record).
export function applySurfaceAnswerPolicy(params: {
  productSurface: string;
  eveQuestionsEnabled: boolean | undefined;
  sensitiveConsent: boolean | undefined;
  submitted: { orderResponses: SubmittedAnswer[]; attendeeResponses: SubmittedAnswer[][] };
  validated: ValidatedResponses;
}): { ok: false; error: string } | { ok: true; sensitiveConsentAt: string | null } {
  if (params.productSurface !== 'EVE') return { ok: true, sensitiveConsentAt: null };
  const error = checkEveAnswerPolicy(params.submitted, params.validated, {
    eveQuestionsEnabled: params.eveQuestionsEnabled === true,
    sensitiveConsent: params.sensitiveConsent === true,
  });
  if (error) return { ok: false, error };
  return { ok: true, sensitiveConsentAt: params.sensitiveConsent === true ? new Date().toISOString() : null };
}

// ── Flattening helpers — shared by both response-write paths ────────
//
// Pure array-building only, no DB access — reused by both the atomic
// in-transaction insert the free-registration route builds itself (see
// that route's own comment on why it can't call a single shared
// query-issuing function) and writeRegistrationResponses() below (the
// paid checkout route's own post-transaction, pre-Stripe-redirect
// write). Kept as plain data builders rather than each duplicating its
// own flattening logic.

// helpTexts uses '' for "no help text" (NULLIF'd back to NULL on insert);
// sensitives are 'true'/'false' text (cast ::boolean on insert) — the same
// text-array UNNEST discipline as every other column here.
export type FlattenedOrderResponses = {
  questionIds: string[];
  labels: string[];
  fieldTypes: string[];
  helpTexts: string[];
  sensitives: string[];
  answersJson: string[];
};

export function flattenOrderAnswers(orderAnswers: ValidatedAnswer[]): FlattenedOrderResponses {
  return {
    questionIds: orderAnswers.map(a => a.question.id),
    labels: orderAnswers.map(a => a.question.label),
    fieldTypes: orderAnswers.map(a => a.question.field_type),
    helpTexts: orderAnswers.map(a => a.question.help_text ?? ''),
    sensitives: orderAnswers.map(a => String(a.question.sensitive === true)),
    answersJson: orderAnswers.map(a => JSON.stringify(a.answer)),
  };
}

export type FlattenedAttendeeResponses = {
  // One entry per flattened answer row — `correlationKeys[i]` is
  // whatever the caller passed as attendee i's own correlation value
  // (a real DB attendee id for the post-transaction path, a
  // pre-generated ticket_token for the atomic in-transaction path —
  // see each call site for which and why).
  correlationKeys: string[];
  questionIds: string[];
  labels: string[];
  fieldTypes: string[];
  helpTexts: string[];
  sensitives: string[];
  answersJson: string[];
};

export function flattenAttendeeAnswers(
  attendeeAnswers: ValidatedAnswer[][],
  correlationKeys: string[],
): FlattenedAttendeeResponses {
  const out: FlattenedAttendeeResponses = { correlationKeys: [], questionIds: [], labels: [], fieldTypes: [], helpTexts: [], sensitives: [], answersJson: [] };
  attendeeAnswers.forEach((answersForAttendee, idx) => {
    const key = correlationKeys[idx];
    for (const ans of answersForAttendee) {
      out.correlationKeys.push(key);
      out.questionIds.push(ans.question.id);
      out.labels.push(ans.question.label);
      out.fieldTypes.push(ans.question.field_type);
      out.helpTexts.push(ans.question.help_text ?? '');
      out.sensitives.push(String(ans.question.sensitive === true));
      out.answersJson.push(JSON.stringify(ans.answer));
    }
  });
  return out;
}

// ── Response persistence — paid checkout route only (§3/§8) ─────────
//
// Runs AFTER the capacity-gated reservation transaction has committed
// (attendee ids don't exist until then) but BEFORE the Stripe Checkout
// redirect — see that route's own comment for why a write failure here
// is treated as fatal (compensating cancellation), unlike the free
// route. Every value this writes has already been fully validated by
// validateSubmittedResponses before the transaction even started.
//
// NOTE: the free-registration route does NOT use this function — as of
// the Phase 4B correctness remediation, its response writes are folded
// directly into the SAME atomic reservation transaction (see that
// route's own extensive comment), because unlike the paid flow there
// is no external system (Stripe) forcing a gap between "reservation
// committed" and "response persisted," so there is no reason to accept
// the weaker guarantee here.
//
// Snapshots the question's label and field_type at write time (§3) so
// a later edit to the live question definition never rewrites how this
// historical response renders. `attendeeIds` must be in the exact same
// order as `responses.attendeeAnswers` (both ultimately driven by the
// same attendee ordering the caller's own UNNEST used) — position i of
// each corresponds to the same attendee.
export async function writeRegistrationResponses(
  organisationId: string,
  eventId: string,
  orderId: string,
  attendeeIds: string[],
  responses: ValidatedResponses,
  // ISO timestamp of the Eve buyer's sensitive-information acknowledgement,
  // or null. Stored only on rows whose question is sensitive.
  sensitiveConsentAt: string | null = null,
): Promise<void> {
  const order = flattenOrderAnswers(responses.orderAnswers);
  const attendee = flattenAttendeeAnswers(responses.attendeeAnswers, attendeeIds);

  const questionIds = [...order.questionIds, ...attendee.questionIds];
  // '' sentinel for NULL (order-scoped) — same empty-string convention
  // this module's callers already use for attendee_email.
  const attendeeIdColumn = [...order.questionIds.map(() => ''), ...attendee.correlationKeys];
  const labels = [...order.labels, ...attendee.labels];
  const fieldTypes = [...order.fieldTypes, ...attendee.fieldTypes];
  const helpTexts = [...order.helpTexts, ...attendee.helpTexts];
  const sensitives = [...order.sensitives, ...attendee.sensitives];
  const answersJson = [...order.answersJson, ...attendee.answersJson];

  if (!questionIds.length) return;

  await sql`
    INSERT INTO event_registration_responses
      (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot,
       question_help_text_snapshot, sensitive_snapshot, sensitive_consent_at, answer)
    SELECT ${organisationId}, ${eventId}, a.question_id, ${orderId}, NULLIF(a.attendee_id, ''), a.label, a.field_type,
      NULLIF(a.help_text, ''), a.sensitive::boolean, CASE WHEN a.sensitive::boolean THEN ${sensitiveConsentAt}::timestamptz END, a.answer_json::jsonb
    FROM UNNEST(${questionIds}::text[], ${attendeeIdColumn}::text[], ${labels}::text[], ${fieldTypes}::text[], ${helpTexts}::text[], ${sensitives}::text[], ${answersJson}::text[])
      AS a(question_id, attendee_id, label, field_type, help_text, sensitive, answer_json)
  `;
}
