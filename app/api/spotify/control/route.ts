import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../lib/spotify/tokens';

const API_BASE = 'https://api.spotify.com/v1/me/player';

const ACTIONS: Record<string, { method: string; path: string }> = {
  play:  { method: 'PUT',  path: '/play' },
  pause: { method: 'PUT',  path: '/pause' },
  next:  { method: 'POST', path: '/next' },
  prev:  { method: 'POST', path: '/previous' },
};

export async function POST(req: NextRequest) {
  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const body      = await req.json().catch(() => ({}));
  const action    = body?.action    as string | undefined;
  const uri       = body?.uri       as string | undefined;
  const deviceId  = body?.device_id as string | undefined;
  const endpoint  = action ? ACTIONS[action] : undefined;

  if (!endpoint) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  // device_id is a query param on the Spotify play endpoint, not a body field
  const playBodyObj = (action === 'play') ? { ...(uri ? { uris: [uri] } : {}) } : undefined;
  const hasBody = playBodyObj && Object.keys(playBodyObj).length > 0;

  const urlParams = (action === 'play' && deviceId)
    ? `?device_id=${encodeURIComponent(deviceId)}`
    : '';

  const res = await fetch(`${API_BASE}${endpoint.path}${urlParams}`, {
    method:  endpoint.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(playBodyObj) : undefined,
  });

  if (res.ok || res.status === 204) return NextResponse.json({ ok: true });

  const err = await res.json().catch(() => ({ message: 'spotify_error' }));
  return NextResponse.json({ error: err }, { status: res.status });
}
