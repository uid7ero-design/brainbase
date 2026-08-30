// Shared validation for the Events & Ticketing Phase 2 public
// registration API. Deliberately separate from lib/events/validation.ts
// (the Phase 1 staff-management validators) — public input has a
// materially different trust boundary and field set: purchaser/
// attendee PII plus a ticket selection, and critically never an
// organisation id and never a price (both are always re-derived
// server-side, never accepted from the request body).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320; // RFC 5321 practical maximum
const MAX_PHONE_LENGTH = 40;
// A single public submission is a family/small-group registration, not
// a bulk-purchase channel — this ceiling exists to bound the size of a
// single UNNEST-expanded attendee insert, not as a product decision
// about total event capacity.
const MAX_QUANTITY = 20;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export type PublicRegistrationInput = {
  ticket_type_id?: unknown;
  event_session_id?: unknown;
  quantity?: unknown;
  purchaser_name?: unknown;
  purchaser_email?: unknown;
  purchaser_phone?: unknown;
  attendees?: unknown;
  // Phase 4B — §5/§9. Structural shape only is checked here (an array
  // of { question_id, answer } pairs); whether each question_id
  // actually belongs to this event, is required, and whether `answer`
  // matches that question's field_type is validated separately by
  // lib/events/registrationQuestions.ts's validateSubmittedResponses(),
  // which needs the event's own live question list — unavailable to
  // this pure, DB-free function. Never trusted as "the request has no
  // opinion on which questions exist": that authority lives entirely
  // server-side, per §5's explicit "server remains authoritative"
  // requirement.
  order_responses?: unknown;
};

export type ValidatedAttendee = { name: string; email: string | null; responses: { question_id: string; answer: unknown }[] };

export type ValidatedRegistration = {
  ticket_type_id: string;
  event_session_id: string | null;
  quantity: number;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_phone: string | null;
  attendees: ValidatedAttendee[];
  order_responses: { question_id: string; answer: unknown }[];
};

// Structural-only: every entry must be a plain object with a
// non-empty string question_id. `answer` itself is deliberately left
// as `unknown` here — its permissible shape depends entirely on the
// field_type of whichever question question_id turns out to
// reference, which this function has no way to know.
function parseResponsesArray(value: unknown): string | { question_id: string; answer: unknown }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'Invalid response list.';
  const out: { question_id: string; answer: unknown }[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return 'Invalid response entry.';
    const r = raw as { question_id?: unknown; answer?: unknown };
    if (typeof r.question_id !== 'string' || !r.question_id.trim()) return 'Invalid response entry.';
    out.push({ question_id: r.question_id, answer: r.answer });
  }
  return out;
}

// Returns a human-readable error string on failure, or the validated,
// normalised input on success. Never throws — every branch is a
// deliberate, typed check against attacker-controlled JSON.
export function validatePublicRegistrationInput(
  body: PublicRegistrationInput,
): string | ValidatedRegistration {
  if (typeof body.ticket_type_id !== 'string' || !body.ticket_type_id.trim()) {
    return 'A ticket type is required.';
  }

  if (
    body.event_session_id !== undefined &&
    body.event_session_id !== null &&
    typeof body.event_session_id !== 'string'
  ) {
    return 'Invalid session selection.';
  }
  const eventSessionId =
    typeof body.event_session_id === 'string' && body.event_session_id.trim()
      ? body.event_session_id.trim()
      : null;

  if (
    !Number.isInteger(body.quantity) ||
    (body.quantity as number) < 1 ||
    (body.quantity as number) > MAX_QUANTITY
  ) {
    return `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`;
  }
  const quantity = body.quantity as number;

  if (!isNonEmptyString(body.purchaser_name, MAX_NAME_LENGTH)) return 'Purchaser name is required.';
  if (!isValidEmail(body.purchaser_email)) return 'A valid purchaser email is required.';

  if (body.purchaser_phone !== undefined && body.purchaser_phone !== null && body.purchaser_phone !== '') {
    if (typeof body.purchaser_phone !== 'string' || body.purchaser_phone.length > MAX_PHONE_LENGTH) {
      return 'Invalid purchaser phone number.';
    }
  }
  const purchaserPhone =
    typeof body.purchaser_phone === 'string' && body.purchaser_phone.trim()
      ? body.purchaser_phone.trim()
      : null;

  if (!Array.isArray(body.attendees) || body.attendees.length !== quantity) {
    return `Exactly ${quantity} attendee${quantity === 1 ? '' : 's'} must be supplied, matching the selected quantity.`;
  }

  const attendees: ValidatedAttendee[] = [];
  for (const raw of body.attendees) {
    if (typeof raw !== 'object' || raw === null) return 'Invalid attendee details.';
    const a = raw as { name?: unknown; email?: unknown; responses?: unknown };
    if (!isNonEmptyString(a.name, MAX_NAME_LENGTH)) return 'Each attendee requires a name.';
    let email: string | null = null;
    if (a.email !== undefined && a.email !== null && a.email !== '') {
      if (!isValidEmail(a.email)) return 'Invalid attendee email.';
      email = (a.email as string).trim();
    }
    const attendeeResponses = parseResponsesArray(a.responses);
    if (typeof attendeeResponses === 'string') return attendeeResponses;
    attendees.push({ name: (a.name as string).trim(), email, responses: attendeeResponses });
  }

  const orderResponses = parseResponsesArray(body.order_responses);
  if (typeof orderResponses === 'string') return orderResponses;

  return {
    ticket_type_id: body.ticket_type_id.trim(),
    event_session_id: eventSessionId,
    quantity,
    purchaser_name: (body.purchaser_name as string).trim(),
    purchaser_email: (body.purchaser_email as string).trim(),
    purchaser_phone: purchaserPhone,
    attendees,
    order_responses: orderResponses,
  };
}
