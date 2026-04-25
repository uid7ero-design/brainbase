import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken, readTokens } from '../../../../../lib/gmail/tokens';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function makeRaw(to: string, from: string, subject: string, body: string, threadId?: string, inReplyTo?: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  lines.push('', body);
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function POST(req: NextRequest) {
  const { to, subject, body, threadId, inReplyTo } = await req.json() as {
    to: string; subject: string; body: string; threadId?: string; inReplyTo?: string;
  };

  if (!to || !body) return NextResponse.json({ error: 'to and body required' }, { status: 400 });

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'not connected' }, { status: 401 });

  const tokens = readTokens();
  const from = tokens?.email ?? 'me';
  const raw = makeRaw(to, from, subject ?? '(no subject)', body, threadId, inReplyTo);

  const payload: Record<string, string> = { raw };
  if (threadId) payload.threadId = threadId;

  const r = await fetch(`${BASE}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return NextResponse.json({ error: err?.error?.message ?? 'Send failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
