import { NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '@/lib/globalIntegrationAccess';
import { getValidAccessToken, getConnectionSummary } from '@/lib/microsoft/tokens';

// Founder OS Phase E.5B.1 — the first real consumer of E.5A's
// getValidAccessToken()/refreshAccessToken() (previously implemented
// but never called anywhere). GET only, read-only, bounded to a single
// day's worth of the account's own calendar — no calendar write, no
// mail, no Bookings, no contacts, no files, no Teams. Mirrors
// app/api/integrations/gcal/events/route.ts's GET structure and
// response-shape conventions (id/title/allDay/start/end/location/
// account), not its POST (create) side, which is deliberately not
// reproduced here.
//
// Uses GET /v1.0/me/calendarView (not /me/events) — calendarView is
// Graph's purpose-built endpoint for a bounded date-range query and
// auto-expands recurring events, matching what a plain /events query
// with a client-side date filter would otherwise have to do manually.
// Requires only the already-approved Calendars.Read scope (E.5A);
// requesting no broader permission.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Minimum fields for the normalized response — deliberately excludes
// attendees, organizer, body/bodyPreview, onlineMeeting, extensions,
// and recurrence internals, none of which this route ever returns.
const EVENT_SELECT_FIELDS = 'id,subject,start,end,location,isAllDay';

type GraphCalendarEvent = {
  id: string;
  subject?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
};

function mapEvent(e: GraphCalendarEvent, account: string | null) {
  return {
    id: e.id,
    title: e.subject ?? 'Untitled',
    allDay: !!e.isAllDay,
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location?.displayName ?? null,
    account,
  };
}

export async function GET() {
  try {
    await requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'Not connected' }, { status: 401 });

  // Cheap, already-proven, presence-only read (the same query the status
  // route already makes) — not a new token/decrypt operation. Safe to
  // include `account` in the response without expanding scope; if this
  // read fails for any reason, `account` is simply omitted rather than
  // failing the whole request.
  let account: string | null = null;
  try {
    const summary = await getConnectionSummary();
    account = summary?.accountEmail ?? null;
  } catch {
    account = null;
  }

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    startDateTime: windowStart.toISOString(),
    endDateTime: windowEnd.toISOString(),
    $select: EVENT_SELECT_FIELDS,
  });

  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}/me/calendarView?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
      // Established BrainBase convention for server-side external API
      // calls (see app/api/admin/founder-*/route.ts) — reused as-is,
      // no new networking abstraction introduced.
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[MS365 events] Graph request failed:', (err as Error).message);
    return NextResponse.json({ error: 'Calendar request failed' }, { status: 502 });
  }

  if (!res.ok) {
    console.error('[MS365 events] Graph request failed:', res.status);
    return NextResponse.json({ error: 'Calendar request failed' }, { status: 502 });
  }

  const data = await res.json() as { value?: GraphCalendarEvent[] };
  const events = (data.value ?? []).map(e => mapEvent(e, account));

  return NextResponse.json({ events });
}
