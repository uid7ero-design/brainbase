// Shared validation for the Events & Ticketing Phase 1 API routes.
// Deliberately small, hand-written checks per entity rather than a
// generic validation framework — Phase 1 has exactly three entities and
// a short, fixed rule set for each.
//
// Every function returns a human-readable error string on failure, or
// null when the input is valid — callers turn a non-null return into a
// 400 response with that message.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The raw SQL client's return shape for a TIMESTAMPTZ column is not
// guaranteed to be a Date instance across driver versions/configs — a
// PATCH that merges an unspecified field back in from an already-loaded
// row must handle either shape rather than assuming .toISOString() is
// always callable.
export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// Property-presence PATCH merge, not nullish-coalescing (`??`). `??`
// cannot express "clear this optional field to null" — it treats an
// explicitly-sent `null` identically to "field omitted", silently
// discarding the caller's clear-intent and keeping the old value. This
// merges per the field's actual presence in the raw request body:
//   - key omitted from body      -> existing value is preserved
//   - key present, value null    -> becomes null (clears an optional field)
//   - key present, valid value   -> replaces the existing value
// A `null` merged into a REQUIRED field (e.g. name) is not special-cased
// here — it flows into the entity's own validate*Input() function, which
// already rejects it (e.g. `typeof body.name !== 'string'`), so "explicit
// null on a required field" correctly becomes a 400, not a silent no-op.
export function mergeField<T>(body: Record<string, unknown>, key: string, existing: T): T {
  return Object.prototype.hasOwnProperty.call(body, key) ? (body[key] as T) : existing;
}

export function validateSlug(slug: unknown): string | null {
  if (typeof slug !== 'string' || !slug.trim()) return 'Slug is required.';
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug must be lowercase letters, numbers, and single hyphens only (e.g. "spring-formal-2026").';
  }
  return null;
}

function isValidTimezone(tz: string): boolean {
  try {
    // Intl.supportedValuesOf is available in the Node/V8 versions this
    // repository targets; fall back to a non-empty-string check only if
    // the runtime evaluating this somehow lacks it, rather than failing
    // validation outright over an environment gap unrelated to the
    // actual input.
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (!supported) return tz.trim().length > 0;
    return supported('timeZone').includes(tz);
  } catch {
    return tz.trim().length > 0;
  }
}

export type EventInput = {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  venue?: unknown;
  artwork_url?: unknown;
  status?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  timezone?: unknown;
};

// artwork_url is a reference to an already-hosted image (see
// scripts/add-events-artwork.sql), never an uploaded file — this
// codebase has no byte-upload path for it, so validation is limited to
// "does this look like a plausible http(s) URL", not a MIME/content
// check (there are no bytes here to inspect). null/undefined clears or
// leaves the field alone respectively — see mergeField()'s own contract.
const MAX_ARTWORK_URL_LENGTH = 2048;

export function validateArtworkUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'Artwork URL must be a string.';
  if (value.length > MAX_ARTWORK_URL_LENGTH) return 'Artwork URL is too long.';
  if (value.trim() === '') return null; // treated as "no artwork" by callers, not an error
  if (!/^https:\/\/.+/i.test(value) && !/^http:\/\/.+/i.test(value)) {
    return 'Artwork URL must start with http:// or https://.';
  }
  return null;
}

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function validateEventInput(body: EventInput): string | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return 'Name is required.';

  const slugError = validateSlug(body.slug);
  if (slugError) return slugError;

  if (body.status !== undefined && !EVENT_STATUSES.includes(body.status as EventStatus)) {
    return `Status must be one of: ${EVENT_STATUSES.join(', ')}.`;
  }

  if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) {
    return 'A valid IANA timezone is required (e.g. "Australia/Adelaide").';
  }

  const artworkError = validateArtworkUrl(body.artwork_url);
  if (artworkError) return artworkError;

  const starts = new Date(body.starts_at as string);
  const ends = new Date(body.ends_at as string);
  if (typeof body.starts_at !== 'string' || Number.isNaN(starts.getTime())) return 'A valid start date/time is required.';
  if (typeof body.ends_at !== 'string' || Number.isNaN(ends.getTime())) return 'A valid end date/time is required.';
  if (ends.getTime() <= starts.getTime()) return 'End date/time must be after the start date/time.';

  return null;
}

