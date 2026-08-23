// Founder OS Phase E.5C — Microsoft calendar event time normalization.
//
// Microsoft Graph's /me/calendarView, requested with the E.5B route's
// Prefer: outlook.timezone="UTC" header, returns event start/end values
// as ISO-like strings with NO 'Z' suffix or offset — e.g.
// "2026-08-23T09:30:00.0000000" — even though that value IS a UTC
// instant. Confirmed against a real Production response (Phase E.5C
// diagnostic). Parsing that string directly with `new Date()` would
// misinterpret it as the browser's own local time rather than UTC,
// silently shifting displayed event times by the viewer's UTC offset.
//
// This appends 'Z' only when no zone marker is already present (so a
// value that DID already include one — e.g. if Graph's formatting ever
// changes — is not double-corrected), then formats the corrected
// instant in the viewer's own local time. This is display formatting
// only: it does not change what "today" means server-side, and does
// not touch the API route's own date-window construction.
export function formatEventTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  const date = new Date(hasZone ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
