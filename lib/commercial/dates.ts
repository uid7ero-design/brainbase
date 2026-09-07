import { parseLocalDate, AU_MONTHS } from '@/lib/date';

// Phase C3-POLISH-R — the single Commercial date-display convention.
// Built on lib/date.ts's existing parseLocalDate(), which already solves
// the UTC-shift problem this module must not reintroduce: it parses the
// 'YYYY-MM-DD' string returned by the Postgres driver for a DATE column
// by slicing its date components and constructing a Date from local
// fields (`new Date(y, m-1, d)`), never via Date.parse()/`new
// Date(isoString)` (which treats a bare date as UTC midnight and can
// render as the PREVIOUS calendar day once formatted in a timezone
// behind UTC). Because this never goes through a UTC instant at all, it
// is correct regardless of which timezone the formatting code actually
// runs in — the Vercel server, a browser in Australia/Adelaide, or a
// developer's own machine — which is what "test Australia/Adelaide
// specifically" in the brief is actually asking to be safe against.
//
// Every Commercial surface that shows a DATE column (issue_date,
// expiry_date, and any future commercial document date) must go through
// this function, never `new Date(x).toLocaleDateString()` or a raw
// string interpolation — the latter is exactly how 2026-09-07T00:00:00.000Z
// ends up on screen.

// Deliberately NOT d.toLocaleDateString('en-AU', { month: 'short' }) —
// verified empirically that this Node/ICU's actual en-AU CLDR data
// abbreviates September as "Sept" (4 letters), not the "Sep" the brief's
// own specified format ("7 Sep 2026") asks for. Building the string from
// lib/date.ts's own AU_MONTHS array, sliced to 3 characters, guarantees
// the exact abbreviation this module promises regardless of ICU/Node
// version, and reuses the same slicing convention
// formatWeekHeading()/AU_MONTHS already establish there.
//
// Takes a Date directly (LOCAL getters only — see resolveLocalDate()'s
// own comment for why this is the correct, not merely convenient,
// accessor choice for a Date produced by resolveLocalDate()).
function formatShort(d: Date): string {
  return `${d.getDate()} ${AU_MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

// Phase C3-EMAIL-FIX — root cause: @neondatabase/serverless (the driver
// lib/db.ts's `sql` tagged template uses) parses a PostgreSQL DATE
// column into a native JS Date object, NOT a string — confirmed
// empirically against real production data (see this phase's own report
// for the full trace). It does this via `new Date(year, monthIndex,
// day)`, i.e. LOCAL Date-constructor components representing local
// midnight of the intended calendar date — NOT `Date.UTC(...)`. That
// object is only ever handed a plain string by the ONE code path that
// round-trips it through JSON first (a page fetching quote data over
// HTTP: JSON.stringify calls Date.prototype.toJSON -> toISOString(),
// so the browser always receives a string). The direct, in-process
// server-side path (lib/commercial/quoteEmail.ts's sendQuoteEmail(),
// which never goes through HTTP/JSON between the DB read and here)
// receives the raw Date object instead — that mismatch is the entire
// bug this phase fixes.
//
// Because the driver constructs that Date using LOCAL components, and
// this function reads it back using LOCAL getters (getFullYear/
// getMonth/getDate, never getUTCFullYear/getUTCMonth/getUTCDate), the
// original y/m/d round-trips EXACTLY — regardless of what timezone the
// current process actually runs in (Vercel's Lambda, a developer's own
// machine, anything) — because the same process/timezone context both
// wrote it (inside the driver, moments earlier in the same request) and
// reads it back (here). This was verified empirically against real
// production data: for a column whose raw `::text` value was
// '2026-09-07', the driver-returned Date's LOCAL getters gave (2026, 8,
// 7) — correct — while its UTC getters gave (2026, 8, 6) — one day
// EARLY. Using the UTC getters here would have silently reintroduced
// exactly the "day-shift" bug lib/date.ts's own parseLocalDate() was
// already written to avoid for the string case.
//
// The string branch is UNCHANGED from before this phase: still
// lib/date.ts's parseLocalDate() (slice to 'YYYY-MM-DD', construct a
// local Date from the parsed components) — this fix only ADDS a branch
// for a Date input, it does not touch string handling or lib/date.ts's
// own contract (that function is shared with lib/tennisSchedule.ts and
// app/dashboard/sessions/page.tsx, which always pass strings — its
// signature and behavior are deliberately left untouched here).
function resolveLocalDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return parseLocalDate(value);
}

/** e.g. "7 Sep 2026". Returns '—' for null/undefined/unparseable input. Accepts either a 'YYYY-MM-DD'/ISO string (the shape every browser-facing API response uses, since JSON serializes a Date to a string) or a native Date object (the shape the server-side driver hands back directly, in-process, for a DATE column — see resolveLocalDate()'s comment). */
export function formatCommercialDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = resolveLocalDate(value);
  if (isNaN(d.getTime())) return '—';
  return formatShort(d);
}

/** Same as formatCommercialDate but returns null (not '—') for empty input — for callers that need to conditionally omit a whole row/line rather than print a placeholder. */
export function formatCommercialDateOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = resolveLocalDate(value);
  if (isNaN(d.getTime())) return null;
  return formatShort(d);
}