export type EventSessionInput = {
  name?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  capacity?: unknown;
};

export function validateEventSessionInput(body: EventSessionInput): string | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return 'Name is required.';

  const starts = new Date(body.starts_at as string);
  const ends = new Date(body.ends_at as string);
  if (typeof body.starts_at !== 'string' || Number.isNaN(starts.getTime())) return 'A valid start date/time is required.';
  if (typeof body.ends_at !== 'string' || Number.isNaN(ends.getTime())) return 'A valid end date/time is required.';
  if (ends.getTime() <= starts.getTime()) return 'End date/time must be after the start date/time.';

  if (!Number.isInteger(body.capacity) || (body.capacity as number) < 0) {
    return 'Capacity must be a non-negative whole number.';
  }

  return null;
}

export type EventTicketTypeInput = {
  name?: unknown;
  description?: unknown;
  price_cents?: unknown;
  capacity?: unknown;
  active?: unknown;
  sort_order?: unknown;
  // Phase 4 — optional sale window (ISO strings or null = unbounded) and
  // the presale access-code gate. All three are optional on input; a
  // ticket type without them is on sale exactly as before.
  sale_starts_at?: unknown;
  sale_ends_at?: unknown;
  requires_access_code?: unknown;
};

// Phase 4 — an optional TIMESTAMPTZ input: undefined/null/'' mean "not
// set"; otherwise a parseable date string. Returns the error text, or
// the parsed millis (null when unset).
function parseOptionalInstant(value: unknown, label: string): { error: string } | { millis: number | null } {
  if (value === undefined || value === null || value === '') return { millis: null };
  if (typeof value !== 'string') return { error: `${label} must be a date/time string or null.` };
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return { error: `${label} must be a valid date/time.` };
  return { millis: ms };
}

export function validateEventTicketTypeInput(body: EventTicketTypeInput): string | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return 'Name is required.';

  if (!Number.isInteger(body.price_cents) || (body.price_cents as number) < 0) {
    return 'Price (in cents) must be a non-negative whole number.';
  }

  if (!Number.isInteger(body.capacity) || (body.capacity as number) < 0) {
    return 'Capacity must be a non-negative whole number.';
  }

  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return 'Active must be a boolean.';
  }

  if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) {
    return 'Sort order must be a whole number.';
  }

  // Phase 4 — sale window: either bound may be absent; when both are
  // present the close must follow the open (mirrors the database CHECK
  // event_ticket_types_sale_window_check). A window entirely in the past
  // or future is legitimate (that is what "Sales ended" / "Coming soon"
  // mean), so no comparison against now() is made here.
  const starts = parseOptionalInstant(body.sale_starts_at, 'Sales open');
  if ('error' in starts) return starts.error;
  const ends = parseOptionalInstant(body.sale_ends_at, 'Sales close');
  if ('error' in ends) return ends.error;
  if (starts.millis !== null && ends.millis !== null && ends.millis <= starts.millis) {
    return 'Sales close must be after sales open.';
  }

  if (body.requires_access_code !== undefined && body.requires_access_code !== null && typeof body.requires_access_code !== 'boolean') {
    return 'Requires access code must be a boolean.';
  }

  return null;
}

// ── Phase 4 — promotional codes & presale access codes ────────────────
//
// Both validators check the ORGANISER's management input (manager+
// routes). The code text is normalised (trim/upper-case) by the route
// before storage; here it is validated against the same format the
// database CHECK constraints enforce, so an organiser gets a readable
// message instead of a constraint error. Ticket-type assignments are a
// list of ids — whether each id belongs to THIS event is checked by the
// route against the database (and enforced again by the join table's
// composite FKs), not here.

export const PROMOTION_DISCOUNT_TYPES = ['PERCENT', 'FIXED'] as const;
export type PromotionDiscountType = (typeof PROMOTION_DISCOUNT_TYPES)[number];

export type EventPromotionCodeInput = {
  code?: unknown;
  discount_type?: unknown;
  discount_value?: unknown;
  active?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  max_redemptions?: unknown;
  min_cart_cents?: unknown;
  ticket_type_ids?: unknown;
};

