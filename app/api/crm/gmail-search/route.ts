import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/gmail/tokens';
import { requireSession, unauthorized } from '@/lib/org';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function header(hdrs: { name: string; value: string }[], name: string) {
  return hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * GET /api/crm/gmail-search?email=...
 * Returns Gmail messages to/from the given email address.
 */
export async function GET(req: NextRequest) {
  try { await requireSession(); } catch { return unauthorized(); }

  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email param required.' }, { status: 400 });

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'Gmail not connected.' }, { status: 401 });

  // Search for messages to or from this email
  const query = encodeURIComponent(`from:${email} OR to:${email}`);
  const listRes = await fetch(`${BASE}/messages?q=${query}&maxResults=15`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) return NextResponse.json({ error: 'Gmail API error.' }, { status: 502 });

  const { messages = [] } = await listRes.json();
  if (messages.length === 0) return NextResponse.json({ messages: [] });

  const details = await Promise.all(
    messages.map(async (m: { id: string }) => {
      const r = await fetch(
        `${BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return null;
      const data = await r.json();
      const hdrs = data.payload?.headers ?? [];
      const date = new Date(header(hdrs, 'date'));
      return {
        id:      m.id,
        subject: header(hdrs, 'subject') || '(no subject)',
        from:    header(hdrs, 'from').replace(/<[^>]+>/, '').trim() || 'Unknown',
        to:      header(hdrs, 'to'),
        time:    isNaN(date.getTime()) ? '' : relativeTime(date.getTime()),
        snippet: data.snippet ?? '',
      };
    }),
  );

  return NextResponse.json({ messages: details.filter(Boolean) });
}
