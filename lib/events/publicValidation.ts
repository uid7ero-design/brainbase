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
};

export type ValidatedAttendee = { name: string; email: string | null };

export type ValidatedRegistration = {
  ticket_type_id: string;
  event_session_id: string | null;
  quantity: number;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_phone: string | null;
  attendees: ValidatedAttendee[];
};

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
    const a = raw as { name?: unknown; email?: unknown };
    if (!isNonEmptyString(a.name, MAX_NAME_LENGTH)) return 'Each attendee requires a name.';
    let email: string | null = null;
    if (a.email !== undefined && a.email !== null && a.email !== '') {
      if (!isValidEmail(a.email)) return 'Invalid attendee email.';
      email = (a.email as string).trim();
    }
    attendees.push({ name: (a.name as string).trim(), email });
  }

  return {
    ticket_type_id: body.ticket_type_id.trim(),
    event_session_id: eventSessionId,
    quantity,
    purchaser_name: (body.purchaser_name as string).trim(),
    purchaser_email: (body.purchaser_email as string).trim(),
    purchaser_phone: purchaserPhone,
    attendees,
  };
}
