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
function formatShort(d: Date): string {
  return `${d.getDate()} ${AU_MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** e.g. "7 Sep 2026". Returns '—' for null/undefined/unparseable input. */
export function formatCommercialDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = parseLocalDate(dateStr);
  if (isNaN(d.getTime())) return '—';
  return formatShort(d);
}

/** Same as formatCommercialDate but returns null (not '—') for empty input — for callers that need to conditionally omit a whole row/line rather than print a placeholder. */
export function formatCommercialDateOrNull(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = parseLocalDate(dateStr);
  if (isNaN(d.getTime())) return null;
  return formatShort(d);
}
