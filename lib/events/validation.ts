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
  status?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  timezone?: unknown;
};

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
};

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

  return null;
}
