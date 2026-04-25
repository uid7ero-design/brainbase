import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../../lib/gmail/tokens';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function header(hdrs: { name: string; value: string }[], name: string) {
  return hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBody(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch { return ''; }
}

function extractText(payload: Record<string, unknown>): string {
  if (!payload) return '';
  const mimeType = payload.mimeType as string;
  const body = payload.body as { data?: string } | undefined;

  if (mimeType === 'text/plain' && body?.data) return decodeBody(body.data);

  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (parts) {
    // Prefer text/plain, fall back to text/html
    const plain = parts.find(p => (p.mimeType as string) === 'text/plain');
    if (plain) return extractText(plain);
    const html = parts.find(p => (p.mimeType as string) === 'text/html');
    if (html) return extractText(html);
    // Recurse into multipart
    for (const part of parts) {
      const text = extractText(part);
      if (text) return text;
    }
  }
  return '';
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'not connected' }, { status: 401 });

  const r = await fetch(`${BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return NextResponse.json({ error: 'Gmail API error' }, { status: 502 });

  const data = await r.json();
  const hdrs = data.payload?.headers ?? [];

  return NextResponse.json({
    id,
    subject: header(hdrs, 'subject') || '(no subject)',
    from:    header(hdrs, 'from'),
    to:      header(hdrs, 'to'),
    date:    header(hdrs, 'date'),
    body:    extractText(data.payload),
    threadId: data.threadId,
  });
}
