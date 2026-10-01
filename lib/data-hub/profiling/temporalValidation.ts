// Data Hub 6.2D4D1A (final review remediation) — canonical (not merely
// shape-matching) validation of normalized DATE/TIME/DATETIME profiler
// input.
//
// Reuses D4C-B2A's own pure grammar/calendar helpers from
// lib/data-hub/normalization/dateTime.ts VERBATIM, unmodified — this is
// not a second temporal grammar. A regex can only prove a value LOOKS like
// "YYYY-MM-DD"; it cannot prove "2025-02-30" is an impossible calendar
// date, or that "25:00:00" is an impossible clock time. Every function
// here instead: (1) parses the value with the real parser (which already
// performs calendar/clock validity checking), then (2) re-renders the
// parsed result through the real canonical-output formatter and requires
// it to equal the original string EXACTLY. That second step is what
// rejects a value that merely *parses* (e.g. B2A's own narrow raw-source
// midnight-timestamp accommodation for DATE, or TIME's accepted short
// "HH:mm" input form) without being the normalizer's actual canonical
// OUTPUT shape — which is the only shape D4D1A's input contract accepts.

import {
  parseStrictDate,
  parseStrictTime,
  parseStrictDateTime,
  calendarDateToIsoString,
  clockTimeToCanonicalString,
} from "../normalization/dateTime";

/**
 * A normalized DATE is always ISO "YYYY-MM-DD" over a real calendar date.
 * Deliberately rejects B2A's own raw-source-only midnight-timestamp
 * accommodation ("YYYY-MM-DDT00:00:00.000Z") — that shape is an accepted
 * RAW input form, never a normalized DATE *output* value.
 */
export function isCanonicalNormalizedDate(value: string): boolean {
  const result = parseStrictDate(value, "ISO_8601");
  if (!result.ok) return false;
  return calendarDateToIsoString(result.date) === value;
}

/**
 * A normalized TIME is always HH:mm:ss[.fraction] with a valid clock.
 * Deliberately rejects the shorter "HH:mm" form parseStrictTime() itself
 * still accepts (that form is a RAW/source input leniency, never B2A's
 * normalized output, which always includes seconds).
 */
export function isCanonicalNormalizedTime(value: string): boolean {
  const result = parseStrictTime(value);
  if (!result.ok) return false;
  return clockTimeToCanonicalString(result.time) === value;
}

/**
 * A normalized DATETIME is always
 * YYYY-MM-DDTHH:mm:ss[.fraction] with EITHER no offset at all
 * (UNSPECIFIED_LOCAL columns) OR exactly a trailing "Z" (every other
 * timeZonePolicy, which always resolves to a real UTC instant) — never a
 * numeric source offset like "+09:30"/"-05:00", which is a RAW/source
 * input form D4C-A's own transformValue.ts always resolves away before
 * producing normalized output. No timezone conversion/re-resolution is
 * performed here — only exact grammar/calendar/shape validation.
 */
export function isCanonicalNormalizedDateTime(value: string): boolean {
  const result = parseStrictDateTime(value, "ISO_8601");
  if (!result.ok) return false;
  const { date, time, offset } = result.value;
  if (offset !== null && offset !== "Z") return false;
  const reconstructed = `${calendarDateToIsoString(date)}T${clockTimeToCanonicalString(time)}${offset === "Z" ? "Z" : ""}`;
  return reconstructed === value;
}

/**
 * A single normalized DATETIME column is governed by exactly one
 * timeZonePolicy — which can only ever produce EITHER trailing-"Z" values
 * (UTC/SOURCE_OFFSET/IANA — every policy that resolves a real instant) OR
 * no-trailing-"Z" values (UNSPECIFIED_LOCAL), never a mix of both within
 * the same governed run. This is a column-level cross-cell invariant, not
 * a per-value shape check — callers should run it only after every
 * individual value has already passed isCanonicalNormalizedDateTime.
 */
export function hasMixedDatetimeZoneForms(values: readonly string[]): boolean {
  let sawZ = false;
  let sawNonZ = false;
  for (const value of values) {
    if (value.endsWith("Z")) sawZ = true;
    else sawNonZ = true;
    if (sawZ && sawNonZ) return true;
  }
  return false;
}
