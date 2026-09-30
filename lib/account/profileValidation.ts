// Account profile field validation — server-side, since client-side
// validation alone can always be bypassed by calling the API directly.
// Mirrors lib/organisations/branding.ts's own normalizeText/validate*
// split exactly: a pure normalize/validate module with no DB access,
// used by the route layer to reject bad input with a useful 400 before
// ever building an UPDATE.
//
// Every accepted field is optional (omit it, or pass an empty string,
// and it is simply not updated / cleared) — only a non-string value or
// an over-length string is a genuine validation failure.

const MAX_NAME_PART_LENGTH = 100;   // first_name/last_name/display_name — generous for any real name
const MAX_ABOUT_ME_LENGTH = 1000;   // this phase's own explicit requirement (bio / "About me")
const MAX_JOB_FIELD_LENGTH = 150;   // job_title/department
const MAX_PHONE_LENGTH = 30;        // no real-world phone format approaches this
const MAX_TIMEZONE_LENGTH = 100;    // the longest real IANA zone names are well under this
const MAX_PREFERENCES_JSON_LENGTH = 10_000; // a generous ceiling against pathological payloads, not a real-world limit

export const ABOUT_ME_MAX_LENGTH = MAX_ABOUT_ME_LENGTH;

export type FieldValidationResult = { ok: true; value: string | null } | { ok: false; error: string };

// Non-string -> rejected outright (never silently coerced — a caller
// sending a number/array/object for a text field is either a bug or an
// attempt to smuggle something unexpected into a jsonb/text column).
// Trimmed; an empty result after trimming is treated as "clear this
// field" (null), not a length violation. Over-length is a hard
// rejection, never silent truncation — the brief's own "communicate the
// limit in the UI" instruction only makes sense if the server actually
// enforces the same limit it advertises, rather than quietly cutting
// the value short.
function validateOptionalText(value: unknown, maxLength: number, fieldLabel: string): FieldValidationResult {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${fieldLabel} must be text.` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${fieldLabel} must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

export function validateFirstName(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_NAME_PART_LENGTH, 'First name');
}
export function validateLastName(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_NAME_PART_LENGTH, 'Last name');
}
export function validateDisplayName(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_NAME_PART_LENGTH, 'Display name');
}

// "About me" — the UI label; `bio` remains the underlying DB/API field
// name (this phase's own explicit instruction: relabel only, no field
// rename, since sessions/existing consumers already key off `bio`).
export function validateAboutMe(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_ABOUT_ME_LENGTH, 'About me');
}

export function validateJobTitle(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_JOB_FIELD_LENGTH, 'Job title');
}
export function validateDepartment(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_JOB_FIELD_LENGTH, 'Department');
}
export function validatePhone(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_PHONE_LENGTH, 'Phone');
}
export function validateTimezone(value: unknown): FieldValidationResult {
  return validateOptionalText(value, MAX_TIMEZONE_LENGTH, 'Timezone');
}

// preferences is the one non-text accepted field — a plain JSON object
// (never an array/string/number/null-that-isn't-clearing). Validated by
// shape and a generous serialized-size ceiling, not by an exhaustive
// per-key schema: this column is an open bag of UX preferences (e.g.
// secure_mode, set elsewhere by app/actions/profile.ts's own
// updateSecureMode) and this route must not become the sole gatekeeper
// of every key ever added to it.
export type JsonValidationResult = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string };

export function validatePreferences(value: unknown): JsonValidationResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Preferences must be an object.' };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, error: 'Preferences could not be serialized.' };
  }
  if (serialized.length > MAX_PREFERENCES_JSON_LENGTH) {
    return { ok: false, error: 'Preferences payload is too large.' };
  }
  return { ok: true, value: value as Record<string, unknown> };
}
