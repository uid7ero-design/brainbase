import { NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../../lib/gmail/tokens';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function header(hdrs: { name: string; value: string }[], name: string) {
  return hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export async function GET() {
  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'not connected' }, { status: 401 });

  // Fetch up to 20 inbox message IDs
  const listRes = await fetch(
    `${BASE}/messages?labelIds=INBOX&maxResults=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) return NextResponse.json({ error: 'Gmail API error' }, { status: 502 });

  const { messages = [] } = await listRes.json();

  // Fetch metadata for each in parallel
  const details = await Promise.all(
    messages.slice(0, 20).map(async (m: { id: string }) => {
      const r = await fetch(
        `${BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return null;
      const data = await r.json();
      const hdrs = data.payload?.headers ?? [];
      const date = new Date(header(hdrs, 'date'));
      return {
        id:      m.id,
        subject: header(hdrs, 'subject') || '(no subject)',
        from:    header(hdrs, 'from').replace(/<.*>/, '').trim() || 'Unknown',
        time:    isNaN(date.getTime()) ? '' : relativeTime(date.getTime()),
        unread:  (data.labelIds ?? []).includes('UNREAD'),
        snippet: data.snippet ?? '',
      };
    })
  );

  return NextResponse.json({ messages: details.filter(Boolean) });
}
