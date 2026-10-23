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
  // ADR 0013 §4b — what kind of information the answers are; drives the
  // buyer notice, explicit agreement, staff labels and retention.
  data_category: DataCategory;
  // Built-in template the question came from (fixes a protected category).
  template_key: TemplateKey | null;
};

// ── Data categories and built-in templates (ADR 0013 §4b) ─────────────
//
// STANDARD     ordinary personal information (e.g. how did you hear).
// SENSITIVE    may reveal health, disability or similar (e.g. accessibility,
//              dietary needs, which can reveal health or religious belief).
// THIRD_PARTY  another person's details (e.g. an emergency contact).
// CONSENT      evidence of a choice the buyer made (e.g. photo consent).
//
// On Eve, answering a SENSITIVE or THIRD_PARTY question needs a separate
// acknowledgement from the PURCHASER (AGREEMENT_CATEGORIES; see
// checkEveAnswerPolicy) — for THIRD_PARTY that is the purchaser's
// confirmation, never the other person's consent. Retention timers per
// category live in lib/events/answerRetention.ts (RETENTION_POLICY).
export const DATA_CATEGORIES = ['STANDARD', 'SENSITIVE', 'THIRD_PARTY', 'CONSENT'] as const;
export type DataCategory = typeof DATA_CATEGORIES[number];
export const AGREEMENT_CATEGORIES: readonly DataCategory[] = ['SENSITIVE', 'THIRD_PARTY'];
// A templated question in one of these categories keeps it: the organiser
// cannot lower the protection a built-in question was designed with.
const PROTECTED_CATEGORIES: readonly DataCategory[] = ['SENSITIVE', 'THIRD_PARTY', 'CONSENT'];

export function isDataCategory(v: unknown): v is DataCategory {
  return typeof v === 'string' && (DATA_CATEGORIES as readonly string[]).includes(v);
}

export const QUESTION_TEMPLATES = {
  DIETARY: { label: 'Dietary requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE', data_category: 'SENSITIVE', options: null },
  ACCESSIBILITY: { label: 'Accessibility or support requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE', data_category: 'SENSITIVE', options: null },
  SPECIAL_REQUESTS: { label: 'Special requests or anything else we should know?', field_type: 'LONG_TEXT', scope: 'ORDER', data_category: 'STANDARD', options: null },
  EMERGENCY_CONTACT_NAME: { label: 'Emergency contact name', field_type: 'SHORT_TEXT', scope: 'ORDER', data_category: 'THIRD_PARTY', options: null },
  EMERGENCY_CONTACT_PHONE: { label: 'Emergency contact phone number', field_type: 'SHORT_TEXT', scope: 'ORDER', data_category: 'THIRD_PARTY', options: null },
  PHOTO_CONSENT: { label: 'Consent to event photography/videography', field_type: 'YES_NO', scope: 'ATTENDEE', data_category: 'CONSENT', options: null },
  HOW_DID_YOU_HEAR: { label: 'How did you hear about this event?', field_type: 'SINGLE_SELECT', scope: 'ORDER', data_category: 'STANDARD', options: ['Social media', 'Friend or family', 'Search engine', 'Poster or flyer', 'Radio', 'Other'] },
} as const satisfies Record<string, { label: string; field_type: FieldType; scope: QuestionScope; data_category: DataCategory; options: readonly string[] | null }>;
export type TemplateKey = keyof typeof QUESTION_TEMPLATES;

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUESTION_TEMPLATES, v);
}

// The category a templated question must keep, or null when the organiser
// may choose (no template, or a STANDARD template that may be raised).
export function lockedCategoryFor(templateKey: string | null | undefined): DataCategory | null {
  if (!isTemplateKey(templateKey)) return null;
  const c = QUESTION_TEMPLATES[templateKey].data_category;
  return PROTECTED_CATEGORIES.includes(c) ? c : null;
}

// ── Manager CRUD (§4) ─────────────────────────────────────────────────
// Every function below is tenant-scoped by (organisationId, eventId)
// arguments the caller must already have server-derived (session +
// loadOwnedEvent) — matching every other lib/events/*.ts function's
// own convention of trusting its arguments rather than re-deriving
// tenancy itself.

