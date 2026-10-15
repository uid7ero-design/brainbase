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
// about total event capacity. Multi-ticket-type carts (Phase 2): the
// ceiling applies to the WHOLE order (sum of every line's quantity),
// never per line — a cart cannot be used to multiply it.
export const MAX_QUANTITY = 20;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export type PublicRegistrationInput = {
  // Cart shape (Phase 2): one entry per ticket type — see
  // validatePublicRegistrationInput's own comment. Mutually exclusive
  // with the legacy single-type ticket_type_id/quantity pair below.
  items?: unknown;
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

export type ValidatedAttendee = {
  name: string;
  email: string | null;
  // Which cart line (ticket type) this attendee's ticket belongs to.
  ticket_type_id: string;
  responses: { question_id: string; answer: unknown }[];
};

export type ValidatedCartItem = { ticket_type_id: string; quantity: number };

export type ValidatedRegistration = {
  // One entry per distinct ticket type, in the order submitted. Never
  // empty; ticket_type_id values are unique.
  items: ValidatedCartItem[];
  event_session_id: string | null;
  // Total tickets across every item (== attendees.length).
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
//
// Two accepted shapes (Phase 2 — multi-ticket-type orders):
//
//   Cart:   { items: [{ ticket_type_id, quantity }, ...],
//             attendees: [{ ticket_type_id, name, email?, responses? }, ...] }
//   Legacy: { ticket_type_id, quantity, attendees: [{ name, ... }, ...] }
//
// The legacy shape is normalised into a one-line cart (every attendee
// is tagged with that single ticket type), so every caller downstream
// sees exactly one representation. Supplying both shapes at once is
// rejected rather than guessed at. A ticket type may appear only once
// per cart — duplicates are rejected, never silently merged — and every
// cart attendee must name the line it belongs to, with each line's
// attendee count matching that line's quantity exactly.
export function validatePublicRegistrationInput(
  body: PublicRegistrationInput,
): string | ValidatedRegistration {
  const hasItems = body.items !== undefined && body.items !== null;
  const hasLegacyType = body.ticket_type_id !== undefined && body.ticket_type_id !== null;
  if (hasItems && (hasLegacyType || (body.quantity !== undefined && body.quantity !== null))) {
    return 'Provide either a ticket cart or a single ticket type, not both.';
  }

  // Legacy shape keeps its original check order exactly: ticket type,
  // then session, then quantity.
  if (!hasItems && (typeof body.ticket_type_id !== 'string' || !body.ticket_type_id.trim())) {
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

  let items: ValidatedCartItem[];
  if (hasItems) {
    if (!Array.isArray(body.items) || body.items.length === 0) return 'Select at least one ticket.';
    if (body.items.length > MAX_QUANTITY) return 'Too many ticket types in one order.';
    items = [];
    const seen = new Set<string>();
    for (const raw of body.items) {
      if (typeof raw !== 'object' || raw === null) return 'Invalid ticket selection.';
      const it = raw as { ticket_type_id?: unknown; quantity?: unknown };
      if (typeof it.ticket_type_id !== 'string' || !it.ticket_type_id.trim()) return 'A ticket type is required.';
      if (!Number.isInteger(it.quantity) || (it.quantity as number) < 1 || (it.quantity as number) > MAX_QUANTITY) {
        return `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`;
      }
      const id = it.ticket_type_id.trim();
      if (seen.has(id)) return 'Each ticket type may appear only once in an order.';
      seen.add(id);
      items.push({ ticket_type_id: id, quantity: it.quantity as number });
    }
  } else {
    if (
      !Number.isInteger(body.quantity) ||
      (body.quantity as number) < 1 ||
      (body.quantity as number) > MAX_QUANTITY
    ) {
      return `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`;
    }
    items = [{ ticket_type_id: (body.ticket_type_id as string).trim(), quantity: body.quantity as number }];
  }

  const quantity = items.reduce((sum, it) => sum + it.quantity, 0);
  if (quantity > MAX_QUANTITY) {
    return `An order can contain at most ${MAX_QUANTITY} tickets in total.`;
  }

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

  const itemIds = new Set(items.map(it => it.ticket_type_id));
  const perItemCount = new Map<string, number>();
  const attendees: ValidatedAttendee[] = [];
  for (const raw of body.attendees) {
    if (typeof raw !== 'object' || raw === null) return 'Invalid attendee details.';
    const a = raw as { name?: unknown; email?: unknown; responses?: unknown; ticket_type_id?: unknown };
    if (!isNonEmptyString(a.name, MAX_NAME_LENGTH)) return 'Each attendee requires a name.';
    let email: string | null = null;
    if (a.email !== undefined && a.email !== null && a.email !== '') {
      if (!isValidEmail(a.email)) return 'Invalid attendee email.';
      email = (a.email as string).trim();
    }
    let ticketTypeId: string;
    if (hasItems) {
      if (typeof a.ticket_type_id !== 'string' || !itemIds.has(a.ticket_type_id.trim())) {
        return 'Each attendee must be assigned to one of the selected ticket types.';
      }
      ticketTypeId = a.ticket_type_id.trim();
    } else {
      // Legacy single-type shape: every attendee belongs to that type.
      ticketTypeId = items[0].ticket_type_id;
    }
    perItemCount.set(ticketTypeId, (perItemCount.get(ticketTypeId) ?? 0) + 1);
    const attendeeResponses = parseResponsesArray(a.responses);
    if (typeof attendeeResponses === 'string') return attendeeResponses;
    attendees.push({ name: (a.name as string).trim(), email, ticket_type_id: ticketTypeId, responses: attendeeResponses });
  }
  for (const it of items) {
    if ((perItemCount.get(it.ticket_type_id) ?? 0) !== it.quantity) {
      return 'Each ticket type needs exactly one attendee per ticket selected.';
    }
  }

  const orderResponses = parseResponsesArray(body.order_responses);
  if (typeof orderResponses === 'string') return orderResponses;

  return {
    items,
    event_session_id: eventSessionId,
    quantity,
    purchaser_name: (body.purchaser_name as string).trim(),
    purchaser_email: (body.purchaser_email as string).trim(),
    purchaser_phone: purchaserPhone,
    attendees,
    order_responses: orderResponses,
  };
}