const PROMOTION_CODE_INPUT_PATTERN = /^[A-Z0-9_-]{3,32}$/;
const ACCESS_CODE_INPUT_PATTERN = /^[A-Z0-9_-]{8,32}$/;

function validateCodeText(value: unknown, pattern: RegExp, minLength: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Code is required.';
  const normalised = value.trim().toUpperCase();
  if (!pattern.test(normalised)) {
    return `Code must be ${minLength}–32 characters using letters, numbers, hyphens or underscores.`;
  }
  return null;
}

function validateOptionalWindow(startsRaw: unknown, endsRaw: unknown): string | null {
  const starts = parseOptionalInstant(startsRaw, 'Start');
  if ('error' in starts) return starts.error;
  const ends = parseOptionalInstant(endsRaw, 'Expiry');
  if ('error' in ends) return ends.error;
  if (starts.millis !== null && ends.millis !== null && ends.millis <= starts.millis) return 'Expiry must be after the start.';
  return null;
}

function validateOptionalPositiveInt(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) return `${label} must be a whole number of at least 1, or empty.`;
  return null;
}

function validateTicketTypeIds(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) return 'Ticket type assignments must be a list of ids.';
  if (new Set(value.map(v => (v as string).trim())).size !== value.length) return 'Each ticket type may be assigned only once.';
  return null;
}

export function validateEventPromotionCodeInput(body: EventPromotionCodeInput): string | null {
  const codeError = validateCodeText(body.code, PROMOTION_CODE_INPUT_PATTERN, 3);
  if (codeError) return codeError;

  if (!PROMOTION_DISCOUNT_TYPES.includes(body.discount_type as PromotionDiscountType)) {
    return `Discount type must be one of: ${PROMOTION_DISCOUNT_TYPES.join(', ')}.`;
  }
  if (body.discount_type === 'PERCENT') {
    if (!Number.isInteger(body.discount_value) || (body.discount_value as number) < 1 || (body.discount_value as number) > 100) {
      return 'Percentage discount must be a whole number between 1 and 100.';
    }
  } else if (!Number.isInteger(body.discount_value) || (body.discount_value as number) < 1) {
    return 'Fixed discount (in cents) must be a whole number of at least 1.';
  }

  if (body.active !== undefined && body.active !== null && typeof body.active !== 'boolean') return 'Active must be a boolean.';

  const windowError = validateOptionalWindow(body.starts_at, body.ends_at);
  if (windowError) return windowError;

  const maxError = validateOptionalPositiveInt(body.max_redemptions, 'Maximum redemptions');
  if (maxError) return maxError;
  const minCartError = validateOptionalPositiveInt(body.min_cart_cents, 'Minimum cart (in cents)');
  if (minCartError) return minCartError;

  return validateTicketTypeIds(body.ticket_type_ids);
}

export type EventAccessCodeInput = {
  code?: unknown;
  active?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  ticket_type_ids?: unknown;
};

export function validateEventAccessCodeInput(body: EventAccessCodeInput): string | null {
  const codeError = validateCodeText(body.code, ACCESS_CODE_INPUT_PATTERN, 8);
  if (codeError) return codeError;
  if (body.active !== undefined && body.active !== null && typeof body.active !== 'boolean') return 'Active must be a boolean.';
  const windowError = validateOptionalWindow(body.starts_at, body.ends_at);
  if (windowError) return windowError;
  return validateTicketTypeIds(body.ticket_type_ids);
}

// Phase 3 — ticket type × session inventory override. The only
// manager-editable field is the pair's capacity; it follows the exact
// same convention as every other Events capacity (non-negative whole
// number, 0 allowed, no "unlimited" sentinel). Clearing an override is a
// DELETE, never a null/absent capacity — see
// scripts/create-events-ticket-type-session-inventory.sql.
export type EventTicketTypeSessionInventoryInput = {
  capacity?: unknown;
};

export function validateEventTicketTypeSessionInventoryInput(body: EventTicketTypeSessionInventoryInput): string | null {
  if (!Number.isInteger(body.capacity) || (body.capacity as number) < 0) {
    return 'Capacity must be a non-negative whole number.';
  }
  return null;
}
