import { NextRequest } from 'next/server';
import { getValidAccessTokens } from '../../../../../lib/gcal/tokens';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

type RawEvent = Record<string, unknown>;

function mapEvent(e: RawEvent, accountEmail: string, calendarId: string) {
  const start = e.start as Record<string, string>;
  const end   = e.end   as Record<string, string>;
  return {
    id:       `${accountEmail}:${calendarId}:${e.id}`,
    title:    e.summary ?? 'Untitled',
    allDay:   !!start.date,
    start:    start.dateTime ?? start.date,
    end:      end.dateTime   ?? end.date,
    location: e.location ?? null,
    account:  accountEmail,
  };
}

async function fetchAllCalendars(token: string, email: string, params: URLSearchParams) {
  // Get list of all calendars this account has access to
  const listRes = await fetch(`${CAL_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) return [];

  const listData = await listRes.json();
  const calendars: Array<{ id: string }> = listData.items ?? [];

  const allEvents: ReturnType<typeof mapEvent>[] = [];

  await Promise.all(calendars.map(async (cal) => {
    try {
      const res = await fetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const data = await res.json();
      (data.items ?? []).forEach((e: RawEvent) => allEvents.push(mapEvent(e, email, cal.id)));
    } catch {}
  }));

  return allEvents;
}

export async function GET() {
  const accounts = await getValidAccessTokens();
  if (!accounts.length) return Response.json({ error: 'Not connected' }, { status: 401 });

  const now   = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end   = new Date(now); end.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    timeMin:      start.toISOString(),
    timeMax:      end.toISOString(),
    orderBy:      'startTime',
    singleEvents: 'true',
    maxResults:   '50',
  });

  const allEvents: ReturnType<typeof mapEvent>[] = [];

  await Promise.all(accounts.map(async ({ email, token }) => {
    const events = await fetchAllCalendars(token, email, params);
    allEvents.push(...events);
  }));

  allEvents.sort((a, b) => {
    if (!a.start) return 1;
    if (!b.start) return -1;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });

  return Response.json({ events: allEvents });
}

export async function POST(req: NextRequest) {
  const accounts = await getValidAccessTokens();
  if (!accounts.length) return Response.json({ error: 'Not connected' }, { status: 401 });

  const { token } = accounts[0];

  const { title, date, time, duration = 60 } = await req.json() as {
    title: string;
    date?: string;
    time?: string;
    duration?: number;
  };

  const eventDate = date ?? new Date().toISOString().slice(0, 10);
  let startHour = new Date().getHours() + 1;
  let startMin  = 0;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    startHour = h; startMin = m || 0;
  }

  const startDt = new Date(`${eventDate}T${String(startHour).padStart(2,'0')}:${String(startMin).padStart(2,'0')}:00`);
  const endDt   = new Date(startDt.getTime() + duration * 60_000);

  const body = {
    summary: title,
    start: { dateTime: startDt.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end:   { dateTime: endDt.toISOString(),   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };

  const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) return Response.json({ error: 'Create failed' }, { status: res.status });
  return Response.json({ ok: true, event: await res.json() });
}