export async function listAllQuestions(organisationId: string, eventId: string): Promise<QuestionRow[]> {
  const rows = await sql`
    SELECT id, label, help_text, field_type, required, scope, options, sort_order, active, data_category, template_key
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
    SELECT id, label, help_text, field_type, required, scope, options, sort_order, active, data_category, template_key
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
  data_category: DataCategory;
  template_key: TemplateKey | null;
};

// Returns a human-readable error string on failure, or null if the
// input is well-formed. Never throws — the same "typed check against
// attacker/organiser-controlled JSON" discipline
// lib/events/publicValidation.ts already established.
export function validateQuestionInput(body: {
  label?: unknown; help_text?: unknown; field_type?: unknown; required?: unknown;
  scope?: unknown; options?: unknown; sort_order?: unknown; data_category?: unknown; template_key?: unknown;
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
  let templateKey: TemplateKey | null = null;
  if (body.template_key !== undefined && body.template_key !== null) {
    if (!isTemplateKey(body.template_key)) return 'Unknown question template.';
    templateKey = body.template_key;
  }
  if (body.data_category !== undefined && !isDataCategory(body.data_category)) {
    return `data_category must be one of: ${DATA_CATEGORIES.join(', ')}.`;
  }
  const locked = lockedCategoryFor(templateKey);
  let dataCategory: DataCategory = isDataCategory(body.data_category) ? body.data_category
    : templateKey ? QUESTION_TEMPLATES[templateKey].data_category : 'STANDARD';
  if (locked && dataCategory !== locked) {
    return `This built-in question is always ${locked.replace('_', ' ').toLowerCase()} information; its category cannot be changed. Add your own question instead.`;
  }
  if (locked) dataCategory = locked;
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
    data_category: dataCategory,
    template_key: templateKey,
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
//   - the PURCHASER'S own acknowledgements, never defaulted, one per kind:
//       SENSITIVE answer   -> agreeSensitive: the purchaser agrees to the
//                             organiser collecting it;
//       THIRD_PARTY answer -> confirmThirdParty: the purchaser confirms the
//                             other person knows their details are being
//                             given to the organiser (or that they may give
//                             them).
//     Neither is, or is recorded as, the OTHER person's consent: the platform
//     never treats a purchaser's confirmation as third-party consent.
//   An unanswered optional question needs nothing.
// Returns an error message, or null when the submission may proceed. The
// BrainBase surface is unaffected (its form has no such control).
export function checkEveAnswerPolicy(
  submitted: { orderResponses: SubmittedAnswer[]; attendeeResponses: SubmittedAnswer[][] },
  validated: ValidatedResponses,
  opts: { eveQuestionsEnabled: boolean; agreeSensitive: boolean; confirmThirdParty: boolean },
): string | null {
  const anySubmitted = submitted.orderResponses.length > 0 || submitted.attendeeResponses.some(a => a.length > 0);
  if (!opts.eveQuestionsEnabled) {
    return anySubmitted ? 'This event is not collecting registration answers here.' : null;
  }
  const answered = [...validated.orderAnswers, ...validated.attendeeAnswers.flat()];
  if (answered.some(a => a.question.data_category === 'SENSITIVE') && !opts.agreeSensitive) {
    return 'Please confirm you agree to the organiser collecting the health, disability or accessibility information you have given.';
  }
  if (answered.some(a => a.question.data_category === 'THIRD_PARTY') && !opts.confirmThirdParty) {
    return 'Please confirm the person whose details you have given knows you are giving them to the organiser.';
  }
  return null;
}

// The single place the services ask "what does this product surface require
// of these answers?" — so the shared free/paid services stay product-neutral
// (they pass the surface through; they never branch on it themselves).
// Returns the refusal message, or the time to store as buyer_acknowledged_at
// on SENSITIVE / THIRD_PARTY rows: when the PURCHASER gave the acknowledgement
// required for that row's category (see checkEveAnswerPolicy). null when
// there is none to record. It is never a third party's consent.
export function applySurfaceAnswerPolicy(params: {
  productSurface: string;
  eveQuestionsEnabled: boolean | undefined;
  agreeSensitive: boolean | undefined;
  confirmThirdParty: boolean | undefined;
  submitted: { orderResponses: SubmittedAnswer[]; attendeeResponses: SubmittedAnswer[][] };
  validated: ValidatedResponses;
}): { ok: false; error: string } | { ok: true; acknowledgedAt: string | null } {
  if (params.productSurface !== 'EVE') return { ok: true, acknowledgedAt: null };
  const agreeSensitive = params.agreeSensitive === true;
  const confirmThirdParty = params.confirmThirdParty === true;
  const error = checkEveAnswerPolicy(params.submitted, params.validated, {
    eveQuestionsEnabled: params.eveQuestionsEnabled === true, agreeSensitive, confirmThirdParty,
  });
  if (error) return { ok: false, error };
  // The policy above guarantees each answered SENSITIVE / THIRD_PARTY row's
  // own acknowledgement was given, so one timestamp is accurate for both.
  return { ok: true, acknowledgedAt: agreeSensitive || confirmThirdParty ? new Date().toISOString() : null };
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
// categories is the question's data_category at answer time (snapshotted
// into data_category_snapshot) — the same text-array UNNEST discipline as
// every other column here.
export type FlattenedOrderResponses = {
  questionIds: string[];
  labels: string[];
  fieldTypes: string[];
  helpTexts: string[];
  categories: string[];
  answersJson: string[];
};

const categoryOf = (q: QuestionRow): DataCategory => (isDataCategory(q.data_category) ? q.data_category : 'STANDARD');

export function flattenOrderAnswers(orderAnswers: ValidatedAnswer[]): FlattenedOrderResponses {
  return {
    questionIds: orderAnswers.map(a => a.question.id),
    labels: orderAnswers.map(a => a.question.label),
    fieldTypes: orderAnswers.map(a => a.question.field_type),
    helpTexts: orderAnswers.map(a => a.question.help_text ?? ''),
    categories: orderAnswers.map(a => categoryOf(a.question)),
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
  categories: string[];
  answersJson: string[];
};

export function flattenAttendeeAnswers(
  attendeeAnswers: ValidatedAnswer[][],
  correlationKeys: string[],
): FlattenedAttendeeResponses {
  const out: FlattenedAttendeeResponses = { correlationKeys: [], questionIds: [], labels: [], fieldTypes: [], helpTexts: [], categories: [], answersJson: [] };
  attendeeAnswers.forEach((answersForAttendee, idx) => {
    const key = correlationKeys[idx];
    for (const ans of answersForAttendee) {
      out.correlationKeys.push(key);
      out.questionIds.push(ans.question.id);
      out.labels.push(ans.question.label);
      out.fieldTypes.push(ans.question.field_type);
      out.helpTexts.push(ans.question.help_text ?? '');
      out.categories.push(categoryOf(ans.question));
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
  // When the Eve purchaser gave the acknowledgement each SENSITIVE /
  // THIRD_PARTY row needs (stored as buyer_acknowledged_at on those rows
  // only), or null. Never a third party's consent.
  acknowledgedAt: string | null = null,
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
  const categories = [...order.categories, ...attendee.categories];
  const answersJson = [...order.answersJson, ...attendee.answersJson];

  if (!questionIds.length) return;

  await sql`
    INSERT INTO event_registration_responses
      (organisation_id, event_id, question_id, order_id, attendee_id, question_label_snapshot, field_type_snapshot,
       question_help_text_snapshot, data_category_snapshot, buyer_acknowledged_at, answer)
    SELECT ${organisationId}, ${eventId}, a.question_id, ${orderId}, NULLIF(a.attendee_id, ''), a.label, a.field_type,
      NULLIF(a.help_text, ''), a.category,
      CASE WHEN a.category IN ('SENSITIVE', 'THIRD_PARTY') THEN ${acknowledgedAt}::timestamptz END, a.answer_json::jsonb
    FROM UNNEST(${questionIds}::text[], ${attendeeIdColumn}::text[], ${labels}::text[], ${fieldTypes}::text[], ${helpTexts}::text[], ${categories}::text[], ${answersJson}::text[])
      AS a(question_id, attendee_id, label, field_type, help_text, category, answer_json)
  `;
}
